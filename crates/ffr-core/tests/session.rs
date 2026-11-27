use ffr_core::{AnalysisOptions, Session};
use serde_json::json;

#[test]
fn legacy_scan_returns_the_weather_pickle_path_when_present() {
    let dir = tempfile::tempdir().expect("temporary legacy root");
    let legacy = dir.path().join("Users").join("Synthetic");
    std::fs::create_dir_all(&legacy).expect("legacy folder");
    let legacy = legacy.to_str().expect("legacy path");
    let session = Session::default();

    let scan = session.legacy_scan(legacy).expect("scan without weather");
    assert!(!scan.weather_exists);
    assert!(json!(scan).get("metnoPicklePath").is_none());

    let weather = dir.path().join("metno_data.pickle");
    std::fs::write(&weather, b"(dp0\n.").expect("synthetic pickle");
    let scan = session.legacy_scan(legacy).expect("scan with weather");
    assert!(scan.weather_exists);
    let payload = json!(scan);
    let found = payload["metnoPicklePath"].as_str().expect("weather path");
    assert!(!found.contains(".."), "{found}");
    assert_eq!(
        std::fs::canonicalize(found).expect("scanned weather file"),
        std::fs::canonicalize(weather).expect("synthetic weather file"),
    );
}

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
    let original = json!({"aux":[[epoch,
        [1,
        1]],
        "",
        [epoch+0.1,
        [2,
        0]],
        [epoch+20.,
        [2,
        1]],
        [epoch+20.1,
        [1,
        0]]],
        "li-cor":{"t0":0,
        "dt":1,
        "ty":(0..45).map(|i|json!([i,
        [400.+i as f64,
        2.,
        3.,
        4.,
        5.]])).collect::<Vec<_>>()}});
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
    assert_eq!(info.schema_version, 3);
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
#[test]
fn per_gas_timing_inherits_and_does_not_modify_sibling_gases() {
    let mut o = AnalysisOptions::default();
    o.per_gas.insert(
        "N2O".into(),
        json!({"cutBeginnings":9.,"cutEnds":5.,"valveOffset":4.}),
    );
    let n = o.for_gas("N2O");
    let c = o.for_gas("CO2");
    assert_eq!((n.cut_beginnings, n.cut_ends, n.valve_offset), (9., 5., 4.));
    assert_eq!((c.cut_beginnings, c.cut_ends, c.valve_offset), (4., 3., 0.));
    assert_eq!(n.start, o.start);
}
#[test]
fn one_sided_files_do_not_create_unmeasured_chamber_errors() {
    let dir = tempfile::tempdir().expect("temporary");
    let name = "2022-09-01-13-07-15-x1_0-y2_0-z0_0-h0_0_right_Plot_1_";
    let file = dir.path().join(name);
    let meta = ffr_core::raw::filename(name, "Europe/Oslo").expect("metadata");
    let epoch = meta.time as f64 / 1000.;
    let data = json!({"aux":[[epoch,[2,1]],[epoch+0.1,[1,0]]],"li-cor":{"ty":(0..100).map(|i|json!([i,[400.+i as f64,1.,1.,1.]])).collect::<Vec<_>>()}});
    std::fs::write(
        &file,
        serde_pickle::to_vec(&data, serde_pickle::SerOptions::new()).expect("pickle"),
    )
    .expect("write");
    let path = dir.path().join("one.ffr");
    let mut s = Session::default();
    s.project_create(path.to_str().expect("path"), "One")
        .expect("create");
    s.import_raw_files(&[file.to_string_lossy().into_owned()], |_| {})
        .expect("import");
    let table = s.list_fluxes().expect("table");
    assert_eq!(table.rows, 1);
    assert_eq!(table.data["side"][0], "right");
    let detail = s.get_flux_detail(1).expect("detail");
    s.preview_flux(1, detail.options)
        .expect("baseline exists after incremental import");
    s.project_close();
    let db = rusqlite::Connection::open(&path).expect("DB");
    let row: String = db
        .query_row("SELECT row FROM fluxes WHERE id=1", [], |r| r.get(0))
        .expect("row");
    let mut phantom: serde_json::Value = serde_json::from_str(&row).expect("JSON");
    phantom["id"] = json!(2);
    phantom["side"] = json!("left");
    db.execute(
        "INSERT INTO fluxes(id,measurement_id,row,results) VALUES(2,1,?1,'{}')",
        [phantom.to_string()],
    )
    .expect("old phantom");
    db.execute_batch("PRAGMA user_version=2;")
        .expect("old version");
    drop(db);
    let info = s
        .project_open(path.to_str().expect("path"))
        .expect("migrate");
    assert_eq!(info.counts.fluxes, 1);
}

