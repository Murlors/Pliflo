use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use canvas_cairo_replay::{
    protocol::{Input, Recording},
    render_file, render_input, RenderOptions,
};
use serde_json::{json, Value};
use tempfile::{tempdir, TempDir};

fn state() -> Value {
    json!({"matrix":[1,0,0,1,0,0],"fill":"#123456","stroke":"#abcdef","alpha":1,
        "lineWidth":1,"lineCap":"butt","lineJoin":"miter","miterLimit":10,"dash":[],"dashOffset":0,
        "font":"12px sans-serif","baseline":"alphabetic","align":"start","composite":"source-over",
        "shadowBlur":0,"shadowOffsetX":0,"shadowOffsetY":0,"shadowColor":"rgba(0, 0, 0, 0)"})
}

fn command(op: &str, args: Value) -> Value {
    json!({"op":op,"args":args,"state":state()})
}

fn page(commands: Vec<Value>) -> Value {
    json!({"version":1,"size":{"widthPt":200,"heightPt":300},"width":400,"height":600,
        "index":0,"sourcePages":1,"commands":commands,"unsupported":[]})
}

fn write_json(path: &Path, value: &Value) {
    fs::write(path, serde_json::to_vec(value).unwrap()).unwrap();
}

fn invoke(root: &TempDir, value: &Value, filename: &str) -> Output {
    let input = root.path().join("input.json");
    write_json(&input, value);
    Command::new(env!("CARGO_BIN_EXE_canvas-cairo-pdf"))
        .env_remove("PLIFLO_FONT_ALIASES")
        .env_remove("PLIFLO_FONT_DIAGNOSTICS")
        .arg(input)
        .arg(root.path().join(filename))
        .output()
        .unwrap()
}

fn rejects(value: Value) {
    let root = tempdir().unwrap();
    let result = invoke(&root, &value, "bad.pdf");
    assert!(!result.status.success(), "accepted {value}");
    assert!(!root.path().join("bad.pdf").exists());
    assert!(!result.stderr.is_empty());
}

