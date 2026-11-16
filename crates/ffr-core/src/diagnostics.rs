use crate::{
    api::{AnalysisOptions, FluxRow},
    raw::{group_ranges, Raw},
    regression::{self, Regression},
};
use serde::{Deserialize, Serialize};
use statrs::distribution::{ContinuousCDF, FisherSnedecor};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DiagnosticsConfig {
    pub n2o_negative_p: f64,
    pub co2_min_r2: f64,
    pub co2_bad_r2: f64,
    pub curvature_p: f64,
    pub curvature_gases: Vec<String>,
    pub curvature_slope_change: f64,
    pub valve_search_s: f64,
    pub valve_step_s: f64,
    pub valve_min_lag_s: f64,
    pub valve_min_improvement: f64,
    pub valve_estimate_cut_s: f64,
    pub edge_ratio: f64,
    pub irregular_fraction: f64,
    pub normal_segment_s: f64,
    pub normal_switches: usize,
    pub min_points: usize,
    pub min_window_s: f64,
    pub spike_mad: f64,
    pub neighbour_z: f64,
    pub neighbour_days: f64,
    pub neighbour_fallback_days: f64,
    pub min_neighbours: usize,
}
impl Default for DiagnosticsConfig {
    fn default() -> Self {
        Self {
            n2o_negative_p: 0.01,
            co2_min_r2: 0.14,
            co2_bad_r2: 0.05,
            curvature_p: 1e-12,
            curvature_gases: vec!["N2O".into(), "CO2".into()],
            curvature_slope_change: 0.4,
            valve_search_s: 10.,
            valve_step_s: 0.5,
            valve_min_lag_s: 3.5,
            valve_min_improvement: 0.3,
            valve_estimate_cut_s: 0.25,
            edge_ratio: 4.5,
            irregular_fraction: 0.5,
            normal_segment_s: 20.,
            normal_switches: 10,
            min_points: 20,
            min_window_s: 60.,
            spike_mad: 15.,
            neighbour_z: 5.,
            neighbour_days: 3.,
            neighbour_fallback_days: 10.,
            min_neighbours: 6,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: String,
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gas: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    pub message: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DiagnosticSummary {
    pub code: String,
    pub label: String,
    pub description: String,
    pub severity: String,
    pub count: usize,
    pub unreviewed: usize,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Findings {
    pub diagnostics: Vec<Diagnostic>,
    pub valve_lag_s: f64,
    pub valve_improvement: f64,
}
fn finding(
    code: &str,
    severity: &str,
    gas: Option<&str>,
    value: f64,
    message: String,
) -> Diagnostic {
    Diagnostic {
        code: code.into(),
        severity: severity.into(),
        gas: gas.map(str::to_owned),
        value: value.is_finite().then_some(value),
        message,
    }
}
pub fn rank(s: &str) -> u8 {
    match s {
        "bad" => 3,
        "warn" => 2,
        _ => 1,
    }
}
pub fn score(findings: &mut [Diagnostic]) -> f64 {
    findings.sort_by(|a, b| {
        rank(&b.severity)
            .cmp(&rank(&a.severity))
            .then(a.code.cmp(&b.code))
            .then(a.gas.cmp(&b.gas))
    });
    let Some(first) = findings.first() else {
        return 0.;
    };
    let base = match first.severity.as_str() {
        "bad" => 70.,
        "warn" => 30.,
        _ => 5.,
    };
    let cap = match first.severity.as_str() {
        "bad" => 100.,
        "warn" => 69.,
        _ => 29.,
    };
    let mut seen = BTreeSet::new();
    let mut extra = 0.;
    for d in findings.iter() {
        if seen.insert(d.code.clone()) {
            extra += match d.severity.as_str() {
                "bad" => 4.,
                "warn" => 3.,
                _ => 1.,
            };
            if d.code == "neighbour_outlier" {
                extra += d.value.unwrap_or(0.).ln_1p().min(6.);
            }
            if d.code == "co2_low_r2" {
                extra += (1. - d.value.unwrap_or(1.)) * 4.;
            }
            if d.code == "legacy_qc" && d.message.contains("Outliers likely") {
                extra += 4.;
            }
        }
    }
    (base + extra - 1.).min(cap)
}
pub fn decorate(row: &mut FluxRow, findings: &mut [Diagnostic], lag: f64) {
    let attention = score(findings);
    let mut seen = BTreeSet::new();
    let codes: Vec<_> = findings
        .iter()
        .filter(|d| seen.insert(d.code.clone()))
        .map(|d| d.code.clone())
        .collect();
    row.insert("attention".into(), serde_json::json!(attention));
    row.insert("diag".into(), serde_json::json!(codes.join(",")));
    row.insert("valveLagS".into(), serde_json::json!(lag));
}
pub fn shifted(raw: &Raw, offset: f64) -> Vec<(f64, u8)> {
    if offset == 0. {
        return raw.switches.clone();
    }
    raw.switches.iter().map(|(t, s)| (t + offset, *s)).collect()
}
pub fn used_indices(
    raw: &Raw,
    gas: &str,
    side: u8,
    o: &AnalysisOptions,
    r: &Regression,
) -> Vec<usize> {
    let Some((t, y)) = raw.channels.get(gas) else {
        return vec![];
    };
    let all: Vec<usize> = group_ranges(
        t,
        &shifted(raw, o.valve_offset),
        o.cut_beginnings,
        o.cut_ends,
    )
    .into_iter()
    .filter(|p| p.2 == side)
    .flat_map(|(a, b, _)| a..b)
    .filter(|i| y[*i] != 0.)
    .collect();
    if all.is_empty() || r.n == 0 {
        return vec![];
    }
    let x: Vec<f64> = all.iter().map(|i| t[*i]).collect();
    let a = regression::nearest(&x, r.start);
    let b = regression::nearest(&x, r.stop);
    if a >= b {
        vec![]
    } else {
        all[a..b].to_vec()
    }
}
pub fn median(v: &[f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    let mut v = v.to_vec();
    v.sort_by(f64::total_cmp);
    (v[(v.len() - 1) / 2] + v[v.len() / 2]) * 0.5
}
pub fn mad(v: &[f64]) -> f64 {
    let m = median(v);
    median(&v.iter().map(|v| (v - m).abs()).collect::<Vec<_>>()) * 1.4826
}
pub fn valve_lag(raw: &Raw, o: &AnalysisOptions, c: &DiagnosticsConfig) -> (f64, f64) {
    let Some((t, y)) = raw.channels.get("CO2") else {
        return (0., 0.);
    };
    if t.len() < 30 || raw.switches.len() < 4 || t.windows(2).any(|p| p[1] < p[0]) {
        return (0., 0.);
    }
    let objective = |delta: f64| -> f64 {
        let switches = shifted(raw, o.valve_offset + delta);
        let ranges: Vec<_> = switches
            .iter()
            .enumerate()
            .filter_map(|(i, (start, side))| {
                let end = switches
                    .get(i + 1)
                    .map(|p| p.0)
                    .unwrap_or(t[t.len() - 1] + 1.);
                let a = t.partition_point(|v| *v < start + c.valve_estimate_cut_s);
                let b = t.partition_point(|v| *v < end - c.valve_estimate_cut_s);
                (a < b).then_some((a, b, *side))
            })
            .collect();
        let mut sum = 0.;
        for side in [1, 2] {
            let (x, y): (Vec<f64>, Vec<f64>) = ranges
                .iter()
                .filter(|p| p.2 == side)
                .flat_map(|p| p.0..p.1)
                .filter(|i| y[*i] != 0.)
                .map(|i| (t[i], y[i]))
                .unzip();
            if x.len() < 15 {
                return f64::INFINITY;
            }
            let Ok(r) = regression::fit(&x, &y) else {
                return f64::INFINITY;
            };
            sum += r.mse * (x.len() - 2) as f64;
        }
        sum
    };
    let baseline = objective(0.);
    if !baseline.is_finite() || baseline < 1e-20 {
        return (0., 0.);
    }
    let mut best = (0.0_f64, baseline);
    let steps = (c.valve_search_s / c.valve_step_s.max(0.1)).round() as i32;
    let mut candidates = vec![];
    for i in -steps..=steps {
        let delta = i as f64 * c.valve_step_s;
        let loss = objective(delta);
        candidates.push((delta, loss));
        if loss < best.1 - 1e-12 || (loss - best.1).abs() < 1e-12 && delta.abs() < best.0.abs() {
            best = (delta, loss);
        }
    }
    let improvement = ((baseline - best.1) / baseline).max(0.);
    if improvement > 0.1 {
        let tied: Vec<f64> = candidates
            .iter()
            .filter(|p| (p.1 - best.1).abs() <= baseline * 1e-9 + 1e-12)
            .map(|p| p.0)
            .collect();
        if !tied.is_empty() {
            best.0 = median(&tied);
        }
    }
    (best.0, improvement)
}
pub fn analyse(
    raw: &Raw,
    side: u8,
    o: &AnalysisOptions,
    results: &BTreeMap<String, Regression>,
    c: &DiagnosticsConfig,
    lag: (f64, f64),
) -> Findings {
    let mut d = vec![];
    if results.is_empty() {
        d.push(finding(
            "error",
            "bad",
            None,
            0.,
            "No valid regression could be computed.".into(),
        ));
    }
    if let Some(r) = results.get("N2O") {
        if r.slope < 0. && r.pval < c.n2o_negative_p {
            d.push(finding(
                "n2o_negative",
                "bad",
                Some("N2O"),
                r.slope,
                "N2O decreases significantly; check chamber sealing.".into(),
            ));
        }
        if !r.qc.is_empty() {
            d.push(finding(
                "legacy_qc",
                "info",
                Some("N2O"),
                r.pval,
                r.qc.clone(),
            ));
        }
    }
    if let Some(r) = results.get("CO2") {
        if r.slope <= 0. {
            d.push(finding(
                "co2_not_rising",
                "bad",
                Some("CO2"),
                r.slope,
                "CO2 does not accumulate; check whether the chamber was sealed.".into(),
            ));
        }
        if r.rsq < c.co2_min_r2 {
            d.push(finding(
                "co2_low_r2",
                if r.rsq < c.co2_bad_r2 { "bad" } else { "warn" },
                Some("CO2"),
                r.rsq,
                format!("CO2 r² {:.3} is below {:.3}.", r.rsq, c.co2_min_r2),
            ));
        }
    }
    if lag.0.abs() >= c.valve_min_lag_s && lag.1 >= c.valve_min_improvement {
        d.push(finding(
            "valve_timing",
            "warn",
            Some("CO2"),
            lag.0,
            format!(
                "Shifting valves by {:.1} s reduces both chambers' CO2 SSE by {:.0}%.",
                lag.0,
                100. * lag.1
            ),
        ));
    }
    let times: Vec<f64> = raw.switches.iter().map(|s| s.0).collect();
    let durations: Vec<f64> = times.windows(2).map(|p| p[1] - p[0]).collect();
    let sides: BTreeSet<u8> = raw.switches.iter().map(|p| p.1).collect();
    let irregular = times.len() != c.normal_switches
        || sides.len() != 2
        || durations
            .iter()
            .any(|v| (v - c.normal_segment_s).abs() > c.normal_segment_s * c.irregular_fraction)
        || raw.switches.windows(2).any(|p| p[0].1 == p[1].1);
    if irregular {
        d.push(finding("valves_irregular","warn",None,times.len() as f64,"Valve segments are missing, repeated, or differ from the normal duration by over the configured fraction.".into()));
    }
    for (gas, r) in results {
        if r.n == 0 {
            continue;
        }
        let indices = used_indices(raw, gas, side, o, r);
        if indices.len() < 3 {
            continue;
        }
        let (t, y) = &raw.channels[gas];
        let x: Vec<f64> = indices.iter().map(|i| t[*i]).collect();
        let values: Vec<f64> = indices.iter().map(|i| y[*i]).collect();
        let residuals: Vec<f64> = x
            .iter()
            .zip(&values)
            .map(|(t, y)| y - (r.intercept + r.slope * t))
            .collect();
        if r.n < c.min_points || r.stop - r.start < c.min_window_s {
            d.push(finding(
                "few_points",
                "warn",
                Some(gas),
                r.n as f64,
                format!(
                    "Fit has {} points over {:.1} s; require {} points and {:.0} s.",
                    r.n,
                    r.stop - r.start,
                    c.min_points,
                    c.min_window_s
                ),
            ));
        }
        let noise = mad(&residuals);
        let center = median(&residuals);
        let peak = residuals
            .iter()
            .map(|v| (v - center).abs())
            .fold(0., f64::max);
        if noise > 1e-12 && peak / noise > c.spike_mad {
            d.push(finding(
                "spike",
                "warn",
                Some(gas),
                peak / noise,
                format!(
                    "Largest residual is {:.1} robust SD from the median.",
                    peak / noise
                ),
            ));
        }
        if x.len() >= 8 {
            let n = x.len() as f64;
            let mx = x.iter().sum::<f64>() / n;
            let dx: Vec<f64> = x.iter().map(|x| x - mx).collect();
            let xx = dx.iter().map(|x| x * x).sum::<f64>();
            let mu2 = xx / n;
            let mu3 = dx.iter().map(|x| x * x * x).sum::<f64>();
            let q: Vec<f64> = dx.iter().map(|x| x * x - mu2 - mu3 / xx * x).collect();
            let qq = q.iter().map(|q| q * q).sum::<f64>();
            let rq = q.iter().zip(&residuals).map(|(q, r)| q * r).sum::<f64>();
            let sse = residuals.iter().map(|r| r * r).sum::<f64>();
            let gain = rq * rq / qq;
            let remainder = (sse - gain).max(1e-30);
            let f = gain / (remainder / (n - 3.));
            let p = FisherSnedecor::new(1., n - 3.)
                .map(|dist| dist.sf(f))
                .unwrap_or(1.);
            let split = x.len() / 2;
            if let (Ok(a), Ok(b)) = (
                regression::fit(&x[..split], &values[..split]),
                regression::fit(&x[split..], &values[split..]),
            ) {
                let change =
                    (a.slope - b.slope).abs() / a.slope.abs().max(b.slope.abs()).max(1e-20);
                if c.curvature_gases.contains(gas)
                    && p < c.curvature_p
                    && change > c.curvature_slope_change
                {
                    d.push(finding(
                        "curvature",
                        "warn",
                        Some(gas),
                        change,
                        format!(
                            "Quadratic F-test p={p:.2e}; half-window slopes differ by {:.0}%.",
                            change * 100.
                        ),
                    ));
                }
            }
        }
        if gas == "CO2" {
            let ranges = group_ranges(
                t,
                &shifted(raw, o.valve_offset),
                o.cut_beginnings,
                o.cut_ends,
            );
            let set: BTreeSet<usize> = indices.iter().copied().collect();
            let mut edges = BTreeSet::new();
            for (a, b, s) in ranges {
                if s != side {
                    continue;
                }
                let used: Vec<usize> = (a..b).filter(|i| set.contains(i)).collect();
                if used.len() >= 4 {
                    edges.insert(used[0]);
                    edges.insert(used[used.len() - 1]);
                }
            }
            let mut edge = vec![];
            let mut interior = vec![];
            for (i, v) in indices.iter().zip(&residuals) {
                if edges.contains(i) {
                    edge.push(v.abs());
                } else {
                    interior.push(v.abs());
                }
            }
            if edge.len() >= 6 && !interior.is_empty() {
                let ratio = (edge.iter().sum::<f64>() / edge.len() as f64)
                    / (interior.iter().sum::<f64>() / interior.len() as f64).max(1e-12);
                if ratio > c.edge_ratio {
                    d.push(finding(
                        "edge_transient",
                        "warn",
                        Some(gas),
                        ratio,
                        format!(
                            "Valve-segment edge residuals are {ratio:.1} times interior residuals."
                        ),
                    ));
                }
            }
        }
    }
    score(&mut d);
    Findings {
        diagnostics: d,
        valve_lag_s: lag.0,
        valve_improvement: lag.1,
    }
}
pub fn neighbours(rows: &mut [FluxRow], findings: &mut [Vec<Diagnostic>], c: &DiagnosticsConfig) {
    for gas in ["N2O", "CO2"] {
        let key = format!("{gas}_flux");
        let mut treatment: BTreeMap<i64, Vec<(i64, i64, f64)>> = BTreeMap::new();
        let mut plot: BTreeMap<i64, Vec<(i64, i64, f64)>> = BTreeMap::new();
        for r in rows
            .iter()
            .filter(|r| r["source"] == "robot" && r["excluded"] != true)
        {
            let Some(v) = r.get(&key).and_then(|v| v.as_f64()) else {
                continue;
            };
            let point = (
                r["time"].as_i64().unwrap_or(0),
                r["id"].as_i64().unwrap_or(0),
                v.asinh(),
            );
            if let Some(id) = r["treatmentId"].as_i64().filter(|id| *id > 0) {
                treatment.entry(id).or_default().push(point);
            }
            if let Some(id) = r["plotId"].as_i64().filter(|id| *id > 0) {
                plot.entry(id).or_default().push(point);
            }
        }
        for points in treatment.values_mut().chain(plot.values_mut()) {
            points.sort_by_key(|p| p.0);
        }
        for (i, r) in rows.iter().enumerate() {
            if r["source"] != "robot" {
                continue;
            }
            let Some(v) = r.get(&key).and_then(|v| v.as_f64()) else {
                continue;
            };
            let time = r["time"].as_i64().unwrap_or(0);
            let id = r["id"].as_i64().unwrap_or(0);
            let collect = |group: &BTreeMap<i64, Vec<(i64, i64, f64)>>, key: &str, days: f64| {
                let pts = r[key]
                    .as_i64()
                    .and_then(|id| group.get(&id))
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                let range = (days * 86400000.) as i64;
                let a = pts.partition_point(|p| p.0 < time - range);
                let b = pts.partition_point(|p| p.0 <= time + range);
                pts[a..b]
                    .iter()
                    .filter(|p| p.1 != id)
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
            let scale = mad(&values);
            if scale > 1e-12 {
                let z = (v.asinh() - median(&values)).abs() / scale;
                if z > c.neighbour_z {
                    findings[i].push(finding(
                        "neighbour_outlier",
                        "warn",
                        Some(gas),
                        z,
                        format!(
                            "Flux is {z:.1} robust SD from {} comparable non-excluded neighbours.",
                            values.len()
                        ),
                    ));
                }
            }
        }
    }
}
pub const RULES: [(&str, &str, &str); 14] = [
    (
        "error",
        "Invalid measurement",
        "Measurement validation or regression failed.",
    ),
    (
        "n2o_negative",
        "N2O decreases",
        "Significant negative N2O slope suggests a leak.",
    ),
    (
        "co2_not_rising",
        "CO2 not rising",
        "CO2 does not accumulate in the chamber.",
    ),
    (
        "co2_low_r2",
        "Poor CO2 line fit",
        "CO2 r² is below the configured threshold.",
    ),
    (
        "curvature",
        "Curved trace",
        "A significant quadratic improvement accompanies different half-window slopes.",
    ),
    (
        "valve_timing",
        "Valve timing mismatch",
        "A shifted valve schedule substantially lowers both chambers' CO2 SSE.",
    ),
    (
        "edge_transient",
        "Valve-edge transients",
        "Segment-edge residuals systematically exceed interior residuals.",
    ),
    (
        "valves_irregular",
        "Irregular valves",
        "Valve segments are missing, repeated or unusually long or short.",
    ),
    (
        "spike",
        "Residual spike",
        "A residual exceeds the configured robust MAD threshold.",
    ),
    (
        "few_points",
        "Short fit",
        "Too few points or too short a regression window.",
    ),
    (
        "legacy_qc",
        "Legacy N2O QC",
        "The legacy N2O quality check reports a finding.",
    ),
    (
        "neighbour_outlier",
        "Neighbour outlier",
        "Asinh flux differs from nearby comparable non-excluded measurements.",
    ),
    (
        "temp_fallback",
        "Fallback temperature",
        "Air temperature is unavailable.",
    ),
    (
        "no_plot",
        "Unassigned plot",
        "The chamber belongs to no plot.",
    ),
];

impl DiagnosticsConfig {
    pub fn validate(&self) -> crate::Result<()> {
        let probabilities = [
            self.n2o_negative_p,
            self.co2_min_r2,
            self.co2_bad_r2,
            self.curvature_p,
            self.valve_min_improvement,
        ];
        let positive = [
            self.valve_search_s,
            self.valve_step_s,
            self.valve_min_lag_s,
            self.edge_ratio,
            self.normal_segment_s,
            self.spike_mad,
            self.neighbour_z,
            self.neighbour_days,
            self.neighbour_fallback_days,
            self.min_window_s,
        ];
        if probabilities
            .iter()
            .any(|v| !v.is_finite() || !(0. ..=1.).contains(v))
            || positive.iter().any(|v| !v.is_finite() || *v <= 0.)
            || self.valve_search_s > 60.
            || self.valve_step_s < 0.1
            || self.valve_min_lag_s > self.valve_search_s
            || self.co2_bad_r2 > self.co2_min_r2
            || self.min_neighbours < 3
            || !self.curvature_slope_change.is_finite()
            || !(0. ..=2.).contains(&self.curvature_slope_change)
            || !self.valve_estimate_cut_s.is_finite()
            || self.valve_estimate_cut_s < 0.
            || !self.irregular_fraction.is_finite()
            || self.irregular_fraction <= 0.
        {
            return Err(crate::Error::Invalid(
                "invalid diagnostic thresholds".into(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raw;
    use serde_json::json;
    fn trace(lag: f64, negative: bool, curve: bool, spike: bool) -> Raw {
        let meta = raw::filename(
            "2022-09-01-13-07-15-x1_0-y2_0-z0_0-h0_0_both_Plot_1_",
            "Europe/Oslo",
        )
        .expect("filename");
        let epoch = meta.time as f64 / 1000.;
        let events: Vec<_> = (0..10)
            .flat_map(|i| {
                let side = if i % 2 == 0 { 1 } else { 2 };
                [
                    json!([epoch + i as f64 * 20., [side, 1]]),
                    json!([epoch + i as f64 * 20. + 0.1, [3 - side, 0]]),
                ]
            })
            .collect();
        let rows: Vec<_> = (0..200)
            .map(|i| {
                let t = i as f64 + 0.25;
                let chamber = ((t - lag).max(0.) / 20.).floor() as i32 % 2;
                let mut co2 =
                    400. + chamber as f64 * 25. + if negative { -0.2 * t } else { 0.2 * t };
                if curve {
                    co2 += 0.002 * t * t;
                }
                if spike && i == 51 {
                    co2 += 30.;
                }
                json!([t, [co2, 1., 1., 1.]])
            })
            .collect();
        let mut raw =
            raw::from_value(meta, json!({"aux":events,"li-cor":{"ty":rows}})).expect("raw");
        let t: Vec<_> = (0..200).map(|i| i as f64 + 0.25).collect();
        let y = t
            .iter()
            .map(|t| 0.33 + if negative { -0.0001 * t } else { 0.0001 * t })
            .collect();
        raw.channels.insert("N2O".into(), (t, y));
        raw
    }
    fn run(raw: &Raw, o: &AnalysisOptions) -> Findings {
        let results = regression::compute(raw, 1, &json!({}), &regression::legacy_options(o), 20.)
            .expect("fit");
        let c = DiagnosticsConfig::default();
        analyse(raw, 1, o, &results, &c, valve_lag(raw, o, &c))
    }
    fn has(f: &Findings, code: &str) -> bool {
        f.diagnostics.iter().any(|d| d.code == code)
    }
    #[test]
    fn sealed_chamber() {
        let r = trace(0., false, false, false);
        let f = run(&r, &AnalysisOptions::default());
        assert!(!has(&f, "co2_low_r2"));
        assert!(!has(&f, "n2o_negative"));
        assert!(!has(&f, "curvature"));
        assert!(!has(&f, "spike"));
    }
    #[test]
    fn leaking_chamber() {
        let f = run(&trace(0., true, false, false), &AnalysisOptions::default());
        assert!(has(&f, "n2o_negative"));
        assert!(has(&f, "co2_not_rising"));
    }
    #[test]
    fn four_second_lag() {
        let r = trace(4., false, false, false);
        let f = run(&r, &AnalysisOptions::default());
        assert!(has(&f, "valve_timing"), "{f:?}");
        assert!((f.valve_lag_s - 4.).abs() <= 0.5, "{f:?}");
        let o = AnalysisOptions {
            valve_offset: 4.,
            ..Default::default()
        };
        assert!(!has(&run(&r, &o), "valve_timing"));
    }
    #[test]
    fn spike_and_curvature() {
        assert!(has(
            &run(&trace(0., false, false, true), &AnalysisOptions::default()),
            "spike"
        ));
        assert!(has(
            &run(&trace(0., false, true, false), &AnalysisOptions::default()),
            "curvature"
        ));
    }
    #[test]
    fn short_irregular_and_poor_fit() {
        let mut r = trace(0., false, false, false);
        r.switches.remove(3);
        let o = AnalysisOptions {
            stop: 40.,
            ..Default::default()
        };
        let f = run(&r, &o);
        assert!(has(&f, "valves_irregular"));
        assert!(has(&f, "few_points"));
        let mut poor = trace(0., false, false, true);
        poor.channels.get_mut("CO2").expect("CO2").1[51] += 300.;
        let f = run(&poor, &AnalysisOptions::default());
        assert!(has(&f, "co2_low_r2"));
    }
    #[test]
    fn edges() {
        let mut r = trace(0., false, false, false);
        let o = AnalysisOptions::default();
        let (t, y) = r.channels.get_mut("CO2").expect("channel");
        for (a, b, _) in group_ranges(t, &r.switches, o.cut_beginnings, o.cut_ends) {
            if a < b {
                y[a] += 8.;
                y[b - 1] += 8.;
            }
        }
        let f = run(&r, &o);
        assert!(has(&f, "edge_transient"), "{f:?}");
    }
    #[test]
    fn neighbours_and_attention() {
        let mut rows:Vec<FluxRow>=(0..12).map(|i|serde_json::from_value(json!({"id":i,"source":"robot","time":i*1000,"excluded":false,"treatmentId":1,"plotId":1,"N2O_flux":if i==11{10000.}else{10.+i as f64*0.1}})).expect("row")).collect();
        let mut f = vec![vec![]; rows.len()];
        neighbours(&mut rows, &mut f, &DiagnosticsConfig::default());
        assert!(f[11].iter().any(|d| d.code == "neighbour_outlier"));
        assert!(score(&mut f[11]) >= 30.);
    }
    #[test]
    fn zero_offset_exact() {
        let r = trace(0., false, false, false);
        let old = regression::compute(&r, 1, &json!({}), &json!({"start":0.,"stop":180.}), 20.)
            .expect("fit");
        let new = regression::compute(
            &r,
            1,
            &json!({}),
            &regression::legacy_options(&AnalysisOptions::default()),
            20.,
        )
        .expect("fit");
        for (gas, a) in old {
            assert_eq!(a.slope.to_bits(), new[&gas].slope.to_bits());
            assert_eq!(a.intercept.to_bits(), new[&gas].intercept.to_bits());
        }
    }
    #[test]
    fn error_and_legacy_qc() {
        let r = trace(0., false, false, false);
        let f = analyse(
            &r,
            1,
            &AnalysisOptions::default(),
            &BTreeMap::new(),
            &DiagnosticsConfig::default(),
            (0., 0.),
        );
        assert!(has(&f, "error"));
        let mut r = trace(0., true, false, false);
        for y in &mut r.channels.get_mut("N2O").expect("channel").1 {
            *y += 0.1;
        }
        assert!(has(&run(&r, &AnalysisOptions::default()), "legacy_qc"));
    }
}