/// Fluxes from several two-chamber files, so the project-wide pass has
/// baselines, siblings and same-day neighbours to work with.
fn multi_file_project(dir: &std::path::Path) -> Session {
    project_with_dropout(dir, false)
}
/// With `dropout`, the first file's CO2 analyser returns zeros in a left segment.
fn project_with_dropout(dir: &std::path::Path, dropout: bool) -> Session {
    let files = write_robot_files(dir, dropout);
    let mut s = Session::default();
    s.project_create(dir.join("multi.ffr").to_str().expect("path"), "Multi")
        .expect("create");
    s.import_raw_files(&files, |_| {}).expect("import");
    s
}
/// Eight synthetic robot files (two days, both chambers) written to `dir`.
fn write_robot_files(dir: &std::path::Path, dropout: bool) -> Vec<String> {
    let mut files = vec![];
    for k in 0..8 {
        let name = format!(
            "2022-09-0{}-1{}-07-15-x1_0-y2_0-z0_0-h0_0_both_Plot_1_",
            1 + k / 4,
            k % 4
        );
        let meta = ffr_core::raw::filename(&name, "Europe/Oslo").expect("meta");
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
        let ty: Vec<_> = (0..200)
            .map(|i| {
                let t = i as f64 + 0.25;
                let left = (i / 20) % 2 == 0;
                let slope = if left { 0.2 } else { 0.05 } * (1. + k as f64 * 0.3);
                let noise = ((i * 7919 + k * 104729) % 997) as f64 / 997. - 0.5;
                let co2 = if dropout && k == 0 && (45..50).contains(&i) {
                    0.
                } else {
                    400. + slope * t + noise
                };
                json!([t, [co2, 1., 1., 1.]])
            })
            .collect();
        let path = dir.join(&name);
        std::fs::write(
            &path,
            serde_pickle::to_vec(
                &json!({"aux":events,"li-cor":{"ty":ty}}),
                serde_pickle::SerOptions::new(),
            )
            .expect("pickle"),
        )
        .expect("write");
        files.push(path.to_string_lossy().into_owned());
    }
    files
}

