use ffr_core::{AnalysisOptions, Session};
use serde_json::json;

#[test]
fn project_roundtrip_edits_backup_and_external_data() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("test.ffr");
    let backup = dir.path().join("copy.ffr");
    let csv = dir.path().join("manual.csv");
    std::fs::write(
        &csv,
        "date,nr,N2O_N_mug_m2h\n2022-01-01,1,10\n2022-01-03,1,20\n",
    )
    .expect("fixture");
    let mut s = Session::default();
    s.project_create(path.to_str().expect("path"), "Synthetic")
        .expect("create");
    s.import_manual_fluxes(json!({"path":csv})).expect("manual");
    let t = s.list_fluxes().expect("table");
    assert_eq!(t.rows, 2);
    let id = t.data["id"][0].as_i64().expect("id");
    s.set_flux_flags(&[id], json!({"excluded":true,"note":"test"}))
        .expect("flags");
    assert_eq!(s.list_fluxes().expect("table").data["excluded"][0], true);
    s.undo().expect("undo");
    assert_eq!(s.list_fluxes().expect("table").data["excluded"][0], false);
    s.redo().expect("redo");
    assert_eq!(s.list_fluxes().expect("table").data["excluded"][0], true);
    s.set_flux_options(&[id], Some(AnalysisOptions::default()))
        .expect("options");
    s.store_series(
        "temperature",
        "C",
        vec![
            json!({"time":1000,"value":4.}),
            json!({"time":2000,"value":8.}),
        ],
        1000,
    )
    .expect("series");
    assert_eq!(
        s.get_series(&[1], None, None, Some(1)).expect("series")[0]
            .points
            .len(),
        1
    );
    s.project_save_copy(backup.to_str().expect("path"))
        .expect("backup");
    s.project_close();
    let info = s
        .project_open(backup.to_str().expect("path"))
        .expect("open");
    assert_eq!(info.counts.fluxes, 2);
    assert_eq!(info.counts.excluded, 1);
    assert_eq!(s.history(10).expect("history").len(), 4);
}

#[test]
fn synthetic_pickle_and_gzip_keep_all_channels() {
    use ffr_core::raw;
    use std::io::Write;
    let dir = tempfile::tempdir().expect("tempdir");
    let name = "2022-09-01-13-07-15-x1_0-y2_0-z0_0-h-1_0_both_Plot_1_";
    let metadata = raw::filename(name, "Europe/Oslo").expect("metadata");
    let epoch = metadata.time as f64 / 1000.;
    let original = json!({"aux":[[epoch,[1,1]],"",[epoch+0.1,[2,0]],[epoch+20.,[2,1]],[epoch+20.1,[1,0]]],"li-cor":{"t0":0,"dt":1,"ty":(0..45).map(|i|json!([i,[400.+i as f64,2.,3.,4.,5.]])).collect::<Vec<_>>()}});
    let path = dir.path().join(name);
    let bytes = serde_pickle::to_vec(&original, serde_pickle::SerOptions::new()).expect("pickle");
    std::fs::write(&path, bytes).expect("write");
    let a = raw::load(&path, "Europe/Oslo").expect("raw");
    assert_eq!(a.channels.len(), 5);
    assert!(a.channels.contains_key("li-cor_4"));
    let gz = dir.path().join(format!("{name}.gz"));
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all(&serde_json::to_vec(&original).expect("json"))
        .expect("gzip");
    std::fs::write(&gz, encoder.finish().expect("finish")).expect("write");
    let b = raw::load(&gz, "Europe/Oslo").expect("raw");
    assert_eq!(a.channels, b.channels);
    assert_eq!(a.switches, b.switches);
}

