use std::{collections::BTreeMap, fs, path::Path};

use anyhow::{ensure, Context, Result};
use pango::{prelude::*, AttrFontDesc, AttrList, FontDescription, FontMap, Layout};

use crate::protocol::FontResource;

/// 每份 PDF 独占字体映射和临时资源；不修改进程默认字体或系统字体目录。
pub(crate) struct FontResolver {
    pdf: FontMap,
    system: FontMap,
    embedded: BTreeMap<String, Vec<(u16, String, String)>>,
    directory: tempfile::TempDir,
    bytes: usize,
    count: usize,
    configured: bool,
}

impl FontResolver {
    pub fn new(root: &Path) -> Result<Self> {
        let pdf = pangocairo::FontMap::for_font_type(cairo::FontType::FontTypeFt)
            .context("Cairo/Pango FreeType support is required for PDF text")?;
        let directory = tempfile::Builder::new().prefix("fonts-").tempdir_in(root)?;
        Ok(Self {
            pdf,
            system: pangocairo::FontMap::new(),
            embedded: BTreeMap::new(),
            directory,
            bytes: 0,
            count: 0,
            configured: false,
        })
    }

    fn ensure_configured(&mut self) -> Result<()> {
        if !self.configured {
            #[cfg(target_os = "macos")]
            crate::fontconfig::configure(&self.pdf, self.directory.path())?;
            self.configured = true;
        }
        Ok(())
    }

    pub fn add(&mut self, fonts: &[FontResource]) -> Result<()> {
        if !fonts.is_empty() {
            self.ensure_configured()?;
        }
        for font in fonts {
            self.bytes += font.bytes.len();
            self.count += 1;
            ensure!(
                self.count <= 64 && self.bytes <= 64 * 1024 * 1024,
                "Document font resource limit exceeded"
            );
            let face = ttf_parser::Face::parse(&font.bytes, 0)
                .context("Invalid embedded OpenType font")?;
            let family = [
                ttf_parser::name_id::TYPOGRAPHIC_FAMILY,
                ttf_parser::name_id::FAMILY,
            ]
            .into_iter()
            .find_map(|id| {
                face.names()
                    .into_iter()
                    .filter(|name| name.name_id == id)
                    .find_map(|name| name.to_string())
            })
            .context("Embedded font has no Unicode family name")?;
            ensure!(
                !family.contains([',', '\0']),
                "Unsupported embedded font family name"
            );
            let bindings = self.embedded.entry(font.family.to_lowercase()).or_default();
            ensure!(
                !bindings
                    .iter()
                    .any(|(weight, style, _)| *weight == font.weight && *style == font.style),
                "Duplicate embedded font face"
            );
            if self.count == 1 {
                // 初始化私有 font map；Pango 1.56+ 将新增字体存放在此 map 内。
                self.pdf.list_families();
            }
            let path = self.directory.path().join(format!("{}.otf", self.count));
            fs::write(&path, &font.bytes)?;
            self.pdf
                .add_font_file(&path)
                .context("Cannot load embedded font into PDF renderer")?;
            bindings.push((font.weight, font.style.clone(), family));
        }
        Ok(())
    }

    fn layout(
        map: &FontMap,
        cr: &cairo::Context,
        desc: &FontDescription,
        text: &str,
        rtl: bool,
    ) -> Layout {
        let context = map.create_context();
        pangocairo::functions::update_context(cr, &context);
        context.set_round_glyph_positions(false);
        context.set_base_dir(if rtl {
            pango::Direction::Rtl
        } else {
            pango::Direction::Ltr
        });
        let layout = Layout::new(&context);
        layout.set_auto_dir(false);
        layout.set_single_paragraph_mode(true);
        layout.set_font_description(Some(desc));
        layout.set_text(text);
        layout
    }

