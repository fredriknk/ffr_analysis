use super::*;
use serde_json::{json, Value};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RobustFit {
    pub gas: String,
    pub slope: f64,
    pub intercept: f64,
    pub start: f64,
    pub stop: f64,
    pub n: usize,
    pub flux: f64,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LagEstimate {
    pub lag_s: f64,
    pub improvement: f64,
    pub meaningful: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GasBaseline {
    pub floor: f64,
    pub median_residual_sd: f64,
}
pub type Baseline = BTreeMap<String, GasBaseline>;
pub fn conversion(r: &Regression) -> f64 {
    if r.flux_factor > 0. {
        r.flux_factor
    } else if r.slope != 0. {
        (r.flux / r.slope).abs()
    } else {
        0.
    }
}
pub fn robust_fits(
    raw: &Raw,
    side: u8,
    o: &AnalysisOptions,
    results: &BTreeMap<String, Regression>,
    c: &DiagnosticsConfig,
) -> (Vec<RobustFit>, BTreeMap<String, LagEstimate>) {
    let mut fits = vec![];
    let mut lags = BTreeMap::new();
    for gas in ["N2O", "CO2"] {
        let Some(r) = results.get(gas) else {
            continue;
        };
        if r.n == 0 {
            continue;
        }
        let effective = o.for_gas(gas);
        let Some((t, y)) = raw.channels.get(gas) else {
            continue;
        };
        let (estimated_delta, estimated_improvement) = valve_lag_for(raw, gas, &effective, c);
        let meaningful = if gas == "N2O" || gas == "CO2" {
            let mut levels = vec![];
            let mut noises = vec![];
            for chamber in [1, 2] {
                let ranges = group_ranges(
                    t,
                    &shifted(raw, effective.valve_offset + estimated_delta),
                    effective.cut_beginnings + 3.,
                    effective.cut_ends + 3.,
                );
                let (x, v): (Vec<_>, Vec<_>) = ranges
                    .iter()
                    .filter(|p| p.2 == chamber)
                    .flat_map(|p| p.0..p.1)
                    .filter(|i| y[*i] != 0.)
                    .map(|i| (t[i], y[i]))
                    .unzip();
                if let Ok(f) = regression::fit(&x, &v) {
                    let middle = t[t.len() / 2];
                    levels.push(f.intercept + f.slope * middle);
                    let residuals: Vec<_> = x
                        .iter()
                        .zip(&v)
                        .map(|(t, y)| y - f.intercept - f.slope * t)
                        .collect();
                    noises.push(mad(&residuals));
                }
            }
            levels.len() == 2
                && (levels[0] - levels[1]).abs() > c.lag_contrast_sd * median(&noises).max(1e-10)
        } else {
            true
        };
        let (delta, improvement) = if meaningful {
            (estimated_delta, estimated_improvement)
        } else {
            (0., 0.)
        };
        lags.insert(
            gas.into(),
            LagEstimate {
                lag_s: effective.valve_offset + delta,
                improvement,
                meaningful,
            },
        );
        let offset = effective.valve_offset
            + if delta.abs() >= 1. && improvement >= c.valve_min_improvement {
                delta
            } else {
                0.
            };
        let ranges = group_ranges(
            t,
            &shifted(raw, offset),
            effective.cut_beginnings + c.extra_cut_s,
            effective.cut_ends + c.extra_cut_s,
        );
        let mut indices: Vec<usize> = ranges
            .into_iter()
            .filter(|p| p.2 == side)
            .flat_map(|p| p.0..p.1)
            .filter(|i| y[*i] != 0. && t[*i] >= r.start && t[*i] < r.stop)
            .collect();
        for _ in 0..2 {
            let x: Vec<_> = indices.iter().map(|i| t[*i]).collect();
            let v: Vec<_> = indices.iter().map(|i| y[*i]).collect();
            let Ok(f) = regression::fit(&x, &v) else {
                break;
            };
            let residuals: Vec<_> = indices
                .iter()
                .map(|i| y[*i] - f.intercept - f.slope * t[*i])
                .collect();
            let centre = median(&residuals);
            let scale = mad(&residuals).max(1e-12);
            let keep: Vec<_> = indices
                .iter()
                .zip(&residuals)
                .filter(|(_, v)| (**v - centre).abs() <= c.robust_mad * scale)
                .map(|(i, _)| *i)
                .collect();
            if keep.len() < 3 || keep.len() == indices.len() {
                break;
            }
            indices = keep;
        }
        let x: Vec<_> = indices.iter().map(|i| t[*i]).collect();
        let v: Vec<_> = indices.iter().map(|i| y[*i]).collect();
        if let Ok(f) = regression::fit(&x, &v) {
            fits.push(RobustFit {
                gas: gas.into(),
                slope: f.slope,
                intercept: f.intercept,
                start: r.start,
                stop: r.stop,
                n: f.n,
                flux: f.slope * conversion(r),
            });
        }
    }
    (fits, lags)
}
pub fn baselines(rows: &[FluxRow]) -> Baseline {
    let mut out = Baseline::new();
    for gas in ["N2O", "CO2"] {
        let get = |suffix: &str| {
            let key = format!("{gas}_{suffix}");
            rows.iter()
                .filter(|r| r["source"] == "robot" && r["excluded"] != true)
                .filter_map(|r| r.get(&key).and_then(Value::as_f64))
                .filter(|v| v.is_finite() && *v >= 0.)
                .collect::<Vec<_>>()
        };
        let se = get("seFlux");
        let noise = get("resid");
        out.insert(
            gas.into(),
            GasBaseline {
                floor: if se.is_empty() { 0. } else { 3. * median(&se) },
                median_residual_sd: if noise.is_empty() { 0. } else { median(&noise) },
            },
        );
    }
    out
}
pub fn impact(original: f64, robust: f64, floor: f64) -> f64 {
    (original - robust).abs() / original.abs().max(robust.abs()).max(floor).max(1e-30)
}
fn local_day(row: &FluxRow, zone: chrono_tz::Tz) -> String {
    chrono::DateTime::from_timestamp_millis(row["time"].as_i64().unwrap_or(0))
        .map(|d| d.with_timezone(&zone).date_naive().to_string())
        .unwrap_or_default()
}
pub fn contextualise(
    rows: &mut [FluxRow],
    findings: &mut [Vec<Diagnostic>],
    analysis: &[Findings],
    baseline: &Baseline,
    c: &DiagnosticsConfig,
    zone: chrono_tz::Tz,
) {
    let mut day_values: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    let mut siblings = BTreeMap::<i64, Vec<usize>>::new();
    for (i, r) in rows
        .iter()
        .enumerate()
        .filter(|(_, r)| r["source"] == "robot")
    {
        if let Some(mid) = r["measurementId"].as_i64() {
            siblings.entry(mid).or_default().push(i);
        }
        if r["excluded"] != true {
            if let Some(v) = r.get("CO2_flux").and_then(Value::as_f64) {
                day_values.entry(local_day(r, zone)).or_default().push(v);
            }
        }
    }
    let snapshot = rows.to_vec();
    for (i, r) in rows.iter_mut().enumerate() {
        if r["source"] != "robot" {
            continue;
        }
        findings[i].retain(|d| {
            ![
                "n2o_negative",
                "co2_not_rising",
                "co2_low_r2",
                "chamber_leak",
                "neighbour_outlier",
                "noisy",
            ]
            .contains(&d.code.as_str())
        });
        let f = &analysis[i];
        for gas in ["N2O", "CO2"] {
            let floor = baseline[gas].floor;
            let original = r.get(&format!("{gas}_flux")).and_then(Value::as_f64);
            let robust = f.robust.iter().find(|f| f.gas == gas);
            let change = original
                .zip(robust)
                .map(|(v, rf)| impact(v, rf.flux, floor));
            r.insert(format!("{gas}_robustFlux"), json!(robust.map(|f| f.flux)));
            r.insert(format!("{gas}_impact"), json!(change));
            if let Some(lag) = f.lags.get(gas) {
                r.insert(
                    if gas == "CO2" {
                        "valveLagS".into()
                    } else {
                        "N2O_lagS".into()
                    },
                    json!(lag.meaningful.then_some(lag.lag_s)),
                );
            }
            let residual = r
                .get(&format!("{gas}_resid"))
                .and_then(Value::as_f64)
                .unwrap_or(0.);
            let median_noise = baseline[gas].median_residual_sd;
            if median_noise > 0. && residual > c.noisy_warn * median_noise {
                let ratio = residual / median_noise;
                findings[i].push(finding(
                    "noisy",
                    if ratio >= c.noisy_bad { "bad" } else { "warn" },
                    Some(gas),
                    ratio,
                    format!("Residual SD is {ratio:.1} times the project median for {gas}."),
                ));
            }
            for d in findings[i].iter_mut().filter(|d| {
                d.gas.as_deref() == Some(gas)
                    && ["valve_timing", "edge_transient", "spike"].contains(&d.code.as_str())
            }) {
                if let (Some(change), Some(original), Some(robust)) = (change, original, robust) {
                    d.severity = if change >= 0.3 {
                        "bad"
                    } else if change >= 0.1 {
                        "warn"
                    } else {
                        "info"
                    }
                    .into();
                    let units = if gas == "N2O" {
                        "ug N m^-2 h^-1"
                    } else {
                        "ug C m^-2 h^-1"
                    };
                    d.message = format!(
                        "{}: robust fit gives {:.1} instead of {:.1} {units}; impact={:.1}%",
                        d.code,
                        robust.flux,
                        original,
                        change * 100.
                    );
                }
            }
            findings[i].retain(|d| {
                d.code != "curvature"
                    || d.gas.as_deref() != Some(gas)
                    || f.half_differences.get(gas).is_some_and(|v| *v > 2. * floor)
            });
            if let Some(flux) = original {
                let p = r
                    .get(&format!("{gas}_pval"))
                    .and_then(Value::as_f64)
                    .unwrap_or(1.);
                if flux < -floor && p < c.n2o_negative_p {
                    let code = if gas == "CO2" {
                        "co2_not_rising"
                    } else {
                        "n2o_negative"
                    };
                    findings[i].push(finding(code,if gas=="CO2"||flux< -5.*floor{"bad"}else{"warn"},Some(gas),flux,format!("{gas} flux {flux:.1} is below the negative noise floor {negative_floor:.1} with p={p:.2e}.",negative_floor=-floor)));
                }
            }
        }
        let co2_floor = baseline["CO2"].floor;
        let n2o_floor = baseline["N2O"].floor;
        let values = day_values.get(&local_day(r, zone));
        let co2 = r.get("CO2_flux").and_then(Value::as_f64);
        let n2o = r.get("N2O_flux").and_then(Value::as_f64);
        let sibling = r["measurementId"]
            .as_i64()
            .and_then(|id| siblings.get(&id))
            .and_then(|v| v.iter().find(|j| **j != i))
            .map(|j| &snapshot[*j]);
        if let (Some(values), Some(co2)) = (values, co2) {
            let m = median(values);
            if values.len() >= 6 && m > 5. * co2_floor && co2 < 0.25 * m {
                let sibling_co2 = sibling
                    .and_then(|r| r.get("CO2_flux"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.);
                let sibling_n2o = sibling
                    .and_then(|r| r.get("N2O_flux"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.);
                let bad = sibling_co2 > 0.5 * m
                    || (sibling_n2o > 5. * n2o_floor
                        && n2o.is_some_and(|v| v < 0.25 * sibling_n2o));
                findings[i].push(finding("chamber_leak",if bad{"bad"}else{"warn"},Some("CO2"),co2/m,format!("CO2 is {:.0}% of the day's median ({m:.1}); sibling CO2 is {:.0}% of that median; N2O is {:.0}% of its sibling.",100.*co2/m,100.*sibling_co2/m,100.*n2o.unwrap_or(0.)/sibling_n2o.abs().max(n2o_floor))));
            }
        }
        let leak = findings[i].iter().any(|d| d.code == "chamber_leak");
        for d in &mut findings[i] {
            if d.code == "n2o_negative" && leak {
                d.severity = "bad".into();
            }
            if d.code == "few_points" && r["overridden"] == true {
                d.severity = "info".into();
            }
        }
    }
    neighbours_scaled(rows, findings, baseline, c);
}
fn neighbours_scaled(
    rows: &[FluxRow],
    findings: &mut [Vec<Diagnostic>],
    baseline: &Baseline,
    c: &DiagnosticsConfig,
) {
    for gas in ["N2O", "CO2"] {
        let key = format!("{gas}_flux");
        let floor = baseline[gas].floor.max(1e-12);
        let mut treatment: BTreeMap<i64, Vec<(i64, i64, f64)>> = BTreeMap::new();
        let mut plot = treatment.clone();
        for r in rows
            .iter()
            .filter(|r| r["source"] == "robot" && r["excluded"] != true)
        {
            let Some(v) = r.get(&key).and_then(Value::as_f64) else {
                continue;
            };
            let p = (
                r["time"].as_i64().unwrap_or(0),
                r["id"].as_i64().unwrap_or(0),
                v,
            );
            if let Some(id) = r["treatmentId"].as_i64() {
                treatment.entry(id).or_default().push(p);
            }
            if let Some(id) = r["plotId"].as_i64() {
                plot.entry(id).or_default().push(p);
            }
        }
        for v in treatment.values_mut().chain(plot.values_mut()) {
            v.sort_by_key(|p| p.0);
        }
        for (i, r) in rows
            .iter()
            .enumerate()
            .filter(|(_, r)| r["source"] == "robot")
        {
            let Some(v) = r.get(&key).and_then(Value::as_f64) else {
                continue;
            };
            let time = r["time"].as_i64().unwrap_or(0);
            let collect = |group: &BTreeMap<i64, Vec<(i64, i64, f64)>>, key: &str, days: f64| {
                let p = r[key]
                    .as_i64()
                    .and_then(|id| group.get(&id))
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                let span = (days * 86400000.) as i64;
                let a = p.partition_point(|p| p.0 < time - span);
                let b = p.partition_point(|p| p.0 <= time + span);
                p[a..b]
                    .iter()
                    .filter(|p| Some(p.1) != r["id"].as_i64())
                    .map(|p| p.2)
                    .collect::<Vec<_>>()
            };
            let mut values = collect(&treatment, "treatmentId", c.neighbour_days);
            if values.len() < c.min_neighbours {
                values = collect(&plot, "plotId", c.neighbour_fallback_days);
            }
            if values.len() < c.min_neighbours {
                continue;
            }
            let centre = median(&values);
            let scale = mad(&values).max(floor);
            let raw_z = (v - centre).abs() / scale;
            let transformed: Vec<_> = values.iter().map(|v| (v / scale).asinh()).collect();
            let z =
                ((v / scale).asinh() - median(&transformed)).abs() / mad(&transformed).max(0.15);
            if z > c.neighbour_z && raw_z > c.neighbour_raw_z {
                findings[i].push(finding("neighbour_outlier","warn",Some(gas),z,format!("Flux {v:.1} versus neighbour median {centre:.1}: raw z={raw_z:.1}, scaled-asinh z={z:.1}; {} non-excluded neighbours.",values.len())));
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn row(id: i64, co2: f64, n2o: f64) -> FluxRow {
        serde_json::from_value(json!({"id":id,"measurementId":(id+1)/2,"time":0,"source":"robot","excluded":false,"reviewed":false,"overridden":false,"treatmentId":1,"plotId":1,"CO2_flux":co2,"N2O_flux":n2o,"CO2_pval":0.0001,"N2O_pval":0.0001,"CO2_resid":1.,"N2O_resid":0.001})).expect("row")
    }
    fn baseline() -> Baseline {
        [
            (
                "N2O".into(),
                GasBaseline {
                    floor: 7.57,
                    median_residual_sd: 0.001,
                },
            ),
            (
                "CO2".into(),
                GasBaseline {
                    floor: 8237.,
                    median_residual_sd: 1.,
                },
            ),
        ]
        .into_iter()
        .collect()
    }
    #[test]
    fn noise_level_negative_is_not_a_leak() {
        let mut rows = vec![row(1, 200000., -4.)];
        let mut findings = vec![vec![]];
        contextualise(
            &mut rows,
            &mut findings,
            &[Findings::default()],
            &baseline(),
            &DiagnosticsConfig::default(),
            chrono_tz::Europe::Oslo,
        );
        assert!(!findings[0]
            .iter()
            .any(|d| ["n2o_negative", "chamber_leak"].contains(&d.code.as_str())));
    }
    #[test]
    fn strong_day_and_sibling_detect_flat_chamber() {
        let mut rows: Vec<_> = (1..=8).map(|i| row(i, 100000., 100.)).collect();
        rows[0] = row(1, 0., 0.);
        let mut f = vec![vec![]; 8];
        contextualise(
            &mut rows,
            &mut f,
            &vec![Findings::default(); 8],
            &baseline(),
            &DiagnosticsConfig::default(),
            chrono_tz::Europe::Oslo,
        );
        assert!(f[0]
            .iter()
            .any(|d| d.code == "chamber_leak" && d.severity == "bad"));
    }
    #[test]
    fn neighbour_scaling_recovers_large_winter_value() {
        // Generated mixed-sign, near-zero cohort; never use measured rows as fixtures.
        let values: Vec<f64> = (0..17)
            .map(|i| match i {
                1 => 200000.,
                6 => -100000.,
                12 => -200000.,
                _ => ((i % 9) + 1) as f64 * 2000.,
            })
            .collect();
        let mut rows: Vec<_> = values
            .iter()
            .enumerate()
            .map(|(i, v)| row(i as i64 + 1, *v, 20.))
            .collect();
        rows.push(row(99, 600000., 300.));
        let mut f = vec![vec![]; rows.len()];
        neighbours_scaled(&rows, &mut f, &baseline(), &DiagnosticsConfig::default());
        assert!(f
            .last()
            .expect("outlier")
            .iter()
            .any(|d| d.code == "neighbour_outlier" && d.gas.as_deref() == Some("CO2")));
    }
    #[test]
    fn legacy_only_scores_zero() {
        let mut d = vec![finding(
            "legacy_qc",
            "info",
            Some("N2O"),
            1.,
            "Outliers likely".into(),
        )];
        assert_eq!(score(&mut d), 0.);
    }
    #[test]
    fn standard_error_floor_and_impact() {
        let mut a = row(1, 1., 2.);
        a.insert("CO2_seFlux".into(), json!(2.));
        a.insert("N2O_seFlux".into(), json!(1.));
        let mut b = a.clone();
        b.insert("excluded".into(), json!(true));
        b.insert("CO2_seFlux".into(), json!(1000.));
        let floors = baselines(&[a, b]);
        assert_eq!(floors["CO2"].floor, 6.);
        assert!((impact(58., 41., 1.) - 17. / 58.).abs() < 1e-14);
    }
}
