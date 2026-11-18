use super::*;

impl Session {
    pub fn import_raw_files(
        &self,
        paths: &[String],
        progress: impl Fn(Progress),
    ) -> Result<ImportReport> {
        self.import_raw_impl(paths, progress, true)
    }

    /// Removes a measurement with its fluxes and their findings.
    pub(super) fn delete_measurement(&self, mid: i64) -> Result<()> {
        let db = self.db()?;
        db.execute(
            "DELETE FROM diagnostics WHERE flux_id IN \
             (SELECT id FROM fluxes WHERE measurement_id=?1)",
            [mid],
        )?;
        db.execute("DELETE FROM fluxes WHERE measurement_id=?1", [mid])?;
        db.execute("DELETE FROM measurements WHERE id=?1", [mid])?;
        self.lag_cache.borrow_mut().clear();
        Ok(())
    }

    pub(super) fn import_raw_impl(
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
            // Only robot files: anything else (a route CSV, say) is reported,
            // not stored as a failed measurement.
            if raw::filename(&name, &cfg.time_zone).is_err() {
                report.errors.push(ImportError {
                    path: path.clone(),
                    message: "not a robot raw file (the name does not start with its \
                              date, time and position)"
                        .into(),
                });
                continue;
            }
            let existing: Option<(i64, String)> = db
                .query_row(
                    "SELECT id,status FROM measurements WHERE filename=?1",
                    [&name],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((mid, status)) = existing {
                // A file that failed before (and was stored without its data) is
                // read again when it now loads, e.g. after a parser update.
                if status == "error" && raw.is_ok() {
                    self.delete_measurement(mid)?;
                    report.retried += 1;
                } else {
                    report.skipped += 1;
                    continue;
                }
            }
            match raw {
                Err(e) => {
                    report.errors.push(ImportError {
                        path: path.clone(),
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
                    let sides: Vec<&str> = match meta["sides"].as_str() {
                        Some("left") => vec!["left"],
                        Some("right") => vec!["right"],
                        _ => vec!["left", "right"],
                    };
                    for side in sides {
                        let mut row: FluxRow = serde_json::from_value(json!({
                        "id":0,
                        "measurementId":mid,
                        "source":"robot",
                        "time":meta["time"],
                        "filename":name,
                        "side":side,
                        "plotId":null,
                        "plotLabel":null,
                        "treatmentId":null,
                        "treatmentName":null,
                        "excluded":false,
                        "reviewed":false,
                        "overridden":false,
                        "note":"",
                        "airTemp":null,
                        "precip":null,
                        "x":meta["x"],
                        "y":meta["y"]}
                        ))?;
                        db.execute(
                            "INSERT INTO fluxes(measurement_id,row,results) VALUES(?1,?2,'{}')",
                            params![mid, serde_json::to_string(&row)?],
                        )?;
                        let id = db.last_insert_rowid();
                        row.insert("id".into(), json!(id));
                        let mut findings = vec![crate::diagnostics::Diagnostic {
                            impact: None,
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
                    db.execute("INSERT INTO measurements(filename,metadata,raw,status) VALUES(?1,?2,?3,'ok')",
params![name,
serde_json::to_string(&raw.metadata)?,
bytes])?;

                    let mid = db.last_insert_rowid();
                    let sides: Vec<&str> = match raw.metadata.sides.as_str() {
                        "left" => vec!["left"],
                        "right" => vec!["right"],
                        _ => vec!["left", "right"],
                    };
                    for side in sides {
                        let row = json!({
                        "id":0,
                        "measurementId":mid,
                        "source":"robot",
                        "time":raw.metadata.time,
                        "filename":name,
                        "side":side,
                        "plotId":null,
                        "plotLabel":null,
                        "treatmentId":null,
                        "treatmentName":null,
                        "excluded":false,
                        "reviewed":false,
                        "overridden":false,
                        "note":"",
                        "airTemp":null,
                        "precip":null,
                        "plotOverride":null}
                        );

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
                                    path: path.clone(),
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
        if compute {
            self.neighbour_pass()?;
        }
        tx.commit()?;
        Ok(report)
    }

    pub(super) fn scan_value(&self, dir: &str) -> Result<Value> {
        let root = Path::new(dir);
        let cfg = root.join("config.yml");
        let config: Value = if cfg.exists() {
            serde_yaml::from_str(&std::fs::read_to_string(&cfg).map_err(|e| Error::at(&cfg, e))?)
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
        Ok(json!({
        "legacyDir":dir,
        "rawDir":raw,
        "rawCount":count,
        "config":config,
        "specificOptions":root.join("specific_options.pickle").exists(),
        "manualPath":config["PATHS"]["MANUAL"],
        "loggerPath":config["PATHS"]["LOGGER_PATH"],
        "preset":root.file_name().unwrap_or_default().to_string_lossy().to_lowercase()}
        ))
    }

    pub fn legacy_import(
        &mut self,
        mut args: LegacyImportArgs,
        progress: impl Fn(Progress),
    ) -> Result<ProjectInfo> {
        let target = std::path::PathBuf::from(&args.out_path);
        if target.exists() {
            return Err(Error::Invalid(format!(
                "{}: destination exists",
                target.display()
            )));
        }
        let parent = target
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let temporary = tempfile::Builder::new()
            .prefix(".ffr-import-")
            .suffix(".ffr")
            .tempfile_in(parent)
            .map_err(|e| Error::at(parent, e))?
            .into_temp_path();
        std::fs::remove_file(&temporary).map_err(|e| Error::at(&temporary, e))?;
        args.out_path = temporary.to_string_lossy().into_owned();
        let mut imported = Session::default();
        let result = imported.legacy_import_inner(args, progress);
        imported.project_close();
        result?;
        temporary
            .persist_noclobber(&target)
            .map_err(|e| Error::at(&target, e.error))?;
        self.project_open(&target.to_string_lossy())
    }
    fn legacy_import_inner(
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
        let mut paths: Vec<String> = std::fs::read_dir(&raw_dir)
            .map_err(|e| Error::at(&raw_dir, e))?
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(|e| Error::at(&raw_dir, e))?
            .into_iter()
            .filter(|e| e.file_name().to_string_lossy().starts_with('2'))
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if preset.as_deref() == Some("capture") {
                    raw::filename(&name, &cfg.time_zone).map_or(true, |m| {
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
                    let options = options.normalised();
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

    pub(super) fn import_metno_range(&self, path: &str, range: Option<(i64, i64)>) -> Result<()> {
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
            series.entry("sum(precipitation_amount PT1H)".into()).or_default().push(json!({
"time":time,
"value":p[1]["sum(precipitation_amount PT1H)"].as_f64().filter(|v|v.is_finite()).unwrap_or(0.)}
));

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

    pub(super) fn table_value(&self, path: &str, opts: Value) -> Result<Value> {
        let (sheets, rows) = read_table(path, opts["sheet"].as_str())?;
        let header = opts["headerRow"].as_u64().unwrap_or(0) as usize;
        Ok(json!({
        "sheets":sheets,
        "headerCandidates":(0..rows.len().min(5)).collect::<Vec<_>>(),
        "columns":rows.get(header).map(|r|r.iter().map(cell_text).collect::<Vec<_>>()).unwrap_or_default(),
        "rows":rows.iter().skip(header+1).take(20).collect::<Vec<_>>(),
        "totalRows":rows.len().saturating_sub(header+1)}
        ))
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
            let row = json!({
            "id":0,
            "measurementId":null,
            "source":"manual",
            "time":time+args["offsetHours"].as_i64().unwrap_or(12)*3600000,
            "filename":null,
            "side":null,
            "plotId":plot,
            "plotLabel":p.map(|p|p["label"].clone()),
            "treatmentId":p.map(|p|p["treatmentId"].clone()),
            "treatmentName":null,
            "excluded":false,
            "reviewed":false,
            "overridden":false,
            "note":"",
            "airTemp":null,
            "precip":null}
            );

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
}

pub(super) fn column(headers: &[Value], v: &Value) -> Option<usize> {
    v.as_u64().map(|i| i as usize).or_else(|| {
        headers
            .iter()
            .position(|h| h == v || cell_text(h) == cell_text(v))
    })
}

pub(super) fn parse_time(v: &Value, zone: &str) -> Option<i64> {
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

fn read_table_inner(path: &str, sheet: Option<&str>) -> Result<(Vec<String>, Vec<Vec<Value>>)> {
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

pub(super) fn convert_options(v: &Value, base: &AnalysisOptions) -> Result<AnalysisOptions> {
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
    let presets: Value = serde_json::from_str(include_str!("../presets.json"))?;
    layout_from_preset(&presets[name], name)
}

pub(super) fn layout_from_preset(p: &Value, name: &str) -> Result<StoredLayout> {
    let mut layout = StoredLayout::default();
    if let Some(ts) = p["treatment_legend"].as_object() {
        for (id, t) in ts {
            let id: i64 = id.parse().map_err(|_| Error::Invalid("preset".into()))?;
            layout.treatments.push(json!({
            "id":id,
            "name":t["name"],
            "shortName":t["treatment"].as_str().unwrap_or(""),
            "colour":format!("#{:06x}",
            (id*2654435761_i64)&0xffffff),
            "sortOrder":id}
            ));

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
                layout.plots.push(json!({
"id":id,
"label":id.to_string(),
"treatmentId":layout.treatments.last().map(|t|t["id"].clone()),
"polygon":polygon,
"waypoints":p["waypoints"].as_array().map(|w|w.iter().filter(|w|w["plotId"]==id).collect::<Vec<_>>())}
));
            }
        }
    }
    Ok(layout)
}

pub(super) fn unknown_layout(dir: &str) -> Result<StoredLayout> {
    for filename in ["analyzer-gui.py", "field_experiment.py"] {
        let path = Path::new(dir).join(filename);
        if !path.exists() {
            continue;
        }
        let text = std::fs::read_to_string(&path).map_err(|e| Error::at(&path, e))?;
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

pub(super) fn read_table(
    path: &str,
    sheet: Option<&str>,
) -> Result<(Vec<String>, Vec<Vec<Value>>)> {
    read_table_inner(path, sheet).map_err(|e| Error::Invalid(format!("{path}: {e}")))
}
