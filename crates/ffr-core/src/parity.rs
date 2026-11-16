//! Per-line golden regression comparison. Inputs are deliberately never copied into the repository.
use crate::{raw, regression, Result};

use rayon::prelude::*;

use serde::Serialize;

use serde_json::Value;

use std::path::Path;

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ParityReport {
    pub lines: usize,
    pub matched_lines: usize,
    pub comparisons: usize,
    pub mismatches: Vec<String>,
    pub max_slope_relative_error: f64,
    pub seconds: f64,
}
/// Accept the original slopes text, or JSONL from tools/verification.py.
pub fn parity(raw_dir: &Path, golden_jsonl: &Path) -> Result<ParityReport> {
    let start = std::time::Instant::now();

    let text =
        std::fs::read_to_string(golden_jsonl).map_err(|e| crate::Error::at(golden_jsonl, e))?;

    let lines: Vec<Value> = text
        .lines()
        .filter(|s| !s.trim().is_empty())
        .map(|line| {
            if line.starts_with('{') {
                return Ok(serde_json::from_str(line)?);
            }
            let f: Vec<_> = line.split('\t').collect();

            if f.len() < 4 {
                return Err(crate::Error::Invalid("invalid golden line".into()));
            }
            let options = crate::literal::parse(f[2])?;

            let values: serde_json::Map<String, Value> = f[3..]
                .chunks_exact(2)
                .map(|p| (p[0].into(), Value::String(p[1].into())))
                .collect();

            Ok(serde_json::json!({"filename":f[0],"side":f[1],"options":options,"values":values}))
        })
        .collect::<Result<_>>()?;

    let results:Vec<_>=lines.par_iter().map(|v|{let mut report=ParityReport{lines:1,..Default::default()};
let name=v["filename"].as_str().unwrap_or("");
let side=if v["side"]=="left"{1}else{2};
let path=raw_dir.join(name);
let path=if path.exists(){path}else{raw_dir.join(format!("{name}.gz"))};
let result=raw::load(&path,"Europe/Oslo").and_then(|r|regression::compute(&r,side,&v["options"][0],&v["options"][1],20.));
match result{Err(e) => report.mismatches.push(format!("{name}: {e}")),Ok(regs) => {for gas in regression::GASES{let Some(r)=regs.get(gas)else{report.mismatches.push(format!("{name}: missing {gas}"));
continue;
};
for (suffix,actual) in [("",r.slope),("_intercept",r.intercept),("_rsq",r.rsq),("_pval",r.pval),("_min",r.min_y),("_max",r.max_y),("_first",r.first_y)]{let key=format!("{gas}{suffix}");
if let Some(expected)=v["values"][&key].as_str().and_then(|s|s.parse::<f64>().ok()).or(v["values"][&key].as_f64()){report.comparisons+=1;
let rel=(actual-expected).abs()/expected.abs().max(1e-300);
if suffix.is_empty(){report.max_slope_relative_error=report.max_slope_relative_error.max(rel);
}
if (actual-expected).abs()>1e-9*expected.abs().max(if suffix=="_pval"{1e-12}else{1e-10}){report.mismatches.push(format!("{name} {} {key}: {actual:e} != {expected:e} (relative {rel:e})",v["side"]));
}}}
if gas=="N2O" {report.comparisons+=1;
if v["values"]["N2O_quality_check"].as_str().unwrap_or("")!=r.qc{report.mismatches.push(format!("{name}: QC mismatch"));
}}}}}
if report.mismatches.is_empty(){report.matched_lines=1;
}report}).collect();

    let mut out = ParityReport::default();

    for r in results {
        out.lines += r.lines;

        out.matched_lines += r.matched_lines;

        out.comparisons += r.comparisons;

        out.max_slope_relative_error = out.max_slope_relative_error.max(r.max_slope_relative_error);

        out.mismatches.extend(r.mismatches);
    }
    out.seconds = start.elapsed().as_secs_f64();

    Ok(out)
}

