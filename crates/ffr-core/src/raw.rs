use crate::{Error, Result};
use chrono::{NaiveDateTime, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, io::Read, path::Path, sync::LazyLock};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Metadata {
    pub filename: String,
    pub time: i64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub z: Option<f64>,
    pub heading: Option<f64>,
    pub sides: String,
    pub waypoint: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Raw {
    pub metadata: Metadata,
    pub original: Value,
    pub channels: BTreeMap<String, (Vec<f64>, Vec<f64>)>,
    pub switches: Vec<(f64, u8)>,
}
pub fn filename(name: &str, zone: &str) -> Result<Metadata> {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| Error::Invalid("filename".into()))?
        .trim_end_matches(".gz");
    let dt = NaiveDateTime::parse_from_str(base.get(..19).unwrap_or(""), "%Y-%m-%d-%H-%M-%S")
        .map_err(|e| Error::Invalid(e.to_string()))?;
    let tz: chrono_tz::Tz = zone
        .parse()
        .map_err(|_| Error::Invalid("time zone".into()))?;
    let time = tz
        .from_local_datetime(&dt)
        .earliest()
        .ok_or_else(|| Error::Invalid("nonexistent local time".into()))?
        .timestamp_millis();
    // Compiled once: a shared robot folder holds tens of thousands of names.
    static NUMBERS: LazyLock<[regex::Regex; 4]> = LazyLock::new(|| {
        ["x", "y", "z", "h"]
            .map(|k| regex::Regex::new(&format!(r"-{k}(-?\d+_\d+)")).expect("number pattern"))
    });
    static SIDES: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new("left|right|both").expect("sides pattern"));
    let num = |i: usize| -> Option<f64> {
        NUMBERS[i]
            .captures(base)?
            .get(1)?
            .as_str()
            .replace('_', ".")
            .parse()
            .ok()
    };
    let m = SIDES.find(base);
    let sides = m.map_or("unknown", |m| m.as_str()).into();
    let waypoint = m.map_or("", |m| base[m.end()..].trim_matches('_')).into();
    Ok(Metadata {
        filename: base.into(),
        time,
        x: num(0),
        y: num(1),
        z: num(2),
        heading: num(3),
        sides,
        waypoint,
    })
}
pub fn read_value(path: &Path) -> Result<Value> {
    let bytes = std::fs::read(path).map_err(|e| Error::at(path, e))?;
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut s = String::new();
        flate2::read::GzDecoder::new(&bytes[..])
            .read_to_string(&mut s)
            .map_err(|e| Error::at(path, e))?;
        Ok(serde_json::from_str(&s)?)
    } else {
        Ok(serde_pickle::from_slice(
            &bytes,
            serde_pickle::DeOptions::new().decode_strings(),
        )?)
    }
}
pub fn load(path: &Path, zone: &str) -> Result<Raw> {
    let metadata = filename(&path.to_string_lossy(), zone)
        .map_err(|e| Error::Invalid(format!("{}: {e}", path.display())))?;
    from_value(metadata, read_value(path)?)
        .map_err(|e| Error::Invalid(format!("{}: {e}", path.display())))
}
pub fn from_value(metadata: Metadata, mut original: Value) -> Result<Raw> {
    if let Some(old) = original.as_array() {
        let mut map = serde_json::Map::new();
        let mut aux = vec![];
        for row in old {
            if row[0].is_string() {
                map.insert(
                    row[0].as_str().unwrap_or("").into(),
                    serde_json::json!({"ty":row[1],"dt":row[2]["dt"],"t0":row[2]["t0"]}),
                );
            } else {
                aux.push(row.clone());
            }
        }
        map.insert("aux".into(), aux.into());
        original = map.into();
    }
    let mut channels = BTreeMap::new();
    for (instrument, obj) in original
        .as_object()
        .ok_or_else(|| Error::Invalid("raw dict required".into()))?
    {
        if let Some(rows) = obj["ty"].as_array() {
            let n = rows
                .iter()
                .filter_map(|r| r[1].as_array().map(Vec::len))
                .max()
                .unwrap_or(0);
            for i in 0..n {
                let mut t = vec![];
                let mut y = vec![];
                for r in rows {
                    if let (Some(a), Some(b)) = (r[0].as_f64(), r[1][i].as_f64()) {
                        t.push(a);
                        y.push(b);
                    }
                }
                let gas = match (instrument.as_str(), i) {
                    ("dlt", 10) => "N2O".into(),
                    ("dlt", 8) => "CO".into(),
                    ("dlt", 6) => "H2O".into(),
                    ("li-cor", 0) => "CO2".into(),
                    ("li-cor", 1) => "licor_H2O".into(),
                    _ => format!("{instrument}_{i}"),
                };
                channels.insert(gas, (t, y));
            }
        }
    }
    let events: Vec<&Value> = original["aux"]
        .as_array()
        .ok_or_else(|| Error::Invalid("missing valves".into()))?
        .iter()
        .filter(|v| v.is_array())
        .collect();
    let epoch = metadata.time as f64 / 1000.;
    let mut switches = vec![];
    if events.first().is_some_and(|v| v[1].is_number()) {
        let times: Vec<f64> = events
            .iter()
            .filter_map(|v| v[0].as_f64())
            .map(|v| v - epoch)
            .filter(|v| *v >= 0.)
            .collect();
        if !times.len().is_multiple_of(2) {
            return Err(Error::Invalid("unpaired old valve events".into()));
        }
        for (i, p) in times.chunks(2).enumerate() {
            switches.push(((p[0] + p[1]) / 2., if i.is_multiple_of(2) { 2 } else { 1 }));
        }
    } else if events
        .iter()
        .any(|e| e[1][0].as_u64().is_some_and(|v| v > 2))
    {
        switches = multi_valve_switches(&events, epoch)?;
    } else {
        if events.len() < 2 || !events.len().is_multiple_of(2) {
            return Err(Error::Invalid("unpaired valve events".into()));
        }
        for (i, e) in events.iter().enumerate() {
            let state = e[1][1].as_u64();
            let side = e[1][0].as_u64();
            if state != Some(if i % 2 == 0 { 1 } else { 0 }) || !matches!(side, Some(1 | 2)) {
                return Err(Error::Invalid("invalid valve state".into()));
            }
            if i > 0 {
                let prev = events[i - 1];
                let delta = e[0].as_f64().unwrap_or(0.) - prev[0].as_f64().unwrap_or(0.);
                if (i % 2 == 1 && delta >= 2.) || (i % 2 == 0 && delta <= 2.) {
                    return Err(Error::Invalid("invalid valve timing".into()));
                }
            }
        }
        for i in (1..events.len() - 1).step_by(2) {
            if events[i][1][0] != events[i + 1][1][0] {
                return Err(Error::Invalid("valve sides must follow ABBA".into()));
            }
        }
        for p in events.chunks(2) {
            if p[0][1][0] == p[1][1][0] {
                return Err(Error::Invalid("valves must differ".into()));
            }
            switches.push((
                ((p[0][0].as_f64().unwrap_or(0.) - epoch)
                    + (p[1][0].as_f64().unwrap_or(0.) - epoch))
                    / 2.,
                p[0][1][0].as_u64().unwrap_or(1) as u8,
            ));
        }
    }
    Ok(Raw {
        metadata,
        original,
        channels,
        switches,
    })
}
/// Switches of robots that log more than the two chamber valves (NitroScope,
/// 2026: valve 3 is closed at every chamber switch, and valves 4, 5 and 3 open
/// after the measurement). Each switch is one valve opening followed, within
/// 2 s, by others closing; its time is the midpoint of the opening and the
/// first closing, as for the legacy two-valve pairs. Valve 1 opening starts
/// a left segment, valve 2 a right one; any other valve (or a burst that only
/// closes valves) starts a segment that belongs to no chamber (side 0), so it
/// ends the chamber segment before it. A repeated switch to the same side is
/// the same segment.
fn multi_valve_switches(events: &[&Value], epoch: f64) -> Result<Vec<(f64, u8)>> {
    let mut bursts: Vec<Vec<(f64, u64, u64)>> = vec![];
    for e in events {
        let (Some(t), Some(valve), Some(state)) =
            (e[0].as_f64(), e[1][0].as_u64(), e[1][1].as_u64())
        else {
            return Err(Error::Invalid("invalid valve event".into()));
        };
        if state > 1 {
            return Err(Error::Invalid("invalid valve state".into()));
        }
        // An opening valve starts a switch; the closings just after it
        // (within 2 s) belong to it.
        match bursts.last_mut() {
            Some(b) if state == 0 && t - b[0].0 < 2. => b.push((t, valve, state)),
            _ => bursts.push(vec![(t, valve, state)]),
        }
    }
    let mut switches: Vec<(f64, u8)> = vec![];
    for b in bursts {
        let opened = (b[0].2 == 1).then_some(b[0].1);
        let side = match opened {
            Some(1) => 1,
            Some(2) => 2,
            _ => 0,
        };
        if switches.last().is_some_and(|s| s.1 == side) {
            continue;
        }
        let t = if b.len() > 1 {
            (b[0].0 + b[1].0) / 2.
        } else {
            b[0].0
        };
        switches.push((t - epoch, side));
    }
    if !switches.iter().any(|s| s.1 != 0) {
        return Err(Error::Invalid("no chamber valve switches".into()));
    }
    Ok(switches)
}
/// Legacy search_sorted is deliberately a ceiling, not nearest to either neighbour.
pub fn group_indices(t: &[f64], switches: &[(f64, u8)], beg: f64, end: f64) -> Vec<u8> {
    let mut sides = vec![0; t.len()];
    for (a, b, side) in group_ranges(t, switches, beg, end) {
        sides[a..b].fill(side);
    }
    sides
}
pub fn group_ranges(
    t: &[f64],
    switches: &[(f64, u8)],
    beg: f64,
    end: f64,
) -> Vec<(usize, usize, u8)> {
    let mut ranges = vec![];
    if t.is_empty() {
        return ranges;
    }
    for (i, (s, side)) in switches.iter().enumerate() {
        let next = switches.get(i + 1).map_or(t[t.len() - 1], |x| x.0);
        let a = search_sorted(t, s + beg);
        let b = search_sorted(t, next - end) + 1;
        if a < b {
            ranges.push((a, b, *side));
        }
    }
    ranges
}

// Keep the legacy binary-search path and subsequent neighbour check even when
// an instrument's clock jumps backwards inside a file.
pub fn search_sorted(t: &[f64], value: f64) -> usize {
    let (mut lo, mut hi) = (0, t.len());
    while lo < hi {
        let mid = (lo + hi) / 2;
        if t[mid] < value {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if lo < t.len() - 1 && (t[lo + 1] - value).abs() < (t[lo] - value).abs() {
        lo += 1;
    }
    lo.min(t.len() - 1)
}
