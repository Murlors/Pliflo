use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Command};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfInfo {
    path: String,
    name: String,
    size_bytes: u64,
    pages: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrinterInfo {
    name: String,
    is_default: bool,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrinterOption {
    value: String,
    label: String,
    is_default: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct PrinterCapabilities {
    media: Vec<PrinterOption>,
    trays: Vec<PrinterOption>,
    qualities: Vec<PrinterOption>,
    supports_duplex: bool,
    supports_color: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintSettings {
    copies: u32,
    duplex: String,
    color: String,
    orientation: String,
    media: String,
    scale: String,
    page_range: String,
    pages_per_sheet: u8,
    reverse: bool,
    page_set: String,
    tray: String,
    quality: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmitResult {
    job_id: String,
    raw: String,
}

fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("Could not run {program}: {error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() { format!("{program} exited with {}", output.status) } else { error });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn inspect_pdfs(paths: Vec<String>) -> Result<Vec<PdfInfo>, String> {
    paths
        .into_iter()
        .map(|path| {
            let file_path = Path::new(&path);
            if file_path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("pdf")) != Some(true) {
                return Err(format!("Not a PDF: {path}"));
            }
            let metadata = fs::metadata(file_path).map_err(|error| format!("Cannot read {path}: {error}"))?;
            let pages = lopdf::Document::load(file_path).ok().map(|document| document.get_pages().len());
            let name = file_path.file_name().and_then(|name| name.to_str()).unwrap_or("Document.pdf").to_string();
            Ok(PdfInfo { path, name, size_bytes: metadata.len(), pages })
        })
        .collect()
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    let listing = command_output("lpstat", &["-p", "-d"])?;
    let default_name = listing.lines().find_map(|line| line.strip_prefix("system default destination: ")).unwrap_or_default().trim().to_string();
    let printers = listing.lines().filter(|line| line.starts_with("printer ")).filter_map(|line| {
        let name = line.split_whitespace().nth(1)?;
        Some(PrinterInfo {
            name: name.to_string(),
            is_default: name == default_name,
            state: if line.contains("disabled") { "Unavailable" } else { "Ready" }.to_string(),
        })
    }).collect();
    Ok(printers)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    Err("Printer discovery is implemented for macOS in this release.".to_string())
}

#[cfg(target_os = "macos")]
fn parse_printer_option(line: &str) -> Option<(String, Vec<PrinterOption>)> {
    let (heading, values) = line.split_once(':')?;
    let key = heading.split('/').next()?.trim().to_string();
    let options = values
        .split_whitespace()
        .filter_map(|entry| {
            let is_default = entry.starts_with('*');
            let raw = entry.trim_start_matches('*');
            let (value, label) = raw.split_once('/').unwrap_or((raw, raw));
            (!value.is_empty()).then(|| PrinterOption {
                value: value.to_string(),
                label: label.replace('_', " "),
                is_default,
            })
        })
        .collect();
    Some((key, options))
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_printer_capabilities(printer: String) -> Result<PrinterCapabilities, String> {
    let output = command_output("lpoptions", &["-p", printer.as_str(), "-l"])?;
    let mut capabilities = PrinterCapabilities::default();

    for line in output.lines() {
        let Some((key, options)) = parse_printer_option(line) else { continue };
        match key.as_str() {
            "PageSize" | "media" => capabilities.media = options,
            "InputSlot" | "MediaSource" => capabilities.trays = options,
            "cupsPrintQuality" | "print-quality" => capabilities.qualities = options,
            "Duplex" => capabilities.supports_duplex = options.len() > 1,
            "ColorModel" | "ColorMode" | "print-color-mode" => {
                capabilities.supports_color = options.len() > 1
            }
            _ => {}
        }
    }

    Ok(capabilities)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn get_printer_capabilities(_printer: String) -> Result<PrinterCapabilities, String> {
    Ok(PrinterCapabilities::default())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn submit_print_job(path: String, printer: String, settings: PrintSettings) -> Result<SubmitResult, String> {
    if !Path::new(&path).is_file() { return Err("The selected PDF no longer exists.".to_string()); }
    if !settings.page_range.chars().all(|char| char.is_ascii_digit() || matches!(char, ',' | '-' | ' ')) {
        return Err("Page range contains unsupported characters.".to_string());
    }
    let copies = settings.copies.clamp(1, 99).to_string();
    let duplex = match settings.duplex.as_str() { "long" => "Duplex=DuplexNoTumble", "short" => "Duplex=DuplexTumble", _ => "Duplex=None" };
    let color = match settings.color.as_str() { "grayscale" => Some("ColorModel=Gray"), "color" => Some("ColorModel=RGB"), _ => None };
    let orientation = match settings.orientation.as_str() { "portrait" => Some("orientation-requested=3"), "landscape" => Some("orientation-requested=4"), _ => None };
    let scale = if settings.scale == "actual" { "scaling=100" } else { "fit-to-page" };
    let media = format!("media={}", settings.media);
    let page_range = (!settings.page_range.trim().is_empty()).then(|| format!("page-ranges={}", settings.page_range.trim().replace(' ', "")));
    let pages_per_sheet = format!("number-up={}", match settings.pages_per_sheet { 2 | 4 | 6 | 9 | 16 => settings.pages_per_sheet, _ => 1 });
    let page_set = match settings.page_set.as_str() { "odd" => Some("page-set=odd"), "even" => Some("page-set=even"), _ => None };
    let tray = (!settings.tray.is_empty()).then(|| format!("InputSlot={}", settings.tray));
    let quality = match settings.quality.as_str() { "draft" => Some("print-quality=3"), "normal" => Some("print-quality=4"), "high" => Some("print-quality=5"), _ => None };
    let mut args = vec!["-d", printer.as_str(), "-n", copies.as_str(), "-o", duplex, "-o", scale, "-o", media.as_str()];
    if let Some(value) = color { args.extend(["-o", value]); }
    if let Some(value) = orientation { args.extend(["-o", value]); }
    if let Some(value) = page_range.as_deref() { args.extend(["-o", value]); }
    args.extend(["-o", pages_per_sheet.as_str()]);
    if settings.reverse { args.extend(["-o", "outputorder=reverse"]); }
    if let Some(value) = page_set { args.extend(["-o", value]); }
    if let Some(value) = tray.as_deref() { args.extend(["-o", value]); }
    if let Some(value) = quality { args.extend(["-o", value]); }
    args.push(path.as_str());
    let raw = command_output("lp", &args)?;
    let job_id = raw.split_whitespace().find(|part| part.contains('-') && part.chars().last().is_some_and(|char| char.is_ascii_digit())).unwrap_or_default().trim_end_matches('.').to_string();
    if job_id.is_empty() { return Err(format!("macOS accepted the command but returned an unrecognized job id: {raw}")); }
    Ok(SubmitResult { job_id, raw })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn submit_print_job(_path: String, _printer: String, _settings: PrintSettings) -> Result<SubmitResult, String> {
    Err("Printing is implemented for macOS in this release.".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_print_job_state(job_id: String) -> Result<String, String> {
    let pending = Command::new("lpstat").args(["-W", "not-completed", "-o", job_id.as_str()]).output().map_err(|error| error.to_string())?;
    if pending.status.success() && !String::from_utf8_lossy(&pending.stdout).trim().is_empty() { return Ok("pending".to_string()); }
    let completed = Command::new("lpstat").args(["-W", "completed", "-o", job_id.as_str()]).output().map_err(|error| error.to_string())?;
    if completed.status.success() && !String::from_utf8_lossy(&completed.stdout).trim().is_empty() { return Ok("completed".to_string()); }
    Ok("unknown".to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn get_print_job_state(_job_id: String) -> Result<String, String> { Ok("unknown".to_string()) }

#[cfg(target_os = "macos")]
#[tauri::command]
fn cancel_print_job(job_id: String) -> Result<(), String> { command_output("cancel", &[job_id.as_str()]).map(|_| ()) }

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn cancel_print_job(_job_id: String) -> Result<(), String> { Err("Job cancellation is implemented for macOS in this release.".to_string()) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![inspect_pdfs, list_printers, get_printer_capabilities, submit_print_job, get_print_job_state, cancel_print_job])
        .run(tauri::generate_context!())
        .expect("error while running Pliflo");
}
