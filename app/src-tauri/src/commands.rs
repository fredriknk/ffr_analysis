use ffr_core::{api::*, Session};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};
#[derive(Default)]
pub struct AppState {
    session: Arc<Mutex<Session>>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    #[serde(default)]
    map_tiles_dir: Option<String>,
    recent: Vec<RecentProject>,
    client_id: Option<String>,
}
fn error(message: impl ToString) -> ApiError {
    ApiError {
        code: "desktop".into(),
        message: message.to_string(),
    }
}
fn prefs_path(app: &AppHandle) -> Result<PathBuf, ApiError> {
    let dir = app.path().app_config_dir().map_err(error)?;
    std::fs::create_dir_all(&dir).map_err(|e| error(format!("{}: {e}", dir.display())))?;
    Ok(dir.join("preferences.json"))
}
fn prefs(app: &AppHandle) -> Result<Preferences, ApiError> {
    let path = prefs_path(app)?;
    if !path.exists() {
        return Ok(Preferences::default());
    }
    let mut prefs: Preferences = serde_json::from_slice(
        &std::fs::read(&path).map_err(|e| error(format!("{}: {e}", path.display())))?,
    )
    .map_err(error)?;
    prefs.client_id = prefs.client_id.filter(|id| !id.trim().is_empty());
    Ok(prefs)
}
fn save_prefs(app: &AppHandle, prefs: &Preferences) -> Result<(), ApiError> {
    let path = prefs_path(app)?;
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, serde_json::to_vec(prefs).map_err(error)?).map_err(error)?;
    std::fs::rename(temporary, path).map_err(error)
}
fn remember(app: &AppHandle, info: &ProjectInfo) -> Result<(), ApiError> {
    let mut p = prefs(app)?;
    p.recent.retain(|r| r.path != info.path);
    p.recent.insert(
        0,
        RecentProject {
            path: info.path.clone(),
            name: info.name.clone(),
            opened_at: chrono_now(),
        },
    );
    p.recent.truncate(20);
    save_prefs(app, &p)
}
fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
async fn run<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&mut Session, &AppHandle) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let state = app.state::<AppState>().session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = state.lock().map_err(error)?;
        f(&mut s, &app)
    })
    .await
    .map_err(error)?
}
fn progress(app: &AppHandle, p: Progress) {
    let _ = app.emit("progress", p);
}

/// For operations long enough to deserve the progress strip. Quick per-flux
/// edits use `run`, so the Review screen does not flash a banner on every edit.
async fn run_task<T: Send + 'static>(
    app: AppHandle,
    task: &'static str,
    f: impl FnOnce(&mut Session, &AppHandle) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    run(app, move |s, app| {
        progress(
            app,
            Progress {
                task: task.into(),
                done: 0,
                total: 1,
                message: None,
            },
        );
        let result = f(s, app);
        progress(
            app,
            Progress {
                task: task.into(),
                done: 1,
                total: 1,
                message: None,
            },
        );
        result
    })
    .await
}

#[tauri::command]
async fn project_create(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<ProjectInfo, ApiError> {
    run_task(app, "project_create", move |s, app| {
        let _ = &s;
        let _ = &app;
        let info = s.project_create(&path, &name)?;
        remember(app, &info)?;
        Ok(info)
    })
    .await
}

#[tauri::command]
async fn project_open(app: AppHandle, path: String) -> Result<ProjectInfo, ApiError> {
    run_task(app, "project_open", move |s, app| {
        let _ = &s;
        let _ = &app;
        let info = s.project_open(&path)?;
        remember(app, &info)?;
        Ok(info)
    })
    .await
}

#[tauri::command]
async fn project_close(app: AppHandle) -> Result<(), ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        s.project_close();
        Ok(())
    })
    .await
}

#[tauri::command]
async fn project_info(app: AppHandle) -> Result<Option<ProjectInfo>, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.project_info()?)
    })
    .await
}

#[tauri::command]
async fn project_save_copy(app: AppHandle, path: String) -> Result<(), ApiError> {
    run_task(app, "project_save_copy", move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.project_save_copy(&path)?)
    })
    .await
}

/// The `.ffr` file the app was launched with (double-click in Explorer or
/// `ffr-analyzer.exe path\to\project.ffr`), if any.
#[tauri::command]
fn startup_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(std::path::PathBuf::from)
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ffr")) && p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn recent_projects(app: AppHandle) -> Result<Vec<RecentProject>, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(prefs(app)?.recent)
    })
    .await
}

#[tauri::command]
async fn legacy_scan(app: AppHandle, dir: String) -> Result<LegacyScan, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.legacy_scan(&dir)?)
    })
    .await
}

