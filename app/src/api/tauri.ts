import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { seriesDisplay, unit } from "../shared/format";
import type { FfrApi, Progress } from "./types";
export const tauriApi: FfrApi = {
  startupPath: () => invoke("startup_path"),
  projectCreate: (path, name) => invoke("project_create", { path, name }),
  projectOpen: (path) => invoke("project_open", { path }),
  projectClose: () => invoke("project_close"),
  projectInfo: () => invoke("project_info"),
  projectSaveCopy: (path) => invoke("project_save_copy", { path }),
  recentProjects: () => invoke("recent_projects"),
  legacyScan: (dir) => invoke("legacy_scan", { dir }),
  legacyImport: (args) => invoke("legacy_import", { args }),
  importRawFiles: (paths) => invoke("import_raw_files", { paths }),
  getConfig: () => invoke("get_config"),
  setConfig: (cfg) => invoke("set_config", { cfg }),
  getLayout: () => invoke("get_layout"),
  setLayout: (layout) => invoke("set_layout", { layout }),
  listFluxes: () => invoke("list_fluxes"),
  getFluxDetail: (fluxId) => invoke("get_flux_detail", { fluxId }),
  previewFlux: (fluxId, options) => invoke("preview_flux", { fluxId, options }),
  setFluxOptions: (fluxIds, options) =>
    invoke("set_flux_options", { fluxIds, options }),
  setFluxFlags: (fluxIds, flags) =>
    invoke("set_flux_flags", { fluxIds, flags }),
  patchFluxOptions: (fluxIds, partial) =>
    invoke("patch_flux_options", { fluxIds, partial }),
  getFluxThumbs: (fluxIds, gas, maxPoints = 60) =>
    invoke("get_flux_thumbs", { fluxIds, gas, maxPoints }),
  diagnosticsSummary: () => invoke("diagnostics_summary"),
  recomputeAll: () => invoke("recompute_all"),
  undo: () => invoke("undo"),
  redo: () => invoke("redo"),
  history: async (limit) =>
    (await invoke<import("./types").Change[]>("history", { limit })).map(
      (c) => ({ id: c.id, time: c.time, kind: c.kind, fluxIds: c.fluxIds }),
    ),
  treatmentSummary: async (q) => {
    const d = await invoke<import("./types").TreatmentSummary>(
      "treatment_summary",
      { q },
    );
    return { ...d, unit: unit(d.unit), cumulativeUnit: unit(d.cumulativeUnit) };
  },
  listSeries: async () =>
    (await invoke<import("./types").SeriesMeta[]>("list_series")).map(
      seriesDisplay,
    ),
  getSeries: (ids, from, to, maxPoints) =>
    invoke("get_series", { ids, from, to, maxPoints }),
  previewTable: (path, opts) => invoke("preview_table", { path, opts }),
  importSeries: (args) => invoke("import_series", { args }),
  deleteSeries: (id) => invoke("delete_series", { id }),
  importManualFluxes: (args) => invoke("import_manual_fluxes", { args }),
  metnoGetClientId: () => invoke("metno_get_client_id"),
  metnoSetClientId: (id) => invoke("metno_set_client_id", { id }),
  metnoFetch: (args) => invoke("metno_fetch", { args }),
  exportXlsx: (args) => invoke("export_xlsx", { args }),
  exportCsv: (args) => invoke("export_csv", { args }),
  waypointsRead: (path) => invoke("waypoints_read", { path }),
  waypointsWrite: (path, points, sourcePath = null) =>
    invoke("waypoints_write", { path, points, sourcePath }),
  waypointPlots: (points, opts) => invoke("waypoint_plots", { points, opts }),
  applyWaypointLayout: (args) => invoke("apply_waypoint_layout", { args }),
  getRoute: () => invoke("get_route"),
  rawFolderGet: () => invoke("raw_folder_get"),
  rawFolderSet: (folder) => invoke("raw_folder_set", { folder }),
  rawFolderScan: (args) =>
    invoke("raw_folder_scan", {
      all: args?.all ?? false,
      project: args?.project ?? null,
    }),
  mapTilesGet: () => invoke("map_tiles_get"),
  mapTilesSet: (dir) => invoke("map_tiles_set", { dir }),
  mapTile: (z, x, y) => invoke("map_tile", { z, x, y }),
  onProgress: (cb) =>
    listen<Progress>("progress", (event) => cb(event.payload)),
};
