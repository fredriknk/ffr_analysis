use crate::{
    api::*,
    raw::{self, Raw},
    regression::{self},
    Error, Result,
};

use rayon::prelude::*;

use rusqlite::{params, Connection, OptionalExtension};

use serde_json::{json, Value};

use std::{collections::BTreeMap, path::Path};

#[derive(Default)]

pub struct Session {
    db: Option<Connection>,
    path: String,
    recent: Vec<Value>,
    client_id: Option<String>,
    series_cache: std::cell::RefCell<BTreeMap<i64, Vec<Value>>>,
}

impl Session {
    fn db(&self) -> Result<&Connection> {
        self.db
            .as_ref()
            .ok_or_else(|| Error::Invalid("no project open".into()))
    }

    pub fn project_create(&mut self, path: &str, name: &str) -> Result<ProjectInfo> {
        if Path::new(path).exists() {
            return Err(Error::Invalid("destination exists".into()));
        }
        let db = Connection::open(path)?;
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA application_id=1179013682; PRAGMA user_version=1; PRAGMA foreign_keys=ON;

 CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);

 CREATE TABLE measurements(id INTEGER PRIMARY KEY,filename TEXT UNIQUE NOT NULL,metadata TEXT NOT NULL,raw BLOB,status TEXT NOT NULL,error TEXT);

 CREATE TABLE fluxes(id INTEGER PRIMARY KEY,measurement_id INTEGER REFERENCES measurements(id),row TEXT NOT NULL,options TEXT,results TEXT NOT NULL);

 CREATE TABLE series(id INTEGER PRIMARY KEY,metadata TEXT NOT NULL,points TEXT NOT NULL);

 CREATE TABLE changes(id INTEGER PRIMARY KEY,time INTEGER NOT NULL,kind TEXT NOT NULL,before TEXT NOT NULL,after TEXT NOT NULL,target INTEGER,action TEXT NOT NULL,original INTEGER);")?;

