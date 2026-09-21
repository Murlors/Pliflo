use super::*;
use crate::{windows_pdf::Pdf, PrintSettings, SubmitResult};
use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

pub static PDF_LOCK: Mutex<()> = Mutex::new(());
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
struct Active;
impl Drop for Active {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}
#[derive(Default)]
struct Work {
    cancel: AtomicBool,
    finished: AtomicBool,
    result: Mutex<Option<PrintStatus>>,
}
static JOBS: OnceLock<Mutex<HashMap<String, Arc<Work>>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Arc<Work>>> {
    JOBS.get_or_init(Default::default)
}
pub fn is_spooling() -> bool {
    ACTIVE.load(Ordering::Acquire) != 0
}
fn state(state: &str, reason: &str, message: String) -> PrintStatus {
    PrintStatus {
        state: state.into(),
        reasons: if reason.is_empty() {
            vec![]
        } else {
            vec![reason.into()]
        },
        message,
    }
}

#[derive(Debug)]
struct Identity {
    printer: String,
    number: u32,
    title: String,
}
impl Identity {
    fn encode(&self) -> String {
        format!(
            "win:{}:{}:{}",
            self.number,
            self.printer
                .as_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
            self.title
        )
    }
    fn decode(value: &str) -> Result<Self, String> {
        let parts: Vec<_> = value.splitn(4, ':').collect();
        if parts.len() != 4
            || parts[0] != "win"
            || parts[2].len() > 65536
            || !parts[2].len().is_multiple_of(2)
            || !parts[2].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid Windows job identity".into());
        }
        let number = parts[1].parse::<u32>().map_err(|_| "Invalid job number")?;
        let printer = String::from_utf8(
            (0..parts[2].len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&parts[2][i..i + 2], 16).unwrap())
                .collect(),
        )
        .map_err(|_| "Invalid printer encoding")?;
        if number == 0
            || printer.is_empty()
            || printer.contains('\0')
            || !parts[3].starts_with("Pliflo-")
            || parts[3].len() > 100
            || !parts[3]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid Windows job identity".into());
        }
        Ok(Self {
            printer,
            number,
            title: parts[3].into(),
        })
    }
}

// CUPS-compatible range semantics: filter numbered output sides after n-up grouping.
fn plan(pages: usize, settings: &PrintSettings) -> Result<Vec<Vec<usize>>, String> {
    let up = settings.pages_per_sheet as usize;
    if ![1, 2, 4, 6, 9, 16].contains(&up) || !(1..=999).contains(&settings.copies) {
        return Err("Invalid copies or pages per sheet".into());
    }
    if !["all", "odd", "even"].contains(&settings.page_set.as_str())
        || !["fit", "actual"].contains(&settings.scale.as_str())
        || !["auto", "portrait", "landscape"].contains(&settings.orientation.as_str())
        || !["none", "long", "short"].contains(&settings.duplex.as_str())
        || !["auto", "color", "grayscale"].contains(&settings.color.as_str())
        || settings.quality != "printer"
    {
        return Err("Unsupported Windows print setting".into());
    }
    let sides = pages.div_ceil(up);
    let mut selected = BTreeSet::new();
    if let Some(range) = crate::normalize_page_range(&settings.page_range)? {
        for part in range.split(',') {
            let (start, end) = if let Some((a, b)) = part.split_once('-') {
                (a.parse::<usize>().unwrap(), b.parse::<usize>().unwrap())
            } else {
                let n = part.parse::<usize>().unwrap();
                (n, n)
            };
            for n in start..=end.min(sides) {
                selected.insert(n);
            }
        }
    } else {
        selected.extend(1..=sides);
    }
    let mut result: Vec<Vec<usize>> = selected
        .into_iter()
        .filter(|n| settings.page_set == "all" || (*n % 2 == 1) == (settings.page_set == "odd"))
        .map(|n| ((n - 1) * up..(n * up).min(pages)).collect())
        .collect();
    if settings.reverse {
        result.reverse();
    }
    if result.is_empty() {
        return Err("Page selection contains no printable pages".into());
    }
    Ok(result)
}

