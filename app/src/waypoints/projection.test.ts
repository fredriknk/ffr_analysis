import { expect, it } from "vitest";
import {
  metresPerMapUnit,
  mercatorToWgs84,
  parseCrs,
  Projection,
  tileAt,
  tileBounds,
  utmToWgs84,
  wgs84ToMercator,
  wgs84ToUtm,
  WORLD,
} from "./projection";
import { glyphs, labelBoxes } from "./labels";
it("validates UTM CRSs", () => {
  expect(parseCrs("EPSG:32632")).toEqual({ zone: 32, north: true });
  expect(parseCrs("EPSG:32760")).toEqual({ zone: 60, north: false });
  for (const s of ["EPSG:4326", "EPSG:32600", "EPSG:32761", "32632"])
    expect(() => parseCrs(s)).toThrow(
      "Choose a UTM coordinate system such as EPSG:32632.",
    );
});
it("matches known coordinates", () => {
  const gps = utmToWgs84(599204.292028, 6615298.6725, parseCrs("EPSG:32632"));
  expect(gps.lat).toBeCloseTo(59.66, 2);
  expect(gps.lon).toBeCloseTo(10.76, 1);
  expect(wgs84ToUtm(9, 0, { zone: 32, north: true })).toEqual({
    x: 500000,
    y: 0,
  });
  expect(wgs84ToUtm(12, 0, { zone: 32, north: true }).x).toBeCloseTo(
    833978.556919,
    4,
  );
  const sydney = wgs84ToUtm(151, -33, { zone: 56, north: false });
  expect(sydney.x).toBeCloseTo(313152.777215, 3);
  expect(sydney.y).toBeCloseTo(6346936.495708, 3);
});
it.each([1, 32, 56, 60])(
  "round trips zone %i edges and both hemispheres to centimetres",
  (zone) => {
    for (const lat of [-79, -33, 0, 60, 83])
      for (const offset of [-3, 0, 3]) {
        const crs = { zone, north: lat >= 0 },
          lon = zone * 6 - 183 + offset,
          utm = wgs84ToUtm(lon, lat, crs),
          gps = utmToWgs84(utm.x, utm.y, crs);
        expect(Math.abs(gps.lon - lon)).toBeLessThan(1e-8);
        expect(Math.abs(gps.lat - lat)).toBeLessThan(1e-8);
        const proj = new Projection(
            `EPSG:${crs.north ? "326" : "327"}${String(zone).padStart(2, "0")}`,
          ),
          m = proj.toMap(utm.x, utm.y),
          back = proj.fromMap(m.mx, m.my);
        expect(Math.hypot(back.x - utm.x, back.y - utm.y)).toBeLessThan(0.01);
      }
  },
);
it("converts Mercator and XYZ tile northings", () => {
  const m = wgs84ToMercator(10, 60),
    ll = mercatorToWgs84(m.mx, m.my);
  expect(ll.lat).toBeCloseTo(60, 10);
  expect(ll.lon).toBeCloseTo(10, 10);
  expect(metresPerMapUnit(m.my)).toBeCloseTo(0.5);
  expect(tileAt(-WORLD / 4, WORLD / 4, 1)).toEqual({ x: 0, y: 0 });
  expect(tileBounds(0, 0, 0)).toEqual({
    minX: -WORLD / 2,
    maxX: WORLD / 2,
    minY: -WORLD / 2,
    maxY: WORLD / 2,
  });
});
it("sizes overlapping glyphs by route order without chain clustering", () => {
  const gs = glyphs([
    { uid: "a", x: 100, y: 100 },
    { uid: "b", x: 110, y: 100 },
    { uid: "c", x: 120, y: 100 },
  ]);
  expect(gs[0].radius).toBeGreaterThan(gs[1].radius);
  expect(gs.map((g) => g.cluster)).toEqual([0, 0, 1]);
  expect(
    glyphs(
      [
        { uid: "a", x: 0, y: 0 },
        { uid: "b", x: 0, y: 0 },
      ],
      0,
    ).map((g) => g.radius),
  ).toEqual([5.5, 5.5]);
});
it("stacks labels and hides collisions, preferring selection", () => {
  const gs = glyphs([
      { uid: "a", name: "one", x: 100, y: 100 },
      { uid: "b", name: "two", x: 100, y: 100 },
    ]),
    opts = {
      textWidth: (s: string) => s.length * 7,
      height: 14,
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      preferred: new Set<string>(),
    },
    boxes = labelBoxes(gs, opts);
  expect(boxes.size).toBe(2);
  expect(boxes.get("a")!.y).toBeLessThan(boxes.get("b")!.y);
  const overlap = gs.map((g, i) => ({
    ...g,
    cluster: i,
    position: { x: 100, y: 200 },
    arrowEnd: { x: 130, y: 200 },
  }));
  expect([...labelBoxes(overlap, opts).keys()]).toEqual(["a"]);
  expect([
    ...labelBoxes(overlap, { ...opts, preferred: new Set(["b"]) }).keys(),
  ]).toEqual(["b"]);
  expect(
    labelBoxes(gs, { ...opts, viewport: { x: 0, y: 0, width: 50, height: 50 } })
      .size,
  ).toBe(0);
});
it("pans tag anchors with markers", () => {
  const gs = glyphs([{ uid: "a", x: 200, y: 200 }]),
    opts = {
      textWidth: () => 50,
      height: 14,
      viewport: { x: 0, y: 0, width: 800, height: 600 },
    },
    before = labelBoxes(gs, opts).get("a")!,
    moved = gs.map((g) => ({
      ...g,
      position: { x: g.position.x + 10, y: g.position.y + 20 },
      arrowEnd: { x: g.arrowEnd.x + 10, y: g.arrowEnd.y + 20 },
    })),
    after = labelBoxes(moved, opts).get("a")!;
  expect(after.x - before.x).toBe(10);
  expect(after.y - before.y).toBe(20);
});