    /// 系统负责选择本地 fallback；FreeType 统一输出 glyph、可变字重和 PDF 字符映射。
    /// 按原始 run 范围传递选字，不将整个混排字符串强行替换成一个字体。
    pub fn resolve(
        &mut self,
        cr: &cairo::Context,
        desc: &FontDescription,
        text: &str,
        rtl: bool,
    ) -> Result<Layout> {
        self.ensure_configured()?;
        let mut embedded_desc = desc.clone();
        let families = desc.family().unwrap_or_default();
        let mut has_embedded = false;
        let families = families
            .split(',')
            .map(|family| {
                if let Some(faces) = self.embedded.get(&family.to_lowercase()) {
                    has_embedded = true;
                    let italic = desc.style() != pango::Style::Normal;
                    let weight: i32 = pango::glib::translate::IntoGlib::into_glib(desc.weight());
                    faces
                        .iter()
                        .min_by_key(|(w, style, _)| {
                            ((style == "italic") != italic) as i32 * 10000
                                + (i32::from(*w) - weight).abs()
                        })
                        .unwrap()
                        .2
                        .clone()
                } else {
                    family.to_owned()
                }
            })
            .collect::<Vec<_>>()
            .join(",");
        if has_embedded {
            embedded_desc.set_family(&families);
            return Ok(Self::layout(&self.pdf, cr, &embedded_desc, text, rtl));
        }
        let selection = Self::layout(&self.system, cr, desc, text, rtl);
        let attributes = AttrList::new();
        let mut iter = selection.iter();
        loop {
            if let Some(run) = iter.run_readonly() {
                let item = run.item();
                let actual = item.analysis().font().describe();
                let mut chosen = desc.clone();
                chosen.set_family(actual.family().as_deref().unwrap_or("sans-serif"));
                let mut attr = AttrFontDesc::new(&chosen);
                attr.set_start_index(item.offset() as u32);
                attr.set_end_index((item.offset() + item.length()) as u32);
                attributes.insert(attr);
            }
            if !iter.next_run() {
                break;
            }
        }
        let layout = Self::layout(&self.pdf, cr, desc, text, rtl);
        layout.set_attributes(Some(&attributes));
        Ok(layout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resource(bytes: &[u8]) -> FontResource {
        FontResource {
            family: "Document Alias".into(),
            weight: 400,
            style: "normal".into(),
            bytes: bytes.to_vec(),
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn system_font_selection_includes_macos_font_assets() {
        let root = tempfile::tempdir().unwrap();
        let mut resolver = FontResolver::new(root.path()).unwrap();
        let surface = cairo::ImageSurface::create(cairo::Format::ARgb32, 1, 1).unwrap();
        let cr = cairo::Context::new(&surface).unwrap();
        for (family, sample) in [
            ("PingFang SC", "中文"),
            ("Songti SC", "中文"),
            ("STIX Two Text", "ffi"),
            ("Apple Color Emoji", "👩‍💻"),
        ] {
            if resolver.system.family(family).is_none() {
                continue;
            }
            for prefix in ["", "bold ", "italic ", "650 "] {
                let desc =
                    crate::text::parse_font(&format!("{prefix}12px {family}"), &BTreeMap::new())
                        .unwrap();
                // 系统可列出尚未下载的字体；比较实际选字，而不是假设请求字体可用。
                let system = FontResolver::layout(&resolver.system, &cr, &desc, sample, false);
                let expected = system
                    .iter()
                    .run_readonly()
                    .unwrap()
                    .item()
                    .analysis()
                    .font()
                    .describe();
                let layout = resolver.resolve(&cr, &desc, sample, false).unwrap();
                let actual = layout
                    .iter()
                    .run_readonly()
                    .unwrap()
                    .item()
                    .analysis()
                    .font()
                    .describe();
                assert_eq!(
                    actual.family().unwrap().as_str(),
                    expected.family().unwrap().as_str(),
                    "{prefix}{family}: {sample}"
                );
            }
        }
    }

    #[test]
    fn embedded_fonts_are_isolated_and_cleaned_up() {
        let root = tempfile::tempdir().unwrap();
        let mut first = FontResolver::new(root.path()).unwrap();
        let mut second = FontResolver::new(root.path()).unwrap();
        first
            .add(&[resource(include_bytes!("../tests/fixtures/font-a.ttf"))])
            .unwrap();
        second
            .add(&[resource(include_bytes!("../tests/fixtures/font-b.ttf"))])
            .unwrap();
        let surface = cairo::ImageSurface::create(cairo::Format::ARgb32, 1, 1).unwrap();
        let cr = cairo::Context::new(&surface).unwrap();
        let desc = crate::text::parse_font("10px Document Alias", &BTreeMap::new()).unwrap();
        for _ in 0..2 {
            assert_eq!(
                first.resolve(&cr, &desc, "A中", false).unwrap().size().0,
                10 * pango::SCALE
            );
            assert_eq!(
                second.resolve(&cr, &desc, "A中", false).unwrap().size().0,
                16 * pango::SCALE
            );
        }
        assert!(first.add(&[resource(b"bad font")]).is_err());
        assert!(first
            .add(&[resource(include_bytes!("../tests/fixtures/font-a.ttf"))])
            .is_err());
        drop(first);
        drop(second);
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
}