#[test]
fn incremental_edits_match_a_full_recompute() {
    let dir = tempfile::tempdir().expect("tempdir");
    let s = multi_file_project(dir.path());
    let ids: Vec<i64> = s.list_fluxes().expect("table").data["id"]
        .iter()
        .filter_map(|v| v.as_i64())
        .collect();
    assert_eq!(ids.len(), 16);

    // Review and note change nothing else and need no recomputation.
    let rows = s
        .set_flux_flags(&[ids[0]], json!({"reviewed":true,"note":"ok"}))
        .expect("review");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["reviewed"], true);
    let history = s.history(100).expect("history").len();
    // Setting the same values again is not an edit.
    s.set_flux_flags(&[ids[0]], json!({"reviewed":true}))
        .expect("same flags");
    let detail = s.get_flux_detail(ids[1]).expect("detail");
    s.set_flux_options(&[ids[1]], Some(detail.options.clone()))
        .expect("options");
    let history_after_options = s.history(100).expect("history").len();
    s.set_flux_options(&[ids[1]], Some(detail.options.clone()))
        .expect("same options");
    assert_eq!(
        s.history(100).expect("history").len(),
        history_after_options
    );
    assert_eq!(history_after_options, history + 1);

    // Exclusion and an option change re-score the rest of the project.
    let rows = s
        .set_flux_flags(&[ids[2]], json!({"excluded":true}))
        .expect("exclude");
    assert_eq!(rows[0]["id"], ids[2]);
    let mut changed = detail.options.clone();
    changed.start = 30.;
    changed.valve_offset = 2.;
    s.set_flux_options(&[ids[3]], Some(changed))
        .expect("window");

    let incremental = s.list_fluxes().expect("table");
    s.recompute_all(|_| {}).expect("recompute");
    let full = s.list_fluxes().expect("table");
    for key in [
        "attention",
        "diag",
        "N2O_impact",
        "CO2_impact",
        "CO2_robustFlux",
        "CO2_flux",
        "excluded",
        "reviewed",
        "note",
    ] {
        assert_eq!(incremental.data.get(key), full.data.get(key), "{key}");
    }
    // Repeated passes must not pile up duplicate findings.
    let before = s.get_flux_detail(ids[5]).expect("detail").diagnostics.len();
    for _ in 0..3 {
        s.set_flux_flags(&[ids[6]], json!({"excluded":true}))
            .expect("exclude");
        s.set_flux_flags(&[ids[6]], json!({"excluded":false}))
            .expect("include");
    }
    let after = s.get_flux_detail(ids[5]).expect("detail").diagnostics.len();
    assert_eq!(before, after);
}

fn one_plot(polygon: serde_json::Value) -> ffr_core::Layout {
    ffr_core::Layout {
        treatments: vec![
            serde_json::from_value(json!({"id":1,"name":"T","colour":"#000000"}))
                .expect("treatment"),
        ],
        plots: vec![serde_json::from_value(
            json!({"id":1,"label":"P","treatmentId":1,"polygon":polygon}),
        )
        .expect("plot")],
    }
}

#[test]
fn instrument_dropout_drops_the_points_not_the_flux() {
    let dir = tempfile::tempdir().expect("tempdir");
    let s = project_with_dropout(dir.path(), true);
    s.set_layout(one_plot(serde_json::Value::Null), |_| {})
        .expect("layout");
    let all: Vec<i64> = s.list_fluxes().expect("table").data["id"]
        .iter()
        .filter_map(|v| v.as_i64())
        .collect();
    s.set_flux_flags(&all, json!({"plotOverride":1}))
        .expect("plot");
    let table = s.list_fluxes().expect("table");
    let flagged: Vec<i64> = table.data["id"]
        .iter()
        .zip(&table.data["diag"])
        .filter(|(_, d)| d.as_str().is_some_and(|d| d.contains("zero_readings")))
        .filter_map(|(id, _)| id.as_i64())
        .collect();
    assert_eq!(flagged.len(), 1, "only the left chamber of the first file");
    let id = flagged[0];
    let detail = s.get_flux_detail(id).expect("detail");
    let finding = detail
        .diagnostics
        .iter()
        .find(|d| d.code == "zero_readings")
        .expect("finding");
    assert_eq!(
        (finding.gas.as_deref(), finding.severity.as_str()),
        (Some("CO2"), "warn")
    );
    assert_eq!(detail.flux["excluded"], false);
    assert_eq!(detail.flux["CO2_excluded"], false, "the gas stays in");
    // The zero readings are never fitted.
    let trace = detail
        .traces
        .iter()
        .find(|t| t.gas == "CO2")
        .expect("trace");
    let fit = detail
        .regressions
        .iter()
        .find(|r| r.gas == "CO2")
        .expect("fit");
    assert!(trace
        .used
        .iter()
        .zip(&trace.y)
        .all(|(u, y)| !*u || *y != 0.));
    assert_eq!(trace.used.iter().filter(|u| **u).count(), fit.n);
    let count = |s: &Session| {
        s.treatment_summary(ffr_core::SummaryQuery {
            gas: "CO2".into(),
            from: None,
            to: None,
            sources: vec!["robot".into()],
            flux_ids: None,
        })
        .expect("summary")
        .plots
        .iter()
        .map(|p| p.points.len())
        .sum::<usize>()
    };
    let before = count(&s);
    // The per-gas button still excludes the gas by hand; it survives a
    // recompute and undoes.
    let rows = s
        .set_flux_flags(&[id], json!({"gasExcluded":{"CO2":true}}))
        .expect("exclude");
    assert_eq!(rows[0]["CO2_excluded"], true);
    assert_eq!(count(&s), before - 1);
    s.recompute_all(|_| {}).expect("recompute");
    assert_eq!(
        s.get_flux_detail(id).expect("detail").flux["CO2_excluded"],
        true
    );
    s.undo().expect("undo");
    assert_eq!(count(&s), before);
}