struct Dc(HDC, bool);
impl Drop for Dc {
    fn drop(&mut self) {
        unsafe {
            if self.1 {
                AbortDoc(self.0);
            }
            DeleteDC(self.0);
        }
    }
}

fn device(name: &str, settings: &PrintSettings, landscape: bool) -> Result<Dc, String> {
    let printer = Printer::open(name)?;
    let encoded = wide(name)?;
    let size = unsafe {
        DocumentPropertiesW(
            ptr::null_mut(),
            printer.0,
            encoded.as_ptr(),
            ptr::null_mut(),
            ptr::null(),
            0,
        )
    };
    if size < size_of::<DEVMODEW>() as i32 || size > 1024 * 1024 {
        return Err(error("Read printer DEVMODE size"));
    }
    let mut storage = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
    let pointer = storage.as_mut_ptr().cast::<DEVMODEW>();
    if unsafe {
        DocumentPropertiesW(
            ptr::null_mut(),
            printer.0,
            encoded.as_ptr(),
            pointer,
            ptr::null(),
            DM_OUT_BUFFER,
        )
    } != 1
    {
        return Err(error("Read printer defaults"));
    }
    let caps = capabilities(name)?;
    let paper = match settings.media.as_str() {
        "A4" => "9",
        "Letter" => "1",
        "Legal" => "5",
        value => value,
    };
    if !caps.media.iter().any(|c| c.value == paper) {
        return Err("Selected paper is not reported by the driver".into());
    }
    let paper = paper.parse::<i16>().map_err(|_| "Invalid paper ID")?;
    if settings.duplex != "none" && !caps.supports_duplex {
        return Err("Driver does not support duplex".into());
    }
    if settings.color == "color" && !caps.supports_color {
        return Err("Driver does not support color".into());
    }
    let tray = if settings.tray.is_empty() {
        None
    } else {
        if !caps.trays.iter().any(|c| c.value == settings.tray) {
            return Err("Unsupported paper tray".into());
        }
        Some(
            settings
                .tray
                .parse::<i16>()
                .map_err(|_| "Invalid tray ID")?,
        )
    };
    unsafe {
        let mode = &mut *pointer;
        if (mode.dmSize as usize) < size_of::<DEVMODEW>()
            || mode.dmSize as usize + mode.dmDriverExtra as usize > size as usize
        {
            return Err("Invalid driver DEVMODE".into());
        }
        mode.dmFields |= DM_PAPERSIZE | DM_ORIENTATION | DM_COPIES;
        mode.dmFields &= !(DM_PAPERLENGTH | DM_PAPERWIDTH);
        mode.Anonymous1.Anonymous1.dmPaperSize = paper;
        mode.Anonymous1.Anonymous1.dmOrientation = if landscape { 2 } else { 1 };
        mode.Anonymous1.Anonymous1.dmCopies = settings.copies as i16;
        mode.Anonymous1.Anonymous1.dmScale = 100;
        if settings.copies > 1 {
            mode.dmFields |= DM_COLLATE;
            mode.dmCollate = 1;
        }
        let duplex = match settings.duplex.as_str() {
            "long" => 2,
            "short" => 3,
            _ => 1,
        };
        if caps.supports_duplex {
            mode.dmFields |= DM_DUPLEX;
            mode.dmDuplex = duplex;
        }
        if settings.color != "auto" {
            mode.dmFields |= DM_COLOR;
            mode.dmColor = if settings.color == "grayscale" { 1 } else { 2 };
        }
        if let Some(tray) = tray {
            mode.dmFields |= DM_DEFAULTSOURCE;
            mode.Anonymous1.Anonymous1.dmDefaultSource = tray;
        }
        if DocumentPropertiesW(
            ptr::null_mut(),
            printer.0,
            encoded.as_ptr(),
            pointer,
            pointer,
            DM_IN_BUFFER | DM_OUT_BUFFER,
        ) != 1
        {
            return Err(error("Validate print settings"));
        }
        let mode = &*pointer;
        if mode.Anonymous1.Anonymous1.dmPaperSize != paper
            || (mode.dmFields & DM_SCALE != 0 && mode.Anonymous1.Anonymous1.dmScale != 100)
            || mode.Anonymous1.Anonymous1.dmCopies != settings.copies as i16
            || mode.Anonymous1.Anonymous1.dmOrientation != if landscape { 2 } else { 1 }
            || (caps.supports_duplex && mode.dmDuplex != duplex)
            // Grayscale is also enforced by PDFium; some color drivers (including
            // Print to PDF) refuse dmColor=MONOCHROME despite accepting the page.
            || (settings.color == "color" && mode.dmColor != 2)
            || (settings.copies > 1 && mode.dmCollate != 1)
            || tray.is_some_and(|t| mode.Anonymous1.Anonymous1.dmDefaultSource != t)
        {
            return Err(format!("Printer driver changed requested settings; submission stopped (paper={}, orientation={}, copies={}, scale={}, duplex={}, color={}, collate={})", mode.Anonymous1.Anonymous1.dmPaperSize, mode.Anonymous1.Anonymous1.dmOrientation, mode.Anonymous1.Anonymous1.dmCopies, mode.Anonymous1.Anonymous1.dmScale, mode.dmDuplex, mode.dmColor, mode.dmCollate));
        }
        let dc = CreateDCW(
            wide("WINSPOOL")?.as_ptr(),
            encoded.as_ptr(),
            ptr::null(),
            pointer,
        );
        if dc.is_null() {
            return Err(error("Create printer device context"));
        }
        Ok(Dc(dc, false))
    }
}