/// End-to-end verification against the Python helper's CSV, using each golden line's options.
pub fn end_to_end(
    raw_dir: &Path,
    slopes: &Path,
    frame_csv: &Path,
    metno: &Path,
) -> Result<serde_json::Value> {
    use serde_json::json;

    use std::collections::BTreeMap;

    let text = std::fs::read_to_string(slopes).map_err(|e| crate::Error::at(slopes, e))?;

    let mut options = BTreeMap::new();

    for line in text.lines() {
        let f: Vec<_> = line.split('\t').collect();

        if f.len() >= 3 {
            options.insert(
                (f[0].to_owned(), f[1].to_owned()),
                crate::literal::parse(f[2])?,
            );
        }
    }
    let weather = raw::read_value(metno)?;

    let mut temperatures: Vec<(i64, f64)> = weather
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            Some((
                (p[0].as_f64()? * 1000.) as i64,
                p[1]["air_temperature"].as_f64()?,
            ))
        })
        .filter(|p| p.1.is_finite())
        .collect();

    temperatures.sort_by_key(|p| p.0);

    let mut reader =
        csv::Reader::from_path(frame_csv).map_err(|e| crate::Error::Invalid(e.to_string()))?;

    let headers = reader
        .headers()
        .map_err(|e| crate::Error::Invalid(e.to_string()))?
        .clone();

    let idx = |key: &str| {
        headers
            .iter()
            .position(|s| s == key)
            .ok_or_else(|| crate::Error::Invalid(format!("missing {key}")))
    };

    let (filename, side, source, tc, plot, treatment, n2o, co2) = (
        idx("filename")?,
        idx("side")?,
        idx("type")?,
        idx("Tc")?,
        idx("nr")?,
        idx("treatment")?,
        idx("N2O_N_mug_m2h")?,
        idx("CO2_C_mug_m2h")?,
    );

    let records: Vec<_> = reader
        .records()
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| crate::Error::Invalid(e.to_string()))?;

    let layout = crate::session::preset_layout("capture")?;

    let cfg = crate::api::ProjectConfig::default();

    let results: Vec<Result<_>> = records
        .par_iter()
        .filter(|r| r.get(source) == Some("robot"))
        .map(|r| {
            let name = r.get(filename).unwrap_or("");

            let side_name = r.get(side).unwrap_or("");

            let side = if side_name == "left" { 1 } else { 2 };

            let path = raw_dir.join(name);

            let path = if path.exists() {
                path
            } else {
                raw_dir.join(format!("{name}.gz"))
            };

            let raw = raw::load(&path, "Europe/Oslo")?;

            let temp = crate::session::interpolate(&temperatures, raw.metadata.time)
                .ok_or_else(|| crate::Error::Invalid("missing weather".into()))?;

            let o = options
                .get(&(name.into(), side_name.into()))
                .ok_or_else(|| crate::Error::Invalid("missing golden options".into()))?;

            let regressions = regression::compute(&raw, side, &o[0], &o[1], temp)?;

            let mut row = crate::api::FluxRow::new();

            crate::session::assign(&mut row, &raw.metadata, side, &cfg, &layout);

            let expected = |i: usize| {
                r.get(i)
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(f64::NAN)
            };

            let close = |a: f64, b: f64| (a - b).abs() <= 1e-9 * b.abs().max(1e-10);

            Ok([
                close(temp, expected(tc)),
                close(row["plotId"].as_f64().unwrap_or(f64::NAN), expected(plot)),
                close(
                    row["treatmentId"].as_f64().unwrap_or(f64::NAN),
                    expected(treatment),
                ),
                close(regressions["N2O"].flux, expected(n2o)),
                close(regressions["CO2"].flux, expected(co2)),
            ])
        })
        .collect();

    let mut counts = [0usize; 5];

    let mut total = 0;

    for r in results {
        let matches = r?;

        total += 1;

        for (i, m) in matches.into_iter().enumerate() {
            counts[i] += usize::from(m);
        }
    }
    Ok(
        json!({"robotRows":total,"temperatureMatches":counts[0],"plotMatches":counts[1],"treatmentMatches":counts[2],"n2oFluxMatches":counts[3],"co2FluxMatches":counts[4]}),
    )
}
