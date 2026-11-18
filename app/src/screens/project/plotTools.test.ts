import { describe, expect, it } from "vitest";
import type { Plot } from "../../api/types";
import {
  centroid,
  layoutAngle,
  plotSize,
  renumberPlots,
  reshapePlots,
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
