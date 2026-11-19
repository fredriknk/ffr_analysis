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
    /// The full refit and the points it used, for `fit: "robust"` (not stored).
    #[serde(skip)]
    pub fit: Option<Regression>,
    #[serde(skip)]
    pub indices: Vec<usize>,
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
                    effective.cut_beginnings + c.extra_cut_s,
                    effective.cut_ends + c.extra_cut_s,
                );
                let (x, v): (Vec<_>, Vec<_>) = ranges
                    .iter()
                    .filter(|p| p.2 == chamber)
                    .flat_map(|p| p.0..p.1)
                    .filter(|i| regression::valid(y[*i]))
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
        let offset = if c.uses_valve_lag(delta, improvement) {
            effective.valve_offset + delta
        } else {
            effective.valve_offset
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
            .filter(|i| regression::valid(y[*i]) && t[*i] >= r.start && t[*i] < r.stop)
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
                fit: Some(f),
                indices,
            });
        }
    }
    (fits, lags)
}
/// With `fit: "robust"`, replaces the N2O and CO2 regressions by their robust
/// refits (window bounds kept) so the reported flux is the robust one. Returns
/// the points each replaced fit used. Call after diagnostics, which compare the
/// ordinary fit with the robust one.
pub fn apply_fit_method(
    raw: &Raw,
    side: u8,
    o: &AnalysisOptions,
    results: &mut BTreeMap<String, Regression>,
    c: &DiagnosticsConfig,
) -> BTreeMap<String, Vec<usize>> {
    let mut used = BTreeMap::new();
    if !o.robust() {
        return used;
    }
    let (fits, _) = robust_fits(raw, side, o, results, c);
    for robust in fits {
        let (Some(f), Some(r)) = (robust.fit, results.get_mut(&robust.gas)) else {
            continue;
        };
        let factor = conversion(r);
        *r = Regression {
            flux_factor: r.flux_factor,
            gas: r.gas.clone(),
            start: r.start,
            stop: r.stop,
            flux: f.slope * factor,
            flux_unit: r.flux_unit.clone(),
            qc: r.qc.clone(),
            ..f
        };
        used.insert(robust.gas, robust.indices);
    }
    used
}
pub fn baselines(rows: &[FluxRow], analysis: &[Findings], c: &DiagnosticsConfig) -> Baseline {
    let mut out = Baseline::new();
    for gas in ["N2O", "CO2"] {
        let values = |suffix: &str| {
            let key = format!("{gas}_{suffix}");
            rows.iter()
                .enumerate()
                .filter(|(_, r)| r["source"] == "robot" && r["excluded"] != true)
                .filter_map(|(i, r)| {
                    if suffix == "seFlux" {
                        if let Some(ols) = analysis[i].ols.get(gas) {
                            return Some(ols.se_flux);
                        }
                    }
                    r.get(&key).and_then(Value::as_f64)
                })
                .filter(|v| v.is_finite() && *v >= 0.)
                .collect::<Vec<_>>()
        };
        let se = values("seFlux");
        let noise = values("resid");
        out.insert(
            gas.into(),
            GasBaseline {
                floor: if se.is_empty() {
                    0.
                } else {
                    c.noise_floor_multiplier * median(&se)
                },
                median_residual_sd: if noise.is_empty() { 0. } else { median(&noise) },
            },
        );
    }
    out
}
pub fn impact(original: f64, robust: f64, floor: f64) -> f64 {
    (original - robust).abs() / original.abs().max(robust.abs()).max(floor).max(1e-30)
}
fn grade_shapes(
    row: &FluxRow,
    findings: &mut [Diagnostic],
    analysis: &Findings,
    baseline: &Baseline,
    c: &DiagnosticsConfig,
) {
    let mut robust_max: f64 = 0.;
    let mut curvature_max: f64 = 0.;
    for gas in ["N2O", "CO2"] {
        let floor = baseline[gas].floor;
        let Some(flux) = ols_flux(row, analysis, gas) else {
            continue;
        };
        if let Some(robust) = analysis.robust.iter().find(|r| r.gas == gas) {
            if (flux - robust.flux).abs() > c.shape_floor_multiplier * floor {
                robust_max = robust_max.max(impact(flux, robust.flux, floor));
                if let Some(diff) = analysis.half_differences.get(gas) {
                    curvature_max = curvature_max.max(diff / flux.abs().max(floor).max(1e-30));
                }
            }
        }
    }
    for d in findings.iter_mut().filter(|d| {
        [
            "valve_timing",
            "edge_transient",
            "spike",
            "noisy",
            "curvature",
        ]
        .contains(&d.code.as_str())
    }) {
        let effective = if d.code == "curvature" {
            curvature_max
        } else {
            robust_max
        };
        d.impact = Some(effective);
        d.severity = if effective >= c.shape_bad_impact {
            "bad"
        } else if effective >= c.shape_warn_impact {
            "warn"
        } else {
            "info"
        }
        .into();
        if let Some(gas) = d.gas.as_deref() {
            if let (Some(flux), Some(robust)) = (
                ols_flux(row, analysis, gas),
                analysis.robust.iter().find(|r| r.gas == gas),
            ) {
                let unit = if gas == "N2O" {
                    "ug N m^-2 h^-1"
                } else {
                    "ug C m^-2 h^-1"
                };
                d.message = format!("{}: robust fit {:.1}, ordinary least-squares fit {flux:.1} {unit}. Effective impact {:.1}%.", d.code, robust.flux, 100. * effective);
            }
        }
    }
}
fn ols_flux(row: &FluxRow, analysis: &Findings, gas: &str) -> Option<f64> {
    analysis
        .ols
        .get(gas)
        .map(|fit| fit.flux)
        .or_else(|| row.get(&format!("{gas}_flux")).and_then(Value::as_f64))
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
    use rayon::prelude::*;
    let days: Vec<String> = rows.par_iter().map(|r| local_day(r, zone)).collect();
    let mut day_values: BTreeMap<&str, Vec<f64>> = BTreeMap::new();
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
                day_values.entry(&days[i]).or_default().push(v);
            }
        }
    }
    // The loop below only reads the siblings' fluxes, which it never changes.
    let sibling_fluxes: Vec<(f64, f64)> = rows
        .iter()
        .map(|r| {
            let get = |key: &str| r.get(key).and_then(Value::as_f64).unwrap_or(0.);
            (get("CO2_flux"), get("N2O_flux"))
        })
        .collect();
    rows.par_iter_mut()
        .zip(findings.par_iter_mut())
        .enumerate()
        .for_each(|(i, (r, findings))| {
        if r["source"] != "robot" {
            return;
        }
        findings.retain(|d| {
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
            let robust = f.robust.iter().find(|f| f.gas == gas);
            let change = ols_flux(r, f, gas)
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
                    if gas == "CO2" {
                        json!(lag.lag_s)
                    } else {
                        json!(lag.meaningful.then_some(lag.lag_s))
                    },
                );
            }
            let residual = r
                .get(&format!("{gas}_resid"))
                .and_then(Value::as_f64)
                .unwrap_or(0.);
            let median_noise = baseline[gas].median_residual_sd;
            if median_noise > 0. && residual > c.noisy_warn * median_noise {
                let ratio = residual / median_noise;
                findings.push(finding(
                    "noisy",
                    "info",
                    Some(gas),
                    ratio,
                    format!("Residual SD is {ratio:.1} times the project median for {gas}."),
                ));
            }
            if let Some(flux) = r.get(&format!("{gas}_flux")).and_then(Value::as_f64) {
                let p = r
                    .get(&format!("{gas}_pval"))
                    .and_then(Value::as_f64)
                    .unwrap_or(1.);
                let candidate_floor = if gas == "CO2" {
                    c.co2_negative_floor
                } else {
                    c.negative_info_floor
                } * floor;
                if flux < -candidate_floor && p < c.n2o_negative_p {
                    let code = if gas == "CO2" {
                        "co2_not_rising"
                    } else {
                        "n2o_negative"
                    };
                    let severity = if gas == "CO2" || flux < -c.negative_bad_floor * floor {
                        "bad"
                    } else if flux < -c.negative_warn_floor * floor {
                        "warn"
                    } else {
                        "info"
                    };
                    let negative_floor = -candidate_floor;
                    let message = format!(
                        "{gas} flux {flux:.1} is below the negative noise floor \
                         {negative_floor:.1} with p={p:.2e}."
                    );
                    findings.push(finding(code, severity, Some(gas), flux, message));
                }
            }
        }
        let co2_floor = baseline["CO2"].floor;
        let n2o_floor = baseline["N2O"].floor;
        let values = day_values.get(days[i].as_str());
        let co2 = r.get("CO2_flux").and_then(Value::as_f64);
        let n2o = r.get("N2O_flux").and_then(Value::as_f64);
        let sibling = r["measurementId"]
            .as_i64()
            .and_then(|id| siblings.get(&id))
            .and_then(|v| v.iter().find(|j| **j != i))
            .map(|j| sibling_fluxes[*j]);
        if let Some(co2) = co2 {
            let (sibling_co2, sibling_n2o) = sibling.unwrap_or((0., 0.));
            let low_n2o = sibling_n2o > c.leak_reference_floor * n2o_floor
                && n2o.is_some_and(|v| v < c.leak_fraction * sibling_n2o);
            let day = values
                .filter(|v| v.len() >= c.leak_min_day_points)
                .map(|v| median(v));
            let day_leak = day.is_some_and(|m| {
                m > c.leak_reference_floor * co2_floor && co2 < c.leak_fraction * m
            });
            let sibling_leak = sibling_co2 > c.leak_reference_floor * co2_floor
                && co2 < c.leak_fraction * sibling_co2;
            if day_leak || sibling_leak {
                let bad = low_n2o
                    || (day_leak
                        && day.is_some_and(|m| sibling_co2 > c.leak_day_sibling_fraction * m));
                let day_percent = day
                    .map(|m| format!("{:.0}%", 100. * co2 / m))
                    .unwrap_or_else(|| "unavailable".into());
                let message = format!(
                    "CO2 is {day_percent} of the day median and {:.0}% of sibling CO2; N2O is {:.0}% of sibling N2O.",
                    100. * co2 / sibling_co2.abs().max(co2_floor),
                    100. * n2o.unwrap_or(0.) / sibling_n2o.abs().max(n2o_floor)
                );
                findings.push(finding(
                    "chamber_leak",
                    if bad { "bad" } else { "warn" },
                    Some("CO2"),
                    co2,
                    message,
                ));
            }
        }
        grade_shapes(r, findings, f, baseline, c);
        let leak = findings.iter().any(|d| d.code == "chamber_leak");
        for d in findings.iter_mut() {
            if d.code == "n2o_negative" && leak {
                d.severity = "bad".into();
            }
            if d.code == "few_points" && r["overridden"] == true {
                d.severity = "info".into();
            }
        }
    });
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
            let z = ((v / scale).asinh() - median(&transformed)).abs()
                / mad(&transformed).max(c.neighbour_asinh_mad_min);
            if z > c.neighbour_z && raw_z > c.neighbour_raw_z {
                let message = format!(
                    "Flux {v:.1} versus neighbour median {centre:.1}: \
                     raw z={raw_z:.1}, scaled-asinh z={z:.1}; {} non-excluded neighbours.",
                    values.len()
                );
                let absolute: Vec<_> = values.iter().map(|v| v.abs()).collect();
                let bad = z > c.neighbour_bad_z
                    || (v > c.neighbour_bad_ratio * median(&absolute)
                        && v > c.neighbour_bad_floor * floor);
                findings[i].push(finding(
                    "neighbour_outlier",
                    if bad { "bad" } else { "warn" },
                    Some(gas),
                    z,
                    message,
                ));
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn row(id: i64, co2: f64, n2o: f64) -> FluxRow {
        serde_json::from_value(json!({
        "id":id,
        "measurementId":(id+1)/2,
        "time":0,
        "source":"robot",
        "excluded":false,
        "reviewed":false,
        "overridden":false,
        "treatmentId":1,
        "plotId":1,
        "CO2_flux":co2,
        "N2O_flux":n2o,
        "CO2_pval":0.0001,
        "N2O_pval":0.0001,
        "CO2_resid":1.,
        "N2O_resid":0.001}
        ))
        .expect("row")
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
            .any(|d| d.code == "neighbour_outlier"
                && d.gas.as_deref() == Some("CO2")
                && d.severity == "bad"));
    }
    #[test]
    fn sibling_reference_detects_leak_without_strong_day() {
        let mut rows = vec![row(1, 0., 0.), row(2, 100000., 100.)];
        let mut f = vec![vec![]; 2];
        contextualise(
            &mut rows,
            &mut f,
            &vec![Findings::default(); 2],
            &baseline(),
            &DiagnosticsConfig::default(),
            chrono_tz::Europe::Oslo,
        );
        assert!(f[0]
            .iter()
            .any(|d| d.code == "chamber_leak" && d.severity == "bad"));
        rows[0].insert("N2O_flux".into(), json!(100.));
        contextualise(
            &mut rows,
            &mut f,
            &vec![Findings::default(); 2],
            &baseline(),
            &DiagnosticsConfig::default(),
            chrono_tz::Europe::Oslo,
        );
        assert!(f[0]
            .iter()
            .any(|d| d.code == "chamber_leak" && d.severity == "warn"));
    }
    #[test]
    fn negative_n2o_severity_bands_and_significance() {
        for (multiple, p, expected) in [
            (2., 0.001, Some("info")),
            (4., 0.001, Some("warn")),
            (6., 0.001, Some("bad")),
            (6., 0.1, None),
        ] {
            let mut rows = vec![row(1, 200000., -multiple * baseline()["N2O"].floor)];
            rows[0].insert("N2O_pval".into(), json!(p));
            let mut f = vec![vec![]];
            contextualise(
                &mut rows,
                &mut f,
                &[Findings::default()],
                &baseline(),
                &DiagnosticsConfig::default(),
                chrono_tz::Europe::Oslo,
            );
            assert_eq!(
                f[0].iter()
                    .find(|d| d.code == "n2o_negative")
                    .map(|d| d.severity.as_str()),
                expected
            );
        }
    }
    #[test]
    fn shape_severity_uses_floor_gate_cross_gas_max_and_half_windows() {
        let mut b = baseline();
        for v in b.values_mut() {
            v.floor = 10.;
        }
        let r = row(1, 100., 100.);
        let c = DiagnosticsConfig::default();
        for (robust_flux, expected) in [(90., "info"), (85., "warn"), (65., "bad")] {
            let analysis = Findings {
                robust: vec![RobustFit {
                    gas: "CO2".into(),
                    slope: 1.,
                    intercept: 1.,
                    start: 0.,
                    stop: 180.,
                    n: 60,
                    flux: robust_flux,
                    fit: None,
                    indices: vec![],
                }],
                ..Default::default()
            };
            let mut f: Vec<_> = ["valve_timing", "edge_transient", "spike", "noisy"]
                .into_iter()
                .map(|code| finding(code, "bad", Some("N2O"), 1., "test".into()))
                .collect();
            grade_shapes(&r, &mut f, &analysis, &b, &c);
            assert!(f.iter().all(|d| d.severity == expected), "{f:?}");
        }
        let analysis = Findings {
            robust: vec![RobustFit {
                gas: "CO2".into(),
                slope: 1.,
                intercept: 1.,
                start: 0.,
                stop: 180.,
                n: 60,
                flux: 60.,
                fit: None,
                indices: vec![],
            }],
            half_differences: [("CO2".into(), 50.)].into_iter().collect(),
            ..Default::default()
        };
        let mut f = vec![finding("curvature", "info", Some("CO2"), 1., "test".into())];
        grade_shapes(&r, &mut f, &analysis, &b, &c);
        assert_eq!(f[0].severity, "bad");
        assert_eq!(f[0].impact, Some(0.5));
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
        let mut analysis = vec![Findings::default(); 2];
        analysis[0].ols.insert(
            "CO2".into(),
            OlsComparison {
                flux: 1.,
                se_flux: 3.,
            },
        );
        let floors = baselines(&[a, b], &analysis, &DiagnosticsConfig::default());
        assert_eq!(floors["CO2"].floor, 9.);
        assert!((impact(58., 41., 1.) - 17. / 58.).abs() < 1e-14);
    }
}
