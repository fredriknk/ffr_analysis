import type { Waypoint, WaypointKind, WaypointSide } from "../api/types";
export type EditorPoint = Waypoint & { uid: string };
export const TYPES: readonly WaypointKind[] = [
  "Measure",
  "DriveThrough",
  "TurningPoint",
  "Stop",
];
export const SIDES: readonly WaypointSide[] = ["both", "left", "right", "none"];
export const PREFIXES: Record<WaypointKind, string> = {
  Measure: "Plot",
  DriveThrough: "DrThr",
  TurningPoint: "TurningPoint",
  Stop: "Stop",
};
export const AHEAD = 0.2;
export const SIDE_OFFSET = 2;
export function withUids(points: readonly Waypoint[]): EditorPoint[] {
  return points.map((p) => ({ ...p, uid: crypto.randomUUID() }));
}
export function stripUids(points: readonly EditorPoint[]): Waypoint[] {
  return points.map(({ x, y, z, angle, kind, side, name, original }) => ({
    x,
    y,
    z,
    angle,
    kind,
    side,
    name,
    original,
  }));
}
