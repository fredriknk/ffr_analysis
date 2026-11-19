use crate::{
    api::*,
    raw::{self, Raw},
    regression::{self},
    Error, Result,
};

use rayon::prelude::*;

use rusqlite::{params, Connection, OptionalExtension};

use serde_json::{json, Value};

use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Default)]

pub struct Session {
    db: Option<Connection>,
    path: String,
    lag_cache: std::cell::RefCell<BTreeMap<(i64, u64), (f64, f64)>>,
    recent: Vec<Value>,
    client_id: Option<String>,
    series_cache: std::cell::RefCell<BTreeMap<i64, Vec<Value>>>,
    values_cache: std::cell::RefCell<BTreeMap<i64, Vec<(i64, f64)>>>,
}

mod export;
mod fluxes;
mod folder;
mod history;
mod import;
mod project;
mod results;
mod series;
mod summary;
mod waypoints;

impl Session {
    pub(super) fn db(&self) -> Result<&Connection> {
        self.db
            .as_ref()
            .ok_or_else(|| Error::Invalid("no project open".into()))
    }
}
/// Version of the stored per-flux analysis. Opening a project analysed by an older
/// version recomputes every flux once (results, findings, derived columns).
/// 3: instrument dropouts no longer exclude a gas automatically.
/// 4: analyser error codes (about 1.8e304) are dropped like zeros; files
///    that are not robot files are removed (failed robot files are re-read by
///    the next import or folder scan).
/// 5: waypoint matches take precedence over polygon matches.
pub(crate) const ANALYSIS_VERSION: i64 = 5;
/// Sets `<gas>_excluded` for every gas from the user's per-gas choice in
/// `gasExcluded` (`{gas: bool}`; default included). Whole-flux `excluded` is
/// separate and wins everywhere. Drops the 2.1.0 `autoExcludedGases` field.
pub(crate) fn apply_gas_exclusion(row: &mut FluxRow) {
    row.remove("autoExcludedGases");
    let choice = row.get("gasExcluded").cloned().unwrap_or(Value::Null);
    for gas in regression::GASES {
        let excluded = choice.get(gas).and_then(Value::as_bool).unwrap_or(false);
        row.insert(format!("{gas}_excluded"), json!(excluded));
    }
}
pub(crate) fn interpolate(p: &[(i64, f64)], time: i64) -> Option<f64> {
    if p.is_empty() {
        return None;
    }
    let i = p.partition_point(|(t, _)| *t < time);
    if i == 0 {
        return Some(p[0].1);
    }
    if i == p.len() {
        return Some(p[i - 1].1);
    }
    let (a, x) = p[i - 1];
    let (b, y) = p[i];
    Some(x + (y - x) * (time - a) as f64 / (b - a) as f64)
}
pub(crate) fn assign(
    row: &mut FluxRow,
    m: &raw::Metadata,
    side: u8,
    cfg: &ProjectConfig,
    layout: &StoredLayout,
) {
    let (Some(mut x), Some(mut y)) = (m.x, m.y) else {
        return;
    };
    if let Some(h) = m.heading {
        let a = h + if side == 1 {
            std::f64::consts::FRAC_PI_2
        } else {
            -std::f64::consts::FRAC_PI_2
        };
        x += cfg.chamber_distance * a.cos() + cfg.chamber_forward_distance * h.cos();
        y += cfg.chamber_distance * a.sin() + cfg.chamber_forward_distance * h.sin();
    }
    row.insert("x".into(), json!(x));
    row.insert("y".into(), json!(y));
    for key in ["plotId", "plotLabel", "treatmentId", "treatmentName"] {
        row.insert(key.into(), Value::Null);
    }
    let plot = if let Some(id) = row.get("plotOverride").filter(|v| !v.is_null()) {
        layout.plots.iter().find(|p| &p["id"] == id)
    } else {
        let side = if side == 1 { "left" } else { "right" };
        crate::waypoints::waypoint_number(&m.waypoint)
            .and_then(|waypoint| {
                layout.plots.iter().find(|p| {
                    p["waypoints"].as_array().is_some_and(|visits| {
                        visits
                            .iter()
                            .any(|v| v["side"] == side && v["waypoint"].as_i64() == Some(waypoint))
                    })
                })
            })
            .or_else(|| {
                layout.plots.iter().find(|p| {
                    p["polygon"]
                        .as_array()
                        .is_some_and(|poly| contains(poly, x, y))
                })
            })
    };
    if let Some(p) = plot {
        row.insert("plotId".into(), p["id"].clone());
        row.insert("plotLabel".into(), p["label"].clone());
        row.insert("treatmentId".into(), p["treatmentId"].clone());
        if let Some(t) = layout
            .treatments
            .iter()
            .find(|t| t["id"] == p["treatmentId"])
        {
            row.insert("treatmentName".into(), t["name"].clone());
        }
    }
}
fn contains(poly: &[Value], x: f64, y: f64) -> bool {
    if poly.is_empty() {
        return false;
    }
    let mut inside = false;
    let mut p = &poly[0];
    for q in poly.iter().cycle().skip(1).take(poly.len()) {
        let (a, b, c, d) = (
            p[0].as_f64().unwrap_or(0.),
            p[1].as_f64().unwrap_or(0.),
            q[0].as_f64().unwrap_or(0.),
            q[1].as_f64().unwrap_or(0.),
        );
        if y > b.min(d)
            && y <= b.max(d)
            && x <= a.max(c)
            && (a == c || x <= (y - b) * (c - a) / (d - b) + a)
        {
            inside = !inside;
        }
        p = q;
    }
    inside
}
fn mean(v: &[f64]) -> f64 {
    if v.is_empty() {
        f64::NAN
    } else {
        v.iter().sum::<f64>() / v.len() as f64
    }
}
fn sd(v: &[f64], ddof: usize) -> f64 {
    let m = mean(v);
    if v.len() <= ddof {
        f64::NAN
    } else {
        (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (v.len() - ddof) as f64).sqrt()
    }
}
fn cell_text(v: &Value) -> String {
    if v.is_null() {
        String::new()
    } else {
        v.as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| v.to_string())
    }
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|v| v.is_finite())
}

