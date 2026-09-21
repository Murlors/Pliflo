//! Read-only platform printer/job status; never creates or changes jobs.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintStatus {
    pub state: String,
    pub reasons: Vec<String>,
    pub message: String,
}

#[cfg(any(target_os = "macos", test))]
fn job_state(value: i32) -> &'static str {
    match value {
        3 => "submitted",
        4 | 6 => "blocked",
        5 => "printing",
        7 => "cancelled",
        8 => "failed",
        9 => "completed",
        _ => "unknown",
    }
}

#[cfg(target_os = "macos")]
mod cups {
    use super::{job_state, PrintStatus};
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::ptr;

    // 系统自带 libcups，避免引入运行时或解析本地化命令行输出。
    #[link(name = "cups")]
    extern "C" {
        fn httpConnect2(
            host: *const c_char,
            port: c_int,
            addr: *mut c_void,
            family: c_int,
            encryption: c_int,
            blocking: c_int,
            msec: c_int,
            cancel: *mut c_int,
        ) -> *mut c_void;
        fn httpSetTimeout(
            http: *mut c_void,
            timeout: f64,
            callback: Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int>,
            data: *mut c_void,
        );
        fn httpClose(http: *mut c_void);
        fn ippNewRequest(operation: c_int) -> *mut c_void;
        fn ippAddString(
            ipp: *mut c_void,
            group: c_int,
            tag: c_int,
            name: *const c_char,
            language: *const c_char,
            value: *const c_char,
        ) -> *mut c_void;
        fn cupsDoRequest(
            http: *mut c_void,
            request: *mut c_void,
            resource: *const c_char,
        ) -> *mut c_void;
        fn ippDelete(ipp: *mut c_void);
        fn ippGetStatusCode(ipp: *mut c_void) -> c_int;
        fn ippFindAttribute(ipp: *mut c_void, name: *const c_char, tag: c_int) -> *mut c_void;
        fn ippGetInteger(attr: *mut c_void, index: c_int) -> c_int;
        fn ippGetCount(attr: *mut c_void) -> c_int;
        fn ippGetString(
            attr: *mut c_void,
            index: c_int,
            language: *mut *const c_char,
        ) -> *const c_char;
    }

    struct Response(*mut c_void);
    impl Drop for Response {
        fn drop(&mut self) {
            unsafe { ippDelete(self.0) }
        }
    }
    impl Response {
        fn integer(&self, name: &CStr) -> i32 {
            unsafe {
                let attr = ippFindAttribute(self.0, name.as_ptr(), 0x23);
                if attr.is_null() {
                    0
                } else {
                    ippGetInteger(attr, 0)
                }
            }
        }
        fn strings(&self, name: &CStr, tag: i32) -> Vec<String> {
            unsafe {
                let attr = ippFindAttribute(self.0, name.as_ptr(), tag);
                if attr.is_null() {
                    return vec![];
                }
                (0..ippGetCount(attr))
                    .filter_map(|i| {
                        let value = ippGetString(attr, i, ptr::null_mut());
                        if value.is_null() {
                            None
                        } else {
                            let value = CStr::from_ptr(value).to_string_lossy().into_owned();
                            (!value.is_empty() && value != "none").then_some(value)
                        }
                    })
                    .collect()
            }
        }
    }

