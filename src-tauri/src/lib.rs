use base64::Engine;
use lopdf::{dictionary, Dictionary, Document, Object, Stream};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static ARTIFACT_COUNTER: AtomicU64 = AtomicU64::new(1);

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    path: String,
    name: String,
    size_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderedPageInput {
    data_url: String,
    pixel_width: u32,
    pixel_height: u32,
    page_width_pt: f32,
    page_height_pt: f32,
}

fn rendered_root() -> PathBuf {
    std::env::temp_dir().join("pliflo-rendered")
}

fn create_rendered_dir() -> Result<PathBuf, String> {
    let root = rendered_root();
    fs::create_dir_all(&root).map_err(|error| format!("Cannot create render cache: {error}"))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = ARTIFACT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = root.join(format!("{}-{nanos}-{sequence}", std::process::id()));
    fs::create_dir(&dir).map_err(|error| format!("Cannot create render session: {error}"))?;
    Ok(dir)
}

fn decode_canvas_jpeg(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .strip_prefix("data:image/jpeg;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpg;base64,"))
        .ok_or_else(|| "Rendered page must be a JPEG data URL.".to_string())?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Cannot decode rendered page: {error}"))
}

fn add_jpeg_page(
    doc: &mut Document,
    pages_id: lopdf::ObjectId,
    input: RenderedPageInput,
) -> Result<lopdf::ObjectId, String> {
    if input.pixel_width == 0
        || input.pixel_height == 0
        || input.page_width_pt <= 0.0
        || input.page_height_pt <= 0.0
    {
        return Err("Rendered page dimensions are invalid.".to_string());
    }
    let jpeg = decode_canvas_jpeg(&input.data_url)?;
    let image_id = doc.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => input.pixel_width as i64,
            "Height" => input.pixel_height as i64,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
            "Filter" => "DCTDecode",
        },
        jpeg,
    ));
    let content = format!(
        "q\n{} 0 0 {} 0 0 cm\n/Im0 Do\nQ\n",
        input.page_width_pt, input.page_height_pt
    );
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
    let resources_id = doc.add_object(dictionary! {
        "XObject" => dictionary! { "Im0" => image_id },
    });
    Ok(doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "Resources" => resources_id,
        "MediaBox" => vec![
            0.into(),
            0.into(),
            Object::Real(input.page_width_pt),
            Object::Real(input.page_height_pt),
        ],
        "Contents" => content_id,
    }))
}

#[tauri::command]
fn inspect_files(paths: Vec<String>) -> Result<Vec<FileInfo>, String> {
    paths
        .into_iter()
        .map(|path| {
            let file_path = Path::new(&path);
            let metadata = fs::metadata(file_path)
                .map_err(|error| format!("Cannot read {path}: {error}"))?;
            if !metadata.is_file() {
                return Err(format!("Not a file: {path}"));
            }
            let name = file_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Document")
                .to_string();
            Ok(FileInfo {
                path,
                name,
                size_bytes: metadata.len(),
            })
        })
        .collect()
}

#[tauri::command]
fn read_local_file(path: String) -> Result<tauri::ipc::Response, String> {
    let file_path = Path::new(&path);
    let metadata = fs::metadata(file_path).map_err(|error| format!("Cannot read {path}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Not a file: {path}"));
    }
    let bytes = fs::read(file_path).map_err(|error| format!("Cannot read {path}: {error}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn create_printable_pdf(pages: Vec<RenderedPageInput>) -> Result<String, String> {
    if pages.is_empty() {
        return Err("The document did not produce any printable pages.".to_string());
    }
    let dir = create_rendered_dir()?;
    let output = dir.join("printable.pdf");
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut page_ids = Vec::with_capacity(pages.len());
    for page in pages {
        page_ids.push(add_jpeg_page(&mut doc, pages_id, page)?);
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => page_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => page_ids.len() as i64,
        }),
    );
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);
    doc.compress();
    doc.save(&output)
        .map_err(|error| format!("Cannot save printable PDF: {error}"))?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
