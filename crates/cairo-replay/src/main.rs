use std::{env, fs::File, io::BufReader, path::PathBuf, process::ExitCode};

use anyhow::{Context, Result};
use canvas_cairo_replay::{render_file, RenderOptions};

fn run(input: PathBuf, output: PathBuf) -> Result<()> {
    let mut options = RenderOptions {
        font_diagnostics: env::var_os("PLIFLO_FONT_DIAGNOSTICS").is_some(),
        ..Default::default()
    };
    if let Some(path) = env::var_os("PLIFLO_FONT_ALIASES") {
        let file = File::open(path).context("Cannot open font aliases")?;
        options.font_aliases = serde_json::from_reader(BufReader::new(file))
            .context("Font aliases must be a JSON object of strings")?;
    }
    let report = render_file(input, output, &options)?;
    for font in report.fonts {
        // 控制字符转义，避免字体名注入诊断行；永不记录用户正文。
        let safe = |s: &str| {
            s.chars()
                .flat_map(|c| {
                    if c.is_control() {
                        c.escape_default().collect::<Vec<_>>()
                    } else {
                        vec![c]
                    }
                })
                .collect::<String>()
        };
        eprintln!("FONT {} => {}", safe(&font.requested), safe(&font.actual));
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() != 2 {
        eprintln!("Usage: canvas-cairo-pdf commands.json output.pdf");
        return ExitCode::from(2);
    }
    let output = PathBuf::from(&args[1]);
    if !output
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("pdf"))
        || output.symlink_metadata().is_ok()
    {
        eprintln!("Output must be a new PDF path");
        return ExitCode::from(2);
    }
    match run(PathBuf::from(&args[0]), output) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}
