use crate::{checked_render_session, parsed_request_header, request_header};
use canvas_cairo_replay::{
    decode_recording,
    protocol::{Input, Manifest, Page},
    render_input_cancellable, RenderOptions,
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

/// 页命令通过 raw IPC 落盘；不接受前端提供的文件路径或清单。
#[tauri::command]
pub(crate) fn append_vector_pdf_page(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let session = request_header(&request, "x-pliflo-session")?;
    let index: usize = parsed_request_header(&request, "x-pliflo-index")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("Expected binary page IPC".into()),
    };
    if session.is_empty()
        || !session
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'-')
    {
        return Err("Invalid render session identifier".into());
    }
    let path = crate::rendered_root().join(session);
    let dir = checked_render_session(path.to_str().ok_or("Invalid render path")?)?;
    append_page(&dir, index, bytes)
}

fn append_page(dir: &Path, index: usize, bytes: &[u8]) -> Result<(), String> {
    if index >= 100_000 || bytes.len() > 256 * 1024 * 1024 {
        return Err("Page exceeds render limits".into());
    }
    if dir.join("cancelled").exists() {
        return Err("Rendering cancelled".into());
    }
    if index > 0 && !dir.join(format!("page-{:06}.ccp", index - 1)).is_file() {
        return Err("Page out of order".into());
    }
    let page = decode_recording(bytes).map_err(|error| format!("Invalid page: {error:#}"))?;
    page.validate()
        .map_err(|error| format!("Invalid page: {error:#}"))?;
    let path = dir.join(format!("page-{index:06}.ccp"));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn finish(dir: &Path, count: usize) -> Result<String, String> {
    if count == 0 || count > 100_000 {
        return Err("Invalid page count".into());
    }
    let pages = (0..count)
        .map(|index| {
            let path = dir.join(format!("page-{index:06}.ccp"));
            let actual = path.canonicalize().map_err(|e| e.to_string())?;
            if actual.parent() != Some(dir) {
                return Err("Page outside render session".into());
            }
            Ok(Page::Path(actual))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let output = dir.join("printable.pdf");
    render_input_cancellable(
        Input::Manifest(Manifest { pages }),
        &output,
        &RenderOptions::default(),
        || dir.join("cancelled").exists(),
    )
    .map_err(|error| format!("PDF rendering failed: {error:#}"))?;
    for index in 0..count {
        let _ = fs::remove_file(dir.join(format!("page-{index:06}.ccp")));
    }
    Ok(output.to_string_lossy().into())
}

#[tauri::command]
pub(crate) async fn finalize_vector_pdf(session: String, count: usize) -> Result<String, String> {
    let dir = checked_render_session(&session)?;
    tauri::async_runtime::spawn_blocking(move || finish(&dir, count))
        .await
        .map_err(|e| e.to_string())?
}

/// 只设置取消标记；绘图线程结束后再由调用方清理，避免删除仍在使用的文件。
#[tauri::command]
pub(crate) fn cancel_vector_pdf(session: String) -> Result<(), String> {
    let dir = checked_render_session(&session)?;
    fs::write(dir.join("cancelled"), []).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn empty_page(width: u32) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({ "version": 1, "width": width * 2, "height": 1600, "size": {"widthPt":width,"heightPt":800}, "commands":[], "unsupported":[] })).unwrap()
    }
    #[test]
    fn session_order_dimensions_overwrite_and_cancellation() {
        let dir = crate::create_rendered_dir()
            .unwrap()
            .canonicalize()
            .unwrap();
        let root = super::super::rendered_root();
        assert!(crate::checked_render_session(root.to_str().unwrap()).is_err());
        assert!(append_page(&dir, 1, &empty_page(400)).is_err());
        append_page(&dir, 0, &empty_page(400)).unwrap();
        assert!(append_page(&dir, 0, &empty_page(500)).is_err());
        append_page(&dir, 1, &empty_page(600)).unwrap();
        let output = finish(&dir, 2).unwrap();
        let pdf = lopdf::Document::load(&output).unwrap();
        assert_eq!(pdf.get_pages().len(), 2);
        for (id, expected) in pdf.get_pages().values().zip([400i64, 600]) {
            let page = pdf.get_object(*id).unwrap().as_dict().unwrap();
            assert_eq!(
                page.get(b"MediaBox").unwrap().as_array().unwrap()[2]
                    .as_i64()
                    .unwrap(),
                expected
            );
        }
        assert!(!dir.join("page-000000.ccp").exists());
        assert!(finish(&dir, 2).is_err());
        fs::remove_dir_all(&dir).unwrap();
        let dir = crate::create_rendered_dir()
            .unwrap()
            .canonicalize()
            .unwrap();
        append_page(&dir, 0, &empty_page(400)).unwrap();
        fs::write(dir.join("cancelled"), []).unwrap();
        assert!(append_page(&dir, 1, &empty_page(400)).is_err());
        assert!(finish(&dir, 1).is_err());
        assert!(!dir.join("printable.pdf").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
