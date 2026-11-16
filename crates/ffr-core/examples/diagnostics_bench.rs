use ffr_core::{Session, SummaryQuery};
use serde_json::json;
use std::time::Instant;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("project required")?;
    let mut s = Session::default();
    let start = Instant::now();
    s.project_open(&path)?;
    let open = start.elapsed().as_secs_f64();
    let mut cfg = s.get_config()?;
    cfg.diagnostics = Default::default();
    let start = Instant::now();
    s.set_config(cfg, |p| {
        if p.done % 1000 == 0 {
            eprintln!("{} {}/{}", p.task, p.done, p.total);
        }
    })?;
    let recompute = start.elapsed().as_secs_f64();
    let start = Instant::now();
    let table = s.list_fluxes()?;
    let list = start.elapsed().as_secs_f64();
    let ids: Vec<i64> = table.data["id"]
        .iter()
        .zip(&table.data["source"])
        .filter(|(_, s)| **s == "robot")
        .filter_map(|(id, _)| id.as_i64())
        .take(200)
        .collect();
    let start = Instant::now();
    let detail = s.get_flux_detail(ids[0])?;
    let detail_time = start.elapsed().as_secs_f64();
    let start = Instant::now();
    s.preview_flux(ids[0], detail.options)?;
    let preview = start.elapsed().as_secs_f64();
    let start = Instant::now();
    let thumbs = s.get_flux_thumbs(&ids, "N2O", 60)?;
    let thumbnails = start.elapsed().as_secs_f64();
    let start = Instant::now();
    s.treatment_summary(SummaryQuery {
        gas: "N2O".into(),
        from: None,
        to: None,
        sources: vec!["robot".into(), "manual".into()],
        flux_ids: None,
    })?;
    let summary = start.elapsed().as_secs_f64();
    let report = s.diagnostics_report()?;
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"timingsSeconds":{"open":open,"recompute":recompute,"listFluxes":list,"getFluxDetail":detail_time,"previewFlux":preview,"getFluxThumbs200":thumbnails,"treatmentSummary":summary},"thumbnails":thumbs.len(),"diagnostics":report})
        )?
    );
    Ok(())
}
