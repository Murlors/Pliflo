use super::*;
#[test]
fn cancellation_during_each_spool_step_stops_following_operations() {
    let output = vec![vec![0, 1], vec![2]];
    let mut reference = Vec::new();
    run_spool(&output, &Work::default(), |step| {
        reference.push(step);
        Ok(())
    })
    .unwrap();
    for stop in 0..reference.len() {
        let work = Work::default();
        let mut seen = Vec::new();
        let result = run_spool(&output, &work, |step| {
            seen.push(step);
            if seen.len() == stop + 1 {
                work.cancel.store(true, Ordering::Release);
            }
            Ok(())
        });
        assert_eq!(result.unwrap_err(), "Cancelled");
        assert_eq!(seen, reference[..=stop]);
    }
    let work = Work::default();
    work.cancel.store(true, Ordering::Release);
    assert!(run_spool(&output, &work, |_| panic!("Already cancelled job executed")).is_err());
}
#[test]
fn driver_failure_stops_remaining_pages_and_end_document() {
    for failed in [
        SpoolStep::StartPage,
        SpoolStep::Draw { slot: 0, index: 0 },
        SpoolStep::EndPage,
        SpoolStep::EndDocument,
    ] {
        let mut seen = Vec::new();
        let result = run_spool(&[vec![0], vec![1]], &Work::default(), |step| {
            seen.push(step);
            if step == failed {
                Err("injected driver failure".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(result.unwrap_err(), "injected driver failure");
        assert_eq!(seen.last(), Some(&failed));
    }
}
fn settings() -> PrintSettings {
    PrintSettings {
        copies: 1,
        duplex: "none".into(),
        color: "auto".into(),
        orientation: "auto".into(),
        media: "A4".into(),
        scale: "fit".into(),
        page_range: "".into(),
        pages_per_sheet: 1,
        reverse: false,
        page_set: "all".into(),
        tray: "".into(),
        quality: "printer".into(),
    }
}
#[test]
fn ranges_follow_nup_output_sides() {
    let mut s = settings();
    s.pages_per_sheet = 2;
    s.page_range = "2-4".into();
    s.page_set = "even".into();
    s.reverse = true;
    assert_eq!(plan(7, &s).unwrap(), vec![vec![6], vec![2, 3]]);
    s.page_range = "99".into();
    assert!(plan(7, &s).is_err());
    s.page_range = "0".into();
    assert!(plan(7, &s).is_err());
}
#[test]
fn spooler_delivery_is_not_completion() {
    assert_eq!(flags_state(JOB_STATUS_COMPLETE).0, "unknown");
    assert_eq!(flags_state(JOB_STATUS_PRINTED).0, "completed");
    assert_eq!(flags_state(JOB_STATUS_DELETING).0, "blocked");
    assert_eq!(flags_state(JOB_STATUS_DELETED).0, "unconfirmed");
    assert_eq!(flags_state(JOB_STATUS_PAPEROUT).0, "blocked");
    assert_eq!(flags_state(0).0, "submitted");
}
#[test]
fn identity_round_trip_and_rejection() {
    let id = Identity {
        printer: "办公室: HP-1".into(),
        number: 42,
        title: "Pliflo-1-234".into(),
    };
    let value = id.encode();
    let got = Identity::decode(&value).unwrap();
    assert_eq!(got.printer, id.printer);
    assert_eq!(got.number, 42);
    for bad in [
        "Office-42",
        "win:0:41:Pliflo-1",
        "win:2:zz:Pliflo-1",
        "win:2:00:Pliflo-1",
    ] {
        assert!(Identity::decode(bad).is_err());
    }
}
#[test]
fn fit_preserves_aspect_and_actual_size() {
    let (r, _) = placement((612., 792.), [0, 0, 1200, 1800], (144., 144.), true);
    assert!(r[2] <= 1200 && r[3] <= 1800);
    let (r, rot) = placement((72., 144.), [0, 0, 1000, 1000], (300., 300.), false);
    assert_eq!((r[2], r[3], rot), (300, 600, 0));
    let (r, rot) = placement((72., 144.), [0, 0, 1200, 600], (600., 300.), true);
    assert_eq!((r[2], r[3], rot), (600, 600, 0));
}
#[test]
fn accepts_frontend_color_values_and_rejects_unknown_settings() {
    let mut s = settings();
    for value in ["auto", "color", "grayscale"] {
        s.color = value.into();
        assert!(plan(1, &s).is_ok());
    }
    s.color = "mono".into();
    assert!(plan(1, &s).is_err());
    s.color = "auto".into();
    s.quality = "high".into();
    assert!(plan(1, &s).is_err());
}
#[test]
#[ignore = "Read-only DEVMODE validation; never calls StartDoc"]
fn validates_local_driver_without_submission() {
    for landscape in [false, true] {
        for color in ["auto", "color", "grayscale"] {
            let mut s = settings();
            s.color = color.into();
            let dc = device("Microsoft Print to PDF", &s, landscape).unwrap();
            assert!(!dc.0.is_null());
        }
    }
    let id = Identity {
        printer: "Microsoft Print to PDF".into(),
        number: u32::MAX,
        title: "Pliflo-test-missing".into(),
    }
    .encode();
    assert_eq!(job(&id).unwrap().state, "unconfirmed");
}

#[test]
#[ignore = "SUBMITS TWO VIRTUAL JOBS: requires explicit user authorization and one-use temp root"]
fn authorized_virtual_print_two_jobs() {
    use std::{
        fs,
        io::Write,
        time::{Duration, Instant},
    };
    assert_eq!(
        std::env::var("PLIFLO_ALLOW_VIRTUAL_PRINT").as_deref(),
        Ok("two-jobs-authorized")
    );
    let root = fs::canonicalize(std::env::var("PLIFLO_VIRTUAL_PRINT_TEST_ROOT").unwrap()).unwrap();
    let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
    assert!(root.starts_with(&temp) && root != temp);
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("pliflo-authorized-print-"));
    let source = root.join("source.pdf");
    let expected = lopdf::Document::load(&source).unwrap().get_pages().len();
    assert_eq!(expected, 3, "Use the original synthetic three-page fixture");
    let printer_name = "Microsoft Print to PDF";
    let printer = Printer::open(printer_name).unwrap();
    let data = printer.info().unwrap();
    let info = unsafe { &*data.as_ptr().cast::<PRINTER_INFO_2W>() };
    assert!(unsafe { string(info.pDriverName) }.eq_ignore_ascii_case("Microsoft Print To PDF"));
    assert_eq!(unsafe { string(info.pPortName) }, "PORTPROMPT:");
    // The marker survives test failures. Never rerun this mutating test on the
    // same authorization/root; inspect recorded IDs before doing anything else.
    let mut log = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join("run.jsonl"))
        .unwrap();
    let mut record = |value: serde_json::Value| {
        let line = serde_json::to_string(&value).unwrap();
        writeln!(log, "{line}").unwrap();
        log.flush().unwrap();
        println!("{line}");
    };
    record(
        serde_json::json!({"event":"authorized-run-start","printer":printer_name,"expectedJobs":2,"sourcePages":expected}),
    );
    for cancelled in [false, true] {
        let output = root.join(if cancelled {
            "cancelled.pdf"
        } else {
            "printed.pdf"
        });
        assert!(!output.exists());
        let (resume, gate) = mpsc::channel();
        let started = Instant::now();
        record(serde_json::json!({"event":"calling-submit","cancelTest":cancelled}));
        let result = submit_inner(
            source.to_string_lossy().into(),
            printer_name.into(),
            settings(),
            Some(TestOutput {
                path: output.to_string_lossy().into(),
                resume: gate,
            }),
        )
        .unwrap();
        record(
            serde_json::json!({"event":"accepted","id":result.job_id,"ms":started.elapsed().as_millis(),"cancelTest":cancelled}),
        );
        let accepted = job(&result.job_id).unwrap();
        record(serde_json::json!({"event":"initial-status","status":accepted}));
        assert!(["submitted", "blocked", "printing"].contains(&accepted.state.as_str()));
        if cancelled {
            cancel(&result.job_id).unwrap();
            record(serde_json::json!({"event":"cancel-request-accepted","id":result.job_id}));
        }
        resume.send(()).unwrap();
        let mut previous = String::new();
        let final_status = loop {
            let status = job(&result.job_id).unwrap();
            if status.state != previous {
                record(
                    serde_json::json!({"event":"status","status":status,"ms":started.elapsed().as_millis()}),
                );
                previous = status.state.clone();
            }
            if !is_spooling()
                && ["completed", "unconfirmed", "cancelled", "failed"]
                    .contains(&status.state.as_str())
            {
                break status;
            }
            assert!(
                started.elapsed() < Duration::from_secs(90),
                "Timed out; inspect the recorded job ID, do not blindly resubmit"
            );
            std::thread::sleep(Duration::from_millis(100));
        };
        if cancelled {
            assert_eq!(final_status.state, "cancelled");
            assert!(
                lopdf::Document::load(&output).is_err(),
                "Cancelled job unexpectedly produced a complete PDF"
            );
        } else {
            assert!(["completed", "unconfirmed"].contains(&final_status.state.as_str()));
            let pdf = lopdf::Document::load(&output).unwrap();
            assert_eq!(pdf.get_pages().len(), expected);
        }
        record(
            serde_json::json!({"event":"verified","cancelTest":cancelled,"status":final_status,"bytes":fs::metadata(&output).map(|m|m.len()).unwrap_or(0),"ms":started.elapsed().as_millis()}),
        );
    }
}
