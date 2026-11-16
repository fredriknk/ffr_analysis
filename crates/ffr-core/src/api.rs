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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slope: Option<f64>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
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
    pub name: String,
    pub gases: Vec<String>,
    pub qc_threshold: f64,
    pub plot_assignment: String,
    pub time_zone: String,
    pub defaults: AnalysisOptions,
    pub fallback_temperature: f64,
    pub pressure: f64,
    pub chamber_height: f64,
    #[serde(skip_serializing)]
    pub chamber_distance: f64,
    #[serde(skip_serializing)]
    pub chamber_forward_distance: f64,
    #[serde(skip_serializing)]
    pub preset: Option<String>,
    #[serde(skip_serializing)]
    pub qc: QcThresholds,
}
impl Default for ProjectConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            gases: crate::regression::GASES
                .iter()
                .map(|s| s.to_string())
                .collect(),
            qc_threshold: 0.001,
            plot_assignment: "polygons".into(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
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
pub(crate) struct StoredLayout {
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
    #[serde(skip_serializing)]
    pub preset: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<ImportError>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImportError {
    pub path: String,
    pub message: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Layout {
    pub treatments: Vec<Treatment>,
    pub plots: Vec<Plot>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Treatment {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub short_name: String,
    pub colour: String,
    #[serde(default)]
    pub sort_order: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plot {
    pub id: i64,
    pub label: String,
    pub treatment_id: i64,
    #[serde(default)]
    pub block: i64,
    pub polygon: Option<Vec<[f64; 2]>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesMeta {
    pub id: i64,
    pub name: String,
    pub unit: String,
    #[serde(default = "series_source")]
    pub source: String,
    pub count: usize,
    pub time_range: [i64; 2],
}
fn series_source() -> String {
    "Imported".into()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SeriesPoint {
    pub time: i64,
    pub value: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SeriesData {
    pub id: i64,
    pub points: Vec<SeriesPoint>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: i64,
    pub time: i64,
    pub kind: String,
    pub flux_ids: Vec<i64>,
    pub before: String,
    pub after: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub changed: bool,
    pub can_undo: bool,
    pub can_redo: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreatmentSummary {
    pub gas: String,
    pub unit: String,
    pub cumulative_unit: String,
    pub treatments: Vec<TreatmentTotal>,
    pub plots: Vec<PlotTotal>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreatmentTotal {
    pub id: i64,
    pub name: String,
    pub colour: String,
    pub n_plots: usize,
    pub mean: f64,
    pub sd: f64,
    pub gmean: Option<f64>,
    pub gsd: Option<f64>,
    pub r#box: [f64; 5],
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotTotal {
    pub plot_id: i64,
    pub label: String,
    pub treatment_id: i64,
    pub total: f64,
    pub points: Vec<SummaryPoint>,
    pub daily: Vec<DailyTotal>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryPoint {
    pub flux_id: i64,
    pub time: i64,
    pub value: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DailyTotal {
    pub time: i64,
    pub mean: f64,
    pub cumulative: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyScan {
    pub config_paths: Vec<String>,
    pub raw_files: usize,
    pub manual_exists: bool,
    pub logger_exists: bool,
    pub weather_exists: bool,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePreview {
    pub sheets: Vec<String>,
    pub header_candidates: Vec<usize>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub opened_at: i64,
}
