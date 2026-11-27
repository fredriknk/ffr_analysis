//! A watched folder of robot raw files: new files whose chambers fall inside
//! the project's plots are imported, the rest are left alone.
use super::*;

/// Robot files below `dir` (a few levels deep), as (file name without `.gz`, path).
fn robot_files(dir: &Path, depth: usize, out: &mut Vec<(String, String)>) -> Result<()> {
    for entry in std::fs::read_dir(dir).map_err(|e| Error::at(dir, e))? {
        let entry = entry.map_err(|e| Error::at(dir, e))?;
        let path = entry.path();
        // The listing's own file type: no extra call per file (a shared folder
        // holds tens of thousands). A link to a folder is followed.
        let kind = entry.file_type().map_err(|e| Error::at(&path, e))?;
        if kind.is_dir() || (kind.is_symlink() && path.is_dir()) {
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
                f.from = day(f.from.take(), "from")?;
                f.to = day(f.to.take(), "to")?;
                if let (Some(a), Some(b)) = (&f.from, &f.to) {
                    if a > b {
                        return Err(Error::Invalid(
                            "the date range ends before it starts".into(),
                        ));
                    }
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

    /// Imports the folder's new robot files: inside the date range, and inside
    /// the field when `fieldOnly`. Files left out are looked at again next
    /// time, so drawing more plots later picks them up. When nothing filters
    /// the files (`fieldOnly`, no plots, no date range) they wait for `all`.
    pub fn raw_folder_scan(&self, all: bool, progress: impl Fn(Progress)) -> Result<FolderReport> {
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
        // Each name is parsed once: the filters below decide from it alone.
        let mut files: Vec<_> = files
            .into_iter()
            .filter_map(|(name, path)| {
                let m = raw::filename(&name, &cfg.time_zone).ok()?;
                Some((name, path, m))
            })
            .collect();
        files.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
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
        let zone: chrono_tz::Tz = cfg.time_zone.parse().unwrap_or(chrono_tz::UTC);
        let dated = folder.from.is_some() || folder.to.is_some();
        let hold = !all && !dated && folder.field_only && layout.plots.is_empty();
        let mut paths = vec![];
        for (name, path, m) in files {
            if known.contains(&name) {
                report.known += 1;
                continue;
            }
            if dated && !in_dates(&m, zone, &folder) {
                report.outside_dates += 1;
                continue;
            }
            if folder.field_only && !inside_field(&m, &cfg, &layout) {
                report.outside_field += 1;
                continue;
            }
            if hold {
                report.waiting += 1;
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

/// A `YYYY-MM-DD` day (blank means open), normalised.
fn day(text: Option<String>, which: &str) -> Result<Option<String>> {
    let Some(text) = text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    // Exactly YYYY-MM-DD: chrono alone would also take `2022-9-1`.
    match chrono::NaiveDate::parse_from_str(&text, "%Y-%m-%d") {
        Ok(d) if d.to_string() == text => Ok(Some(text)),
        _ => Err(Error::Invalid(format!(
            "{which}: not a date (YYYY-MM-DD): {text}"
        ))),
    }
}

/// Whether the file was measured within the folder's days (inclusive, in the
/// project's time zone).
fn in_dates(m: &raw::Metadata, zone: chrono_tz::Tz, folder: &RawFolder) -> bool {
    let Some(local) = chrono::DateTime::from_timestamp_millis(m.time) else {
        return false;
    };
    let local = local.with_timezone(&zone).date_naive().to_string();
    folder.from.as_ref().is_none_or(|from| &local >= from)
        && folder.to.as_ref().is_none_or(|to| &local <= to)
}

/// How far (m) a chamber may be from a plot it matches by route waypoint and
/// still count as measured in that plot. A shared folder holds other projects'
/// routes, whose waypoint numbers repeat ours; their chambers are elsewhere.
const NEAR_PLOT: f64 = 5.0;

/// Whether a measured chamber of this file lands in a plot, by the project's
/// usual assignment (route visits or plot polygons), and is near that plot. A
/// project without plots has no field to filter by, so everything counts as
/// inside.
fn inside_field(m: &raw::Metadata, cfg: &ProjectConfig, layout: &StoredLayout) -> bool {
    if layout.plots.is_empty() {
        return true;
    }
    let sides: &[u8] = match m.sides.as_str() {
        "left" => &[1],
        "right" => &[2],
        _ => &[1, 2],
    };
    sides.iter().any(|side| {
        let mut row = FluxRow::new();
        assign(&mut row, m, *side, cfg, layout);
        let Some(id) = row.get("plotId").filter(|v| !v.is_null()) else {
            return false;
        };
        let (Some(x), Some(y)) = (
            row.get("x").and_then(Value::as_f64),
            row.get("y").and_then(Value::as_f64),
        ) else {
            return false;
        };
        layout
            .plots
            .iter()
            .find(|p| &p["id"] == id)
            .is_some_and(|p| near(p, x, y))
    })
}

/// Whether (x, y) is inside the plot's polygon or within [`NEAR_PLOT`] of it.
/// A plot without a polygon has nothing to compare with and counts as near.
fn near(plot: &Value, x: f64, y: f64) -> bool {
    let Some(poly) = plot["polygon"].as_array().filter(|p| !p.is_empty()) else {
        return true;
    };
    if contains(poly, x, y) {
        return true;
    }
    let point = |v: &Value| (v[0].as_f64().unwrap_or(0.), v[1].as_f64().unwrap_or(0.));
    poly.iter()
        .zip(poly.iter().cycle().skip(1))
        .any(|(a, b)| segment_distance(point(a), point(b), (x, y)) <= NEAR_PLOT)
}

fn segment_distance((ax, ay): (f64, f64), (bx, by): (f64, f64), (x, y): (f64, f64)) -> f64 {
    let (dx, dy) = (bx - ax, by - ay);
    let len = dx * dx + dy * dy;
    let t = if len > 0. {
        (((x - ax) * dx + (y - ay) * dy) / len).clamp(0., 1.)
    } else {
        0.
    };
    (x - ax - t * dx).hypot(y - ay - t * dy)
}
