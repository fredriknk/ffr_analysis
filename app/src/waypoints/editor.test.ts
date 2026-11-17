import { describe, expect, it } from "vitest";
import type { EditorPoint } from "./types";
import { withUids, stripUids } from "./types";
import {
  changeType,
  deletePoints,
  familyStyle,
  insertPoint,
  numbered,
} from "./naming";
import {
  addPoint,
  alignHeadings,
  commit,
  createDoc,
  deleteSelected,
  insertMidpoint,
  insertionIndex,
  isDirty,
  markSaved,
  movePoints,
  redoDoc,
  rotateGroup,
  selectRange,
  setFields,
  setHeading,
  signature,
  undoDoc,
} from "./editor";
const p = (
  name = "Plot_1",
  kind: EditorPoint["kind"] = "Measure",
  x = 0,
  y = 0,
): EditorPoint => ({
  uid: name,
  name,
  kind,
  x,
  y,
  z: 0,
  angle: 0,
  side: "both",
});
describe("naming", () => {
  it("matches whole numbered names", () => {
    expect(numbered("Dr_Trh_02")).toEqual({ prefix: "Dr_Trh", number: 2 });
    for (const s of ["_2", "Plot_-1", "Plot_2\n", "x"])
      expect(numbered(s)).toBeNull();
  });
  it("inserts in mixed routes without changing earlier names", () => {
    const ps = [
      p("Plot_15"),
      p("DrThr_7", "DriveThrough"),
      p("Plot_16"),
      p("Plot_19"),
    ];
    expect(insertPoint(ps, 2, p("new")).map((p) => p.name)).toEqual([
      "Plot_15",
      "DrThr_7",
      "Plot_16",
      "Plot_17",
      "Plot_18",
    ]);
    expect(ps[3].name).toBe("Plot_19");
    expect(() => insertPoint(ps, -1, p())).toThrow();
    expect(() => insertPoint(ps, 1.5, p())).toThrow();
  });
  it.each(["DrThr", "DrTrh"])("preserves %s spelling", (prefix) => {
    const ps = [
      p(`${prefix}_2`, "DriveThrough"),
      p(),
      p(`${prefix}_3`, "DriveThrough"),
    ];
    expect(familyStyle(ps, "DriveThrough")).toBe(prefix);
    const next = insertPoint(ps, 2, p("new", "DriveThrough"));
    expect(next.map((p) => p.name)).toEqual([
      `${prefix}_2`,
      "Plot_1",
      `${prefix}_3`,
      `${prefix}_4`,
    ]);
    expect(insertPoint(next, 4, p("append", "DriveThrough"))[4].name).toBe(
      `${prefix}_5`,
    );
  });
  it("starts at first future number, closes gaps and handles multiple deletion", () => {
    const ps = [p("Plot_5"), p("Plot_9"), p("Plot_20"), p("Plot_40")];
    expect(insertPoint(ps, 0, p("new"))[0].name).toBe("Plot_5");
    expect(deletePoints(ps, ["Plot_9", "Plot_20"]).map((p) => p.name)).toEqual([
      "Plot_5",
      "Plot_9",
    ]);
    expect(deletePoints([p("custom"), p("Plot_9")], ["custom"])[0].name).toBe(
      "Plot_9",
    );
  });
  it("updates both families and keeps identity and order on type change", () => {
    const ps = [
      p("DrThr_1", "DriveThrough"),
      p("Plot_1"),
      p("Plot_2"),
      p("DrThr_2", "DriveThrough"),
    ];
    const next = changeType(ps, "Plot_1", "DriveThrough");
    expect(next.map((p) => p.name)).toEqual([
      "DrThr_1",
      "DrThr_2",
      "Plot_1",
      "DrThr_3",
    ]);
    expect(next.map((p) => p.uid)).toEqual(ps.map((p) => p.uid));
  });
});
describe("document and editing", () => {
  it("assigns unique IDs, strips them, and preserves original text", () => {
    const original: EditorPoint["original"] = ["0.00", "0", "0", "0"];
    const source = { ...p(), original };
    const ps = withUids([source, source]);
    expect(ps[0].uid).not.toBe(ps[1].uid);
    expect(stripUids(ps)[0].original).toBe(original);
    expect(stripUids(ps)[0]).not.toHaveProperty("uid");
  });
  it("records immutable snapshots, dirty state and branching history", () => {
    const initial = createDoc([p()]);
    expect(isDirty(initial)).toBe(false);
    expect(commit(initial, "none", initial.points)).toBe(initial);
    let doc = commit(
      initial,
      "move",
      movePoints(initial.points, [initial.points[0].uid], 1, 2),
    );
    expect(isDirty(doc)).toBe(true);
    doc = markSaved(doc);
    expect(isDirty(doc)).toBe(false);
    expect(isDirty(undoDoc(doc))).toBe(true);
    expect(isDirty(redoDoc(undoDoc(doc)))).toBe(false);
    const branch = commit(
      undoDoc(doc),
      "branch",
      movePoints(initial.points, [initial.points[0].uid], 2, 0),
    );
    expect(branch.redo).toEqual([]);
    expect(initial.points[0].x).toBe(0);
    expect(signature(initial.points)).not.toBe(signature(doc.points));
  });
  it("limits history to 100", () => {
    let doc = createDoc([p()]);
    for (let i = 0; i < 105; i++)
      doc = commit(
        doc,
        "move",
        movePoints(doc.points, [doc.points[0].uid], 1, 0),
      );
    expect(doc.undo).toHaveLength(100);
  });
  it("adds aligned pairs with inherited Z and route-order selection", () => {
    const ps = [{ ...p("a", "Stop", 0, 0), z: 8 }, p("b", "Measure", 10, 10)];
    const added = addPoint(ps, {
      kind: "Measure",
      side: "both",
      x: 10,
      y: 0,
      position: "after",
      anchorUid: "a",
      pair: true,
    });
    expect(added.points.map((p) => p.kind)).toEqual([
      "Stop",
      "DriveThrough",
      "TurningPoint",
      "Measure",
    ]);
    expect(added.points[1].angle).toBe(0);
    expect(added.points[2].angle).toBeCloseTo(Math.PI / 2);
    expect(added.points[1].z).toBe(8);
    expect(selectRange(added.points, "b", "a")).toEqual(
      added.points.map((p) => p.uid),
    );
    expect(deleteSelected(added.points, added.createdUids)).toHaveLength(2);
  });
  it("aligns new stops and handles midpoint positions and Z", () => {
    const ps = [
      { ...p("a", "Measure", 0, 0), z: 2 },
      { ...p("b", "Measure", 0, 10), z: 6 },
    ];
    const mid = insertMidpoint(ps, {
      anchorUid: "b",
      position: "before",
      kind: "Stop",
      side: "none",
    });
    expect(mid.points[1]).toMatchObject({
      x: 0,
      y: 5,
      z: 4,
      angle: Math.PI / 2,
    });
    expect(() =>
      insertMidpoint(ps, {
        anchorUid: "a",
        position: "before",
        kind: "Measure",
        side: "both",
      }),
    ).toThrow();
    expect(insertionIndex(ps, "end")).toBe(2);
    expect(() => insertionIndex(ps, "after", "missing")).toThrow();
  });
  it("edits fields, uses degrees, and applies automatic alignment only to selection", () => {
    const ps = [p("a", "Measure", 0, 0), p("b", "Stop", 0, 10)];
    expect(
      setFields(ps, "a", {
        x: 2,
        z: 4,
        angleDeg: 90,
        kind: "DriveThrough",
        side: "left",
      })[0],
    ).toMatchObject({
      x: 2,
      z: 4,
      angle: Math.PI / 2,
      kind: "DriveThrough",
      side: "left",
    });
    expect(() => setFields(ps, "a", { x: NaN })).toThrow();
    expect(setHeading(ps, ["a"], 0.7)[0].angle).toBe(0.7);
    expect(alignHeadings(ps, ["a"])[0].angle).toBeCloseTo(Math.PI / 2);
    expect(
      movePoints(ps, ["a"], 0, 1, { autorotate: true })[0].angle,
    ).toBeCloseTo(Math.PI / 2);
    const r = rotateGroup(ps, ["a", "b"], Math.PI / 2, { positionsToo: false });
    expect(r[1].y).toBe(10);
    expect(r[1].angle).toBeCloseTo(Math.PI / 2);
  });
});

it("multi-delete matches reverse-order reference deletion with mixed prefixes and gaps", () => {
  const points = [p("Plot_1"), p("Alternative_20"), p("Odd_90"), p("Last_100")];
  expect(
    deletePoints(points, ["Alternative_20", "Odd_90"]).map((p) => p.name),
  ).toEqual(["Plot_1", "Alternative_20"]);
});
it("coincident midpoint uses the shortest-arc average heading as fallback", () => {
  const points = [
    { ...p("a"), angle: (170 * Math.PI) / 180 },
    { ...p("b"), angle: (-170 * Math.PI) / 180 },
  ];
  const added = insertMidpoint(points, {
    anchorUid: "a",
    position: "after",
    kind: "Measure",
    side: "left",
    pair: true,
  });
  for (const point of added.points.filter((p) =>
    added.createdUids.includes(p.uid),
  ))
    expect(Math.abs(point.angle)).toBeCloseTo(Math.PI);
});