#[tauri::command]
async fn legacy_import(app: AppHandle, args: LegacyImportArgs) -> Result<ProjectInfo, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        let info = s.legacy_import(args, |p| progress(app, p))?;
        remember(app, &info)?;
        Ok(info)
    })
    .await
}

#[tauri::command]
async fn import_raw_files(app: AppHandle, paths: Vec<String>) -> Result<ImportReport, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.import_raw_files(&paths, |p| progress(app, p))?)
    })
    .await
}

#[tauri::command]
async fn get_config(app: AppHandle) -> Result<ProjectConfig, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.get_config()?)
    })
    .await
}

#[tauri::command]
async fn set_config(app: AppHandle, cfg: ProjectConfig) -> Result<(), ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.set_config(cfg, |p| progress(app, p))?)
    })
    .await
}

#[tauri::command]
async fn get_layout(app: AppHandle) -> Result<Layout, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.get_layout()?)
    })
    .await
}

#[tauri::command]
async fn set_layout(app: AppHandle, layout: Layout) -> Result<(), ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.set_layout(layout, |p| progress(app, p))?)
    })
    .await
}

#[tauri::command]
async fn list_fluxes(app: AppHandle) -> Result<FluxTable, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.list_fluxes()?)
    })
    .await
}

#[tauri::command]
async fn get_flux_detail(app: AppHandle, flux_id: i64) -> Result<FluxDetail, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.get_flux_detail(flux_id)?)
    })
    .await
}

#[tauri::command]
async fn preview_flux(
    app: AppHandle,
    flux_id: i64,
    options: AnalysisOptions,
) -> Result<FluxDetail, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.preview_flux(flux_id, options)?)
    })
    .await
}

#[tauri::command]
async fn set_flux_options(
    app: AppHandle,
    flux_ids: Vec<i64>,
    options: Option<AnalysisOptions>,
) -> Result<Vec<FluxRow>, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.set_flux_options(&flux_ids, options)?)
    })
    .await
}

#[tauri::command]
async fn set_flux_flags(
    app: AppHandle,
    flux_ids: Vec<i64>,
    flags: Value,
) -> Result<Vec<FluxRow>, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.set_flux_flags(&flux_ids, flags)?)
    })
    .await
}

#[tauri::command]
async fn recompute_all(app: AppHandle) -> Result<(), ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.recompute_all(|p| progress(app, p))?)
    })
    .await
}

#[tauri::command]
async fn undo(app: AppHandle) -> Result<UndoResult, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.undo()?)
    })
    .await
}

#[tauri::command]
async fn redo(app: AppHandle) -> Result<UndoResult, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.redo()?)
    })
    .await
}

#[tauri::command]
async fn history(app: AppHandle, limit: usize) -> Result<Vec<Change>, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.history(limit)?)
    })
    .await
}

#[tauri::command]
async fn treatment_summary(app: AppHandle, q: SummaryQuery) -> Result<TreatmentSummary, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.treatment_summary(q)?)
    })
    .await
}

#[tauri::command]
async fn list_series(app: AppHandle) -> Result<Vec<SeriesMeta>, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.list_series()?)
    })
    .await
}

#[tauri::command]
async fn get_series(
    app: AppHandle,
    ids: Vec<i64>,
    from: Option<i64>,
    to: Option<i64>,
    max_points: Option<usize>,
) -> Result<Vec<SeriesData>, ApiError> {
    run(app, move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.get_series(&ids, from, to, max_points)?)
    })
    .await
}

#[tauri::command]
async fn preview_table(
    app: AppHandle,
    path: String,
    opts: Value,
) -> Result<TablePreview, ApiError> {
    run_task(app, "preview_table", move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.preview_table(&path, opts)?)
    })
    .await
}

#[tauri::command]
async fn import_series(app: AppHandle, args: Value) -> Result<(), ApiError> {
    run_task(app, "import_series", move |s, app| {
        let _ = &s;
        let _ = &app;
        s.import_series(args)?;
        Ok(())
    })
    .await
}

#[tauri::command]
async fn delete_series(app: AppHandle, id: i64) -> Result<(), ApiError> {
    run_task(app, "delete_series", move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.delete_series(id)?)
    })
    .await
}

#[tauri::command]
async fn import_manual_fluxes(app: AppHandle, args: Value) -> Result<ImportReport, ApiError> {
    run_task(app, "import_manual_fluxes", move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.import_manual_fluxes(args)?)
    })
    .await
}

#[tauri::command]
async fn metno_get_client_id(app: AppHandle) -> Result<bool, ApiError> {
    run(app, |_, app| Ok(prefs(app)?.client_id.is_some())).await
}

#[tauri::command]
async fn metno_set_client_id(app: AppHandle, id: String) -> Result<(), ApiError> {
    run(app, move |_, app| {
        let id = id.trim();
        if id.is_empty() {
            return Ok(());
        }
        let mut p = prefs(app)?;
        p.client_id = Some(id.to_owned());
        save_prefs(app, &p)
    })
    .await
}

