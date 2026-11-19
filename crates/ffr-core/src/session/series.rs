use super::*;

impl Session {
    pub(super) fn cached_values(&self, id: i64) -> Result<()> {
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

    pub(super) fn weather(&self, time: i64, key: &str) -> Result<Option<f64>> {
        for s in self.series_value()? {
            if s["key"] == key {
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

    pub(super) fn series_value(&self) -> Result<Vec<Value>> {
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
                if v.get("key").is_none() {
                    v["key"] = v["name"].clone();
                }
                let (label, unit) = column_spec(v["key"].as_str().unwrap_or(""));
                v["name"] = json!(label);
                if v["unit"].as_str().unwrap_or("").is_empty() {
                    v["unit"] = json!(unit);
                }
                Ok(v)
            })
            .collect()
    }

    pub(super) fn series_data_value(
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
        let metadata = json!({
        "key":name,
        "name":column_spec(name).0,
        "unit":unit,
        "maxGap":max_gap,
        "count":points.len(),
        "timeRange":points.first().zip(points.last()).map(|(a,
        b)|json!([a["time"],
        b["time"]]))}
        );

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

    pub fn metno_get_client_id(&self) -> bool {
        self.client_id.is_some()
    }

    pub fn metno_set_client_id(&mut self, id: String) {
        let id = id.trim();
        if !id.is_empty() {
            self.client_id = Some(id.to_owned());
        }
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
            let response:Value=client.get("https://frost.met.no/observations/v0.jsonld").basic_auth(id,
Some("")).query(&[("sources",
args["station"].as_str().unwrap_or("SN17850")),
("elements",
"air_temperature,max(air_temperature PT1H),min(air_temperature PT1H),sum(precipitation_amount PT1H)"),
("referencetime",
&range)]).send().and_then(|r|r.error_for_status()).and_then(|r|r.json()).map_err(|e|Error::Invalid(e.to_string()))?;

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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frost_client_id_ignores_empty_entries_and_stays_out_of_project() {
        let mut session = Session::default();
        session.metno_set_client_id(String::new());
        assert!(!session.metno_get_client_id());

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("weather.ffr");
        session
            .project_create(path.to_str().unwrap(), "Weather")
            .unwrap();
        session.metno_set_client_id("  synthetic-frost-id  ".into());
        session.metno_set_client_id(" \t".into());
        assert!(session.metno_get_client_id());
        assert_eq!(session.client_id.as_deref(), Some("synthetic-frost-id"));
        session.metno_set_client_id("synthetic-replacement-id".into());
        assert_eq!(
            session.client_id.as_deref(),
            Some("synthetic-replacement-id")
        );
        session.project_close();

        let bytes = std::fs::read(&path).unwrap();
        for id in ["synthetic-frost-id", "synthetic-replacement-id"] {
            assert!(!bytes
                .windows(id.len())
                .any(|window| window == id.as_bytes()));
        }
        let mut reopened = Session::default();
        reopened.project_open(path.to_str().unwrap()).unwrap();
        assert!(!reopened.metno_get_client_id());
    }
}