        db.execute("INSERT INTO meta VALUES ('name',?1)", [name])?;
        db.execute(
            "INSERT INTO meta VALUES ('config',?1)",
            [serde_json::to_string(&ProjectConfig::default())?],
        )?;
        db.execute(
            "INSERT INTO meta VALUES ('layout',?1)",
            [serde_json::to_string(&Layout::default())?],
        )?;
        self.series_cache.borrow_mut().clear();
        self.db = Some(db);
        self.path = path.into();
        self.project_info()?
            .ok_or_else(|| Error::Invalid("project creation failed".into()))
    }

    pub fn project_open(&mut self, path: &str) -> Result<ProjectInfo> {
        let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        let app: i64 = db.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        let version: u32 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if app != 1179013682 || version != 1 {
            return Err(Error::Invalid(
                "unsupported project or schema version".into(),
            ));
        }
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;")?;
        self.series_cache.borrow_mut().clear();
        self.db = Some(db);
        self.path = path.into();
        let info = self
            .project_info()?
            .ok_or_else(|| Error::Invalid("open failed".into()))?;
        self.recent.retain(|r| r["path"] != path);
        self.recent.insert(
            0,
            json!({"path":path,"name":info.name,"openedAt":chrono::Utc::now().timestamp_millis()}),
        );
        Ok(info)
    }

    pub fn project_close(&mut self) {
        self.db = None;
        self.path.clear();
    }

    pub fn project_info(&self) -> Result<Option<ProjectInfo>> {
        if self.db.is_none() {
            return Ok(None);
        }
        let db = self.db()?;
        let rows = self.rows()?;
        let times: Vec<i64> = rows.iter().filter_map(|r| r["time"].as_i64()).collect();
        let count = |k: &str| rows.iter().filter(|r| r[k] == true).count();
        Ok(Some(ProjectInfo {
            path: self.path.clone(),
            name: db.query_row("SELECT value FROM meta WHERE key='name'", [], |r| r.get(0))?,
            time_zone: self.get_config()?.time_zone,
            schema_version: 1,
            counts: Counts {
                measurements: db
                    .query_row("SELECT count(*) FROM measurements", [], |r| r.get(0))?,
                fluxes: rows.len(),
                excluded: count("excluded"),
                overridden: count("overridden"),
                reviewed: count("reviewed"),
                manual: rows.iter().filter(|r| r["source"] == "manual").count(),
                series: self.list_series()?.len(),
            },
            time_range: times
                .iter()
                .min()
                .zip(times.iter().max())
                .map(|(a, b)| [*a, *b]),
        }))
    }

    pub fn recent_projects(&self) -> Vec<Value> {
        self.recent.clone()
    }

    pub fn project_save_copy(&self, path: &str) -> Result<()> {
        self.db()?.execute("VACUUM INTO ?1", [path])?;
        Ok(())
    }

    fn meta<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<T> {
        let s: String =
            self.db()?
                .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))?;
        Ok(serde_json::from_str(&s)?)
    }

    pub fn get_config(&self) -> Result<ProjectConfig> {
        self.meta("config")
    }

    pub fn get_layout(&self) -> Result<Layout> {
        self.meta("layout")
    }

    fn edit_meta<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let before: String =
            self.db()?
                .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))?;
        let after = serde_json::to_string(value)?;
        self.db()?
            .execute("UPDATE meta SET value=?2 WHERE key=?1", params![key, after])?;
        self.log(
            key,
            None,
            &serde_json::from_str::<Value>(&before)?,
            &serde_json::from_str::<Value>(&after)?,
            "edit",
            None,
        )?;
        Ok(())
    }

    pub fn set_config(&self, cfg: ProjectConfig, progress: impl Fn(Progress)) -> Result<()> {
        let _: chrono_tz::Tz = cfg
            .time_zone
            .parse()
            .map_err(|_| Error::Invalid("invalid time zone".into()))?;
        self.edit_meta("config", &cfg)?;
        self.recompute_all(progress)
    }

    pub fn set_layout(&self, layout: Layout, progress: impl Fn(Progress)) -> Result<()> {
        self.edit_meta("layout", &layout)?;
        self.recompute_all(progress)
    }

    fn rows(&self) -> Result<Vec<FluxRow>> {
        let mut q = self.db()?.prepare("SELECT row FROM fluxes ORDER BY id")?;
        let strings = q
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        strings
            .iter()
            .map(|s| Ok(serde_json::from_str(s)?))
            .collect()
    }

    fn row(&self, id: i64) -> Result<FluxRow> {
        let s: String = self
            .db()?
            .query_row("SELECT row FROM fluxes WHERE id=?1", [id], |r| r.get(0))?;
        Ok(serde_json::from_str(&s)?)
    }

    pub fn list_fluxes(&self) -> Result<FluxTable> {
        let rows = self.rows()?;
        let mut keys: BTreeMap<String, String> = BTreeMap::new();
        for row in &rows {
            for (k, v) in row {
                keys.entry(k.clone()).or_insert_with(|| {
                    if k == "time" {
                        "time"
                    } else if v.is_boolean() {
                        "boolean"
                    } else if v.is_number() {
                        "number"
                    } else {
                        "string"
                    }
                    .into()
                });
            }
        }
        let columns = keys
            .iter()
            .map(|(k, t)| ColumnMeta {
                key: k.clone(),
                label: k.clone(),
                unit: None,
                r#type: t.clone(),
                group: if k.contains('_') {
                    "analysis"
                } else {
                    "context"
                }
                .into(),
            })
            .collect();
        let data = keys
            .keys()
            .map(|k| {
                (
                    k.clone(),
                    rows.iter()
                        .map(|r| r.get(k).cloned().unwrap_or(Value::Null))
                        .collect(),
                )
            })
            .collect();
        Ok(FluxTable {
            columns,
            rows: rows.len(),
            data,
        })
    }

    fn options(&self, id: i64) -> Result<(AnalysisOptions, bool)> {
        let s: Option<String> =
            self.db()?
                .query_row("SELECT options FROM fluxes WHERE id=?1", [id], |r| r.get(0))?;
        Ok((
            match &s {
                Some(s) => serde_json::from_str(s)?,
                None => self.get_config()?.defaults,
            },
            s.is_some(),
        ))
    }

    fn measurement(&self, id: i64) -> Result<Raw> {
        let (meta, bytes): (String, Vec<u8>) = self.db()?.query_row(
            "SELECT metadata,raw FROM measurements WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let original = serde_json::from_slice(&zstd::stream::decode_all(&bytes[..])?)?;
        raw::from_value(serde_json::from_str(&meta)?, original)
    }

    fn detail(&self, id: i64, preview: Option<AnalysisOptions>) -> Result<Value> {
        let row = self.row(id)?;
        let (stored, overridden) = self.options(id)?;
        let options = preview.unwrap_or(stored);
        let Some(mid) = row["measurementId"].as_i64() else {
            return Ok(
                json!({"flux":row,"options":options,"isOverridden":overridden,"siblingFluxId":null,"switches":[],"traces":[],"regressions":[],"sibling":[]}),
            );
        };
        let raw = self.measurement(mid)?;
        let side = if row["side"] == "left" { 1 } else { 2 };
        let temp = row["airTemp"].as_f64().unwrap_or(20.);
        let results = regression::compute(
            &raw,
            side,
            &json!({}),
            &regression::legacy_options(&options),
            temp,
        )?;
        let sibling: Option<(i64, String)> = self
            .db()?
            .query_row(
                "SELECT id,results FROM fluxes WHERE measurement_id=?1 AND id!=?2",
                params![mid, id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let mut traces = vec![];
        for gas in regression::GASES {
            if let Some((t, y)) = raw.channels.get(gas) {
                let sides =
                    raw::group_indices(t, &raw.switches, options.cut_beginnings, options.cut_ends);
                let used: Vec<bool> = t
                    .iter()
                    .zip(y)
                    .zip(&sides)
                    .map(|((t, y), s)| {
                        *s == side
                            && *y != 0.
                            && results
                                .get(gas)
                                .is_some_and(|r| *t >= r.start && *t < r.stop)
                    })
                    .collect();
                traces.push(json!({"gas":gas,"unit":"ppm","t":t,"y":y,"side":sides,"used":used}));
            }
        }
        let sibling_results: Value = sibling
            .as_ref()
            .map(|(_, s)| serde_json::from_str(s))
            .transpose()?
            .unwrap_or(json!({}));
        Ok(
            json!({"flux":row,"options":options,"isOverridden":overridden,"siblingFluxId":sibling.as_ref().map(|s|s.0),"switches":raw.switches.iter().map(|(t,s)|json!({"t":t,"side":if *s==1{"left"}else{"right"}})).collect::<Vec<_>>(),"traces":traces,"regressions":results.values().collect::<Vec<_>>(),"sibling":sibling_results.as_object().map(|m|m.values().collect::<Vec<_>>()).unwrap_or_default()}),
        )
    }

    pub fn get_flux_detail(&self, id: i64) -> Result<Value> {
        self.detail(id, None)
    }

    pub fn preview_flux(&self, id: i64, options: AnalysisOptions) -> Result<Value> {
        self.detail(id, Some(options))
    }

    fn log(
        &self,
        kind: &str,
        target: Option<i64>,
        before: &Value,
        after: &Value,
        action: &str,
        original: Option<i64>,
    ) -> Result<()> {
        self.db()?.execute("INSERT INTO changes(time,kind,before,after,target,action,original) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![chrono::Utc::now().timestamp_millis(),kind,before.to_string(),after.to_string(),target,action,original])?;
        Ok(())
    }

    pub fn set_flux_options(
        &self,
        ids: &[i64],
        options: Option<AnalysisOptions>,
    ) -> Result<Vec<FluxRow>> {
        let mut out = vec![];
        for id in ids {
            let old: Option<String> =
                self.db()?
                    .query_row("SELECT options FROM fluxes WHERE id=?1", [id], |r| r.get(0))?;
            let before = old
                .map(|s| serde_json::from_str::<Value>(&s))
                .transpose()?
                .unwrap_or(Value::Null);
            let after = serde_json::to_value(&options)?;
            self.db()?.execute(
                "UPDATE fluxes SET options=?2 WHERE id=?1",
                params![id, options.as_ref().map(serde_json::to_string).transpose()?],
            )?;
            self.log("options", Some(*id), &before, &after, "edit", None)?;
            self.recompute_one(*id)?;
            out.push(self.row(*id)?);
        }
        Ok(out)
    }

    pub fn set_flux_flags(&self, ids: &[i64], flags: Value) -> Result<Vec<FluxRow>> {
        let mut out = vec![];
        for id in ids {
            let mut row = self.row(*id)?;
            let before = serde_json::to_value(&row)?;
            for k in ["excluded", "reviewed", "note", "plotOverride"] {
                if let Some(v) = flags.get(k) {
                    row.insert(k.into(), v.clone());
                }
            }
            self.write_row(*id, &row)?;
            self.log(
                "flags",
                Some(*id),
                &before,
                &serde_json::to_value(&row)?,
                "edit",
                None,
            )?;
            self.recompute_one(*id)?;
            out.push(self.row(*id)?);
        }
        Ok(out)
    }

    fn write_row(&self, id: i64, row: &FluxRow) -> Result<()> {
        self.db()?.execute(
            "UPDATE fluxes SET row=?2 WHERE id=?1",
            params![id, serde_json::to_string(row)?],
        )?;
        Ok(())
    }

    fn weather(&self, time: i64, key: &str) -> Result<Option<f64>> {
        for s in self.list_series()? {
            if s["name"] == key {
                let id = s["id"].as_i64().unwrap_or(0);
                let data = self.get_series(&[id], None, None, None)?;
                let p: Vec<(i64, f64)> = data[0]["points"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|p| Some((p["time"].as_i64()?, p["value"].as_f64()?)))
                    .collect();
                return Ok(interpolate(&p, time));
            }
        }
        Ok(None)
    }

    fn recompute_one(&self, id: i64) -> Result<()> {
        let mut row = self.row(id)?;
        let Some(mid) = row["measurementId"].as_i64() else {
            return Ok(());
        };
        let raw = self.measurement(mid)?;
        let cfg = self.get_config()?;
        let (opts, overridden) = self.options(id)?;
        let temp = self
            .weather(raw.metadata.time, "air_temperature")?
            .unwrap_or(cfg.fallback_temperature);
        row.insert("airTemp".into(), json!(temp));
        row.insert(
            "temperatureFallback".into(),
            json!(self
                .weather(raw.metadata.time, "air_temperature")?
                .is_none()),
        );
        row.insert(
            "precip".into(),
            json!(self
                .weather(raw.metadata.time, "sum(precipitation_amount PT1H)")?
                .unwrap_or(0.)),
        );
        let side = if row["side"] == "left" { 1 } else { 2 };
        let results = regression::compute(
            &raw,
            side,
            &json!({}),
            &regression::legacy_options(&opts),
            temp,
        )?;
        let layout = self.get_layout()?;
        assign(&mut row, &raw.metadata, side, &cfg, &layout);
        row.insert("overridden".into(), json!(overridden));
        for (gas, r) in &results {
            for (key, v) in [
                ("slope", r.slope),
                ("rsq", r.rsq),
                ("pval", r.pval),
                ("flux", r.flux),
            ] {
                row.insert(format!("{gas}_{key}"), json!(v));
            }
            if gas == "N2O" {
                row.insert("N2O_qc".into(), json!(r.qc));
            }
        }
        for s in self.list_series()? {
            if let (Some(name), Some(sid)) = (s["name"].as_str(), s["id"].as_i64()) {
                let data = self.get_series(&[sid], None, None, None)?;
                let points = data[0]["points"].as_array().cloned().unwrap_or_default();
                let nearest = points
                    .iter()
                    .filter_map(|p| Some((p["time"].as_i64()?, p["value"].as_f64()?)))
                    .min_by_key(|(t, _)| (t - raw.metadata.time).abs());
                let value = nearest
                    .filter(|(t, _)| {
                        (t - raw.metadata.time).abs() <= s["maxGap"].as_i64().unwrap_or(3600000)
                    })
                    .map(|p| p.1);
                row.insert(name.into(), json!(value));
            }
        }
        self.write_row(id, &row)?;
        self.db()?.execute(
            "UPDATE fluxes SET results=?2 WHERE id=?1",
            params![id, serde_json::to_string(&results)?],
        )?;
        Ok(())
    }

    pub fn recompute_all(&self, progress: impl Fn(Progress)) -> Result<()> {
        let rows = self.rows()?;
        for (i, r) in rows.iter().enumerate() {
            self.recompute_one(r["id"].as_i64().unwrap_or(0))?;
            progress(Progress {
                task: "recomputeAll".into(),
                done: i + 1,
                total: rows.len(),
                message: None,
            });
        }
        Ok(())
    }

    pub fn import_raw_files(
        &self,
        paths: &[String],
        progress: impl Fn(Progress),
    ) -> Result<ImportReport> {
        let cfg = self.get_config()?;
        let parsed: Vec<_> = paths
            .par_iter()
            .map(|p| raw::load(Path::new(p), &cfg.time_zone))
            .collect();
        let db = self.db()?;
        let tx = db.unchecked_transaction()?;
        let mut report = ImportReport::default();
        for (i, (path, raw)) in paths.iter().zip(parsed).enumerate() {
            let name = Path::new(path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .trim_end_matches(".gz")
                .to_string();
            if db
                .query_row(
                    "SELECT id FROM measurements WHERE filename=?1",
                    [&name],
                    |r| r.get::<_, i64>(0),
                )
                .optional()?
                .is_some()
            {
                report.skipped += 1;
                continue;
            }
            match raw {
                Err(e) => {
                    report.errors.push(format!("{name}: {e}"));
                    let metadata = raw::filename(&name, &cfg.time_zone)
                        .ok()
                        .map(|m| serde_json::to_string(&m))
                        .transpose()?
                        .unwrap_or_else(|| "{}".into());
                    db.execute("INSERT INTO measurements(filename,metadata,status,error) VALUES(?1,?2,'error',?3)",params![name,metadata,e.to_string()])?;
                }
                Ok(raw) => {
                    let bytes =
                        zstd::stream::encode_all(&serde_json::to_vec(&raw.original)?[..], 1)?;
                    db.execute("INSERT INTO measurements(filename,metadata,raw,status) VALUES(?1,?2,?3,'ok')",params![name,serde_json::to_string(&raw.metadata)?,bytes])?;
                    let mid = db.last_insert_rowid();
                    for side in ["left", "right"] {
                        let row = json!({"id":0,"measurementId":mid,"source":"robot","time":raw.metadata.time,"filename":name,"side":side,"plotId":null,"plotLabel":null,"treatmentId":null,"treatmentName":null,"excluded":false,"reviewed":false,"overridden":false,"note":"","airTemp":null,"precip":null,"plotOverride":null});
                        db.execute(
                            "INSERT INTO fluxes(measurement_id,row,results) VALUES(?1,?2,'{}')",
                            params![mid, row.to_string()],
                        )?;
                        let id = db.last_insert_rowid();
                        let mut row: FluxRow = serde_json::from_value(row)?;
                        row.insert("id".into(), json!(id));
                        self.write_row(id, &row)?;
                        if let Err(e) = self.recompute_one(id) {
                            report.errors.push(format!("{name} {side}: {e}"));
                        }
                    }
                    report.imported += 1;
                }
            }
            progress(Progress {
                task: "importRawFiles".into(),
                done: i + 1,
                total: paths.len(),
                message: Some(name),
            });
        }
        tx.commit()?;
        Ok(report)
    }

    pub fn list_series(&self) -> Result<Vec<Value>> {
        let mut q = self
            .db()?
            .prepare("SELECT id,metadata FROM series ORDER BY id")?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(id, s)| {
                let mut v: Value = serde_json::from_str(&s)?;
                v["id"] = json!(id);
                Ok(v)
            })
            .collect()
    }

    pub fn get_series(
        &self,
        ids: &[i64],
        from: Option<i64>,
        to: Option<i64>,
        max_points: Option<usize>,
    ) -> Result<Vec<Value>> {
        let mut out = vec![];
        for id in ids {
            if !self.series_cache.borrow().contains_key(id) {
                let s: String =
                    self.db()?
                        .query_row("SELECT points FROM series WHERE id=?1", [id], |r| r.get(0))?;
                self.series_cache
                    .borrow_mut()
                    .insert(*id, serde_json::from_str(&s)?);
            }
            let mut points = self
                .series_cache
                .borrow()
                .get(id)
                .cloned()
                .unwrap_or_default();
            points.retain(|p| {
                p["time"]
                    .as_i64()
                    .is_some_and(|t| from.is_none_or(|f| t >= f) && to.is_none_or(|v| t <= v))
            });
            if let Some(max) = max_points {
                if max == 0 {
                    points.clear();
                } else if points.len() > max {
                    let n = points.len();
                    points = (0..max)
                        .map(|i| points[i * (n - 1) / max.saturating_sub(1).max(1)].clone())
                        .collect();
                }
            }
            out.push(json!({"id":id,"points":points}));
        }
        Ok(out)
    }

    pub fn store_series(
        &self,
        name: &str,
        unit: &str,
        mut points: Vec<Value>,
        max_gap: i64,
    ) -> Result<i64> {
        points.retain(|p| {
            p["value"].as_f64().is_some_and(f64::is_finite) && p["time"].as_i64().is_some()
        });
        points.sort_by_key(|p| p["time"].as_i64());
        points.dedup_by_key(|p| p["time"].as_i64());
        let metadata = json!({"name":name,"unit":unit,"maxGap":max_gap,"count":points.len(),"timeRange":points.first().zip(points.last()).map(|(a,b)|json!([a["time"],b["time"]]))});
        self.db()?.execute(
            "INSERT INTO series(metadata,points) VALUES(?1,?2)",
            params![metadata.to_string(), serde_json::to_string(&points)?],
        )?;
        Ok(self.db()?.last_insert_rowid())
    }

    pub fn delete_series(&self, id: i64) -> Result<()> {
        self.series_cache.borrow_mut().remove(&id);
        self.db()?.execute("DELETE FROM series WHERE id=?1", [id])?;
        self.recompute_all(|_| {})
    }

    pub fn history(&self, limit: usize) -> Result<Vec<Value>> {
        let mut q=self.db()?.prepare("SELECT id,time,kind,before,after,target,action,original FROM changes ORDER BY id DESC LIMIT ?1")?;
        let rows=q.query_map([limit],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"time":r.get::<_,i64>(1)?,"kind":r.get::<_,String>(2)?,"before":r.get::<_,String>(3)?,"after":r.get::<_,String>(4)?,"target":r.get::<_,Option<i64>>(5)?,"action":r.get::<_,String>(6)?,"original":r.get::<_,Option<i64>>(7)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
        Ok(rows)
    }

    pub fn undo(&self) -> Result<Value> {
        self.travel(false)
    }

    pub fn redo(&self) -> Result<Value> {
        self.travel(true)
    }

    fn travel(&self, redo: bool) -> Result<Value> {
        let history = self.history(usize::MAX / 2)?;
        let mut undone = std::collections::BTreeSet::new();
        let mut redos = vec![];
        for h in history.iter().rev() {
            let id = h["id"].as_i64().unwrap_or(0);
            let original = h["original"].as_i64().unwrap_or(0);
            match h["action"].as_str() {
                Some("edit") => {
                    redos.clear();
                }
                Some("undo") => {
                    undone.insert(original);
                    redos.push(original);
                }
                Some("redo") => {
                    undone.remove(&original);
                    redos.retain(|v| *v != original);
                }
                _ => {}
            }
            let _ = id;
        }
        let chosen = if redo {
            redos
                .last()
                .and_then(|id| history.iter().find(|h| h["id"] == *id))
        } else {
            history
                .iter()
                .find(|h| h["action"] == "edit" && !undone.contains(&h["id"].as_i64().unwrap_or(0)))
        };
        let Some(h) = chosen else {
            return Ok(json!({"changed":false}));
        };
        let key = if redo { "after" } else { "before" };
        let v: Value = serde_json::from_str(h[key].as_str().unwrap_or("null"))?;
        let kind = h["kind"].as_str().unwrap_or("");
        let target = h["target"].as_i64();
        match kind {
            "config" | "layout" => {
                self.db()?.execute(
                    "UPDATE meta SET value=?2 WHERE key=?1",
                    params![kind, v.to_string()],
                )?;
                self.recompute_all(|_| {})?;
            }
            "options" => {
                self.db()?.execute(
                    "UPDATE fluxes SET options=?2 WHERE id=?1",
                    params![
                        target,
                        if v.is_null() {
                            None
                        } else {
                            Some(v.to_string())
                        }
                    ],
                )?;
                self.recompute_one(target.unwrap_or(0))?;
            }
            "flags" => {
                self.write_row(target.unwrap_or(0), &serde_json::from_value(v.clone())?)?;
                self.recompute_one(target.unwrap_or(0))?;
            }
            _ => {}
        }
        self.log(
            kind,
            target,
            &serde_json::from_str::<Value>(h["before"].as_str().unwrap_or("null"))?,
            &serde_json::from_str::<Value>(h["after"].as_str().unwrap_or("null"))?,
            if redo { "redo" } else { "undo" },
            h["id"].as_i64(),
        )?;
        Ok(json!({"changed":true,"fluxIds":target.into_iter().collect::<Vec<_>>()}))
    }

    pub fn metno_get_client_id(&self) -> Option<String> {
        self.client_id.clone()
    }

    pub fn metno_set_client_id(&mut self, id: String) {
        self.client_id = Some(id);
    }
}

fn interpolate(p: &[(i64, f64)], time: i64) -> Option<f64> {
    if p.is_empty() {
        return None;
    }
    let i = p.partition_point(|(t, _)| *t < time);
    if i == 0 {
        return Some(p[0].1);
    }
    if i == p.len() {
        return Some(p[i - 1].1);
    }
    let (a, x) = p[i - 1];
    let (b, y) = p[i];
    Some(x + (y - x) * (time - a) as f64 / (b - a) as f64)
}

fn assign(row: &mut FluxRow, m: &raw::Metadata, side: u8, cfg: &ProjectConfig, layout: &Layout) {
    let (Some(mut x), Some(mut y)) = (m.x, m.y) else {
        return;
    };
    if let Some(h) = m.heading {
        let a = h + if side == 1 {
            std::f64::consts::FRAC_PI_2
        } else {
            -std::f64::consts::FRAC_PI_2
        };
        x += cfg.chamber_distance * a.cos() + cfg.chamber_forward_distance * h.cos();
        y += cfg.chamber_distance * a.sin() + cfg.chamber_forward_distance * h.sin();
    }
    row.insert("chamberX".into(), json!(x));
    row.insert("chamberY".into(), json!(y));
    let plot = layout.plots.iter().find(|p| {
        if let Some(id) = row.get("plotOverride").filter(|v| !v.is_null()) {
            return &p["id"] == id;
        }
        p["polygon"]
            .as_array()
            .is_some_and(|poly| contains(poly, x, y))
    });
    if let Some(p) = plot {
        row.insert("plotId".into(), p["id"].clone());
        row.insert("plotLabel".into(), p["label"].clone());
        row.insert("treatmentId".into(), p["treatmentId"].clone());
        if let Some(t) = layout
            .treatments
            .iter()
            .find(|t| t["id"] == p["treatmentId"])
        {
            row.insert("treatmentName".into(), t["name"].clone());
        }
    }
}

fn contains(poly: &[Value], x: f64, y: f64) -> bool {
    if poly.is_empty() {
        return false;
    }
    let mut inside = false;
    let mut p = &poly[0];
    for q in poly.iter().cycle().skip(1).take(poly.len()) {
        let (a, b, c, d) = (
            p[0].as_f64().unwrap_or(0.),
            p[1].as_f64().unwrap_or(0.),
            q[0].as_f64().unwrap_or(0.),
            q[1].as_f64().unwrap_or(0.),
        );
        if y > b.min(d)
            && y <= b.max(d)
            && x <= a.max(c)
            && (a == c || x <= (y - b) * (c - a) / (d - b) + a)
        {
            inside = !inside;
        }
        p = q;
    }
    inside
}

impl Session {
    pub fn legacy_scan(&self, dir: &str) -> Result<Value> {
        let root = Path::new(dir);
        let cfg = root.join("config.yml");
        let config: Value = if cfg.exists() {
            serde_yaml::from_str(&std::fs::read_to_string(cfg)?)
                .map_err(|e| Error::Invalid(e.to_string()))?
        } else {
            json!({})
        };
        let raw = config["PATHS"]["RAWDATA"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| root.join("raw_data").to_string_lossy().into());
        let count = std::fs::read_dir(&raw)
            .map(|d| {
                d.filter_map(|x| x.ok())
                    .filter(|e| e.file_name().to_string_lossy().starts_with('2'))
                    .count()
            })
            .unwrap_or(0);
        Ok(
            json!({"legacyDir":dir,"rawDir":raw,"rawCount":count,"config":config,"specificOptions":root.join("specific_options.pickle").exists(),"manualPath":config["PATHS"]["MANUAL"],"loggerPath":config["PATHS"]["LOGGER_PATH"],"preset":root.file_name().unwrap_or_default().to_string_lossy().to_lowercase()}),
        )
    }

    pub fn legacy_import(
        &mut self,
        args: LegacyImportArgs,
        progress: impl Fn(Progress),
    ) -> Result<ProjectInfo> {
        let scan = self.legacy_scan(&args.legacy_dir)?;
        let name = Path::new(&args.legacy_dir)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        self.project_create(&args.out_path, &name)?;
        let mut cfg = self.get_config()?;
        let preset = args.preset.or_else(|| Some(name.to_lowercase()));
        cfg.preset = preset.clone();
        self.db()?.execute(
            "UPDATE meta SET value=?1 WHERE key='config'",
            [serde_json::to_string(&cfg)?],
        )?;
        let layout = preset_layout(preset.as_deref().unwrap_or(""))?;
        self.db()?.execute(
            "UPDATE meta SET value=?1 WHERE key='layout'",
            [serde_json::to_string(&layout)?],
        )?;
        let raw_dir = args
            .raw_dir
            .or_else(|| scan["rawDir"].as_str().map(str::to_owned))
            .ok_or_else(|| Error::Invalid("raw directory required".into()))?;
        let mut paths: Vec<String> = std::fs::read_dir(&raw_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with('2'))
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if preset.as_deref() == Some("capture") {
                    raw::filename(&name, &cfg.time_zone).is_ok_and(|m| {
                        name.as_str() >= "2021-08-19"
                            && m.x.is_some_and(|x| x > 599201. && x < 599246.)
                            && m.y.is_some_and(|y| y > 6615259. && y < 6615314.)
                    })
                } else {
                    name.contains("_Plot_")
                }
            })
            .map(|e| e.path().to_string_lossy().into())
            .collect();
        paths.sort();

        // Weather is imported first so initial regression fluxes use the interpolated temperature.

        if let Some(path) = args.metno_pickle_path {
            self.import_metno_cache(&path)?;
        }

        self.import_raw_files(&paths, &progress)?;

        let opts_path = Path::new(&args.legacy_dir).join("specific_options.pickle");
        if opts_path.exists() {
            let all = raw::read_value(&opts_path)?;
            let mut cfg = self.get_config()?;
            if let Some(default) = all.get("ALL") {
                cfg.defaults = convert_options(default, &cfg.defaults)?;
                self.db()?.execute(
                    "UPDATE meta SET value=?1 WHERE key='config'",
                    [serde_json::to_string(&cfg)?],
                )?;
            }
            for row in self.rows()? {
                let filename = row["filename"].as_str().unwrap_or("");
                if let Some(o) = all.get(filename) {
                    let side = row["side"].as_str().unwrap_or("left");
                    let resolved = regression::resolve(side, "CO2", o, &all["ALL"]);
                    let mut options = convert_options(&resolved, &cfg.defaults)?;
                    for gas in regression::GASES {
                        options
                            .per_gas
                            .insert(gas.into(), regression::resolve(side, gas, o, &all["ALL"]));
                    }
                    let id = row["id"].as_i64().unwrap_or(0);
                    self.db()?.execute(
                        "UPDATE fluxes SET options=?2 WHERE id=?1",
                        params![id, serde_json::to_string(&options)?],
                    )?;
                    let mut row = row;
                    row.insert(
                        "excluded".into(),
                        json!(o["exclude"].as_bool().unwrap_or(false)),
                    );
                    self.write_row(id, &row)?;
                }
            }
            self.recompute_all(&progress)?;
        }

        if let Some(p) = args
            .manual_path
            .or_else(|| scan["manualPath"].as_str().map(str::to_owned))
        {
            self.import_manual_fluxes(json!({"path":p}))?;
        }

        if let Some(p) = args
            .logger_path
            .or_else(|| scan["loggerPath"].as_str().map(str::to_owned))
        {
            self.import_series(
                json!({"path":p,"preset":"logger","headerRow":2,"timeColumn":"Measurement Time"}),
            )?;
        }

        self.project_info()?
            .ok_or_else(|| Error::Invalid("import failed".into()))
    }

    pub fn import_metno_cache(&self, path: &str) -> Result<()> {
        let data = raw::read_value(Path::new(path))?;
        let mut series: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        let rows = self.rows()?;
        let lo = rows
            .iter()
            .filter_map(|r| r["time"].as_i64())
            .min()
            .unwrap_or(i64::MIN + 86400000)
            - 86400000;
        let hi = rows
            .iter()
            .filter_map(|r| r["time"].as_i64())
            .max()
            .unwrap_or(i64::MAX - 86400000)
            + 86400000;
        for p in data.as_array().unwrap_or(&vec![]) {
            let Some(time) = p[0].as_f64().map(|t| (t * 1000.) as i64) else {
                continue;
            };
            if time < lo || time > hi {
                continue;
            }
            if let Some(m) = p[1].as_object() {
                for (k, v) in m {
                    if let Some(v) = v.as_f64().filter(|v| v.is_finite()) {
                        series
                            .entry(k.clone())
                            .or_default()
                            .push(json!({"time":time,"value":v}));
                    }
                }
            }
        }
        for (name, p) in series {
            self.store_series(&name, "", p, 3600000)?;
        }
        Ok(())
    }

    pub fn preview_table(&self, path: &str, opts: Value) -> Result<Value> {
        let (sheets, rows) = read_table(path, opts["sheet"].as_str())?;
        let header = opts["headerRow"].as_u64().unwrap_or(0) as usize;
        Ok(
            json!({"sheets":sheets,"headerCandidates":(0..rows.len().min(5)).collect::<Vec<_>>(),"headers":rows.get(header),"rows":rows.iter().skip(header+1).take(20).collect::<Vec<_>>(),"totalRows":rows.len().saturating_sub(header+1)}),
        )
    }

    pub fn import_series(&self, args: Value) -> Result<ImportReport> {
        let path = args["path"]
            .as_str()
            .ok_or_else(|| Error::Invalid("path required".into()))?;
        let (_, rows) = read_table(path, args["sheet"].as_str())?;
        let header = args["headerRow"].as_u64().unwrap_or(0) as usize;
        let headers = rows
            .get(header)
            .ok_or_else(|| Error::Invalid("header row missing".into()))?;
        let time_col = column(headers, &args["timeColumn"]).unwrap_or(0);
        let cfg = self.get_config()?;
        let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        if args["preset"] == "logger" {
            for (i, h) in headers.iter().enumerate() {
                let h = h.as_str().unwrap_or("");
                for (key, name) in [
                    ("VWC", "VWC_GROUND"),
                    ("°C Temp", "TEMPC_GROUND"),
                    ("mS/cm EC", "ECC_GROUND"),
                ] {
                    if h.contains(key) {
                        groups.entry(name.into()).or_default().push(i);
                    }
                }
            }
        } else {
            for v in args["valueColumns"].as_array().unwrap_or(&vec![]) {
                if let Some(i) = column(headers, v) {
                    groups.insert(headers[i].as_str().unwrap_or("series").into(), vec![i]);
                }
            }
        }
        let mut count = 0;
        for (name, cols) in groups {
            let mut p = vec![];
            for row in rows.iter().skip(header + 1) {
                if let Some(time) = row
                    .get(time_col)
                    .and_then(|v| parse_time(v, &cfg.time_zone))
                {
                    let values: Vec<f64> = cols
                        .iter()
                        .filter_map(|i| row.get(*i).and_then(number))
                        .collect();
                    if !values.is_empty() {
                        p.push(json!({"time":time,"value":values.iter().sum::<f64>()/values.len() as f64}));
                    }
                }
            }
            count += p.len();
            self.store_series(
                &name,
                args["unit"].as_str().unwrap_or(""),
                p,
                args["maxGap"].as_i64().unwrap_or(3600000),
            )?;
        }
        Ok(ImportReport {
            imported: count,
            ..Default::default()
        })
    }

    pub fn import_manual_fluxes(&self, args: Value) -> Result<ImportReport> {
        let path = args["path"]
            .as_str()
            .ok_or_else(|| Error::Invalid("path required".into()))?;
        let (_, rows) = read_table(path, args["sheet"].as_str())?;
        let h = args["headerRow"].as_u64().unwrap_or(0) as usize;
        let headers = rows
            .get(h)
            .ok_or_else(|| Error::Invalid("missing headers".into()))?;
        let col =
            |key: &str, default: &str| column(headers, args.get(key).unwrap_or(&json!(default)));
        let tc = col("timeColumn", "date")
            .ok_or_else(|| Error::Invalid("date column missing".into()))?;
        let pc =
            col("plotColumn", "nr").ok_or_else(|| Error::Invalid("plot column missing".into()))?;
        let cfg = self.get_config()?;
        let layout = self.get_layout()?;
        let mut report = ImportReport::default();
        for values in rows.iter().skip(h + 1) {
            let Some(time) = values.get(tc).and_then(|v| parse_time(v, &cfg.time_zone)) else {
                report.skipped += 1;
                continue;
            };
            let plot = values.get(pc).and_then(number).map(|n| n as i64);
            let p = layout.plots.iter().find(|p| p["id"].as_i64() == plot);
            let row = json!({"id":0,"measurementId":null,"source":"manual","time":time+43200000,"filename":null,"side":null,"plotId":plot,"plotLabel":p.map(|p|p["label"].clone()),"treatmentId":p.map(|p|p["treatmentId"].clone()),"treatmentName":null,"excluded":false,"reviewed":false,"overridden":false,"note":"","airTemp":null,"precip":null});
            let mut row: FluxRow = serde_json::from_value(row)?;
            for (gas, col) in [("N2O", "N2O_N_mug_m2h"), ("CO2", "CO2_C_mug_m2h")] {
                if let Some(i) = column(headers, &json!(col)) {
                    row.insert(format!("{gas}_flux"), json!(values.get(i).and_then(number)));
                }
            }
            self.db()?.execute(
                "INSERT INTO fluxes(row,results) VALUES(?1,'{}')",
                [serde_json::to_string(&row)?],
            )?;
            let id = self.db()?.last_insert_rowid();
            row.insert("id".into(), json!(id));
            self.write_row(id, &row)?;
            report.imported += 1;
        }
        Ok(report)
    }

    pub fn metno_fetch(&self, args: Value, progress: impl Fn(Progress)) -> Result<()> {
        let id = self
            .client_id
            .as_deref()
            .ok_or_else(|| Error::Invalid("met.no client ID required".into()))?;
        let mut from = args["from"]
            .as_i64()
            .ok_or_else(|| Error::Invalid("from required".into()))?;
        let to = args["to"]
            .as_i64()
            .ok_or_else(|| Error::Invalid("to required".into()))?;
        let client = reqwest::blocking::Client::new();
        let mut series: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        let total = ((to - from).max(0) as usize).div_ceil(8640000000);
        let mut done = 0;
        while from < to {
            let end = (from + 8640000000).min(to);
            let fmt = |t| {
                chrono::DateTime::from_timestamp_millis(t)
                    .map(|t| t.to_rfc3339())
                    .ok_or_else(|| Error::Invalid("time outside range".into()))
            };
            let range = format!("{}/{}", fmt(from)?, fmt(end)?);
            let response:Value=client.get("https://frost.met.no/observations/v0.jsonld").basic_auth(id,Some("")).query(&[("sources",args["station"].as_str().unwrap_or("SN17850")),("elements","air_temperature,max(air_temperature PT1H),min(air_temperature PT1H),sum(precipitation_amount PT1H)"),("referencetime",&range)]).send().and_then(|r|r.error_for_status()).and_then(|r|r.json()).map_err(|e|Error::Invalid(e.to_string()))?;
            for r in response["data"].as_array().unwrap_or(&vec![]) {
                if let Some(t) = parse_time(&r["referenceTime"], "UTC") {
                    for ob in r["observations"].as_array().unwrap_or(&vec![]) {
                        if let Some(key) = ob["elementId"].as_str() {
                            series
                                .entry(key.into())
                                .or_default()
                                .push(json!({"time":t,"value":ob["value"]}));
                        }
                    }
                }
            }
            from = end;
            done += 1;
            progress(Progress {
                task: "metnoFetch".into(),
                done,
                total,
                message: None,
            });
        }
        for (name, p) in series {
            self.store_series(&name, "", p, 3600000)?;
        }
        self.recompute_all(|_| {})
    }

    pub fn treatment_summary(&self, q: SummaryQuery) -> Result<Value> {
        let rows: Vec<_> = self
            .rows()?
            .into_iter()
            .filter(|r| {
                r["excluded"] != true
                    && r["time"].as_i64().is_some_and(|t| {
                        q.from.is_none_or(|f| t >= f) && q.to.is_none_or(|f| t <= f)
                    })
                    && q.sources.iter().any(|s| r["source"] == *s)
                    && q.flux_ids
                        .as_ref()
                        .is_none_or(|ids| ids.contains(&r["id"].as_i64().unwrap_or(0)))
            })
            .collect();
        let cfg = self.get_config()?;
        let tz: chrono_tz::Tz = cfg
            .time_zone
            .parse()
            .map_err(|_| Error::Invalid("time zone".into()))?;
        let key = format!("{}_flux", q.gas);
        let mut groups: BTreeMap<i64, Vec<&FluxRow>> = BTreeMap::new();
        for r in &rows {
            if let Some(id) = r["plotId"].as_i64() {
                if r.get(&key).and_then(number).is_some() {
                    groups.entry(id).or_default().push(r);
                }
            }
        }
        let mut plots = vec![];
        for (id, rows) in groups {
            let mut days: BTreeMap<i64, Vec<f64>> = BTreeMap::new();
            let mut points = vec![];
            for r in &rows {
                let time = r["time"].as_i64().unwrap_or(0);
                let value = r[&key].as_f64().unwrap_or(0.);
                let date = chrono::DateTime::from_timestamp_millis(time)
                    .ok_or_else(|| Error::Invalid("time".into()))?
                    .with_timezone(&tz)
                    .date_naive();
                let day = chrono::TimeZone::from_local_datetime(
                    &tz,
                    &date
                        .and_hms_opt(0, 0, 0)
                        .ok_or_else(|| Error::Invalid("day".into()))?,
                )
                .earliest()
                .ok_or_else(|| Error::Invalid("day".into()))?
                .timestamp_millis();
                days.entry(day).or_default().push(value);
                points.push(json!({"fluxId":r["id"],"time":time,"value":value}));
            }
            let mut cumulative = 0.;
            let mut previous = None;
            let mut daily = vec![];
            for (time, v) in days {
                let mean = mean(&v);
                if let Some((t, m)) = previous {
                    cumulative += (time - t) as f64 / 3600000. * (m + mean) * 0.5 * 1e-5;
                }
                daily.push(json!({"time":time,"mean":mean,"cumulative":cumulative}));
                previous = Some((time, mean));
            }
            plots.push(json!({"plotId":id,"label":rows[0]["plotLabel"],"treatmentId":rows[0]["treatmentId"],"total":cumulative,"points":points,"daily":daily}));
        }
        let mut treatments = vec![];
        for t in self.get_layout()?.treatments {
            let ps: Vec<_> = plots
                .iter()
                .filter(|p| p["treatmentId"] == t["id"])
                .collect();
            if ps.is_empty() {
                continue;
            }
            let totals: Vec<f64> = ps.iter().filter_map(|p| p["total"].as_f64()).collect();
            let logs: Vec<f64> = rows
                .iter()
                .filter(|r| r["treatmentId"] == t["id"])
                .filter_map(|r| r.get(&key).and_then(number))
                .filter(|v| *v > 0.)
                .map(f64::ln)
                .collect();
            let mut days: BTreeMap<i64, Vec<f64>> = BTreeMap::new();
            for p in &ps {
                for d in p["daily"].as_array().unwrap_or(&vec![]) {
                    days.entry(d["time"].as_i64().unwrap_or(0))
                        .or_default()
                        .push(d["mean"].as_f64().unwrap_or(0.));
                }
            }
            let mut box_values: Vec<f64> = days.values().map(|v| mean(v)).collect();
            box_values.sort_by(f64::total_cmp);
            let quantile = |p: f64| {
                let i = p * (box_values.len() - 1) as f64;
                let a = i.floor() as usize;
                let b = i.ceil() as usize;
                box_values[a] + (box_values[b] - box_values[a]) * (i - a as f64)
            };
            treatments.push(json!({"id":t["id"],"name":t["name"],"colour":t["colour"],"nPlots":ps.len(),"mean":mean(&totals),"sd":sd(&totals,0),"gmean":mean(&logs).exp(),"gsd":sd(&logs,1).exp(),"box":[quantile(0.),quantile(0.25),quantile(0.5),quantile(0.75),quantile(1.)]}));
        }
        Ok(
            json!({"gas":q.gas,"unit":"µg m?² h?¹","cumulativeUnit":"kg ha?¹","treatments":treatments,"plots":plots}),
        )
    }

    pub fn export_csv(&self, args: ExportArgs) -> Result<()> {
        let rows = self.export_rows(&args)?;
        let mut writer =
            csv::Writer::from_path(&args.path).map_err(|e| Error::Invalid(e.to_string()))?;
        writer
            .write_record(&args.columns)
            .map_err(|e| Error::Invalid(e.to_string()))?;
        for r in rows {
            writer
                .write_record(
                    args.columns
                        .iter()
                        .map(|k| cell_text(r.get(k).unwrap_or(&Value::Null))),
                )
                .map_err(|e| Error::Invalid(e.to_string()))?;
        }
        writer.flush()?;
        Ok(())
    }

    fn export_rows(&self, args: &ExportArgs) -> Result<Vec<FluxRow>> {
        Ok(self
            .rows()?
            .into_iter()
            .filter(|r| args.flux_ids.contains(&r["id"].as_i64().unwrap_or(0)))
            .collect())
    }

    pub fn export_xlsx(&self, args: ExportArgs) -> Result<()> {
        let rows = self.export_rows(&args)?;
        let mut groups: BTreeMap<String, Vec<FluxRow>> = BTreeMap::new();
        for r in rows {
            let key = if args.mode == "flat" {
                "All Data".into()
            } else {
                format!("Plot {}", cell_text(&r["plotId"]))
            };
            groups.entry(key).or_default().push(r);
        }
        if groups.is_empty() {
            groups.insert("All Data".into(), vec![]);
        }
        let mut book = rust_xlsxwriter::Workbook::new();
        let err = |e: rust_xlsxwriter::XlsxError| Error::Invalid(e.to_string());
        for (name, mut rows) in groups {
            if args.mode == "dailyPerPlot" {
                let mut days: BTreeMap<i64, Vec<FluxRow>> = BTreeMap::new();
                for r in rows {
                    days.entry(r["time"].as_i64().unwrap_or(0).div_euclid(86400000) * 86400000)
                        .or_default()
                        .push(r);
                }
                rows = days
                    .into_iter()
                    .map(|(day, rs)| {
                        let mut row = rs[0].clone();
                        row.insert("time".into(), json!(day));
                        for k in &args.columns {
                            let vs: Vec<f64> = rs
                                .iter()
                                .filter_map(|r| r.get(k).and_then(number))
                                .collect();
                            if !vs.is_empty() && k != "time" {
                                row.insert(k.clone(), json!(mean(&vs)));
                            }
                        }
                        row
                    })
                    .collect();
            }
            let sheet = book.add_worksheet();
            sheet.set_name(&name).map_err(err)?;
            for (i, k) in args.columns.iter().enumerate() {
                sheet.write_string(0, i as u16, k).map_err(err)?;
                for (j, r) in rows.iter().enumerate() {
                    let v = r.get(k).unwrap_or(&Value::Null);
                    if let Some(n) = v.as_f64() {
                        sheet.write_number(j as u32 + 1, i as u16, n).map_err(err)?;
                    } else if !v.is_null() {
                        sheet
                            .write_string(j as u32 + 1, i as u16, cell_text(v))
                            .map_err(err)?;
                    }
                }
            }
        }
        book.save(&args.path).map_err(err)?;
        Ok(())
    }
}

fn mean(v: &[f64]) -> f64 {
    if v.is_empty() {
        f64::NAN
    } else {
        v.iter().sum::<f64>() / v.len() as f64
    }
}

fn sd(v: &[f64], ddof: usize) -> f64 {
    let m = mean(v);
    if v.len() <= ddof {
        f64::NAN
    } else {
        (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (v.len() - ddof) as f64).sqrt()
    }
}

fn cell_text(v: &Value) -> String {
    if v.is_null() {
        String::new()
    } else {
        v.as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| v.to_string())
    }
}

fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|v| v.is_finite())
}