#[test]
fn raw_folder_imports_new_files_inside_the_field() {
    let data = tempfile::tempdir().expect("tempdir");
    let nested = data.path().join("2022-09");
    std::fs::create_dir(&nested).expect("subfolder");
    write_robot_files(&nested, false);
    std::fs::write(data.path().join("notes.txt"), "not a robot file").expect("write");
    let dir = tempfile::tempdir().expect("tempdir");
    let mut s = Session::default();
    s.project_create(dir.path().join("p.ffr").to_str().expect("path"), "Folder")
        .expect("create");
    assert!(s.raw_folder_scan(false, |_| {}).is_err(), "no folder yet");
    // A plot far from the robot: every file is outside the field.
    s.set_layout(
        one_plot(json!([
            [500., 500.],
            [510., 500.],
            [510., 510.],
            [500., 510.]
        ])),
        |_| {},
    )
    .expect("layout");
    s.raw_folder_set(Some(ffr_core::RawFolder {
        path: data.path().to_string_lossy().into(),
        ..Default::default()
    }))
    .expect("set");
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.files, r.outside_field, r.imported), (8, 8, 0));
    // The left chambers (at 1.2, 4) are inside this plot.
    s.set_layout(
        one_plot(json!([[0., 3.], [3., 3.], [3., 5.], [0., 5.]])),
        |_| {},
    )
    .expect("layout");
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.files, r.known, r.imported), (8, 0, 8));
    assert_eq!(s.list_fluxes().expect("table").rows, 16);
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.known, r.imported), (8, 0));
    let stored = s.raw_folder_get().expect("get").expect("folder");
    assert_eq!(stored.last_report.expect("report").known, 8);
    s.raw_folder_set(None).expect("forget");
    assert!(s.raw_folder_get().expect("get").is_none());
}

/// A plot visited from a route at waypoint 1 (left chamber), with a footprint.
fn route_plot(polygon: serde_json::Value) -> ffr_core::Layout {
    let mut layout = one_plot(polygon);
    layout.plots[0] = serde_json::from_value(json!({
        "id": 1, "label": "P", "treatmentId": 1, "polygon": layout.plots[0].polygon,
        "waypoints": [{"waypoint": 1, "side": "left"}]
    }))
    .expect("plot");
    layout
}

fn folder_project(data: &std::path::Path, dir: &std::path::Path) -> Session {
    write_robot_files(data, false);
    let mut s = Session::default();
    s.project_create(dir.join("p.ffr").to_str().expect("path"), "Folder")
        .expect("create");
    s.raw_folder_set(Some(ffr_core::RawFolder {
        path: data.to_string_lossy().into(),
        ..Default::default()
    }))
    .expect("set");
    s
}

