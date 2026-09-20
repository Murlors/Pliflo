use crate::protocol::{Operation, Recording};
use anyhow::{ensure, Context, Result};

/// 解码逐页二进制 IPC；JSON 格式继续供 CLI 和已有诊断使用。
pub fn decode_recording(bytes: &[u8]) -> Result<Recording> {
    if !bytes.starts_with(b"CCP1") {
        return serde_json::from_slice(bytes).context("Invalid recording JSON");
    }
    ensure!(bytes.len() <= 256 * 1024 * 1024, "Recording too large");
    let mut rest = &bytes[4..];
    fn take<'a>(rest: &mut &'a [u8], count: usize) -> Result<&'a [u8]> {
        ensure!(count <= rest.len(), "Truncated recording");
        let (head, tail) = rest.split_at(count);
        *rest = tail;
        Ok(head)
    }
    fn number(rest: &mut &[u8]) -> Result<usize> {
        Ok(u32::from_le_bytes(take(rest, 4)?.try_into()?) as usize)
    }
    let length = number(&mut rest)?;
    let mut page: Recording = serde_json::from_slice(take(&mut rest, length)?)?;
    let count = number(&mut rest)?;
    ensure!(count <= page.commands.len(), "Excess image payloads");
    let mut images = Vec::with_capacity(count);
    for _ in 0..count {
        let length = number(&mut rest)?;
        images.push(Some(take(&mut rest, length)?));
    }
    ensure!(rest.is_empty(), "Trailing recording data");
    for command in &mut page.commands {
        if let Operation::DrawImage(image, _) = &mut command.operation {
            let index: usize = image
                .png
                .strip_prefix("@binary:")
                .context("Expected binary image")?
                .parse()?;
            let bytes = images
                .get_mut(index)
                .and_then(Option::take)
                .context("Invalid or duplicate image reference")?;
            image.bytes = Some(bytes.to_vec());
            image.png.clear();
        }
    }
    ensure!(images.iter().all(Option::is_none), "Unused image payloads");
    page.validate()?;
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binary_boundaries_and_cancellation() {
        let json = br#"{"version":1,"size":{"widthPt":100,"heightPt":100},"width":200,"height":200,"commands":[],"unsupported":[]}"#;
        let mut wire = b"CCP1".to_vec();
        wire.extend_from_slice(&(json.len() as u32).to_le_bytes());
        wire.extend_from_slice(json);
        wire.extend_from_slice(&0u32.to_le_bytes());
        assert!(decode_recording(&wire).is_ok());
        for end in 4..wire.len() {
            assert!(decode_recording(&wire[..end]).is_err());
        }
        wire.push(1);
        assert!(decode_recording(&wire).is_err());
        wire.pop();
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("cancelled.pdf");
        let page = decode_recording(&wire).unwrap();
        assert!(crate::render_input_cancellable(
            crate::protocol::Input::Recording(page),
            &output,
            &Default::default(),
            || true
        )
        .is_err());
        assert!(!output.exists());
    }
}