fn column(headers: &[Value], v: &Value) -> Option<usize> {
    v.as_u64()
        .map(|i| i as usize)
        .or_else(|| headers.iter().position(|h| h == v))
}

fn parse_time(v: &Value, zone: &str) -> Option<i64> {
    if let Some(n) = v.as_f64() {
        return Some(if n.abs() < 100000. {
            ((n - 25569.) * 86400000.) as i64
        } else if n.abs() < 1e11 {
            (n * 1000.) as i64
        } else {
            n as i64
        });
    }
    let s = v.as_str()?;
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp_millis());
    }
    let tz: chrono_tz::Tz = zone.parse().ok()?;
    for fmt in [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%d.%m.%Y %H:%M:%S",
        "%Y-%m-%d",
    ] {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return chrono::TimeZone::from_local_datetime(&tz, &dt)
                .earliest()
                .map(|d| d.timestamp_millis());
        }
        if let Ok(date) = chrono::NaiveDate::parse_from_str(s, fmt) {
            return chrono::TimeZone::from_local_datetime(&tz, &date.and_hms_opt(0, 0, 0)?)
                .earliest()
                .map(|d| d.timestamp_millis());
        }
    }
    None
}

fn read_table(path: &str, sheet: Option<&str>) -> Result<(Vec<String>, Vec<Vec<Value>>)> {
    use calamine::{Data, Reader};
    if path.to_lowercase().ends_with(".csv") {
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_path(path)
            .map_err(|e| Error::Invalid(e.to_string()))?;
        let rows = reader
            .records()
            .map(|r| {
                r.map(|r| {
                    r.iter()
                        .map(|s| s.parse::<f64>().map_or_else(|_| json!(s), |v| json!(v)))
                        .collect()
                })
                .map_err(|e| Error::Invalid(e.to_string()))
            })
            .collect::<Result<Vec<_>>>()?;
        return Ok((vec!["CSV".into()], rows));
    }
    let mut workbook =
        calamine::open_workbook_auto(path).map_err(|e| Error::Invalid(e.to_string()))?;
    let sheets = workbook.sheet_names().to_vec();
    let name = sheet
        .or_else(|| sheets.first().map(String::as_str))
        .ok_or_else(|| Error::Invalid("no sheets".into()))?;
    let range = workbook
        .worksheet_range(name)
        .map_err(|e| Error::Invalid(e.to_string()))?;
    let rows = range
        .rows()
        .map(|r| {
            r.iter()
                .map(|v| match v {
                    Data::Float(n) => json!(n),
                    Data::Int(n) => json!(n),
                    Data::Bool(b) => json!(b),
                    Data::DateTime(d) => json!(d.as_datetime().map(|d| d.to_string())),
                    Data::Empty => Value::Null,
                    _ => json!(v.to_string()),
                })
                .collect()
        })
        .collect();
    Ok((sheets, rows))
}

