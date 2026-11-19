use super::*;

impl Session {
    pub(super) fn recompute_one(&self, id: i64) -> Result<()> {
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
        let results = regression::compute_with(&raw, side, &opts, temp)?;
        self.persist_result(id, row, &raw, &cfg, overridden, (results, None))
    }

    pub(super) fn persist_result(
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
        let scale_analysis = findings.is_some();
        row.insert("time".into(), json!(raw.metadata.time));
        let side = if row["side"] == "left" { 1 } else { 2 };
        let factor = cfg.pressure / 101000. * cfg.chamber_height / 0.5;
        for r in results.values_mut() {
            r.flux *= factor;
            r.flux_factor *= factor;
            if r.gas == "N2O" {
                r.qc = regression::qc_with(r, side, &cfg.qc);
            }
        }
        let layout = self.layout_value()?;
        assign(&mut row, &raw.metadata, side, cfg, &layout);
        row.insert("overridden".into(), json!(overridden));
        let (opts, _) = self.options(id)?;
        let mut findings = match findings {
            Some(d) => d,
            None => {
                let lag = self.cached_lag(raw, &opts, &cfg.diagnostics)?;
                crate::diagnostics::analyse(raw, side, &opts, &results, &cfg.diagnostics, lag)
            }
        };
        // Diagnostics compare the ordinary fit with the robust one; only then
        // does a robust fit method replace the reported regression.
        crate::diagnostics::apply_fit_method(raw, side, &opts, &mut results, &cfg.diagnostics);
        apply_gas_exclusion(&mut row);
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
                ("seFlux", r.se_slope * crate::diagnostics::conversion(r)),
            ] {
                row.insert(format!("{gas}_{key}"), json!(v));
            }
            if gas == "N2O" {
                row.insert("N2O_qc".into(), json!(r.qc));
            }
        }
        for s in self.series_value()? {
            if let (Some(name), Some(sid)) = (s["key"].as_str(), s["id"].as_i64()) {
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
        if row["temperatureFallback"] == true {
            findings.diagnostics.push(crate::diagnostics::Diagnostic {
                impact: None,
                code: "temp_fallback".into(),
                severity: "info".into(),
                gas: None,
                value: None,
                message: "No air temperature; fallback temperature used.".into(),
            });
        }
        if row["plotId"].is_null() || row["plotId"] == 0 {
            findings.diagnostics.push(crate::diagnostics::Diagnostic {
                impact: None,
                code: "no_plot".into(),
                severity: "info".into(),
                gas: None,
                value: None,
                message: "Chamber position belongs to no plot.".into(),
            });
        }
        if scale_analysis {
            for ols in findings.ols.values_mut() {
                ols.flux *= factor;
                ols.se_flux *= factor;
            }
            for robust in &mut findings.robust {
                robust.flux *= factor;
            }
            for diff in findings.half_differences.values_mut() {
                *diff *= factor;
            }
        }
        findings.valve_lag_s += opts.valve_offset;
        self.db()?.execute(
            "INSERT INTO diagnostics(flux_id,findings,analysis) VALUES(?1,'[]',?2) \
             ON CONFLICT(flux_id) DO UPDATE SET analysis=excluded.analysis",
            params![id, serde_json::to_string(&findings)?],
        )?;
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
        self.prune_unmeasured_sides()?;
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
                let results = regression::compute_with(raw, *side, opts, *temp)?;
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
        self.db()?.execute(
            "INSERT INTO meta(key,value) VALUES('analysis_version',?1)              ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [ANALYSIS_VERSION.to_string()],
        )?;
        if let Some(tx) = tx {
            tx.commit()?;
        }
        Ok(())
    }

    fn prune_unmeasured_sides(&self) -> Result<()> {
        let mut query=self.db()?.prepare("SELECT f.id,m.metadata,f.row FROM fluxes f JOIN measurements m ON f.measurement_id=m.id WHERE m.status='ok'")?;
        let records = query
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (id, metadata, row) in records {
            let meta: raw::Metadata = serde_json::from_str(&metadata)?;
            let row: FluxRow = serde_json::from_str(&row)?;
            if ["left", "right"].contains(&meta.sides.as_str()) && row["side"] != meta.sides {
                self.db()?
                    .execute("DELETE FROM diagnostics WHERE flux_id=?1", [id])?;
                self.db()?.execute("DELETE FROM fluxes WHERE id=?1", [id])?;
            }
        }
        Ok(())
    }
    pub(super) fn save_error_row(&self, id: i64, mut row: FluxRow, message: &str) -> Result<()> {
        let mut findings = vec![crate::diagnostics::Diagnostic {
            impact: None,
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

    pub(super) fn save_findings(
        &self,
        id: i64,
        findings: &[crate::diagnostics::Diagnostic],
    ) -> Result<()> {
        self.db()?.execute("INSERT INTO diagnostics(flux_id,findings) VALUES(?1,?2) ON CONFLICT(flux_id) DO UPDATE SET findings=excluded.findings",
params![id,
serde_json::to_string(findings)?])?;

        Ok(())
    }

    pub(super) fn load_findings(&self, id: i64) -> Result<Vec<crate::diagnostics::Diagnostic>> {
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

    pub(super) fn load_analysis(&self, id: i64) -> Result<crate::diagnostics::Findings> {
        let text: Option<String> = self
            .db()?
            .query_row(
                "SELECT analysis FROM diagnostics WHERE flux_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(text
            .map(|s| serde_json::from_str(&s))
            .transpose()?
            .unwrap_or_default())
    }
    pub(super) fn cached_lag(
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

    /// Re-scores the project-wide findings (baselines, neighbours, leaks) and
    /// returns the ids of fluxes whose row or findings changed. Everything is
    /// read in two bulk queries and only changed rows are written back, so a
    /// single edit does not rewrite the whole project.
    pub(super) fn neighbour_pass(&self) -> Result<BTreeSet<i64>> {
        let db = self.db()?;
        let mut texts = db.prepare_cached("SELECT id,row FROM fluxes ORDER BY id")?;
        let texts = texts
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut stored = db.prepare_cached("SELECT flux_id,findings,analysis FROM diagnostics")?;
        let mut stored: BTreeMap<i64, (Option<String>, Option<String>)> = stored
            .query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?
            .collect::<std::result::Result<_, _>>()?;
        let stored: Vec<_> = texts
            .iter()
            .map(|(id, _)| stored.remove(id).unwrap_or_default())
            .collect();
        let parsed = texts
            .par_iter()
            .zip(&stored)
            .map(|((_, text), (f, a))| {
                let row = serde_json::from_str::<FluxRow>(text)?;
                let mut list: Vec<crate::diagnostics::Diagnostic> = f
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()?
                    .unwrap_or_default();
                let analysis: crate::diagnostics::Findings = a
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()?
                    .unwrap_or_default();
                if !analysis.diagnostics.is_empty() || !analysis.robust.is_empty() {
                    // The stored analysis already carries these for current
                    // projects; only older ones need them carried over, and
                    // never twice (duplicates would inflate `attention`).
                    let contextual: Vec<_> = list
                        .iter()
                        .filter(|d| ["temp_fallback", "no_plot"].contains(&d.code.as_str()))
                        .filter(|d| !analysis.diagnostics.iter().any(|a| a.code == d.code))
                        .cloned()
                        .collect();
                    list = analysis.diagnostics.clone();
                    list.extend(contextual);
                }
                Ok((row, list, analysis))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut rows = Vec::with_capacity(parsed.len());
        let mut findings = Vec::with_capacity(parsed.len());
        let mut analyses = Vec::with_capacity(parsed.len());
        for (row, list, analysis) in parsed {
            rows.push(row);
            findings.push(list);
            analyses.push(analysis);
        }
        let cfg = self.get_config()?;
        let baseline = crate::diagnostics::baselines(&rows, &analyses, &cfg.diagnostics);
        db.execute("INSERT INTO meta(key,value) VALUES('diagnostic_baseline',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&baseline)?])?;
        let zone: chrono_tz::Tz = cfg
            .time_zone
            .parse()
            .map_err(|_| Error::Invalid("invalid timezone".into()))?;
        crate::diagnostics::contextualise(
            &mut rows,
            &mut findings,
            &analyses,
            &baseline,
            &cfg.diagnostics,
            zone,
        );
        let texts_out = rows
            .par_iter_mut()
            .zip(findings.into_par_iter())
            .map(|(row, mut f)| {
                let lag = row.get("valveLagS").and_then(Value::as_f64).unwrap_or(0.);
                crate::diagnostics::decorate(row, &mut f, lag);
                Ok((serde_json::to_string(row)?, serde_json::to_string(&f)?))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut changed = BTreeSet::new();
        for (((id, old_row), (old_f, _)), (row_text, findings_text)) in
            texts.iter().zip(&stored).zip(texts_out)
        {
            if &row_text != old_row {
                db.prepare_cached("UPDATE fluxes SET row=?2 WHERE id=?1")?
                    .execute(params![id, row_text])?;
                changed.insert(*id);
            }
            if old_f.as_deref() != Some(findings_text.as_str()) {
                db.prepare_cached("INSERT INTO diagnostics(flux_id,findings) VALUES(?1,?2) ON CONFLICT(flux_id) DO UPDATE SET findings=excluded.findings")?
                    .execute(params![id, findings_text])?;
                changed.insert(*id);
            }
        }
        Ok(changed)
    }

    pub fn diagnostics_summary(&self) -> Result<Vec<crate::diagnostics::DiagnosticSummary>> {
        let rows = self.rows()?;
        let mut stored = self
            .db()?
            .prepare_cached("SELECT flux_id,findings FROM diagnostics")?;
        let mut stored: BTreeMap<i64, String> = stored
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        let findings = rows
            .iter()
            .map(|row| {
                let list: Vec<crate::diagnostics::Diagnostic> = stored
                    .remove(&row["id"].as_i64().unwrap_or(0))
                    .map(|s| serde_json::from_str(&s))
                    .transpose()?
                    .unwrap_or_default();
                Ok((row["reviewed"] == true, list))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut out = vec![];
        for (code, label, description) in crate::diagnostics::RULES {
            let mut count = 0;
            let mut unreviewed = 0;
            let mut severity = "info".to_string();
            for (reviewed, list) in &findings {
                let mut hit = false;
                for d in list.iter().filter(|d| d.code == code) {
                    hit = true;
                    if crate::diagnostics::rank(&d.severity) > crate::diagnostics::rank(&severity) {
                        severity = d.severity.clone();
                    }
                }
                if hit {
                    count += 1;
                    if !reviewed {
                        unreviewed += 1;
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
        let recalls: Vec<_> = [5, 10, 20]
            .into_iter()
            .map(|pct| {
                let n = (ranked.len() * pct).div_ceil(100);
                let hits = ranked[..n].iter().filter(|r| r["excluded"] == true).count();
                json!({
                "topPercent":pct,
                "rows":n,
                "excludedFound":hits,
                "excludedTotal":excluded,
                "share":if excluded>0{
                hits as f64/excluded as f64}
                else{
                0.}
                ,
                "cutoffAttention":ranked.get(n.saturating_sub(1)).and_then(|r|r.get("attention"))}
                )
            })
            .collect();

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
        let dates: Vec<_> = by_date
            .into_iter()
            .map(|(date, v)| {
                json!({
                "date":date,
                "measurements":v.len(),
                "median":crate::diagnostics::median(&v),
                "min":v.iter().copied().fold(f64::INFINITY,
                f64::min),
                "max":v.iter().copied().fold(f64::NEG_INFINITY,
                f64::max)}
                )
            })
            .collect();

        let baseline: crate::diagnostics::Baseline = self.meta("diagnostic_baseline")?;
        let mut severity_counts = BTreeMap::new();
        for (code, _, _) in crate::diagnostics::RULES {
            let mut counts = [0usize; 3];
            for r in &robot {
                let findings = self.load_findings(r["id"].as_i64().unwrap_or(0))?;
                if let Some(worst) = findings
                    .iter()
                    .filter(|d| d.code == code)
                    .map(|d| crate::diagnostics::rank(&d.severity))
                    .max()
                {
                    counts[worst as usize - 1] += 1;
                }
            }
            severity_counts.insert(
                code,
                json!({"info":counts[0],"warn":counts[1],"bad":counts[2]}),
            );
        }
        let summary_row = |r: &FluxRow| {
            let mut row = r.clone();
            row.retain(|k, _| {
                [
                    "id",
                    "time",
                    "filename",
                    "side",
                    "attention",
                    "diag",
                    "excluded",
                    "N2O_flux",
                    "N2O_robustFlux",
                    "N2O_impact",
                    "CO2_flux",
                    "CO2_robustFlux",
                    "CO2_impact",
                    "valveLagS",
                    "N2O_lagS",
                ]
                .contains(&k.as_str())
            });
            row
        };
        let top40: Vec<_> = ranked.iter().take(40).map(|r| summary_row(r)).collect();
        let legacy_ranks: Vec<_> = ranked
            .iter()
            .enumerate()
            .filter(|(_, r)| r["excluded"] == true)
            .map(|(rank, r)| json!({"rank":rank+1,"flux":summary_row(r)}))
            .collect();
        let mut impact_order = robot.clone();
        impact_order.sort_by(|a, b| {
            b.get("N2O_impact")
                .and_then(Value::as_f64)
                .unwrap_or(0.)
                .total_cmp(&a.get("N2O_impact").and_then(Value::as_f64).unwrap_or(0.))
        });
        let impacts: Vec<_> = impact_order
            .iter()
            .take(30)
            .map(|r| summary_row(r))
            .collect();
        let bad = robot
            .iter()
            .filter(|r| r["attention"].as_f64().unwrap_or(0.) >= 70.)
            .count();
        let warn = robot
            .iter()
            .filter(|r| (30. ..70.).contains(&r["attention"].as_f64().unwrap_or(0.)))
            .count();
        Ok(json!({
        "noiseFloors": baseline,
        "severityCounts": severity_counts,
        "queue": {
            "bad": bad,
            "warn": warn,
            "badFraction": bad as f64 / robot.len().max(1) as f64,
            "badWarnFraction": (bad + warn) as f64 / robot.len().max(1) as f64
        },
        "top40": top40,
        "legacyExcludedRanks": legacy_ranks,
        "top30N2OImpact": impacts,
        "robotFluxes":robot.len(),
        "excluded":excluded,
        "notExcluded":robot.len()-excluded,
        "codes":codes,
        "ranking":recalls,
        "excludedWithoutFindings":no_findings,
        "valveLag":{
        "measurements":lags.len(),
        "quantiles":[quantile(0.),
        quantile(0.1),
        quantile(0.5),
        quantile(0.9),
        quantile(1.)],
        "histogram":histogram,
        "byDate":dates}
        ,
        "thresholds":cfg.diagnostics}
        ))
    }
}
