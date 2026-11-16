use crate::{
    api::AnalysisOptions,
    raw::{group_indices, Raw},
    Error, Result,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use statrs::function::beta::beta_reg;
use std::collections::BTreeMap;
pub const GASES: [&str; 5] = ["CO2", "N2O", "CO", "H2O", "licor_H2O"];
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Regression {
    pub gas: String,
    pub slope: f64,
    pub intercept: f64,
    pub start: f64,
    pub stop: f64,
    pub n: usize,
    pub rsq: f64,
    pub pval: f64,
    pub mse: f64,
    pub se_slope: f64,
    pub se_intercept: f64,
    pub min_y: f64,
    pub max_y: f64,
    pub first_y: f64,
    pub flux: f64,
    pub flux_unit: String,
    pub qc: String,
}
pub fn nearest(x: &[f64], v: f64) -> usize {
    let i = x.partition_point(|p| *p <= v).saturating_sub(1);
    if i + 1 < x.len() && (x[i + 1] - v).abs() < (x[i] - v).abs() {
        i + 1
    } else {
        i
    }
}
pub fn fit(x: &[f64], y: &[f64]) -> Result<Regression> {
    let n = x.len();
    if n < 3 || n != y.len() {
        return Err(Error::Invalid(
            "regression needs at least three points".into(),
        ));
    }
    let mx = x.iter().sum::<f64>() / n as f64;
    let my = y.iter().sum::<f64>() / n as f64;
    let xx = x.iter().map(|v| (v - mx).powi(2)).sum::<f64>();
    let yy = y.iter().map(|v| (v - my).powi(2)).sum::<f64>();
    let xy = x
        .iter()
        .zip(y)
        .map(|(a, b)| (a - mx) * (b - my))
        .sum::<f64>();
    if xx == 0. {
        return Err(Error::Invalid("constant time axis".into()));
    }
    let slope = xy / xx;
    let intercept = my - slope * mx;
    let mse = x
        .iter()
        .zip(y)
        .map(|(a, b)| (intercept + a * slope - b).powi(2))
        .sum::<f64>()
        / (n - 2) as f64;
    let rsq = (xy * xy / (xx * yy)).clamp(0., 1.);
    let pval = if yy == 0. {
        f64::NAN
    } else {
        beta_reg((n - 2) as f64 / 2., 0.5, 1. - rsq)
    };
    Ok(Regression {
        gas: String::new(),
        slope,
        intercept,
        start: x[0],
        stop: x[n - 1],
        n,
        rsq,
        pval,
        mse,
        se_slope: (mse / xx).sqrt(),
        se_intercept: (mse * (1. / n as f64 + mx * mx / xx)).sqrt(),
        min_y: y.iter().copied().fold(f64::INFINITY, f64::min),
        max_y: y.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        first_y: y[0],
        flux: 0.,
        flux_unit: String::new(),
        qc: String::new(),
    })
}
pub fn within(x: &[f64], y: &[f64], start: f64, stop: f64) -> Result<Regression> {
    if x.is_empty() {
        return Err(Error::Invalid("empty trace".into()));
    }
    let i = if start <= x[0] { 0 } else { nearest(x, start) };
    let j = if stop >= x[x.len() - 1] {
        x.len() - 1
    } else {
        nearest(x, stop)
    };
    if i >= j {
        return Err(Error::Invalid("empty window".into()));
    }
    let mut r = fit(&x[i..j], &y[i..j])?;
    r.start = x[i];
    r.stop = x[j];
    Ok(r)
}
pub fn auto(x: &[f64], y: &[f64], interval: f64, crit: &str) -> Result<Regression> {
    let mut best: Option<(f64, Regression)> = None;
    for i in 0..x.len() {
        let v = x[i] + interval;
        if v > *x.last().unwrap_or(&0.) {
            break;
        }
        let j = x.partition_point(|a| *a <= v).saturating_sub(1);
        if j < i + 2 {
            continue;
        }
        let mut r = fit(&x[i..j], &y[i..j])?;
        r.start = x[i];
        r.stop = x[j];
        let span = (x[j] - x[i] - interval * 0.3).max(1e-99);
        let score = if crit == "mse" {
            -r.mse * span
        } else {
            r.slope * span
        };
        if best.as_ref().is_none_or(|b| score > b.0) {
            best = Some((score, r));
        }
    }
    best.map(|b| b.1)
        .ok_or_else(|| Error::Invalid("no automatic window".into()))
}
pub fn qc(r: &Regression, side: u8) -> String {
    let range = r.max_y - r.min_y;
    let curve = if range == 0. {
        -1.
    } else {
        r.slope.abs() / range
    };
    let s = if range > 0.14
        || curve > if side == 1 { 0.0081 } else { 0.0066 }
        || (r.pval > 0.0001 && r.pval < 0.001 && range > 0.003)
        || curve == -1.
    {
        "Outliers likely"
    } else if r.min_y < 0.31 || r.min_y > 0.34 || (r.slope < 0. && r.max_y > 0.34) {
        if r.pval > 0.001 && range < 0.003 {
            "Out of range - possibly zero slope"
        } else if r.slope < 0. {
            "Out of range and negative"
        } else {
            "Out of range"
        }
    } else if r.pval > 0.001 {
        if range > 0.003 {
            "Fails p-test for other reason"
        } else {
            "Probably zero slope"
        }
    } else {
        ""
    };
    s.into()
}
pub fn enough(v: &Value, gas: &str) -> bool {
    v.get("slope").is_some()
        || (v.get("start").is_some() && v.get("stop").is_some())
        || (v.get("interval").is_some()
            && v.get("crit").is_some()
            && (gas == "CO2" || v.get("co2_guides").is_some()))
}
fn merge(a: &Value, b: &Value) -> Value {
    let mut v = a.as_object().cloned().unwrap_or_default();
    if let Some(b) = b.as_object() {
        v.extend(b.clone());
    }
    Value::Object(v)
}
pub fn resolve(side: &str, gas: &str, pref: &Value, alt: &Value) -> Value {
    let mut r = json!({});
    if let Some(p) = pref.get(side) {
        r = merge(&resolve(side, gas, p, pref), &r);
    }
    if !enough(&r, gas) {
        if let Some(p) = pref.get(gas) {
            r = merge(&resolve(side, gas, p, pref), &r);
        }
    }
    if !enough(&r, gas) {
        r = merge(pref, &r);
    }
    if !enough(&r, gas) {
        r = merge(alt, &r);
    }
    if let Some(m) = r.as_object_mut() {
        for k in ["left", "right", "CO2", "N2O"] {
            m.remove(k);
        }
    }
    r
}
pub fn legacy_options(o: &AnalysisOptions) -> Value {
    let mut v = serde_json::to_value(o).unwrap_or_default();
    if let Some(m) = v.as_object_mut() {
        m.insert("co2_guides".into(), json!(o.co2_guides));
        m.insert("cut_beginnings".into(), json!(o.cut_beginnings));
        m.insert("cut_ends".into(), json!(o.cut_ends));
        if o.mode == "auto" {
            m.remove("start");
            m.remove("stop");
        }
        if o.slope.is_none() {
            m.remove("slope");
        }
        for (g, p) in &o.per_gas {
            m.insert(g.clone(), p.clone());
        }
    }
    v
}
pub fn compute(
    raw: &Raw,
    side: u8,
    specific: &Value,
    defaults: &Value,
    temp: f64,
) -> Result<BTreeMap<String, Regression>> {
    let beg = specific["cut_beginnings"]
        .as_f64()
        .or(defaults["cut_beginnings"].as_f64())
        .unwrap_or(4.);
    let end = specific["cut_ends"]
        .as_f64()
        .or(defaults["cut_ends"].as_f64())
        .unwrap_or(3.);
    let mut out = BTreeMap::new();
    let mut guide = None;
    for gas in GASES {
        let Some((t, y)) = raw.channels.get(gas) else {
            continue;
        };
        let sides = group_indices(t, &raw.switches, beg, end);
        let (x, y): (Vec<_>, Vec<_>) = t
            .iter()
            .zip(y)
            .zip(sides)
            .filter(|((_, y), s)| *s == side && **y != 0.)
            .map(|((t, y), _)| (*t, *y))
            .unzip();
        if x.len() < 3 {
            continue;
        }
        let o = resolve(
            if side == 1 { "left" } else { "right" },
            gas,
            specific,
            defaults,
        );
        let start = o["start"].as_f64();
        let stop = o["stop"].as_f64();
        let mut r = if let Some(s) = o["slope"].as_f64() {
            let mut r = fit(&x, &y)?;
            r.slope = s;
            r
        } else if let (Some(a), Some(b)) = (start, stop) {
            within(&x, &y, a, b)?
        } else if gas != "CO2" && o["co2_guides"].as_bool().unwrap_or(false) && guide.is_some() {
            let (a, b) = guide.unwrap_or((0., 180.));
            within(&x, &y, a, b)?
        } else {
            let r = auto(
                &x,
                &y,
                o["interval"].as_f64().unwrap_or(100.),
                o["crit"].as_str().unwrap_or("steepest"),
            )?;
            if gas == "CO2" {
                guide = Some((r.start, r.stop));
            }
            r
        };
        r.gas = gas.into();
        r.flux = r.slope
            * 1e-6
            * (101000. * 0.5 / (8.314 * (temp + 273.15)))
            * match gas {
                "N2O" => 28e6 * 3600.,
                "CO2" => 12e6 * 3600.,
                _ => 1.,
            };
        r.flux_unit = match gas {
            "N2O" => "µg N2O-N m?² h?¹",
            "CO2" => "µg CO2-C m?² h?¹",
            _ => "mol m?² s?¹",
        }
        .into();
        if gas == "N2O" {
            r.qc = qc(&r, side);
        }
        out.insert(gas.into(), r);
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn half_open() {
        let r = within(&[0., 1., 2., 3., 4.], &[1., 3., 5., 7., 999.], 0., 4.).expect("fit");
        assert_eq!(r.n, 4);
        assert!((r.slope - 2.).abs() < 1e-14);
        assert_eq!(r.stop, 4.);
    }
    #[test]
    fn nearest_tie_lower() {
        assert_eq!(nearest(&[0., 2., 4.], 1.), 0);
    }
    #[test]
    fn proper_errors() {
        let r = fit(&[0., 1., 2., 3.], &[1., 2., 2., 5.]).expect("fit");
        assert!((r.se_slope - (r.mse / 5.).sqrt()).abs() < 1e-14);
    }
}
