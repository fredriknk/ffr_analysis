import { AHEAD, SIDE_OFFSET, type EditorPoint } from "./types";
export interface XY {
  x: number;
  y: number;
}
export type Uids = Iterable<string>;
export interface Chamber extends XY {
  uid: string;
  side: "left" | "right";
}
const EPSILON = 1e-7;
const gap = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export function chambers(points: readonly EditorPoint[]): Chamber[] {
  return points.flatMap((p) =>
    p.kind !== "Measure"
      ? []
      : (["left", "right"] as const)
          .filter((side) => p.side === side || p.side === "both")
          .map((side) => {
            const sign = side === "left" ? -1 : 1;
            return {
              uid: p.uid,
              side,
              x:
                p.x +
                AHEAD * Math.cos(p.angle) +
                sign * SIDE_OFFSET * Math.sin(p.angle),
              y:
                p.y +
                AHEAD * Math.sin(p.angle) -
                sign * SIDE_OFFSET * Math.cos(p.angle),
            };
          }),
  );
}
export function centre(points: readonly XY[]): XY {
  if (!points.length) throw new Error("Select at least one waypoint.");
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}
export interface TransformOptions {
  dx?: number;
  dy?: number;
  angle?: number;
  pivot?: XY;
  baseline?: readonly EditorPoint[];
}
export function transform(
  points: readonly EditorPoint[],
  uids: Uids,
  {
    dx = 0,
    dy = 0,
    angle = 0,
    pivot,
    baseline = points,
  }: TransformOptions = {},
): EditorPoint[] {
  const ids = new Set(uids),
    selected = baseline.filter((p) => ids.has(p.uid));
  if (!selected.length) return [...points];
  const originals = new Map(selected.map((p) => [p.uid, p]));
  const c = Math.cos(angle),
    s = Math.sin(angle),
    o = pivot ?? centre(selected);
  return points.map((p) => {
    const b = originals.get(p.uid);
    return b
      ? {
          ...p,
          x:
            angle === 0
              ? b.x + dx
              : o.x + (b.x - o.x) * c - (b.y - o.y) * s + dx,
          y:
            angle === 0
              ? b.y + dy
              : o.y + (b.x - o.x) * s + (b.y - o.y) * c + dy,
          angle: b.angle + angle,
        }
      : p;
  });
}
export function rotateHeadings(
  points: readonly EditorPoint[],
  uids: Uids,
  angle: number,
  baseline: readonly EditorPoint[] = points,
): EditorPoint[] {
  const ids = new Set(uids),
    originals = new Map(baseline.map((p) => [p.uid, p]));
  return points.map((p) =>
    ids.has(p.uid) && originals.has(p.uid)
      ? { ...p, angle: originals.get(p.uid)!.angle + angle }
      : p,
  );
}
export function headingTo(
  points: readonly EditorPoint[],
  index: number,
): number {
  const p = points[index];
  if (!p) throw new Error("Waypoint is outside the route.");
  const before = Array.from({ length: index }, (_, i) => index - i - 1),
    after = Array.from(
      { length: points.length - index - 1 },
      (_, i) => index + i + 1,
    );
  const incoming = p.kind === "DriveThrough" || p.kind === "Stop";
  for (const j of incoming ? [...before, ...after] : [...after, ...before]) {
    const q = points[j];
    if (gap(p, q) > EPSILON)
      return j < index
        ? Math.atan2(p.y - q.y, p.x - q.x)
        : Math.atan2(q.y - p.y, q.x - p.x);
  }
  return p.angle;
}
export function autorotate(
  points: readonly EditorPoint[],
  uids: Uids,
  includeStops = false,
): EditorPoint[] {
  const ids = new Set(uids);
  return points.map((p, i) => {
    if (!ids.has(p.uid) || (p.kind === "Stop" && !includeStops)) return p;
    const angle = headingTo(points, i);
    return Math.abs(wrap(angle - p.angle)) > 1e-12 ? { ...p, angle } : p;
  });
}
function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be positive.`);
}
export function snapPositions(
  points: readonly EditorPoint[],
  uids: Uids,
  distance: number | null = null,
): EditorPoint[] {
  const ids = new Set(uids),
    selected = points.filter((p) => ids.has(p.uid));
  if (selected.length < 2) return [...points];
  if (distance !== null) positive(distance, "Snap distance");
  const remaining = new Set(selected),
    targets = new Map<string, XY>();
  while (remaining.size) {
    const first = remaining.values().next().value!;
    remaining.delete(first);
    const group = [first];
    for (const p of remaining)
      if (distance === null || group.every((q) => gap(p, q) <= distance)) {
        group.push(p);
        remaining.delete(p);
      }
    if (group.length > 1) {
      const c = centre(group);
      for (const p of group) targets.set(p.uid, c);
    }
  }
  return points.map((p) =>
    targets.has(p.uid) ? { ...p, ...targets.get(p.uid)! } : p,
  );
}
export interface ChamberMatch {
  a: Chamber;
  b: Chamber;
  target: XY;
}
export function snapChambers(
  points: readonly EditorPoint[],
  uids: Uids,
  distance: number,
  mode: "closest" | "left" | "right" | "opposite" = "closest",
): { points: EditorPoint[]; matched: ChamberMatch[] } {
  positive(distance, "Snap distance");
  if (!["closest", "left", "right", "opposite"].includes(mode))
    throw new Error("Unknown chamber pairing mode.");
  const ids = new Set(uids),
    candidates = chambers(points.filter((p) => ids.has(p.uid))).filter(
      (c) => (mode !== "left" && mode !== "right") || c.side === mode,
    );
  const pairs: { gap: number; index: number; a: Chamber; b: Chamber }[] = [];
  candidates.forEach((a, index) => {
    for (const b of candidates.slice(index + 1))
      if (
        a.uid !== b.uid &&
        (mode !== "opposite" || a.side !== b.side) &&
        gap(a, b) <= distance
      )
        pairs.push({ gap: gap(a, b), index, a, b });
  });
  pairs.sort((a, b) => a.gap - b.gap || a.index - b.index);
  const byId = new Map(points.map((p) => [p.uid, p])),
    used = new Set<string>(),
    matched: ChamberMatch[] = [];
  for (const { a, b } of pairs) {
    if (used.has(a.uid) || used.has(b.uid)) continue;
    const first = byId.get(a.uid)!,
      second = byId.get(b.uid)!,
      opposite = a.side !== b.side;
    const mean =
      first.angle +
      wrap(second.angle + (opposite ? Math.PI : 0) - first.angle) / 2;
    const both = first.side === "both" && second.side === "both";
    const mid = both
      ? centre(
          [first, second].map((p) => ({
            x: p.x + AHEAD * Math.cos(p.angle),
            y: p.y + AHEAD * Math.sin(p.angle),
          })),
        )
      : centre([a, b]);
    for (const [p, ch, angle] of [
      [first, a, mean],
      [second, b, mean - (opposite ? Math.PI : 0)],
    ] as const) {
      const heading = wrap(angle),
        sign = ch.side === "left" ? -1 : 1;
      byId.set(p.uid, {
        ...p,
        angle: heading,
        x:
          mid.x -
          AHEAD * Math.cos(heading) -
          (both ? 0 : sign * SIDE_OFFSET * Math.sin(heading)),
        y:
          mid.y -
          AHEAD * Math.sin(heading) +
          (both ? 0 : sign * SIDE_OFFSET * Math.cos(heading)),
      });
    }
    const sign = a.side === "left" ? -1 : 1;
    const target = both
      ? {
          x: mid.x + sign * SIDE_OFFSET * Math.sin(mean),
          y: mid.y - sign * SIDE_OFFSET * Math.cos(mean),
        }
      : mid;
    used.add(a.uid);
    used.add(b.uid);
    matched.push({ a, b, target });
  }
  return { points: points.map((p) => byId.get(p.uid)!), matched };
}
export function fieldAngle(coords: readonly XY[]): number {
  const vertices = [
    ...new Map(coords.map((p) => [`${p.x},${p.y}`, p])).values(),
  ].sort((a, b) => a.x - b.x || a.y - b.y);
  if (vertices.length < 2) return 0;
  const cross = (a: XY, b: XY, c: XY) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (ps: XY[]) => {
    const h: XY[] = [];
    for (const p of ps) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0)
        h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  const hull = [...half(vertices), ...half([...vertices].reverse())],
    origin = vertices[0];
  let best = Infinity,
    result = 0;
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length],
      angle = Math.atan2(b.y - a.y, b.x - a.x),
      c = Math.cos(angle),
      s = Math.sin(angle),
      xs = hull.map((p) => (p.x - origin.x) * c + (p.y - origin.y) * s),
      ys = hull.map((p) => -(p.x - origin.x) * s + (p.y - origin.y) * c),
      area =
        (Math.max(...xs) - Math.min(...xs)) *
        (Math.max(...ys) - Math.min(...ys));
    if (area < best) {
      best = area;
      result = angle;
    }
  });
  return result;
}
export function footprints(
  points: readonly EditorPoint[],
  {
    square,
    rectangle,
  }: { square?: number; rectangle?: readonly [number, number] } = {},
): { chamber: Chamber; corners: XY[] }[] {
  if (square !== undefined) positive(square, "Square size");
  if (rectangle) {
    if (square !== undefined)
      throw new Error("Choose either a fixed square or a fixed rectangle.");
    rectangle.forEach((v) => positive(v, "Rectangle dimensions"));
  }
  const items = chambers(points),
    angle = fieldAngle(items),
    c = Math.cos(angle),
    s = Math.sin(angle);
  return items.map((chamber) => {
    const ds = items.map((q) => gap(chamber, q)).filter((d) => d > EPSILON),
      size = square ?? (ds.length ? Math.min(...ds) : 2),
      [w, h] = rectangle ?? [size, size];
    return {
      chamber,
      corners: [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ].map(([x, y]) => ({
        x: chamber.x + x * c - y * s,
        y: chamber.y + x * s + y * c,
      })),
    };
  });
}
export function segmentDistance(position: XY, start: XY, end: XY): number {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    sq = dx * dx + dy * dy,
    t = sq
      ? Math.max(
          0,
          Math.min(
            1,
            ((position.x - start.x) * dx + (position.y - start.y) * dy) / sq,
          ),
        )
      : 0;
  return gap(position, { x: start.x + t * dx, y: start.y + t * dy });
}
