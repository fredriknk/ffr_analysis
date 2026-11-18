import { describe, expect, it } from "vitest";
import type { Plot } from "../../api/types";
import {
  centroid,
  layoutAngle,
  plotSize,
  renumberPlots,
  reshapePlots,
  routeTravelAngle,
  type Numbering,
} from "./plotTools";

/** A 3 × 2 grid of 4 × 6 m plots rotated by `turn`, first edge along the rows. */
function grid(turn: number): Plot[] {
  const c = Math.cos(turn),
    s = Math.sin(turn),
    at = (u: number, v: number): [number, number] => [
      100 + u * c - v * s,
      200 + u * s + v * c,
    ];
  const plots: Plot[] = [];
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 3; col++) {
      const u = col * 4,
        v = row * 6;
      plots.push({
        id: plots.length + 1,
        label: "x" + plots.length,
        treatmentId: 1,
        block: 1,
        polygon: [at(u, v), at(u + 4, v), at(u + 4, v + 6), at(u, v + 6)],
      });
    }
  return plots;
}

describe("project plot tools", () => {
  it("finds the field direction from the plots' first edges", () => {
    expect(layoutAngle(grid(0.4))).toBeCloseTo(0.4, 9);
    expect(layoutAngle(grid(-1.2))).toBeCloseTo(-1.2, 9);
  });
  it("resizes chosen plots around their centres, keeping orientation", () => {
    const plots = grid(0.4),
      out = reshapePlots(plots, new Set([2]), {
        shape: "rectangle",
        size: 3,
        width: 2,
        height: 3,
        angle: null,
      });
    expect(out[0]).toBe(plots[0]);
    const [w, h] = plotSize(out[1].polygon!);
    expect(w).toBeCloseTo(2, 9);
    expect(h).toBeCloseTo(3, 9);
    const a = centroid(plots[1].polygon!),
      b = centroid(out[1].polygon!);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(layoutAngle([out[1]])).toBeCloseTo(0.4, 9);
  });
  it("auto squares touch their nearest neighbour", () => {
    const out = reshapePlots(grid(0), new Set([1]), {
      shape: "auto",
      size: 1,
      width: 1,
      height: 1,
      angle: null,
    });
    expect(plotSize(out[0].polygon!)[0]).toBeCloseTo(4, 9);
  });
  const maximize = {
    shape: "maximize",
    size: 1,
    width: 1,
    height: 1,
    angle: null,
  } as const;

  function footprint(id: number, x: number, y: number, width = 2): Plot {
    return {
      id,
      label: "P" + id,
      treatmentId: 1,
      block: 1,
      polygon: [
        [x - 1, y + width / 2],
        [x - 1, y - width / 2],
        [x + 1, y - width / 2],
        [x + 1, y + width / 2],
      ],
    };
  }

  it("uses opposite route headings as one axis and keeps plot widths at their centres", () => {
    const travel = 0.43;
    const angle = routeTravelAngle(
      [travel, travel + Math.PI].map((angle) => ({
        x: 0,
        y: 0,
        z: 0,
        name: "Measure",
        kind: "Measure",
        side: "both",
        angle,
      })),
    );
    expect(angle).toBeCloseTo(travel, 9);
    const plots = [footprint(1, 0, 0, 3), footprint(2, 10, 0)].map((p) => ({
      ...p,
      polygon: p.polygon!.map(([x, y]): [number, number] => [
        599000 + x * Math.cos(travel) - y * Math.sin(travel),
        6615000 + x * Math.sin(travel) + y * Math.cos(travel),
      ]),
    }));
    const out = reshapePlots(plots, new Set([1, 2]), maximize, angle);
    out.forEach((p, i) => {
      const [width, length] = plotSize(p.polygon!);
      expect(width).toBeCloseTo(i === 0 ? 3 : 2, 7);
      expect(length).toBeCloseTo(10, 7);
      expect(centroid(p.polygon!).x).toBeCloseTo(
        centroid(plots[i].polygon!).x,
        7,
      );
      expect(centroid(p.polygon!).y).toBeCloseTo(
        centroid(plots[i].polygon!).y,
        7,
      );
    });
  });
  it("fills the space up to fixed neighbours and ignores adjacent strips", () => {
    const plots = [
      footprint(1, 0, 0),
      footprint(2, 10, 0),
      footprint(3, -3, 0),
      footprint(4, 1, 2),
    ];
    const out = reshapePlots(plots, new Set([1, 2]), maximize);
    expect(plotSize(out[0].polygon!)).toEqual([2, 4]);
    expect(plotSize(out[1].polygon!)).toEqual([2, 16]);
    expect(out[2]).toBe(plots[2]);
    expect(out[3]).toBe(plots[3]);
  });
  it("clips a fixed neighbour to the width strip and leaves isolated plots alone", () => {
    const fixed = {
      ...footprint(2, 8, 0),
      polygon: [
        [9, 0],
        [12, 2],
        [9, 4],
        [6, 2],
      ] as [number, number][],
    };
    const plots = [footprint(1, 0, 0), fixed, footprint(3, 4, -9)];
    const out = reshapePlots(plots, new Set([1, 3]), { ...maximize, angle: 0 });
    expect(plotSize(out[0].polygon!)).toEqual([2, 15]);
    expect(out[1]).toBe(fixed);
    expect(out[2]).toBe(plots[2]);
  });
  it("numbers plots from any corner, by rows or columns, optionally snaking", () => {
    // On the map: ids 4 5 6 are the top row, 1 2 3 the bottom row, left to right.
    const plots = grid(0.4).reverse(),
      ids = new Set(plots.map((p) => p.id)),
      label = (o: Partial<Numbering>) =>
        renumberPlots(plots, ids, {
          prefix: "P",
          start: 1,
          corner: "topLeft",
          by: "rows",
          snake: false,
          ...o,
        })
          .sort((a, b) => a.id - b.id)
          .map((p) => p.label);
    expect(label({})).toEqual(["P4", "P5", "P6", "P1", "P2", "P3"]);
    expect(label({ by: "columns", corner: "topRight" })).toEqual([
      "P6",
      "P4",
      "P2",
      "P5",
      "P3",
      "P1",
    ]);
    expect(label({ corner: "bottomLeft", snake: true })).toEqual([
      "P1",
      "P2",
      "P3",
      "P6",
      "P5",
      "P4",
    ]);
    expect(label({ by: "list", prefix: "B", start: 10 })).toEqual([
      "B15",
      "B14",
      "B13",
      "B12",
      "B11",
      "B10",
    ]);
  });
});