use import::parse_time;
pub(crate) use import::preset_layout;

mod metadata;
use metadata::column_spec;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plot_assignment_prefers_waypoint_then_polygon_and_honors_override() {
        let cfg = ProjectConfig::default();
        let m = raw::filename(
            "2024-01-01-12-00-00-x10_0-y10_0-z0_0-h0_0_both_Lane_2_Plot_17_",
            &cfg.time_zone,
        )
        .unwrap();
        let mut layout = StoredLayout {
            plots: vec![
                json!({
                    "id": 1, "label": "A", "treatmentId": 1,
                    "polygon": [[8, 7], [12, 7], [12, 13], [8, 13]]
                }),
                json!({
                    "id": 2, "label": "B", "treatmentId": 2,
                    "polygon": [[9, 11], [13, 11], [13, 15], [9, 15]],
                    "waypoints": [{"waypoint": 17, "side": "left"}]
                }),
            ],
            treatments: vec![json!({"id": 2, "name": "Control"})],
        };
        let mut row = FluxRow::new();

        assign(&mut row, &m, 1, &cfg, &layout);
        assert_eq!(row["plotId"], 2);
        assert_eq!(row["treatmentName"], "Control");
        assign(&mut row, &m, 2, &cfg, &layout);
        assert_eq!(row["plotId"], 1);

        row.insert("plotOverride".into(), json!(1));
        assign(&mut row, &m, 1, &cfg, &layout);
        assert_eq!(row["plotId"], 1);
        row.insert("plotOverride".into(), Value::Null);

        let mut waypoint_only = layout.clone();
        waypoint_only.plots.retain(|p| p["id"] == 2);
        waypoint_only.plots[0]["polygon"] = Value::Null;
        assign(&mut row, &m, 1, &cfg, &waypoint_only);
        assert_eq!(row["plotId"], 2);
        assign(&mut row, &m, 2, &cfg, &waypoint_only);
        assert!(row["plotId"].is_null());

        layout.plots[1]["waypoints"] = Value::Null;
        assign(&mut row, &m, 1, &cfg, &layout);
        assert_eq!(row["plotId"], 1);
    }
}
