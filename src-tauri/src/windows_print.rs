//! Windows spooler boundary. PDF rendering uses GDI, never RAW-PDF or shell commands.
mod jobs;
use crate::{print_status::PrintStatus, PrinterCapabilities, PrinterInfo, PrinterOption};
#[cfg(test)]
pub use jobs::PDF_LOCK;
pub use jobs::{cancel, is_spooling, job, submit};
use std::{mem::size_of, ptr};
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_INSUFFICIENT_BUFFER},
    Graphics::{Gdi::*, Printing::*},
    Storage::Xps::*,
};

fn wide(value: &str) -> Result<Vec<u16>, String> {
    if value.contains('\0') {
        return Err("Invalid printer name".into());
    }
    Ok(value.encode_utf16().chain(Some(0)).collect())
}
unsafe fn string(pointer: *const u16) -> String {
    if pointer.is_null() {
        return String::new();
    }
    let mut length = 0;
    while *pointer.add(length) != 0 {
        length += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length))
}
fn error(operation: &str) -> String {
    format!("{operation}: {}", std::io::Error::last_os_error())
}

// Winspool returns structures containing pointers; usize storage preserves alignment.
fn buffer(mut query: impl FnMut(*mut u8, u32, &mut u32) -> i32) -> Result<Vec<usize>, String> {
    let mut needed = 0;
    let mut data = Vec::<usize>::new();
    for _ in 0..4 {
        let pointer = if data.is_empty() {
            ptr::null_mut()
        } else {
            data.as_mut_ptr().cast()
        };
        if query(
            pointer,
            (data.len() * size_of::<usize>()) as u32,
            &mut needed,
        ) != 0
        {
            return Ok(data);
        }
        if unsafe { GetLastError() } != ERROR_INSUFFICIENT_BUFFER {
            return Err(error("Read printer data"));
        }
        if needed == 0 || needed > 16 * 1024 * 1024 {
            return Err("Printer data exceeds limits".into());
        }
        data.resize((needed as usize).div_ceil(size_of::<usize>()), 0);
    }
    Err("Printer configuration changed repeatedly; retry discovery".into())
}

struct Printer(PRINTER_HANDLE);
impl Printer {
    fn open(name: &str) -> Result<Self, String> {
        let name = wide(name)?;
        let mut handle = PRINTER_HANDLE::default();
        if unsafe { OpenPrinterW(name.as_ptr(), &mut handle, ptr::null()) } == 0 {
            return Err(error("Open printer"));
        }
        Ok(Self(handle))
    }
    fn info(&self) -> Result<Vec<usize>, String> {
        buffer(|data, size, needed| unsafe { GetPrinterW(self.0, 2, data, size, needed) })
    }
}
impl Drop for Printer {
    fn drop(&mut self) {
        unsafe {
            ClosePrinter(self.0);
        }
    }
}

pub fn list() -> Result<Vec<PrinterInfo>, String> {
    let mut count = 0;
    let data = buffer(|data, size, needed| unsafe {
        EnumPrintersW(
            PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
            ptr::null(),
            4,
            data,
            size,
            needed,
            &mut count,
        )
    })?;
    let mut default = vec![0_u16; 32768];
    let mut size = default.len() as u32;
    let default = if unsafe { GetDefaultPrinterW(default.as_mut_ptr(), &mut size) } != 0 {
        unsafe { string(default.as_ptr()) }
    } else {
        String::new()
    };
    if count as usize * size_of::<PRINTER_INFO_4W>() > data.len() * size_of::<usize>() {
        return Err("Invalid printer enumeration size".into());
    }
    if count == 0 {
        return Ok(Vec::new());
    }
    Ok(unsafe {
        std::slice::from_raw_parts(data.as_ptr().cast::<PRINTER_INFO_4W>(), count as usize)
    }
    .iter()
    .map(|info| {
        let name = unsafe { string(info.pPrinterName) };
        PrinterInfo {
            is_default: name == default,
            name,
            state: "detected".into(),
        }
    })
    .collect())
}

