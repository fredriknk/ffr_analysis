# FFR Analyzer 2

Read `docs/SPEC.md` before doing anything. It is the contract.

- `crates/ffr-core` — domain logic. `crates/ffr-cli` — dev CLI. `app/` — Tauri + React desktop app.
  `tools/` — Python helpers for verification against the legacy program.
- The legacy Python program (`prog/`, `Users/`) lives on the `legacy-python` branch. Read it
  there (`git show legacy-python:prog/regression.py`); never change it on `master`.
- Local folders `Users/`, `example_data/` and `local/` may exist on disk with real data; they
  are git-ignored. Never commit real measurement data, `*.pickle`, `*.ffr`,
  `metno_client_id.txt`, or legacy `output/` folders.
- Checks before committing: `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test`, and in `app/`: `npm run lint`, `npm run build`, `npm test`.
- Commit only the paths you were assigned.