    fn query(path: &str, job: bool) -> Result<Response, String> {
        let uri = CString::new(format!("ipp://localhost{path}")).map_err(|_| "Invalid CUPS URI")?;
        unsafe {
            let http = httpConnect2(
                // macOS 默认只开放本地 Unix socket，不要求启用 TCP 631。
                c"/private/var/run/cupsd".as_ptr(),
                631,
                ptr::null_mut(),
                0,
                0,
                1,
                2000,
                ptr::null_mut(),
            );
            if http.is_null() {
                return Err("Could not connect to local CUPS".into());
            }
            httpSetTimeout(http, 3.0, None, ptr::null_mut());
            let request = ippNewRequest(if job { 0x0009 } else { 0x000b });
            if request.is_null() {
                httpClose(http);
                return Err("Could not allocate CUPS request".into());
            }
            ippAddString(
                request,
                0x01,
                0x45,
                if job { c"job-uri" } else { c"printer-uri" }.as_ptr(),
                ptr::null(),
                uri.as_ptr(),
            );
            // cupsDoRequest 消费 request；response 由 RAII 释放。
            let response = cupsDoRequest(http, request, c"/".as_ptr());
            httpClose(http);
            if response.is_null() {
                return Err("CUPS status query failed".into());
            }
            let response = Response(response);
            let status = ippGetStatusCode(response.0);
            if status > 0xff {
                return Err(format!("CUPS status query failed (IPP {status:#x})"));
            }
            Ok(response)
        }
    }

    pub fn printer(name: &str) -> Result<PrintStatus, String> {
        if name.is_empty() {
            return Err("No printer selected".into());
        }
        let encoded: String = name
            .bytes()
            .map(|byte| {
                if byte.is_ascii_alphanumeric() || b"-_.".contains(&byte) {
                    (byte as char).to_string()
                } else {
                    format!("%{byte:02X}")
                }
            })
            .collect();
        let response = query(&format!("/printers/{encoded}"), false)?;
        Ok(PrintStatus {
            state: match response.integer(c"printer-state") {
                3 => "idle",
                4 => "processing",
                5 => "stopped",
                _ => "unknown",
            }
            .into(),
            reasons: response.strings(c"printer-state-reasons", 0x44),
            message: response.strings(c"printer-state-message", 0x41).join("; "),
        })
    }

    pub fn job(id: &str) -> Result<PrintStatus, String> {
        super::super::print_job_destination(id).ok_or("Invalid print job id")?;
        let sequence = id.rsplit_once('-').ok_or("Invalid print job id")?.1;
        let response = query(&format!("/jobs/{sequence}"), true)?;
        let mut reasons = response.strings(c"job-state-reasons", 0x44);
        reasons.extend(response.strings(c"job-printer-state-reasons", 0x44));
        reasons.sort();
        reasons.dedup();
        Ok(PrintStatus {
            state: job_state(response.integer(c"job-state")).into(),
            reasons,
            message: response.strings(c"job-state-message", 0x41).join("; "),
        })
    }
}

#[tauri::command]
pub async fn get_printer_status(printer: String) -> Result<PrintStatus, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || cups::printer(&printer))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::windows_print::status(&printer))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = printer;
        Err("Printer status is only available on macOS".into())
    }
}

#[tauri::command]
pub async fn get_print_job_status(job_id: String) -> Result<PrintStatus, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || cups::job(&job_id))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::windows_print::job(&job_id))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = job_id;
        Err("Print job status is only available on macOS".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_waiting_and_terminal_states() {
        assert_eq!(job_state(3), "submitted");
        assert_eq!(job_state(4), "blocked");
        assert_eq!(job_state(6), "blocked");
        assert_eq!(job_state(7), "cancelled");
        assert_eq!(job_state(8), "failed");
        assert_eq!(job_state(9), "completed");
        assert_eq!(job_state(0), "unknown");
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "Requires PLIFLO_STATUS_PRINTER and PLIFLO_STATUS_JOB; read-only CUPS queries"]
    fn reads_existing_status_without_submitting() {
        let printer = std::env::var("PLIFLO_STATUS_PRINTER").unwrap();
        let job = std::env::var("PLIFLO_STATUS_JOB").unwrap();
        let printer_status = cups::printer(&printer).unwrap();
        let job_status = cups::job(&job).unwrap();
        assert_ne!(printer_status.state, "unknown");
        assert_ne!(job_status.state, "unknown");
        println!("printer: {printer_status:?}\njob: {job_status:?}");
    }
}
