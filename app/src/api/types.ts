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
}