#[test]
fn shared_folder_ignores_other_routes_with_the_same_waypoint_numbers() {
    let (data, dir) = (
        tempfile::tempdir().expect("tmp"),
        tempfile::tempdir().expect("tmp"),
    );
    let s = folder_project(data.path(), dir.path());
    // Same waypoint number (Plot_1, left) but the plot is far away: another
    // project's route, not ours.
    s.set_layout(
        route_plot(json!([
            [500., 500.],
            [510., 500.],
            [510., 510.],
            [500., 510.]
        ])),
        |_| {},
    )
    .expect("layout");
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.files, r.outside_field, r.imported), (8, 8, 0));
    // A footprint moved a few metres off the left chamber (1.2, 4) still
    // keeps its route files.
    s.set_layout(
        route_plot(json!([[4., 3.], [6., 3.], [6., 5.], [4., 5.]])),
        |_| {},
    )
    .expect("layout");
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.outside_field, r.imported), (0, 8));
    let rows = s.list_fluxes().expect("table");
    let plots: Vec<_> = rows.data["plotId"]
        .iter()
        .filter(|v| !v.is_null())
        .collect();
    assert_eq!(plots.len(), 8, "left chambers assigned by the route visit");
}

#[test]
fn folder_date_range_and_unfiltered_folders_wait() {
    let (data, dir) = (
        tempfile::tempdir().expect("tmp"),
        tempfile::tempdir().expect("tmp"),
    );
    let s = folder_project(data.path(), dir.path());
    // No plots and no dates: nothing filters a shared folder, so nothing is
    // imported until asked for.
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.files, r.waiting, r.imported), (8, 8, 0));
    assert_eq!(
        s.project_info()
            .expect("info")
            .expect("open")
            .counts
            .measurements,
        0
    );
    let folder = |from: Option<&str>, to: Option<&str>| {
        s.raw_folder_set(Some(ffr_core::RawFolder {
            path: data.path().to_string_lossy().into(),
            from: from.map(Into::into),
            to: to.map(Into::into),
            ..Default::default()
        }))
    };
    assert!(
        folder(Some("2022-09-03"), Some("2022-09-01")).is_err(),
        "backwards"
    );
    assert!(folder(Some("1.9.2022"), None).is_err(), "not a date");
    assert!(folder(None, Some("2022-9-1")).is_err(), "not YYYY-MM-DD");
    // The files are from 1 and 2 September (Oslo time).
    folder(Some(" "), Some("2022-09-01")).expect("set");
    let stored = s.raw_folder_get().expect("get").expect("folder");
    assert_eq!(
        (stored.from, stored.to.as_deref()),
        (None, Some("2022-09-01"))
    );
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.outside_dates, r.waiting, r.imported), (4, 0, 4));
    folder(Some("2022-09-02"), None).expect("set");
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.known, r.outside_dates, r.imported), (4, 0, 4));
    // Without dates the rest waits again; `all` imports it.
    std::fs::write(
        data.path()
            .join("2022-09-03-10-07-15-x1_0-y2_0-z0_0-h0_0_both_Plot_1_"),
        std::fs::read(
            data.path().join(
                std::fs::read_dir(data.path())
                    .expect("dir")
                    .next()
                    .expect("file")
                    .expect("entry")
                    .file_name(),
            ),
        )
        .expect("read"),
    )
    .expect("copy");
    folder(None, None).expect("set");
    let r = s.raw_folder_scan(false, |_| {}).expect("scan");
    assert_eq!((r.known, r.waiting, r.imported), (8, 1, 0));
    let r = s.raw_folder_scan(true, |_| {}).expect("scan");
    assert_eq!((r.waiting, r.imported), (0, 1));
}

#[test]
fn per_gas_window_reaches_the_regression_and_options_are_normalised() {
    let dir = tempfile::tempdir().expect("tempdir");
    let s = multi_file_project(dir.path());
    let base = s.get_flux_detail(1).expect("detail").options;
    let co2 = |d: &ffr_core::FluxDetail| {
        d.regressions
            .iter()
            .find(|r| r.gas == "CO2")
            .expect("CO2")
            .clone()
    };
    let mut own = base.clone();
    own.per_gas
        .insert("CO2".into(), json!({"start": 60., "crit": "mse"}));
    let fit = co2(&s.preview_flux(1, own.clone()).expect("preview"));
    // The window starts at the point nearest 60 s (legacy `nearest`).
    assert!(fit.start > 50., "per-gas start ignored: {}", fit.start);
    // Stored options keep only per-gas fields that differ from the flux's.
    let mut same = base.clone();
    same.per_gas.insert(
        "CO2".into(),
        json!({"start": base.start, "stop": base.stop, "interval": 5}),
    );
    s.set_flux_options(&[1], Some(same)).expect("same");
    assert!(s
        .get_flux_detail(1)
        .expect("detail")
        .options
        .per_gas
        .is_empty());
    s.set_flux_options(&[1], Some(own)).expect("own");
    let stored = s.get_flux_detail(1).expect("detail");
    assert_eq!(stored.options.per_gas["CO2"], json!({"start": 60.}));
    assert_eq!(co2(&stored).start, fit.start);
}

