# FFR Analyzer 2 — specification

This is the contract for the rewrite of the Field Flux Robot (FFR) analysis program.
The legacy Python/Tkinter program lives on the `legacy-python` branch (`prog/`, `Users/`;
file paths below refer to that branch) and is **reference only**:
read it to understand behaviour, never import from it, never modify it.

## 1. What the program is for

The field robot drives to waypoints in a field trial and measures gas concentrations in
**two chambers (left and right) multiplexed to one analyzer**. A valve switches between the
chambers about every 20 s, so one raw file (~185 s, 1 Hz) holds interleaved segments from
both chambers. From each chamber's points a linear regression of concentration against time
gives a slope (ppm/s), which is converted to a flux (e.g. µg N2O-N m⁻² h⁻¹).

The user's workflow:

1. **Review fluxes.** Step through thousands of measurements, see the raw trace, see which
   points were attributed to which chamber and which window the regression used, adjust the
   window, or exclude the flux.
2. **Compare treatments** (legacy name: "cumsum"). Fluxes per plot are integrated over time
   and summarised per treatment. Every point shown there must open its raw trace in one click.
3. **Bring in other data**: manual chamber measurements, met.no weather, soil loggers.
4. **Filter and export** to Excel.

## 2. Product requirements

- Runs on Windows 10/11 **without administrator rights**. Ships as a per-user installer and
  as a portable `.exe`, both downloadable from GitHub Releases.
- A project is **one file** (`*.ffr`). It contains everything: raw traces, settings, edits,
  external series. Copy the file to a colleague and they can keep working. No side-car
  config, no absolute paths that must exist.
- Old projects (a `Users/<Name>/` folder) are converted by an **import** function.
- Fast: opening a project and stepping between fluxes must feel instant.
- Every edit is saved immediately and can be undone.

## 3. Architecture

```
Cargo.toml                 workspace: crates/*
crates/ffr-core/           all domain logic, no UI, no Tauri. Library.
crates/ffr-cli/            dev CLI over ffr-core (import, recompute, export, parity checks)
app/                       desktop app
  src/                     React + TypeScript UI (Vite)
  src/api/                 typed API layer: one interface, two implementations
                           (tauri.ts -> invoke, mock.ts -> synthetic data in the browser)
  src-tauri/               Tauri 2 shell: thin #[tauri::command] wrappers around ffr-core
docs/SPEC.md               this file
```

- **Tauri 2** (Rust core + system WebView2). `app/src-tauri` is its own cargo workspace and
  depends on `ffr-core` by path.
- **UI**: React 18+, TypeScript strict, Vite, npm. Charts: Apache ECharts. Tables: TanStack
  Table with row virtualisation. The UI must run in a plain browser (`npm run dev`) against
  the mock API, so it can be developed and checked without the Rust side.
- **Project file**: SQLite (rusqlite, `bundled` feature). `journal_mode=DELETE` so a closed
  project is exactly one file. Raw traces are stored as zstd-compressed blobs.
- **No real measurement data in git.** Tests and the UI mock use synthetic data. Tests that
  need the real Capture dataset read its location from environment variables and are skipped
  when unset (section 9).

## 4. Domain rules (port these exactly)

"Legacy parity" means the new core reproduces the legacy numbers for the same inputs. Where
legacy behaviour looks odd it is still the default; do not "fix" it silently.

### 4.1 Raw file

Python pickle (protocol 0 ASCII in older files; any protocol must load) of a dict:

```
'aux'    : [(epoch_s, [side_nr, state]), '', (epoch_s, [side_nr, state]), '', ...]
           valve events. side_nr 1 = left, 2 = right; state 1 = on, 0 = off. '' entries are noise.
           (very old files: (epoch_s, int) — see prog/divide_left_and_right.py)
'li-cor' : {'dt', 't0': epoch_s, 'ty': [(t_rel_s, [CO2, H2O, P, Temp]), ...]}
'dlt'    : {'dt', 't0', 'ty': [(t_rel_s, [.. 30 values ..]), ...]}
           index 10 = N2O dry (ppm), 8 = CO dry, 6 = H2O, 12 = pressure
'wind'   : {'dt', 't0', 'ty': [(t_rel_s, (u, v, w) | None), ...]}   may be missing
```