#[test]
fn batch_undo_and_failure_are_atomic() {
    let dir = tempfile::tempdir().expect("tempdir");
    let csv = dir.path().join("manual.csv");
    std::fs::write(
        &csv,
        "date,nr,N2O_N_mug_m2h\n2022-01-01,1,10\n2022-01-03,1,20\n",
    )
    .expect("fixture");
    let mut s = Session::default();
    s.project_create(dir.path().join("test.ffr").to_str().expect("path"), "test")
        .expect("create");
    s.import_manual_fluxes(json!({"path":csv})).expect("manual");
    s.set_flux_flags(&[1, 2], json!({"reviewed":true}))
        .expect("batch");
    s.undo().expect("undo");
    assert_eq!(
        s.list_fluxes().expect("table").data["reviewed"],
        vec![json!(false), json!(false)]
    );
    s.redo().expect("redo");
    assert_eq!(
        s.list_fluxes().expect("table").data["reviewed"],
        vec![json!(true), json!(true)]
    );
    assert!(s
        .set_flux_flags(&[1, 999], json!({"excluded":true}))
        .is_err());
    assert_eq!(s.list_fluxes().expect("table").data["excluded"][0], false);
}

#[test]
fn treatment_integration_and_three_xlsx_modes() {
    use calamine::{DataType, Reader};
    use ffr_core::{ExportArgs, Layout, SummaryQuery};
    let dir = tempfile::tempdir().expect("tempdir");
    let csv = dir.path().join("manual.csv");
    std::fs::write(
        &csv,
        "date,nr,N2O_N_mug_m2h\n2022-01-01,1,10\n2022-01-03,1,20\n",
    )
    .expect("fixture");
    let mut s = Session::default();
    s.project_create(dir.path().join("test.ffr").to_str().expect("path"), "test")
        .expect("create");
    s.set_layout(
        Layout {
            treatments: vec![
                serde_json::from_value(json!({"id":1,"name":"T","colour":"#000000"}))
                    .expect("treatment"),
            ],
            plots: vec![serde_json::from_value(
                json!({"id":1,"label":"P","treatmentId":1,"polygon":null}),
            )
            .expect("plot")],
        },
        |_| {},
    )
    .expect("layout");
    s.import_manual_fluxes(json!({"path":csv})).expect("manual");
    let summary = s
        .treatment_summary(SummaryQuery {
            gas: "N2O".into(),
            from: None,
            to: None,
            sources: vec!["manual".into()],
            flux_ids: None,
        })
        .expect("summary");
    assert!((summary.treatments[0].mean - 0.0072).abs() < 1e-14);
    for mode in ["flat", "sheetPerPlot", "dailyPerPlot"] {
        let path = dir.path().join(format!("{mode}.xlsx"));
        s.export_xlsx(ExportArgs {
            path: path.to_str().expect("path").into(),
            flux_ids: vec![1, 2],
            columns: vec!["time".into(), "N2O_flux".into()],
            mode: mode.into(),
        })
        .expect("xlsx");
        let mut book = calamine::open_workbook_auto(path).expect("read xlsx");
        let range = book.worksheet_range_at(0).expect("sheet").expect("range");
        assert_eq!(range.height(), 3);
        if mode == "dailyPerPlot" {
            assert!(
                (range
                    .get_value((2, 3))
                    .and_then(|v| v.as_f64())
                    .expect("cumulative")
                    - 0.0072)
                    .abs()
                    < 1e-14
            );
        }
    }
}

