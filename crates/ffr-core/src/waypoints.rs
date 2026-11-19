use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::{io::Write, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Waypoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub angle: f64,
    pub kind: String,
    pub side: String,
    pub name: String,
    #[serde(default)]
    pub original: Option<[String; 4]>,
}
impl Waypoint {
    pub fn validate(&self) -> Result<()> {
        if ![self.x, self.y, self.z, self.angle]
            .iter()
            .all(|v| v.is_finite())
        {
            return Err(Error::Invalid(
                "Coordinates and heading must be finite numbers.".into(),
            ));
        }
        if !["Measure", "DriveThrough", "TurningPoint", "Stop"].contains(&self.kind.as_str()) {
            return Err(Error::Invalid(format!(
                "Unknown waypoint type: '{}'.",
                self.kind
            )));
        }
        if !["both", "left", "right", "none"].contains(&self.side.as_str()) {
            return Err(Error::Invalid(format!(
                "Unknown measurement side: '{}'.",
                self.side
            )));
        }
        if self.name.trim().is_empty() {
            return Err(Error::Invalid("Waypoint name cannot be empty.".into()));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WaypointRef {
    pub waypoint: i64,
    pub side: ChamberSide,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChamberSide {
    Left,
    Right,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotGenOptions {
    pub cluster_distance: f64,
    pub shape: String,
    pub size: f64,
    pub width: f64,
    pub height: f64,
    pub angle: Option<f64>,
    pub label_prefix: String,
}
impl Default for PlotGenOptions {
    fn default() -> Self {
        Self {
            cluster_distance: 1.5,
            shape: "auto".into(),
            size: 2.,
            width: 2.,
            height: 4.,
            angle: None,
            label_prefix: "P".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaypointVisit {
    pub waypoint_index: usize,
    pub name: String,
    pub waypoint: Option<i64>,
    pub side: ChamberSide,
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProposedPlot {
    pub key: usize,
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub polygon: Vec<[f64; 2]>,
    pub visits: Vec<WaypointVisit>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlotProposal {
    pub angle: f64,
    pub plots: Vec<ProposedPlot>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWaypointLayoutArgs {
    pub points: Vec<Waypoint>,
    pub source_path: Option<String>,
    pub plots: Vec<WaypointLayoutPlot>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaypointLayoutPlot {
    pub label: String,
    pub polygon: Vec<[f64; 2]>,
    pub treatment_id: Option<i64>,
    #[serde(default)]
    pub block: i64,
    pub waypoints: Vec<WaypointRef>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRoute {
    pub points: Vec<Waypoint>,
    pub source_path: Option<String>,
    pub saved_at: i64,
}
#[derive(Clone, Copy, Debug)]
pub struct Geometry {
    pub sideways: f64,
    pub forward: f64,
}
impl Default for Geometry {
    fn default() -> Self {
        Self {
            sideways: 2.,
            forward: 0.2,
        }
    }
}

pub fn read(path: impl AsRef<Path>) -> Result<Vec<Waypoint>> {
    parse(&std::fs::read_to_string(path)?)
}
pub fn parse(text: &str) -> Result<Vec<Waypoint>> {
    let text = text.trim_start_matches('\u{feff}');
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut points = vec![];
    for row in reader.records() {
        let row = row.map_err(|e| {
            Error::Invalid(format!(
                "Line {}: {e}",
                e.position().map_or(1, |p| p.line())
            ))
        })?;
        // csv positions precede blank lines skipped by the reader. Report the
        // physical start of the record, including those lines in the count.
        let mut start = row.position().map_or(0, |p| p.byte() as usize);
        while text
            .as_bytes()
            .get(start)
            .is_some_and(|b| *b == b'\r' || *b == b'\n')
        {
            start += 1;
        }
        let line = text.as_bytes()[..start]
            .iter()
            .filter(|b| **b == b'\n')
            .count()
            + 1;
        if row.iter().all(|s| s.trim().is_empty()) {
            continue;
        }
        if row.len() != 7 {
            return Err(Error::Invalid(format!(
                "Line {line}: expected 7 columns, found {}.",
                row.len()
            )));
        }
        let f: Vec<_> = row.iter().map(str::trim).collect();
        let mut n = [0.; 4];
        for i in 0..4 {
            n[i] = f[i]
                .parse()
                .map_err(|_| Error::Invalid(format!("Line {line}: Invalid number: '{}'.", f[i])))?;
        }
        let p = Waypoint {
            x: n[0],
            y: n[1],
            z: n[2],
            angle: n[3],
            kind: f[4].into(),
            side: f[5].into(),
            name: f[6].into(),
            original: Some(std::array::from_fn(|i| f[i].into())),
        };
        p.validate()
            .map_err(|e| Error::Invalid(format!("Line {line}: {e}")))?;
        points.push(p);
    }
    if points.is_empty() {
        return Err(Error::Invalid("This file contains no waypoints.".into()));
    }
    Ok(points)
}
pub fn write(path: impl AsRef<Path>, points: &[Waypoint], source: Option<&Path>) -> Result<()> {
    let path = path.as_ref();
    if let Some(source) = source {
        if path.exists()
            && source.exists()
            && (std::fs::canonicalize(path)? == std::fs::canonicalize(source)?
                || same_file::is_same_file(path, source)?)
        {
            return Err(Error::Invalid(
                "Choose a new filename to keep the original waypoint file intact.".into(),
            ));
        }
    }
    for p in points {
        p.validate()?;
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut writer = csv::WriterBuilder::new()
            .terminator(csv::Terminator::Any(b'\n'))
            .from_writer(temp.as_file_mut());
        for p in points {
            let values = [p.x, p.y, p.z, p.angle];
            let mut fields: Vec<String> = values
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    p.original
                        .as_ref()
                        .and_then(|o| {
                            o[i].parse::<f64>()
                                .ok()
                                .filter(|n| n == v)
                                .map(|_| o[i].clone())
                        })
                        .unwrap_or_else(|| v.to_string())
                })
                .collect();
            fields.extend([p.kind.clone(), p.side.clone(), p.name.clone()]);
            writer
                .write_record(fields)
                .map_err(|e| Error::Invalid(e.to_string()))?;
        }
        writer.flush()?;
    }
    temp.flush()?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| Error::Io(e.error))?;
    Ok(())
}
pub fn waypoint_number(name: &str) -> Option<i64> {
    name.split(|c: char| !c.is_ascii_digit())
        .rfind(|s| !s.is_empty())
        .and_then(|s| s.parse().ok())
}
pub fn chambers(points: &[Waypoint], g: Geometry) -> Result<Vec<WaypointVisit>> {
    if !g.sideways.is_finite() || g.sideways <= 0. || !g.forward.is_finite() || g.forward < 0. {
        return Err(Error::Invalid("Invalid chamber geometry.".into()));
    }
    let mut visits = vec![];
    for (i, p) in points.iter().enumerate() {
        p.validate()?;
        if p.kind != "Measure" {
            continue;
        }
        for (side, sign) in [(ChamberSide::Left, 1.), (ChamberSide::Right, -1.)] {
            if p.side != "both"
                && p.side
                    != if side == ChamberSide::Left {
                        "left"
                    } else {
                        "right"
                    }
            {
                continue;
            }
            let a = p.angle + sign * std::f64::consts::FRAC_PI_2;
            visits.push(WaypointVisit {
                waypoint_index: i,
                name: p.name.clone(),
                waypoint: waypoint_number(&p.name),
                side,
                x: p.x + g.sideways * a.cos() + g.forward * p.angle.cos(),
                y: p.y + g.sideways * a.sin() + g.forward * p.angle.sin(),
            });
        }
    }
    Ok(visits)
}
pub fn field_angle(coords: &[[f64; 2]]) -> f64 {
    let mut vertices = coords.to_vec();
    vertices.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    vertices.dedup();
    if vertices.len() < 2 {
        return 0.;
    }
    fn cross(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    }
    let mut hull = vec![];
    for iter in [vertices.clone(), vertices.iter().rev().copied().collect()] {
        let mut half = vec![];
        for p in iter {
            while half.len() >= 2 && cross(half[half.len() - 2], half[half.len() - 1], p) <= 0. {
                half.pop();
            }
            half.push(p);
        }
        half.pop();
        hull.extend(half);
    }
    let mut best = (f64::INFINITY, 0.);
    for i in 0..hull.len() {
        let a = hull[i];
        let b = hull[(i + 1) % hull.len()];
        let angle = (b[1] - a[1]).atan2(b[0] - a[0]);
        let (s, c) = angle.sin_cos();
        let mut bounds = [
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ];
        for p in &hull {
            let x = p[0] - vertices[0][0];
            let y = p[1] - vertices[0][1];
            let u = x * c + y * s;
            let v = -x * s + y * c;
            bounds[0] = bounds[0].min(u);
            bounds[1] = bounds[1].max(u);
            bounds[2] = bounds[2].min(v);
            bounds[3] = bounds[3].max(v);
        }
        let area = (bounds[1] - bounds[0]) * (bounds[3] - bounds[2]);
        if area < best.0 {
            best = (area, angle);
        }
    }
    best.1
}
pub fn generate(points: &[Waypoint], opts: &PlotGenOptions, g: Geometry) -> Result<PlotProposal> {
    if ![opts.cluster_distance, opts.size, opts.width, opts.height]
        .iter()
        .all(|v| v.is_finite() && *v > 0.)
        || opts.angle.is_some_and(|v| !v.is_finite())
        || !["auto", "square", "rectangle"].contains(&opts.shape.as_str())
    {
        return Err(Error::Invalid("Plot distances and sizes must be positive finite numbers and shape must be auto, square or rectangle.".into()));
    }
    let mut clusters: Vec<Vec<WaypointVisit>> = vec![];
    for v in chambers(points, g)? {
        if let Some(cluster) = clusters.iter_mut().find(|c| {
            c.iter()
                .all(|p| (p.x - v.x).hypot(p.y - v.y) <= opts.cluster_distance)
        }) {
            cluster.push(v);
        } else {
            clusters.push(vec![v]);
        }
    }
    let centres: Vec<[f64; 2]> = clusters
        .iter()
        .map(|c| {
            [
                c.iter().map(|v| v.x).sum::<f64>() / c.len() as f64,
                c.iter().map(|v| v.y).sum::<f64>() / c.len() as f64,
            ]
        })
        .collect();
    let angle = opts.angle.unwrap_or_else(|| field_angle(&centres));
    let (s, c) = angle.sin_cos();
    let plots = clusters
        .into_iter()
        .enumerate()
        .map(|(i, visits)| {
            let [x, y] = centres[i];
            let auto = centres
                .iter()
                .enumerate()
                .filter(|(j, _)| *j != i)
                .map(|(_, p)| (p[0] - x).hypot(p[1] - y) / 2.)
                .reduce(f64::min)
                .unwrap_or(1.);
            let (w, h) = match opts.shape.as_str() {
                "square" => (opts.size / 2., opts.size / 2.),
                "rectangle" => (opts.width / 2., opts.height / 2.),
                _ => (auto, auto),
            };
            ProposedPlot {
                key: i + 1,
                label: format!("{}{}", opts.label_prefix, i + 1),
                x,
                y,
                polygon: [[-w, -h], [w, -h], [w, h], [-w, h]]
                    .iter()
                    .map(|[u, v]| [x + u * c - v * s, y + u * s + v * c])
                    .collect(),
                visits,
            }
        })
        .collect();
    Ok(PlotProposal { angle, plots })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn point(x: f64, y: f64, angle: f64) -> Waypoint {
        Waypoint {
            x,
            y,
            z: 0.,
            angle,
            kind: "Measure".into(),
            side: "both".into(),
            name: "Plot_15".into(),
            original: None,
        }
    }
    #[test]
    fn csv_validation_and_precision() {
        for (text, message) in [
            (
                "1,2,3,4,Measure,both",
                "Line 1: expected 7 columns, found 6.",
            ),
            (
                "\n1,2,3,4,Foo,both,P",
                "Line 2: Unknown waypoint type: 'Foo'.",
            ),
            (
                "1,2,NaN,4,Measure,both,P",
                "Line 1: Coordinates and heading must be finite numbers.",
            ),
            (
                "1,2,3,4,Measure,foo,P",
                "Line 1: Unknown measurement side: 'foo'.",
            ),
            (
                "1,2,3,4,Measure,both, ",
                "Line 1: Waypoint name cannot be empty.",
            ),
            (" \n\n", "This file contains no waypoints."),
        ] {
            assert_eq!(parse(text).unwrap_err().to_string(), message);
        }
        let mut points =
            parse("\u{feff}\n \n1.000000,2e0,0.0,0.000,Measure,both,\"a,\"\"b\"\"\"\n").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");
        points[0].y = 2.25;
        write(&path, &points, None).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            text,
            "1.000000,2.25,0.0,0.000,Measure,both,\"a,\"\"b\"\"\"\n"
        );
        assert_eq!(read(&path).unwrap()[0].name, "a,\"b\"");
        assert!(write(&path, &points, Some(&path))
            .unwrap_err()
            .to_string()
            .contains("Choose a new filename"));
        let alias = dir.path().join("alias.csv");
        std::fs::hard_link(&path, &alias).unwrap();
        assert!(write(&alias, &points, Some(&path)).is_err());
        std::fs::remove_file(alias).unwrap();
        points[0].x = f64::NAN;
        assert!(write(&path, &points, None).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        points[0].x = 3.;
        let folder = dir.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        assert!(write(&folder, &points, None).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
        write(&path, &points, None).unwrap();
        assert!(std::fs::read_to_string(path)
            .unwrap()
            .starts_with("3,2.25,"));
    }
    #[test]
    fn chamber_geometry_and_two_way_complete_link() {
        let p = point(0., 0., 0.);
        let ch = chambers(std::slice::from_ref(&p), Geometry::default()).unwrap();
        assert!((ch[0].x - 0.2).abs() < 1e-12);
        assert_eq!(ch[0].y, 2.);
        assert_eq!(ch[1].y, -2.);
        let reverse = point(0.4, 0., std::f64::consts::PI);
        let proposal = generate(
            &[p.clone(), p, reverse.clone(), reverse],
            &PlotGenOptions::default(),
            Geometry::default(),
        )
        .unwrap();
        assert_eq!(proposal.plots.len(), 2);
        assert!(proposal.plots.iter().all(|p| p.visits.len() == 4));
        assert_eq!(proposal.plots[0].visits[2].side, ChamberSide::Right);
        for (name, n) in [
            ("Plot_15", Some(15)),
            ("DrThr_2b", Some(2)),
            ("Start", None),
            ("A12b34c", Some(34)),
        ] {
            assert_eq!(waypoint_number(name), n);
        }
    }
    #[test]
    fn default_grouping_distance_uses_complete_link_at_one_and_a_half_metres() {
        let points: Vec<_> = [0., 1.5, 3.]
            .into_iter()
            .map(|x| {
                let mut p = point(x, 0., 0.);
                p.side = "left".into();
                p
            })
            .collect();
        let opts = PlotGenOptions::default();
        assert_eq!(opts.cluster_distance, 1.5);
        let proposal = generate(&points, &opts, Geometry::default()).unwrap();
        assert_eq!(proposal.plots.len(), 2);
        assert_eq!(proposal.plots[0].visits.len(), 2);
    }
    #[test]
    fn field_orientation_and_shapes() {
        let angle = 0.37_f64;
        let (s, c) = angle.sin_cos();
        let coords: Vec<_> = [[0., 0.], [12., 0.], [12., 4.], [0., 4.]]
            .iter()
            .map(|[x, y]| [x * c - y * s + 500000., x * s + y * c + 6000000.])
            .collect();
        let got = field_angle(&coords);
        assert!(((got - angle) * 2.).sin().abs() < 1e-8);
        assert_eq!(field_angle(&[]), 0.);
        assert_eq!(field_angle(&[[1., 2.], [1., 2.]]), 0.);
        for (shape, w, h) in [("square", 6., 6.), ("rectangle", 4., 8.), ("auto", 4., 4.)] {
            let opts = PlotGenOptions {
                shape: shape.into(),
                size: 6.,
                width: 4.,
                height: 8.,
                angle: Some(angle),
                ..Default::default()
            };
            let proposal = generate(&[point(0., 0., 0.)], &opts, Geometry::default()).unwrap();
            let poly = &proposal.plots[0].polygon;
            assert!(((poly[1][0] - poly[0][0]).hypot(poly[1][1] - poly[0][1]) - w).abs() < 1e-10);
            assert!(((poly[2][0] - poly[1][0]).hypot(poly[2][1] - poly[1][1]) - h).abs() < 1e-10);
        }
        let mut p = point(0., 0., 0.);
        p.side = "left".into();
        let one = generate(&[p], &PlotGenOptions::default(), Geometry::default()).unwrap();
        assert_eq!(one.plots[0].polygon[1][0] - one.plots[0].polygon[0][0], 2.);
    }
    #[test]
    fn optional_local_routes() {
        let Some(dir) = std::env::var_os("FFR_WAYPOINT_DIR") else {
            return;
        };
        let out = tempfile::tempdir().unwrap();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|s| s != "csv") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            if text.trim_start_matches('\u{feff}').trim().is_empty() {
                assert_eq!(
                    parse(&text).unwrap_err().to_string(),
                    "This file contains no waypoints."
                );
                continue;
            }
            let points = read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            let target = out.path().join("roundtrip.csv");
            write(&target, &points, Some(&path)).unwrap();
            assert_eq!(
                serde_json::to_value(&points).unwrap(),
                serde_json::to_value(read(&target).unwrap()).unwrap()
            );
            if path.file_name().unwrap() == "Soil2Milk_hel.csv" {
                let n = chambers(&points, Geometry::default()).unwrap().len();
                let plots = generate(&points, &PlotGenOptions::default(), Geometry::default())
                    .unwrap()
                    .plots
                    .len();
                assert!(plots as f64 / (n as f64) < 0.65);
            }
        }
    }
}
