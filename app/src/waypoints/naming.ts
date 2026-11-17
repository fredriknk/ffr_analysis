import type { WaypointKind } from "../api/types";
import { PREFIXES, type EditorPoint } from "./types";
export function numbered(
  name: string,
): { prefix: string; number: number } | null {
  const m = /^(.+)_([0-9]+)$/.exec(name);
  return m && m[0] === name ? { prefix: m[1], number: Number(m[2]) } : null;
}
export function familyStyle(
  points: readonly EditorPoint[],
  kind: WaypointKind,
): string {
  for (const p of points) {
    const n = numbered(p.name);
    if (p.kind === kind && n) return n.prefix;
  }
  return PREFIXES[kind];
}
function tail(
  points: readonly EditorPoint[],
  kind: WaypointKind,
  index: number,
  number: number,
  prefix: string,
): EditorPoint[] {
  return points.map((p, i) =>
    i >= index && p.kind === kind ? { ...p, name: `${prefix}_${number++}` } : p,
  );
}
export function insertPoint(
  points: readonly EditorPoint[],
  index: number,
  point: EditorPoint,
): EditorPoint[] {
  if (!Number.isInteger(index) || index < 0 || index > points.length)
    throw new Error("Insertion position is outside the route.");
  const prefix = familyStyle(points, point.kind);
  const previous = points
    .slice(0, index)
    .reverse()
    .find((p) => p.kind === point.kind && numbered(p.name));
  const following = points
    .slice(index)
    .find((p) => p.kind === point.kind && numbered(p.name));
  const number = previous
    ? numbered(previous.name)!.number + 1
    : following
      ? numbered(following.name)!.number
      : 1;
  return tail(
    [...points.slice(0, index), { ...point }, ...points.slice(index)],
    point.kind,
    index,
    number,
    prefix,
  );
}
export function deletePoints(
  points: readonly EditorPoint[],
  uids: Iterable<string>,
): EditorPoint[] {
  const ids = new Set(uids);
  let result = [...points];
  // Match the reference screen's repeated deletion from the end of the route.
  for (const p of [...points].reverse())
    if (ids.has(p.uid)) {
      const index = result.findIndex((q) => q.uid === p.uid);
      const removed = result[index];
      result = result.filter((q) => q.uid !== p.uid);
      const n = numbered(removed.name);
      if (n) result = tail(result, removed.kind, index, n.number, n.prefix);
    }
  return result;
}
export function changeType(
  points: readonly EditorPoint[],
  uid: string,
  kind: WaypointKind,
): EditorPoint[] {
  const index = points.findIndex((p) => p.uid === uid);
  if (index < 0 || points[index].kind === kind) return [...points];
  return insertPoint(deletePoints(points, [uid]), index, {
    ...points[index],
    kind,
  });
}
