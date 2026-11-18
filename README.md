# FFR Analyzer 2
All credit for methodology and the idea of this project should go to [Lars Molstad](https://github.com/larsmolstad) as he developed the original [ffr_analysis](https://github.com/larsmolstad/ffr_analysis) program i've based this on.

Desktop program for reviewing gas fluxes measured by the Field Flux Robot: check every
chamber measurement, find the ones that look wrong, compare treatments over time, bring in
manual measurements, weather and soil loggers, and export to Excel.

## Install

Download from [Releases](../../releases):

- `FFR.Analyzer_<version>_x64-setup.exe` — installs for your Windows user only (no
  administrator rights) and opens `.ffr` files on double-click.
- `FFR-Analyzer-portable-<version>.exe` — runs without installing.

Windows 10/11 is required (it uses the built-in WebView2). The program is not code-signed, so
Windows SmartScreen may say "Windows protected your PC": choose **More info → Run anyway**.

## Projects

A project is **one `.ffr` file** holding the raw robot traces, your window and exclude
decisions, treatments and plots, weather, loggers and manual fluxes. Copy the file to a
colleague and they can carry on; *Project → Save backup copy* makes a consistent copy while it
is open. Every edit is saved immediately and can be undone (Ctrl+Z / Ctrl+Y).

**Converting an old project:** *Start → Import legacy project*, pick the old `Users/<Name>`
folder. Paths from its `config.yml` (raw data, manual fluxes, loggers) are filled in; the
Capture, Truesoil and Greenmove layouts are built in. `specific_options.pickle` (your windows
and exclusions) is converted.

## Using it

- **Review** — step through fluxes with ←/→. Each flux shows its trace per gas, the points
  used for each chamber, valve switches, the fit, and a robust refit (dashed). `X` excludes,
  `A` marks reviewed and moves on, `R` resets to defaults, `S` jumps to the other chamber,
  `G` goes to a flux number or date. Drag the start/stop handles to change the window.
  The default queue is *Needs attention*: fluxes the program thinks look wrong, worst first.
  *Contact sheet* shows the queue as thumbnails for fast scanning and bulk actions.
- **Outliers** — linked scatter plots (N2O vs CO2, impact vs flux, CO2 vs the day's median,
  valve lag over time). Box-select points to review, exclude or mark them.
- **Treatments** — cumulative flux per treatment and plot, daily-mean distributions,
  individual fluxes and weather on one time axis. Click any point to open its trace.
- **Data** — the full table with typed filters, saved presets and Excel/CSV export.
- **External data** — import loggers or other series from Excel/CSV, fetch met.no weather
  (enter your Frost client ID once; it is stored for your user, never in the project), and
  import manual flux measurements.
- **Project** — time zone, default analysis options, diagnostic thresholds, treatments,
  plots and field map.

### How "needs attention" is decided

Every flux is checked for: chamber not sealed (flat CO2 while its neighbour chamber or the
rest of the day rises), negative N2O, valve timing mismatch (the signal changes chamber a few
seconds before or after the logged valve switch), transients at segment edges, spikes, noise,
curvature, very few points, and values far from comparable fluxes. A robust refit (estimated
valve lag applied, segment edges trimmed, outlier points dropped) shows how much each finding
changes the flux; findings that do not change the result stay informational. Nothing is ever
excluded automatically. Thresholds are under *Project → Diagnostic thresholds*.

A timing mismatch is fixed with the **valve offset** (Review → Valve alignment), for one
flux, one file or a whole day.

## Development

```
crates/ffr-core   Rust domain library: parsing, chamber separation, regression, flux,
                  diagnostics, project file (SQLite), legacy import, summary, export
crates/ffr-cli    developer CLI (import, parity check, diagnostics report, export)
app/              Tauri 2 desktop shell + React/TypeScript UI (runs on a mock API in a browser)
tools/            Python helpers for checking against the legacy program
docs/SPEC.md      the specification
```

Requirements: Rust (version pinned in `rust-toolchain.toml`, installed automatically by
rustup) and Node 20.

```
cargo test                          # core tests
cd app && npm ci && npm run dev     # UI in the browser on synthetic data
cd app && npm run tauri dev         # desktop app
cd app && npm run tauri build       # installer + exe in app/src-tauri/target/release
```

Checks on real data are opt-in through environment variables (`FFR_CAPTURE_RAW`,
`FFR_CAPTURE_LEGACY`, `FFR_CAPTURE_MANUAL`, `FFR_CAPTURE_LOGGER`, `FFR_METNO_PICKLE`; see
`docs/SPEC.md` §9). For example `ffr-cli parity <raw folder> <capture_slopes.txt>`.

**Releases:** push a tag like `v2.0.0` and GitHub Actions builds the installer and portable
exe into a draft release (`-alpha`/`-rc` tags become pre-releases). No real measurement data
belongs in this repository.
