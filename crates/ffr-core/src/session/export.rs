use super::summary::trapezoid;
use super::*;

const CUMULATIVE_GASES: [&str; 2] = ["N2O", "CO2"];
const HOUR_MS: f64 = 3_600_000.;

impl Session {
    pub fn export_csv(&self, args: ExportArgs) -> Result<()> {
        let rows = self.export_rows(&args)?;
        let mut writer = csv::Writer::from_path(&args.path)
            .map_err(|e| Error::Invalid(format!("{}: {e}", args.path)))?;
        writer
            .write_record(&args.columns)
            .map_err(|e| Error::Invalid(format!("{}: {e}", args.path)))?;
        for r in rows {
            writer
                .write_record(
                    args.columns
                        .iter()
                        .map(|k| cell_text(r.get(k).unwrap_or(&Value::Null))),
                )
                .map_err(|e| Error::Invalid(format!("{}: {e}", args.path)))?;
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
            if args.mode == "dailyPerPlot" && r.get("excluded") == Some(&Value::Bool(true)) {
                continue;
            }
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
                rows = daily_rows(rows, tz, &args.columns);
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

fn daily_rows(rows: Vec<FluxRow>, tz: chrono_tz::Tz, columns: &[String]) -> Vec<FluxRow> {
    let flux_keys = CUMULATIVE_GASES.map(|gas| format!("{gas}_flux"));
    let cumulative_keys = CUMULATIVE_GASES.map(|gas| format!("{gas}_cumulative"));
    let mut keys: BTreeSet<_> = columns.iter().chain(&flux_keys).collect();
    keys.retain(|key| *key != "time");
    let keys: Vec<_> = keys
        .into_iter()
        .map(|key| {
            let exclusion = regression::GASES.into_iter().find_map(|gas| {
                key.strip_prefix(gas)
                    .and_then(|suffix| suffix.strip_prefix('_'))
                    .filter(|suffix| *suffix != "excluded")
                    .map(|_| format!("{gas}_excluded"))
            });
            (key, exclusion)
        })
        .collect();
    let mut days: BTreeMap<i64, Vec<FluxRow>> = BTreeMap::new();
    for row in rows {
        let day = chrono::DateTime::from_timestamp_millis(row["time"].as_i64().unwrap_or(0))
            .and_then(|d| d.with_timezone(&tz).date_naive().and_hms_opt(0, 0, 0))
            .map_or(0, |d| d.and_utc().timestamp_millis());
        days.entry(day).or_default().push(row);
    }
    let mut previous_day = None;
    // A day can contribute to one gas while the other bridges it.
    let mut previous_gas_day = [None; CUMULATIVE_GASES.len()];
    let mut cumulative = [0.; CUMULATIVE_GASES.len()];
    days.into_iter()
        .map(|(day, rows)| {
            let mut row = FluxRow::new();
            for (key, exclusion) in &keys {
                let mut eligible = rows.iter().filter(|r| {
                    exclusion
                        .as_ref()
                        .is_none_or(|flag| r.get(flag) != Some(&Value::Bool(true)))
                });
                let first = eligible.next().and_then(|r| r.get(*key));
                let values: Vec<_> = first
                    .into_iter()
                    .chain(eligible.filter_map(|r| r.get(*key)))
                    .filter_map(number)
                    .collect();
                let value = if values.is_empty() {
                    first.cloned().unwrap_or(Value::Null)
                } else {
                    json!(mean(&values))
                };
                row.insert((*key).clone(), value);
            }
            for (i, key) in flux_keys.iter().enumerate() {
                if let Some(value) = row.get(key).and_then(number) {
                    if let Some((time, previous)) = previous_gas_day[i] {
                        let hours = (day - time) as f64 / HOUR_MS;
                        cumulative[i] += trapezoid(hours, previous, value, 1e-5);
                    }
                    previous_gas_day[i] = Some((day, value));
                }
                row.insert(cumulative_keys[i].clone(), json!(cumulative[i]));
            }
            let hours = previous_day.map_or(0., |time| (day - time) as f64 / HOUR_MS);
            row.insert("time".into(), json!(day));
            row.insert("timediffHours".into(), json!(hours));
            previous_day = Some(day);
            row
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::{open_workbook_auto, DataType, Reader};

    #[test]
    fn daily_export_applies_exclusions_and_bridges_gaps_per_gas() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = Session::default();
        session
            .project_create(
                dir.path().join("synthetic.ffr").to_str().unwrap(),
                "Synthetic",
            )
            .unwrap();
        let observations = [
            (
                0,
                json!({"excluded": true, "N2O_flux": 999, "CO2_flux": 999, "airTemp": 999}),
            ),
            (
                0,
                json!({"N2O_excluded": true, "N2O_flux": 999, "CO2_flux": 20, "airTemp": 10, "licor_H2O_flux": 999, "licor_H2O_excluded": true}),
            ),
            (
                0,
                json!({"N2O_flux": 10, "CO2_flux": 40, "airTemp": 20, "licor_H2O_flux": 4}),
            ),
            (
                1,
                json!({"N2O_excluded": true, "N2O_flux": 999, "CO2_flux": 60}),
            ),
            (
                2,
                json!({"excluded": true, "N2O_flux": 999, "CO2_flux": 999}),
            ),
            (
                3,
                json!({"N2O_flux": 30, "CO2_excluded": true, "CO2_flux": 999, "CO2_slope": 999}),
            ),
            (4, json!({"N2O_flux": 50, "CO2_flux": 80})),
        ];
        for (index, (day, mut row)) in observations.into_iter().enumerate() {
            let id = index as i64 + 1;
            if row.get("excluded").is_none() {
                row["excluded"] = json!(false);
            }
            row["id"] = json!(id);
            row["time"] = json!(43_200_000 + day * 86_400_000);
            row["plotId"] = json!(1);
            row["plotLabel"] = json!("P");
            row["treatmentId"] = json!(1);
            row["source"] = json!("robot");
            session
                .db()
                .unwrap()
                .execute(
                    "INSERT INTO fluxes(id,row,results) VALUES(?1,?2,'{}')",
                    params![id, row.to_string()],
                )
                .unwrap();
        }
        let columns = [
            "excluded",
            "N2O_excluded",
            "N2O_flux",
            "CO2_flux",
            "airTemp",
            "licor_H2O_flux",
            "CO2_slope",
        ];
        for mode in ["flat", "sheetPerPlot", "dailyPerPlot"] {
            let path = dir.path().join(format!("{mode}.xlsx"));
            session
                .export_xlsx(ExportArgs {
                    path: path.to_str().unwrap().into(),
                    flux_ids: (1..=7).collect(),
                    columns: columns.map(String::from).to_vec(),
                    mode: mode.into(),
                })
                .unwrap();
            let range = open_workbook_auto(path)
                .unwrap()
                .worksheet_range_at(0)
                .unwrap()
                .unwrap();
            let numeric = |row, col| range.get((row, col)).and_then(DataType::as_f64);
            if mode != "dailyPerPlot" {
                assert_eq!(range.height(), 8);
                assert_eq!(
                    range.get((1, 0)).and_then(DataType::get_string),
                    Some("true")
                );
                assert_eq!(
                    range.get((2, 1)).and_then(DataType::get_string),
                    Some("true")
                );
                assert_eq!(numeric(1, 2), Some(999.));
                assert_eq!(numeric(2, 2), Some(999.));
                continue;
            }
            assert_eq!(range.height(), 5);
            assert_eq!(numeric(1, 2), Some(10.));
            assert_eq!(numeric(1, 3), Some(30.));
            assert_eq!(numeric(1, 4), Some(15.));
            assert_eq!(numeric(1, 5), Some(4.));
            assert_eq!(numeric(2, 2), None);
            assert_eq!(numeric(3, 3), None);
            assert_eq!(numeric(3, 6), None);
            assert_eq!(numeric(3, 7), Some(48.));
            assert_eq!(numeric(2, 8), Some(0.));
            assert_eq!(numeric(3, 9), numeric(2, 9));
            for (gas, col) in [("N2O", 8), ("CO2", 9)] {
                let summary = session
                    .treatment_summary(SummaryQuery {
                        gas: gas.into(),
                        from: None,
                        to: None,
                        sources: vec!["robot".into()],
                        flux_ids: None,
                    })
                    .unwrap();
                let exported = numeric(4, col).unwrap();
                assert!((exported - summary.plots[0].total).abs() < 1e-12, "{gas}");
            }
        }
    }
}
