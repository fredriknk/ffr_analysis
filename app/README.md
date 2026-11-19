# FFR Analyzer GUI development

FFR Analyzer 2 is a Windows desktop app for reviewing Field Flux Robot measurements,
comparing treatments, integrating external data and exporting results. The UI uses
React, TypeScript and Vite. Tauri 2 hosts it in WebView2 and calls the Rust domain library.

[End-user manual](../docs/manual/README.md) · [Developer CLI](../docs/CLI.md) · [Specification](../docs/SPEC.md)

## Source layout

| Path under `src/` | Responsibility |
| --- | --- |
| `api/` | The `FfrApi` interface and types, the Tauri invoke adapter and the synthetic browser implementation. |
| `screens/` | Start, Review, Treatments, Outliers, Data, External data, Project and Waypoints. |
| `shared/` | Reusable charts, tables, filters, maps, dialogs, formatting and query hooks. |
| `store.ts` | Zustand state for navigation, review queues, filters, theme and other shared UI state. |
| `waypoints/` | Route editor state and helpers for geometry, projection, naming and labels. |

`App.tsx` handles the window-level UI and navigation. Visited screens stay mounted
within the current project, preserving local state when navigating to Review and back.
`src-tauri/` is a separate Cargo workspace with a path dependency on `ffr-core`.

## Run in the browser

