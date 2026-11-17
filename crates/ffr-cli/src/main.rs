use ffr_core::{api::*, Session};
use serde_json::{json, Value};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
fn main() {
    if let Err(e) = run() {
        eprintln!(
            "{}",
            json!({
            "code":"cli",
            "message":e.to_string()}
            )
        );
        std::process::exit(1);
    }
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} required").into())
}
fn ids(v: &Value) -> Result<Vec<i64>> {
    Ok(serde_json::from_value(v.clone())?)
}
fn call(s: &mut Session, command: &str, a: Value) -> Result<Value> {
    let a = a.get("args").cloned().unwrap_or(a);
    let id = || a["fluxId"].as_i64().ok_or("fluxId required");
    Ok(match command {
        "projectCreate" => json!(s.project_create(string(&a, "path")?, string(&a, "name")?)?),
        "projectOpen" => json!(s.project_open(string(&a, "path")?)?),
        "projectClose" => {
            s.project_close();
            Value::Null
        }
        "projectInfo" => json!(s.project_info()?),
        "projectSaveCopy" => {
            s.project_save_copy(string(&a, "path")?)?;
            Value::Null
        }
        "recentProjects" => json!(s.recent_projects()),
        "legacyScan" => json!(s.legacy_scan(string(&a, "dir")?)?),
        "legacyImport" => json!(s.legacy_import(serde_json::from_value(a)?, |_| {})?),
        "importRawFiles" => json!(s.import_raw_files(
            &serde_json::from_value::<Vec<String>>(a["paths"].clone())?,
            |_| {}
        )?),
        "getConfig" => json!(s.get_config()?),
        "setConfig" => {
            s.set_config(
                serde_json::from_value(
                    a.get("cfg")
                        .or_else(|| a.get("config"))
                        .cloned()
                        .ok_or("cfg required")?,
                )?,
                |_| {},
            )?;
            Value::Null
        }
        "waypointsRead" => json!(s.waypoints_read(string(&a, "path")?)?),
        "waypointPlots" => json!(s.waypoint_plots(
            &serde_json::from_value::<Vec<ffr_core::waypoints::Waypoint>>(a["points"].clone())?,
            &serde_json::from_value(a["opts"].clone())?
        )?),
        "applyWaypointLayout" => {
            json!(s.apply_waypoint_layout(serde_json::from_value(a)?, |_| {})?)
        }
        "getRoute" => json!(s.get_route()?),
        "getLayout" => json!(s.get_layout()?),
        "setLayout" => {
            s.set_layout(serde_json::from_value(a["layout"].clone())?, |_| {})?;
            Value::Null
        }
        "listFluxes" => json!(s.list_fluxes()?),
        "getFluxDetail" => json!(s.get_flux_detail(id()?)?),
        "previewFlux" => {
            json!(s.preview_flux(id()?, serde_json::from_value(a["options"].clone())?)?)
        }
        "setFluxOptions" => json!(s.set_flux_options(
            &ids(&a["fluxIds"])?,
            serde_json::from_value(a["options"].clone())?
        )?),
        "setFluxFlags" => json!(s.set_flux_flags(&ids(&a["fluxIds"])?, a["flags"].clone())?),
        "patchFluxOptions" => {
            json!(s.patch_flux_options(&ids(&a["fluxIds"])?, a["partial"].clone())?)
        }
        "getFluxThumbs" => json!(s.get_flux_thumbs(
            &ids(&a["fluxIds"])?,
            string(&a, "gas")?,
            a["maxPoints"].as_u64().unwrap_or(60) as usize
        )?),
        "diagnosticsSummary" => json!(s.diagnostics_summary()?),
        "recomputeAll" => {
            s.recompute_all(|_| {})?;
            Value::Null
        }
        "undo" => json!(s.undo()?),
        "redo" => json!(s.redo()?),
        "history" => json!(s.history(a["limit"].as_u64().unwrap_or(100) as usize)?),
        "treatmentSummary" => json!(s.treatment_summary(serde_json::from_value(a)?)?),
        "listSeries" => json!(s.list_series()?),
        "getSeries" => json!(s.get_series(
            &ids(&a["ids"])?,
            a["from"].as_i64(),
            a["to"].as_i64(),
            a["maxPoints"].as_u64().map(|n| n as usize)
        )?),
        "previewTable" => json!(s.preview_table(string(&a, "path")?, a["opts"].clone())?),
        "importSeries" => json!(s.import_series(a)?),
        "deleteSeries" => {
            s.delete_series(a["id"].as_i64().ok_or("id required")?)?;
            Value::Null
        }
        "importManualFluxes" => json!(s.import_manual_fluxes(a)?),
        "metnoGetClientId" => json!(s.metno_get_client_id()),
        "metnoSetClientId" => {
            s.metno_set_client_id(string(&a, "id")?.into());
            Value::Null
        }
        "metnoFetch" => {
            s.metno_fetch(a, |_| {})?;
            Value::Null
        }
        "exportXlsx" => {
            s.export_xlsx(serde_json::from_value(a)?)?;
            Value::Null
        }
        "exportCsv" => {
            s.export_csv(serde_json::from_value(a)?)?;
            Value::Null
        }
        _ => return Err(format!("unknown command {command}").into()),
    })
}
fn run() -> Result<()> {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| a.get(i).map(String::as_str).ok_or("missing argument");
    let mut s = Session::default();
    let result = match arg(0)? {
        "waypoint-plots" => {
            let points = s.waypoints_read(arg(1)?)?;
            let opts = ffr_core::waypoints::PlotGenOptions {
                cluster_distance: a.get(2).map(|v| v.parse()).transpose()?.unwrap_or(1.),
                ..Default::default()
            };
            json!(s.waypoint_plots(&points, &opts)?)
        }
        "diagnostics" => {
            s.project_open(arg(1)?)?;
            s.diagnostics_report()?
        }
        "parity" => {
            let raw = std::path::Path::new(arg(1)?);
            let slopes = std::path::Path::new(arg(2)?);
            let report = ffr_core::parity::parity(raw, slopes)?;
            if a.len() >= 5 {
                json!({
                "regressions":report,
                "endToEnd":ffr_core::parity::end_to_end(raw,
                slopes,
                std::path::Path::new(arg(3)?),
                std::path::Path::new(arg(4)?))?}
                )
            } else {
                json!(report)
            }
        }
        "import-legacy" => json!(s.legacy_import(
            LegacyImportArgs {
                legacy_dir: arg(1)?.into(),
                raw_dir: Some(arg(2)?.into()),
                out_path: arg(3)?.into(),
                manual_path: std::env::var("FFR_CAPTURE_MANUAL").ok(),
                logger_path: std::env::var("FFR_CAPTURE_LOGGER").ok(),
                metno_pickle_path: std::env::var("FFR_METNO_PICKLE").ok(),
                preset: None
            },
            |p| {
                if p.done % 500 == 0 {
                    eprintln!("{} {}/{}", p.task, p.done, p.total);
                }
            }
        )?),
        "info" => json!(s.project_open(arg(1)?)?),
        "recompute" => {
            s.project_open(arg(1)?)?;
            s.recompute_all(|_| {})?;
            json!(s.project_info()?)
        }
        "summary" => {
            s.project_open(arg(1)?)?;
            json!(s.treatment_summary(SummaryQuery {
                gas: a.get(2).cloned().unwrap_or("N2O".into()),
                from: None,
                to: None,
                sources: vec!["robot".into(), "manual".into()],
                flux_ids: None
            })?)
        }
        "export" => {
            s.project_open(arg(1)?)?;
            let table = s.list_fluxes()?;
            let opts = ExportArgs {
                path: arg(2)?.into(),
                flux_ids: table
                    .data
                    .get("id")
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_i64)
                    .collect(),
                columns: table.columns.iter().map(|c| c.key.clone()).collect(),
                mode: a.get(3).cloned().unwrap_or("flat".into()),
            };
            if opts.path.to_lowercase().ends_with(".csv") {
                s.export_csv(opts)?;
            } else {
                s.export_xlsx(opts)?;
            }
            Value::Null
        }
        "dump-json" => {
            let args: Value = if let Some(text) = a.get(2) {
                let text = if let Some(path) = text.strip_prefix('@') {
                    std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?
                } else {
                    text.clone()
                };
                serde_json::from_str(&text)?
            } else {
                json!({})
            };
            if let Some(path) = args["projectPath"].as_str() {
                s.project_open(path)?;
            }
            call(&mut s, arg(1)?, args)?
        }
        _ => {
            return Err(concat!(
                "usage: ffr-cli import-legacy <legacy> <raw> <out> | info <project> | ",
                "parity <raw> <slopes.txt> [df.csv metno.pickle] | recompute <project> | ",
                "export <project> <out> [mode] | summary <project> [gas] | ",
                "diagnostics <project> | dump-json <command> [JSON or @file]"
            )
            .into())
        }
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
