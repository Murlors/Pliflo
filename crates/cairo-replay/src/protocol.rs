//! Recording v1 的严格解码；先验证整页，再交给原生绘图接口。
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// 限制进入 Cairo/Pango 的几何数值，避免有限 JSON 数值在原生定点运算中溢出。
pub const MAX_NUMBER: f64 = 1_000_000.0;

pub(crate) fn bounded(value: f64, name: &str) -> Result<()> {
    ensure!(
        value.is_finite() && value.abs() <= MAX_NUMBER,
        "{name} must be finite and within +/-{MAX_NUMBER}"
    );
    Ok(())
}

pub(crate) fn positive(value: f64, name: &str) -> Result<()> {
    bounded(value, name)?;
    ensure!(value > 0.0, "{name} must be positive");
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Size {
    pub width_pt: f64,
    pub height_pt: f64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Recording {
    pub version: u32,
    pub size: Size,
    pub width: f64,
    pub height: f64,
    pub commands: Vec<Command>,
    pub unsupported: Vec<String>,
    pub index: Option<u32>,
    pub source_pages: Option<u32>,
    pub reference: Option<String>,
}

impl Recording {
    /// 包括通过 Rust 直接构造的值在内，所有入口都必须经过验证。
    pub fn validate(&self) -> Result<()> {
        ensure!(self.version == 1, "Only recording version 1 is supported");
        ensure!(
            self.unsupported.is_empty(),
            "Recording contains unsupported operations"
        );
        positive(self.size.width_pt, "size.widthPt")?;
        positive(self.size.height_pt, "size.heightPt")?;
        positive(self.width, "width")?;
        positive(self.height, "height")?;
        let scale = self.size.width_pt / self.width;
        positive(scale, "page scale")?;
        if let Some(count) = self.source_pages {
            ensure!(count > 0, "sourcePages must be positive");
            ensure!(
                self.index.is_none_or(|index| index < count),
                "index must be below sourcePages"
            );
        }
        let mut depth = 0usize;
        for (index, command) in self.commands.iter().enumerate() {
            command
                .validate(scale)
                .with_context(|| format!("command {index}"))?;
            match command.operation {
                Operation::Save => depth += 1,
                Operation::Restore => {
                    ensure!(depth > 0, "command {index}: Unbalanced restore");
                    depth -= 1;
                }
                _ => {}
            }
        }
        ensure!(depth == 0, "Unbalanced saves");
        Ok(())
    }
}

/// Manifest paths are relative to the working directory, not the manifest directory.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Page {
    Path(std::path::PathBuf),
    Inline(Recording),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub pages: Vec<Page>,
}

#[derive(Debug)]
pub enum Input {
    Recording(Recording),
    Manifest(Manifest),
}

impl<'de> Deserialize<'de> for Input {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        if value.get("pages").is_some() {
            serde_json::from_value(value)
                .map(Self::Manifest)
                .map_err(serde::de::Error::custom)
        } else {
            serde_json::from_value(value)
                .map(Self::Recording)
                .map_err(serde::de::Error::custom)
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Cap {
    Butt,
    Round,
    Square,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Join {
    Miter,
    Round,
    Bevel,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rule {
    Nonzero,
    Evenodd,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct State {
    pub matrix: [f64; 6],
    pub fill: String,
    pub stroke: String,
    pub alpha: f64,
    pub line_width: f64,
    pub line_cap: Cap,
    pub line_join: Join,
    pub miter_limit: f64,
    pub dash: Vec<f64>,
    pub dash_offset: f64,
    pub font: String,
    pub baseline: String,
    pub align: String,
    pub composite: String,
    pub shadow_blur: f64,
    pub shadow_offset_x: f64,
    pub shadow_offset_y: f64,
    pub shadow_color: String,
}

impl State {
    fn validate(&self, scale: f64) -> Result<()> {
        for value in self.matrix {
            bounded(value, "matrix")?;
            bounded(value * scale, "scaled matrix")?;
        }
        let [a, b, c, d, _, _] = self.matrix;
        let determinant = a * d - b * c;
        ensure!(
            determinant.is_finite() && determinant != 0.0,
            "Singular transform is unsupported"
        );
        // Cairo 会求逆；极小但非零的矩阵同样可能溢出。
        for value in [a, b, c, d] {
            ensure!(
                (value / determinant / scale).is_finite(),
                "Transform inverse overflows"
            );
        }
        ensure!(
            self.alpha.is_finite() && (0.0..=1.0).contains(&self.alpha),
            "alpha must be in [0,1]"
        );
        positive(self.line_width, "lineWidth")?;
        positive(self.miter_limit, "miterLimit")?;
        bounded(self.dash_offset, "dashOffset")?;
        for value in &self.dash {
            bounded(*value, "dash")?;
            ensure!(*value >= 0.0, "Negative dash length");
        }
        if !self.dash.is_empty() {
            positive(self.dash.iter().sum(), "dash total")?;
        }
        ensure!(self.composite == "source-over", "Composite unsupported");
        ensure!(
            self.shadow_blur == 0.0 && self.shadow_offset_x == 0.0 && self.shadow_offset_y == 0.0,
            "Shadow unsupported"
        );
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Image {
    pub png: String,
    #[serde(skip)]
    pub bytes: Option<Vec<u8>>,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug)]
pub enum Operation {
    Save,
    Restore,
    BeginPath,
    ClosePath,
    Rect([f64; 4]),
    MoveTo([f64; 2]),
    LineTo([f64; 2]),
    Clip(Rule),
    Fill(Rule),
    Stroke,
    ClearRect([f64; 4]),
    StrokeRect([f64; 4]),
    FillRect([f64; 4]),
    FillText(String, f64, f64),
    DrawImage(Image, [f64; 4]),
}

#[derive(Debug)]
pub struct Command {
    pub operation: Operation,
    pub state: Option<State>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCommand {
    op: String,
    args: Value,
    state: Option<State>,
}

impl<'de> Deserialize<'de> for Command {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let raw = RawCommand::deserialize(deserializer)?;
        Self::decode(raw).map_err(serde::de::Error::custom)
    }
}

impl Command {
    fn decode(raw: RawCommand) -> Result<Self> {
        let a = raw.args;
        let operation = match raw.op.as_str() {
            "save" | "restore" | "beginPath" | "closePath" | "stroke" => {
                let _: [f64; 0] = serde_json::from_value(a).context("Expected empty args")?;
                match raw.op.as_str() {
                    "save" => Operation::Save,
                    "restore" => Operation::Restore,
                    "beginPath" => Operation::BeginPath,
                    "closePath" => Operation::ClosePath,
                    _ => Operation::Stroke,
                }
            }
            "rect" => Operation::Rect(serde_json::from_value(a)?),
            "moveTo" => Operation::MoveTo(serde_json::from_value(a)?),
            "lineTo" => Operation::LineTo(serde_json::from_value(a)?),
            "clearRect" => Operation::ClearRect(serde_json::from_value(a)?),
            "strokeRect" => Operation::StrokeRect(serde_json::from_value(a)?),
            "fillRect" => Operation::FillRect(serde_json::from_value(a)?),
            "clip" | "fill" => {
                let rules: Vec<Rule> = serde_json::from_value(a)?;
                ensure!(rules.len() <= 1, "Expected zero or one fill rule");
                let rule = rules.first().copied().unwrap_or(Rule::Nonzero);
                if raw.op == "clip" {
                    Operation::Clip(rule)
                } else {
                    Operation::Fill(rule)
                }
            }
            "fillText" => {
                let (text, x, y): (String, f64, f64) = serde_json::from_value(a)
                    .context("Expected text,x,y; maxWidth is unsupported")?;
                Operation::FillText(text, x, y)
            }
            "drawImage" => {
                let (image, x, y, w, h): (Image, f64, f64, f64, f64) =
                    serde_json::from_value(a).context("Only five-argument drawImage supported")?;
                Operation::DrawImage(image, [x, y, w, h])
            }
            _ => bail!("Unsupported operation: {}", raw.op),
        };
        Ok(Self {
            operation,
            state: raw.state,
        })
    }

    fn validate(&self, scale: f64) -> Result<()> {
        if matches!(self.operation, Operation::Save | Operation::Restore) {
            return Ok(());
        }
        let state = self.state.as_ref().context("Missing command state")?;
        state.validate(scale)?;
        match &self.operation {
            Operation::Rect(a)
            | Operation::ClearRect(a)
            | Operation::StrokeRect(a)
            | Operation::FillRect(a) => {
                for value in a {
                    bounded(*value, "rectangle")?;
                }
            }
            Operation::MoveTo(a) | Operation::LineTo(a) => {
                for value in a {
                    bounded(*value, "point")?;
                }
            }
            Operation::FillText(text, x, y) => {
                bounded(*x, "text x")?;
                bounded(*y, "text y")?;
                ensure!(!text.contains('\0'), "NUL in text is unsupported");
                ensure!(
                    text.len() <= i32::MAX as usize,
                    "Text exceeds Pango length limit"
                );
                ensure!(
                    ["alphabetic", "top", "middle", "bottom"].contains(&state.baseline.as_str()),
                    "Unsupported text baseline"
                );
                ensure!(
                    ["left", "start", "right", "center"].contains(&state.align.as_str()),
                    "Unsupported text alignment"
                );
                crate::text::parse_font(&state.font, &Default::default())?;
            }
            Operation::DrawImage(image, a) => {
                positive(image.width, "image width")?;
                positive(image.height, "image height")?;
                ensure!(
                    image.width.fract() == 0.0 && image.height.fract() == 0.0,
                    "Image dimensions must be integers"
                );
                for value in a {
                    bounded(*value, "image rectangle")?;
                }
                ensure!(
                    a[2] != 0.0 && a[3] != 0.0,
                    "Zero image destination size is unsupported"
                );
            }
            _ => {}
        }
        match self.operation {
            Operation::Fill(_) | Operation::FillRect(_) | Operation::FillText(..) => {
                rgb(&state.fill)?;
            }
            Operation::Stroke | Operation::StrokeRect(_) => {
                rgb(&state.stroke)?;
            }
            _ => {}
        }
        Ok(())
    }
}

pub(crate) fn rgb(value: &str) -> Result<[f64; 3]> {
    ensure!(
        value.len() == 7
            && value.starts_with('#')
            && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit),
        "Only #RRGGBB colors supported"
    );
    let n = u32::from_str_radix(&value[1..], 16)?;
    Ok([
        ((n >> 16) & 255) as f64 / 255.0,
        ((n >> 8) & 255) as f64 / 255.0,
        (n & 255) as f64 / 255.0,
    ])
}
