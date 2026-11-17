use ffr_core::*;
use serde_json::{json, Value};
use std::collections::BTreeSet;
fn check(name: &str, value: &Value) {
    let source = include_str!("../../../app/src/api/types.ts");
    let start = source
        .find(&format!("export interface {name} {{"))
        .expect("TS interface");
    let body = &source[start..];
    let body = &body[body.find('{').expect("brace") + 1..];
    let mut depth = 0;
    let mut expected = BTreeSet::new();
    let mut allowed = BTreeSet::new();
    for line in body.lines() {
        if line.trim_start().starts_with(['/', '*']) {
            continue;
        }
        if line.trim() == "}" && depth == 0 {
            break;
        }
        if depth == 0 {
            if let Some((key, _)) = line.trim().split_once(':') {
                if !key.starts_with('[') {
                    let optional = key.ends_with('?');
                    let key = key.trim_end_matches('?').to_string();
                    allowed.insert(key.clone());
                    if !optional || value.get(&key).is_some() {
                        expected.insert(key);
                    }
                }
            }
        }
        depth += line.chars().filter(|c| *c == '{').count() as i32
            - line.chars().filter(|c| *c == '}').count() as i32;
    }
    // SPEC 4.9 additions are intentionally accepted before the concurrent UI merge.
    for key in match name {
        "ProjectConfig" => vec!["diagnostics"],
        "AnalysisOptions" => vec!["valveOffset"],
        "FluxDetail" => vec!["diagnostics", "valveLagS", "robust", "N2O_lagS"],
        "SeriesMeta" => vec!["key"],
        "Trace" => vec!["fit"],
        _ => vec![],
    } {
        expected.insert(key.into());
    }
    let actual: BTreeSet<_> = value.as_object().expect("object").keys().cloned().collect();
    assert_eq!(
        actual, expected,
        "{name} JSON differs from types.ts (allowed {allowed:?})"
    );
}
#[test]
fn ui_contract_json_key_sets() {
    let dir = tempfile::tempdir().expect("temporary");
    let mut s = Session::default();
    let info = s
        .project_create(dir.path().join("test.ffr").to_str().expect("path"), "Test")
        .expect("create");
    check("ProjectInfo", &json!(info));
    let layout: Layout = serde_json::from_value(json!({"treatments":[{"id":1,
        "name":"Test",
        "shortName":"T",
        "colour":"#000000",
        "sortOrder":1}],
        "plots":[{"id":1,
        "label":"One",
        "treatmentId":1,
        "block":1,
        "polygon":null}]}))
    .expect("layout");
    s.set_layout(layout, |_| {}).expect("layout");
    let layout = json!(s.get_layout().expect("layout"));
    check("Layout", &layout);
    check("Treatment", &layout["treatments"][0]);
    check("Plot", &layout["plots"][0]);
    check("ProjectConfig", &json!(s.get_config().expect("config")));
    let file = dir.path().join("manual.csv");
    std::fs::write(
        &file,
        "date,nr,N2O_N_mug_m2h\n2022-01-01,1,10\n2022-01-03,1,20\n",
    )
    .expect("fixture");
    let report = s
        .import_manual_fluxes(json!({"path":file}))
        .expect("manual");
    check("ImportReport", &json!(report));
    let table = json!(s.list_fluxes().expect("table"));
    check("FluxTable", &table);
    for c in table["columns"].as_array().expect("columns") {
        check("ColumnMeta", c);
    }
    let detail = json!(s.get_flux_detail(1).expect("detail"));
    check("FluxDetail", &detail);
    check("AnalysisOptions", &detail["options"]);
    let summary = s
        .treatment_summary(SummaryQuery {
            gas: "N2O".into(),
            from: None,
            to: None,
            sources: vec!["manual".into()],
            flux_ids: None,
        })
        .expect("summary");
    check("TreatmentSummary", &json!(summary));
    s.store_series("Temp", "C", vec![json!({"time":1000,"value":1.})], 1000)
        .expect("series");
    check("SeriesMeta", &json!(s.list_series().expect("series")[0]));
    check(
        "SeriesData",
        &json!(s.get_series(&[1], None, None, None).expect("data")[0]),
    );
    s.set_flux_flags(&[1], json!({"reviewed":true}))
        .expect("edit");
    check("Change", &json!(s.history(1).expect("history")[0]));
    check("UndoResult", &json!(s.undo().expect("undo")));
    check(
        "TablePreview",
        &json!(s
            .preview_table(file.to_str().expect("path"), json!({}))
            .expect("preview")),
    );
    check(
        "LegacyScan",
        &json!(s
            .legacy_scan(dir.path().to_str().expect("path"))
            .expect("scan")),
    );
}
