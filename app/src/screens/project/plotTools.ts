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
export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
export interface Numbering {
  prefix: string;
  start: number;
  /** Where number one goes, as seen on the map (north up). */
  corner: Corner;
  /** Fill rows (left/right lines on the map) or columns first; "list" keeps
   *  the current plot order. */
  by: "rows" | "columns" | "list";
  /** Reverse direction on every other row/column (boustrophedon). */
  snake: boolean;
}
/** The field's two axes, named by how they look on a north-up map:
 *  `right` (closest to east) and `up` (closest to north). */
export function screenAxes(plots: Plot[]): { right: XY; up: XY } {
  const a = layoutAngle(plots),
    e1 = { x: Math.cos(a), y: Math.sin(a) },
    e2 = { x: -Math.sin(a), y: Math.cos(a) },
    [h, v] = Math.abs(e1.x) >= Math.abs(e2.x) ? [e1, e2] : [e2, e1];
  return {
    right: h.x < 0 ? { x: -h.x, y: -h.y } : h,
    up: v.y < 0 ? { x: -v.x, y: -v.y } : v,
  };
}
/** Labels `prefix + n` for `ids`: rows or columns of the field, starting in
 *  any corner, optionally snaking. */
export function renumberPlots(
  plots: Plot[],
  ids: ReadonlySet<number>,
  o: Numbering,
): Plot[] {
  let chosen = plots.filter((p) => ids.has(p.id));
  if (o.by !== "list") {
    const { right, up } = screenAxes(plots),
      dot = (p: XY, e: XY) => p.x * e.x + p.y * e.y,
      top = o.corner.startsWith("top"),
      left = o.corner.endsWith("Left");
    // Lines (rows or columns) are grouped along `across`; plots run along `along`.
    const [acrossAxis, alongAxis] = o.by === "rows" ? [up, right] : [right, up],
      acrossSign = o.by === "rows" ? (top ? -1 : 1) : left ? 1 : -1,
      alongSign = o.by === "rows" ? (left ? 1 : -1) : top ? -1 : 1;
    const placed = chosen.map((p) => {
      const c = p.polygon ? centroid(p.polygon) : { x: 0, y: 0 };
      return {
        p,
        across: acrossSign * dot(c, acrossAxis),
        along: alongSign * dot(c, alongAxis),
        extent: p.polygon
          ? Math.max(...p.polygon.map(([x, y]) => dot({ x, y }, acrossAxis))) -
            Math.min(...p.polygon.map(([x, y]) => dot({ x, y }, acrossAxis)))
          : 1,
      };
    });
    const extents = placed.map((q) => q.extent).sort((a, b) => a - b),
      tolerance = Math.max(0.3, (extents[extents.length >> 1] ?? 1) / 2);
    placed.sort((a, b) => a.across - b.across);
    const lines: (typeof placed)[] = [];
    for (const q of placed) {
      const line = lines[lines.length - 1],
        mean = line && line.reduce((n, r) => n + r.across, 0) / line.length;
      if (line && Math.abs(q.across - mean) <= tolerance) line.push(q);
      else lines.push([q]);
    }
    chosen = lines.flatMap((line, i) =>
      line
        .sort((a, b) =>
          o.snake && i % 2 ? b.along - a.along : a.along - b.along,
        )
        .map((q) => q.p),
    );
  }
  const label = new Map(chosen.map((p, i) => [p.id, o.prefix + (o.start + i)]));
  return plots.map((p) =>
    label.has(p.id) ? { ...p, label: label.get(p.id)! } : p,
  );
}
