import type { Plot, Waypoint, WaypointRef } from "./types";

/** Synthetic field near Ås (EPSG:32632): a rotated 6 × 6 grid of 6.25 × 8 m
 *  plots, measured by a two-way route that visits every plot twice. */
const origin: [number, number] = [599216.2, 6615256.45],
  rotation = 0.4152,
  cell: [number, number] = [6.25, 8];
export function fieldPoint(u: number, v: number): [number, number] {
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  return [origin[0] + u * c - v * s, origin[1] + u * s + v * c];
}
/** Plot id = row * 6 + col + 1, row 0 is the far (north-west) end. */
export function plotPolygon(id: number): [number, number][] {
  const row = Math.floor((id - 1) / 6),
    col = (id - 1) % 6,
    u = col * cell[0],
    v = (5 - row) * cell[1];
  return [
    fieldPoint(u, v),
    fieldPoint(u + cell[0], v),
    fieldPoint(u + cell[0], v + cell[1]),
    fieldPoint(u, v + cell[1]),
  ];
}
export function plotCentre(id: number): [number, number] {
  const row = Math.floor((id - 1) / 6),
    col = (id - 1) % 6;
  return fieldPoint((col + 0.5) * cell[0], (5 - row + 0.5) * cell[1]);
}
export function demoRoute(): Waypoint[] {
  const out: Waypoint[] = [];
  const counters = { Measure: 0, DriveThrough: 0, TurningPoint: 0, Stop: 0 },
    prefix = {
      Measure: "Plot",
      DriveThrough: "DrThr",
      TurningPoint: "TurningPoint",
      Stop: "Stop",
    };
  const add = (kind: Waypoint["kind"], u: number, v: number, up: boolean) => {
    const [x, y] = fieldPoint(u, v),
      angle = rotation + (up ? Math.PI / 2 : -Math.PI / 2);
    out.push({
      x: Math.round(x * 1e6) / 1e6,
      y: Math.round(y * 1e6) / 1e6,
      z: 0,
      angle: Math.atan2(Math.sin(angle), Math.cos(angle)),
      kind,
      side: kind === "Measure" ? "both" : "right",
      name: prefix[kind] + "_" + ++counters[kind],
    });
  };
  for (const lane of [0, 2, 4]) {
    // Lane between columns `lane` and `lane + 1`; the 0.2 m forward offset
    // of the chambers is compensated so they sit on the plot centres' rows.
    const u = (lane + 1) * cell[0];
    add("DriveThrough", u, -3, true);
    for (let r = 0; r < 6; r++) add("Measure", u, r * cell[1] + 4 - 0.2, true);
    add("TurningPoint", u, 6 * cell[1] + 2, false);
    for (let r = 5; r >= 0; r--)
      add("Measure", u + 0.15, r * cell[1] + 4 + 0.2, false);
  }
  return out;
}
/** (waypoint number, side) → plot for the demo route, as the core would store it. */
export function demoWaypointRefs(): Map<number, WaypointRef[]> {
  const refs = new Map<number, WaypointRef[]>();
  let n = 0;
  for (const lane of [0, 2, 4])
    for (const up of [true, false])
      for (let k = 0; k < 6; k++) {
        n++;
        const r = up ? k : 5 - k,
          row = 5 - r,
          // Driving up, left (heading + 90°) is the lower column; down, it swaps.
          left = row * 6 + (up ? lane : lane + 1) + 1,
          right = row * 6 + (up ? lane + 1 : lane) + 1;
        for (const [plot, side] of [
          [left, "left"],
          [right, "right"],
        ] as const)
          refs.set(plot, [...(refs.get(plot) ?? []), { waypoint: n, side }]);
      }
  return refs;
}
export function demoPlotGeometry(plots: Plot[]): Plot[] {
  const refs = demoWaypointRefs();
  return plots.map((p) => ({
    ...p,
    polygon: plotPolygon(p.id),
    waypoints: refs.get(p.id) ?? [],
  }));
}
