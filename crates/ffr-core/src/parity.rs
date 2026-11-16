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
/// The JSONL file is produced by tools/verification.py using ast.literal_eval, never eval.
pub fn parity(raw_dir: &Path, golden_jsonl: &Path) -> Result<ParityReport> {
    let start = std::time::Instant::now();
    let text = std::fs::read_to_string(golden_jsonl)?;
    let lines: Vec<Value> = text
        .lines()
        .map(serde_json::from_str)
        .collect::<std::result::Result<_, _>>()?;
    let results:Vec<_>=lines.par_iter().map(|v|{let mut report=ParityReport{lines:1,..Default::default()};let name=v["filename"].as_str().unwrap_or("");let side=if v["side"]=="left"{1}else{2};let path=raw_dir.join(name);let path=if path.exists(){path}else{raw_dir.join(format!("{name}.gz"))};let result=raw::load(&path,"Europe/Oslo").and_then(|r|regression::compute(&r,side,&v["options"][0],&v["options"][1],20.));match result{Err(e)=>report.mismatches.push(format!("{name}: {e}")),Ok(regs)=>{for gas in regression::GASES{let Some(r)=regs.get(gas)else{report.mismatches.push(format!("{name}: missing {gas}"));continue;};for (suffix,actual) in [("",r.slope),("_intercept",r.intercept),("_rsq",r.rsq),("_pval",r.pval),("_min",r.min_y),("_max",r.max_y),("_first",r.first_y)]{let key=format!("{gas}{suffix}");if let Some(expected)=v["values"][&key].as_str().and_then(|s|s.parse::<f64>().ok()).or(v["values"][&key].as_f64()){report.comparisons+=1;let rel=(actual-expected).abs()/expected.abs().max(1e-300);if suffix.is_empty(){report.max_slope_relative_error=report.max_slope_relative_error.max(rel);}if (actual-expected).abs()>1e-9*expected.abs().max(if suffix=="_pval"{1e-12}else{1e-10}){report.mismatches.push(format!("{name} {} {key}: {actual:e} != {expected:e} (relative {rel:e})",v["side"]));}}}if gas=="N2O" {report.comparisons+=1;if v["values"]["N2O_quality_check"].as_str().unwrap_or("")!=r.qc{report.mismatches.push(format!("{name}: QC mismatch"));}}}}}if report.mismatches.is_empty(){report.matched_lines=1;}report}).collect();
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
