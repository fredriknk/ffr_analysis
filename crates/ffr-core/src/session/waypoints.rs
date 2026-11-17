use super::*;
use crate::waypoints::*;
impl Session {
    pub fn waypoints_read(&self, path: &str) -> Result<Vec<Waypoint>> {
        crate::waypoints::read(path)
    }
    pub fn waypoints_write(
        &self,
        path: &str,
        points: &[Waypoint],
        source_path: Option<&str>,
    ) -> Result<()> {
        crate::waypoints::write(path, points, source_path.map(Path::new))
    }
    pub fn waypoint_plots(
        &self,
        points: &[Waypoint],
        opts: &PlotGenOptions,
    ) -> Result<PlotProposal> {
        let geometry = if self.db.is_some() {
            let cfg = self.get_config()?;
            Geometry {
                sideways: cfg.chamber_distance,
                forward: cfg.chamber_forward_distance,
            }
        } else {
            Geometry::default()
        };
        crate::waypoints::generate(points, opts, geometry)
    }
    pub fn get_route(&self) -> Result<Option<StoredRoute>> {
        let text: Option<String> = self
            .db()?
            .query_row("SELECT value FROM meta WHERE key='route'", [], |r| r.get(0))
            .optional()?;
        text.map(|s| serde_json::from_str(&s).map_err(Error::from))
            .transpose()
    }
    pub fn apply_waypoint_layout(
        &self,
        args: ApplyWaypointLayoutArgs,
        progress: impl Fn(Progress),
    ) -> Result<Layout> {
        for p in &args.points {
            p.validate()?;
        }
        for p in &args.plots {
            if p.label.trim().is_empty()
                || p.polygon.len() < 3
                || !p.polygon.iter().flatten().all(|v| v.is_finite())
            {
                return Err(Error::Invalid(
                    "Plots need a non-empty label and a polygon with at least three finite points."
                        .into(),
                ));
            }
        }
        let tx = self.db()?.unchecked_transaction()?;
        let mut layout = self.get_layout()?;
        let needs_unassigned = args.plots.iter().any(|p| {
            !layout
                .treatments
                .iter()
                .any(|t| Some(t.id) == p.treatment_id)
        });
        let unassigned = if needs_unassigned {
            if let Some(t) = layout.treatments.iter().find(|t| t.name == "Unassigned") {
                t.id
            } else {
                let id = layout.treatments.iter().map(|t| t.id).max().unwrap_or(0) + 1;
                let sort_order = layout
                    .treatments
                    .iter()
                    .map(|t| t.sort_order)
                    .max()
                    .unwrap_or(-1)
                    + 1;
                layout.treatments.push(Treatment {
                    id,
                    name: "Unassigned".into(),
                    short_name: String::new(),
                    colour: "#8a99a6".into(),
                    sort_order,
                });
                id
            }
        } else {
            0
        };
        layout.plots = args
            .plots
            .into_iter()
            .enumerate()
            .map(|(i, p)| Plot {
                id: (i + 1) as i64,
                label: p.label,
                treatment_id: p
                    .treatment_id
                    .filter(|id| layout.treatments.iter().any(|t| t.id == *id))
                    .unwrap_or(unassigned),
                block: p.block,
                polygon: Some(p.polygon),
                waypoints: Some(p.waypoints),
            })
            .collect();
        self.edit_meta("layout", &layout)?;
        let route = StoredRoute {
            points: args.points,
            source_path: args.source_path,
            saved_at: chrono::Utc::now().timestamp_millis(),
        };
        self.db()?.execute("INSERT INTO meta(key,value) VALUES('route',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&route)?])?;
        self.recompute_all(progress)?;
        tx.commit()?;
        Ok(layout)
    }
}
