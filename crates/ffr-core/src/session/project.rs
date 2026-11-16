use super::*;

impl Session {
    pub fn project_create(&mut self, path: &str, name: &str) -> Result<ProjectInfo> {
        if Path::new(path).exists() {
            return Err(Error::Invalid(format!("{path}: destination exists")));
        }
        let db = Connection::open(path).map_err(|e| Error::Invalid(format!("{path}: {e}")))?;
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA application_id=1179013682; PRAGMA user_version=3; PRAGMA foreign_keys=ON;

 CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);

 CREATE TABLE measurements(id INTEGER PRIMARY KEY,filename TEXT UNIQUE NOT NULL,metadata TEXT NOT NULL,raw BLOB,status TEXT NOT NULL,error TEXT);

 CREATE TABLE fluxes(id INTEGER PRIMARY KEY,measurement_id INTEGER REFERENCES measurements(id),row TEXT NOT NULL,options TEXT,results TEXT NOT NULL);

 CREATE TABLE series(id INTEGER PRIMARY KEY,metadata TEXT NOT NULL,points TEXT NOT NULL);

 CREATE TABLE diagnostics(flux_id INTEGER PRIMARY KEY REFERENCES fluxes(id),findings TEXT NOT NULL,analysis TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE changes(id INTEGER PRIMARY KEY,
time INTEGER NOT NULL,
kind TEXT NOT NULL,
before TEXT NOT NULL,
after TEXT NOT NULL,
target INTEGER,
action TEXT NOT NULL,
original INTEGER);
")?;

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
        let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| Error::Invalid(format!("{path}: {e}")))?;
        let app: i64 = db.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        let version: u32 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if app != 1179013682 || !(1..=3).contains(&version) {
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
        if version < 3 {
            let tx = self.db()?.unchecked_transaction()?;
            self.db()?.execute_batch(
                "CREATE TABLE IF NOT EXISTS diagnostics(\
                 flux_id INTEGER PRIMARY KEY REFERENCES fluxes(id),\
                 findings TEXT NOT NULL,analysis TEXT NOT NULL DEFAULT '{}');",
            )?;
            let columns: Vec<String> = self
                .db()?
                .prepare("PRAGMA table_info(diagnostics)")?
                .query_map([], |r| r.get(1))?
                .collect::<std::result::Result<_, _>>()?;
            if !columns.iter().any(|v| v == "analysis") {
                self.db()?.execute_batch(
                    "ALTER TABLE diagnostics ADD COLUMN analysis TEXT NOT NULL DEFAULT '{}';",
                )?;
            }
            let mut cfg = self.get_config()?;
            cfg.diagnostics = Default::default();
            self.db()?.execute(
                "UPDATE meta SET value=?1 WHERE key='config'",
                [serde_json::to_string(&cfg)?],
            )?;
            self.recompute_all(|_| {})?;
            self.db()?.execute_batch("PRAGMA user_version=3;")?;
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
            schema_version: 3,
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

    pub(super) fn meta<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<T> {
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

    pub(super) fn layout_value(&self) -> Result<StoredLayout> {
        self.meta("layout")
    }

    pub(super) fn edit_meta<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<()> {
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

    pub fn get_layout(&self) -> Result<Layout> {
        Ok(serde_json::from_value(serde_json::to_value(
            self.layout_value()?,
        )?)?)
    }
}
