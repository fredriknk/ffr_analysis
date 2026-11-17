import { expect, it } from "vitest";
import {
  autorotate,
  centre,
  chambers,
  fieldAngle,
  footprints,
  headingTo,
  rotateHeadings,
  segmentDistance,
  snapChambers,
  snapPositions,
  transform,
} from "./geometry";
import type { EditorPoint } from "./types";
const p = (
  uid: string,
  x = 0,
  y = 0,
  kind: EditorPoint["kind"] = "Measure",
  side: EditorPoint["side"] = "both",
  angle = 0,
): EditorPoint => ({ uid, x, y, kind, side, angle, z: 7, name: uid });
const ids = (ps: EditorPoint[]) => ps.map((p) => p.uid);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
it("chamber signs agree with Rust: left is heading +90 degrees", () => {
  expect(chambers([p("a")])).toEqual([
    { uid: "a", side: "left", x: 0.2, y: 2 },
    { uid: "a", side: "right", x: 0.2, y: -2 },
  ]);
  expect(
    chambers([p("a", 0, 0, "Measure", "left", Math.PI / 2)])[0].x,
  ).toBeCloseTo(-2);
});
it("rigid transforms use a stable baseline and preserve unselected points", () => {
  const ps = [
      p("a", 10, 20, "Measure", "both", 0.4),
      p("b", 14, 26),
      p("c", 100, 100),
    ],
    next = transform(ps, ["a", "b"], { angle: Math.PI / 2 });
  expect(centre(next.slice(0, 2))).toEqual(centre(ps.slice(0, 2)));
  expect(next[0].x).toBeCloseTo(15);
  expect(next[0].y).toBeCloseTo(21);
  expect(next[0].angle).toBeCloseTo(0.4 + Math.PI / 2);
  expect(next[2]).toBe(ps[2]);
  expect(
    transform(next, ["a", "b"], { dx: 5, dy: -2, baseline: ps })[0],
  ).toMatchObject({ x: 15, y: 18, angle: 0.4 });
  expect(rotateHeadings(next, ["a"], 1, ps)[0].angle).toBeCloseTo(1.4);
  expect(ps[0].x).toBe(10);
  expect(() => centre([])).toThrow();
});
it("autorotation applies incoming/outgoing rules and preserves manual stops", () => {
  const ps = [
    p("a", 0, 0, "Stop", "both", 0.7),
    p("b", 10, 0, "DriveThrough", "both", 2),
    p("c", 10, 10, "Measure", "both", 2),
    p("d", 20, 10, "TurningPoint", "both", 2),
    p("e", 20, 20, "Stop", "both", -0.4),
  ];
  expect(autorotate(ps, ids(ps)).map((p) => p.angle)).toEqual([
    0.7,
    0,
    0,
    Math.PI / 2,
    -0.4,
  ]);
  expect(autorotate(ps, ["e"], true)[4].angle).toBe(Math.PI / 2);
});
it("skips coincident neighbours, falls back at endpoints, scopes selection", () => {
  const ps = [
    p("a", 0, 0, "DriveThrough"),
    p("b"),
    p("c", 0, 10),
    p("d", 0, 10),
  ];
  expect(autorotate(ps, ids(ps)).every((p) => p.angle === Math.PI / 2)).toBe(
    true,
  );
  expect(headingTo([p("a", 0, 0, "Measure", "both", 0.4)], 0)).toBe(0.4);
  expect(autorotate(ps, ["c"])[0].angle).toBe(0);
});
it("uses complete-link position clusters and retains rows and Z", () => {
  const ps = [p("a"), p("b", 0.8), p("c", 1.6), p("d", 10)];
  expect(snapPositions(ps, ids(ps), 1).map((p) => p.x)).toEqual([
    0.4, 0.4, 1.6, 10,
  ]);
  expect(
    snapPositions(ps, ids(ps), null).every((p) => p.x === 3.1 && p.z === 7),
  ).toBe(true);
  expect(() => snapPositions(ps, ids(ps), 0)).toThrow();
});
it.each(["closest", "left", "right", "opposite"] as const)(
  "fits four chambers exactly in %s mode",
  (mode) => {
    const ps = [
        p("a", 0, 0, "Measure", "both", 0.1),
        p("b", 0.3, 0.3, "Measure", "both", -0.2),
      ],
      r = snapChambers(ps, ids(ps), 10, mode);
    expect(r.matched).toHaveLength(1);
    const [a, b, c, d] = chambers(r.points),
      cross = r.matched[0].a.side !== r.matched[0].b.side;
    expect(dist(a, b)).toBeCloseTo(4);
    expect(dist(c, d)).toBeCloseTo(4);
    expect(dist(a, cross ? d : c)).toBeCloseTo(0);
    expect(dist(b, cross ? c : d)).toBeCloseTo(0);
    expect(ps[0].angle).toBe(0.1);
  },
);
it("fits single-side chamber midpoint and opposite headings", () => {
  const ps = [
      p("a", 0, 0, "Measure", "left", 0.4),
      p("b", 0.5, 4, "Measure", "right", -0.3),
    ],
    target = centre(chambers(ps)),
    r = snapChambers(ps, ids(ps), 10, "opposite");
  for (const c of chambers(r.points)) expect(dist(c, target)).toBeCloseTo(0);
  expect(Math.cos(r.points[0].angle - r.points[1].angle)).toBeCloseTo(-1);
});
it("chamber pairing is disjoint and respects thresholds and inactive sides", () => {
  const ps = [
      p("a"),
      p("b", 0.1),
      p("c", 0.2),
      p("d", 20),
      p("e", 20.1),
      p("none", 0, 0, "Measure", "none"),
    ],
    r = snapChambers(ps, ids(ps), 1),
    used = r.matched.flatMap((m) => [m.a.uid, m.b.uid]);
  expect(r.matched).toHaveLength(2);
  expect(new Set(used).size).toBe(used.length);
  expect(snapChambers(ps, ids(ps), 0.001).matched).toEqual([]);
  expect(() => snapChambers(ps, ids(ps), NaN)).toThrow();
});
it("footprints support automatic, fixed, rectangle, duplicate and lone chambers", () => {
  const ps = [p("a", 0, 0, "Measure", "left"), p("b", 6, 0, "Measure", "left")],
    auto = footprints(ps)[0].corners;
  expect(dist(auto[0], auto[1])).toBeCloseTo(6);
  const fixed = footprints(ps, { square: 2.5 })[0].corners;
  expect(dist(fixed[0], fixed[1])).toBeCloseTo(2.5);
  const rect = footprints(ps, { rectangle: [1, 3] })[0].corners;
  expect(dist(rect[0], rect[1])).toBeCloseTo(1);
  expect(dist(rect[1], rect[2])).toBeCloseTo(3);
  const lone = footprints([ps[0], { ...ps[0], uid: "copy" }])[0].corners;
  expect(dist(lone[0], lone[1])).toBeCloseTo(2);
  expect(footprints([p("stop", 0, 0, "Stop")])).toEqual([]);
  expect(() => footprints(ps, { square: 0 })).toThrow();
  expect(() => footprints(ps, { square: 1, rectangle: [1, 2] })).toThrow();
  expect(() => footprints(ps, { rectangle: [1, -2] })).toThrow();
});
it("finds rotated field orientation and distances to segments", () => {
  const a = 0.37,
    c = Math.cos(a),
    s = Math.sin(a),
    coords = [
      [0, 0],
      [10, 0],
      [10, 3],
      [0, 3],
    ].map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
  expect(Math.sin(4 * (fieldAngle(coords) - a))).toBeCloseTo(0, 10);
  expect(fieldAngle([])).toBe(0);
  expect(segmentDistance({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(
    3,
  );
  expect(segmentDistance({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(
    1,
  );
  expect(segmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(
    5,
  );
});