Use Node 20, as in CI. From `app/`, install dependencies and start Vite.

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:1420` and open the demo project. `src/api/index.ts` checks
for `window.__TAURI_INTERNALS__`. A plain browser uses `createMock()` automatically.
Tauri uses `tauriApi` unless `VITE_FFR_MOCK=1` was set for Vite. To run Vite with
that setting from `.env.mock`, use the mock mode.

```powershell
npm run dev -- --mode mock
```

## Run and package the desktop app

On Windows, use the MSVC C++ build tools with a Windows SDK, WebView2 and rustup.
`src-tauri/rust-toolchain.toml` pins the same compiler as the root toolchain file.
From `app/` after `npm ci`, run the following. Tauri starts Vite on port 1420,
so stop a separately running Vite server before starting desktop development.

```powershell
npm run tauri dev
```

To force the synthetic API in the desktop development build, set the Vite environment
variable in the PowerShell session. Clear it before building with the native backend.

```powershell
$env:VITE_FFR_MOCK = '1'
npm run tauri dev
Remove-Item Env:VITE_FFR_MOCK
```

Build release or debug artifacts from `app/`.

```powershell
npm run tauri build
npm run tauri build -- --debug
```

The release output is under `src-tauri/target/release/`. The standalone
`ffr-analyzer.exe` is the portable build. The per-user NSIS installer is under
`bundle/nsis/` and registers the `.ffr` file association. Debug builds use
`src-tauri/target/debug/`. The release workflow builds both artifacts and attaches
them to a draft release for `v*` tags.

To regenerate the icons from `src-tauri/icons/source.svg`, run the following.

```powershell
npm run tauri icon src-tauri/icons/source.svg
```

## npm scripts

Run these from `app/`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts the Vite dev server at `127.0.0.1:1420`. |
| `npm run build` | Runs `tsc -b` and creates the production Vite bundle in `dist/`. |
| `npm run lint` | Runs ESLint. |
| `npm test` | Runs the Vitest suite once. |
| `npm run smoke` | Runs Playwright against the mock. The config starts Vite in mock mode or reuses the server at port 1420. Smoke tests exercise browser workflows and capture screenshots in `screenshots/`. |
| `npm run tauri` | Runs the Tauri CLI. Append a subcommand such as `dev`, `build` or `icon`. |
| `npm run real-smoke` | Runs `scripts/real-smoke.mjs` against the release executable. |
| `npm run docs:screenshots` | Runs Playwright with `playwright.docs.config.ts` against the mock and writes `docs/images/*.png`. |

Install Playwright's Chromium browser before running the browser smoke or docs
screenshot suite.

```powershell
npx playwright install chromium
npm run smoke
```

### Node helpers

Run these from `app/`. Keep real-data smoke reports and screenshots in the
ignored output directories.

| Command | Purpose |
| --- | --- |
| `node scripts/check-shell.mjs` | Launches the debug executable, checks the Start screen in WebView2 over CDP, then closes it. |
| `node scripts/organize-imports.mjs` | Organizes imports in place for the files selected by `tsconfig.json` using the TypeScript language service. |
| `node scripts/real-smoke.mjs` | Runs native review, exports and legacy import over WebView2 CDP. Set `FFR_REAL_PROJECT` and both `FFR_CAPTURE_LEGACY` and `FFR_CAPTURE_RAW` for a complete run. Requires the release executable and `python` with `openpyxl` for export checks. Copies the input project before editing and writes to a timestamped `local/real-smoke-*` directory at the repo root. |
| `node scripts/startup-smoke.mjs` | Checks opening a copied project by command-line path and reports an error for a deliberately invalid project. Set `FFR_REAL_PROJECT` and build the release executable first. Writes to `local/startup-smoke/` at the repo root. |

Both real-data scripts skip when `FFR_REAL_PROJECT` is unset.

## API handoff

UI code calls the async, camelCase `FfrApi` in `src/api/types.ts`. The Tauri adapter
invokes snake_case Rust handlers with one object of camelCase arguments. Match
the wrapper to the Rust signature. For example, `getFluxDetail(fluxId)` invokes
`get_flux_detail` with `{ fluxId }`, `treatmentSummary(q)` sends `{ q }`, and
`exportXlsx(args)` sends `{ args }`. Other wrappers include `{ cfg }`, `{ layout }`,
`{ path, opts }`, `{ fluxIds, flags }` and `{ fluxId, options }`.

Use `ApiError` (`{ code, message }`) for failures. API timestamps use Unix milliseconds
UTC. Format them for display in the project time zone. Long operations emit `Progress`
on the `progress` channel. `onProgress(callback)` resolves to an unsubscribe function.
Use the dialog plugin via the UI pickers when a native file or folder selection is needed.

Use `types.ts` for the current payload shapes. Details beyond the command list in the
spec include the following.

- `ProjectConfig` includes `crs` and diagnostic thresholds. `Layout` groups
  treatments and plots, with optional waypoint references on each plot.
- Analysis options carry a manual `slope` and optional `fit` and `perGas` fields.
  Regressions include `seIntercept` and `firstY`. Flux rows can have chamber
  coordinates and dynamic external-series columns. `diagSeverity` carries per-code
  levels, and geometric statistics can be null when there are no positive observations.
- `LegacyScan` reports configured paths, candidate counts, input availability and
  warnings. The Start screen can use `configPaths` when dedicated path fields are
  absent. `ImportReport` includes `imported`, `skipped`, optional `retried` and
  per-path errors. The desktop `importSeries` wrapper returns void.
- External data uses `SeriesMeta` and `SeriesData`, sheet and header choices for
  table preview, and column mappings for imports. The native preview uses
  `sheet` and `headerRow`. The native series importer takes the mean of corresponding
  values within each row when grouping logger columns.
- `UndoResult` reports `changed`, `canUndo` and `canRedo`. The Tauri adapter maps
  history to metadata (`id`, `time`, `kind`, `fluxIds`) for the UI.

### Add an API command

1. Add the method and its request and response types to `src/api/types.ts`.
   Update the command contract in `docs/SPEC.md` as needed.
2. Implement the browser behavior in `src/api/mock.ts` with synthetic fixtures
   and the same types.
3. Add a typed call to `src/api/tauri.ts`. Match the invoke name and argument
   object to the Rust handler.
4. Add an async `#[tauri::command]` in `src-tauri/src/commands.rs` and register it
   in `handlers()`. Follow the existing `run` or `run_task` pattern for access to
   the core session on a blocking worker. Emit progress for long operations.
5. Put domain logic in `ffr-core` and use its serializable types at the boundary.
   Call the new method through `api` in the UI and check both implementations.

## Mock boundaries

Seed 42 generates 7,488 robot fluxes (3,744 paired files) and 150 manual fluxes.
On-demand traces exercise multiplexing, cuts, noise, transients, spikes, leaks and
negative or flat signals. The browser calculates fits, statistics, physical flux
conversion, diagnostic examples and treatment summaries. It supports previews,
options, flags and undo/redo in memory. Browser session storage retains options,
selected flags, configuration and layout across reloads. Filter presets and the
light/dark theme use local storage.

The mock uses fixtures for import and table preview. Manual import adds synthetic
rows. Backups and Frost fetches report simulated progress. Waypoints and map
editing use a synthetic route and field geometry, and route writes download CSV.
Local imagery tiles, parsing real project and measurement files, and persistent
project operations use the native backend.

Mock `exportXlsx` downloads CSV. `flat` uses the selected rows and columns,
`sheetPerPlot` sorts one CSV by plot, and `dailyPerPlot` exports the N2O daily means
and cumulative values. Real XLSX workbooks are produced by the native backend.

## UI conventions

- Keep TypeScript strict, with no `any` in the API layer.
- Use tree-shaken ECharts imports and register only the needed components in
  `shared/charts/Chart.tsx`.
- Use the shared theme tokens in `style.css` and respect the light/dark state
  from `store.ts` in charts and controls.
- Keep workflows keyboard-first. Preserve focus and keyboard access to
  navigation and actions, especially in Review.

## Checks before committing

From the repository root, run the Rust checks.

```powershell
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

From `app/`, run the UI checks.

```powershell
npm run lint
npm run build
npm test
```
