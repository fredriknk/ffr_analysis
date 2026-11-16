use ffr_core::{api::*,Session};
use serde::{Serialize,Deserialize};
use serde_json::Value;
use std::{sync::{Arc,Mutex},path::PathBuf};
use tauri::{Manager,Emitter,AppHandle};
#[derive(Default)]
pub struct AppState {session:Arc<Mutex<Session>>}
#[derive(Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
struct Preferences {recent:Vec<RecentProject>,client_id:Option<String>}
fn error(message:impl ToString)->ApiError{ApiError{code:"desktop".into(),message:message.to_string()}}
fn prefs_path(app:&AppHandle)->Result<PathBuf,ApiError>{let dir=app.path().app_config_dir().map_err(error)?;std::fs::create_dir_all(&dir).map_err(error)?;Ok(dir.join("preferences.json"))}
fn prefs(app:&AppHandle)->Result<Preferences,ApiError>{let path=prefs_path(app)?;if !path.exists(){return Ok(Preferences::default());}serde_json::from_slice(&std::fs::read(path).map_err(error)?).map_err(error)}
fn save_prefs(app:&AppHandle,prefs:&Preferences)->Result<(),ApiError>{let path=prefs_path(app)?;let temporary=path.with_extension("tmp");std::fs::write(&temporary,serde_json::to_vec(prefs).map_err(error)?).map_err(error)?;std::fs::rename(temporary,path).map_err(error)}
fn remember(app:&AppHandle,info:&ProjectInfo)->Result<(),ApiError>{let mut p=prefs(app)?;p.recent.retain(|r|r.path!=info.path);p.recent.insert(0,RecentProject{path:info.path.clone(),name:info.name.clone(),opened_at:chrono_now()});p.recent.truncate(20);save_prefs(app,&p)}
fn chrono_now()->i64{std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d|d.as_millis() as i64).unwrap_or(0)}
async fn run<T:Send+'static>(app:AppHandle,f:impl FnOnce(&mut Session,&AppHandle)->Result<T,ApiError>+Send+'static)->Result<T,ApiError>{let state=app.state::<AppState>().session.clone();tauri::async_runtime::spawn_blocking(move||{let mut s=state.lock().map_err(error)?;f(&mut s,&app)}).await.map_err(error)?}
fn progress(app:&AppHandle,p:Progress){let _=app.emit("progress",p);}

#[tauri::command]
async fn project_create(app:AppHandle,path:String,name:String)->Result<ProjectInfo,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;let info=s.project_create(&path,&name)?;remember(app,&info)?;Ok(info)}).await}

#[tauri::command]
async fn project_open(app:AppHandle,path:String)->Result<ProjectInfo,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;let info=s.project_open(&path)?;remember(app,&info)?;Ok(info)}).await}

#[tauri::command]
async fn project_close(app:AppHandle)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;s.project_close();Ok(())}).await}

#[tauri::command]
async fn project_info(app:AppHandle)->Result<Option<ProjectInfo>,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.project_info()?)}).await}

#[tauri::command]
async fn project_save_copy(app:AppHandle,path:String)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.project_save_copy(&path)?)}).await}

#[tauri::command]
async fn recent_projects(app:AppHandle)->Result<Vec<RecentProject>,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(prefs(app)?.recent)}).await}

#[tauri::command]
async fn legacy_scan(app:AppHandle,dir:String)->Result<LegacyScan,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.legacy_scan(&dir)?)}).await}

#[tauri::command]
async fn legacy_import(app:AppHandle,args:LegacyImportArgs)->Result<ProjectInfo,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;let info=s.legacy_import(args,|p|progress(app,p))?;remember(app,&info)?;Ok(info)}).await}

#[tauri::command]
async fn import_raw_files(app:AppHandle,paths:Vec<String>)->Result<ImportReport,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.import_raw_files(&paths,|p|progress(app,p))?)}).await}

#[tauri::command]
async fn get_config(app:AppHandle)->Result<ProjectConfig,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.get_config()?)}).await}

#[tauri::command]
async fn set_config(app:AppHandle,cfg:ProjectConfig)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.set_config(cfg,|p|progress(app,p))?)}).await}

#[tauri::command]
async fn get_layout(app:AppHandle)->Result<Layout,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.get_layout()?)}).await}