fn cleanup_printable_pdf(path: String) -> Result<(), String> {
    let root = rendered_root();
    let candidate = PathBuf::from(path);
    let canonical_root = root.canonicalize().unwrap_or(root);
    let Some(parent) = candidate.parent() else { return Ok(()); };
    let canonical_parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
    if canonical_parent.starts_with(&canonical_root) {
        let _ = fs::remove_dir_all(canonical_parent);
    }
    Ok(())
}

#[tauri::command]
fn cleanup_stale_printable_pdfs() -> Result<(), String> {
    let root = rendered_root();
    let Ok(entries) = fs::read_dir(&root) else { return Ok(()); };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(48 * 60 * 60))
        .unwrap_or(UNIX_EPOCH);
    for entry in entries.flatten() {
        let path = entry.path();
        let modified = entry.metadata().and_then(|meta| meta.modified()).unwrap_or(SystemTime::now());
        if modified < cutoff {
            let _ = fs::remove_dir_all(path);
        }
    }
    Ok(())
}

fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("Could not run {program}: {error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            error
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_print_job_id(raw: &str) -> Option<String> {
    raw.split(|char: char| {
        !char.is_ascii_alphanumeric() && char != '-' && char != '_' && char != '.'
    })
    .find(|part| {
        part.rsplit_once('-').is_some_and(|(prefix, suffix)| {
            !prefix.is_empty()
                && !suffix.is_empty()
                && suffix.chars().all(|char| char.is_ascii_digit())
        })
    })
    .map(ToOwned::to_owned)
}

fn print_job_destination(job_id: &str) -> Option<&str> {
    let (destination, sequence) = job_id.rsplit_once('-')?;
    (!destination.is_empty()
        && !sequence.is_empty()
        && sequence.chars().all(|char| char.is_ascii_digit()))
    .then_some(destination)
}

fn lpstat_contains_job(raw: &str, job_id: &str) -> bool {
    raw.lines()
        .any(|line| line.split_whitespace().next() == Some(job_id))
}

fn parse_default_destination<'a>(raw: &str, destinations: &'a [&str]) -> Option<&'a str> {
    let output = raw.trim();
    let separator = output
        .char_indices()
        .filter(|(_, character)| matches!(character, ':' | '：'))
        .map(|(index, character)| index + character.len_utf8())
        .next_back()?;
    let candidate = output[separator..].trim();
    destinations
        .iter()
        .copied()
        .find(|destination| *destination == candidate)
}

fn supports_duplex(options: &[PrinterOption]) -> bool {
    options.iter().any(|option| {
        let value = option.value.to_ascii_lowercase();
        value.contains("duplex") || value.starts_with("two-sided") || value.starts_with("two_sided")
    })
}

fn supports_color(options: &[PrinterOption]) -> bool {
    options.iter().any(|option| {
        let value = option.value.to_ascii_lowercase();
        value.contains("color") || value.contains("rgb") || value.contains("cmy")
    })
}

#[cfg(target_os = "macos")]
fn parse_printer_options(output: &str) -> Vec<(String, Vec<PrinterOption>)> {
    output.lines().filter_map(parse_printer_option).collect()
}

fn find_printer_option<'a>(
    groups: &'a [(String, Vec<PrinterOption>)],
    keys: &[&str],
) -> Option<(&'a str, &'a [PrinterOption])> {
    groups.iter().find_map(|(key, options)| {
        keys.iter()
            .any(|candidate| key.eq_ignore_ascii_case(candidate))
            .then_some((key.as_str(), options.as_slice()))
    })
}

fn find_option_value<'a>(options: &'a [PrinterOption], candidates: &[&str]) -> Option<&'a str> {
    options.iter().find_map(|option| {
        candidates
            .iter()
            .any(|candidate| option.value.eq_ignore_ascii_case(candidate))
            .then_some(option.value.as_str())
    })
}

fn printer_assignment(key: &str, value: &str) -> String {
    format!("{key}={value}")
}

