# FFR Analyzer 2

Read `docs/SPEC.md` before doing anything. It is the contract for the rewrite.

- `prog/`, `Users/`, `example_data/` are the legacy Python program: reference only, do not edit.
- `crates/ffr-core` — domain logic. `crates/ffr-cli` — dev CLI. `app/` — Tauri + React desktop app.
- Never commit real measurement data, `*.pickle`, `*.ffr`, `metno_client_id.txt`, or anything under `Users/*/output`.
- Commit only the paths you were assigned.