fn convert_options(v: &Value, base: &AnalysisOptions) -> Result<AnalysisOptions> {
    let mut out = serde_json::to_value(base)?;
    for (from, to) in [
        ("start", "start"),
        ("stop", "stop"),
        ("interval", "interval"),
        ("crit", "crit"),
        ("co2_guides", "co2Guides"),
        ("cut_beginnings", "cutBeginnings"),
        ("cut_ends", "cutEnds"),
        ("slope", "slope"),
    ] {
        if let Some(v) = v.get(from) {
            out[to] = v.clone();
        }
    }
    Ok(serde_json::from_value(out)?)
}

fn preset_layout(name: &str) -> Result<Layout> {
    let presets: Value = serde_json::from_str(include_str!("presets.json"))?;
    let p = &presets[name];
    let mut layout = Layout::default();
    if let Some(ts) = p["treatment_legend"].as_object() {
        for (id, t) in ts {
            let id: i64 = id.parse().map_err(|_| Error::Invalid("preset".into()))?;
            layout.treatments.push(json!({"id":id,"name":t["name"],"shortName":t["treatment"].as_str().unwrap_or(""),"colour":format!("#{:06x}",(id*2654435761_i64)&0xffffff),"sortOrder":id}));
            for plot in t["plots"].as_array().unwrap_or(&vec![]) {
                let id = plot.as_i64().unwrap_or(0);
                let polygon = if name == "capture" {
                    let row = (id - 1) / 6;
                    let col = (id - 1) % 6;
                    let x0 = col as f64 * 6.25;
                    let y0 = (5 - row) as f64 * 8.;
                    let angle = 0.4152_f64;
                    let pts: Vec<_> = [
                        (x0, y0),
                        (x0 + 6.25, y0),
                        (x0 + 6.25, y0 + 8.),
                        (x0, y0 + 8.),
                    ]
                    .into_iter()
                    .map(|(x, y)| {
                        json!([
                            x * angle.cos() - y * angle.sin() + 599201. + 15.2,
                            x * angle.sin() + y * angle.cos() + 6615259. - 2.55
                        ])
                    })
                    .collect();
                    json!(pts)
                } else {
                    Value::Null
                };
                layout.plots.push(json!({"id":id,"label":id.to_string(),"treatmentId":layout.treatments.last().map(|t|t["id"].clone()),"polygon":polygon,"waypoints":p["waypoints"].as_array().map(|w|w.iter().filter(|w|w["plotId"]==id).collect::<Vec<_>>())}));
            }
        }
    }
    Ok(layout)
}
