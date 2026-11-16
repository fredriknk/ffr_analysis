use super::*;

impl Session {
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
        writer.flush().map_err(|e| Error::at(&args.path, e))?;
        Ok(())
    }

    pub(super) fn export_rows(&self, args: &ExportArgs) -> Result<Vec<FluxRow>> {
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
        book.save(&args.path)
            .map_err(|e| Error::Invalid(format!("{}: {e}", args.path)))?;
        Ok(())
    }
}
