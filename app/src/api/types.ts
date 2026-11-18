export type Gas = "N2O" | "CO2" | "CO" | "H2O" | "licor_H2O";
export type Source = "robot" | "manual";
export type DiagnosticLevels = Record<string, "info" | "warn" | "bad">;
export type Cell = number | string | boolean | null | DiagnosticLevels;
export interface ApiError {
  code: string;
  message: string;
}
export interface Progress {
  task: string;
  done: number;
  total: number;
  message?: string;
}
export interface ProjectInfo {
  path: string;
  name: string;
  timeZone: string;
  schemaVersion: number;
  counts: {
    measurements: number;
    fluxes: number;
    excluded: number;
    overridden: number;
    reviewed: number;
    manual: number;
    series: number;
  };
  timeRange: [number, number] | null;
}
export interface AnalysisOptions {
  mode: "fixed" | "auto" | "manual";
  start: number;
  stop: number;
  interval: number;
  crit: "steepest" | "mse";
  co2Guides: boolean;
  /** Fit that gives the reported flux; absent means "ols". */
  fit?: "ols" | "robust";
  cutBeginnings: number;
  cutEnds: number;
  valveOffset: number;
  slope?: number;
  perGas?: Partial<Record<Gas, Partial<AnalysisOptions>>>;
}
export interface ProjectConfig {
  name: string;
  timeZone: string;
  defaults: AnalysisOptions;
  gases: Gas[];
  fallbackTemperature: number;
  chamberHeight: number;
  pressure: number;
  qcThreshold: number;
  diagnostics: Record<string, number>;
  plotAssignment: "polygons" | "waypoint";
  /** Projected CRS of robot/waypoint coordinates: "EPSG:326NN" (UTM north) or "EPSG:327NN". */
  crs: string;
}
export interface Treatment {
  id: number;
  name: string;
  shortName: string;
  colour: string;
  sortOrder: number;
}
export interface Plot {
  id: number;
  label: string;
  treatmentId: number;
  block: number;
  polygon: [number, number][] | null;
  /** Route waypoints measuring this plot: trailing number of the waypoint name + chamber side. */
  waypoints?: WaypointRef[] | null;
}
export interface WaypointRef {
  waypoint: number;
  side: "left" | "right";
}
export type WaypointKind = "Measure" | "DriveThrough" | "TurningPoint" | "Stop";
export type WaypointSide = "both" | "left" | "right" | "none";
/** One row of a robot route CSV (`X,Y,Z,Angle,Type,MeasureSide,Name`, no header). */
export interface Waypoint {
  x: number;
  y: number;
  z: number;
  /** Heading in radians: 0 = grid east, counter-clockwise positive. */
  angle: number;
  kind: WaypointKind;
  side: WaypointSide;
  name: string;
  /** Original text of x, y, z, angle; kept when the value is unchanged so saving preserves precision. */
  original?: [string, string, string, string] | null;
}
export interface PlotGenOptions {
  /** Chambers closer than this (complete link, metres) are the same plot, e.g. two-way trips. */
  clusterDistance: number;
  /** auto: square sized by the nearest other plot centre; square: `size`; rectangle: `width` × `height`. */
  shape: "auto" | "square" | "rectangle";
  size: number;
  /** Along the field direction (`angle`). */
  width: number;
  /** Across the field direction. */
  height: number;
  /** Field direction in radians; null = minimum-area bounding rectangle of the plot centres. */
  angle: number | null;
  labelPrefix: string;
}
export interface WaypointVisit {
  /** Index into the route. */
  waypointIndex: number;
  name: string;
  /** Trailing number of the name (what raw file names are matched on), null if none. */
  waypoint: number | null;
  side: "left" | "right";
  /** Chamber position. */
  x: number;
  y: number;
}
export interface ProposedPlot {
  /** 1..n in order of the first visit along the route. */
  key: number;
  label: string;
  /** Mean chamber position. */
  x: number;
  y: number;
  polygon: [number, number][];
  visits: WaypointVisit[];
}
export interface PlotProposal {
  /** Field direction used for the polygons, radians. */
  angle: number;
  plots: ProposedPlot[];
}
export interface ApplyWaypointLayoutArgs {
  points: Waypoint[];
  sourcePath?: string | null;
  plots: {
    label: string;
    polygon: [number, number][];
    /** Missing/null: an "Unassigned" treatment (created when needed). */
    treatmentId?: number | null;
    block?: number;
    waypoints: WaypointRef[];
  }[];
}
export interface StoredRoute {
  points: Waypoint[];
  sourcePath: string | null;
  savedAt: number;
}
/** Local XYZ imagery folder (`{dir}/{z}/{x}/{y}.jpg|png`), an app preference. */
export interface MapTiles {
  dir: string;
  levels: number[];
}
/** `data` is a data URL. A coarser tile may fill in: the requested tile is
 *  sub-tile (`dx`, `dy`) of a `factor` × `factor` split of `data`. */
