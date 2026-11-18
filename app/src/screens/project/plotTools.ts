import type { Plot, Waypoint } from "../../api/types";
import { fieldAngle, type XY } from "../../waypoints/geometry";

export type Shape = "auto" | "square" | "rectangle" | "maximize";
export interface PlotShape {
  shape: Shape;
  size: number;
  width: number;
  height: number;
  /** Radians. For Maximize this is the travel axis; otherwise the first edge. */
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

/** Treat driving in opposite directions as the same axis. */
export function routeTravelAngle(points: readonly Waypoint[]): number | null {
  let x = 0,
    y = 0,
    count = 0;
  for (const p of points) {
    if (p.kind !== "Measure" || p.side === "none") continue;
    x += Math.cos(2 * p.angle);
    y += Math.sin(2 * p.angle);
    count++;
  }
  return Math.hypot(x, y) > 1e-6 * count ? Math.atan2(y, x) / 2 : null;
}

const DISTANCE_EPSILON = 1e-6;
type Point = [number, number];

/** Distance from the plot centre to a polygon within its fixed-width strip. */
function stripLimit(
  centre: Point,
  halfWidth: number,
  polygon: Point[],
): number {
  const low = centre[1] - halfWidth,
    high = centre[1] + halfWidth;
  const across = polygon.map((p) => p[1]);
  if (
    Math.max(...across) <= low + DISTANCE_EPSILON ||
    Math.min(...across) >= high - DISTANCE_EPSILON
  )
    return Infinity;

  // The first contact is either inside the polygon already, or on an edge
  // clipped to the width strip. Check each edge even for non-convex plots.
  let inside = false,
    limit = Infinity;
  polygon.forEach(([x, y], i) => {
    const [nextX, nextY] = polygon[(i + 1) % polygon.length];
    const atY = (edge: number) => x + ((edge - y) / (nextY - y)) * (nextX - x);
    if (y > centre[1] !== nextY > centre[1] && atY(centre[1]) > centre[0])
      inside = !inside;
    const along = [];
    if (y >= low && y <= high) along.push(x);
    if (nextY >= low && nextY <= high) along.push(nextX);
    for (const edge of [low, high]) {
      if ((y < edge && nextY > edge) || (nextY < edge && y > edge))
        along.push(atY(edge));
    }
    if (along.length)
      limit = Math.min(
        limit,
        Math.max(
          0,
          Math.min(...along) - centre[0],
          centre[0] - Math.max(...along),
        ),
      );
  });
  return inside ? 0 : limit;
}

/** Grow centred rectangles along a common travel axis at their existing widths. */
function maximizePlots(plots: Plot[], ids: ReadonlySet<number>, angle: number) {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const projected = positioned(plots).map((plot) => {
    const { x, y } = centroid(plot.polygon);
    return {
      plot,
      centre: [x * cos + y * sin, -x * sin + y * cos] as Point,
      width: plotSize(plot.polygon)[0] / 2,
      polygon: plot.polygon.map(
        ([x, y]): Point => [x * cos + y * sin, -x * sin + y * cos],
      ),
      halfLength: 0,
    };
  });
  let candidates = projected.filter(
    (p) => ids.has(p.plot.id) && p.width > DISTANCE_EPSILON,
  );
  const fixed = projected.filter((p) => !candidates.includes(p));
  type Footprint = (typeof projected)[number];
  const neighbours = (a: Footprint, b: Footprint) =>
    a !== b &&
    Math.abs(a.centre[1] - b.centre[1]) < a.width + b.width - DISTANCE_EPSILON;
  const separation = (a: Footprint, b: Footprint) =>
    Math.abs(a.centre[0] - b.centre[0]);
  const fixedLimit = (p: Footprint) =>
    Math.min(...fixed.map((q) => stripLimit(p.centre, p.width, q.polygon)));
  const midpointLimit = (p: Footprint) =>
    Math.min(
      ...candidates
        .filter((q) => neighbours(p, q))
        .map((q) => separation(p, q) / 2),
    );

  // Keep footprints intact where the strip is blocked at its centre or there
  // is no neighbour to bound the length. They still constrain other plots.
  while (candidates.length) {
    const blocked = candidates.filter((p) => {
      p.halfLength = Math.min(fixedLimit(p), midpointLimit(p));
      return p.halfLength <= DISTANCE_EPSILON || !Number.isFinite(p.halfLength);
    });
    if (!blocked.length) break;
    fixed.push(...blocked);
    candidates = candidates.filter((p) => !blocked.includes(p));
  }

  // Start at the shared midpoints. If a neighbour was capped sooner, take up
  // the remaining room without moving that neighbour or either plot centre.
  for (const p of candidates)
    p.halfLength = Math.min(
      fixedLimit(p),
      ...candidates
        .filter((q) => neighbours(p, q))
        .map((q) => separation(p, q) - q.halfLength),
    );

  const resized = new Map(
    candidates.map(({ plot, centre: [u, v], width: w, halfLength: h }) => [
      plot.id,
      (
        [
          [u - h, v + w],
          [u - h, v - w],
          [u + h, v - w],
          [u + h, v + w],
        ] as Point[]
      ).map(([a, b]): Point => [a * cos - b * sin, a * sin + b * cos]),
    ]),
  );
  return plots.map((p) => {
    const polygon = resized.get(p.id);
    return polygon ? { ...p, polygon } : p;
  });
}

/** New footprints around the current centres of `ids`. */
export function reshapePlots(
  plots: Plot[],
  ids: ReadonlySet<number>,
  o: PlotShape,
  travelAngle: number | null = null,
): Plot[] {
  if (o.shape === "maximize")
    return maximizePlots(
      plots,
      ids,
      o.angle ?? travelAngle ?? layoutAngle(plots) + Math.PI / 2,
    );
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