/// A NitroScope-style file: five valves (1 left, 2 right, 3 closed at every
/// switch; 4, 5, 3 open after the measurement), a repeated last left switch,
/// an absent LI-COR (-1) and one N2O analyser error code.
fn write_multi_valve_file(dir: &std::path::Path) -> std::path::PathBuf {
    let name =
        "2026-10-01-12-38-33-x599179_651278-y6615295_09211-z0_0-h-1_18624457125_both_Plot_1_";
    let meta = ffr_core::raw::filename(name, "Europe/Oslo").expect("meta");
    let epoch = meta.time as f64 / 1000.;
    let mut aux = vec![];
    let mut burst = |t: f64, open: u8, closed: [u8; 2]| {
        aux.push(json!([epoch + t, [open, 1]]));
        aux.push(json!(""));
        aux.push(json!([epoch + t + 0.15, [closed[0], 0]]));
        aux.push(json!([epoch + t + 0.3, [closed[1], 0]]));
    };
    for i in 0..10 {
        let open = if i % 2 == 0 { 2 } else { 1 };
        burst(i as f64 * 20.5, open, [3 - open, 3]);
    }
    burst(185.1, 1, [2, 3]);
    burst(187.1, 4, [2, 3]);
    burst(217.6, 5, [1, 3]);
    burst(248.1, 3, [1, 2]);
    let dlt: Vec<_> = (0..250)
        .map(|i| {
            let t = i as f64;
            let left = ((t / 20.5).floor() as i64) % 2 == 1;
            let mut v = vec![0.; 29];
            v[10] = if i == 100 {
                1.797_693_1e304
            } else {
                0.33 + if left { 0.0002 } else { 0.0001 } * t
            };
            json!([t, v])
        })
        .collect();
    let licor: Vec<_> = (0..250)
        .map(|i| json!([i as f64, [-1., -1., -1., -1.]]))
        .collect();
    let path = dir.join(name);
    std::fs::write(
        &path,
        serde_pickle::to_vec(
            &json!({"aux":aux,"dlt":{"ty":dlt},"li-cor":{"ty":licor}}),
            serde_pickle::SerOptions::new(),
        )
        .expect("pickle"),
    )
    .expect("write");
    path
}

#[test]
fn multi_valve_files_split_into_chambers() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write_multi_valve_file(dir.path());
    let mut s = Session::default();
    s.project_create(dir.path().join("ns.ffr").to_str().expect("path"), "NS")
        .expect("create");
    let report = s
        .import_raw_files(&[path.to_string_lossy().into()], |_| {})
        .expect("import");
    assert_eq!((report.imported, report.errors.len()), (1, 0));
    let table = s.list_fluxes().expect("table");
    assert_eq!(table.rows, 2);
    let xs: Vec<f64> = table.data["x"].iter().filter_map(|v| v.as_f64()).collect();
    assert!((xs[0] - xs[1]).abs() > 1., "chambers sit on either side");
    let d = s
        .get_flux_detail(table.data["id"][0].as_i64().expect("id"))
        .expect("detail");
    let sides: Vec<&str> = d.switches.iter().map(|s| s.side.as_str()).collect();
    assert_eq!(
        sides.len(),
        11,
        "10 chamber switches and the end: {sides:?}"
    );
    assert_eq!(sides[..2], ["right", "left"]);
    assert_eq!(sides[10], "none");
    assert!(!d.diagnostics.iter().any(|f| f.code == "valves_irregular"));
    assert!(!d.diagnostics.iter().any(|f| f.code == "error"));
    let n2o = d.traces.iter().find(|t| t.gas == "N2O").expect("trace");
    assert!(!n2o.used[100], "the analyser error code is never fitted");
    let fit = d.regressions.iter().find(|r| r.gas == "N2O").expect("fit");
    assert!(fit.flux.is_finite() && fit.n > 20);
}

