//! Canvas recording v1 → Cairo/Pango PDF。无需 Node、Objective-C 或 GUI 运行时。
//! 所有文件输出均使用 create_new；失败时仅清理本次创建的 PDF。
mod binary;
pub mod protocol;
pub use binary::decode_recording;
#[cfg(target_os = "macos")]
mod fontconfig;
mod fonts;
mod render;
mod text;

use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::BufReader,
    path::Path,
};

use anyhow::{ensure, Context, Result};
use cairo::PdfSurface;
use protocol::{Input, Page};

/// 库调用显式传选项，不读取或修改进程环境。CLI 负责兼容 PLIFLO_* 变量。
#[derive(Debug, Default, Clone)]
pub struct RenderOptions {
    pub font_aliases: BTreeMap<String, String>,
    pub font_diagnostics: bool,
}

impl RenderOptions {
    pub fn validate(&self) -> Result<()> {
        for (key, value) in &self.font_aliases {
            ensure!(
                !key.trim().is_empty()
                    && !value.trim().is_empty()
                    && !key.contains('\0')
                    && !value.contains('\0'),
                "Invalid font alias"
            );
        }
        Ok(())
    }
}

/// 不包含正文；按 requested/actual 去重，保持 fallback 可观测。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct FontDiagnostic {
    pub requested: String,
    pub actual: String,
}

#[derive(Debug)]
pub struct RenderReport {
    pub pages: usize,
    pub fonts: Vec<FontDiagnostic>,
}

/// 从 JSON 文件渲染单页或清单；路径项逐页读取，避免同时持有全部页命令。
pub fn render_file(
    input: impl AsRef<Path>,
    output: impl AsRef<Path>,
    options: &RenderOptions,
) -> Result<RenderReport> {
    let input = input.as_ref();
    let file =
        File::open(input).with_context(|| format!("Cannot open input {}", input.display()))?;
    let input: Input = serde_json::from_reader(BufReader::new(file))
        .context("Invalid recording or manifest JSON")?;
    render_input(input, output, options)
}

/// Rust 嵌入入口：接受已解码的录制或清单，并再次验证所有数值和协议约束。
/// 输出必须是不存在的 .pdf 路径（扩展名大小写不限）。现存文件、目录及符号链接均不覆盖。
pub fn render_input(
    input: Input,
    output: impl AsRef<Path>,
    options: &RenderOptions,
) -> Result<RenderReport> {
    render_input_cancellable(input, output, options, || false)
}

/// 宿主取消在每页边界检查；失败时遵循相同的部分输出清理规则。
pub fn render_input_cancellable(
    input: Input,
    output: impl AsRef<Path>,
    options: &RenderOptions,
    cancelled: impl Fn() -> bool,
) -> Result<RenderReport> {
    options.validate()?;
    let output = output.as_ref();
    ensure!(
        output
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("pdf")),
        "Output must be a new PDF path"
    );
    let pages = match input {
        Input::Recording(page) => vec![Page::Inline(page)],
        Input::Manifest(manifest) => manifest.pages,
    };
    ensure!(!pages.is_empty(), "Empty page manifest");
    // 不做 exists→create 检查，避免 TOCTOU 覆盖；Cairo 写入已经独占创建的句柄。
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .with_context(|| format!("Output must be a new PDF path: {}", output.display()))?;
    let result = render_pages(
        pages,
        file,
        output
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new(".")),
        options,
        cancelled,
    );
    if let Err(error) = result {
        // render_pages 的 Cairo 和文件句柄已释放，Windows 上也可以删除。
        if let Err(cleanup) = fs::remove_file(output) {
            return Err(error.context(format!(
                "Could not remove partial PDF {}: {cleanup}",
                output.display()
            )));
        }
        return Err(error);
    }
    result
}

fn render_pages(
    pages: Vec<Page>,
    file: File,
    root: &Path,
    options: &RenderOptions,
    cancelled: impl Fn() -> bool,
) -> Result<RenderReport> {
    let mut text = text::TextRenderer {
        aliases: &options.font_aliases,
        diagnostics: options.font_diagnostics,
        seen: Default::default(),
        fonts: fonts::FontResolver::new(root)?,
    };
    // 首次 show_page 之前设置真实尺寸，不产生占位页。
    let surface = PdfSurface::for_stream(1.0, 1.0, file)?;
    let count = pages.len();
    for (index, page) in pages.into_iter().enumerate() {
        ensure!(!cancelled(), "Rendering cancelled");
        let result = (|| -> Result<()> {
            let recording = match page {
                Page::Inline(recording) => recording,
                Page::Path(path) => {
                    let bytes = fs::read(&path)
                        .with_context(|| format!("Cannot open page {}", path.display()))?;
                    decode_recording(&bytes)?
                }
            };
            recording.validate()?;
            text.fonts.add(&recording.fonts)?;
            render::page(&surface, &recording, &mut text)
        })();
        result.with_context(|| format!("page {index}"))?;
    }
    let stream = surface
        .finish_output_stream()
        .map_err(std::io::Error::from)?;
    surface.status()?;
    ensure!(!cancelled(), "Rendering cancelled");
    let file = stream
        .downcast::<File>()
        .map_err(|_| anyhow::anyhow!("Unexpected PDF output stream"))?;
    file.sync_all().context("Cannot flush PDF output")?;
    Ok(RenderReport {
        pages: count,
        fonts: text.seen.into_iter().collect(),
    })
}