#[test]
fn diagnostics_patch_and_v1_migration() {
    let dir = tempfile::tempdir().expect("temp");
    let project = dir.path().join("migrate.ffr");
    let name = "2022-09-01-13-07-15-x1_0-y2_0-z0_0-h0_0_both_Plot_1_";
    let raw = dir.path().join(name);
    let meta = ffr_core::raw::filename(name, "Europe/Oslo").expect("meta");
    let epoch = meta.time as f64 / 1000.;
    let events: Vec<_> = (0..10)
        .flat_map(|i| {
            let side = if i % 2 == 0 { 1 } else { 2 };
            [
                json!([epoch + i as f64 * 20., [side, 1]]),
                json!([epoch + i as f64 * 20. + 0.1, [3 - side, 0]]),
            ]
        })
        .collect();
    let data = json!({"aux":events,"li-cor":{"ty":(0..200).map(|i|json!([i as f64+0.25,[400.+i as f64*0.2,1.,1.,1.]])).collect::<Vec<_>>()}});
    std::fs::write(
        &raw,
        serde_pickle::to_vec(&data, serde_pickle::SerOptions::new()).expect("pickle"),
    )
    .expect("write");
    let mut s = Session::default();
    s.project_create(project.to_str().expect("path"), "Test")
        .expect("create");
    s.import_raw_files(&[raw.to_string_lossy().into()], |_| {})
        .expect("import");
    let detail = s.get_flux_detail(1).expect("detail");
    assert!(detail.diagnostics.iter().any(|d| d.code == "temp_fallback"));
    assert!(detail.diagnostics.iter().any(|d| d.code == "no_plot"));
    assert_eq!(detail.traces[0].fit.len(), detail.traces[0].t.len());
    let originals: Vec<_> = [1, 2]
        .into_iter()
        .map(|id| s.get_flux_detail(id).expect("detail").options)
        .collect();
    s.patch_flux_options(&[1, 2], json!({"valveOffset":4.}))
        .expect("patch");
    for id in [1, 2] {
        let o = s.get_flux_detail(id).expect("detail").options;
        assert_eq!(o.valve_offset, 4.);
        assert_eq!(o.start, originals[id as usize - 1].start);
    }
    s.undo().expect("undo");
    assert_eq!(
        s.get_flux_detail(1).expect("detail").options.valve_offset,
        0.
    );
    assert_eq!(
        s.get_flux_detail(2).expect("detail").options.valve_offset,
        0.
    );
    let thumbs = s.get_flux_thumbs(&[1, 2], "CO2", 20).expect("thumbs");
    assert_eq!(thumbs.len(), 2);
    assert!(thumbs
        .iter()
        .all(|t| t.t.len() <= 20 && t.t.len() == t.used.len()));
    s.project_close();
    let db = rusqlite::Connection::open(&project).expect("sqlite");
    db.execute_batch("DROP TABLE diagnostics; PRAGMA user_version=1;")
        .expect("old schema");
    drop(db);
    let info = s
        .project_open(project.to_str().expect("path"))
        .expect("migrate");
    assert_eq!(info.schema_version, 2);
    assert!(!s.get_flux_detail(1).expect("detail").diagnostics.is_empty());
}
#[test]
fn invalid_raw_stays_reviewable() {
    let dir = tempfile::tempdir().expect("temp");
    let raw = dir
        .path()
        .join("2022-09-01-13-07-15-x1_0-y2_0-z0_0-h0_0_both_Plot_1_");
    std::fs::write(
        &raw,
        serde_pickle::to_vec(&json!({"aux":[]}), serde_pickle::SerOptions::new()).expect("pickle"),
    )
    .expect("write");
    let mut s = Session::default();
    s.project_create(dir.path().join("bad.ffr").to_str().expect("path"), "Test")
        .expect("create");
    let report = s
        .import_raw_files(&[raw.to_string_lossy().into()], |_| {})
        .expect("import");
    assert_eq!(report.errors.len(), 1);
    assert_eq!(s.list_fluxes().expect("table").rows, 2);
    let d = s.get_flux_detail(1).expect("detail");
    assert!(d.diagnostics.iter().any(|d| d.code == "error"));
    s.recompute_all(|_| {}).expect("recompute");
    assert!(s
        .get_flux_detail(2)
        .expect("detail")
        .diagnostics
        .iter()
        .any(|d| d.code == "error"));
}
#[test]
fn failed_import_is_atomic_and_names_the_path() {
    let dir = tempfile::tempdir().expect("temp");
    let mut s = Session::default();
    let target = dir.path().join("failed.ffr");
    let missing = dir.path().join("missing-raw");
    let error = s
        .legacy_import(
            ffr_core::LegacyImportArgs {
                legacy_dir: dir.path().to_string_lossy().into_owned(),
                raw_dir: Some(missing.to_string_lossy().into_owned()),
                manual_path: None,
                logger_path: None,
                metno_pickle_path: None,
                out_path: target.to_string_lossy().into_owned(),
                preset: None,
            },
            |_| {},
        )
        .expect_err("missing raw");
    assert!(error.to_string().contains("missing-raw"));
    assert!(!target.exists());
    assert!(std::fs::read_dir(dir.path()).expect("listing").all(|e| !e
        .expect("entry")
        .file_name()
        .to_string_lossy()
        .starts_with(".ffr-import-")));
}