#[test]
fn non_robot_files_are_refused_and_failed_files_retried() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut s = Session::default();
    s.project_create(dir.path().join("p.ffr").to_str().expect("path"), "P")
        .expect("create");
    let csv = dir.path().join("route.csv");
    std::fs::write(&csv, "1,2,3\n").expect("write");
    let r = s
        .import_raw_files(&[csv.to_string_lossy().into()], |_| {})
        .expect("import");
    assert_eq!((r.imported, r.errors.len()), (0, 1));
    assert_eq!(s.list_fluxes().expect("table").rows, 0);
    // A robot file that cannot be read becomes a failed measurement ...
    let path = write_multi_valve_file(dir.path());
    let good = std::fs::read(&path).expect("read");
    std::fs::write(&path, b"broken").expect("write");
    let file = vec![path.to_string_lossy().into_owned()];
    s.import_raw_files(&file, |_| {}).expect("import");
    assert_eq!(s.list_fluxes().expect("table").data["diag"][0], "error");
    // ... is skipped while it still fails, and read again once it loads.
    let r = s.import_raw_files(&file, |_| {}).expect("import");
    assert_eq!((r.imported, r.skipped), (0, 1));
    std::fs::write(&path, good).expect("write");
    let r = s.import_raw_files(&file, |_| {}).expect("import");
    assert_eq!((r.imported, r.retried), (1, 1));
    let table = s.list_fluxes().expect("table");
    assert_eq!(table.rows, 2);
    assert!(table.data["diag"]
        .iter()
        .all(|d| !d.as_str().unwrap_or("").contains("error")));
}

#[test]
fn used_points_follow_the_valve_offset() {
    let dir = tempfile::tempdir().expect("tempdir");
    let s = multi_file_project(dir.path());
    let mut options = s.get_flux_detail(1).expect("detail").options;
    for offset in [0., 3., -2.5] {
        options.valve_offset = offset;
        let d = s.preview_flux(1, options.clone()).expect("preview");
        let trace = d.traces.iter().find(|t| t.gas == "CO2").expect("trace");
        let fit = d.regressions.iter().find(|r| r.gas == "CO2").expect("fit");
        let used = trace.used.iter().filter(|u| **u).count();
        assert_eq!(used, fit.n, "offset {offset}");
        for (i, u) in trace.used.iter().enumerate() {
            if *u {
                assert_eq!(trace.side[i], 1, "used point outside the left chamber");
            }
        }
    }
}

