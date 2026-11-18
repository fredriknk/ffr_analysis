//! A watched folder of robot raw files: new files whose chambers fall inside
//! the project's plots are imported, the rest are left alone.
use super::*;

/// Robot files below `dir` (a few levels deep), as (file name without `.gz`, path).
fn robot_files(dir: &Path, depth: usize, out: &mut Vec<(String, String)>) -> Result<()> {
    for entry in std::fs::read_dir(dir).map_err(|e| Error::at(dir, e))? {
        let entry = entry.map_err(|e| Error::at(dir, e))?;
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                robot_files(&path, depth - 1, out)?;
            }
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(|c: char| c.is_ascii_digit()) {
            out.push((
                name.trim_end_matches(".gz").to_string(),
                path.to_string_lossy().into_owned(),
            ));
        }
    }
    Ok(())
}

impl Session {
    pub fn raw_folder_get(&self) -> Result<Option<RawFolder>> {
        let text: Option<String> = self
            .db()?
            .query_row("SELECT value FROM meta WHERE key='raw_folder'", [], |r| {
                r.get(0)
            })
            .optional()?;
        Ok(text.map(|t| serde_json::from_str(&t)).transpose()?)
    }

    /// Sets (or with `None` forgets) the folder. Not an undoable edit: it
    /// changes no measurement.
    pub fn raw_folder_set(&self, folder: Option<RawFolder>) -> Result<()> {
        match folder {
            Some(mut f) => {
                f.path = f.path.trim().to_string();
                if f.path.is_empty() {
                    return Err(Error::Invalid("choose a folder".into()));
                }
                // Keep the last result unless the folder itself changed.
                if let Some(old) = self.raw_folder_get()? {
                    if old.path == f.path && f.last_scan.is_none() {
                        f.last_scan = old.last_scan;
                        f.last_report = old.last_report;
                    }
                }
                self.db()?.execute(
                    "INSERT INTO meta(key,value) VALUES('raw_folder',?1) \
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    [serde_json::to_string(&f)?],
                )?;
            }
            None => {
                self.db()?
                    .execute("DELETE FROM meta WHERE key='raw_folder'", [])?;
            }
        }
        Ok(())
    }

    /// Imports the folder's new robot files (inside the field when
    /// `fieldOnly`). Files outside the field are not imported, and are looked
    /// at again next time, so drawing more plots later picks them up.
    pub fn raw_folder_scan(&self, progress: impl Fn(Progress)) -> Result<FolderReport> {
        let mut folder = self
            .raw_folder_get()?
            .ok_or_else(|| Error::Invalid("no raw-data folder set".into()))?;
        let dir = Path::new(&folder.path);
        if !dir.is_dir() {
            return Err(Error::Invalid(format!(
                "{}: folder not found on this computer",
                folder.path
            )));
        }
        let mut files = vec![];
        robot_files(dir, 3, &mut files)?;
        let cfg = self.get_config()?;
        files.retain(|(name, _)| raw::filename(name, &cfg.time_zone).is_ok());
        files.sort();
        files.dedup_by(|a, b| a.0 == b.0);
        let known: BTreeSet<String> = self
            .db()?
            .prepare("SELECT filename FROM measurements WHERE status='ok'")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        let mut report = FolderReport {
            files: files.len(),
            ..Default::default()
        };
        let layout = self.layout_value()?;
        let mut paths = vec![];
        for (name, path) in files {
            if known.contains(&name) {
                report.known += 1;
                continue;
            }
            if folder.field_only && !inside_field(&name, &cfg, &layout) {
                report.outside_field += 1;
                continue;
            }
            paths.push(path);
        }
        if !paths.is_empty() {
            let imported = self.import_raw_files(&paths, progress)?;
            report.imported = imported.imported;
            // Files that failed before and still fail are known, not new.
            report.known += imported.skipped;
            report.errors = imported.errors;
        }
        folder.last_scan = Some(chrono::Utc::now().timestamp_millis());
        folder.last_report = Some(report.clone());
        self.db()?.execute(
            "INSERT INTO meta(key,value) VALUES('raw_folder',?1) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [serde_json::to_string(&folder)?],
        )?;
        Ok(report)
    }
}

/// Whether a measured chamber of this file lands in a plot (by the project's
/// usual assignment: route visits or plot polygons). A project without plots
/// has no field to filter by, so everything counts as inside.
fn inside_field(name: &str, cfg: &ProjectConfig, layout: &StoredLayout) -> bool {
    if layout.plots.is_empty() {
        return true;
    }
    let Ok(m) = raw::filename(name, &cfg.time_zone) else {
        return false;
    };
    let sides: &[u8] = match m.sides.as_str() {
        "left" => &[1],
        "right" => &[2],
        _ => &[1, 2],
    };
    sides.iter().any(|side| {
        let mut row = FluxRow::new();
        assign(&mut row, &m, *side, cfg, layout);
        row.get("plotId").is_some_and(|v| !v.is_null())
    })
}