#[tauri::command]
async fn set_layout(app:AppHandle,layout:Layout)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.set_layout(layout,|p|progress(app,p))?)}).await}

#[tauri::command]
async fn list_fluxes(app:AppHandle)->Result<FluxTable,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.list_fluxes()?)}).await}

#[tauri::command]
async fn get_flux_detail(app:AppHandle,flux_id:i64)->Result<FluxDetail,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.get_flux_detail(flux_id)?)}).await}

#[tauri::command]
async fn preview_flux(app:AppHandle,flux_id:i64,options:AnalysisOptions)->Result<FluxDetail,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.preview_flux(flux_id,options)?)}).await}

#[tauri::command]
async fn set_flux_options(app:AppHandle,flux_ids:Vec<i64>,options:Option<AnalysisOptions>)->Result<Vec<FluxRow>,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.set_flux_options(&flux_ids,options)?)}).await}

#[tauri::command]
async fn set_flux_flags(app:AppHandle,flux_ids:Vec<i64>,flags:Value)->Result<Vec<FluxRow>,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.set_flux_flags(&flux_ids,flags)?)}).await}

#[tauri::command]
async fn recompute_all(app:AppHandle)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.recompute_all(|p|progress(app,p))?)}).await}

#[tauri::command]
async fn undo(app:AppHandle)->Result<UndoResult,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.undo()?)}).await}

#[tauri::command]
async fn redo(app:AppHandle)->Result<UndoResult,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.redo()?)}).await}

#[tauri::command]
async fn history(app:AppHandle,limit:usize)->Result<Vec<Change>,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.history(limit)?)}).await}

#[tauri::command]
async fn treatment_summary(app:AppHandle,q:SummaryQuery)->Result<TreatmentSummary,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.treatment_summary(q)?)}).await}

#[tauri::command]
async fn list_series(app:AppHandle)->Result<Vec<SeriesMeta>,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.list_series()?)}).await}

#[tauri::command]
async fn get_series(app:AppHandle,ids:Vec<i64>,from:Option<i64>,to:Option<i64>,max_points:Option<usize>)->Result<Vec<SeriesData>,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.get_series(&ids,from,to,max_points)?)}).await}

#[tauri::command]
async fn preview_table(app:AppHandle,path:String,opts:Value)->Result<TablePreview,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.preview_table(&path,opts)?)}).await}

#[tauri::command]
async fn import_series(app:AppHandle,args:Value)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;s.import_series(args)?;Ok(())}).await}

#[tauri::command]
async fn delete_series(app:AppHandle,id:i64)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.delete_series(id)?)}).await}

#[tauri::command]
async fn import_manual_fluxes(app:AppHandle,args:Value)->Result<ImportReport,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.import_manual_fluxes(args)?)}).await}

#[tauri::command]
async fn metno_get_client_id(app:AppHandle)->Result<Option<String>,ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(prefs(app)?.client_id)}).await}

#[tauri::command]
async fn metno_set_client_id(app:AppHandle,id:String)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;let mut p=prefs(app)?;p.client_id=Some(id.clone());save_prefs(app,&p)?;s.metno_set_client_id(id);Ok(())}).await}

#[tauri::command]
async fn metno_fetch(app:AppHandle,args:Value)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;if let Some(id)=prefs(app)?.client_id{s.metno_set_client_id(id);}Ok(s.metno_fetch(args,|p|progress(app,p))?)}).await}

#[tauri::command]
async fn export_xlsx(app:AppHandle,args:ExportArgs)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.export_xlsx(args)?)}).await}

#[tauri::command]
async fn export_csv(app:AppHandle,args:ExportArgs)->Result<(),ApiError>{run(app,move|s,app|{let _=&s;let _=&app;Ok(s.export_csv(args)?)}).await}

pub fn handlers()->impl Fn(tauri::ipc::Invoke)->bool + Send + Sync + 'static {tauri::generate_handler![project_create,project_open,project_close,project_info,project_save_copy,recent_projects,legacy_scan,legacy_import,import_raw_files,get_config,set_config,get_layout,set_layout,list_fluxes,get_flux_detail,preview_flux,set_flux_options,set_flux_flags,recompute_all,undo,redo,history,treatment_summary,list_series,get_series,preview_table,import_series,delete_series,import_manual_fluxes,metno_get_client_id,metno_set_client_id,metno_fetch,export_xlsx,export_csv]}
