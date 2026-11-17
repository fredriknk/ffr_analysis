import { fieldAngle } from "../waypoints/geometry";
import type {
  PlotGenOptions,
  PlotProposal,
  Waypoint,
  WaypointVisit,
} from "./types";

/** Browser stand-in for the core's `waypoints::generate` (same rules). */
const SIDEWAYS = 2,
  FORWARD = 0.2;
export function waypointNumber(name: string): number | null {
  const runs = name.match(/[0-9]+/g);
  return runs ? Number(runs[runs.length - 1]) : null;
}
export function routeChambers(points: Waypoint[]): WaypointVisit[] {
  const out: WaypointVisit[] = [];
  points.forEach((p, i) => {
    if (p.kind !== "Measure") return;
    for (const [side, sign] of [
      ["left", 1],
      ["right", -1],
    ] as const) {
      if (p.side !== "both" && p.side !== side) continue;
      const a = p.angle + (sign * Math.PI) / 2;
      out.push({
        waypointIndex: i,
        name: p.name,
        waypoint: waypointNumber(p.name),
        side,
        x: p.x + SIDEWAYS * Math.cos(a) + FORWARD * Math.cos(p.angle),
        y: p.y + SIDEWAYS * Math.sin(a) + FORWARD * Math.sin(p.angle),
      });
    }
  });
  return out;
}
export function mockWaypointPlots(
  points: Waypoint[],
  o: PlotGenOptions,
): PlotProposal {
  if (
    ![o.clusterDistance, o.size, o.width, o.height].every(
      (v) => Number.isFinite(v) && v > 0,
    ) ||
    (o.angle !== null && !Number.isFinite(o.angle))
  )
    throw {
      code: "PLOTS",
      message: "Plot distances and sizes must be positive finite numbers.",
    };
  const clusters: WaypointVisit[][] = [];
  for (const v of routeChambers(points)) {
    const c = clusters.find((c) =>
      c.every((p) => Math.hypot(p.x - v.x, p.y - v.y) <= o.clusterDistance),
    );
    if (c) c.push(v);
    else clusters.push([v]);
  }
  const centres = clusters.map((c) => ({
    x: c.reduce((a, v) => a + v.x, 0) / c.length,
    y: c.reduce((a, v) => a + v.y, 0) / c.length,
  }));
  const angle = o.angle ?? fieldAngle(centres),
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  return {
    angle,
    plots: clusters.map((visits, i) => {
      const { x, y } = centres[i];
      const others = centres
        .filter((_, j) => j !== i)
        .map((p) => Math.hypot(p.x - x, p.y - y) / 2);
      const auto = others.length ? Math.min(...others) : 1;
      const [w, h] =
        o.shape === "square"
          ? [o.size / 2, o.size / 2]
          : o.shape === "rectangle"
            ? [o.width / 2, o.height / 2]
            : [auto, auto];
      return {
        key: i + 1,
        label: o.labelPrefix + (i + 1),
        x,
        y,
        polygon: (
          [
            [-w, -h],
            [w, -h],
            [w, h],
            [-w, h],
          ] as const
        ).map(([u, v]) => [x + u * cos - v * sin, y + u * sin + v * cos]),
        visits,
      };
    }),
  };
}
