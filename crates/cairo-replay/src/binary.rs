use crate::protocol::{Operation, Recording};
use anyhow::{ensure, Context, Result};

/// 解码逐页二进制 IPC；JSON 格式继续供 CLI 和已有诊断使用。
pub fn decode_recording(bytes: &[u8]) -> Result<Recording> {
    let with_fonts = bytes.starts_with(b"CCP2");
    if !bytes.starts_with(b"CCP1") && !with_fonts {
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
    if with_fonts {
        let count = number(&mut rest)?;
        ensure!(
            count == page.fonts.len() && count <= 64,
            "Invalid font payload count"
        );
        let mut total = 0usize;
        for font in &mut page.fonts {
            let length = number(&mut rest)?;
            total += length;
            ensure!(total <= 64 * 1024 * 1024, "Embedded fonts too large");
            font.bytes = take(&mut rest, length)?.to_vec();
        }
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
    fn font_payloads_are_bounded_and_required() {
        let json = br#"{"version":1,"size":{"widthPt":100,"heightPt":100},"width":100,"height":100,"commands":[],"unsupported":[],"fonts":[{"family":"Fixture","weight":400,"style":"normal"}]}"#;
        let font = include_bytes!("../tests/fixtures/font-a.ttf");
        let mut wire = b"CCP2".to_vec();
        wire.extend_from_slice(&(json.len() as u32).to_le_bytes());
        wire.extend_from_slice(json);
        wire.extend_from_slice(&0u32.to_le_bytes());
        wire.extend_from_slice(&1u32.to_le_bytes());
        wire.extend_from_slice(&(font.len() as u32).to_le_bytes());
        let payload = wire.len();
        wire.extend_from_slice(font);
        assert_eq!(decode_recording(&wire).unwrap().fonts[0].bytes, font);
        for end in 4..wire.len() {
            assert!(
                decode_recording(&wire[..end]).is_err(),
                "accepted truncation {end}"
            );
        }
        wire[payload - 4..payload].copy_from_slice(&(65u32 * 1024 * 1024).to_le_bytes());
        assert!(decode_recording(&wire).is_err());
        wire[payload - 4..payload].copy_from_slice(&(font.len() as u32).to_le_bytes());
        wire[payload - 8..payload - 4].copy_from_slice(&0u32.to_le_bytes());
        assert!(decode_recording(&wire).is_err());
        assert!(decode_recording(json).unwrap().validate().is_err());
    }
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
