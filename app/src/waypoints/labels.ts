import type { XY } from "./geometry";
export interface ScreenPosition extends XY {
  uid: string;
  name?: string;
  angle?: number;
  vector?: XY;
}
export interface Glyph {
  uid: string;
  name: string;
  index: number;
  position: XY;
  radius: number;
  arrowEnd: XY;
  arrowWidth: number;
  headSize: number;
  cluster: number;
}
export interface Box extends XY {
  width: number;
  height: number;
}
/** Positions are in route order; vector is a screen-space unit heading, if provided. */
export function glyphs(
  positions: readonly ScreenPosition[],
  detail = 1,
): Glyph[] {
  const groups: number[][] = [];
  positions.forEach((p, i) => {
    const group = groups.find(
      (g) =>
        detail > 0 &&
        g.every(
          (j) => Math.hypot(p.x - positions[j].x, p.y - positions[j].y) <= 12,
        ),
    );
    if (group) group.push(i);
    else groups.push([i]);
  });
  const result: Glyph[] = new Array(positions.length);
  groups.forEach((group, cluster) =>
    group.forEach((index, rank) => {
      const p = positions[index],
        count = group.length,
        layer = count - rank - 1,
        radius =
          5.5 +
          detail * (1 + layer * Math.min(3.5, 10.5 / Math.max(1, count - 1))),
        length =
          18 + detail * (8 + layer * Math.min(8, 24 / Math.max(1, count - 1))),
        v = p.vector ?? {
          x: Math.cos(p.angle ?? 0),
          y: -Math.sin(p.angle ?? 0),
        };
      result[index] = {
        uid: p.uid,
        name: p.name ?? "",
        index,
        position: { x: p.x, y: p.y },
        radius,
        arrowEnd: { x: p.x + v.x * length, y: p.y + v.y * length },
        arrowWidth: 2 + detail * Math.min(1, layer * 0.2),
        headSize: 6 + detail * (1 + Math.min(1.5, layer * 0.5)),
        cluster,
      };
    }),
  );
  return result;
}
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
const pad = (a: Box, n: number): Box => ({
  x: a.x - n,
  y: a.y - n,
  width: a.width + 2 * n,
  height: a.height + 2 * n,
});
export function labelBoxes(
  items: readonly Glyph[],
  {
    textWidth,
    height: fontHeight,
    viewport,
    preferred = new Set<string>(),
  }: {
    textWidth: (text: string) => number;
    height: number;
    viewport: Box;
    preferred?: ReadonlySet<string>;
  },
): Map<string, Box> {
  const markers: Box[] = [],
    groups = new Map<number, Glyph[]>(),
    anchors = new Map<string, Box>(),
    occupied: Box[] = [],
    result = new Map<string, Box>(),
    height = Math.max(22, fontHeight + 7);
  for (const item of items) {
    const { position: p, radius: r, arrowEnd: a, headSize: h } = item;
    const group = groups.get(item.cluster) ?? [];
    group.push(item);
    groups.set(item.cluster, group);
    markers.push(
      {
        x: p.x - r - 3,
        y: p.y - r - 3,
        width: (r + 3) * 2,
        height: (r + 3) * 2,
      },
      pad(
        {
          x: Math.min(p.x, a.x),
          y: Math.min(p.y, a.y),
          width: Math.abs(a.x - p.x),
          height: Math.abs(a.y - p.y),
        },
        h,
      ),
    );
  }
  for (const group of groups.values()) {
    const x = Math.max(
        ...group.map((i) =>
          Math.max(i.position.x + i.radius + 9, i.arrowEnd.x + i.headSize + 9),
        ),
      ),
      cy = group.reduce((s, i) => s + i.position.y, 0) / group.length;
    group.forEach((item, rank) =>
      anchors.set(item.uid, {
        x,
        y: cy + (rank - (group.length - 1) / 2) * (height + 4) - height / 2,
        width: textWidth(`${item.index + 1} · ${item.name}`) + 14,
        height,
      }),
    );
  }
  for (const item of [...items].sort(
    (a, b) =>
      Number(!preferred.has(a.uid)) - Number(!preferred.has(b.uid)) ||
      a.index - b.index,
  )) {
    const anchor = anchors.get(item.uid)!;
    const box = (preferred.has(item.uid) ? [0, 20, 40, 60] : [0])
      .map((shift) => ({ ...anchor, x: anchor.x + shift }))
      .find(
        (b) =>
          ![...markers, ...occupied].some((other) =>
            intersects(pad(b, 2), other),
          ),
      );
    if (!box) continue;
    occupied.push(pad(box, 2));
    if (
      box.x >= viewport.x + 5 &&
      box.y >= viewport.y + 5 &&
      box.x + box.width <= viewport.x + viewport.width - 5 &&
      box.y + box.height <= viewport.y + viewport.height - 5
    )
      result.set(item.uid, box);
  }
  return result;
}
