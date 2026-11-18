use super::*;

impl Session {
    pub(super) fn rows(&self) -> Result<Vec<FluxRow>> {
        let mut q = self
            .db()?
            .prepare_cached("SELECT row FROM fluxes ORDER BY id")?;
        let strings = q
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        strings
            .par_iter()
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
        // One bulk read also decorates older projects without recomputing raw traces.
        let mut statement = self
            .db()?
            .prepare("SELECT flux_id,findings FROM diagnostics")?;
        let levels = statement
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut maps = levels
            .par_iter()
            .map(|(id, raw)| {
                let findings: Vec<crate::diagnostics::Diagnostic> = serde_json::from_str(raw)?;
                Ok((*id, crate::diagnostics::severity_map(&findings)))
            })
            .collect::<Result<BTreeMap<_, _>>>()?;
        for row in &mut rows {
            let id = row["id"].as_i64().unwrap_or(0);
            row.insert(
                "diagSeverity".into(),
                json!(maps.remove(&id).unwrap_or_default()),
            );
        }

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
            keys.insert(format!("{gas}_excluded"), "boolean".into());
        }
        for series in self.series_value()? {
            if let Some(name) = series["key"].as_str() {
                keys.insert(name.into(), "number".into());
            }
        }
        // Inputs of the per-gas `<gas>_excluded` columns, not columns themselves.
        let internal = ["autoExcludedGases", "gasExcluded"];
        for row in &rows {
            for (k, v) in row {
                if internal.contains(&k.as_str()) {
                    continue;
                }
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
            r.flux_factor *= cfg.pressure / 101000. * cfg.chamber_height / 0.5;
            if r.gas == "N2O" {
                r.qc = regression::qc_with(r, side, &cfg.qc);
            }
        }
        // Diagnostics judge the ordinary fit; the reported one may be robust.
        let ordinary = results.clone();
        let robust_used = crate::diagnostics::apply_fit_method(
            &raw,
            side,
            &options,
            &mut results,
            &cfg.diagnostics,
        );
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
                // Same shifted switches and cuts as the regression, so the
                // emphasised points are exactly the fitted ones.
                let mut used = vec![false; t.len()];
                if let Some(indices) = robust_used.get(gas) {
                    for i in indices {
                        used[*i] = true;
                    }
                } else if let Some(r) = results.get(gas) {
                    for i in crate::diagnostics::used_indices(&raw, gas, side, &options, r) {
                        used[i] = true;
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
            crate::diagnostics::analyse(&raw, side, &options, &ordinary, &cfg.diagnostics, lag)
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
            .map(|l| l.lag_s);
        let valve_lag = analysis
            .lags
            .get("CO2")
            .map_or(lag.0 + options.valve_offset, |l| l.lag_s);
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
            let dropped: Vec<&str> = diagnostics
                .iter()
                .filter(|d| d.code == "zero_readings")
                .filter_map(|d| d.gas.as_deref())
                .collect();
            row.insert("autoExcludedGases".into(), json!(dropped));
            apply_gas_exclusion(&mut row);
        }
        crate::diagnostics::decorate(&mut row, &mut diagnostics, valve_lag);
        Ok(json!({
        "robust":analysis.robust,"N2O_lagS":n2o_lag,
        "diagnostics":diagnostics,
        "valveLagS":valve_lag,
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
        let new_text = options.as_ref().map(serde_json::to_string).transpose()?;
        let new_value = options.as_ref().map(serde_json::to_value).transpose()?;
        for id in ids {
            let old: Option<String> =
                self.db()?
                    .query_row("SELECT options FROM fluxes WHERE id=?1", [id], |r| r.get(0))?;
            let old_value = old
                .as_deref()
                .map(serde_json::from_str::<Value>)
                .transpose()?;
            if old_value == new_value {
                continue;
            }
            before.push(json!({"id":id,"options":old_value.unwrap_or(Value::Null)}));
            after.push(json!({"id":id,"options":options}));
            self.db()?.execute(
                "UPDATE fluxes SET options=?2 WHERE id=?1",
                params![id, new_text],
            )?;
            self.recompute_one(*id)?;
        }
        if before.is_empty() {
            return self.edited_rows(ids, BTreeSet::new());
        }
        let changed = self.neighbour_pass()?;
        self.log(
            "optionsBatch",
            None,
            &json!(before),
            &json!(after),
            "edit",
            None,
        )?;
        tx.commit()?;
        self.edited_rows(ids, changed)
    }

    pub fn set_flux_flags(&self, ids: &[i64], flags: Value) -> Result<Vec<FluxRow>> {
        let tx = self.db()?.unchecked_transaction()?;
        let mut before = vec![];
        let mut after = vec![];
        // `reviewed` and `note` never affect results or diagnostics; only
        // `excluded` (cohorts) and `plotOverride` (plot, neighbours) do.
        let mut rescore = false;
        for id in ids {
            let mut row = self.row(*id)?;
            let mut differs = false;
            let mut reassign = false;
            // `gasExcluded: {gas: bool | null}` merges into this flux's choices;
            // null returns that gas to the automatic rule.
            let mut flags = flags.clone();
            if let Some(patch) = flags.get("gasExcluded").and_then(Value::as_object) {
                let mut merged = row
                    .get("gasExcluded")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                for (gas, v) in patch {
                    if v.is_null() {
                        merged.remove(gas);
                    } else {
                        merged.insert(gas.clone(), v.clone());
                    }
                }
                if merged.is_empty() && !row.contains_key("gasExcluded") {
                    if let Some(f) = flags.as_object_mut() {
                        f.remove("gasExcluded");
                    }
                } else {
                    flags["gasExcluded"] = Value::Object(merged);
                }
            }
            for key in [
                "excluded",
                "reviewed",
                "note",
                "plotOverride",
                "gasExcluded",
            ] {
                if let Some(v) = flags.get(key) {
                    if row.get(key).unwrap_or(&Value::Null) != v {
                        differs = true;
                        reassign |= key == "plotOverride";
                        rescore |= matches!(key, "excluded" | "plotOverride");
                    }
                }
            }
            if !differs {
                continue;
            }
            before.push(serde_json::to_value(&row)?);
            for key in [
                "excluded",
                "reviewed",
                "note",
                "plotOverride",
                "gasExcluded",
            ] {
                if let Some(v) = flags.get(key) {
                    row.insert(key.into(), v.clone());
                }
            }
            apply_gas_exclusion(&mut row);
            after.push(serde_json::to_value(&row)?);
            self.write_row(*id, &row)?;
            if reassign {
                self.recompute_one(*id)?;
            }
        }
        if before.is_empty() {
            return self.edited_rows(ids, BTreeSet::new());
        }
        let changed = if rescore {
            self.neighbour_pass()?
        } else {
            BTreeSet::new()
        };
        self.log(
            "flagsBatch",
            None,
            &json!(before),
            &json!(after),
            "edit",
            None,
        )?;
        tx.commit()?;
        self.edited_rows(ids, changed)
    }

    /// Rows for the edited ids, followed by any other rows whose scores the
    /// project-wide pass changed, so the UI can patch its table in place.
    pub(super) fn edited_rows(&self, ids: &[i64], changed: BTreeSet<i64>) -> Result<Vec<FluxRow>> {
        let requested: BTreeSet<i64> = ids.iter().copied().collect();
        let mut out = ids
            .iter()
            .map(|id| self.row(*id))
            .collect::<Result<Vec<_>>>()?;
        let others: Vec<i64> = changed
            .into_iter()
            .filter(|id| !requested.contains(id))
            .collect();
        if others.len() > 16 {
            let wanted: BTreeSet<i64> = others.into_iter().collect();
            out.extend(
                self.rows()?
                    .into_iter()
                    .filter(|r| r["id"].as_i64().is_some_and(|id| wanted.contains(&id))),
            );
        } else {
            for id in others {
                out.push(self.row(id)?);
            }
        }
        Ok(out)
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
                    "fit",
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
        let changed = self.neighbour_pass()?;
        self.log(
            "optionsBatch",
            None,
            &json!(before),
            &json!(after),
            "edit",
            None,
        )?;
        tx.commit()?;
        self.edited_rows(ids, changed)
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