pub fn capabilities(name: &str) -> Result<PrinterCapabilities, String> {
    let printer = Printer::open(name)?;
    let data = printer.info()?;
    let info = unsafe { &*data.as_ptr().cast::<PRINTER_INFO_2W>() };
    let name = wide(name)?;
    let capability = |kind, output| unsafe {
        DeviceCapabilitiesW(name.as_ptr(), info.pPortName, kind, output, info.pDevMode)
    };
    let choices =
        |ids, labels, width: usize, selected: Option<i16>| -> Result<Vec<PrinterOption>, String> {
            let count = capability(ids, ptr::null_mut());
            if count <= 0 {
                return Ok(Vec::new());
            }
            if count > 65535 || capability(labels, ptr::null_mut()) != count {
                return Err("Invalid driver capability count".into());
            }
            // DeviceCapabilities has no output-size parameter. Reserve the WORD ID domain
            // so an ordinary concurrent driver configuration change cannot overrun it.
            let mut values = vec![0_u16; 65536];
            let mut names = vec![0_u16; 65536 * width];
            let actual = capability(ids, values.as_mut_ptr());
            let named = capability(labels, names.as_mut_ptr());
            if actual != count || named != count {
                return Err("Printer capabilities changed; retry".into());
            }
            Ok((0..count as usize)
                .map(|index| {
                    let label = &names[index * width..(index + 1) * width];
                    let end = label.iter().position(|value| *value == 0).unwrap_or(width);
                    PrinterOption {
                        value: values[index].to_string(),
                        label: String::from_utf16_lossy(&label[..end]),
                        is_default: selected.is_some_and(|value| value as u16 == values[index]),
                    }
                })
                .collect())
        };
    let defaults = unsafe { info.pDevMode.as_ref() };
    let paper = defaults
        .filter(|d| d.dmFields & DM_PAPERSIZE != 0)
        .map(|d| unsafe { d.Anonymous1.Anonymous1.dmPaperSize });
    let tray = defaults
        .filter(|d| d.dmFields & DM_DEFAULTSOURCE != 0)
        .map(|d| unsafe { d.Anonymous1.Anonymous1.dmDefaultSource });
    Ok(PrinterCapabilities {
        media: choices(DC_PAPERS, DC_PAPERNAMES, 64, paper)?,
        trays: choices(DC_BINS, DC_BINNAMES, 24, tray)?,
        qualities: Vec::new(), // Resolution pairs are not draft/normal/high quality modes.
        supports_duplex: capability(DC_DUPLEX, ptr::null_mut()) == 1,
        supports_color: capability(DC_COLORDEVICE, ptr::null_mut()) == 1,
    })
}

pub fn status(name: &str) -> Result<PrintStatus, String> {
    let printer = Printer::open(name)?;
    let data = printer.info()?;
    let info = unsafe { &*data.as_ptr().cast::<PRINTER_INFO_2W>() };
    Ok(map_status(info.Status, info.cJobs))
}

fn map_status(flags: u32, jobs: u32) -> PrintStatus {
    let mut reasons = Vec::new();
    for (flag, label) in [
        (PRINTER_STATUS_OFFLINE, "offline"),
        (PRINTER_STATUS_PAPER_OUT, "media-empty"),
        (PRINTER_STATUS_PAPER_JAM, "media-jam"),
        (PRINTER_STATUS_PAUSED, "paused"),
        (PRINTER_STATUS_ERROR, "error"),
        (PRINTER_STATUS_USER_INTERVENTION, "intervention-required"),
        (PRINTER_STATUS_DOOR_OPEN, "door-open"),
        (PRINTER_STATUS_NO_TONER, "toner-empty"),
    ] {
        if flags & flag != 0 {
            reasons.push(label.into());
        }
    }
    let normal = PRINTER_STATUS_PRINTING
        | PRINTER_STATUS_BUSY
        | PRINTER_STATUS_IO_ACTIVE
        | PRINTER_STATUS_PROCESSING
        | PRINTER_STATUS_WARMING_UP;
    // Driver diagnostics are not user warnings. Keep raw flags only when an
    // otherwise unmapped condition needs investigation.
    let message = if reasons.is_empty() && flags & !normal != 0 {
        format!("Windows spooler status: 0x{flags:08x}; jobs: {jobs}")
    } else {
        String::new()
    };
    PrintStatus {
        state: if flags & PRINTER_STATUS_OFFLINE != 0 {
            "stopped"
        } else if !reasons.is_empty() {
            "stopped"
        } else if flags & PRINTER_STATUS_PRINTING != 0 {
            "processing"
        } else if flags == 0 {
            "idle"
        } else {
            "unknown"
        }
        .into(),
        reasons,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normal_printer_status_is_not_a_warning() {
        for (flags, jobs) in [
            (0, 0),
            (0, 2),
            (PRINTER_STATUS_PRINTING, 1),
            (PRINTER_STATUS_BUSY, 1),
        ] {
            let result = map_status(flags, jobs);
            assert!(result.reasons.is_empty());
            assert!(result.message.is_empty());
        }
        assert_eq!(map_status(0, 0).state, "idle");
        assert_eq!(map_status(PRINTER_STATUS_PRINTING, 1).state, "processing");
        let failure = map_status(PRINTER_STATUS_PAPER_OUT | PRINTER_STATUS_OFFLINE, 0);
        assert_eq!(failure.state, "stopped");
        assert!(failure.reasons.iter().any(|reason| reason == "media-empty"));
        assert!(failure.reasons.iter().any(|reason| reason == "offline"));
        assert!(!map_status(PRINTER_STATUS_OUT_OF_MEMORY, 0)
            .message
            .is_empty());
    }
    #[test]
    fn unicode_names_and_nul_validation() {
        assert_eq!(
            String::from_utf16(&wide("办公室 printer").unwrap()[..11]).unwrap(),
            "办公室 printer"
        );
        assert!(wide("bad\0name").is_err());
    }
    #[test]
    #[ignore = "Read-only local driver inspection; never submits jobs"]
    fn inspect_installed_printers() {
        for printer in list().unwrap() {
            let caps = capabilities(&printer.name).unwrap();
            println!(
                "{} default={} papers={} trays={} duplex={} color={} {:?}",
                printer.name,
                printer.is_default,
                caps.media.len(),
                caps.trays.len(),
                caps.supports_duplex,
                caps.supports_color,
                status(&printer.name).unwrap()
            );
        }
    }
}
