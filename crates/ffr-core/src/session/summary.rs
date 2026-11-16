use super::*;

impl Session {
    pub(super) fn summary_value(&self, q: SummaryQuery) -> Result<Value> {
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
            plots.push(json!({
            "plotId":id,
            "label":rows[0]["plotLabel"],
            "treatmentId":rows[0]["treatmentId"],
            "total":cumulative,
            "points":points,
            "daily":daily}
            ));
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
            treatments.push(json!({
            "id":t["id"],
            "name":t["name"],
            "colour":t["colour"],
            "nPlots":ps.len(),
            "mean":mean(&totals),
            "sd":sd(&totals,
            0),
            "gmean":mean(&logs).exp(),
            "gsd":sd(&logs,
            1).exp(),
            "box":[quantile(0.),
            quantile(0.25),
            quantile(0.5),
            quantile(0.75),
            quantile(1.)]}
            ));
        }
        Ok(
            json!({"gas":q.gas,"unit":"ug m^-2 h^-1","cumulativeUnit":"kg ha^-1","treatments":treatments,"plots":plots}),
        )
    }

    pub fn treatment_summary(&self, q: SummaryQuery) -> Result<TreatmentSummary> {
        Ok(serde_json::from_value(self.summary_value(q)?)?)
    }
}