Some files are gzip-compressed JSON with the same structure (`.gz`). Any of the instrument
keys may be absent. Store **all** channels in the project, not just the ones used today.

File name: `2022-09-01-13-07-15-x599233_533097-y6615294_3131-z0_0-h-1_13308241114_both_Plot_15_`
= local start time, vehicle x/y/z (UTM, `_` is the decimal point), heading (radians, may be
negative, may be missing), sides used (`left|right|both`), waypoint name. See
`prog/get_data.py` (`parse_filename1`, `parse_filename2`).

### 4.2 Time axes (important quirk)

- Sample times are `t_rel_s` exactly as stored, per instrument.
- Valve switch times are `epoch_s − T_file`, where `T_file` is the file-name time interpreted
  as **local time in the project time zone** (default `Europe/Oslo`; legacy used
  `time.mktime` on a machine in Norway). Use chrono-tz, never the machine's time zone.
- The instruments' own `t0` is ignored for alignment. Keep it that way; the cut parameters
  below were tuned against this.

### 4.3 Attributing points to chambers

Port `prog/divide_left_and_right.py` exactly, including `search_sorted`'s nearest-index
behaviour and the validation errors (a file that fails validation becomes a measurement with
an error status, not a crash). Defaults: `cut_beginnings = 4 s`, `cut_ends = 3 s` (these are
the values `Regressor._get_divide_cut_param` uses, not the function defaults).

### 4.4 Regression

Port `prog/regression.py` and `Regressor._regress1` in `prog/find_regressions.py`:

- Points with `y == 0` are dropped first.
- **Fixed window** (`start`, `stop` seconds): `regress_within`. Note the half-open slice
  `x[i:j]` (the point at `stop` is not included) and the `bisect_find(..., nearest=True)`
  index rules. This is the mode every legacy project actually uses, because the default
  options always contain `start` and `stop`.
- **Auto window** (`interval`, `crit` = `steepest` | `mse`): `find_best_regression`.
  With `co2_guides`, other gases reuse the window found for CO2.
- **Manual slope** (`slope` given): no fit.
- Statistics per regression: slope, intercept, n, mse = SSE/(n−2), r², two-sided p-value
  (Pearson, as `scipy.stats.pearsonr`), min_y, max_y, first_y, start, stop. Also store proper
  standard errors of slope and intercept (the legacy `se_*` formulas are wrong; do not port
  them).
- N2O quality flag: port `regression_quality_check_n2o` (thresholds become project settings).
- Gases regressed: CO2, N2O, CO, H2O, licor_H2O.

Legacy option resolution (`Options_manager.extract_options`) allows nesting by side and gas.
The new model is flatter, see 5.2.

### 4.5 Flux

