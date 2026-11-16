use super::*;

impl Session {
    pub(super) fn rows(&self) -> Result<Vec<FluxRow>> {
        let mut q = self.db()?.prepare("SELECT row FROM fluxes ORDER BY id")?;
        let strings = q
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        strings
            .iter()
            .map(|s| Ok(serde_json::from_str(s)?))
            .collect()
    }

    pub(super) fn row(&self, id: i64) -> Result<FluxRow> {
        let s: String = self
            .db()?
            .query_row("SELECT row FROM fluxes WHERE id=?1", [id], |r| r.get(0))?;
        Ok(serde_json::from_str(&s)?)
    }

    pub(super) fn join_rows(&self, rows: &mut [FluxRow]) -> Result<()> {
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
            let name = meta["key"].as_str().unwrap_or("");
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
            ("N2O_lagS", "number"),
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
        for gas in ["N2O", "CO2"] {
            for suffix in ["robustFlux", "impact", "seFlux"] {
                keys.insert(format!("{gas}_{suffix}"), "number".into());
            }
        }
        for gas in regression::GASES {
            for suffix in ["slope", "rsq", "pval", "flux", "n", "resid"] {
                keys.insert(format!("{gas}_{suffix}"), "number".into());
            }
        }
        for series in self.series_value()? {
            if let Some(name) = series["key"].as_str() {
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
        let series_labels: BTreeMap<String, (String, String)> = self
            .series_value()?
            .into_iter()
            .filter_map(|s| {
                Some((
                    s["key"].as_str()?.into(),
                    (s["name"].as_str()?.into(), s["unit"].as_str()?.into()),
                ))
            })
            .collect();
        let columns = keys
            .iter()
            .map(|(k, t)| ColumnMeta {
                key: k.clone(),
                label: series_labels
                    .get(k)
                    .cloned()
                    .unwrap_or_else(|| column_spec(k))
                    .0,
                unit: Some(
                    series_labels
                        .get(k)
                        .cloned()
                        .unwrap_or_else(|| column_spec(k))
                        .1,
                ),
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

    pub(super) fn options(&self, id: i64) -> Result<(AnalysisOptions, bool)> {
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

    pub(super) fn measurement(&self, id: i64) -> Result<Raw> {
        let (meta, bytes): (String, Vec<u8>) = self.db()?.query_row(
            "SELECT metadata,raw FROM measurements WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let original = serde_json::from_slice(&zstd::stream::decode_all(&bytes[..])?)?;
        raw::from_value(serde_json::from_str(&meta)?, original)
    }

    pub(super) fn detail(&self, id: i64, preview: Option<AnalysisOptions>) -> Result<Value> {
        let mut row = self.row(id)?;
        self.join_rows(std::slice::from_mut(&mut row))?;
        let (stored, overridden) = self.options(id)?;
        let is_preview = preview.is_some();
        let options = preview.unwrap_or(stored);
        let Some(mid) = row["measurementId"].as_i64() else {
            return Ok(json!({
            "flux":row,
            "options":options,
            "isOverridden":overridden,
            "siblingFluxId":null,
            "switches":[],
            "traces":[],
            "regressions":[],
            "sibling":[],
            "diagnostics":[],
            "valveLagS":0.}
            ));
        };
        let raw = match self.measurement(mid) {
            Ok(raw) => raw,
            Err(_) => {
                return Ok(json!({
                "flux":row,
                "options":options,
                "isOverridden":overridden,
                "siblingFluxId":null,
                "switches":[],
                "traces":[],
                "regressions":[],
                "sibling":[],
                "diagnostics":self.load_findings(id)?,
                "valveLagS":0.}
                ))
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
                let options = options.for_gas(gas);
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
        let analysis = if is_preview {
            crate::diagnostics::analyse(&raw, side, &options, &results, &cfg.diagnostics, lag)
        } else {
            self.load_analysis(id)?
        };
        let diagnostics = if is_preview {
            analysis.diagnostics.clone()
        } else {
            self.load_findings(id)?
        };
        let n2o_lag = analysis
            .lags
            .get("N2O")
            .filter(|l| l.meaningful)
            .map_or(0., |l| l.lag_s);
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
        let mut diagnostics = diagnostics;
        if is_preview {
            let baseline: crate::diagnostics::Baseline = self.meta("diagnostic_baseline")?;
            let mut rows = vec![row.clone()];
            let mut f = vec![diagnostics];
            crate::diagnostics::contextualise(
                &mut rows,
                &mut f,
                std::slice::from_ref(&analysis),
                &baseline,
                &cfg.diagnostics,
                cfg.time_zone
                    .parse()
                    .map_err(|_| Error::Invalid("time zone".into()))?,
            );
            row = rows.remove(0);
            diagnostics = f.remove(0);
        }
        crate::diagnostics::decorate(&mut row, &mut diagnostics, lag.0 + options.valve_offset);
        Ok(json!({
        "robust":analysis.robust,"N2O_lagS":n2o_lag,
        "diagnostics":diagnostics,
        "valveLagS":lag.0+options.valve_offset,
        "flux":row,
        "options":options,
        "isOverridden":overridden,
        "siblingFluxId":sibling.as_ref().map(|s|s.0),
        "switches":raw.switches.iter().map(|(t,
        s)|json!({
        "t":t,
        "side":if *s==1{
        "left"}
        else{
        "right"}
        }
        )).collect::<Vec<_>>(),
        "traces":traces,
        "regressions":results.values().collect::<Vec<_>>(),
        "sibling":sibling_results.as_object().map(|m|m.values().collect::<Vec<_>>()).unwrap_or_default()}
        ))
    }

    pub fn get_flux_detail(&self, id: i64) -> Result<FluxDetail> {
        Ok(serde_json::from_value(self.detail(id, None)?)?)
    }

    pub fn preview_flux(&self, id: i64, options: AnalysisOptions) -> Result<FluxDetail> {
        options.validate()?;
        Ok(serde_json::from_value(self.detail(id, Some(options))?)?)
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
        ids.iter().map(|id| self.row(*id)).collect()
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
        ids.iter().map(|id| self.row(*id)).collect()
    }

    pub(super) fn write_row(&self, id: i64, row: &FluxRow) -> Result<()> {
        self.db()?.execute(
            "UPDATE fluxes SET row=?2 WHERE id=?1",
            params![id, serde_json::to_string(row)?],
        )?;
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
}
