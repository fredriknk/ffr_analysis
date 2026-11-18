mod impact;
use crate::{
    api::{AnalysisOptions, FluxRow},
    raw::{group_ranges, Raw},
    regression::{self, Regression},
};
pub use impact::*;
use serde::{Deserialize, Serialize};
use statrs::distribution::{ContinuousCDF, FisherSnedecor};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DiagnosticsConfig {
    pub n2o_negative_p: f64,
    pub extra_cut_s: f64,
    pub robust_mad: f64,
    pub lag_contrast_sd: f64,
    pub noisy_warn: f64,
    pub shape_floor_multiplier: f64,
    pub shape_warn_impact: f64,
    pub shape_bad_impact: f64,
    pub noise_floor_multiplier: f64,
    pub negative_info_floor: f64,
    pub co2_negative_floor: f64,
    pub negative_warn_floor: f64,
    pub negative_bad_floor: f64,
    pub leak_reference_floor: f64,
    pub leak_fraction: f64,
    pub leak_day_sibling_fraction: f64,
    pub neighbour_bad_z: f64,
    pub neighbour_bad_ratio: f64,
    pub neighbour_bad_floor: f64,
    pub neighbour_asinh_mad_min: f64,
    pub leak_min_day_points: usize,
    pub neighbour_raw_z: f64,
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
    /// A gap longer than this between readings inside a chamber's window is a dropout.
    pub dropout_gap_s: f64,
}
impl Default for DiagnosticsConfig {
    fn default() -> Self {
        Self {
            n2o_negative_p: 0.01,
            extra_cut_s: 3.,
            robust_mad: 4.,
            lag_contrast_sd: 4.,
            noisy_warn: 4.,
            shape_floor_multiplier: 1.0,
            shape_warn_impact: 0.15,
            shape_bad_impact: 0.35,
            noise_floor_multiplier: 3.0,
            negative_info_floor: 1.,
            co2_negative_floor: 1.,
            negative_warn_floor: 3.0,
            negative_bad_floor: 5.0,
            leak_reference_floor: 5.0,
            leak_fraction: 0.25,
            leak_day_sibling_fraction: 0.5,
            neighbour_bad_z: 10.0,
            neighbour_bad_ratio: 10.0,
            neighbour_bad_floor: 5.0,
            neighbour_asinh_mad_min: 0.15,
            leak_min_day_points: 6,
            neighbour_raw_z: 8.,
            curvature_p: 1e-12,
            curvature_gases: vec!["N2O".into(), "CO2".into()],
            curvature_slope_change: 0.4,
            valve_search_s: 10.,
            valve_step_s: 0.5,
            valve_min_lag_s: 1.,
            valve_min_improvement: 0.3,
            valve_estimate_cut_s: 0.25,
            edge_ratio: 2.5,
            irregular_fraction: 0.5,
            normal_segment_s: 20.,
            normal_switches: 10,
            min_points: 20,
            min_window_s: 60.,
            spike_mad: 6.,
            neighbour_z: 3.5,
            neighbour_days: 3.,
            neighbour_fallback_days: 10.,
            min_neighbours: 6,
            dropout_gap_s: 5.,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Diagnostic {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impact: Option<f64>,
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
#[serde(default, rename_all = "camelCase")]
pub struct Findings {
    #[serde(default)]
    pub robust: Vec<RobustFit>,
    #[serde(default)]
    pub lags: BTreeMap<String, LagEstimate>,
    #[serde(default)]
    pub half_differences: BTreeMap<String, f64>,
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
        impact: None,
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
    let active: Vec<_> = findings.iter().filter(|d| d.code != "legacy_qc").collect();
    let Some(first) = active.first() else {
        return 0.;
    };
    let impact = active.iter().filter_map(|d| d.impact).fold(0., f64::max);
    let unique: BTreeSet<_> = active
        .iter()
        .filter(|d| d.severity != "info")
        .map(|d| d.code.as_str())
        .collect();
    let extra = (unique.len().saturating_sub(1) as f64 * 2.).min(6.);
    let impact_weight = impact / (1. + impact);
    let noise = active
        .iter()
        .filter(|d| d.code == "noisy")
        .filter_map(|d| d.value)
        .fold(0., f64::max);
    let neighbour = active
        .iter()
        .filter(|d| d.code == "neighbour_outlier")
        .filter_map(|d| d.value)
        .fold(0., f64::max);
    match first.severity.as_str() {
        "bad" => (70.
            + 25. * impact_weight
            + extra
            + if first.code == "error" {
                20.
            } else {
                (noise / 10.).max(1.).ln().min(3.) * 4.
            })
        .min(100.),
        "warn" => (30.
            + 20. * impact_weight
            + extra
            + if neighbour > 0. {
                (neighbour - 3.5).clamp(0., 8.) * 2.
            } else {
                0.
            })
        .min(69.),
        _ => (1. + active.len() as f64).min(10.),
    }
}
pub fn severity_map(findings: &[Diagnostic]) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for d in findings {
        let current = out
            .entry(d.code.clone())
            .or_insert_with(|| d.severity.clone());
        if rank(&d.severity) > rank(current) {
            *current = d.severity.clone();
        }
    }
    out
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
    row.insert(
        "diagSeverity".into(),
        serde_json::json!(severity_map(findings)),
    );
    row.insert("valveLagS".into(), serde_json::json!(lag));
}
/// Plain-language reading of the legacy N2O quality check result.
pub fn legacy_qc_message(qc: &str) -> String {
    let why = match qc {
        "Probably zero slope" => {
            "No significant slope and a small N2O range, so most likely a real              near-zero flux rather than an error"
        }
        "Outliers likely" => {
            "The N2O range, or the slope relative to the range, is unusually large,              or p is only marginally significant"
        }
        "Fails p-test for other reason" => {
            "No significant slope although the N2O range is not small; check the trace"
        }
        "Out of range - possibly zero slope" => {
            "Concentrations are outside the normal ambient band and the slope is not significant"
        }
        "Out of range and negative" => {
            "Concentrations are outside the normal ambient band and the trace falls"
        }
        "Out of range" => "Concentrations are outside the normal ambient band",
        _ => "Check the trace",
    };
    format!("{qc}. {why}. Informational only (legacy check).")
}
/// Gases (N2O, CO2) whose analyser returned zeros, or nothing for a while, inside
/// this chamber's window: an instrument dropout. The gas is excluded
/// automatically (see `autoExcludedGases`) until the user includes it again.
pub fn dropouts(
    raw: &Raw,
    side: u8,
    o: &AnalysisOptions,
    c: &DiagnosticsConfig,
) -> Vec<Diagnostic> {
    let mut out = vec![];
    for gas in ["N2O", "CO2"] {
        let Some((t, y)) = raw.channels.get(gas) else {
            continue;
        };
        let e = o.for_gas(gas);
        let (from, to) = if e.mode == "manual" {
            (f64::NEG_INFINITY, f64::INFINITY)
        } else {
            (e.start, e.stop)
        };
        let ranges = group_ranges(
            t,
            &shifted(raw, e.valve_offset),
            e.cut_beginnings,
            e.cut_ends,
        );
        let (mut total, mut zeros, mut gap) = (0, 0, 0_f64);
        for (a, b, _) in ranges.into_iter().filter(|p| p.2 == side) {
            let mut last: Option<f64> = None;
            for i in a..b {
                if t[i] < from || t[i] >= to {
                    continue;
                }
                total += 1;
                if y[i] == 0. || !y[i].is_finite() {
                    zeros += 1;
                } else {
                    if let Some(p) = last {
                        gap = gap.max(t[i] - p);
                    }
                    last = Some(t[i]);
                }
            }
        }
        let long_gap = gap > c.dropout_gap_s;
        if total == 0 || (zeros == 0 && !long_gap) {
            continue;
        }
        let mut what = vec![];
        if zeros > 0 {
            what.push(format!("returned 0 for {zeros} of {total} readings"));
        }
        if long_gap {
            what.push(format!("sent no readings for {gap:.0} s"));
        }
        out.push(finding(
            "zero_readings",
            "bad",
            Some(gas),
            zeros as f64,
            format!(
                "The {gas} analyser {} in this chamber's window (instrument dropout). \
                 {gas} is excluded from summaries automatically; include it again if the \
                 fit is still usable.",
                what.join(" and ")
            ),
        ));
    }
    out
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
    let o = o.for_gas(gas);
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
    valve_lag_for(raw, "CO2", o, c)
}
pub fn valve_lag_for(
    raw: &Raw,
    gas: &str,
    o: &AnalysisOptions,
    c: &DiagnosticsConfig,
) -> (f64, f64) {
    let Some((t, y)) = raw.channels.get(gas) else {
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
        if !r.qc.is_empty() {
            d.push(finding(
                "legacy_qc",
                "info",
                Some("N2O"),
                r.pval,
                legacy_qc_message(&r.qc),
            ));
        }
    }
    d.extend(dropouts(raw, side, o, c));
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
        let message = "Valve segments are missing, repeated, or differ from the \
                       normal duration by over the configured fraction.";
        d.push(finding(
            "valves_irregular",
            "warn",
            None,
            times.len() as f64,
            message.into(),
        ));
    }
    let mut half_differences = BTreeMap::new();
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
        if ["N2O", "CO2"].contains(&gas.as_str()) && noise > 1e-12 && peak / noise > c.spike_mad {
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
                half_differences.insert(gas.clone(), (a.slope - b.slope).abs() * conversion(r));
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
        if gas == "CO2" || gas == "N2O" {
            let effective = o.for_gas(gas);
            let ranges = group_ranges(
                t,
                &shifted(raw, effective.valve_offset),
                effective.cut_beginnings,
                effective.cut_ends,
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
    let (robust, lags) = robust_fits(raw, side, o, results, c);
    for (gas, estimate) in &lags {
        if estimate.improvement >= c.valve_min_improvement && estimate.lag_s.abs() >= 1. {
            d.push(finding(
                "valve_timing",
                "info",
                Some(gas),
                estimate.lag_s,
                "Gas-specific valve lag detected.".into(),
            ));
        }
    }
    score(&mut d);
    Findings {
        robust,
        lags,
        half_differences,
        diagnostics: d,
        valve_lag_s: lag.0,
        valve_improvement: lag.1,
    }
}
pub const RULES: [(&str, &str, &str); 16] = [
    (
        "noisy",
        "Noisy trace",
        "Residual SD exceeds the gas baseline threshold; effective impact determines severity.",
    ),
    (
        "error",
        "Invalid measurement",
        "Measurement validation or regression failed.",
    ),
    (
        "n2o_negative",
        "N2O decreases",
        "Significant negative N2O exceeds the noise floor, with stronger loss or a leak rated bad.",
    ),
    (
        "co2_not_rising",
        "CO2 not rising",
        "CO2 decreases beyond the noise floor with p below 0.01.",
    ),
    (
        "chamber_leak",
        "Possible chamber leak",
        "CO2 is low relative to a strongly emitting day and its sibling chamber.",
    ),
    (
        "curvature",
        "Curved trace",
        "Significant curvature changes half-window slopes; effective half-window impact determines severity.",
    ),
    (
        "valve_timing",
        "Valve timing mismatch",
        "A gas-specific valve shift lowers chamber SSE; robust-fit impact determines severity.",
    ),
    (
        "edge_transient",
        "Valve-edge transients",
        "Segment-edge residuals exceed interior residuals; robust-fit impact determines severity.",
    ),
    (
        "valves_irregular",
        "Irregular valves",
        "Valve segments are missing, repeated or unusually long or short.",
    ),
    (
        "spike",
        "Residual spike",
        "A residual exceeds the MAD threshold; robust-fit impact determines severity.",
    ),
    (
        "few_points",
        "Short fit",
        "The fit has too few points or a short window, informational when its window was overridden.",
    ),
    (
        "zero_readings",
        "Instrument dropout",
        "The analyser returned zeros or stopped reporting inside the chamber's window; \
         that gas is excluded automatically until you include it again.",
    ),
    (
        "legacy_qc",
        "N2O quality check",
        "The legacy N2O check: 'Probably zero slope' (no significant slope and a small \
         range; usually a real near-zero flux), 'Outliers likely', 'Out of range' (outside \
         the ambient band) or 'Fails p-test'. Informational; it never raises attention.",
    ),
    (
        "neighbour_outlier",
        "Neighbour outlier",
        "Flux exceeds nearby non-excluded measurements on both noise-scaled asinh and raw MAD scales.",
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
            self.curvature_p,
            self.valve_min_improvement,
        ];
        let positive = [
            self.robust_mad,
            self.lag_contrast_sd,
            self.noisy_warn,
            self.shape_floor_multiplier,
            self.shape_warn_impact,
            self.shape_bad_impact,
            self.noise_floor_multiplier,
            self.negative_info_floor,
            self.co2_negative_floor,
            self.negative_warn_floor,
            self.negative_bad_floor,
            self.leak_reference_floor,
            self.leak_fraction,
            self.leak_day_sibling_fraction,
            self.neighbour_bad_z,
            self.neighbour_bad_ratio,
            self.neighbour_bad_floor,
            self.neighbour_asinh_mad_min,
            self.neighbour_raw_z,
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
            self.dropout_gap_s,
        ];
        if !self.extra_cut_s.is_finite()
            || self.extra_cut_s < 0.
            || self.shape_bad_impact < self.shape_warn_impact
            || self.negative_bad_floor < self.negative_warn_floor
            || self.negative_warn_floor < self.negative_info_floor
            || self.leak_min_day_points < 1
            || probabilities
                .iter()
                .any(|v| !v.is_finite() || !(0. ..=1.).contains(v))
            || positive.iter().any(|v| !v.is_finite() || *v <= 0.)
            || self.valve_search_s > 60.
            || self.valve_step_s < 0.1
            || self.valve_min_lag_s > self.valve_search_s
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
        let mut raw = raw::from_value(
            meta,
            json!({
            "aux":events,
            "li-cor":{
            "ty":rows}
            }
            ),
        )
        .expect("raw");
        let t: Vec<_> = (0..200).map(|i| i as f64 + 0.25).collect();
        let y = t
            .iter()
            .map(|t| 0.33 + if negative { -0.0001 * t } else { 0.0001 * t })
            .collect();
        raw.channels.insert("N2O".into(), (t, y));
        raw
    }
    fn run(raw: &Raw, o: &AnalysisOptions) -> Findings {
        let results = regression::compute_with(raw, 1, o, 20.).expect("fit");
        let c = DiagnosticsConfig::default();
        let mut f = analyse(raw, 1, o, &results, &c, valve_lag(raw, o, &c));
        let mut row: FluxRow = serde_json::from_value(json!({
        "id":1,
        "time":0,
        "measurementId":1,
        "source":"robot",
        "excluded":false,
        "overridden":false,
        "treatmentId":1,
        "plotId":1}
        ))
        .expect("row");
        for (gas, r) in &results {
            row.insert(format!("{gas}_flux"), json!(r.flux));
            row.insert(format!("{gas}_pval"), json!(r.pval));
            row.insert(format!("{gas}_resid"), json!(r.mse.sqrt()));
        }
        let b: Baseline = [
            (
                "N2O".into(),
                GasBaseline {
                    floor: 1.,
                    median_residual_sd: 1.,
                },
            ),
            (
                "CO2".into(),
                GasBaseline {
                    floor: 1.,
                    median_residual_sd: 1.,
                },
            ),
        ]
        .into_iter()
        .collect();
        let mut rows = vec![row];
        let mut d = vec![f.diagnostics.clone()];
        contextualise(
            &mut rows,
            &mut d,
            std::slice::from_ref(&f),
            &b,
            &c,
            chrono_tz::Europe::Oslo,
        );
        f.diagnostics = d.remove(0);
        f
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
        assert!(has(&f, "noisy") || has(&f, "spike"));
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
        let mut rows: Vec<FluxRow> = (0..12)
            .map(|i| {
                serde_json::from_value(json!({
                "id":i,
                "measurementId":i,
                "source":"robot",
                "time":i*1000,
                "excluded":false,
                "treatmentId":1,
                "plotId":1,
                "N2O_flux":if i==11{
                10000.}
                else{
                10.+i as f64*0.1}
                }
                ))
                .expect("row")
            })
            .collect();
        let mut f = vec![vec![]; rows.len()];
        let baseline: Baseline = [
            (
                "N2O".into(),
                GasBaseline {
                    floor: 0.1,
                    median_residual_sd: 1.,
                },
            ),
            (
                "CO2".into(),
                GasBaseline {
                    floor: 1.,
                    median_residual_sd: 1.,
                },
            ),
        ]
        .into_iter()
        .collect();
        let analyses = vec![Findings::default(); rows.len()];
        contextualise(
            &mut rows,
            &mut f,
            &analyses,
            &baseline,
            &DiagnosticsConfig::default(),
            chrono_tz::Europe::Oslo,
        );
        assert!(f[11].iter().any(|d| d.code == "neighbour_outlier"));
        assert!(score(&mut f[11]) >= 30.);
    }
    #[test]
    fn zero_offset_exact() {
        let r = trace(0., false, false, false);
        let old = regression::compute(
            &r,
            1,
            &json!({}),
            &json!({
            "start":0.,
            "stop":180.}
            ),
            20.,
        )
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
    #[test]
    fn dropout_readings_flag_only_that_gas() {
        let mut r = trace(0., false, false, false);
        assert!(!has(&run(&r, &AnalysisOptions::default()), "zero_readings"));
        // Zeros inside a left-chamber segment (20..40 s is the right one).
        for i in 45..50 {
            r.channels.get_mut("N2O").expect("channel").1[i] = 0.;
        }
        let f = run(&r, &AnalysisOptions::default());
        let d: Vec<_> = f
            .diagnostics
            .iter()
            .filter(|d| d.code == "zero_readings")
            .collect();
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].gas.as_deref(), Some("N2O"));
        assert_eq!(d[0].severity, "bad");
        assert_eq!(d[0].value, Some(5.));
        // Zeros in the other chamber, or outside the window, do not count.
        let o = AnalysisOptions {
            stop: 40.,
            ..Default::default()
        };
        assert!(!has(&run(&r, &o), "zero_readings"));
        // A long silence (readings missing, not zero) also counts.
        let mut r = trace(0., false, false, false);
        let (t, y) = r.channels.get_mut("N2O").expect("channel");
        let keep: Vec<bool> = t.iter().map(|t| !(85. ..95.).contains(t)).collect();
        let mut k = keep.iter();
        t.retain(|_| *k.next().unwrap_or(&true));
        let mut k = keep.iter();
        y.retain(|_| *k.next().unwrap_or(&true));
        assert!(has(&run(&r, &AnalysisOptions::default()), "zero_readings"));
    }
    #[test]
    fn robust_fit_method_reports_the_robust_refit() {
        let r = trace(0., false, false, true);
        let mut o = AnalysisOptions::default();
        let c = DiagnosticsConfig::default();
        let mut results = regression::compute_with(&r, 1, &o, 20.).expect("fit");
        let ordinary = results["CO2"].clone();
        assert!(apply_fit_method(&r, 1, &o, &mut results, &c).is_empty());
        o.fit = "robust".into();
        o.validate().expect("valid");
        let used = apply_fit_method(&r, 1, &o, &mut results, &c);
        let robust = &results["CO2"];
        assert!(used["CO2"].len() == robust.n && robust.n < ordinary.n);
        assert!(!used["CO2"].contains(&51), "the spike is dropped");
        assert_eq!((robust.start, robust.stop), (ordinary.start, ordinary.stop));
        assert!((robust.flux - robust.slope * conversion(&ordinary)).abs() < 1e-9);
        o.fit = "steepest".into();
        assert!(o.validate().is_err());
    }
}
#[cfg(test)]
mod severity_map_tests {
    #[test]
    fn severity_map_keeps_each_codes_own_worst_severity() {
        let ds: Vec<super::Diagnostic> = serde_json::from_value(serde_json::json!([
            {"code":"valve_timing","severity":"info","message":""},
            {"code":"chamber_leak","severity":"bad","message":""},
            {"code":"spike","severity":"info","message":""},
            {"code":"spike","severity":"warn","message":""}
        ]))
        .unwrap();
        let map = super::severity_map(&ds);
        assert_eq!(map["valve_timing"], "info");
        assert_eq!(map["chamber_leak"], "bad");
        assert_eq!(map["spike"], "warn");
    }
}
