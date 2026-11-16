use ffr_core::{api::*, Session};
use serde_json::{json, Value};
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| a.get(i).map(String::as_str).ok_or("missing argument");
    let mut s = Session::default();
    let result=match arg(0)?{
 "parity"=>serde_json::to_value(ffr_core::parity::parity(std::path::Path::new(arg(1)?),std::path::Path::new(arg(2)?))?)?,
 "import-legacy"=>{let raw=arg(2)?;serde_json::to_value(s.legacy_import(LegacyImportArgs{legacy_dir:arg(1)?.into(),raw_dir:Some(raw.into()),out_path:arg(3)?.into(),manual_path:std::env::var("FFR_CAPTURE_MANUAL").ok(),logger_path:std::env::var("FFR_CAPTURE_LOGGER").ok(),metno_pickle_path:std::env::var("FFR_METNO_PICKLE").ok(),preset:None},|p|{if p.done%100==0{eprintln!("{} {}/{}",p.task,p.done,p.total);}})?)?},
 "info"=>serde_json::to_value(s.project_open(arg(1)?)?)?,
 "recompute"=>{s.project_open(arg(1)?)?;s.recompute_all(|_|{})?;json!(s.project_info()?)},
 "summary"=>{s.project_open(arg(1)?)?;s.treatment_summary(SummaryQuery{gas:a.get(2).cloned().unwrap_or("N2O".into()),from:None,to:None,sources:vec!["robot".into(),"manual".into()],flux_ids:None})?},
 "export"=>{s.project_open(arg(1)?)?;let table=s.list_fluxes()?;let opts=ExportArgs{path:arg(2)?.into(),flux_ids:table.data.get("id").into_iter().flatten().filter_map(Value::as_i64).collect(),columns:table.columns.iter().map(|c|c.key.clone()).collect(),mode:a.get(3).cloned().unwrap_or("flat".into())};if opts.path.ends_with(".csv"){s.export_csv(opts)?;}else{s.export_xlsx(opts)?;}Value::Null},
 "dump-json"=>{let cmd=arg(1)?;let args:Value=a.get(2).map(|s|serde_json::from_str(s)).transpose()?.unwrap_or(json!({}));if let Some(path)=args["projectPath"].as_str(){s.project_open(path)?;}match cmd {
 "projectCreate"=>json!(s.project_create(args["path"].as_str().ok_or("path required")?,args["name"].as_str().ok_or("name required")?)?),
 "projectOpen"=>json!(s.project_open(args["path"].as_str().ok_or("path required")?)?),
 "projectInfo"=>json!(s.project_info()?),"recentProjects"=>json!(s.recent_projects()),"legacyScan"=>s.legacy_scan(args["dir"].as_str().ok_or("dir required")?)?,"legacyImport"=>json!(s.legacy_import(serde_json::from_value(args)?,|_|{})?),
 "getConfig"=>json!(s.get_config()?),"getLayout"=>json!(s.get_layout()?),"listFluxes"=>json!(s.list_fluxes()?),"getFluxDetail"=>s.get_flux_detail(args["fluxId"].as_i64().ok_or("fluxId required")?)?,"previewFlux"=>s.preview_flux(args["fluxId"].as_i64().ok_or("fluxId required")?,serde_json::from_value(args["options"].clone())?)?,"listSeries"=>json!(s.list_series()?),"getSeries"=>json!(s.get_series(&serde_json::from_value::<Vec<i64>>(args["ids"].clone())?,args["from"].as_i64(),args["to"].as_i64(),args["maxPoints"].as_u64().map(|n|n as usize))?),"treatmentSummary"=>s.treatment_summary(serde_json::from_value(args)?)?,"previewTable"=>s.preview_table(args["path"].as_str().ok_or("path required")?,args["opts"].clone())?,"history"=>json!(s.history(args["limit"].as_u64().unwrap_or(100) as usize)?),"undo"=>s.undo()?,"redo"=>s.redo()?,_=>return Err(format!("unsupported dump-json command: {cmd}").into())}},
 _=>return Err("usage: ffr-cli import-legacy <legacy> <raw> <out> | info <project> | parity <raw> <golden.jsonl> | recompute <project> | export <project> <out> [mode] | summary <project> [gas] | dump-json <command> [JSON args]".into())};
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