fn normalize_page_range(raw: &str) -> Result<Option<String>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let mut normalized = Vec::new();
    for part in trimmed.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err("Page range contains an empty segment.".to_string());
        }

        if let Some((start, end)) = part.split_once('-') {
            if end.contains('-') {
                return Err("Page range contains an invalid interval.".to_string());
            }
            let start = start
                .trim()
                .parse::<u32>()
                .map_err(|_| "Page range must use page numbers such as 1-3,5.".to_string())?;
            let end = end
                .trim()
                .parse::<u32>()
                .map_err(|_| "Page range must use page numbers such as 1-3,5.".to_string())?;
            if start == 0 || end == 0 || start > end {
                return Err("Page range must contain positive, ascending page numbers.".to_string());
            }
            normalized.push(format!("{start}-{end}"));
        } else {
            let page = part
                .parse::<u32>()
                .map_err(|_| "Page range must use page numbers such as 1-3,5.".to_string())?;
            if page == 0 {
                return Err("Page numbers start at 1.".to_string());
            }
            normalized.push(page.to_string());
        }
    }

    Ok(Some(normalized.join(",")))
}

#[tauri::command]
fn inspect_pdfs(paths: Vec<String>) -> Result<Vec<PdfInfo>, String> {
    paths
        .into_iter()
        .map(|path| {
            let file_path = Path::new(&path);
            if file_path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("pdf"))
                != Some(true)
            {
                return Err(format!("Not a PDF: {path}"));
            }
            let metadata =
                fs::metadata(file_path).map_err(|error| format!("Cannot read {path}: {error}"))?;
            let pages = lopdf::Document::load(file_path)
                .ok()
                .map(|document| document.get_pages().len());
            let name = file_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Document.pdf")
                .to_string();
            Ok(PdfInfo {
                path,
                name,
                size_bytes: metadata.len(),
                pages,
            })
        })
        .collect()
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    // `lpstat -p/-d` localizes its prose, so parsing English prefixes breaks on
    // non-English macOS installations. `-e` emits one destination name per line.
    let destinations = command_output("lpstat", &["-e"])?;
    let default_listing = command_output("lpstat", &["-d"]).unwrap_or_default();
    let names: Vec<&str> = destinations
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect();
    let default_destination = parse_default_destination(&default_listing, &names);

    Ok(names
        .iter()
        .copied()
        .map(|name| PrinterInfo {
            name: name.to_string(),
            is_default: default_destination == Some(name),
            // `lpstat -e` confirms a configured destination, not live device readiness.
            state: "detected".to_string(),
        })
        .collect())
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
    let raw_tokens: Vec<&str> = values.split_whitespace().collect();
    let has_labeled_choices = raw_tokens
        .iter()
        .any(|token| token.trim_start_matches('*').contains('/'));

    if !has_labeled_choices {
        let options = raw_tokens
            .into_iter()
            .filter_map(|token| {
                let is_default = token.starts_with('*');
                let value = token.trim_start_matches('*');
                (!value.is_empty()).then(|| PrinterOption {
                    value: value.to_string(),
                    label: value.replace('_', " "),
                    is_default,
                })
            })
            .collect::<Vec<_>>();
        return (!options.is_empty()).then_some((key, options));
    }

    let mut options = Vec::new();
    let mut current: Option<PrinterOption> = None;

    for token in raw_tokens {
        let starts_choice = token.trim_start_matches('*').contains('/');
        if starts_choice {
            if let Some(option) = current.take() {
                options.push(option);
            }
            let is_default = token.starts_with('*');
            let raw = token.trim_start_matches('*');
            let (value, label) = raw.split_once('/')?;
            if !value.is_empty() {
                current = Some(PrinterOption {
                    value: value.to_string(),
                    label: label.replace('_', " "),
                    is_default,
                });
            }
        } else if let Some(option) = current.as_mut() {
            if !option.label.is_empty() {
                option.label.push(' ');
            }
            option.label.push_str(&token.replace('_', " "));
        }
    }
    if let Some(option) = current {
        options.push(option);
    }

    if options.is_empty() {
        return None;
    }
    Some((key, options))
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_printer_capabilities(printer: String) -> Result<PrinterCapabilities, String> {
    let output = command_output("lpoptions", &["-p", printer.as_str(), "-l"])?;
    let mut capabilities = PrinterCapabilities::default();

    for (key, options) in parse_printer_options(&output) {
        if key.eq_ignore_ascii_case("PageSize") || key.eq_ignore_ascii_case("media") {
            capabilities.media = options;
        } else if key.eq_ignore_ascii_case("InputSlot") || key.eq_ignore_ascii_case("MediaSource") {
            capabilities.trays = options;
        } else if key.eq_ignore_ascii_case("cupsPrintQuality")
            || key.eq_ignore_ascii_case("print-quality")
        {
            capabilities.qualities = options;
        } else if key.eq_ignore_ascii_case("Duplex")
            || key.eq_ignore_ascii_case("sides")
            || key.eq_ignore_ascii_case("print-sides")
        {
            capabilities.supports_duplex = supports_duplex(&options);
        } else if key.eq_ignore_ascii_case("ColorModel")
            || key.eq_ignore_ascii_case("ColorMode")
            || key.eq_ignore_ascii_case("print-color-mode")
        {
            capabilities.supports_color = supports_color(&options);
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
fn submit_print_job(
    path: String,
    printer: String,
    settings: PrintSettings,
) -> Result<SubmitResult, String> {
    if !Path::new(&path).is_file() {
        return Err("The selected PDF no longer exists.".to_string());
    }
    let page_range =
        normalize_page_range(&settings.page_range)?.map(|value| format!("page-ranges={value}"));
    // If capability discovery fails, stop before submission instead of guessing driver options.
    let driver_options = parse_printer_options(&command_output(
        "lpoptions",
        &["-p", printer.as_str(), "-l"],
    )?);
    let copies = settings.copies.clamp(1, 99).to_string();
    let duplex = if let Some((key, options)) =
        find_printer_option(&driver_options, &["Duplex", "sides", "print-sides"])
    {
        let candidates = match settings.duplex.as_str() {
            "long" => &["DuplexNoTumble", "two-sided-long-edge"][..],
            "short" => &["DuplexTumble", "two-sided-short-edge"][..],
            _ => &["None", "one-sided"][..],
        };
        let value = find_option_value(options, candidates)
            .ok_or_else(|| format!("The selected duplex mode is not supported by {printer}."))?;
        printer_assignment(key, value)
    } else {
        match settings.duplex.as_str() {
            "long" => "sides=two-sided-long-edge".to_string(),
            "short" => "sides=two-sided-short-edge".to_string(),
            _ => "sides=one-sided".to_string(),
        }
    };
    let color = match settings.color.as_str() {
        "grayscale" | "color" => {
            if let Some((key, options)) = find_printer_option(
                &driver_options,
                &["ColorModel", "ColorMode", "print-color-mode"],
            ) {
                let candidates = if settings.color == "grayscale" {
                    &["Gray", "Grayscale", "Monochrome", "Mono", "Black"][..]
                } else {
                    &["RGB", "Color", "CMYK"][..]
                };
                let value = find_option_value(options, candidates).ok_or_else(|| {
                    format!("The selected color mode is not supported by {printer}.")
                })?;
                Some(printer_assignment(key, value))
            } else if settings.color == "grayscale" {
                Some("print-color-mode=monochrome".to_string())
            } else {
                Some("print-color-mode=color".to_string())
            }
        }
        _ => None,
    };
    let orientation = match settings.orientation.as_str() {
        "portrait" => Some("orientation-requested=3"),
        "landscape" => Some("orientation-requested=4"),
        _ => None,
    };
    let scale = if settings.scale == "actual" {
        "scaling=100"
    } else {
        "fit-to-page"
    };
    let media = if let Some((key, options)) =
        find_printer_option(&driver_options, &["PageSize", "media"])
    {
        let value = find_option_value(options, &[settings.media.as_str()])
            .ok_or_else(|| format!("The selected paper size is not supported by {printer}."))?;
        printer_assignment(key, value)
    } else {
        format!("media={}", settings.media)
    };
    let pages_per_sheet = format!(
        "number-up={}",
        match settings.pages_per_sheet {
            2 | 4 | 6 | 9 | 16 => settings.pages_per_sheet,
            _ => 1,
        }
    );
    let page_set = match settings.page_set.as_str() {
        "odd" => Some("page-set=odd"),
        "even" => Some("page-set=even"),
        _ => None,
    };
    let tray = if settings.tray.is_empty() {
        None
    } else if let Some((key, options)) =
        find_printer_option(&driver_options, &["InputSlot", "MediaSource"])
    {
        let value = find_option_value(options, &[settings.tray.as_str()])
            .ok_or_else(|| format!("The selected paper source is not supported by {printer}."))?;
        Some(printer_assignment(key, value))
    } else {
        Some(format!("InputSlot={}", settings.tray))
    };
    let quality = match settings.quality.as_str() {
        "draft" | "normal" | "high" => {
            if let Some((key, options)) =
                find_printer_option(&driver_options, &["cupsPrintQuality", "print-quality"])
            {
                let candidates = match settings.quality.as_str() {
                    "draft" => &["Draft", "3"][..],
                    "high" => &["High", "Best", "5"][..],
                    _ => &["Normal", "4"][..],
                };
                let value = find_option_value(options, candidates).ok_or_else(|| {
                    format!("The selected print quality is not supported by {printer}.")
                })?;
                Some(printer_assignment(key, value))
            } else {
                Some(match settings.quality.as_str() {
                    "draft" => "print-quality=3".to_string(),
                    "high" => "print-quality=5".to_string(),
                    _ => "print-quality=4".to_string(),
                })
            }
        }
        _ => None,
    };
    let mut args = vec![
        "-d",
        printer.as_str(),
        "-n",
        copies.as_str(),
        "-o",
        duplex.as_str(),
        "-o",
        scale,
        "-o",
        media.as_str(),
    ];
    if let Some(value) = color.as_deref() {
        args.extend(["-o", value]);
    }
    if let Some(value) = orientation {
        args.extend(["-o", value]);
    }
    if let Some(value) = page_range.as_deref() {
        args.extend(["-o", value]);
    }
    args.extend(["-o", pages_per_sheet.as_str()]);
    if settings.reverse {
        args.extend(["-o", "outputorder=reverse"]);
    }
    if let Some(value) = page_set {
        args.extend(["-o", value]);
    }
    if let Some(value) = tray.as_deref() {
        args.extend(["-o", value]);
    }
    if let Some(value) = quality.as_deref() {
        args.extend(["-o", value]);
    }
    args.push(path.as_str());
    let raw = command_output("lp", &args)?;
    let job_id = parse_print_job_id(&raw).ok_or_else(|| {
        format!("macOS accepted the print job but returned an unrecognized job id: {raw}")
    })?;
    Ok(SubmitResult { job_id, raw })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn submit_print_job(
    _path: String,
    _printer: String,
    _settings: PrintSettings,
) -> Result<SubmitResult, String> {
    Err("Printing is implemented for macOS in this release.".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_print_job_state(job_id: String) -> Result<String, String> {
    let destination = print_job_destination(&job_id)
        .ok_or_else(|| format!("Unrecognized print job id: {job_id}"))?;
    let pending = command_output("lpstat", &["-W", "not-completed", "-o", destination])?;
    if lpstat_contains_job(&pending, &job_id) {
        return Ok("pending".to_string());
    }
    let completed = command_output("lpstat", &["-W", "completed", "-o", destination])?;
    if lpstat_contains_job(&completed, &job_id) {
        return Ok("completed".to_string());
    }
    Ok("unknown".to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn get_print_job_state(_job_id: String) -> Result<String, String> {
    Ok("unknown".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn cancel_print_job(job_id: String) -> Result<(), String> {
    print_job_destination(&job_id).ok_or_else(|| format!("Unrecognized print job id: {job_id}"))?;
    command_output("cancel", &[job_id.as_str()]).map(|_| ())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn cancel_print_job(_job_id: String) -> Result<(), String> {
    Err("Job cancellation is implemented for macOS in this release.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        lpstat_contains_job, normalize_page_range, parse_default_destination, parse_print_job_id,
        parse_printer_option, print_job_destination, supports_color, supports_duplex,
        PrinterOption,
    };

    fn option(value: &str) -> PrinterOption {
        PrinterOption {
            value: value.to_string(),
            label: value.to_string(),
            is_default: false,
        }
    }

    #[test]
    fn parses_localized_lp_job_id() {
        let raw = "请求标识符是 HP_Color_LaserJet_MFP_E78523__ABEB24_-68（1 个文件）";
        assert_eq!(
            parse_print_job_id(raw).as_deref(),
            Some("HP_Color_LaserJet_MFP_E78523__ABEB24_-68")
        );
    }

    #[test]
    fn parses_english_lp_job_id() {
        let raw = "request id is Office.Printer-42 (1 file(s))";
        assert_eq!(
            parse_print_job_id(raw).as_deref(),
            Some("Office.Printer-42")
        );
    }

    #[test]
    fn rejects_non_job_text() {
        assert_eq!(parse_print_job_id("printer is ready"), None);
    }

    #[test]
    fn derives_destination_and_matches_exact_lpstat_job() {
        let job_id = "Office-Printer_A-42";
        assert_eq!(print_job_destination(job_id), Some("Office-Printer_A"));
        assert!(lpstat_contains_job(
            "Office-Printer_A-41 user 1024 Thu\nOffice-Printer_A-42 user 2048 Thu",
            job_id
        ));
        assert!(!lpstat_contains_job(
            "Office-Printer_A-420 user 2048 Thu",
            job_id
        ));
    }

    #[test]
    fn finds_default_destination_without_parsing_localized_label() {
        let destinations = ["Office", "HP_Color_LaserJet_MFP_E78523__ABEB24_"];
        assert_eq!(
            parse_default_destination(
                "系统默认目的位置：HP_Color_LaserJet_MFP_E78523__ABEB24_",
                &destinations
            ),
            Some("HP_Color_LaserJet_MFP_E78523__ABEB24_")
        );
        assert_eq!(parse_default_destination("no default", &["default"]), None);
    }

    #[test]
    fn detects_duplex_and_color_from_values() {
        assert!(supports_duplex(&[option("None"), option("DuplexNoTumble")]));
        assert!(!supports_duplex(&[option("None")]));
        assert!(supports_color(&[option("Gray"), option("RGB")]));
        assert!(!supports_color(&[option("Gray"), option("BlackOnly")]));
    }

    #[test]
    fn parses_driver_choices_with_labels_containing_spaces() {
        let (key, options) =
            parse_printer_option("PageSize/Media Size: A4/A4 *Letter/US Letter Legal/US Legal")
                .unwrap();
        assert_eq!(key, "PageSize");
        assert_eq!(options.len(), 3);
        assert_eq!(options[1].value, "Letter");
        assert_eq!(options[1].label, "US Letter");
        assert!(options[1].is_default);
        assert_eq!(options[2].label, "US Legal");
    }

    #[test]
    fn parses_driver_choices_without_display_labels() {
        let (key, options) =
            parse_printer_option("Duplex/2-Sided Printing: None *DuplexNoTumble DuplexTumble")
                .unwrap();
        assert_eq!(key, "Duplex");
        assert_eq!(options.len(), 3);
        assert_eq!(options[0].value, "None");
        assert_eq!(options[1].value, "DuplexNoTumble");
        assert!(options[1].is_default);
        assert_eq!(options[2].value, "DuplexTumble");
    }

    #[test]
    fn validates_and_normalizes_page_ranges_before_submission() {
        assert_eq!(
            normalize_page_range(" 1 - 3, 5 ").unwrap().as_deref(),
            Some("1-3,5")
        );
        assert_eq!(normalize_page_range("   ").unwrap(), None);
        assert!(normalize_page_range("0").is_err());
        assert!(normalize_page_range("3-1").is_err());
        assert!(normalize_page_range("1,,3").is_err());
        assert!(normalize_page_range("1--3").is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            inspect_files,
            read_local_file,
            inspect_pdfs,
            create_printable_pdf,
            cleanup_printable_pdf,
            cleanup_stale_printable_pdfs,
            list_printers,
            get_printer_capabilities,
            submit_print_job,
            get_print_job_state,
            cancel_print_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pliflo");
}
