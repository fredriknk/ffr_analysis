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
    lag_cache: std::cell::RefCell<BTreeMap<(i64, u64), (f64, f64)>>,
    recent: Vec<Value>,
    client_id: Option<String>,
    series_cache: std::cell::RefCell<BTreeMap<i64, Vec<Value>>>,
    values_cache: std::cell::RefCell<BTreeMap<i64, Vec<(i64, f64)>>>,
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
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA application_id=1179013682; PRAGMA user_version=2; PRAGMA foreign_keys=ON;

 CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);

 CREATE TABLE measurements(id INTEGER PRIMARY KEY,filename TEXT UNIQUE NOT NULL,metadata TEXT NOT NULL,raw BLOB,status TEXT NOT NULL,error TEXT);

 CREATE TABLE fluxes(id INTEGER PRIMARY KEY,measurement_id INTEGER REFERENCES measurements(id),row TEXT NOT NULL,options TEXT,results TEXT NOT NULL);

 CREATE TABLE series(id INTEGER PRIMARY KEY,metadata TEXT NOT NULL,points TEXT NOT NULL);

 CREATE TABLE diagnostics(flux_id INTEGER PRIMARY KEY REFERENCES fluxes(id),findings TEXT NOT NULL);
 CREATE TABLE changes(id INTEGER PRIMARY KEY,time INTEGER NOT NULL,kind TEXT NOT NULL,before TEXT NOT NULL,after TEXT NOT NULL,target INTEGER,action TEXT NOT NULL,original INTEGER);")?;

        db.execute("INSERT INTO meta VALUES ('name',?1)", [name])?;
        db.execute(
            "INSERT INTO meta VALUES ('config',?1)",
            [serde_json::to_string(&ProjectConfig::default())?],
        )?;
        db.execute(
            "INSERT INTO meta VALUES ('layout',?1)",
            [serde_json::to_string(&StoredLayout::default())?],
        )?;
        self.lag_cache.borrow_mut().clear();
        self.series_cache.borrow_mut().clear();
        self.values_cache.borrow_mut().clear();
        self.db = Some(db);
        self.path = path.into();
        self.project_info()?
            .ok_or_else(|| Error::Invalid("project creation failed".into()))
    }

    pub fn project_open(&mut self, path: &str) -> Result<ProjectInfo> {
        let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        let app: i64 = db.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        let version: u32 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if app != 1179013682 || !(1..=2).contains(&version) {
            return Err(Error::Invalid(
                "unsupported project or schema version".into(),
            ));
        }
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;")?;
        self.lag_cache.borrow_mut().clear();
        self.series_cache.borrow_mut().clear();
        self.values_cache.borrow_mut().clear();
        self.db = Some(db);
        self.path = path.into();
        if version == 1 {
            let tx = self.db()?.unchecked_transaction()?;
            self.db()?.execute_batch("CREATE TABLE IF NOT EXISTS diagnostics(flux_id INTEGER PRIMARY KEY REFERENCES fluxes(id),findings TEXT NOT NULL);")?;
            self.recompute_all(|_| {})?;
            self.db()?.execute_batch("PRAGMA user_version=2;")?;
            tx.commit()?;
        }
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
            schema_version: 2,
            counts: Counts {
                measurements: db
                    .query_row("SELECT count(*) FROM measurements", [], |r| r.get(0))?,
                fluxes: rows.len(),
                excluded: count("excluded"),
                overridden: count("overridden"),
                reviewed: count("reviewed"),
                manual: rows.iter().filter(|r| r["source"] == "manual").count(),
                series: self.series_value()?.len(),
            },
            time_range: times
                .iter()
                .min()
                .zip(times.iter().max())
                .map(|(a, b)| [*a, *b]),
        }))
    }

    pub fn recent_projects(&self) -> Vec<RecentProject> {
        self.recent
            .iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect()
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
        let mut cfg: ProjectConfig = self.meta("config")?;
        cfg.name = self
            .db()?
            .query_row("SELECT value FROM meta WHERE key='name'", [], |r| r.get(0))?;
        Ok(cfg)
    }

    fn layout_value(&self) -> Result<StoredLayout> {
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

    pub fn set_config(&self, mut cfg: ProjectConfig, progress: impl Fn(Progress)) -> Result<()> {
        let _: chrono_tz::Tz = cfg
            .time_zone
            .parse()
            .map_err(|_| Error::Invalid("invalid time zone".into()))?;
        let tx = self.db()?.unchecked_transaction()?;
        cfg.defaults.validate()?;
        cfg.diagnostics.validate()?;
        if !(0. ..=1.).contains(&cfg.qc_threshold) {
            return Err(Error::Invalid(
                "QC probability threshold must be between zero and one".into(),
            ));
        }
        cfg.qc.p_value = cfg.qc_threshold;
        if cfg.pressure <= 0. || cfg.chamber_height <= 0. {
            return Err(Error::Invalid(
                "pressure and chamber height must be positive".into(),
            ));
        }
        if self.get_config()?.time_zone != cfg.time_zone {
            let mut query = self
                .db()?
                .prepare("SELECT id,filename FROM measurements WHERE status='ok'")?;
            let measurements = query
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for (id, name) in measurements {
                let metadata = raw::filename(&name, &cfg.time_zone)?;
                self.db()?.execute(
                    "UPDATE measurements SET metadata=?2 WHERE id=?1",
                    params![id, serde_json::to_string(&metadata)?],
                )?;
            }
        }
        self.edit_meta("config", &cfg)?;
        self.db()?
            .execute("UPDATE meta SET value=?1 WHERE key='name'", [&cfg.name])?;
        self.recompute_all(progress)?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_layout(&self, layout: Layout, progress: impl Fn(Progress)) -> Result<()> {
        let tx = self.db()?.unchecked_transaction()?;
        let old = self.layout_value()?;
        let mut stored = serde_json::to_value(&layout)?;
        if let Some(plots) = stored["plots"].as_array_mut() {
            for p in plots {
                if let Some(existing) = old.plots.iter().find(|v| v["id"] == p["id"]) {
                    if let Some(w) = existing.get("waypoints") {
                        p["waypoints"] = w.clone();
                    }
                }
            }
        }
        self.edit_meta("layout", &stored)?;
        self.recompute_all(progress)?;
        tx.commit()?;
        Ok(())
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

    fn join_rows(&self, rows: &mut [FluxRow]) -> Result<()> {
        let layout = self.layout_value()?;
        for row in rows.iter_mut() {
            if let Some(plot) = layout.plots.iter().find(|p| p["id"] == row["plotId"]) {
                row.insert("plotLabel".into(), plot["label"].clone());
                row.insert("treatmentId".into(), plot["treatmentId"].clone());
                if let Some(t) = layout
                    .treatments
                    .iter()
                    .find(|t| t["id"] == plot["treatmentId"])
                {
                    row.insert("treatmentName".into(), t["name"].clone());
                }
            }
        }
        for meta in self.series_value()? {
            let id = meta["id"].as_i64().unwrap_or(0);
            let name = meta["name"].as_str().unwrap_or("");
            self.cached_values(id)?;
            let cache = self.values_cache.borrow();
            let points = cache.get(&id).map(Vec::as_slice).unwrap_or(&[]);
            for row in rows.iter_mut() {
                if let Some(time) = row["time"].as_i64() {
                    let i = points.partition_point(|p| p.0 < time);
                    let value = [i.saturating_sub(1), i]
                        .into_iter()
                        .filter_map(|i| points.get(i))
                        .min_by_key(|p| (p.0 - time).abs())
                        .filter(|p| {
                            (p.0 - time).abs() <= meta["maxGap"].as_i64().unwrap_or(3600000)
                        })
                        .map(|p| p.1);
                    row.insert(name.into(), json!(value));
                }
            }
        }
        Ok(())
    }
    pub fn list_fluxes(&self) -> Result<FluxTable> {
        let mut rows = self.rows()?;
        self.join_rows(&mut rows)?;
        let mut keys: BTreeMap<String, String> = BTreeMap::new();
        for (key, kind) in [
            ("attention", "number"),
            ("diag", "string"),
            ("valveLagS", "number"),
            ("id", "number"),
            ("measurementId", "number"),
            ("source", "category"),
            ("time", "time"),
            ("filename", "string"),
            ("side", "category"),
            ("plotId", "category"),
            ("plotLabel", "category"),
            ("treatmentId", "category"),
            ("treatmentName", "category"),
            ("excluded", "boolean"),
            ("reviewed", "boolean"),
            ("overridden", "boolean"),
            ("note", "string"),
            ("airTemp", "number"),
            ("precip", "number"),
            ("N2O_qc", "category"),
        ] {
            keys.insert(key.into(), kind.into());
        }
        for gas in regression::GASES {
            for suffix in ["slope", "rsq", "pval", "flux", "n", "resid"] {
                keys.insert(format!("{gas}_{suffix}"), "number".into());
            }
        }
        for series in self.series_value()? {
            if let Some(name) = series["name"].as_str() {
                keys.insert(name.into(), "number".into());
            }
        }
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
        let mut row = self.row(id)?;
        self.join_rows(std::slice::from_mut(&mut row))?;
        let (stored, overridden) = self.options(id)?;
        let is_preview = preview.is_some();
        let options = preview.unwrap_or(stored);
        let Some(mid) = row["measurementId"].as_i64() else {
            return Ok(
                json!({"flux":row,"options":options,"isOverridden":overridden,"siblingFluxId":null,"switches":[],"traces":[],"regressions":[],"sibling":[],"diagnostics":[],"valveLagS":0.}),
            );
        };
        let raw = match self.measurement(mid) {
            Ok(raw) => raw,
            Err(_) => {
                return Ok(
                    json!({"flux":row,"options":options,"isOverridden":overridden,"siblingFluxId":null,"switches":[],"traces":[],"regressions":[],"sibling":[],"diagnostics":self.load_findings(id)?,"valveLagS":0.}),
                )
            }
        };
        let side = if row["side"] == "left" { 1 } else { 2 };
        let temp = row["airTemp"].as_f64().unwrap_or(20.);
        let mut results = regression::compute(
            &raw,
            side,
            &json!({}),
            &regression::legacy_options(&options),
            temp,
        )?;
        let cfg = self.get_config()?;
        for r in results.values_mut() {
            r.flux *= cfg.pressure / 101000. * cfg.chamber_height / 0.5;
            if r.gas == "N2O" {
                r.qc = regression::qc_with(r, side, &cfg.qc);
            }
        }
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
                let sides = raw::group_indices(
                    t,
                    &crate::diagnostics::shifted(&raw, options.valve_offset),
                    options.cut_beginnings,
                    options.cut_ends,
                );
                let indices: Vec<usize> =
                    raw::group_ranges(t, &raw.switches, options.cut_beginnings, options.cut_ends)
                        .into_iter()
                        .filter(|(_, _, s)| *s == side)
                        .flat_map(|(a, b, _)| a..b)
                        .filter(|i| y[*i] != 0.)
                        .collect();
                let x: Vec<f64> = indices.iter().map(|i| t[*i]).collect();
                let mut used = vec![false; t.len()];
                if let Some(r) = results.get(gas) {
                    if !x.is_empty() && r.n > 0 {
                        let a = regression::nearest(&x, r.start);
                        let b = regression::nearest(&x, r.stop);
                        if a < b {
                            for i in &indices[a..b] {
                                used[*i] = true;
                            }
                        }
                    }
                }
                let fit: Vec<Option<f64>> = t
                    .iter()
                    .zip(&used)
                    .map(|(t, used)| {
                        if *used {
                            results.get(gas).map(|r| r.intercept + r.slope * t)
                        } else {
                            None
                        }
                    })
                    .collect();
                traces.push(
                    json!({"gas":gas,"unit":"ppm","t":t,"y":y,"side":sides,"used":used,"fit":fit}),
                );
            }
        }
        let sibling_results: Value = sibling
            .as_ref()
            .map(|(_, s)| serde_json::from_str(s))
            .transpose()?
            .unwrap_or(json!({}));
        let lag = self.cached_lag(&raw, &options, &cfg.diagnostics)?;
        let mut diagnostics =
            crate::diagnostics::analyse(&raw, side, &options, &results, &cfg.diagnostics, lag)
                .diagnostics;
        for d in self.load_findings(id)? {
            if ["temp_fallback", "no_plot"].contains(&d.code.as_str())
                || (!is_preview && d.code == "neighbour_outlier")
            {
                diagnostics.push(d);
            }
        }
        for (gas, r) in &results {
            for (key, v) in [
                ("slope", r.slope),
                ("rsq", r.rsq),
                ("pval", r.pval),
                ("flux", r.flux),
                ("n", r.n as f64),
                ("resid", r.mse.sqrt()),
            ] {
                row.insert(format!("{gas}_{key}"), json!(v));
            }
        }
        crate::diagnostics::decorate(&mut row, &mut diagnostics, lag.0 + options.valve_offset);
        Ok(
            json!({"diagnostics":diagnostics,"valveLagS":lag.0+options.valve_offset,"flux":row,"options":options,"isOverridden":overridden,"siblingFluxId":sibling.as_ref().map(|s|s.0),"switches":raw.switches.iter().map(|(t,s)|json!({"t":t,"side":if *s==1{"left"}else{"right"}})).collect::<Vec<_>>(),"traces":traces,"regressions":results.values().collect::<Vec<_>>(),"sibling":sibling_results.as_object().map(|m|m.values().collect::<Vec<_>>()).unwrap_or_default()}),
        )
    }

    pub fn get_flux_detail(&self, id: i64) -> Result<FluxDetail> {
        Ok(serde_json::from_value(self.detail(id, None)?)?)
    }

    pub fn preview_flux(&self, id: i64, options: AnalysisOptions) -> Result<FluxDetail> {
        options.validate()?;
        Ok(serde_json::from_value(self.detail(id, Some(options))?)?)
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
        if let Some(o) = &options {
            o.validate()?;
        }
        let tx = self.db()?.unchecked_transaction()?;
        let mut before = vec![];
        let mut after = vec![];
        let mut out = vec![];
        for id in ids {
            let old: Option<String> =
                self.db()?
                    .query_row("SELECT options FROM fluxes WHERE id=?1", [id], |r| r.get(0))?;
            before.push(json!({"id":id,"options":old.map(|s|serde_json::from_str::<Value>(&s)).transpose()?.unwrap_or(Value::Null)}));
            after.push(json!({"id":id,"options":options}));
            self.db()?.execute(
                "UPDATE fluxes SET options=?2 WHERE id=?1",
                params![id, options.as_ref().map(serde_json::to_string).transpose()?],
            )?;
            self.recompute_one(*id)?;
            out.push(self.row(*id)?);
        }
        self.neighbour_pass()?;
        self.log(
            "optionsBatch",
            None,
            &json!(before),
            &json!(after),
            "edit",
            None,
        )?;
        tx.commit()?;
        Ok(out)
    }
    pub fn set_flux_flags(&self, ids: &[i64], flags: Value) -> Result<Vec<FluxRow>> {
        let tx = self.db()?.unchecked_transaction()?;
        let mut before = vec![];
        let mut after = vec![];
        let mut out = vec![];
        for id in ids {
            let mut row = self.row(*id)?;
            before.push(serde_json::to_value(&row)?);
            for key in ["excluded", "reviewed", "note", "plotOverride"] {
                if let Some(v) = flags.get(key) {
                    row.insert(key.into(), v.clone());
                }
            }
            after.push(serde_json::to_value(&row)?);
            self.write_row(*id, &row)?;
            self.recompute_one(*id)?;
            out.push(self.row(*id)?);
        }
        self.neighbour_pass()?;
        self.log(
            "flagsBatch",
            None,
            &json!(before),
            &json!(after),
            "edit",
            None,
        )?;
        tx.commit()?;
        Ok(out)
    }
    fn write_row(&self, id: i64, row: &FluxRow) -> Result<()> {
        self.db()?.execute(
            "UPDATE fluxes SET row=?2 WHERE id=?1",
            params![id, serde_json::to_string(row)?],
        )?;
        Ok(())
    }

    fn cached_values(&self, id: i64) -> Result<()> {
        if !self.values_cache.borrow().contains_key(&id) {
            let data = self.series_data_value(&[id], None, None, None)?;
            let points = data[0]["points"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|p| Some((p["time"].as_i64()?, p["value"].as_f64()?)))
                .collect();
            self.values_cache.borrow_mut().insert(id, points);
        }
        Ok(())
    }
    fn weather(&self, time: i64, key: &str) -> Result<Option<f64>> {
        for s in self.series_value()? {
            if s["name"] == key {
                let id = s["id"].as_i64().unwrap_or(0);
                self.cached_values(id)?;
                return Ok(self
                    .values_cache
                    .borrow()
                    .get(&id)
                    .and_then(|p| interpolate(p, time)));
            }
        }
        Ok(None)
    }
    fn recompute_one(&self, id: i64) -> Result<()> {
        let mut row = self.row(id)?;
        let Some(mid) = row["measurementId"].as_i64() else {
            return Ok(());
        };
        let raw = match self.measurement(mid) {
            Ok(raw) => raw,
            Err(e) => {
                self.save_error_row(id, row, &e.to_string())?;
                return Ok(());
            }
        };
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
        self.persist_result(id, row, &raw, &cfg, overridden, (results, None))
    }
    fn persist_result(
        &self,
        id: i64,
        mut row: FluxRow,
        raw: &Raw,
        cfg: &ProjectConfig,
        overridden: bool,
        computation: (
            BTreeMap<String, crate::regression::Regression>,
            Option<crate::diagnostics::Findings>,
        ),
    ) -> Result<()> {
        let (mut results, findings) = computation;
        row.insert("time".into(), json!(raw.metadata.time));
        let side = if row["side"] == "left" { 1 } else { 2 };
        let factor = cfg.pressure / 101000. * cfg.chamber_height / 0.5;
        for r in results.values_mut() {
            r.flux *= factor;
            if r.gas == "N2O" {
                r.qc = regression::qc_with(r, side, &cfg.qc);
            }
        }
        let layout = self.layout_value()?;
        assign(&mut row, &raw.metadata, side, cfg, &layout);
        row.insert("overridden".into(), json!(overridden));
        for gas in regression::GASES {
            for suffix in ["slope", "rsq", "pval", "flux", "n", "resid"] {
                row.insert(format!("{gas}_{suffix}"), Value::Null);
            }
        }
        for (gas, r) in &results {
            for (key, v) in [
                ("slope", r.slope),
                ("rsq", r.rsq),
                ("pval", r.pval),
                ("flux", r.flux),
                ("n", r.n as f64),
                ("resid", r.mse.sqrt()),
            ] {
                row.insert(format!("{gas}_{key}"), json!(v));
            }
            if gas == "N2O" {
                row.insert("N2O_qc".into(), json!(r.qc));
            }
        }
        for s in self.series_value()? {
            if let (Some(name), Some(sid)) = (s["name"].as_str(), s["id"].as_i64()) {
                self.cached_values(sid)?;
                let cache = self.values_cache.borrow();
                let points = cache.get(&sid).map(Vec::as_slice).unwrap_or(&[]);
                let i = points.partition_point(|(t, _)| *t < raw.metadata.time);
                let nearest = [i.saturating_sub(1), i]
                    .into_iter()
                    .filter_map(|i| points.get(i))
                    .min_by_key(|(t, _)| (t - raw.metadata.time).abs());
                let value = nearest
                    .filter(|(t, _)| {
                        (t - raw.metadata.time).abs() <= s["maxGap"].as_i64().unwrap_or(3600000)
                    })
                    .map(|p| p.1);
                row.insert(name.into(), json!(value));
            }
        }
        let (opts, _) = self.options(id)?;
        let mut findings = match findings {
            Some(d) => d,
            None => {
                let lag = self.cached_lag(raw, &opts, &cfg.diagnostics)?;
                crate::diagnostics::analyse(raw, side, &opts, &results, &cfg.diagnostics, lag)
            }
        };
        if row["temperatureFallback"] == true {
            findings.diagnostics.push(crate::diagnostics::Diagnostic {
                code: "temp_fallback".into(),
                severity: "info".into(),
                gas: None,
                value: None,
                message: "No air temperature; fallback temperature used.".into(),
            });
        }
        if row["plotId"].is_null() || row["plotId"] == 0 {
            findings.diagnostics.push(crate::diagnostics::Diagnostic {
                code: "no_plot".into(),
                severity: "info".into(),
                gas: None,
                value: None,
                message: "Chamber position belongs to no plot.".into(),
            });
        }
        findings.valve_lag_s += opts.valve_offset;
        crate::diagnostics::decorate(&mut row, &mut findings.diagnostics, findings.valve_lag_s);
        row.insert("valveImprovement".into(), json!(findings.valve_improvement));
        self.save_findings(id, &findings.diagnostics)?;
        self.write_row(id, &row)?;
        self.db()?.execute(
            "UPDATE fluxes SET results=?2 WHERE id=?1",
            params![id, serde_json::to_string(&results)?],
        )?;
        Ok(())
    }

    pub fn recompute_all(&self, progress: impl Fn(Progress)) -> Result<()> {
        let tx = if self.db()?.is_autocommit() {
            Some(self.db()?.unchecked_transaction()?)
        } else {
            None
        };
        self.lag_cache.borrow_mut().clear();
        let cfg = self.get_config()?;
        let mut jobs = vec![];
        for mut row in self.rows()? {
            let Some(mid) = row["measurementId"].as_i64() else {
                continue;
            };
            let id = row["id"].as_i64().unwrap_or(0);
            let raw = match self.measurement(mid) {
                Ok(raw) => raw,
                Err(e) => {
                    self.save_error_row(id, row, &e.to_string())?;
                    continue;
                }
            };
            let (opts, overridden) = self.options(id)?;
            let temp = self.weather(raw.metadata.time, "air_temperature")?;
            row.insert(
                "airTemp".into(),
                json!(temp.unwrap_or(cfg.fallback_temperature)),
            );
            row.insert("temperatureFallback".into(), json!(temp.is_none()));
            row.insert(
                "precip".into(),
                json!(self
                    .weather(raw.metadata.time, "sum(precipitation_amount PT1H)")?
                    .unwrap_or(0.)),
            );
            let side = if row["side"] == "left" { 1 } else { 2 };
            jobs.push((
                id,
                row,
                raw,
                side,
                opts,
                overridden,
                temp.unwrap_or(cfg.fallback_temperature),
            ));
        }
        let results: Vec<_> = jobs
            .par_iter()
            .map(|(_, _, raw, side, opts, _, temp)| {
                let results = regression::compute(
                    raw,
                    *side,
                    &json!({}),
                    &regression::legacy_options(opts),
                    *temp,
                )?;
                let lag = crate::diagnostics::valve_lag(raw, opts, &cfg.diagnostics);
                let diagnostics =
                    crate::diagnostics::analyse(raw, *side, opts, &results, &cfg.diagnostics, lag);
                Ok::<_, Error>((results, Some(diagnostics)))
            })
            .collect();
        let total = jobs.len();
        for (i, ((id, row, raw, _side, _, overridden, _), result)) in
            jobs.into_iter().zip(results).enumerate()
        {
            self.persist_result(id, row, &raw, &cfg, overridden, result?)?;
            progress(Progress {
                task: "recomputeAll".into(),
                done: i + 1,
                total,
                message: None,
            });
        }
        self.neighbour_pass()?;
        if let Some(tx) = tx {
            tx.commit()?;
        }
        Ok(())
    }

    pub fn import_raw_files(
        &self,
        paths: &[String],
        progress: impl Fn(Progress),
    ) -> Result<ImportReport> {
        self.import_raw_impl(paths, progress, true)
    }
    fn import_raw_impl(
        &self,
        paths: &[String],
        progress: impl Fn(Progress),
        compute: bool,
    ) -> Result<ImportReport> {
        let cfg = self.get_config()?;
        progress(Progress {
            task: "importRawFiles".into(),
            done: 0,
            total: paths.len(),
            message: Some("Reading raw files".into()),
        });
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
                    report.errors.push(ImportError {
                        path: name.clone(),
                        message: e.to_string(),
                    });
                    let metadata = raw::filename(&name, &cfg.time_zone)
                        .ok()
                        .map(|m| serde_json::to_string(&m))
                        .transpose()?
                        .unwrap_or_else(|| "{}".into());
                    db.execute("INSERT INTO measurements(filename,metadata,status,error) VALUES(?1,?2,'error',?3)",params![name,metadata,e.to_string()])?;
                    let mid = db.last_insert_rowid();
                    let meta: Value = serde_json::from_str(&metadata)?;
                    for side in ["left", "right"] {
                        let mut row: FluxRow = serde_json::from_value(
                            json!({"id":0,"measurementId":mid,"source":"robot","time":meta["time"],"filename":name,"side":side,"plotId":null,"plotLabel":null,"treatmentId":null,"treatmentName":null,"excluded":false,"reviewed":false,"overridden":false,"note":"","airTemp":null,"precip":null,"x":meta["x"],"y":meta["y"]}),
                        )?;
                        db.execute(
                            "INSERT INTO fluxes(measurement_id,row,results) VALUES(?1,?2,'{}')",
                            params![mid, serde_json::to_string(&row)?],
                        )?;
                        let id = db.last_insert_rowid();
                        row.insert("id".into(), json!(id));
                        let mut findings = vec![crate::diagnostics::Diagnostic {
                            code: "error".into(),
                            severity: "bad".into(),
                            gas: None,
                            value: None,
                            message: e.to_string(),
                        }];
                        crate::diagnostics::decorate(&mut row, &mut findings, 0.);
                        self.save_findings(id, &findings)?;
                        self.write_row(id, &row)?;
                    }
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
                        if compute {
                            if let Err(e) = self.recompute_one(id) {
                                report.errors.push(ImportError {
                                    path: name.clone(),
                                    message: format!("{side}: {e}"),
                                });
                            }
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

    fn series_value(&self) -> Result<Vec<Value>> {
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

    fn series_data_value(
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
        self.values_cache.borrow_mut().remove(&id);
        self.db()?.execute("DELETE FROM series WHERE id=?1", [id])?;
        self.recompute_all(|_| {})
    }

    fn history_value(&self, limit: usize) -> Result<Vec<Value>> {
        let mut q=self.db()?.prepare("SELECT id,time,kind,before,after,target,action,original FROM changes ORDER BY id DESC LIMIT ?1")?;
        let rows=q.query_map([limit],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"time":r.get::<_,i64>(1)?,"kind":r.get::<_,String>(2)?,"before":r.get::<_,String>(3)?,"after":r.get::<_,String>(4)?,"target":r.get::<_,Option<i64>>(5)?,"action":r.get::<_,String>(6)?,"original":r.get::<_,Option<i64>>(7)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
        Ok(rows)
    }

    pub fn undo(&self) -> Result<UndoResult> {
        let changed = self.travel(false)?["changed"] == true;
        self.undo_state(changed)
    }

    pub fn redo(&self) -> Result<UndoResult> {
        let changed = self.travel(true)?["changed"] == true;
        self.undo_state(changed)
    }

    fn travel(&self, redo: bool) -> Result<Value> {
        let history_value = self.history_value(usize::MAX / 2)?;
        let mut undone = std::collections::BTreeSet::new();
        let mut redos = vec![];
        for h in history_value.iter().rev() {
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
                .and_then(|id| history_value.iter().find(|h| h["id"] == *id))
        } else {
            history_value
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
        let tx = self.db()?.unchecked_transaction()?;
        match kind {
            "optionsBatch" | "flagsBatch" => {
                for entry in v.as_array().unwrap_or(&vec![]) {
                    let id = entry["id"].as_i64().unwrap_or(0);
                    if kind == "optionsBatch" {
                        let o = &entry["options"];
                        self.db()?.execute(
                            "UPDATE fluxes SET options=?2 WHERE id=?1",
                            params![
                                id,
                                if o.is_null() {
                                    None
                                } else {
                                    Some(o.to_string())
                                }
                            ],
                        )?;
                    } else {
                        self.write_row(id, &serde_json::from_value(entry.clone())?)?;
                    }
                    self.recompute_one(id)?;
                }
            }
            "config" | "layout" => {
                self.db()?.execute(
                    "UPDATE meta SET value=?2 WHERE key=?1",
                    params![kind, v.to_string()],
                )?;
                if kind == "config" {
                    if let Some(name) = v["name"].as_str().filter(|s| !s.is_empty()) {
                        self.db()?
                            .execute("UPDATE meta SET value=?1 WHERE key='name'", [name])?;
                    }
                }
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
        self.neighbour_pass()?;
        tx.commit()?;
        Ok(
            json!({"changed":true,"fluxIds":if let Some(entries)=v.as_array(){entries.iter().filter_map(|e|e["id"].as_i64()).collect::<Vec<_>>()}else{target.into_iter().collect::<Vec<_>>()}}),
        )
    }

    pub fn metno_get_client_id(&self) -> Option<String> {
        self.client_id.clone()
    }

    pub fn metno_set_client_id(&mut self, id: String) {
        self.client_id = Some(id);
    }
}

pub(crate) fn interpolate(p: &[(i64, f64)], time: i64) -> Option<f64> {
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

pub(crate) fn assign(
    row: &mut FluxRow,
    m: &raw::Metadata,
    side: u8,
    cfg: &ProjectConfig,
    layout: &StoredLayout,
) {
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
    row.insert("x".into(), json!(x));
    row.insert("y".into(), json!(y));
    for key in ["plotId", "plotLabel", "treatmentId", "treatmentName"] {
        row.insert(key.into(), Value::Null);
    }
    let plot = layout.plots.iter().find(|p| {
        if let Some(id) = row.get("plotOverride").filter(|v| !v.is_null()) {
            return &p["id"] == id;
        }
        p["waypoints"].as_array().is_some_and(|ws| {
            ws.iter().any(|w| {
                w["side"] == if side == 1 { "left" } else { "right" }
                    && w["waypoint"].as_i64()
                        == m.waypoint
                            .split(|c: char| !c.is_ascii_digit())
                            .filter(|s| !s.is_empty())
                            .next_back()
                            .and_then(|s| s.parse::<i64>().ok())
            })
        }) || p["polygon"]
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
    fn scan_value(&self, dir: &str) -> Result<Value> {
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
        let scan = self.scan_value(&args.legacy_dir)?;
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
        let mut layout = preset_layout(preset.as_deref().unwrap_or(""))?;
        if layout.treatments.is_empty() {
            layout = unknown_layout(&args.legacy_dir)?;
        }
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
            let times: Vec<i64> = paths
                .iter()
                .filter_map(|p| raw::filename(p, &cfg.time_zone).ok().map(|m| m.time))
                .collect();
            let range = times
                .iter()
                .min()
                .zip(times.iter().max())
                .map(|(a, b)| (*a - 86400000, *b + 86400000));
            self.import_metno_range(&path, range)?;
        }

        self.import_raw_impl(&paths, &progress, false)?;
        let options_tx = self.db()?.unchecked_transaction()?;

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
                        json!(o["exclude"]
                            .as_bool()
                            .unwrap_or_else(|| o["exclude"].as_i64().unwrap_or(0) != 0)),
                    );
                    self.write_row(id, &row)?;
                }
            }
        }
        self.recompute_all(&progress)?;
        options_tx.commit()?;

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
        self.import_metno_range(path, None)
    }
    fn import_metno_range(&self, path: &str, range: Option<(i64, i64)>) -> Result<()> {
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
            let (lo, hi) = range.unwrap_or((lo, hi));
            if time < lo || time > hi {
                continue;
            }
            series.entry("sum(precipitation_amount PT1H)".into()).or_default().push(json!({"time":time,"value":p[1]["sum(precipitation_amount PT1H)"].as_f64().filter(|v|v.is_finite()).unwrap_or(0.)}));
            if let Some(m) = p[1].as_object() {
                for (k, v) in m {
                    if k == "sum(precipitation_amount PT1H)" {
                        continue;
                    }
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

    fn table_value(&self, path: &str, opts: Value) -> Result<Value> {
        let (sheets, rows) = read_table(path, opts["sheet"].as_str())?;
        let header = opts["headerRow"].as_u64().unwrap_or(0) as usize;
        Ok(
            json!({"sheets":sheets,"headerCandidates":(0..rows.len().min(5)).collect::<Vec<_>>(),"columns":rows.get(header).map(|r|r.iter().map(cell_text).collect::<Vec<_>>()).unwrap_or_default(),"rows":rows.iter().skip(header+1).take(20).collect::<Vec<_>>(),"totalRows":rows.len().saturating_sub(header+1)}),
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
                    ("\u{00b0}C Temp", "TEMPC_GROUND"),
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
        let tc = col("dateColumn", "date")
            .ok_or_else(|| Error::Invalid("date column missing".into()))?;
        let pc =
            col("plotColumn", "nr").ok_or_else(|| Error::Invalid("plot column missing".into()))?;
        let cfg = self.get_config()?;
        let layout = self.layout_value()?;
        let mut report = ImportReport::default();
        for values in rows.iter().skip(h + 1) {
            let Some(time) = values.get(tc).and_then(|v| parse_time(v, &cfg.time_zone)) else {
                report.skipped += 1;
                continue;
            };
            let plot = values.get(pc).and_then(number).map(|n| n as i64);
            let p = layout.plots.iter().find(|p| p["id"].as_i64() == plot);
            let row = json!({"id":0,"measurementId":null,"source":"manual","time":time+args["offsetHours"].as_i64().unwrap_or(12)*3600000,"filename":null,"side":null,"plotId":plot,"plotLabel":p.map(|p|p["label"].clone()),"treatmentId":p.map(|p|p["treatmentId"].clone()),"treatmentName":null,"excluded":false,"reviewed":false,"overridden":false,"note":"","airTemp":null,"precip":null});
            let mut row: FluxRow = serde_json::from_value(row)?;
            for (gas, col) in [("N2O", "N2O_N_mug_m2h"), ("CO2", "CO2_C_mug_m2h")] {
                if let Some(i) = column(headers, args["gasColumns"].get(gas).unwrap_or(&json!(col)))
                {
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

    fn summary_value(&self, q: SummaryQuery) -> Result<Value> {
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
                    // pandas grouped naive local dates; DST transitions still count as 24 hours.
                    let local_day = |v| {
                        chrono::DateTime::from_timestamp_millis(v)
                            .map(|v| v.with_timezone(&tz).date_naive())
                            .ok_or_else(|| Error::Invalid("day".into()))
                    };
                    let hours = (local_day(time)? - local_day(t)?).num_days() as f64 * 24.;
                    cumulative += hours * (m + mean) * 0.5 * 1e-5;
                }
                daily.push(json!({"time":time,"mean":mean,"cumulative":cumulative}));
                previous = Some((time, mean));
            }
            plots.push(json!({"plotId":id,"label":rows[0]["plotLabel"],"treatmentId":rows[0]["treatmentId"],"total":cumulative,"points":points,"daily":daily}));
        }
        let mut treatments = vec![];
        for t in self.layout_value()?.treatments {
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
            for r in rows.iter().filter(|r| r["treatmentId"] == t["id"]) {
                if let (Some(time), Some(value)) =
                    (r["time"].as_i64(), r.get(&key).and_then(number))
                {
                    let date = chrono::DateTime::from_timestamp_millis(time)
                        .ok_or_else(|| Error::Invalid("time".into()))?
                        .with_timezone(&tz)
                        .date_naive();
                    let naive = date
                        .and_hms_opt(0, 0, 0)
                        .ok_or_else(|| Error::Invalid("day".into()))?
                        .and_utc()
                        .timestamp_millis();
                    days.entry(naive).or_default().push(value);
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
            json!({"gas":q.gas,"unit":"ug m^-2 h^-1","cumulativeUnit":"kg ha^-1","treatments":treatments,"plots":plots}),
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
        let mut rows = self.rows()?;
        self.join_rows(&mut rows)?;
        Ok(rows
            .into_iter()
            .filter(|r| args.flux_ids.contains(&r["id"].as_i64().unwrap_or(0)))
            .collect())
    }

    pub fn export_xlsx(&self, mut args: ExportArgs) -> Result<()> {
        let rows = self.export_rows(&args)?;
        let cfg = self.get_config()?;
        let tz: chrono_tz::Tz = cfg
            .time_zone
            .parse()
            .map_err(|_| Error::Invalid("time zone".into()))?;
        if args.mode == "dailyPerPlot" {
            for key in ["timediffHours", "N2O_cumulative", "CO2_cumulative"] {
                if !args.columns.iter().any(|k| k == key) {
                    args.columns.push(key.into());
                }
            }
        }
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
                    days.entry(
                        chrono::DateTime::from_timestamp_millis(r["time"].as_i64().unwrap_or(0))
                            .map(|d| {
                                d.with_timezone(&tz)
                                    .date_naive()
                                    .and_hms_opt(0, 0, 0)
                                    .map(|d| d.and_utc().timestamp_millis())
                                    .unwrap_or(0)
                            })
                            .unwrap_or(0),
                    )
                    .or_default()
                    .push(r);
                }
                rows = days
                    .into_iter()
                    .map(|(day, rs)| {
                        let mut row = rs[0].clone();
                        row.insert("time".into(), json!(day));
                        for k in rs[0].keys() {
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
                let mut previous: Option<(i64, [Option<f64>; 2])> = None;
                let mut cumulative = [0.; 2];
                for row in &mut rows {
                    let time = row["time"].as_i64().unwrap_or(0);
                    let values = [
                        row.get("N2O_flux").and_then(number),
                        row.get("CO2_flux").and_then(number),
                    ];
                    let hours = previous
                        .map(|p| (time - p.0) as f64 / 3600000.)
                        .unwrap_or(0.);
                    for (i, gas) in ["N2O", "CO2"].iter().enumerate() {
                        if let Some((_, p)) = previous {
                            if let (Some(a), Some(b)) = (p[i], values[i]) {
                                cumulative[i] += (a + b) * 0.5 * hours * 1e-5;
                            }
                        }
                        row.insert(format!("{gas}_cumulative"), json!(cumulative[i]));
                    }
                    row.insert("timediffHours".into(), json!(hours));
                    previous = Some((time, values));
                }
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
    v.as_u64().map(|i| i as usize).or_else(|| {
        headers
            .iter()
            .position(|h| h == v || cell_text(h) == cell_text(v))
    })
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
        "%Y-%m-%d %H:%M:%S%.f",
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
            out[to] = if to == "co2Guides" {
                json!(v.as_bool().unwrap_or_else(|| v.as_i64().unwrap_or(0) != 0))
            } else {
                v.clone()
            };
        }
    }
    Ok(serde_json::from_value(out)?)
}

pub(crate) fn preset_layout(name: &str) -> Result<StoredLayout> {
    let presets: Value = serde_json::from_str(include_str!("presets.json"))?;
    layout_from_preset(&presets[name], name)
}
fn layout_from_preset(p: &Value, name: &str) -> Result<StoredLayout> {
    let mut layout = StoredLayout::default();
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

fn unknown_layout(dir: &str) -> Result<StoredLayout> {
    for filename in ["analyzer-gui.py", "field_experiment.py"] {
        let path = Path::new(dir).join(filename);
        if !path.exists() {
            continue;
        }
        let text = std::fs::read_to_string(path)?;
        if let Some(i) = text.find("treatment_legend") {
            if let Some(start) = text[i..].find('{') {
                let text = &text[i + start..];
                for (end, ch) in text.char_indices() {
                    if ch == '}' {
                        if let Ok(value) = crate::literal::parse(&text[..=end]) {
                            return layout_from_preset(&json!({"treatment_legend":value}), "");
                        }
                    }
                }
            }
        }
    }
    Ok(StoredLayout::default())
}
impl Session {
    pub fn get_layout(&self) -> Result<Layout> {
        Ok(serde_json::from_value(serde_json::to_value(
            self.layout_value()?,
        )?)?)
    }
    pub fn list_series(&self) -> Result<Vec<SeriesMeta>> {
        self.series_value()?
            .into_iter()
            .map(|mut v| {
                if v["timeRange"].is_null() {
                    v["timeRange"] = json!([0, 0]);
                }
                Ok(serde_json::from_value(v)?)
            })
            .collect()
    }
    pub fn get_series(
        &self,
        ids: &[i64],
        from: Option<i64>,
        to: Option<i64>,
        max_points: Option<usize>,
    ) -> Result<Vec<SeriesData>> {
        Ok(serde_json::from_value(json!(
            self.series_data_value(ids, from, to, max_points)?
        ))?)
    }
    pub fn treatment_summary(&self, q: SummaryQuery) -> Result<TreatmentSummary> {
        Ok(serde_json::from_value(self.summary_value(q)?)?)
    }
    pub fn preview_table(&self, path: &str, opts: Value) -> Result<TablePreview> {
        Ok(serde_json::from_value(self.table_value(path, opts)?)?)
    }
    pub fn legacy_scan(&self, dir: &str) -> Result<LegacyScan> {
        let v = self.scan_value(dir)?;
        let paths = &v["config"]["PATHS"];
        let exists = |k: &str| paths[k].as_str().is_some_and(|p| Path::new(p).exists());
        Ok(LegacyScan {
            config_paths: paths
                .as_object()
                .map(|m| {
                    m.values()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
            raw_files: v["rawCount"].as_u64().unwrap_or(0) as usize,
            manual_exists: exists("MANUAL"),
            logger_exists: exists("LOGGER_PATH"),
            weather_exists: Path::new(dir).join("../../metno_data.pickle").exists(),
            warnings: if v["rawCount"] == 0 {
                vec!["No raw files found; choose a raw folder.".into()]
            } else {
                vec![]
            },
        })
    }
    pub fn history(&self, limit: usize) -> Result<Vec<Change>> {
        self.history_value(limit)?
            .into_iter()
            .map(|h| {
                let before = h["before"].as_str().unwrap_or("null").to_owned();
                let after = h["after"].as_str().unwrap_or("null").to_owned();
                let v: Value = serde_json::from_str(&after)?;
                let flux_ids = if let Some(a) = v.as_array() {
                    a.iter().filter_map(|v| v["id"].as_i64()).collect()
                } else {
                    h["target"].as_i64().into_iter().collect()
                };
                Ok(Change {
                    id: h["id"].as_i64().unwrap_or(0),
                    time: h["time"].as_i64().unwrap_or(0),
                    kind: h["kind"].as_str().unwrap_or("").into(),
                    flux_ids,
                    before,
                    after,
                })
            })
            .collect()
    }
    fn undo_state(&self, changed: bool) -> Result<UndoResult> {
        let h = self.history_value(usize::MAX / 2)?;
        let mut undo = vec![];
        let mut redo = vec![];
        for h in h.iter().rev() {
            match h["action"].as_str() {
                Some("edit") => {
                    undo.push(h["id"].as_i64().unwrap_or(0));
                    redo.clear();
                }
                Some("undo") => {
                    if let Some(id) = h["original"].as_i64() {
                        undo.retain(|v| *v != id);
                        redo.push(id);
                    }
                }
                Some("redo") => {
                    if let Some(id) = h["original"].as_i64() {
                        redo.retain(|v| *v != id);
                        undo.push(id);
                    }
                }
                _ => {}
            }
        }
        Ok(UndoResult {
            changed,
            can_undo: !undo.is_empty(),
            can_redo: !redo.is_empty(),
        })
    }
}
impl Session {
    fn save_error_row(&self, id: i64, mut row: FluxRow, message: &str) -> Result<()> {
        let mut findings = vec![crate::diagnostics::Diagnostic {
            code: "error".into(),
            severity: "bad".into(),
            gas: None,
            value: None,
            message: message.into(),
        }];
        crate::diagnostics::decorate(&mut row, &mut findings, 0.);
        self.save_findings(id, &findings)?;
        self.write_row(id, &row)
    }
    fn save_findings(&self, id: i64, findings: &[crate::diagnostics::Diagnostic]) -> Result<()> {
        self.db()?.execute("INSERT INTO diagnostics(flux_id,findings) VALUES(?1,?2) ON CONFLICT(flux_id) DO UPDATE SET findings=excluded.findings",params![id,serde_json::to_string(findings)?])?;
        Ok(())
    }
    fn load_findings(&self, id: i64) -> Result<Vec<crate::diagnostics::Diagnostic>> {
        let text: Option<String> = self
            .db()?
            .query_row(
                "SELECT findings FROM diagnostics WHERE flux_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(text
            .map(|s| serde_json::from_str(&s))
            .transpose()?
            .unwrap_or_default())
    }
    fn cached_lag(
        &self,
        raw: &Raw,
        opts: &AnalysisOptions,
        c: &crate::diagnostics::DiagnosticsConfig,
    ) -> Result<(f64, f64)> {
        let key = (raw.metadata.time, opts.valve_offset.to_bits());
        if let Some(v) = self.lag_cache.borrow().get(&key) {
            return Ok(*v);
        }
        let lag = crate::diagnostics::valve_lag(raw, opts, c);
        self.lag_cache.borrow_mut().insert(key, lag);
        Ok(lag)
    }
    fn neighbour_pass(&self) -> Result<()> {
        let mut rows = self.rows()?;
        let mut findings: Vec<_> = rows
            .iter()
            .map(|r| self.load_findings(r["id"].as_i64().unwrap_or(0)))
            .collect::<Result<_>>()?;
        for f in &mut findings {
            f.retain(|d| d.code != "neighbour_outlier");
        }
        crate::diagnostics::neighbours(&mut rows, &mut findings, &self.get_config()?.diagnostics);
        for (row, mut f) in rows.iter_mut().zip(findings) {
            let id = row["id"].as_i64().unwrap_or(0);
            let lag = row.get("valveLagS").and_then(Value::as_f64).unwrap_or(0.);
            crate::diagnostics::decorate(row, &mut f, lag);
            self.write_row(id, row)?;
            self.save_findings(id, &f)?;
        }
        Ok(())
    }
    pub fn patch_flux_options(&self, ids: &[i64], partial: Value) -> Result<Vec<FluxRow>> {
        let patch = partial
            .as_object()
            .ok_or_else(|| Error::Invalid("partial must be an options object".into()))?;
        let tx = self.db()?.unchecked_transaction()?;
        let mut before = vec![];
        let mut after = vec![];
        for id in ids {
            let (opts, _) = self.options(*id)?;
            let mut value = serde_json::to_value(opts)?;
            for (key, v) in patch {
                if ![
                    "mode",
                    "start",
                    "stop",
                    "interval",
                    "crit",
                    "co2Guides",
                    "cutBeginnings",
                    "cutEnds",
                    "valveOffset",
                    "slope",
                    "perGas",
                ]
                .contains(&key.as_str())
                {
                    return Err(Error::Invalid(format!("unknown analysis field {key}")));
                }
                if key == "perGas" {
                    let mut per_gas = value
                        .get(key)
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_default();
                    if let Some(gases) = v.as_object() {
                        for (gas, fields) in gases {
                            let mut existing = per_gas
                                .get(gas)
                                .and_then(Value::as_object)
                                .cloned()
                                .unwrap_or_default();
                            if let Some(fields) = fields.as_object() {
                                existing.extend(fields.clone());
                            }
                            per_gas.insert(gas.clone(), json!(existing));
                        }
                    }
                    value[key] = json!(per_gas);
                } else {
                    value[key] = v.clone();
                }
            }
            let opts: AnalysisOptions = serde_json::from_value(value)?;
            opts.validate()?;
            let old: Option<String> =
                self.db()?
                    .query_row("SELECT options FROM fluxes WHERE id=?1", [id], |r| r.get(0))?;
            before.push(json!({"id":id,"options":old.map(|s|serde_json::from_str::<Value>(&s)).transpose()?}));
            after.push(json!({"id":id,"options":opts}));
            self.db()?.execute(
                "UPDATE fluxes SET options=?2 WHERE id=?1",
                params![id, serde_json::to_string(&opts)?],
            )?;
            self.recompute_one(*id)?;
        }
        self.neighbour_pass()?;
        self.log(
            "optionsBatch",
            None,
            &json!(before),
            &json!(after),
            "edit",
            None,
        )?;
        self.neighbour_pass()?;
        tx.commit()?;
        ids.iter().map(|id| self.row(*id)).collect()
    }
    pub fn get_flux_thumbs(
        &self,
        ids: &[i64],
        gas: &str,
        max_points: usize,
    ) -> Result<Vec<FluxThumb>> {
        let mut cache = BTreeMap::new();
        let mut out = vec![];
        for id in ids {
            let row = self.row(*id)?;
            let Some(mid) = row["measurementId"].as_i64() else {
                continue;
            };
            if let std::collections::btree_map::Entry::Vacant(entry) = cache.entry(mid) {
                match self.measurement(mid) {
                    Ok(raw) => {
                        entry.insert(raw);
                    }
                    Err(_) => {
                        out.push(FluxThumb {
                            flux_id: *id,
                            t: vec![],
                            y: vec![],
                            used: vec![],
                            slope: 0.,
                            intercept: 0.,
                        });
                        continue;
                    }
                }
            }
            let raw = &cache[&mid];
            let Some((t, y)) = raw.channels.get(gas) else {
                continue;
            };
            let result: String =
                self.db()?
                    .query_row("SELECT results FROM fluxes WHERE id=?1", [id], |r| r.get(0))?;
            let results: BTreeMap<String, crate::regression::Regression> =
                serde_json::from_str(&result)?;
            let Some(r) = results.get(gas) else {
                continue;
            };
            let (opts, _) = self.options(*id)?;
            let side = if row["side"] == "left" { 1 } else { 2 };
            let used: std::collections::BTreeSet<usize> =
                crate::diagnostics::used_indices(raw, gas, side, &opts, r)
                    .into_iter()
                    .collect();
            let all: Vec<usize> = raw::group_ranges(
                t,
                &crate::diagnostics::shifted(raw, opts.valve_offset),
                opts.cut_beginnings,
                opts.cut_ends,
            )
            .into_iter()
            .filter(|r| r.2 == side)
            .flat_map(|(a, b, _)| a..b)
            .collect();
            let n = all.len().min(max_points);
            let indices: Vec<usize> = (0..n)
                .map(|i| all[i * (all.len() - 1) / n.saturating_sub(1).max(1)])
                .collect();
            out.push(FluxThumb {
                flux_id: *id,
                t: indices.iter().map(|i| t[*i]).collect(),
                y: indices.iter().map(|i| y[*i]).collect(),
                used: indices.iter().map(|i| used.contains(i)).collect(),
                slope: r.slope,
                intercept: r.intercept,
            });
        }
        Ok(out)
    }
    pub fn diagnostics_summary(&self) -> Result<Vec<crate::diagnostics::DiagnosticSummary>> {
        let rows = self.rows()?;
        let mut out = vec![];
        for (code, label, description) in crate::diagnostics::RULES {
            let mut count = 0;
            let mut unreviewed = 0;
            let mut severity = "info".to_string();
            for row in &rows {
                let matches: Vec<_> = self
                    .load_findings(row["id"].as_i64().unwrap_or(0))?
                    .into_iter()
                    .filter(|d| d.code == code)
                    .collect();
                if !matches.is_empty() {
                    count += 1;
                    if row["reviewed"] != true {
                        unreviewed += 1;
                    }
                    for d in matches {
                        if crate::diagnostics::rank(&d.severity)
                            > crate::diagnostics::rank(&severity)
                        {
                            severity = d.severity;
                        }
                    }
                }
            }
            out.push(crate::diagnostics::DiagnosticSummary {
                code: code.into(),
                label: label.into(),
                description: description.into(),
                severity,
                count,
                unreviewed,
            });
        }
        Ok(out)
    }
    pub fn diagnostics_report(&self) -> Result<Value> {
        let rows = self.rows()?;
        let robot: Vec<_> = rows.iter().filter(|r| r["source"] == "robot").collect();
        let excluded = robot.iter().filter(|r| r["excluded"] == true).count();
        let mut codes = vec![];
        for (code, label, rule) in crate::diagnostics::RULES {
            let count = |excluded: bool| {
                robot
                    .iter()
                    .filter(|r| {
                        (r["excluded"] == true) == excluded
                            && r.get("diag")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .split(',')
                                .any(|s| s == code)
                    })
                    .count()
            };
            codes.push(json!({"code":code,"label":label,"rule":rule,"excluded":count(true),"notExcluded":count(false)}));
        }
        let mut ranked = robot.clone();
        ranked.sort_by(|a, b| {
            b.get("attention")
                .and_then(Value::as_f64)
                .unwrap_or(0.)
                .total_cmp(&a.get("attention").and_then(Value::as_f64).unwrap_or(0.))
                .then(a["id"].as_i64().cmp(&b["id"].as_i64()))
        });
        let recalls:Vec<_>=[5,10,20].into_iter().map(|pct|{let n=(ranked.len()*pct).div_ceil(100);let hits=ranked[..n].iter().filter(|r|r["excluded"]==true).count();json!({"topPercent":pct,"rows":n,"excludedFound":hits,"excludedTotal":excluded,"share":if excluded>0{hits as f64/excluded as f64}else{0.},"cutoffAttention":ranked.get(n.saturating_sub(1)).and_then(|r|r.get("attention"))})}).collect();
        let no_findings: Vec<_> = robot
            .iter()
            .filter(|r| {
                r["excluded"] == true
                    && r.get("diag")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .is_empty()
            })
            .map(|r| json!({"id":r["id"],"filename":r["filename"],"side":r["side"]}))
            .collect();
        let cfg = self.get_config()?;
        let tz: chrono_tz::Tz = cfg
            .time_zone
            .parse()
            .map_err(|_| Error::Invalid("time zone".into()))?;
        let mut seen = std::collections::BTreeSet::new();
        let mut by_date: BTreeMap<String, Vec<f64>> = BTreeMap::new();
        let mut lags = vec![];
        for r in &robot {
            if !seen.insert(r["measurementId"].as_i64()) {
                continue;
            }
            let lag = r.get("valveLagS").and_then(Value::as_f64).unwrap_or(0.);
            let day = chrono::DateTime::from_timestamp_millis(r["time"].as_i64().unwrap_or(0))
                .map(|d| d.with_timezone(&tz).format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            by_date.entry(day).or_default().push(lag);
            lags.push(lag);
        }
        lags.sort_by(f64::total_cmp);
        let quantile = |p: f64| {
            lags.get(((lags.len().saturating_sub(1)) as f64 * p) as usize)
                .copied()
        };
        let mut histogram = BTreeMap::<String, usize>::new();
        for v in &lags {
            *histogram.entry(format!("{v:.1}")).or_default() += 1;
        }
        let dates:Vec<_>=by_date.into_iter().map(|(date,v)|json!({"date":date,"measurements":v.len(),"median":crate::diagnostics::median(&v),"min":v.iter().copied().fold(f64::INFINITY,f64::min),"max":v.iter().copied().fold(f64::NEG_INFINITY,f64::max)})).collect();
        Ok(
            json!({"robotFluxes":robot.len(),"excluded":excluded,"notExcluded":robot.len()-excluded,"codes":codes,"ranking":recalls,"excludedWithoutFindings":no_findings,"valveLag":{"measurements":lags.len(),"quantiles":[quantile(0.),quantile(0.1),quantile(0.5),quantile(0.9),quantile(1.)],"histogram":histogram,"byDate":dates},"thresholds":cfg.diagnostics}),
        )
    }
}