#[test]
fn waypoint_layout_assigns_raw_fluxes_and_roundtrips_history() {
    use ffr_core::waypoints::*;
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("route.ffr");
    let mut s = Session::default();
    s.project_create(project.to_str().unwrap(), "Route")
        .unwrap();
    let old = s.get_layout().unwrap();
    let name = "2022-09-01-13-07-15-x1_0-y2_0-z0_0-h0_0_both_Plot_3_";
    let metadata = ffr_core::raw::filename(name, "Europe/Oslo").unwrap();
    let epoch = metadata.time as f64 / 1000.;
    let raw = json!({"aux":[[epoch,[1,1]],[epoch+0.1,[2,0]],[epoch+20.,[2,1]],[epoch+20.1,[1,0]]],"li-cor":{"t0":0,"dt":1,"ty":(0..45).map(|i|json!([i,[400.+i as f64,2.,101.,20.]])).collect::<Vec<_>>()}});
    let path = dir.path().join(name);
    std::fs::write(
        &path,
        serde_pickle::to_vec(&raw, serde_pickle::SerOptions::new()).unwrap(),
    )
    .unwrap();
    s.import_raw_files(&[path.to_string_lossy().into()], |_| {})
        .unwrap();
    let points = parse("100,100,0,0,Measure,both,Plot_3").unwrap();
    let args = ApplyWaypointLayoutArgs {
        points: points.clone(),
        source_path: Some("synthetic.csv".into()),
        plots: vec![WaypointLayoutPlot {
            label: "P1".into(),
            polygon: vec![[98., 98.], [102., 98.], [102., 102.], [98., 102.]],
            treatment_id: Some(999),
            block: 0,
            waypoints: vec![
                WaypointRef {
                    waypoint: 3,
                    side: ChamberSide::Left,
                },
                WaypointRef {
                    waypoint: 3,
                    side: ChamberSide::Right,
                },
            ],
        }],
    };
    let layout = s.apply_waypoint_layout(args, |_| {}).unwrap();
    let rows = s.list_fluxes().unwrap();
    assert_eq!(rows.rows, 2);
    for i in 0..2 {
        assert_eq!(rows.data["plotId"][i], 1);
        assert_eq!(rows.data["plotLabel"][i], "P1");
        assert_eq!(rows.data["treatmentName"][i], "Unassigned");
    }
    let route = s.get_route().unwrap().unwrap();
    assert_eq!(route.points[0].name, "Plot_3");
    assert_eq!(route.source_path.as_deref(), Some("synthetic.csv"));
    assert!(route.saved_at > 0);
    assert_eq!(
        s.history(100)
            .unwrap()
            .iter()
            .filter(|h| h.kind == "layout")
            .count(),
        1
    );
    s.undo().unwrap();
    assert_eq!(
        serde_json::to_value(s.get_layout().unwrap()).unwrap(),
        serde_json::to_value(old).unwrap()
    );
    s.redo().unwrap();
    assert_eq!(
        s.get_layout().unwrap().plots[0]
            .waypoints
            .as_ref()
            .unwrap()
            .len(),
        2
    );
    s.set_layout(layout.clone(), |_| {}).unwrap();
    assert_eq!(
        s.get_layout().unwrap().plots[0]
            .waypoints
            .as_ref()
            .unwrap()
            .len(),
        2
    );
    let mut absent = layout.clone();
    absent.plots[0].waypoints = None;
    s.set_layout(absent, |_| {}).unwrap();
    assert_eq!(
        s.get_layout().unwrap().plots[0]
            .waypoints
            .as_ref()
            .unwrap()
            .len(),
        2
    );
    let mut cleared = layout;
    cleared.plots[0].waypoints = Some(vec![]);
    s.set_layout(cleared, |_| {}).unwrap();
    assert!(s.get_layout().unwrap().plots[0]
        .waypoints
        .as_ref()
        .unwrap()
        .is_empty());
    s.project_close();
    let db = rusqlite::Connection::open(&project).unwrap();
    let config: String = db
        .query_row("SELECT value FROM meta WHERE key='config'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let mut config: serde_json::Value = serde_json::from_str(&config).unwrap();
    config.as_object_mut().unwrap().remove("crs");
    db.execute(
        "UPDATE meta SET value=?1 WHERE key='config'",
        [config.to_string()],
    )
    .unwrap();
    drop(db);
    s.project_open(project.to_str().unwrap()).unwrap();
    assert_eq!(s.get_config().unwrap().crs, "EPSG:32632");
    let mut cfg = s.get_config().unwrap();
    cfg.crs = "EPSG:32600".into();
    assert!(s.set_config(cfg, |_| {}).is_err());
    assert!(s.get_route().unwrap().is_some());
    let standalone = Session::default();
    assert!(!standalone
        .waypoint_plots(&points, &PlotGenOptions::default())
        .unwrap()
        .plots
        .is_empty());
}
