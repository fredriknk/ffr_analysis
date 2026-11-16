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
        s.get_series(&[1], None, None, Some(1)).expect("series")[0]["points"]
            .as_array()
            .expect("points")
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
            treatments: vec![json!({"id":1,"name":"T","colour":"#000000"})],
            plots: vec![json!({"id":1,"label":"P","treatmentId":1})],
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
    assert!((summary["treatments"][0]["mean"].as_f64().expect("mean") - 0.0072).abs() < 1e-14);
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
