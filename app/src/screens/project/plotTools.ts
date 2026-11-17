import type { Plot } from "../../api/types";
import { fieldAngle, type XY } from "../../waypoints/geometry";

export type Shape = "auto" | "square" | "rectangle";
export interface PlotShape {
  shape: Shape;
  size: number;
  width: number;
  height: number;
  /** Radians; null = the field direction found from the plot centres. */
  angle: number | null;
}

export function centroid(polygon: [number, number][]): XY {
  return {
    x: polygon.reduce((a, p) => a + p[0], 0) / polygon.length,
    y: polygon.reduce((a, p) => a + p[1], 0) / polygon.length,
  };
}
export function positioned(plots: Plot[]) {
  return plots.filter(
    (p): p is Plot & { polygon: [number, number][] } =>
      !!p.polygon && p.polygon.length >= 3,
  );
}
/** Direction of a plot's first edge: the "width" side of generated plots. */
export function plotAngle(polygon: [number, number][]): number {
  const [a, b] = polygon;
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}
/** The field direction: the plots' common first-edge direction (mean over
 *  half-turns), or the minimum-area rectangle of centres for degenerate plots. */
export function layoutAngle(plots: Plot[]): number {
  const placed = positioned(plots);
  if (!placed.length) return 0;
  let c = 0,
    s = 0;
  for (const p of placed) {
    const a = 2 * plotAngle(p.polygon);
    c += Math.cos(a);
    s += Math.sin(a);
  }
  return Math.hypot(c, s) > 1e-6 * placed.length
    ? Math.atan2(s, c) / 2
    : fieldAngle(placed.map((p) => centroid(p.polygon)));
}
/** Current width (first edge) × length (second edge) of a plot, metres. */
export function plotSize(polygon: [number, number][]): [number, number] {
  const [a, b, c] = polygon;
  return [
    Math.hypot(b[0] - a[0], b[1] - a[1]),
    Math.hypot(c[0] - b[0], c[1] - b[1]),
  ];
}
/** New footprints around the current centres of `ids`. Width runs along each
 *  plot's own first edge (or `angle` when given), length across it, as in the
 *  route plot generator. */
export function reshapePlots(
  plots: Plot[],
  ids: ReadonlySet<number>,
  o: PlotShape,
): Plot[] {
  const placed = positioned(plots),
    centres = new Map(placed.map((p) => [p.id, centroid(p.polygon)]));
  return plots.map((p) => {
    const c = centres.get(p.id);
    if (!c || !p.polygon || !ids.has(p.id)) return p;
    const angle = o.angle ?? plotAngle(p.polygon),
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    const others = [...centres]
      .filter(([id]) => id !== p.id)
      .map(([, q]) => Math.hypot(q.x - c.x, q.y - c.y) / 2)
      .filter((d) => d > 1e-6);
    const auto = others.length ? Math.min(...others) : 1;
    const [w, h] =
      o.shape === "square"
        ? [o.size / 2, o.size / 2]
        : o.shape === "rectangle"
          ? [o.width / 2, o.height / 2]
          : [auto, auto];
    return {
      ...p,
      polygon: (
        [
          [-w, -h],
          [w, -h],
          [w, h],
          [-w, h],
        ] as const
      ).map(([u, v]) => [c.x + u * cos - v * sin, c.y + u * sin + v * cos]),
    };
  });
}
/** Labels `prefix + n` for `ids`, ordered along or across the field rows. */
export function renumberPlots(
  plots: Plot[],
  ids: ReadonlySet<number>,
  prefix: string,
  start: number,
  order: "list" | "along" | "across",
): Plot[] {
  const chosen = plots.filter((p) => ids.has(p.id));
  if (order !== "list") {
    const angle = layoutAngle(plots),
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      key = new Map(
        chosen.map((p) => {
          const c = p.polygon ? centroid(p.polygon) : { x: 0, y: 0 };
          return [
            p.id,
            { u: c.x * cos + c.y * sin, v: -c.x * sin + c.y * cos },
          ];
        }),
      );
    // Rows: plots whose cross coordinate is within half a plot of each other.
    const span = (p: Plot) => {
        if (!p.polygon) return 1;
        const us = p.polygon.map(([x, y]) => x * cos + y * sin),
          vs = p.polygon.map(([x, y]) => -x * sin + y * cos);
        return order === "along"
          ? Math.max(...vs) - Math.min(...vs)
          : Math.max(...us) - Math.min(...us);
      },
      tolerance = Math.max(0.5, Math.min(...chosen.map(span)) / 2);
    const row = (id: number) =>
        order === "along" ? key.get(id)!.v : key.get(id)!.u,
      along = (id: number) =>
        order === "along" ? key.get(id)!.u : -key.get(id)!.v;
    chosen.sort((a, b) =>
      Math.abs(row(a.id) - row(b.id)) > tolerance
        ? row(b.id) - row(a.id)
        : along(a.id) - along(b.id),
    );
  }
  const label = new Map(chosen.map((p, i) => [p.id, prefix + (start + i)]));
  return plots.map((p) =>
    label.has(p.id) ? { ...p, label: label.get(p.id)! } : p,
  );
}
