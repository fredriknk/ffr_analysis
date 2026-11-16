use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: String,
    pub message: String,
}
impl From<crate::Error> for ApiError {
    fn from(e: crate::Error) -> Self {
        Self {
            code: "core".into(),
            message: e.to_string(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AnalysisOptions {
    pub mode: String,
    pub start: f64,
    pub stop: f64,
    pub interval: f64,
    pub crit: String,
    pub co2_guides: bool,
    pub cut_beginnings: f64,
    pub cut_ends: f64,
    pub slope: Option<f64>,
    pub per_gas: BTreeMap<String, Value>,
}
impl Default for AnalysisOptions {
    fn default() -> Self {
        Self {
            mode: "fixed".into(),
            start: 0.,
            stop: 180.,
            interval: 100.,
            crit: "steepest".into(),
            co2_guides: true,
            cut_beginnings: 4.,
            cut_ends: 3.,
            slope: None,
            per_gas: BTreeMap::new(),
        }
    }
}
impl AnalysisOptions {
    pub fn validate(&self) -> crate::Result<()> {
        if !["fixed", "auto", "manual"].contains(&self.mode.as_str())
            || !self.start.is_finite()
            || !self.stop.is_finite()
            || self.start >= self.stop
            || !self.cut_beginnings.is_finite()
            || !self.cut_ends.is_finite()
            || self.cut_beginnings < 0.
            || self.cut_ends < 0.
            || !self.interval.is_finite()
            || self.interval <= 0.
            || !["steepest", "mse"].contains(&self.crit.as_str())
            || (self.mode == "manual" && self.slope.is_none())
            || self.slope.is_some_and(|v| !v.is_finite())
        {
            return Err(crate::Error::Invalid("invalid analysis options".into()));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProjectConfig {
    pub time_zone: String,
    pub defaults: AnalysisOptions,
    pub fallback_temperature: f64,
    pub pressure: f64,
    pub chamber_height: f64,
    pub chamber_distance: f64,
    pub chamber_forward_distance: f64,
    pub preset: Option<String>,
    pub qc: QcThresholds,
}
impl Default for ProjectConfig {
    fn default() -> Self {
        Self {
            time_zone: "Europe/Oslo".into(),
            defaults: AnalysisOptions::default(),
            fallback_temperature: 20.,
            pressure: 101000.,
            chamber_height: 0.5,
            chamber_distance: 2.,
            chamber_forward_distance: 0.2,
            preset: None,
            qc: QcThresholds::default(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct QcThresholds {
    pub max_range: f64,
    pub left_curve: f64,
    pub right_curve: f64,
    pub min_y: f64,
    pub max_y: f64,
    pub p_value: f64,
    pub zero_range: f64,
}
impl Default for QcThresholds {
    fn default() -> Self {
        Self {
            max_range: 0.14,
            left_curve: 0.0081,
            right_curve: 0.0066,
            min_y: 0.31,
            max_y: 0.34,
            p_value: 0.001,
            zero_range: 0.003,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub time_zone: String,
    pub schema_version: u32,
    pub counts: Counts,
    pub time_range: Option<[i64; 2]>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Counts {
    pub measurements: usize,
    pub fluxes: usize,
    pub excluded: usize,
    pub overridden: usize,
    pub reviewed: usize,
    pub manual: usize,
    pub series: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Progress {
    pub task: String,
    pub done: usize,
    pub total: usize,
    pub message: Option<String>,
}
pub type FluxRow = BTreeMap<String, Value>;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ValveSwitch {
    pub t: f64,
    pub side: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Trace {
    pub gas: String,
    pub unit: String,
    pub t: Vec<f64>,
    pub y: Vec<f64>,
    pub side: Vec<u8>,
    pub used: Vec<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FluxDetail {
    pub flux: FluxRow,
    pub options: AnalysisOptions,
    pub is_overridden: bool,
    pub sibling_flux_id: Option<i64>,
    pub switches: Vec<ValveSwitch>,
    pub traces: Vec<Trace>,
    pub regressions: Vec<crate::regression::Regression>,
    pub sibling: Vec<crate::regression::Regression>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub key: String,
    pub label: String,
    pub unit: Option<String>,
    pub r#type: String,
    pub group: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FluxTable {
    pub columns: Vec<ColumnMeta>,
    pub rows: usize,
    pub data: BTreeMap<String, Vec<Value>>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Layout {
    pub treatments: Vec<Value>,
    pub plots: Vec<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportArgs {
    pub legacy_dir: String,
    pub raw_dir: Option<String>,
    pub manual_path: Option<String>,
    pub logger_path: Option<String>,
    pub metno_pickle_path: Option<String>,
    pub out_path: String,
    pub preset: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub path: String,
    pub flux_ids: Vec<i64>,
    pub columns: Vec<String>,
    #[serde(default = "flat")]
    pub mode: String,
}
fn flat() -> String {
    "flat".into()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryQuery {
    pub gas: String,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub sources: Vec<String>,
    pub flux_ids: Option<Vec<i64>>,
}