fn placement(size: (f64, f64), cell: [i32; 4], dpi: (f64, f64), fit: bool) -> ([i32; 4], i32) {
    let (mut w, mut h) = size;
    let available = (cell[2] as f64 / dpi.0 * 72., cell[3] as f64 / dpi.1 * 72.);
    let rotate =
        if fit && (available.0 / h).min(available.1 / w) > (available.0 / w).min(available.1 / h) {
            std::mem::swap(&mut w, &mut h);
            1
        } else {
            0
        };
    let scale = if fit {
        (available.0 / w).min(available.1 / h)
    } else {
        1.
    };
    let (w, h) = (
        (w / 72. * dpi.0 * scale).round().max(1.) as i32,
        (h / 72. * dpi.1 * scale).round().max(1.) as i32,
    );
    (
        [
            cell[0] + (cell[2] - w) / 2,
            cell[1] + (cell[3] - h) / 2,
            w,
            h,
        ],
        rotate,
    )
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum SpoolStep {
    StartPage,
    Draw { slot: usize, index: usize },
    EndPage,
    EndDocument,
}

// The same sequence is exercised with fault/cancellation injection in tests,
// without constructing a printer DC or calling any spooler mutation API.
fn run_spool(
    output: &[Vec<usize>],
    work: &Work,
    mut execute: impl FnMut(SpoolStep) -> Result<(), String>,
) -> Result<(), String> {
    let mut step = |action| {
        if work.cancel.load(Ordering::Acquire) {
            return Err("Cancelled".into());
        }
        execute(action)?;
        if work.cancel.load(Ordering::Acquire) {
            return Err("Cancelled".into());
        }
        Ok(())
    };
    for side in output {
        step(SpoolStep::StartPage)?;
        for (slot, &index) in side.iter().enumerate() {
            step(SpoolStep::Draw { slot, index })?;
        }
        step(SpoolStep::EndPage)?;
    }
    step(SpoolStep::EndDocument)
}

fn render(
    pdf: &Pdf,
    dc: &mut Dc,
    output: &[Vec<usize>],
    settings: &PrintSettings,
    work: &Work,
) -> Result<(), String> {
    let width = unsafe { GetDeviceCaps(dc.0, HORZRES as i32) };
    let height = unsafe { GetDeviceCaps(dc.0, VERTRES as i32) };
    let dpi = (
        unsafe { GetDeviceCaps(dc.0, LOGPIXELSX as i32) } as f64,
        unsafe { GetDeviceCaps(dc.0, LOGPIXELSY as i32) } as f64,
    );
    if width <= 0 || height <= 0 || dpi.0 <= 0. || dpi.1 <= 0. {
        return Err("Invalid printer geometry".into());
    }
    let (cols, rows) = match settings.pages_per_sheet {
        2 => (2, 1),
        4 => (2, 2),
        6 => (3, 2),
        9 => (3, 3),
        16 => (4, 4),
        _ => (1, 1),
    };
    run_spool(output, work, |step| {
        match step {
            SpoolStep::StartPage => {
                if unsafe { StartPage(dc.0) } <= 0 {
                    return Err(error("Start page"));
                }
            }
            SpoolStep::Draw { slot, index } => {
                let page = pdf.page(index)?;
                let cell = [
                    (slot as i32 % cols) * width / cols,
                    (slot as i32 / cols) * height / rows,
                    width / cols,
                    height / rows,
                ];
                let (rect, rotation) = placement(
                    page.size(),
                    cell,
                    dpi,
                    settings.scale == "fit" || settings.pages_per_sheet > 1,
                );
                unsafe {
                    let saved = SaveDC(dc.0);
                    if saved == 0 {
                        return Err(error("Save print context"));
                    }
                    let clipped = IntersectClipRect(
                        dc.0,
                        cell[0],
                        cell[1],
                        cell[0] + cell[2],
                        cell[1] + cell[3],
                    );
                    if clipped == 0 {
                        RestoreDC(dc.0, saved);
                        return Err(error("Clip print context"));
                    }
                    page.render(dc.0, rect, rotation, settings.color == "grayscale");
                    if RestoreDC(dc.0, saved) == 0 {
                        return Err(error("Restore print context"));
                    }
                }
            }
            SpoolStep::EndPage => {
                if unsafe { EndPage(dc.0) } <= 0 {
                    return Err(error("End page"));
                }
            }
            SpoolStep::EndDocument => {
                if unsafe { EndDoc(dc.0) } <= 0 {
                    return Err(error("End document"));
                }
            }
        }
        Ok(())
    })?;
    dc.1 = false;
    Ok(())
}

pub fn submit(
    path: String,
    printer: String,
    settings: PrintSettings,
) -> Result<SubmitResult, String> {
    submit_inner(
        path,
        printer,
        settings,
        #[cfg(test)]
        None,
    )
}

// Not compiled into the application. The gate lets an explicitly authorized test
// observe/cancel its own accepted job before any page is sent to the virtual device.
#[cfg(test)]
struct TestOutput {
    path: String,
    resume: mpsc::Receiver<()>,
}

fn submit_inner(
    path: String,
    printer: String,
    settings: PrintSettings,
    #[cfg(test)] test_output: Option<TestOutput>,
) -> Result<SubmitResult, String> {
    ACTIVE
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
            (n < 2).then_some(n + 1)
        })
        .map_err(|_| "Print preparation is busy; wait for the current document")?;
    let active = Active;
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("pliflo-print".into())
        .spawn(move || {
            let _active = active;
            // Serialize PDFium and driver rendering. No PDFium call races another document.
            let _lock = PDF_LOCK.lock().unwrap();
            let prepared = (|| {
                let pdf = Pdf::open(Path::new(&path))?;
                let output = plan(pdf.pages, &settings)?;
                // Validate every selected page before creating a spooler job.
                for index in output.iter().flatten() {
                    pdf.page(*index)?;
                }
                let (w, h) = pdf.page(output[0][0])?.size();
                let dc = device(
                    &printer,
                    &settings,
                    settings.orientation == "landscape" || settings.orientation == "auto" && w > h,
                )?;
                Ok::<_, String>((pdf, output, dc))
            })();
            let (pdf, output, mut dc) = match prepared {
                Ok(v) => v,
                Err(e) => {
                    let _ = sender.send(Err(e));
                    return;
                }
            };
            let title = format!(
                "Pliflo-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );
            let title_w = wide(&title).unwrap();
            #[cfg(test)]
            let output_w = test_output.as_ref().map(|test| wide(&test.path).unwrap());
            let info = DOCINFOW {
                cbSize: size_of::<DOCINFOW>() as i32,
                lpszDocName: title_w.as_ptr(),
                #[cfg(test)]
                lpszOutput: output_w.as_ref().map_or(ptr::null(), |path| path.as_ptr()),
                ..Default::default()
            };
            let number = unsafe { StartDocW(dc.0, &info) };
            if number <= 0 {
                let _ = sender.send(Err(error("Start print document")));
                return;
            }
            dc.1 = true;
            let id = Identity {
                printer,
                number: number as u32,
                title,
            }
            .encode();
            let work = Arc::new(Work::default());
            {
                let mut entries = jobs().lock().unwrap();
                if entries.len() > 2048 {
                    entries.retain(|_, w| !w.finished.load(Ordering::Acquire));
                }
                entries.insert(id.clone(), work.clone());
            }
            if sender
                .send(Ok(SubmitResult {
                    job_id: id,
                    raw: "Windows accepted the job; rendering/spooling continues".into(),
                }))
                .is_err()
            {
                work.cancel.store(true, Ordering::Release);
            }
            #[cfg(test)]
            if let Some(test) = test_output {
                if test
                    .resume
                    .recv_timeout(std::time::Duration::from_secs(30))
                    .is_err()
                {
                    work.cancel.store(true, Ordering::Release);
                }
            }
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                render(&pdf, &mut dc, &output, &settings, &work)
            }))
            .unwrap_or_else(|_| Err("Print rendering worker panicked".into()));
            // Abort unfinished jobs before exposing a terminal state or permitting cleanup.
            drop(dc);
            drop(pdf);
            if let Err(message) = result {
                let mut terminal = work.result.lock().unwrap();
                if !work.cancel.load(Ordering::Acquire) {
                    *terminal = Some(state("failed", "render-or-spool-failed", message));
                }
            }
            work.finished.store(true, Ordering::Release);
        })
        .map_err(|e| e.to_string())?;
    receiver
        .recv()
        .map_err(|_| "Print worker stopped before returning a job ID".to_string())?
}

