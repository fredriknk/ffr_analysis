#[test]
fn capture_regression_parity() {
    let (Ok(raw), Ok(legacy)) = (
        std::env::var("FFR_CAPTURE_RAW"),
        std::env::var("FFR_CAPTURE_LEGACY"),
    ) else {
        return;
    };
    let out = tempfile::tempdir().expect("temporary output");
    let python = std::env::var("FFR_PYTHON").unwrap_or_else(|_| "python".into());
    let script =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/verification.py");
    let status = std::process::Command::new(python)
        .arg(script)
        .arg(&legacy)
        .arg(out.path())
        .status()
        .expect("verification helper");
    assert!(status.success());
    let report =
        ffr_core::parity::parity(std::path::Path::new(&raw), &out.path().join("golden.jsonl"))
            .expect("parity");
    assert_eq!(report.matched_lines, report.lines, "{report:#?}");
    if let Ok(metno) = std::env::var("FFR_METNO_PICKLE") {
        let report = ffr_core::parity::end_to_end(
            std::path::Path::new(&raw),
            &std::path::Path::new(&legacy).join("output/capture_slopes.txt"),
            &out.path().join("df_all.csv"),
            std::path::Path::new(&metno),
        )
        .expect("end-to-end");
        for key in [
            "temperatureMatches",
            "plotMatches",
            "treatmentMatches",
            "n2oFluxMatches",
            "co2FluxMatches",
        ] {
            assert_eq!(report[key], report["robotRows"], "{report}");
        }
    }
}