#[tauri::command]
async fn metno_fetch(app: AppHandle, args: Value) -> Result<(), ApiError> {
    run(app, move |s, app| {
        let id = prefs(app)?
            .client_id
            .ok_or_else(|| error("met.no client ID required"))?;
        s.metno_set_client_id(id);
        Ok(s.metno_fetch(args, |p| progress(app, p))?)
    })
    .await
}

#[tauri::command]
async fn export_xlsx(app: AppHandle, args: ExportArgs) -> Result<(), ApiError> {
    run_task(app, "export_xlsx", move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.export_xlsx(args)?)
    })
    .await
}

#[tauri::command]
async fn export_csv(app: AppHandle, args: ExportArgs) -> Result<(), ApiError> {
    run_task(app, "export_csv", move |s, app| {
        let _ = &s;
        let _ = &app;
        Ok(s.export_csv(args)?)
    })
    .await
}

#[tauri::command]
async fn patch_flux_options(
    app: AppHandle,
    flux_ids: Vec<i64>,
    partial: Value,
) -> Result<Vec<FluxRow>, ApiError> {
    run(app, move |s, _| {
        Ok(s.patch_flux_options(&flux_ids, partial)?)
    })
    .await
}
#[tauri::command]
async fn get_flux_thumbs(
    app: AppHandle,
    flux_ids: Vec<i64>,
    gas: String,
    max_points: Option<usize>,
) -> Result<Vec<FluxThumb>, ApiError> {
    run(app, move |s, _| {
        Ok(s.get_flux_thumbs(&flux_ids, &gas, max_points.unwrap_or(60))?)
    })
    .await
}
#[tauri::command]
async fn diagnostics_summary(
    app: AppHandle,
) -> Result<Vec<ffr_core::diagnostics::DiagnosticSummary>, ApiError> {
    run(app, move |s, _| Ok(s.diagnostics_summary()?)).await
}
pub fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        waypoints_read,
        waypoints_write,
        waypoint_plots,
        apply_waypoint_layout,
        get_route,
        raw_folder_get,
        raw_folder_set,
        raw_folder_scan,
        map_tiles_get,
        map_tiles_set,
        map_tile,
        startup_path,
        patch_flux_options,
        get_flux_thumbs,
        diagnostics_summary,
        project_create,
        project_open,
        project_close,
        project_info,
        project_save_copy,
        recent_projects,
        legacy_scan,
        legacy_import,
        import_raw_files,
        get_config,
        set_config,
        get_layout,
        set_layout,
        list_fluxes,
        get_flux_detail,
        preview_flux,
        set_flux_options,
        set_flux_flags,
        recompute_all,
        undo,
        redo,
        history,
        treatment_summary,
        list_series,
        get_series,
        preview_table,
        import_series,
        delete_series,
        import_manual_fluxes,
        metno_get_client_id,
        metno_set_client_id,
        metno_fetch,
        export_xlsx,
        export_csv
    ]
}
#[tauri::command]
async fn waypoints_read(
    app: AppHandle,
    path: String,
) -> Result<Vec<ffr_core::waypoints::Waypoint>, ApiError> {
    run(app, move |s, _| Ok(s.waypoints_read(&path)?)).await
}
#[tauri::command]
async fn waypoints_write(
    app: AppHandle,
    path: String,
    points: Vec<ffr_core::waypoints::Waypoint>,
    source_path: Option<String>,
) -> Result<(), ApiError> {
    run(app, move |s, _| {
        Ok(s.waypoints_write(&path, &points, source_path.as_deref())?)
    })
    .await
}
#[tauri::command]
async fn waypoint_plots(
    app: AppHandle,
    points: Vec<ffr_core::waypoints::Waypoint>,
    opts: ffr_core::waypoints::PlotGenOptions,
) -> Result<ffr_core::waypoints::PlotProposal, ApiError> {
    run(app, move |s, _| Ok(s.waypoint_plots(&points, &opts)?)).await
}
#[tauri::command]
async fn apply_waypoint_layout(
    app: AppHandle,
    args: ffr_core::waypoints::ApplyWaypointLayoutArgs,
) -> Result<Layout, ApiError> {
    run_task(app, "apply_waypoint_layout", move |s, app| {
        Ok(s.apply_waypoint_layout(args, |p| progress(app, p))?)
    })
    .await
}
#[tauri::command]
async fn raw_folder_get(app: AppHandle) -> Result<Option<RawFolder>, ApiError> {
    run(app, move |s, _| Ok(s.raw_folder_get()?)).await
}
#[tauri::command]
async fn raw_folder_set(app: AppHandle, folder: Option<RawFolder>) -> Result<(), ApiError> {
    run(app, move |s, _| Ok(s.raw_folder_set(folder)?)).await
}
#[tauri::command]
async fn raw_folder_scan(app: AppHandle) -> Result<FolderReport, ApiError> {
    run(app, move |s, app| {
        Ok(s.raw_folder_scan(|p| progress(app, p))?)
    })
    .await
}
#[tauri::command]
async fn get_route(app: AppHandle) -> Result<Option<ffr_core::waypoints::StoredRoute>, ApiError> {
    run(app, move |s, _| Ok(s.get_route()?)).await
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct MapTiles {
    dir: String,
    levels: Vec<u32>,
}
#[derive(Debug, Serialize)]
struct MapTile {
    data: String,
    factor: u32,
    dx: u32,
    dy: u32,
}
fn tile_set(dir: String) -> Result<MapTiles, ApiError> {
    let mut levels = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries {
            let entry = entry.map_err(error)?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if entry.file_type().map_err(error)?.is_dir()
                && !name.is_empty()
                && name.bytes().all(|c| c.is_ascii_digit())
            {
                if let Ok(z) = name.parse::<u32>() {
                    if z <= 24 {
                        levels.push(z);
                    }
                }
            }
        }
    }
    levels.sort_unstable();
    levels.dedup();
    if levels.is_empty() {
        return Err(error(
            "No XYZ tiles found. Select the folder containing zoom folders (17, 18, …).",
        ));
    }
    Ok(MapTiles { dir, levels })
}
fn find_tile(tiles: &MapTiles, z: u32, x: u32, y: u32) -> Result<Option<MapTile>, ApiError> {
    use base64::Engine;
    if z > 24 || x >= 1u32 << z || y >= 1u32 << z {
        return Ok(None);
    }
    for level in tiles.levels.iter().rev().filter(|level| **level <= z) {
        let factor = 1u32 << (z - level);
        for ext in ["jpg", "png", "jpeg"] {
            let path = std::path::Path::new(&tiles.dir)
                .join(level.to_string())
                .join((x / factor).to_string())
                .join(format!("{}.{ext}", y / factor));
            match std::fs::read(&path) {
                Ok(bytes) => {
                    return Ok(Some(MapTile {
                        data: format!(
                            "data:image/{};base64,{}",
                            if ext == "png" { "png" } else { "jpeg" },
                            base64::engine::general_purpose::STANDARD.encode(bytes)
                        ),
                        factor,
                        dx: x % factor,
                        dy: y % factor,
                    }))
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(error(format!("{}: {e}", path.display()))),
            }
        }
    }
    Ok(None)
}
/// Map tiles are app preferences and files; they never touch the project, so
/// they run without the session lock and cannot stall behind a recompute.
async fn off_lock<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    tauri::async_runtime::spawn_blocking(move || f(&app))
        .await
        .map_err(error)?
}
#[tauri::command]
async fn map_tiles_get(app: AppHandle) -> Result<Option<MapTiles>, ApiError> {
    off_lock(app, |app| {
        prefs(app)?.map_tiles_dir.map(tile_set).transpose()
    })
    .await
}
#[tauri::command]
async fn map_tiles_set(app: AppHandle, dir: Option<String>) -> Result<Option<MapTiles>, ApiError> {
    off_lock(app, move |app| {
        let tiles = dir.clone().map(tile_set).transpose()?;
        let mut p = prefs(app)?;
        p.map_tiles_dir = dir;
        save_prefs(app, &p)?;
        Ok(tiles)
    })
    .await
}
#[tauri::command]
async fn map_tile(app: AppHandle, z: u32, x: u32, y: u32) -> Result<Option<MapTile>, ApiError> {
    off_lock(app, move |app| match prefs(app)?.map_tiles_dir {
        Some(dir) => find_tile(&tile_set(dir)?, z, x, y),
        None => Ok(None),
    })
    .await
}
#[cfg(test)]
mod tile_tests {
    use super::*;
    #[test]
    fn coarser_xyz_fallback_and_validation() {
        let dir = tempfile::tempdir().unwrap();
        assert!(tile_set(dir.path().to_string_lossy().into()).is_err());
        let folder = dir.path().join("2/1");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("2.png"), [1, 2, 3]).unwrap();
        let tiles = tile_set(dir.path().to_string_lossy().into()).unwrap();
        let tile = find_tile(&tiles, 4, 7, 9).unwrap().unwrap();
        assert_eq!((tile.factor, tile.dx, tile.dy), (4, 3, 1));
        assert!(tile.data.starts_with("data:image/png;base64,"));
        assert!(find_tile(&tiles, 4, 0, 0).unwrap().is_none());
    }
}
