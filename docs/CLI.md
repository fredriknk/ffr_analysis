# FFR developer CLI

`ffr-cli` calls the Rust domain library directly. Run these PowerShell commands from
the repository root with the pinned Rust toolchain.

```powershell
cargo run -p ffr-cli -- info trial.ffr
cargo build -p ffr-cli
.\target\debug\ffr-cli.exe info trial.ffr
cargo build -p ffr-cli --release
.\target\release\ffr-cli.exe info trial.ffr
```

Each successful invocation writes one pretty-printed JSON value to stdout, including
`null` for commands without a return value. CLI errors write one JSON line of the form
`{"code":"cli","message":"missing argument"}` to stderr and exit with code 1.
`import-legacy` also writes plain-text progress lines (`task done/total`) to stderr
for progress events where `done` is a multiple of 500. When capturing JSON, keep
stdout and stderr separate. The subcommands below take positional arguments.

## `import-legacy`

```text
ffr-cli import-legacy <legacy-dir> <raw-dir> <out.ffr>
```

Converts the legacy project folder and the robot files in the supplied raw folder into
a new project and returns its `ProjectInfo`. The output path must be new. The core
uses the legacy folder name to select a built-in preset where available.

| Optional environment variable | Input |
| --- | --- |
| `FFR_CAPTURE_MANUAL` | Manual flux workbook, overriding the legacy config path. |
| `FFR_CAPTURE_LOGGER` | Logger workbook, overriding the legacy config path. |
| `FFR_METNO_PICKLE` | Legacy met.no weather pickle. |

With the manual and logger variables unset, the import uses paths found in the legacy
configuration when available. The CLI takes the raw and legacy folders from the
command line.

```powershell
$env:FFR_CAPTURE_MANUAL = 'C:\data\manual.xls'
$env:FFR_CAPTURE_LOGGER = 'C:\data\logger.xlsx'
$env:FFR_METNO_PICKLE = 'C:\data\weather.pickle'
cargo run -p ffr-cli -- import-legacy 'C:\data\legacy-project' 'C:\data\robot' trial.ffr
```

## `info`

```text
ffr-cli info <project.ffr>
```

Opens the project and returns `ProjectInfo`, including schema version, time zone,
counts and time range. Opening an older project can upgrade its schema in place
and create a sibling format backup.

```powershell
cargo run -p ffr-cli -- info trial.ffr
```

## `recompute`

```text
ffr-cli recompute <project.ffr>
```

Recomputes results and diagnostics in the supplied project using its saved settings
and overrides. Returns the updated `ProjectInfo`.

```powershell
cargo run -p ffr-cli -- recompute trial.ffr
```

## `summary`

```text
ffr-cli summary <project.ffr> [gas]
```

Returns the treatment and plot summary for one gas. Gas keys are `N2O` (default),
`CO2`, `CO`, `H2O` and `licor_H2O`. The command queries both robot and manual
sources across the full project time range. Configure the project's plots and
treatments before summarizing manual fluxes that reference them. Use `dump-json
treatmentSummary` for date, source or flux ID selection.

```powershell
cargo run -p ffr-cli -- summary trial.ffr CO2
```

## `export`

```text
ffr-cli export <project.ffr> <output-path> [mode]
```

Exports all flux IDs and columns from the project's flux table. A path ending in
`.csv` (case-insensitive) produces flat CSV and ignores `mode`. Any other suffix
selects the XLSX writer. Use `.xlsx` for an Excel workbook.

| XLSX mode | Workbook layout |
| --- | --- |
| `flat` (default) | One sheet named `All Data`, with one row per flux. |
| `sheetPerPlot` | One sheet per plot, with one row per flux. |
| `dailyPerPlot` | One sheet per plot, with one row per day with an included flux in the project time zone. Numeric values are averaged. The sheet includes `timediffHours`, `N2O_cumulative` and `CO2_cumulative`. |

Daily aggregation skips excluded fluxes and applies each `<gas>_excluded` flag to
the corresponding gas columns. Each cumulative total bridges gaps between days
with a mean for that gas, as in Treatments. Flat CSV, flat XLSX and `sheetPerPlot`
keep all exported rows and their exclusion flags.

