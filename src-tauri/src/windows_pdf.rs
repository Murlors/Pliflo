//! Narrow PDFium C boundary. All instances are serialized by the print worker.
//! File callbacks avoid copying entire PDFs into memory and accept Unicode paths.
use libloading::Library;
use std::{
    ffi::{c_int, c_ulong, c_void},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};
use windows_sys::Win32::Graphics::Gdi::HDC;

type Handle = *mut c_void;
#[repr(C)]
struct FileAccess {
    length: c_ulong,
    read: Option<unsafe extern "C" fn(*mut c_void, c_ulong, *mut u8, c_ulong) -> c_int>,
    parameter: *mut c_void,
}
unsafe extern "C" fn read(
    parameter: *mut c_void,
    offset: c_ulong,
    bytes: *mut u8,
    size: c_ulong,
) -> c_int {
    // PDFium invokes this synchronously while the owning Document is alive.
    let file = &mut *parameter.cast::<File>();
    let buffer = std::slice::from_raw_parts_mut(bytes, size as usize);
    (file
        .seek(SeekFrom::Start(offset as u64))
        .and_then(|_| file.read_exact(buffer))
        .is_ok()) as c_int
}

pub struct Pdf {
    document: Handle,
    close: unsafe extern "C" fn(Handle),
    destroy: unsafe extern "C" fn(),
    load_page: unsafe extern "C" fn(Handle, c_int) -> Handle,
    close_page: unsafe extern "C" fn(Handle),
    width: unsafe extern "C" fn(Handle) -> f32,
    height: unsafe extern "C" fn(Handle) -> f32,
    render: unsafe extern "C" fn(HDC, Handle, c_int, c_int, c_int, c_int, c_int, c_int),
    pub pages: usize,
    // Keep callbacks, file and DLL alive until after FPDF_CloseDocument.
    _access: Box<FileAccess>,
    _file: Box<File>,
    _library: Library,
}
impl Pdf {
    pub fn open(path: &Path) -> Result<Self, String> {
        let directory = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("Missing executable directory")?
            .to_owned();
        Self::open_with_library(path, &directory.join("pdfium.dll"))
    }
    fn open_with_library(path: &Path, library: &Path) -> Result<Self, String> {
        let mut file = Box::new(File::open(path).map_err(|e| e.to_string())?);
        let length = file.metadata().map_err(|e| e.to_string())?.len();
        if length == 0 || length > u32::MAX as u64 {
            return Err("PDF must be between 1 byte and 4 GiB".into());
        }
        let mut access = Box::new(FileAccess {
            length: length as c_ulong,
            read: Some(read),
            parameter: (&mut *file as *mut File).cast(),
        });
        unsafe {
            // Absolute app-local path, never resolve PDFium from the working directory/PATH.
            let library =
                Library::new(library).map_err(|e| format!("Cannot load bundled PDFium: {e}"))?;
            macro_rules! symbol {
                ($name:literal, $ty:ty) => {
                    *library
                        .get::<$ty>(concat!($name, "\0").as_bytes())
                        .map_err(|e| e.to_string())?
                };
            }
            let init = symbol!("FPDF_InitLibrary", unsafe extern "C" fn());
            let destroy = symbol!("FPDF_DestroyLibrary", unsafe extern "C" fn());
            let load = symbol!(
                "FPDF_LoadCustomDocument",
                unsafe extern "C" fn(*mut FileAccess, *const u8) -> Handle
            );
            let close = symbol!("FPDF_CloseDocument", unsafe extern "C" fn(Handle));
            let count = symbol!("FPDF_GetPageCount", unsafe extern "C" fn(Handle) -> c_int);
            let form = symbol!("FPDF_GetFormType", unsafe extern "C" fn(Handle) -> c_int);
            let permissions = symbol!(
                "FPDF_GetDocPermissions",
                unsafe extern "C" fn(Handle) -> c_ulong
            );
            let load_page = symbol!(
                "FPDF_LoadPage",
                unsafe extern "C" fn(Handle, c_int) -> Handle
            );
            let close_page = symbol!("FPDF_ClosePage", unsafe extern "C" fn(Handle));
            let width = symbol!("FPDF_GetPageWidthF", unsafe extern "C" fn(Handle) -> f32);
            let height = symbol!("FPDF_GetPageHeightF", unsafe extern "C" fn(Handle) -> f32);
            let render = symbol!(
                "FPDF_RenderPage",
                unsafe extern "C" fn(HDC, Handle, c_int, c_int, c_int, c_int, c_int, c_int)
            );
            init();
            let document = load(&mut *access, std::ptr::null());
            if document.is_null() {
                destroy();
                return Err("PDFium cannot open this PDF (invalid or password protected)".into());
            }
            let pages = count(document);
            let error = if pages <= 0 || pages > 100_000 {
                Some("Invalid PDF page count")
            } else if form(document) != 0 {
                Some("Interactive PDF forms must be flattened before printing")
            } else if permissions(document) & 4 == 0 {
                Some("PDF permissions disallow printing")
            } else {
                None
            };
            if let Some(error) = error {
                close(document);
                destroy();
                return Err(error.into());
            }
            Ok(Self {
                document,
                close,
                destroy,
                load_page,
                close_page,
                width,
                height,
                render,
                pages: pages as usize,
                _access: access,
                _file: file,
                _library: library,
            })
        }
    }
    pub fn page(&self, index: usize) -> Result<Page<'_>, String> {
        let handle = unsafe { (self.load_page)(self.document, index as c_int) };
        if handle.is_null() {
            return Err(format!("PDFium cannot load page {}", index + 1));
        }
        let page = Page { pdf: self, handle };
        let (w, h) = page.size();
        if !w.is_finite() || !h.is_finite() || w <= 0. || h <= 0. {
            return Err("Invalid PDF page dimensions".into());
        }
        Ok(page)
    }
}
impl Drop for Pdf {
    fn drop(&mut self) {
        unsafe {
            (self.close)(self.document);
            (self.destroy)();
        }
    }
}
pub struct Page<'a> {
    pdf: &'a Pdf,
    handle: Handle,
}
impl Page<'_> {
    pub fn size(&self) -> (f64, f64) {
        unsafe {
            (
                (self.pdf.width)(self.handle) as f64,
                (self.pdf.height)(self.handle) as f64,
            )
        }
    }
    pub unsafe fn render(&self, dc: HDC, rect: [i32; 4], rotate: i32, grayscale: bool) {
        (self.pdf.render)(
            dc,
            self.handle,
            rect[0],
            rect[1],
            rect[2],
            rect[3],
            rotate,
            0x800 | 1 | if grayscale { 8 } else { 0 },
        );
    }
}
impl Drop for Page<'_> {
    fn drop(&mut self) {
        unsafe {
            (self.pdf.close_page)(self.handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Graphics::Gdi::*;
    #[test]
    #[ignore = "Requires PLIFLO_PDFIUM_PREFIX and PLIFLO_TEST_PDF; memory DC only, never prints"]
    fn renders_to_memory_without_print_submission() {
        let _lock = crate::windows_print::PDF_LOCK.lock().unwrap();
        let dll = std::env::var("PLIFLO_PDFIUM_PREFIX").unwrap();
        let source = std::env::var("PLIFLO_TEST_PDF").unwrap();
        let pdf =
            Pdf::open_with_library(Path::new(&source), &Path::new(&dll).join("bin/pdfium.dll"))
                .unwrap();
        unsafe {
            let dc = CreateCompatibleDC(std::ptr::null_mut());
            assert!(!dc.is_null());
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: 900,
                    biHeight: -1200,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits = std::ptr::null_mut();
            let bitmap = CreateDIBSection(
                dc,
                &info,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            );
            assert!(!bitmap.is_null());
            let old = SelectObject(dc, bitmap);
            for index in 0..pdf.pages {
                PatBlt(dc, 0, 0, 900, 1200, WHITENESS);
                pdf.page(index)
                    .unwrap()
                    .render(dc, [0, 0, 900, 1200], 0, false);
                let pixels = std::slice::from_raw_parts(bits.cast::<u8>(), 900 * 1200 * 4);
                assert!(
                    pixels
                        .chunks_exact(4)
                        .any(|p| p[0] < 230 && p[1] < 230 && p[2] < 230),
                    "Blank page {index}"
                );
                if let Ok(directory) = std::env::var("PLIFLO_PDFIUM_TEST_OUTPUT") {
                    use std::io::Write;
                    let directory = Path::new(&directory);
                    std::fs::create_dir_all(directory).unwrap();
                    let mut image =
                        File::create(directory.join(format!("page-{index}.ppm"))).unwrap();
                    image.write_all(b"P6\n900 1200\n255\n").unwrap();
                    let rgb: Vec<u8> = pixels
                        .chunks_exact(4)
                        .flat_map(|p| [p[2], p[1], p[0]])
                        .collect();
                    image.write_all(&rgb).unwrap();
                }
            }
            SelectObject(dc, old);
            DeleteObject(bitmap);
            DeleteDC(dc);
        }
    }
}