export interface MapTile {
  data: string;
  factor: number;
  dx: number;
  dy: number;
}
export interface Layout {
  treatments: Treatment[];
  plots: Plot[];
}
export interface ColumnMeta {
  key: string;
  label: string;
  unit?: string;
  type: "number" | "string" | "boolean" | "time" | "category";
  group: string;
}
export interface FluxTable {
  columns: ColumnMeta[];
  rows: number;
  data: Record<string, Cell[]>;
}
export interface FluxRow {
  id: number;
  measurementId: number | null;
  source: Source;
  time: number;
  filename: string;
  side: "left" | "right";
  plotId: number;
  plotLabel: string;
  treatmentId: number;
  treatmentName: string;
  excluded: boolean;
  reviewed: boolean;
  overridden: boolean;
  note: string;
  airTemp: number;
  precip: number;
  attention: number;
  diag: string;
  diagSeverity?: DiagnosticLevels;
  valveLagS: number;
  x: number;
  y: number;
  [key: string]: Cell | undefined;
  N2O_lagS?: number | null;
}
export interface Regression {
  gas: Gas;
  slope: number;
  intercept: number;
  start: number;
  stop: number;
  n: number;
  rsq: number;
  pval: number;
  mse: number;
  seSlope: number;
  seIntercept: number;
  minY: number;
  maxY: number;
  firstY: number;
  flux: number;
  fluxUnit: string;
  qc: string;
}
export interface Trace {
  gas: Gas;
  unit: string;
  t: number[];
  y: number[];
  side: (0 | 1 | 2)[];
  used: boolean[];
  fit: (number | null)[];
}
export interface Diagnostic {
  code: string;
  severity: "info" | "warn" | "bad";
  gas?: string;
  value?: number;
  message: string;
}
export interface DiagnosticCount {
  warnBad?: number;
  info?: number;
  pending?: number;
  code: string;
  label: string;
  description: string;
  severity: Diagnostic["severity"];
  count: number;
  unreviewed: number;
}
export interface FluxThumb {
  fluxId: number;
  t: number[];
  y: number[];
  used: boolean[];
  slope: number;
  intercept: number;
}
export interface RobustRegression {
  gas: Gas;
  slope: number;
  intercept: number;
  start: number;
  stop: number;
  n: number;
  flux: number;
  options?: Partial<AnalysisOptions>;
}
export interface FluxDetail {
  robust?: RobustRegression[];
  diagnostics: Diagnostic[];
  valveLagS: number;
  flux: FluxRow;
  options: AnalysisOptions;
  isOverridden: boolean;
  siblingFluxId: number | null;
  switches: { t: number; side: "left" | "right" }[];
  traces: Trace[];
  regressions: Regression[];
  sibling: Regression[];
}
export interface FluxFlags {
  excluded?: boolean;
  reviewed?: boolean;
  note?: string;
  plotOverride?: number;
  /** Per-gas exclusion choice merged into the flux; null returns to automatic. */
  gasExcluded?: Partial<Record<Gas, boolean | null>>;
}
export interface Change {
  id: number;
  time: number;
  kind: string;
  fluxIds: number[];
  before?: unknown;
  after?: unknown;
}
export interface UndoResult {
  changed: boolean;
  canUndo: boolean;
  canRedo: boolean;
}
export interface SummaryQuery {
  gas: Gas;
  from?: number;
  to?: number;
  sources: Source[];
  fluxIds?: number[];
}
export interface TreatmentSummary {
  gas: Gas;
  unit: string;
  cumulativeUnit: string;
  treatments: {
    id: number;
    name: string;
    colour: string;
    nPlots: number;
    mean: number;
    sd: number;
    gmean: number | null;
    gsd: number | null;
    box: [number, number, number, number, number];
  }[];
  plots: {
    plotId: number;
    label: string;
    treatmentId: number;
    total: number;
    points: { fluxId: number; time: number; value: number }[];
    daily: { time: number; mean: number; cumulative: number }[];
  }[];
}
export interface SeriesMeta {
  key?: string;
  displayName?: string;
  id: number;
  name: string;
  unit: string;
  source: string;
  count: number;
  timeRange: [number, number];
}
export interface SeriesData {
  id: number;
  points: { time: number; value: number }[];
}
export interface TableOptions {
  sheet?: string;
  headerRow?: number;
  skipRows?: number;
}
export interface TablePreview {
  sheets: string[];
  headerCandidates: number[];
  columns: string[];
  rows: Cell[][];
}
export interface ImportSeriesArgs {
  path: string;
  sheet?: string;
  headerRow: number;
  timeColumn: string;
  valueColumns: string[];
  aggregate: "mean" | "sum" | "none";
  maxGap?: number;
}
export interface ImportManualArgs {
  path: string;
  sheet?: string;
  headerRow: number;
  dateColumn: string;
  plotColumn: string;
  gasColumns: Partial<Record<Gas, string>>;
  offsetHours?: number;
}
export interface ImportReport {
  imported: number;
  skipped: number;
  errors: { path: string; message: string }[];
}
/** A folder of robot raw files the project imports new files from. */
export interface RawFolder {
  path: string;
  /** Import only files with a chamber inside one of the project's plots. */
  fieldOnly: boolean;
  /** Check automatically while the project is open. */
  auto: boolean;
  lastScan?: number | null;
  lastReport?: FolderReport | null;
}
export interface FolderReport {
  files: number;
  known: number;
  outsideField: number;
  imported: number;
  errors: { path: string; message: string }[];
}
export interface LegacyScan {
  rawDir?: string;
  manualPath?: string;
  loggerPath?: string;
  metnoPicklePath?: string;
  configPaths: string[];
  rawFiles: number;
  manualExists: boolean;
  loggerExists: boolean;
  weatherExists: boolean;
  warnings: string[];
}
export interface LegacyImportArgs {
  legacyDir: string;
  rawDir: string;
  manualPath?: string;
  loggerPath?: string;
  metnoPicklePath?: string;
  outPath: string;
}
export interface ExportArgs {
  path: string;
  fluxIds: number[];
  columns: string[];
}
export interface FfrApi {
  startupPath(): Promise<string | null>;
  projectCreate(path: string, name: string): Promise<ProjectInfo>;
  projectOpen(path: string): Promise<ProjectInfo>;
  projectClose(): Promise<void>;
  projectInfo(): Promise<ProjectInfo | null>;
  projectSaveCopy(path: string): Promise<void>;
  recentProjects(): Promise<{ path: string; name: string; openedAt: number }[]>;
  legacyScan(dir: string): Promise<LegacyScan>;
  legacyImport(args: LegacyImportArgs): Promise<ProjectInfo>;
  importRawFiles(paths: string[]): Promise<ImportReport>;
  getConfig(): Promise<ProjectConfig>;
  setConfig(cfg: ProjectConfig): Promise<void>;
  getLayout(): Promise<Layout>;
  setLayout(layout: Layout): Promise<void>;
  listFluxes(): Promise<FluxTable>;
  getFluxDetail(fluxId: number): Promise<FluxDetail>;
  previewFlux(fluxId: number, options: AnalysisOptions): Promise<FluxDetail>;
  setFluxOptions(
    fluxIds: number[],
    options: AnalysisOptions | null,
  ): Promise<FluxRow[]>;
  setFluxFlags(fluxIds: number[], flags: FluxFlags): Promise<FluxRow[]>;
  patchFluxOptions(
    fluxIds: number[],
    partial: Partial<AnalysisOptions>,
  ): Promise<FluxRow[]>;
  getFluxThumbs(
    fluxIds: number[],
    gas: Gas,
    maxPoints?: number,
  ): Promise<FluxThumb[]>;
  diagnosticsSummary(): Promise<DiagnosticCount[]>;
  recomputeAll(): Promise<void>;
  undo(): Promise<UndoResult>;
  redo(): Promise<UndoResult>;
  history(limit: number): Promise<Change[]>;
  treatmentSummary(q: SummaryQuery): Promise<TreatmentSummary>;
  listSeries(): Promise<SeriesMeta[]>;
  getSeries(
    ids: number[],
    from?: number,
    to?: number,
    maxPoints?: number,
  ): Promise<SeriesData[]>;
  previewTable(path: string, opts: TableOptions): Promise<TablePreview>;
  importSeries(args: ImportSeriesArgs): Promise<void>;
  deleteSeries(id: number): Promise<void>;
  importManualFluxes(args: ImportManualArgs): Promise<ImportReport>;
  metnoGetClientId(): Promise<string | null>;
  metnoSetClientId(id: string): Promise<void>;
  metnoFetch(args: {
    station: string;
    from: number;
    to: number;
  }): Promise<void>;
  exportXlsx(
    args: ExportArgs & { mode: "flat" | "sheetPerPlot" | "dailyPerPlot" },
  ): Promise<void>;
  exportCsv(args: ExportArgs): Promise<void>;
  onProgress(cb: (event: Progress) => void): Promise<() => void>;
  waypointsRead(path: string): Promise<Waypoint[]>;
  /** Refuses to overwrite `sourcePath`; replaces `path` atomically. */
  waypointsWrite(
    path: string,
    points: Waypoint[],
    sourcePath?: string | null,
  ): Promise<void>;
  waypointPlots(
    points: Waypoint[],
    opts: PlotGenOptions,
  ): Promise<PlotProposal>;
  /** Replaces the project's plots (one undo step), stores the route, recomputes. */
  applyWaypointLayout(args: ApplyWaypointLayoutArgs): Promise<Layout>;
  getRoute(): Promise<StoredRoute | null>;
  rawFolderGet(): Promise<RawFolder | null>;
  rawFolderSet(folder: RawFolder | null): Promise<void>;
  rawFolderScan(): Promise<FolderReport>;
  mapTilesGet(): Promise<MapTiles | null>;
  mapTilesSet(dir: string | null): Promise<MapTiles | null>;
  mapTile(z: number, x: number, y: number): Promise<MapTile | null>;
}