fn read_job(printer: &Printer, identity: &Identity) -> Result<Option<Vec<usize>>, String> {
    let mut last = 0;
    let result = buffer(|data, size, needed| unsafe {
        let ok = GetJobW(printer.0, identity.number, 1, data, size, needed);
        if ok == 0 {
            last = GetLastError();
        }
        ok
    });
    match result {
        Err(_) if last == 87 || last == 2 || last == 1168 => Ok(None),
        Err(e) => Err(e),
        Ok(data) => {
            if data.len() * size_of::<usize>() < size_of::<JOB_INFO_1W>() {
                return Err("Invalid spooler job data".into());
            }
            let info = unsafe { &*data.as_ptr().cast::<JOB_INFO_1W>() };
            if unsafe { string(info.pDocument) } != identity.title {
                return Err("Job ID was reused by another document; refusing access".into());
            }
            Ok(Some(data))
        }
    }
}
fn flags_state(flags: u32) -> (&'static str, &'static str) {
    if flags & JOB_STATUS_PRINTED != 0 {
        ("completed", "spooler-reported-printed")
    } else if flags & JOB_STATUS_DELETED != 0 {
        ("unconfirmed", "job-no-longer-in-queue")
    } else if flags & JOB_STATUS_DELETING != 0 {
        ("blocked", "cancellation-pending")
    } else if flags
        & (JOB_STATUS_ERROR
            | JOB_STATUS_OFFLINE
            | JOB_STATUS_PAPEROUT
            | JOB_STATUS_PAUSED
            | JOB_STATUS_USER_INTERVENTION
            | JOB_STATUS_BLOCKED_DEVQ)
        != 0
    {
        ("blocked", "printer-intervention-required")
    } else if flags & JOB_STATUS_PRINTING != 0 {
        ("printing", "")
    } else if flags & JOB_STATUS_COMPLETE != 0 {
        ("unknown", "sent-to-device-not-confirmed-printed")
    } else {
        ("submitted", "")
    }
}
pub fn job(id: &str) -> Result<PrintStatus, String> {
    let identity = Identity::decode(id)?;
    let work = jobs().lock().unwrap().get(id).cloned();
    if let Some(work) = &work {
        if work.finished.load(Ordering::Acquire) {
            if let Some(result) = work.result.lock().unwrap().clone() {
                return Ok(result);
            }
        }
    }
    let printer = Printer::open(&identity.printer)?;
    let data = read_job(&printer, &identity)?;
    let Some(data) = data else {
        if let Some(work) = &work {
            if work.cancel.load(Ordering::Acquire) && work.finished.load(Ordering::Acquire) {
                return Ok(state(
                    "cancelled",
                    "cancel-request-confirmed-absent",
                    String::new(),
                ));
            }
        }
        return Ok(state(
            if work
                .as_ref()
                .is_some_and(|w| !w.finished.load(Ordering::Acquire))
            {
                "unknown"
            } else {
                "unconfirmed"
            },
            "job-no-longer-in-queue",
            String::new(),
        ));
    };
    let info = unsafe { &*data.as_ptr().cast::<JOB_INFO_1W>() };
    let (mut status, reason) = flags_state(info.Status);
    if info.Status & JOB_STATUS_DELETED != 0
        && info.Status & JOB_STATUS_PRINTED == 0
        && work
            .as_ref()
            .is_some_and(|w| w.cancel.load(Ordering::Acquire))
    {
        status = "cancelled";
    }
    if work
        .as_ref()
        .is_some_and(|w| !w.finished.load(Ordering::Acquire))
        && ["completed", "cancelled", "unconfirmed"].contains(&status)
    {
        status = "submitted";
    }
    let result = state(status, reason, unsafe { string(info.pStatus) });
    if ["completed", "cancelled", "unconfirmed"].contains(&status) {
        if let Some(work) = work {
            *work.result.lock().unwrap() = Some(result.clone());
        }
    }
    Ok(result)
}
pub fn cancel(id: &str) -> Result<(), String> {
    let identity = Identity::decode(id)?;
    let printer = Printer::open(&identity.printer)?;
    let data = read_job(&printer, &identity)?
        .ok_or("Job is no longer present; cancellation cannot be confirmed")?;
    let info = unsafe { &*data.as_ptr().cast::<JOB_INFO_1W>() };
    if info.Status & JOB_STATUS_PRINTED != 0 {
        return Err("Spooler already reports the job printed".into());
    }
    let work = jobs().lock().unwrap().get(id).cloned().unwrap_or_else(|| {
        let work = Arc::new(Work::default());
        work.finished.store(true, Ordering::Release);
        work
    });
    let _terminal = work.result.lock().unwrap();
    if unsafe {
        SetJobW(
            printer.0,
            identity.number,
            0,
            ptr::null(),
            JOB_CONTROL_DELETE,
        )
    } == 0
    {
        return Err(error("Cancel print job"));
    }
    work.cancel.store(true, Ordering::Release);
    jobs().lock().unwrap().insert(id.to_owned(), work.clone());
    Ok(())
}

#[cfg(test)]
#[path = "jobs_tests.rs"]
mod tests;