#[test]
fn embedded_font_survives_multiple_pages_and_pdf_text_mapping() {
    let root = tempdir().unwrap();
    let mut first = page(vec![command("fillText", json!(["A中", 20, 30]))]);
    first["commands"][0]["state"]["font"] = json!("12px Document Fixture");
    let second = first.clone();
    first["fonts"] = json!([{"family":"Document Fixture","weight":400,"style":"normal"}]);
    let json = serde_json::to_vec(&first).unwrap();
    let font = include_bytes!("fixtures/font-a.ttf");
    let mut bytes = b"CCP2".to_vec();
    bytes.extend_from_slice(&(json.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&json);
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&1u32.to_le_bytes());
    bytes.extend_from_slice(&(font.len() as u32).to_le_bytes());
    bytes.extend_from_slice(font);
    let first_path = root.path().join("first.ccp");
    fs::write(&first_path, bytes).unwrap();
    let second_path = root.path().join("second.json");
    write_json(&second_path, &second);
    let input = root.path().join("manifest.json");
    write_json(&input, &json!({"pages":[first_path, second_path]}));
    let output = root.path().join("embedded.pdf");
    let report = render_file(
        input,
        &output,
        &RenderOptions {
            font_diagnostics: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(report.pages, 2);
    assert!(report
        .fonts
        .iter()
        .all(|font| font.actual.contains("Pliflo Fixture")));
    let pdf = lopdf::Document::load(output).unwrap();
    for index in [1, 2] {
        assert!(pdf.extract_text(&[index]).unwrap().contains("A中"));
    }
    assert!(!fs::read_dir(root.path()).unwrap().any(|file| file
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("fonts-")));
}

#[test]
fn rejects_malformed_protocol_before_native_calls() {
    let valid = page(vec![command("fillRect", json!([0, 0, 20, 20]))]);
    for (key, value) in [
        ("version", json!(2)),
        ("version", json!(true)),
        ("version", json!("1")),
        ("width", json!(0)),
        ("height", json!(-1)),
        ("width", json!(1e100)),
        ("unsupported", json!(["Path2D"])),
        ("unsupported", json!({})),
        ("commands", json!(null)),
        ("sourcePages", json!(0)),
        ("index", json!(1)),
    ] {
        let mut bad = valid.clone();
        bad[key] = value;
        rejects(bad);
    }
    for key in [
        "version",
        "width",
        "height",
        "size",
        "commands",
        "unsupported",
    ] {
        let mut bad = valid.clone();
        bad.as_object_mut().unwrap().remove(key);
        rejects(bad);
    }
    let mut bad = valid.clone();
    bad["size"]["heightPt"] = json!(0);
    rejects(bad);
    let mut bad = valid.clone();
    bad["surprise"] = json!(1);
    rejects(bad);
    for args in [
        json!([]),
        json!([1, 2, 3]),
        json!([1, 2, 3, 4, 5]),
        json!([true, 0, 2, 2]),
        json!(["1", 0, 2, 2]),
        json!([null, 0, 2, 2]),
    ] {
        rejects(page(vec![command("fillRect", args)]));
    }
    for op in ["arc", "bezierCurveTo", "strokeText", "unknown"] {
        rejects(page(vec![command(op, json!([]))]));
    }
    for args in [json!(["bad-rule"]), json!(["evenodd", "nonzero"])] {
        rejects(page(vec![command("fill", args)]));
    }
    rejects(page(vec![command("save", json!([0]))]));
    rejects(page(vec![command("fillText", json!(["text", 0, 0, 20]))]));
    rejects(json!({"pages":[]}));
    rejects(json!({"pages":[null]}));
    rejects(json!({"pages":[],"commands":[]}));
}

#[test]
fn rejects_invalid_state_and_unbalanced_stack() {
    for (key, value) in [
        ("matrix", json!([1, 0, 0, 1, 0])),
        ("matrix", json!([0, 0, 0, 0, 0, 0])),
        ("matrix", json!([1e100, 0, 0, 1, 0, 0])),
        ("alpha", json!(-0.1)),
        ("alpha", json!(1.1)),
        ("lineWidth", json!(0)),
        ("lineCap", json!("flat")),
        ("lineJoin", json!("bad")),
        ("miterLimit", json!(-1)),
        ("dash", json!([0, 0])),
        ("dash", json!([-1, 2])),
        ("dashOffset", json!(1e100)),
        ("composite", json!("copy")),
        ("shadowBlur", json!(1)),
        ("shadowOffsetX", json!(1)),
        ("shadowOffsetY", json!(1)),
        ("fill", json!("#12345x")),
        ("fill", json!("#123")),
        ("fill", json!("red")),
    ] {
        let mut cmd = command("fillRect", json!([0, 0, 10, 10]));
        cmd["state"][key] = value;
        rejects(page(vec![cmd]));
    }
    for key in ["baseline", "align"] {
        let mut cmd = command("fillText", json!(["text", 0, 0]));
        cmd["state"][key] = json!("unsupported");
        rejects(page(vec![cmd]));
    }
    rejects(page(vec![command("restore", json!([]))]));
    rejects(page(vec![command("save", json!([]))]));
    let mut cmd = command("beginPath", json!([]));
    cmd.as_object_mut().unwrap().remove("state");
    rejects(page(vec![cmd]));
}

#[test]
fn rust_values_cannot_bypass_finite_validation() {
    let root = tempdir().unwrap();
    for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e100, 0.0, -1.0] {
        let mut recording: Recording = serde_json::from_value(page(vec![])).unwrap();
        recording.size.width_pt = number;
        let output = root.path().join("bad.pdf");
        assert!(render_input(
            Input::Recording(recording),
            &output,
            &RenderOptions::default()
        )
        .is_err());
        assert!(!output.exists());
    }
    let mut recording: Recording =
        serde_json::from_value(page(vec![command("fillRect", json!([0, 0, 10, 10]))])).unwrap();
    recording.commands[0].state.as_mut().unwrap().matrix[0] = f64::NAN;
    assert!(recording.validate().is_err());
}

#[test]
fn cli_never_overwrites_existing_pdf_or_non_pdf() {
    let root = tempdir().unwrap();
    let output = root.path().join("existing.pdf");
    fs::write(&output, b"keep exactly").unwrap();
    let result = invoke(&root, &page(vec![]), "existing.pdf");
    assert_eq!(result.status.code(), Some(2));
    assert_eq!(fs::read(&output).unwrap(), b"keep exactly");
    let input: Input = serde_json::from_value(page(vec![])).unwrap();
    assert!(render_input(input, &output, &RenderOptions::default()).is_err());
    assert_eq!(fs::read(&output).unwrap(), b"keep exactly");
    let result = invoke(&root, &page(vec![]), "bad.txt");
    assert_eq!(result.status.code(), Some(2));
    assert!(!root.path().join("bad.txt").exists());
    fs::create_dir(root.path().join("directory.pdf")).unwrap();
    assert!(!invoke(&root, &page(vec![]), "directory.pdf")
        .status
        .success());
    assert!(root.path().join("directory.pdf").is_dir());
    let result = Command::new(env!("CARGO_BIN_EXE_canvas-cairo-pdf"))
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
}

#[cfg(unix)]
#[test]
fn dangling_and_existing_symlinks_are_not_followed_or_deleted() {
    use std::os::unix::fs::symlink;
    let root = tempdir().unwrap();
    for existing in [false, true] {
        let target = root.path().join(if existing {
            "existing-target"
        } else {
            "missing-target"
        });
        if existing {
            fs::write(&target, b"original").unwrap();
        }
        let output = root.path().join(if existing {
            "existing.pdf"
        } else {
            "dangling.pdf"
        });
        symlink(&target, &output).unwrap();
        let input: Input = serde_json::from_value(page(vec![])).unwrap();
        assert!(render_input(input, &output, &RenderOptions::default()).is_err());
        assert!(output.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(target.exists(), existing);
        if existing {
            assert_eq!(fs::read(target).unwrap(), b"original");
        }
    }
}

#[test]
fn concurrent_writers_have_exactly_one_winner() {
    let root = tempdir().unwrap();
    let input = root.path().join("input.json");
    write_json(&input, &page(vec![]));
    let launch = || {
        Command::new(env!("CARGO_BIN_EXE_canvas-cairo-pdf"))
            .env_remove("PLIFLO_FONT_ALIASES")
            .env_remove("PLIFLO_FONT_DIAGNOSTICS")
            .args([&input, &root.path().join("race.pdf")])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap()
    };
    let mut first = launch();
    let mut second = launch();
    assert_ne!(
        first.wait().unwrap().success(),
        second.wait().unwrap().success()
    );
    assert!(fs::read(root.path().join("race.pdf"))
        .unwrap()
        .starts_with(b"%PDF-"));
}

#[test]
fn cleans_partial_pdf_after_later_page_read_or_image_failure() {
    let root = tempdir().unwrap();
    let first = page(vec![command("fillRect", json!([0, 0, 20, 20]))]);
    let bad_image = page(vec![command(
        "drawImage",
        json!([{"png":"invalid","width":1,"height":1},0,0,20,20]),
    )]);
    for next in [
        json!(root.path().join("missing.json")),
        bad_image,
        json!({"version":2}),
    ] {
        let result = invoke(&root, &json!({"pages":[first,next]}), "partial.pdf");
        assert!(!result.status.success());
        assert!(!root.path().join("partial.pdf").exists());
    }
    // Path manifest defers validation of later files until the first page has been drawn.
    write_json(&root.path().join("bad.json"), &json!({"version":2}));
    let result = invoke(
        &root,
        &json!({"pages":[first,root.path().join("bad.json")]}),
        "partial.pdf",
    );
    assert!(!result.status.success());
    assert!(!root.path().join("partial.pdf").exists());
}

fn png() -> String {
    let surface = cairo::ImageSurface::create(cairo::Format::ARgb32, 2, 2).unwrap();
    let cr = cairo::Context::new(&surface).unwrap();
    cr.set_source_rgb(1.0, 0.0, 0.0);
    cr.paint().unwrap();
    let mut bytes = Vec::new();
    surface.write_to_png(&mut bytes).unwrap();
    STANDARD.encode(bytes)
}

#[test]
fn supported_operations_mixed_page_sizes_and_relative_manifest_paths() {
    let root = tempdir().unwrap();
    let commands = vec![
        command("save", json!([])),
        command("beginPath", json!([])),
        command("rect", json!([0, 0, 400, 600])),
        command("clip", json!(["evenodd"])),
        command("beginPath", json!([])),
        command("moveTo", json!([10, 10])),
        command("lineTo", json!([100, 100])),
        command("lineTo", json!([200, 10])),
        command("closePath", json!([])),
        command("fill", json!([])),
        command("stroke", json!([])),
        command("fillRect", json!([10, 20, 30, 40])),
        command("strokeRect", json!([20, 30, 40, 50])),
        command("clearRect", json!([20, 30, 5, 5])),
        command("fillText", json!(["Portable renderer", 20, 100])),
        command(
            "drawImage",
            json!([{"png":png(),"width":2,"height":2},100,100,20,20]),
        ),
        command("restore", json!([])),
    ];
    let first = page(commands);
    let mut second = page(vec![]);
    second["size"] = json!({"widthPt":400,"heightPt":150});
    write_json(&root.path().join("page.json"), &first);
    fs::create_dir(root.path().join("sub")).unwrap();
    // Deliberately place manifest elsewhere: relative paths must resolve from cwd.
    write_json(
        &root.path().join("sub/manifest.json"),
        &json!({"pages":["page.json",second]}),
    );
    let result = Command::new(env!("CARGO_BIN_EXE_canvas-cairo-pdf"))
        .env_remove("PLIFLO_FONT_ALIASES")
        .env_remove("PLIFLO_FONT_DIAGNOSTICS")
        .current_dir(root.path())
        .args(["sub/manifest.json", "mixed.PDF"])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let pdf = lopdf::Document::load(root.path().join("mixed.PDF")).unwrap();
    let pages = pdf.get_pages();
    assert_eq!(pages.len(), 2);
    for (number, size) in [(1, [0, 0, 200, 300]), (2, [0, 0, 400, 150])] {
        let page = pdf.get_object(pages[&number]).unwrap().as_dict().unwrap();
        let actual: Vec<_> = page
            .get(b"MediaBox")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect();
        assert_eq!(actual, size);
    }
    // clearRect 可让 Cairo 把内容放入 Form XObject；必须包含嵌套资源。
    let original_image_count = pdf
        .objects
        .values()
        .filter(|object| {
            object.as_stream().is_ok_and(|stream| {
                stream
                    .dict
                    .get(b"Subtype")
                    .ok()
                    .and_then(|v| v.as_name().ok())
                    == Some(b"Image".as_slice())
                    && stream.dict.get(b"Width").ok().and_then(|v| v.as_i64().ok()) == Some(2)
                    && stream
                        .dict
                        .get(b"Height")
                        .ok()
                        .and_then(|v| v.as_i64().ok())
                        == Some(2)
            })
        })
        .count();
    assert_eq!(original_image_count, 1);
}

#[test]
fn image_metadata_must_match_and_data_must_decode() {
    for image in [
        json!({"png":png(),"width":1,"height":1}),
        json!({"png":"","width":2,"height":2}),
        json!({"png":png(),"width":0,"height":2}),
        json!({"png":png(),"width":2.5,"height":2}),
    ] {
        rejects(page(vec![command(
            "drawImage",
            json!([image, 0, 0, 20, 20]),
        )]));
    }
}

#[test]
fn text_baselines_alias_fallback_and_diagnostics_do_not_leak_text() {
    let root = tempdir().unwrap();
    let secret = "Private document text";
    let mut commands = Vec::new();
    for baseline in ["alphabetic", "top", "middle", "bottom"] {
        for align in ["left", "start", "right", "center"] {
            let mut cmd = command("fillText", json!([secret, 100, 100]));
            cmd["state"]["baseline"] = json!(baseline);
            cmd["state"]["align"] = json!(align);
            cmd["state"]["font"] = json!("italic 600 12px MissingPlifloTestFamily, sans-serif");
            commands.push(cmd);
        }
    }
    let input = root.path().join("text.json");
    write_json(&input, &page(commands));
    let aliases = root.path().join("aliases.json");
    write_json(&aliases, &json!({"MissingPlifloTestFamily":"serif"}));
    let result = Command::new(env!("CARGO_BIN_EXE_canvas-cairo-pdf"))
        .env("PLIFLO_FONT_DIAGNOSTICS", "1")
        .env("PLIFLO_FONT_ALIASES", aliases)
        .args([&input, &root.path().join("text.pdf")])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let stderr = String::from_utf8(result.stderr).unwrap();
    assert!(stderr.starts_with("FONT "));
    assert!(stderr.contains(" => "));
    assert!(!stderr.contains(secret));
    let lines: Vec<_> = stderr.lines().collect();
    let unique: std::collections::BTreeSet<_> = lines.iter().collect();
    assert_eq!(lines.len(), unique.len());
    let report = render_file(
        input,
        root.path().join("library.pdf"),
        &RenderOptions {
            font_diagnostics: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(report.pages, 1);
    assert!(!report.fonts.is_empty());
    let pdf = lopdf::Document::load(root.path().join("library.pdf")).unwrap();
    let extracted = pdf.extract_text(&[1]).unwrap();
    let compact = |s: &str| s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
    assert!(
        compact(&extracted).contains(&compact(secret)),
        "{extracted:?}"
    );
}

#[test]
fn invalid_alias_files_fail_without_output() {
    let root = tempdir().unwrap();
    let input = root.path().join("page.json");
    write_json(&input, &page(vec![]));
    let aliases = root.path().join("aliases.json");
    for value in [
        json!([]),
        json!({"serif":3}),
        json!({"serif":""}),
        json!({"serif":"   "}),
        json!({"serif":"bad\0font"}),
    ] {
        write_json(&aliases, &value);
        let result = Command::new(env!("CARGO_BIN_EXE_canvas-cairo-pdf"))
            .env("PLIFLO_FONT_ALIASES", &aliases)
            .args([&input, &root.path().join("aliases.pdf")])
            .output()
            .unwrap();
        assert!(!result.status.success());
        assert!(!root.path().join("aliases.pdf").exists());
    }
}
