# FFR Analyzer desktop

Run `npm ci`, `npm run dev`, then open http://127.0.0.1:1420.
The browser uses the synthetic API automatically. `npm run dev -- --mode mock`
and `VITE_FFR_MOCK=1` explicitly select it, including in Tauri.
The desktop normally selects the invoke adapter. Domain command handlers are intentionally
not registered in this shell; they will be supplied by the core integration.

- `npm run build`: strict TypeScript + production bundle.
- `npm run lint`, `npm test`: lint and scientific mock tests.
- `npm run smoke`: starts Vite in mock mode and walks all six screens; captures light/dark PNGs in `screenshots/`.
- `cargo check` inside `src-tauri/`.
- `npm run tauri build -- --debug`: builds the executable and per-user NSIS installer.
- `node scripts/check-shell.mjs`: opens the built executable and checks the actual WebView2 Start screen over CDP, then closes it.

The Cargo lockfile and resolver fallback keep this shell compatible with Rust 1.85.
The JS API/dialog package minor versions match the compatible Rust packages.
The SVG icon source is `src-tauri/icons/source.svg`; regenerate with `npm run tauri icon src-tauri/icons/source.svg`.

## API handoff

Command names and argument names from SPEC §6 are retained. Invoke receives one object
containing camelCase arguments; struct parameters remain nested (`{args}`, `{q}`,
`{cfg}`, `{opts}`, `{flags}`, `{options}`, `{layout}` as appropriate).

Types made concrete where the spec did not define fields:

- `ProjectConfig`: name, timeZone, defaults, gases, fallbackTemperature, chamberHeight,
  pressure, qcThreshold, plotAssignment.
- `Treatment`: id, name, shortName, colour, sortOrder. `Plot`: id, label, treatmentId,
  block, polygon. `Layout` groups these arrays.
- `LegacyScan`: configPaths, rawFiles, manualExists, loggerExists, weatherExists, warnings.
- `ImportReport`: imported, skipped, errors ({path,message}).
- `SeriesMeta`: id, name, unit, source, count, timeRange.
  `SeriesData`: id, points ({time,value}).
- `TableOptions`: optional sheet, headerRow, skipRows.
  `TablePreview`: sheets, headerCandidates, columns, rows.
- `ImportSeriesArgs`: path, optional sheet, headerRow, timeColumn, valueColumns,
  aggregate (mean/sum/none), optional maxGap.
- `ImportManualArgs`: path, optional sheet, headerRow, dateColumn, plotColumn,
  gasColumns, optional offsetHours.
- `UndoResult`: changed, canUndo, canRedo.
  `Change`: id, time, kind, fluxIds, before, after (strings).

Additions beyond explicit spec fields:

- `AnalysisOptions.slope?: number` for manual mode (required by domain §4.4).
- Regression `seIntercept` and `firstY` (required by domain §4.4).
- Flux-row `x`, `y`, plus synthetic logger columns `soilMoisture` and `soilTemperature`.
- Geometric statistics are nullable when no positive observations exist.
- `onProgress(callback): Promise<unsubscribe>` provides the typed event subscription.
- Typed Gas, Source, Cell, FluxFlags, SummaryQuery and ExportArgs aliases/interfaces.

No existing command was renamed or removed.

## Mock boundaries

Seed 42 generates 7,488 robot fluxes (3,744 paired files) and 150 manual fluxes.
Traces are generated on demand with noise, multiplexing, cuts, transients, negative,
flat, spike and leak cases. Regression, Pearson p, standard errors, physical conversion,
daily means, trapezoid integration, population SD, geometric statistics, options and
flags, preview, selection export and undo/redo are real browser calculations.
Edits are kept in memory and sessionStorage; filter presets and theme use localStorage.
Screens remain mounted so table filters/sorting/selection and scroll survive Review/Back.

Browser imports are simulated synthetic fixtures, not parsers for real Excel, legacy pickle,
or robot files. Frost requests and project backups are simulated progress operations.
The mock exportXlsx downloads CSV with the selected grouping; daily mode currently exports N2O.
Manual-import mapping currently uses the legacy plot/N2O/CO2 mapping and 12-hour offset.
The field map shows synthetic plot positions, not a geospatial polygon editor.
Native persistence, real imports, Frost networking and XLSX belong to the Rust integration.