Use `dump-json exportXlsx` or `exportCsv` to select flux IDs and column keys.

```powershell
cargo run -p ffr-cli -- export trial.ffr trial.xlsx dailyPerPlot
cargo run -p ffr-cli -- export trial.ffr trial.csv
```

## `diagnostics`

```text
ffr-cli diagnostics <project.ffr>
```

Reports diagnostics for robot fluxes in the project, including counts by finding and
severity, attention rankings, noise floors and high-impact rows.

```powershell
cargo run -p ffr-cli -- diagnostics trial.ffr
```

## `parity`

```text
ffr-cli parity <raw-dir> <slopes-reference> [<frame.csv> <weather-pickle>]
```

Compares regression results against the legacy slopes text or the equivalent
`golden.jsonl` from `tools/verification.py`. The reference supplies the options
used for each file and side. Compare `matchedLines` with `lines` and inspect
`mismatches` to check parity. A successfully generated report can contain mismatches.

Supply both optional arguments to also compare temperature, plot and treatment
assignment, and N2O and CO2 fluxes against the Capture reference. This mode needs
the original tab-separated slopes text, the legacy dataframe exported to CSV
(`df_all.csv` from `tools/verification.py`), and the legacy met.no weather pickle.
The JSON then has `regressions` and `endToEnd` members. Providing just the CSV
still returns the regression-only report.

```powershell
cargo run -p ffr-cli -- parity 'C:\data\robot' 'C:\data\reference\capture_slopes.txt'
cargo run -p ffr-cli -- parity 'C:\data\robot' 'C:\data\reference\capture_slopes.txt' 'C:\data\reference\df_all.csv' 'C:\data\weather.pickle'
```

## `waypoint-plots`

```text
ffr-cli waypoint-plots <route.csv> [grouping-distance-m]
```

