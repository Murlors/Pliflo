use std::io::Cursor;

use anyhow::{ensure, Context as _, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use cairo::{
    Context, FillRule, FontOptions, HintMetrics, ImageSurface, LineCap, LineJoin, Matrix, Operator,
    PdfSurface,
};

use crate::{
    protocol::{rgb, Cap, Image, Join, Operation, Recording, Rule, State},
    text::TextRenderer,
};

fn color(cr: &Context, value: &str, alpha: f64) -> Result<()> {
    let [r, g, b] = rgb(value)?;
    cr.set_source_rgba(r, g, b, alpha);
    Ok(())
}

fn stroke(cr: &Context, state: &State) -> Result<()> {
    color(cr, &state.stroke, state.alpha)?;
    cr.set_line_width(state.line_width);
    cr.set_line_cap(match state.line_cap {
        Cap::Butt => LineCap::Butt,
        Cap::Round => LineCap::Round,
        Cap::Square => LineCap::Square,
    });
    cr.set_line_join(match state.line_join {
        Join::Miter => LineJoin::Miter,
        Join::Round => LineJoin::Round,
        Join::Bevel => LineJoin::Bevel,
    });
    cr.set_miter_limit(state.miter_limit);
    cr.set_dash(&state.dash, state.dash_offset);
    cr.stroke_preserve()?;
    Ok(())
}

/// Rect 快捷操作不能破坏 Canvas 当前路径；Cairo 的 save/restore 不保存路径。
fn isolated_path(cr: &Context, draw: impl FnOnce() -> Result<()>) -> Result<()> {
    let old = cr.copy_path()?;
    cr.new_path();
    let result = draw();
    cr.new_path();
    cr.append_path(&old);
    result
}

fn image(cr: &Context, image: &Image, [x, y, w, h]: [f64; 4], alpha: f64) -> Result<()> {
    ensure!(
        image.png.len() <= 128 * 1024 * 1024,
        "Encoded PNG exceeds 128 MiB limit"
    );
    let decoded;
    let png = if let Some(bytes) = &image.bytes {
        bytes.as_slice()
    } else {
        decoded = STANDARD.decode(&image.png).context("Invalid PNG base64")?;
        decoded.as_slice()
    };
    // 解码前检查 IHDR，防止伪造的小尺寸元数据触发巨幅图像分配。
    ensure!(
        png.len() >= 24
            && &png[..8] == b"\x89PNG\r\n\x1a\n"
            && png[8..12] == [0, 0, 0, 13]
            && &png[12..16] == b"IHDR",
        "Invalid PNG header"
    );
    let width = u32::from_be_bytes(png[16..20].try_into()?);
    let height = u32::from_be_bytes(png[20..24].try_into()?);
    ensure!(
        width > 0 && height > 0 && u64::from(width) * u64::from(height) <= 64_000_000,
        "PNG exceeds 64 million pixel limit or is empty"
    );
    ensure!(
        f64::from(width) == image.width && f64::from(height) == image.height,
        "PNG dimensions disagree with recording"
    );
    let surface =
        ImageSurface::create_from_png(&mut Cursor::new(png)).context("Invalid PNG image")?;
    cr.save()?;
    cr.translate(x, y);
    cr.scale(w / image.width, h / image.height);
    cr.set_source_surface(&surface, 0.0, 0.0)?;
    cr.paint_with_alpha(alpha)?;
    cr.restore()?;
    Ok(())
}

pub(crate) fn page(
    surface: &PdfSurface,
    recording: &Recording,
    text: &mut TextRenderer<'_>,
) -> Result<()> {
    recording.validate()?;
    surface.set_size(recording.size.width_pt, recording.size.height_pt)?;
    let cr = Context::new(surface)?;
    let mut options = FontOptions::new()?;
    options.set_hint_metrics(HintMetrics::Off);
    cr.set_font_options(&options);
    let scale = recording.size.width_pt / recording.width;
    for (index, command) in recording.commands.iter().enumerate() {
        let result = (|| -> Result<()> {
            match command.operation {
                Operation::Save => {
                    cr.save()?;
                    return Ok(());
                }
                Operation::Restore => {
                    cr.restore()?;
                    return Ok(());
                }
                _ => {}
            }
            let s = command.state.as_ref().context("Missing state")?;
            let [a, b, c, d, e, f] = s.matrix.map(|v| v * scale);
            cr.set_matrix(Matrix::new(a, b, c, d, e, f));
            match &command.operation {
                Operation::BeginPath => cr.new_path(),
                Operation::ClosePath => cr.close_path(),
                Operation::Rect([x, y, w, h]) => cr.rectangle(*x, *y, *w, *h),
                Operation::MoveTo([x, y]) => cr.move_to(*x, *y),
                Operation::LineTo([x, y]) => cr.line_to(*x, *y),
                Operation::Clip(rule) | Operation::Fill(rule) => {
                    cr.set_fill_rule(match rule {
                        Rule::Evenodd => FillRule::EvenOdd,
                        Rule::Nonzero => FillRule::Winding,
                    });
                    if matches!(command.operation, Operation::Clip(_)) {
                        cr.clip_preserve();
                    } else {
                        color(&cr, &s.fill, s.alpha)?;
                        cr.fill_preserve()?;
                    }
                }
                Operation::Stroke => stroke(&cr, s)?,
                Operation::FillRect([x, y, w, h]) => isolated_path(&cr, || {
                    color(&cr, &s.fill, s.alpha)?;
                    cr.rectangle(*x, *y, *w, *h);
                    cr.fill()?;
                    Ok(())
                })?,
                Operation::StrokeRect([x, y, w, h]) => isolated_path(&cr, || {
                    cr.rectangle(*x, *y, *w, *h);
                    stroke(&cr, s)
                })?,
                Operation::ClearRect([x, y, w, h]) => isolated_path(&cr, || {
                    cr.save()?;
                    cr.set_operator(Operator::Clear);
                    cr.rectangle(*x, *y, *w, *h);
                    cr.fill()?;
                    cr.restore()?;
                    Ok(())
                })?,
                Operation::FillText(value, x, y) => {
                    color(&cr, &s.fill, s.alpha)?;
                    text.draw(&cr, s, value, *x, *y)?;
                }
                Operation::DrawImage(value, args) => image(&cr, value, *args, s.alpha)?,
                Operation::Save | Operation::Restore => unreachable!(),
            }
            cr.status()?;
            Ok(())
        })();
        result.with_context(|| format!("command {index}"))?;
    }
    cr.show_page()?;
    surface.status()?;
    Ok(())
}