`prog/flux_calculations.py`: `flux_mol_m2_s = slope_ppm_s × 1e-6 × p × h / (R × (T + 273.15))`
with p = 101000 Pa, h = 0.5 m, R = 8.314, T = air temperature in °C at the measurement time
(linear interpolation in the temperature series; if there is no temperature, use the
project's fallback temperature and flag the flux).

Units: `N2O_N_mug_m2h = flux × 2 × 14 × 1e6 × 3600`, `CO2_C_mug_m2h = flux × 12 × 1e6 × 3600`.

### 4.6 Chamber position and plot

Chamber position from vehicle position, heading and side: `prog/sort_results.py`
`chamber_position` (2 m sideways, 0.2 m forward). A flux belongs to a plot by one of:

- **polygons**: point-in-polygon on the chamber position (Capture: a 6×6 grid, see
  `Users/Capture/field_experiment.py` and `prog/polygon_utils.py`);
- **waypoint table**: (waypoint number, side) → plot (Truesoil, Greenmove);
- a per-flux manual override.

Plots belong to treatments.

**Plots from a robot route.** A route CSV (no header, `X,Y,Z,Angle,Type,MeasureSide,Name`;
angle in radians, 0 = grid east, counter-clockwise; types `Measure|DriveThrough|TurningPoint|Stop`;
sides `both|left|right|none`) gives one chamber per measured side of every `Measure` row,
placed as above (left = heading + 90°). Chambers are grouped in route order by complete
link: a chamber joins the first group whose every member is within the grouping distance
(default 1.5 m), so a two-way route that measures each plot twice yields one plot with two
visits. The field direction is the edge of the minimum-area rectangle around the group
centres (or given). Footprints are centred on each group: auto (square, half the distance
to the nearest other centre), a fixed square, or a fixed rectangle (width along the field
direction, length across). Each plot stores its polygon and its `(waypoint number, side)`
visits, where the waypoint number is the last digit run in the waypoint name. A flux
belongs to the first plot whose visits match its file's waypoint and side, or whose polygon
contains its chamber position, so moving or resizing a plot later does not lose fluxes that
the route already ties to it.

### 4.7 Treatment summary ("cumsum")

Port the maths of `App.allplot` in `prog/ffr_gui.py` (`getN2Odata`, `run_all_plots`):

- per plot: daily mean flux (days without data are skipped), converted to kg ha⁻¹ h⁻¹
  (`× 10000 / 1e9`), trapezoid between consecutive measured days, cumulative sum;
- per treatment: mean and population SD of its plots' totals; geometric mean and geometric
  SD of positive fluxes; distribution of daily means for a box plot.

Excluded fluxes never contribute. Works for any gas, any date range, and any subset of
sources (robot, manual).

### 4.8 External data

- **met.no Frost** (`prog/weather_data_from_metno.py`): station `SN17850`, hourly
  `air_temperature`, `max(...)`, `min(...)`, `sum(precipitation_amount PT1H)`; client ID as
  HTTP basic-auth user; requests chunked to ≤100 days. The client ID is a per-user app
  setting and is **never** written into a project file or committed.
- **Loggers**: any Excel/CSV with a time column. Legacy preset: `make_logger_data` in
  `prog/ffr_gui.py` (skip 2 rows; mean of all `VWC`, `°C Temp`, `mS/cm EC` columns).
- **Manual fluxes**: Excel/CSV with date, plot and flux columns (legacy: `date` + 12 h,
  `nr`, `N2O_N_mug_m2h`, `CO2_C_mug_m2h`).

Every flux row can be joined with every series (value nearest in time, with a maximum gap).

### 4.9 Diagnostics (review priority, independent of legacy regression)

Diagnostics never change the reported flux or exclude a flux. Findings have
`{code, severity: 'info'|'warn'|'bad', gas?, value?, impact?, message}` and are
recomputed with results. All numeric rule thresholds are `config.diagnostics` fields.

For each gas, `floor = noiseFloorMultiplier (3) ? median(flux standard error)`
from non-excluded robot fluxes; standard error uses the physical flux conversion
and `seSlope`, including zero slopes. Residual SD baselines use the same cohort.

For N2O and CO2, estimate separate valve lags over `valveSearchS` (10 s), in
`valveStepS` (0.5 s) steps, minimising both chambers' SSE. Require chamber contrast
above `lagContrastSd` (4) robust noise SDs and SSE improvement at least
`valveMinImprovement` (0.30). Lag is applied to the diagnostic refit when its
magnitude is at least `valveMinLagS` (1 s). `valveLagS` is CO2; `N2O_lagS` is
nullable when contrast is insufficient. Per-gas analysis options can override
`start`, `stop`, `cutBeginnings`, `cutEnds`, `valveOffset`; absent values inherit
flux-level options. Zero offset with absent per-gas overrides preserves parity.

Robust fits use the same window, gas-specific lag, `extraCutS` (3) extra seconds
at each segment end, and at most two passes dropping residuals above `robustMad`
(4) MAD. Store `<gas>_robustFlux`, `<gas>_impact`, `<gas>_seFlux`, and return
`FluxDetail.robust: {gas,slope,intercept,start,stop,n,flux}[]`.
`impact = abs(flux ? robustFlux) / max(abs(flux), abs(robustFlux), floor)`.

**Shape severity.** `valve_timing`, `edge_transient`, `spike`, `noisy` and
`curvature` are info below `shapeWarnImpact` (0.15), warn below
`shapeBadImpact` (0.35), otherwise bad. For the first four codes use the maximum
impact over N2O and CO2, with a gas contributing zero unless its absolute flux
change exceeds `shapeFloorMultiplier` (1) times its floor. Curvature instead uses
the absolute first-half versus second-half flux difference divided by
`max(abs(flux), floor)`, with the same original-versus-robust absolute floor gate and maximum over gases.
Messages show robust versus original flux and effective impact. Small-effect
findings remain visible as info chips and in diagnostic summaries.

| Code | Candidate / severity rule (defaults) |
|---|---|
| `error` | Measurement validation or regression failed: bad. |
| `valve_timing` | Meaningful lag meeting the lag and improvement thresholds; shape severity. |
| `edge_transient` | Edge residuals exceed interior residuals by `edgeRatio` (2.5); shape severity. |
| `spike` | Used residual exceeds `spikeMad` (6) robust SDs; shape severity. |
| `noisy` | Residual SD exceeds `noisyWarn` (4) times the gas baseline; shape severity, with no separate fixed bad threshold. |
| `curvature` | Quadratic F-test p below `curvatureP` (1e-12), half-window slopes differ by `curvatureSlopeChange` (0.4); shape severity. |
| `chamber_leak` | Day path: at least `leakMinDayPoints` (6) non-excluded robot observations; day median CO2 above `leakReferenceFloor` (5) floors and flux below `leakFraction` (0.25) of median: warn; bad if sibling CO2 exceeds `leakDaySiblingFraction` (0.5) of median or the N2O sibling test passes. Independently, sibling path: sibling CO2 above 5 floors and this flux below 0.25 of sibling: warn, bad if sibling N2O exceeds 5 floors and this N2O is below 0.25 of sibling. Both paths share the named reference/fraction thresholds. |
| `co2_not_rising` | CO2 below `co2NegativeFloor` (1) negative floors with p below `n2oNegativeP` (0.01): bad; flat noise is fine. |
| `n2o_negative` | N2O below `negativeInfoFloor` (1) negative floors with p below `n2oNegativeP` (0.01): info; warn below `negativeWarnFloor` (3) negative floors, bad below `negativeBadFloor` (5) or alongside `chamber_leak`. |
| `neighbour_outlier` | Compare non-excluded same-treatment observations within `neighbourDays` (3), falling back to same plot within `neighbourFallbackDays` (10) when fewer than `minNeighbours` (6). Scale asinh by max(raw MAD, floor); transformed MAD is bounded by `neighbourAsinhMadMin` (0.15). Candidate exceeds both `neighbourZ` (3.5) scaled-asinh z and `neighbourRawZ` (8) raw z. Bad if scaled-asinh z exceeds `neighbourBadZ` (10), or flux exceeds `neighbourBadRatio` (10) times neighbours' median absolute flux and `neighbourBadFloor` (5) floors; otherwise warn. |
| `few_points` | Below `minPoints` (20) or `minWindowS` (60): warn, info for an overridden window. |
| `valves_irregular` | Not `normalSwitches` (10), repeated/missing sides, or duration differs from `normalSegmentS` (20) by `irregularFraction` (0.5): warn. |
| `legacy_qc`, `temp_fallback`, `no_plot` | Legacy QC, missing temperature, or unassigned chamber: info. |

`attention` grows with effective impact and number of findings: bad 70?100,
warn 30–69, info 1–10. `legacy_qc` alone has attention 0. Reviewed fluxes keep
their scores. Target on Capture: bad at most about 6%, bad plus warn at most 15%.
The UI decides which reviewed or excluded fluxes to hide.

## 5. Project file

SQLite, `application_id` set, `user_version` = schema version. Suggested tables (the core
owner may refine, but keep these concepts):

| table | content |
|---|---|
| `meta` | key/value: project name, time zone, created, app version, `route` (the last applied route: `{points, sourcePath, savedAt}` JSON) |
| `config` | JSON document: defaults for analysis options, gases and units, chamber geometry, QC thresholds, plot-assignment mode, fallback temperature |
| `treatments` | id, name, short name, colour, sort order |
| `plots` | id, label, treatment_id, polygon (JSON, nullable), block/replicate |
| `waypoint_map` | waypoint number, side → plot_id |
| `measurements` | one per raw file: file name, start time (UTC epoch), vehicle x/y/z/heading, sides, waypoint name, status/error, raw blob (zstd) |
| `fluxes` | one per measurement × side, plus manual ones: measurement_id (null for manual), side, source (`robot`/`manual`), time, chamber x/y, plot_id, plot_override, excluded, reviewed, note |
| `flux_options` | flux_id → JSON override of analysis options (absent = project defaults) |
| `flux_results` | flux_id, gas → regression statistics, flux value, QC flag, options hash |
| `series`, `series_points` | external time series (weather, loggers, custom) |
| `changes` | append-only log of edits (time, author, kind, before, after) used for undo/redo |

### 5.2 Analysis options (per flux, falling back to project defaults)

```
{ "mode": "fixed" | "auto" | "manual",
  "start": 0, "stop": 180,              // seconds; bounds of the search in auto mode
  "interval": 100, "crit": "steepest",  // auto mode
  "co2Guides": true,                    // auto mode
  "cutBeginnings": 4, "cutEnds": 3,
  "valveOffset": 0,                     // seconds added to every valve switch time (4.9)
  "perGas": { "N2O": { "start": 20, "stop": 150 } }   // optional per-gas start, stop,
                                                      // cutBeginnings, cutEnds, valveOffset
}
```

`excluded` is a property of the flux, not an option. Legacy per-file options apply to both
sides of the file.

## 6. API between UI and core

Commands are async, camelCase JSON, and return `Result<T, ApiError>` where
`ApiError = { code: string, message: string }`. Times are **Unix milliseconds UTC**; the UI
formats them in the project time zone. Long operations emit progress events
`{ task: string, done: number, total: number, message?: string }` on the `progress` channel.

The UI-side interface is `app/src/api/types.ts` (`FfrApi`). The names below are the contract;
field lists may grow, but do not rename.

**Project**
- `projectCreate(path, name) → ProjectInfo`
- `projectOpen(path) → ProjectInfo`, `projectClose()`, `projectInfo() → ProjectInfo | null`
- `projectSaveCopy(path)` — consistent single-file backup while open
- `recentProjects() → {path, name, openedAt}[]`
- `legacyScan(dir) → LegacyScan` — what was found in a `Users/<Name>` folder (config.yml
  paths, counts, which inputs exist)
- `legacyImport(args: {legacyDir, rawDir, manualPath?, loggerPath?, metnoPicklePath?, outPath}) → ProjectInfo`
- `importRawFiles(paths: string[]) → ImportReport` — add new robot files to an open project

`ProjectInfo = { path, name, timeZone, schemaVersion, counts: {measurements, fluxes, excluded, overridden, reviewed, manual, series}, timeRange: [number, number] | null }`

**Configuration**
- `getConfig() → ProjectConfig`, `setConfig(cfg)` (recomputes what changed)
- `getLayout() → { treatments: Treatment[], plots: Plot[] }`, `setLayout(layout)`
- `ProjectConfig.crs` — coordinate system of positions and polygons, `EPSG:326zz`/`327zz`
  (WGS 84 / UTM); default `EPSG:32632`. Used only to draw the field on a map.
- `Plot = { id, label, treatmentId, block, polygon: [x, y][] | null, waypoints?: {waypoint, side}[] | null }`

**Waypoints (robot routes)**
- `waypointsRead(path) → Waypoint[]`, `waypointsWrite(path, points, sourcePath?)` — atomic;
  refuses to overwrite `sourcePath` (edits are always saved as a new file).
  `Waypoint = { x, y, z, angle, kind, side, name }`. Work without an open project.
- `waypointPlots(points, opts: PlotGenOptions) → PlotProposal` — the plots of §4.6 without
  saving: `{ angle, plots: { key, label, x, y, polygon, visits: { waypointIndex, name,
  waypoint, side, x, y }[] }[] }`; `PlotGenOptions = { clusterDistance, shape:
  'auto'|'square'|'rectangle', size, width, height, angle | null, labelPrefix }`.
- `applyWaypointLayout({ points, sourcePath, plots: { label, polygon, treatmentId | null,
  waypoints }[] }) → Layout` — replaces the plots (treatments kept; plots without a
  treatment go to an "Unassigned" treatment), stores the route, re-assigns every flux; one
  undo step.
- `getRoute() → StoredRoute | null`
- Map imagery is offline: `mapTilesGet() → { dir, levels } | null`, `mapTilesSet(dir | null)`
  (an app preference, not part of the project), `mapTile(z, x, y) → { data, factor, dx, dy } | null`
  from a local XYZ folder `{dir}/{z}/{x}/{y}.png|jpg` (Web Mercator); a coarser tile fills
  in, `data` is a data URL. No online tile service is contacted.

**Fluxes**
- `listFluxes() → FluxTable` — every flux, columnar:
  `{ columns: ColumnMeta[], rows: number, data: Record<string, (number|string|boolean|null)[]> }`
  with at least: `id, measurementId, source, time, filename, side, plotId, plotLabel,
  treatmentId, treatmentName, excluded, reviewed, overridden, note, airTemp, precip`,
  per gas `<gas>_slope, <gas>_rsq, <gas>_pval, <gas>_flux` and `N2O_qc`, plus one column per
  external series. `ColumnMeta = { key, label, unit?, type: 'number'|'string'|'boolean'|'time'|'category', group }`.
- `getFluxDetail(fluxId) → FluxDetail`:
  ```
  { flux: FluxRow, options: AnalysisOptions, isOverridden: boolean,
    siblingFluxId: number | null,            // the other chamber of the same file
    switches: { t: number, side: 'left'|'right' }[],
    traces: { gas: string, unit: string, t: number[], y: number[],
              side: (0|1|2)[],               // 0 = discarded (cut), 1 = left, 2 = right
              used: boolean[] }[],           // points in this flux's regression
    regressions: { gas, slope, intercept, start, stop, n, rsq, pval, mse, seSlope,
                   minY, maxY, flux, fluxUnit, qc }[],
    sibling: same `regressions` for the other chamber (for the overlay) }
  ```
- `previewFlux(fluxId, options) → FluxDetail` — compute without saving (live while dragging)
- `setFluxOptions(fluxIds, options | null) → FluxRow[]` — `null` resets to defaults
- `setFluxFlags(fluxIds, { excluded?, reviewed?, note?, plotOverride? }) → FluxRow[]`
  — `reviewed`/`note` change nothing else and are not recomputed
- Edit commands return the edited rows first, then every other row whose diagnostics the
  edit re-scored (baselines, neighbours), so the UI patches its table instead of reloading
  it. Setting values a flux already has is not an edit (no undo step).
- `patchFluxOptions(fluxIds, partial: Partial<AnalysisOptions>) → FluxRow[]` — merge the
  given fields into each flux's effective options (e.g. `{ valveOffset: 3 }` for a whole day);
  one undo step
- `recomputeAll()` — with progress
- `getFluxThumbs(fluxIds, gas, maxPoints = 60) → { fluxId, t: number[], y: number[], used: boolean[], slope, intercept }[]`
  — decimated points of that flux's chamber only, for a contact-sheet grid; must be fast for
  ~200 ids
- `diagnosticsSummary() → { code, label, description, severity, count, unreviewed }[]`

Diagnostics in the existing shapes: `FluxTable` gains columns `attention` (number), `diag`
(string: comma-separated codes, worst first), `valveLagS` (number), `<gas>_n`, and
`<gas>_resid` (residual SD of the fit), `<gas>_robustFlux`, `<gas>_impact`, `N2O_lagS`;
`FluxDetail` gains `diagnostics: Diagnostic[]`, `valveLagS`,
`robust: {gas, slope, intercept, start, stop, n, flux}[]`, and each trace gains `fit: (number|null)[]` = fitted value at each used point;
`ProjectConfig` gains `diagnostics` (thresholds) .
- `undo() → UndoResult`, `redo() → UndoResult`, `history(limit) → Change[]`

**Treatment summary**
- `treatmentSummary(q: { gas, from?, to?, sources: ('robot'|'manual')[], fluxIds?: number[] }) → TreatmentSummary`:
  ```
  { gas, unit, cumulativeUnit,
    treatments: { id, name, colour, nPlots, mean, sd, gmean, gsd, box: [min,q1,median,q3,max] }[],
    plots: { plotId, label, treatmentId, total,
             points: { fluxId, time, value }[],          // every individual flux
             daily: { time, mean, cumulative }[] }[] }
  ```

**External data**
- `listSeries() → SeriesMeta[]`, `getSeries(ids, from?, to?, maxPoints?) → SeriesData[]`
- `previewTable(path, opts) → TablePreview` — sheets, header candidates, first rows
- `importSeries(args)`, `deleteSeries(id)`
- `importManualFluxes(args) → ImportReport`
- `metnoGetClientId()`, `metnoSetClientId(id)`, `metnoFetch({station, from, to})`

**Export**
- `exportXlsx(args: { path, fluxIds, columns, mode: 'flat' | 'sheetPerPlot' | 'dailyPerPlot' })`
- `exportCsv(args: { path, fluxIds, columns })`

File and folder pickers are done in the UI with the Tauri dialog plugin; commands take paths.

## 7. UI

Design goals: calm, dense, keyboard-first scientific tool. Light and dark theme. No modal
pop-up chains (the legacy app's main problem): one window, a left navigation rail, and
panels. Colour identity for treatments is assigned once and used everywhere.

Screens:

1. **Start** — recent projects, Open, New, **Import legacy project** (wizard with scan
   result, paths, progress).
2. **Review** — the core screen.
   - Left: virtualised list of fluxes with search and quick filters (unreviewed, QC-flagged,
     overridden, excluded, by plot/treatment/date).
   - Centre: trace charts for N2O and CO2 (other gases selectable). All points, coloured by
     chamber; this flux's used points emphasised; regression line; shaded valve segments;
     **draggable start/stop handles** on the chart with live preview; the sibling chamber
     shown faintly.
   - Right: results (flux, slope, r², p, n, QC flag per gas), context (plot, treatment, air
     temperature, precipitation, position), options (mode, window, cuts), note.
   - Keyboard: ←/→ previous/next, `X` exclude, `R` reset to defaults, `A` mark reviewed and
     go next, `Ctrl+Z`/`Ctrl+Y` undo/redo, `G` go to (number or date).
3. **Treatments** — cumulative totals per treatment (bars with SD), box plot of daily
   means, cumulative curves per plot, time series of individual fluxes, weather strip
   (daily precipitation bars, temperature band) on a shared time axis; date-range brush; gas
   selector; robot/manual toggles. Clicking a treatment filters to its plots. **Clicking any
   flux point opens it in Review** (and Back returns here with state intact).
   - **Triage**: the queue can be ordered by `attention` and filtered by diagnostic code;
     every flux shows its findings as chips with the plain-language reason, and the chart
     shows the evidence (residual strip under the trace, the estimated valve lag as ghost
     switch lines with an "apply offset" button for this flux / this file / this day).
   - **Contact sheet**: a grid of small trace thumbnails (N2O or CO2) of the current queue
     for fast visual scanning; click opens the flux, `X` excludes, multi-select for bulk
     exclude / mark reviewed.
4. **Outliers** — linked scatter plots for hunting bad fluxes: N2O flux vs CO2 flux, r² vs
   flux, valve lag vs date, flux vs date per treatment with flagged points marked, counts per
   diagnostic code. Box-select points → open as a Review queue, bulk exclude, bulk mark
   reviewed.
5. **Data** — the full flux table: column chooser, per-column filters (numeric range,
   category set, date range, text), sorting, saved filter presets, row click opens Review,
   "show these in Treatments", export to Excel/CSV with the three modes.
6. **External data** — list of series with a preview chart; import wizard for
   Excel/CSV (pick sheet, header row, time column, value columns, aggregate); met.no fetch;
   manual flux import.
7. **Project** — name, time zone, default analysis options, gases/units, treatments and
   plots, backup copy. The **field map** draws plot polygons coloured by treatment with
   labels, every measured chamber position (positions outside every plot in red) and the
   stored route. The page opens **locked**: everything can be viewed and selected, nothing
   edited, until "Unlock to edit" (it can't be locked again with unsaved changes). Click
   selects a plot, Ctrl-click adds/removes, Shift-drag or the Box select tool selects by
   rectangle, clicking empty map, Esc or "None" clears; dragging moves plots. The side panel
   sets label, treatment and block, resizes plots around their centres (rectangle, square or
   touching squares; keeps each plot's direction unless one is given) and renumbers them
   (prefix, first number, rows / columns / current order, starting in any corner as seen on
   the north-up map, optionally snaking). Treatments can be added and, when no plot uses
   them, removed. Edits stay a draft until saved (one `setLayout`, one undo step). "Load waypoint list…" and "Edit route" open
   the Waypoints screen.
8. **Waypoints** — the route editor (port of `ffr_waypoint_analyzer`), usable with or
   without an open project: open a route CSV, edit on a map (move, rotate headings or a
   group, box-select, add/insert/delete waypoints, set fields, snap positions and chamber
   pairs, autorotate headings from the path), undo/redo, and save as a new CSV. The **Plots
   from route** panel previews §4.6 live (grouping distance, shape, size, direction, label
   prefix; each plot shows how many times it is measured) and either creates a new project
   from it or replaces the open project's layout.

## 8. Conventions

- Rust: edition 2021, `cargo fmt`, `cargo clippy -- -D warnings`, `thiserror` for the core's
  error type, no `unwrap` on fallible I/O paths, unit tests next to the code.
- TypeScript: strict, ESLint, no `any` in the API layer.
- Commit small milestones with clear messages. Commit only files you own. Never commit
  `metno_client_id.txt`, anything under `Users/*/output`, `*.pickle`, or `*.ffr`.
- Do not change the legacy program (branch `legacy-python`) or files outside your assignment.

## 9. Local data for verification (not in git)

The developer machine has the Capture project. Paths are passed by environment variable so
tests skip elsewhere:

| variable | meaning |
|---|---|
| `FFR_CAPTURE_RAW` | folder with ~3745 raw files |
| `FFR_CAPTURE_LEGACY` | `Users/Capture` (has `specific_options.pickle`, `output/capture_slopes.txt`, `output/df_all.pkl`) |
| `FFR_CAPTURE_MANUAL` | manual fluxes `.xls` |
| `FFR_CAPTURE_LOGGER` | logger `.xlsx` |
| `FFR_METNO_PICKLE` | `metno_data.pickle` |

`output/capture_slopes.txt` is the golden reference: one line per file × side, tab
separated: `filename, side, repr((specific_options, default_options)), then name/value
pairs` (`CO2` = slope, `CO2_rsq`, `CO2_pval`, `CO2_intercept`, `CO2_min`, `CO2_max`,
`CO2_first`, same for `N2O`, `CO`, `H2O`, `licor_H2O`, and `N2O_quality_check`). The options
actually used for each line are in its third column.