Reads a robot waypoint CSV and returns a plot proposal with field angle, polygons
and chamber visits. The grouping distance defaults to 1.5 m, matching the app.
The proposal uses automatic footprints and leaves the input CSV intact.
See [route format and plot generation](SPEC.md#46-chamber-position-and-plot).

```powershell
cargo run -p ffr-cli -- waypoint-plots 'C:\data\routes\trial.csv' 1.5
```

## `dump-json`

```text
ffr-cli dump-json <command> [<json-object> | @<request-file>]
```

Runs one camelCase command per invocation. Put `projectPath` at the top level to
open an existing project before dispatch. Each invocation starts a fresh session,
so supply `projectPath` on every call that needs the project. For `projectOpen`
and `projectCreate`, pass the command's own `path` argument.

Pass the JSON object as one inline argument or prefix a UTF-8 JSON filename with
`@`. Omit the payload to send `{}`. Command fields can sit alongside `projectPath`
or inside a top-level `args` object. When `args` is present, the dispatcher takes
all command arguments from that object. PowerShell's native argument quoting varies
by version and can strip the double quotes in inline JSON. Prefer a UTF-8 file
without a byte-order mark and quote the whole `'@request.json'` argument.
Escape a backslash in JSON paths as `\\`, or use forward slashes.

### Commands and JSON arguments

`?` marks optional fields. IDs are integers and dates used as query bounds are
Unix milliseconds UTC. For the shared data shapes, see [SPEC §6](SPEC.md#6-api-between-ui-and-core)
and [the Rust API types](../crates/ffr-core/src/api.rs).

| Command | JSON fields |
| --- | --- |
| `projectCreate` | `path`, `name` |
| `projectOpen` | `path` |
| `projectClose` | None |
| `projectInfo` | None |
| `projectSaveCopy` | `path` (destination) |
| `recentProjects` | None. Uses the current CLI session's recent list. |
| `legacyScan` | `dir` |
| `legacyImport` | `legacyDir`, `outPath`, `rawDir?` (falls back to the scanned path), `manualPath?`, `loggerPath?`, `metnoPicklePath?`, `preset?`. Input overrides here come from JSON. |
| `importRawFiles` | `paths` (array of filenames with paths) |
| `getConfig` | None |
| `setConfig` | `cfg` (a `ProjectConfig`). `config` is accepted as an alias. |
| `waypointsRead` | `path` (route CSV) |
| `waypointPlots` | `points` (waypoints), `opts` (`clusterDistance`, `shape`, `size`, `width`, `height`, `angle?`, `labelPrefix`) |
| `applyWaypointLayout` | `points`, `sourcePath?`, `plots` (each with `label`, `polygon`, `treatmentId?`, `block?`, `waypoints`) |
| `getRoute` | None |
| `rawFolderGet` | None |
| `rawFolderSet` | `folder` (`path`, `fieldOnly?`, `auto?`, `lastScan?`, `lastReport?`) or `null` to clear. `fieldOnly` and `auto` default to `true`. |
| `rawFolderScan` | None |
| `getLayout` | None |
| `setLayout` | `layout` (with `treatments` and `plots` arrays) |
| `listFluxes` | None |
| `getFluxDetail` | `fluxId` |
| `previewFlux` | `fluxId`, `options` (`AnalysisOptions`) |
| `setFluxOptions` | `fluxIds` (array), `options` (`AnalysisOptions` or `null` to reset) |
| `setFluxFlags` | `fluxIds` (array), `flags` (any of `excluded`, `reviewed`, `note`, `plotOverride`, `gasExcluded`). `gasExcluded` maps gas names to booleans or `null`. |
| `patchFluxOptions` | `fluxIds` (array), `partial` (object with analysis options to merge) |
| `getFluxThumbs` | `fluxIds` (array), `gas`, `maxPoints?` (default 60) |
| `diagnosticsSummary` | None |
| `recomputeAll` | None |
| `undo` | None |
| `redo` | None |
| `history` | `limit?` (default 100) |
| `treatmentSummary` | `gas`, `sources` (array of `robot` and/or `manual`), `from?`, `to?`, `fluxIds?` (array). Put these fields directly in the payload or `args`. |
| `listSeries` | None |
| `getSeries` | `ids` (array of series IDs), `from?`, `to?`, `maxPoints?` |
| `previewTable` | `path`, `opts?` (object with `sheet?` and `headerRow?`) |
| `importSeries` | `path`, `sheet?`, `headerRow?`, `timeColumn?` (defaults to first column), `valueColumns?` (array), `unit?`, `maxGap?` (ms, default 3600000), `preset?` (`logger` selects legacy column groups). |
| `deleteSeries` | `id` (series ID) |
| `importManualFluxes` | `path`, `sheet?`, `headerRow?`, `dateColumn?` (default `date`), `plotColumn?` (default `nr`), `gasColumns?` (object mapping `N2O` and `CO2` to columns, with legacy defaults), `offsetHours?` (default 12). |
| `metnoGetClientId` | None. The CLI keeps the client ID in memory for the invocation. |
| `metnoSetClientId` | `id` (client ID string, set for the current session only) |
| `metnoFetch` | `station?` (default `SN17850`), `from`, `to`. Requires a client ID in the current session. A separate `dump-json metnoSetClientId` call cannot supply it. |
| `exportXlsx` | `path`, `fluxIds` (array), `columns` (array of column keys), `mode?` (`flat`, `sheetPerPlot` or `dailyPerPlot`, default `flat`) |
| `exportCsv` | `path`, `fluxIds` (array), `columns` (array of column keys) |

For table imports, `headerRow` is zero-based and defaults to 0. Specify columns by
header name or zero-based index. The native GUI adapter uses its own invocation
envelopes, such as `{ q }` for the treatment query.

### Examples

Save each JSON body to the corresponding request file. The example IDs stand for
values from `listFluxes`. `setFluxFlags` saves an edit to the supplied project.

**List fluxes** (`list.json`)

```json
{"projectPath":"trial.ffr"}
```

**Inspect one flux** (`detail.json`)

```json
{"projectPath":"trial.ffr","fluxId":12}
```

**Mark two fluxes reviewed** (`flags.json`)

```json
{"projectPath":"trial.ffr","args":{"fluxIds":[12,13],"flags":{"reviewed":true}}}
```

**Summarize selected robot fluxes** (`summary.json`)

```json
{"projectPath":"trial.ffr","gas":"N2O","sources":["robot"],"fluxIds":[12,13]}
```

**Export selected rows and columns** (`export.json`)

```json
{
  "projectPath": "trial.ffr",
  "args": {
    "path": "trial-selection.xlsx",
    "fluxIds": [12, 13],
    "columns": ["id", "time", "plotId", "N2O_flux", "CO2_flux"],
    "mode": "sheetPerPlot"
  }
}
```

```powershell
cargo run -p ffr-cli -- dump-json listFluxes '@list.json'
cargo run -p ffr-cli -- dump-json getFluxDetail '@detail.json'
cargo run -p ffr-cli -- dump-json setFluxFlags '@flags.json'
cargo run -p ffr-cli -- dump-json treatmentSummary '@summary.json'
cargo run -p ffr-cli -- dump-json exportXlsx '@export.json'
```

## Python verification helpers

Run these from the repository root. Use private inputs and keep reports containing
measurement data in an ignored output directory or outside the checkout. The
pandas-based helpers require pandas and their input format's Excel engine where
applicable. `verify_summary.py` also uses SciPy, and `contact_sheet.py` uses Matplotlib.

| Helper | Purpose and invocation |
| --- | --- |
| `audit_legacy.py` | Audits robot filenames, Capture filters and manual rows against the legacy reference. `python tools/audit_legacy.py <raw-dir> <legacy-dir> <manual-workbook>` |
| `compare_project.py` | Compares robot rows in SQLite and legacy pandas output, and checks a treatment against a JSON input with a top-level `summary`. `python tools/compare_project.py <project.ffr> <legacy-dir> <summary-report.json>` |
| `contact_sheet.py` | Plots synthetic or local-project N2O and CO2 traces via the CLI, grouped by diagnostics or chosen IDs. `python tools/contact_sheet.py trial.ffr --out <out-dir>` (uses the release CLI by default). |
| `diagnostics_report.py` | Prints timing and diagnostic counts from a benchmark report with `timingsSeconds` and `diagnostics`, plus day-level lag clustering from the project. `python tools/diagnostics_report.py <benchmark.json> <project.ffr>` |
| `diagnostics_tables.py` | Turns `ffr-cli diagnostics` output into CSV review tables. `python tools/diagnostics_tables.py <diagnostics.json> <out-dir>` |
| `extract_presets.py` | Extracts literal layout constants from a legacy source checkout and writes `crates/ffr-core/src/presets.json` under the supplied root. `python tools/extract_presets.py <extraction-root>` (requires the legacy source tree and destination parent under that root). |
| `verification.py` | Converts legacy slopes and pandas output to `golden.jsonl` and `df_all.csv` for parity. `python tools/verification.py <legacy-dir> <out-dir>` |
| `verify_summary.py` | Checks a treatment summary against pandas and SciPy on rows common to both projects. `python tools/verify_summary.py <project.ffr> <legacy-dir> <ffr-cli.exe> <out-dir>` |

## Opt-in real-data verification

Set `FFR_CAPTURE_RAW` to the raw folder and `FFR_CAPTURE_LEGACY` to the legacy
project folder to enable `capture_regression_parity`. The test returns early if
either is unset. It runs `tools/verification.py` with `python` by default or the
interpreter named by `FFR_PYTHON`. Set `FFR_METNO_PICKLE` to also enable its
end-to-end assertions. `FFR_CAPTURE_MANUAL` and `FFR_CAPTURE_LOGGER` are optional
import inputs used by the CLI and the `capture_bench` example.
See [SPEC §9](SPEC.md#9-local-data-for-verification-not-in-git).

```powershell
$env:FFR_CAPTURE_RAW = 'C:\data\robot'
$env:FFR_CAPTURE_LEGACY = 'C:\data\legacy-project'
cargo test -p ffr-core --test capture
```
