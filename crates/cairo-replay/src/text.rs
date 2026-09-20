use std::collections::{BTreeMap, BTreeSet};

use anyhow::{ensure, Context, Result};
use cairo::Context as Cairo;
use pango::{prelude::FontExt, FontDescription, Style, Weight, SCALE};

use crate::{protocol::State, FontDiagnostic};

/// 只解析 px 之前的样式，不把字体族名中的 Bold/Italic 当作样式。
pub(crate) fn parse_font(
    font: &str,
    aliases: &BTreeMap<String, String>,
) -> Result<FontDescription> {
    ensure!(!font.contains('\0'), "NUL in font is unsupported");
    let (before, after) = font
        .split_once("px")
        .context("Expected px font size followed by family")?;
    ensure!(
        after.starts_with(char::is_whitespace),
        "Expected whitespace after px"
    );
    let mut tokens: Vec<_> = before.split_whitespace().collect();
    let size = tokens.pop().context("Missing font size")?;
    ensure!(
        !size.is_empty() && size.bytes().all(|b| b.is_ascii_digit() || b == b'.'),
        "Invalid font size"
    );
    let size: f64 = size.parse().context("Invalid font size")?;
    ensure!(
        size.is_finite() && size > 0.0 && size <= 16_384.0,
        "Font size must be in (0,16384]"
    );
    let family = after.trim_start().replace('"', "");
    let mut families = Vec::new();
    for name in family.split(',').map(str::trim) {
        ensure!(!name.is_empty(), "Empty font family");
        families.push(aliases.get(name).map(String::as_str).unwrap_or(name));
    }
    let mut desc = FontDescription::new();
    // 未启用别名时必须保留原始逗号及空格；Pango/CoreText 的 fallback
    // 对 family 列表的空白敏感，擅自规范化会改变实际字体和 PDF 字节数。
    if aliases.is_empty() {
        desc.set_family(&family);
    } else {
        desc.set_family(&families.join(","));
    }
    desc.set_absolute_size(size * f64::from(SCALE));
    let mut weight = Weight::Normal;
    let mut style = Style::Normal;
    for token in tokens {
        match token {
            "normal" => {}
            "bold" => weight = Weight::Bold,
            "italic" => style = Style::Italic,
            "oblique" => style = Style::Oblique,
            value => {
                ensure!(
                    value.bytes().all(|b| b.is_ascii_digit()),
                    "Unsupported font style prefix"
                );
                let value: i32 = value.parse().context("Unsupported font weight")?;
                ensure!(
                    (1..=1000).contains(&value),
                    "Font weight must be in [1,1000]"
                );
                // gtk-rs 保留 Pango 支持的任意整数 weight，而不只枚举中的常用值。
                weight = Weight::__Unknown(value);
            }
        }
    }
    desc.set_weight(weight);
    desc.set_style(style);
    Ok(desc)
}

pub(crate) struct TextRenderer<'a> {
    pub aliases: &'a BTreeMap<String, String>,
    pub diagnostics: bool,
    pub seen: BTreeSet<FontDiagnostic>,
}

impl TextRenderer<'_> {
    pub fn draw(
        &mut self,
        cr: &Cairo,
        state: &State,
        text: &str,
        mut x: f64,
        mut y: f64,
    ) -> Result<()> {
        let desc = parse_font(&state.font, self.aliases)?;
        let layout = pangocairo::functions::create_layout(cr);
        let context = layout.context();
        context.set_round_glyph_positions(false);
        layout.set_font_description(Some(&desc));
        layout.set_text(text);
        if self.diagnostics {
            let mut iter = layout.iter();
            loop {
                if let Some(run) = iter.run_readonly() {
                    let actual = run
                        .item()
                        .analysis()
                        .font()
                        .describe()
                        .to_string()
                        .to_string();
                    self.seen.insert(FontDiagnostic {
                        requested: state.font.clone(),
                        actual,
                    });
                }
                if !iter.next_run() {
                    break;
                }
            }
        }
        let (width, _) = layout.size();
        let units = f64::from(SCALE);
        match state.align.as_str() {
            "center" => x -= f64::from(width) / (2.0 * units),
            "right" => x -= f64::from(width) / units,
            _ => {}
        }
        let metrics = context.metrics(Some(&desc), None);
        let ascent = f64::from(metrics.ascent()) / units;
        let descent = f64::from(metrics.descent()) / units;
        match state.baseline.as_str() {
            "top" => y += ascent,
            "middle" => y += (ascent - descent) / 2.0,
            "bottom" => y -= descent,
            _ => {}
        }
        let old = cr.copy_path()?;
        cr.move_to(x, y - f64::from(layout.baseline()) / units);
        pangocairo::functions::show_layout(cr, &layout);
        cr.new_path();
        cr.append_path(&old);
        cr.status()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_prefix_aliases_and_fractional_sizes() {
        let aliases = BTreeMap::from([("Missing Font".into(), "sans-serif".into())]);
        let desc = parse_font(
            "italic 650 12.5px \"Missing Font\", Bold Italic Family",
            &aliases,
        )
        .unwrap();
        assert_eq!(
            desc.family().unwrap().as_str(),
            "sans-serif,Bold Italic Family"
        );
        assert_eq!(desc.style(), Style::Italic);
        assert_eq!(desc.size(), 12800);
        let normal = parse_font("12px Bold Italic Family", &BTreeMap::new()).unwrap();
        assert_eq!(normal.style(), Style::Normal);
        assert_eq!(normal.weight(), Weight::Normal);
        let fallback = parse_font("bold 14px Calibri, Arial, Helvetica", &BTreeMap::new()).unwrap();
        assert_eq!(
            fallback.family().unwrap().as_str(),
            "Calibri, Arial, Helvetica"
        );
    }

    #[test]
    fn rejects_bad_fonts() {
        for font in [
            "12pt serif",
            "12px",
            "-1px serif",
            "0px serif",
            "1..2px serif",
            "1001 12px serif",
            "small-caps 12px serif",
            "1e2px serif",
            "17000px serif",
            "12px serif,",
            "12px \0serif",
        ] {
            assert!(parse_font(font, &BTreeMap::new()).is_err(), "{font:?}");
        }
    }
}
