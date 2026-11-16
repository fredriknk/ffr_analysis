use ffr_core::{LegacyImportArgs, Session, SummaryQuery};
use serde_json::json;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let out = &args[1];
    let mut s = Session::default();
    let start = std::time::Instant::now();
    let info = s.legacy_import(
        LegacyImportArgs {
            legacy_dir: std::env::var("FFR_CAPTURE_LEGACY")?,
            raw_dir: Some(std::env::var("FFR_CAPTURE_RAW")?),
            manual_path: std::env::var("FFR_CAPTURE_MANUAL").ok(),
            logger_path: std::env::var("FFR_CAPTURE_LOGGER").ok(),
            metno_pickle_path: std::env::var("FFR_METNO_PICKLE").ok(),
            out_path: out.clone(),
            preset: Some("capture".into()),
        },
        |p| {
            if p.done % 500 == 0 {
                eprintln!("{} {}/{}", p.task, p.done, p.total);
            }
        },
    )?;
    let import_seconds = start.elapsed().as_secs_f64();
    s.project_close();
    let start = std::time::Instant::now();
    s.project_open(out)?;
    let open_seconds = start.elapsed().as_secs_f64();
    let start = std::time::Instant::now();
    let table = s.list_fluxes()?;
    let list_seconds = start.elapsed().as_secs_f64();
    let start = std::time::Instant::now();
    let id = table.data["id"][0].as_i64().ok_or("id")?;
    let detail = s.get_flux_detail(id)?;
    let options = detail.options;
    let start_preview = std::time::Instant::now();
    s.preview_flux(id, options)?;
    let preview_seconds = start_preview.elapsed().as_secs_f64();
    let detail_seconds = start.elapsed().as_secs_f64();
    let summary = s.treatment_summary(SummaryQuery {
        gas: "N2O".into(),
        from: None,
        to: None,
        sources: vec!["robot".into()],
        flux_ids: None,
    })?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"info":info,
                "importSeconds":import_seconds,
                "openSeconds":open_seconds,
                "listSeconds":list_seconds,
                "detailSeconds":detail_seconds,
                "previewSeconds":preview_seconds,
                "summary":summary}))?
    );
    Ok(())
}
