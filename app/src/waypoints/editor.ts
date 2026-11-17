import type { Waypoint, WaypointKind, WaypointSide } from "../api/types";
import {
  autorotate,
  centre,
  rotateHeadings,
  transform,
  type TransformOptions,
  type Uids,
  type XY,
} from "./geometry";
import { changeType, deletePoints, insertPoint } from "./naming";
import { withUids, type EditorPoint } from "./types";
export interface Entry {
  label: string;
  before: EditorPoint[];
  after: EditorPoint[];
}
export interface EditorDoc {
  points: EditorPoint[];
  undo: Entry[];
  redo: Entry[];
  savedSignature: string;
}
const copy = (points: readonly EditorPoint[]): EditorPoint[] =>
  points.map((p) => ({
    ...p,
    original: p.original ? [...p.original] : p.original,
  }));
export function signature(points: readonly Waypoint[]): string {
  return JSON.stringify(
    points.map((p) => [p.x, p.y, p.z, p.angle, p.kind, p.side, p.name]),
  );
}
export function createDoc(points: readonly Waypoint[]): EditorDoc {
  const ps = withUids(points);
  return {
    points: copy(ps),
    undo: [],
    redo: [],
    savedSignature: signature(ps),
  };
}
export function commit(
  doc: EditorDoc,
  label: string,
  nextPoints: readonly EditorPoint[],
): EditorDoc {
  if (JSON.stringify(doc.points) === JSON.stringify(nextPoints)) return doc;
  const after = copy(nextPoints);
  return {
    ...doc,
    points: after,
    undo: [
      ...doc.undo,
      { label, before: copy(doc.points), after: copy(after) },
    ].slice(-100),
    redo: [],
  };
}
export function undoDoc(doc: EditorDoc): EditorDoc {
  const entry = doc.undo.at(-1);
  return entry
    ? {
        ...doc,
        points: copy(entry.before),
        undo: doc.undo.slice(0, -1),
        redo: [...doc.redo, entry],
      }
    : doc;
}
export function redoDoc(doc: EditorDoc): EditorDoc {
  const entry = doc.redo.at(-1);
  return entry
    ? {
        ...doc,
        points: copy(entry.after),
        undo: [...doc.undo, entry],
        redo: doc.redo.slice(0, -1),
      }
    : doc;
}
export function isDirty(doc: EditorDoc): boolean {
  return signature(doc.points) !== doc.savedSignature;
}
export function markSaved(doc: EditorDoc): EditorDoc {
  return { ...doc, savedSignature: signature(doc.points) };
}
export function movePoints(
  points: readonly EditorPoint[],
  uids: Uids,
  dx: number,
  dy: number,
  opts: Omit<TransformOptions, "dx" | "dy"> & { autorotate?: boolean } = {},
): EditorPoint[] {
  const ids = [...uids],
    next = transform(points, ids, { ...opts, dx, dy });
  return opts.autorotate ? autorotate(next, ids) : next;
}
export function rotateGroup(
  points: readonly EditorPoint[],
  uids: Uids,
  angle: number,
  opts: {
    pivot?: XY;
    positionsToo?: boolean;
    baseline?: readonly EditorPoint[];
    autorotate?: boolean;
  } = {},
): EditorPoint[] {
  const ids = [...uids],
    next =
      opts.positionsToo === false
        ? rotateHeadings(points, ids, angle, opts.baseline)
        : transform(points, ids, {
            angle,
            pivot: opts.pivot,
            baseline: opts.baseline,
          });
  return opts.autorotate ? autorotate(next, ids) : next;
}
/** Absolute heading in radians. */
export function setHeading(
  points: readonly EditorPoint[],
  uids: Uids,
  angle: number,
): EditorPoint[] {
  if (!Number.isFinite(angle)) throw new Error("Heading must be finite.");
  const ids = new Set(uids);
  return points.map((p) => (ids.has(p.uid) ? { ...p, angle } : p));
}
export interface FieldChanges {
  x?: number;
  y?: number;
  z?: number;
  angleDeg?: number;
  kind?: WaypointKind;
  side?: WaypointSide;
}
export function setFields(
  points: readonly EditorPoint[],
  uid: string,
  fields: FieldChanges,
): EditorPoint[] {
  for (const v of [fields.x, fields.y, fields.z, fields.angleDeg])
    if (v !== undefined && !Number.isFinite(v))
      throw new Error("Coordinates and heading must be finite numbers.");
  const next = fields.kind ? changeType(points, uid, fields.kind) : [...points];
  return next.map((p) => {
    if (p.uid !== uid) return p;
    return {
      ...p,
      ...(fields.x === undefined ? {} : { x: fields.x }),
      ...(fields.y === undefined ? {} : { y: fields.y }),
      ...(fields.z === undefined ? {} : { z: fields.z }),
      ...(fields.side === undefined ? {} : { side: fields.side }),
      ...(fields.angleDeg === undefined
        ? {}
        : { angle: (fields.angleDeg * Math.PI) / 180 }),
    };
  });
}
export function insertionIndex(
  points: readonly EditorPoint[],
  position: "end" | "before" | "after",
  anchorUid?: string,
): number {
  if (position === "end") return points.length;
  const index = points.findIndex((p) => p.uid === anchorUid);
  if (index < 0) throw new Error("Select an anchor waypoint.");
  return index + (position === "after" ? 1 : 0);
}
export interface AddOptions {
  kind: WaypointKind;
  side: WaypointSide;
  x: number;
  y: number;
  z?: number;
  position: "end" | "before" | "after";
  anchorUid?: string;
  pair?: boolean;
}
export function addPoint(
  points: readonly EditorPoint[],
  opts: AddOptions,
): { points: EditorPoint[]; createdUids: string[] } {
  return addWithHeading(points, opts);
}
function addWithHeading(
  points: readonly EditorPoint[],
  opts: AddOptions,
  fallbackHeading?: number,
): { points: EditorPoint[]; createdUids: string[] } {
  const anchor = points.find((p) => p.uid === opts.anchorUid),
    index = insertionIndex(points, opts.position, opts.anchorUid),
    kinds: WaypointKind[] = opts.pair
      ? ["DriveThrough", "TurningPoint"]
      : [opts.kind];
  let next = [...points];
  const createdUids: string[] = [];
  kinds.forEach((kind, i) => {
    const p = withUids([
      {
        x: opts.x,
        y: opts.y,
        z: opts.z ?? anchor?.z ?? 0,
        angle: fallbackHeading ?? anchor?.angle ?? 0,
        kind,
        side: opts.side,
        name: "New",
      },
    ])[0];
    if (![p.x, p.y, p.z].every(Number.isFinite))
      throw new Error("Coordinates must be finite numbers.");
    createdUids.push(p.uid);
    next = insertPoint(next, index + i, p);
  });
  return { points: autorotate(next, createdUids, true), createdUids };
}
export function insertMidpoint(
  points: readonly EditorPoint[],
  opts: Omit<AddOptions, "x" | "y" | "z" | "position"> & {
    anchorUid: string;
    position: "before" | "after";
  },
): { points: EditorPoint[]; createdUids: string[] } {
  const index = points.findIndex((p) => p.uid === opts.anchorUid);
  if (index < 0) throw new Error("Select an anchor waypoint.");
  const p = points[index],
    q = points[index + (opts.position === "before" ? -1 : 1)];
  if (!q) throw new Error("No adjacent route segment.");
  const xy = centre([p, q]);
  const heading =
    p.angle +
    Math.atan2(Math.sin(q.angle - p.angle), Math.cos(q.angle - p.angle)) / 2;
  return addWithHeading(
    points,
    { ...opts, ...xy, z: (p.z + q.z) / 2 },
    heading,
  );
}
export const deleteSelected = deletePoints;
export const alignHeadings = autorotate;
export function selectRange(
  points: readonly EditorPoint[],
  fromUid: string,
  toUid: string,
): string[] {
  const a = points.findIndex((p) => p.uid === fromUid),
    b = points.findIndex((p) => p.uid === toUid);
  return a < 0 || b < 0
    ? []
    : points.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.uid);
}
