import { describe, expect, it } from "vitest";
import type { Layout } from "../../api/types";
import { emptyLayoutDraft, layoutDraftReducer } from "./layoutDraft";

const saved: Layout = { plots: [], treatments: [] };
const moved: Layout = {
  ...saved,
  plots: [{ id: 1, label: "P1", treatmentId: 1, block: 1, polygon: [[4, 5]] }],
};
const renamed: Layout = {
  ...moved,
  plots: [{ ...moved.plots[0], label: "Renamed" }],
};

describe("layout draft", () => {
  it("undoes and redoes draft edits back to the saved layout", () => {
    const move = layoutDraftReducer(emptyLayoutDraft, {
      type: "edit",
      layout: moved,
      saved,
    });
    const rename = layoutDraftReducer(move, {
      type: "edit",
      layout: renamed,
      saved,
    });
    const undone = layoutDraftReducer(rename, { type: "undo" });
    expect(undone.current).toBe(moved);
    const baseline = layoutDraftReducer(undone, { type: "undo" });
    expect(baseline.current).toBeNull();
    expect(layoutDraftReducer(baseline, { type: "undo" })).toBe(baseline);
    const redone = layoutDraftReducer(baseline, { type: "redo" });
    expect(redone.current).toBe(moved);
    expect(layoutDraftReducer(redone, { type: "redo" }).current).toBe(renamed);
  });

  it("preserves redo for a no-op and drops it on a new edit or reset", () => {
    const move = layoutDraftReducer(emptyLayoutDraft, {
      type: "edit",
      layout: moved,
      saved,
    });
    const baseline = layoutDraftReducer(move, { type: "undo" });
    expect(
      layoutDraftReducer(baseline, {
        type: "edit",
        layout: structuredClone(saved),
        saved,
      }),
    ).toBe(baseline);
    const newEdit = layoutDraftReducer(baseline, {
      type: "edit",
      layout: renamed,
      saved,
    });
    expect(newEdit.future).toEqual([]);
    expect(layoutDraftReducer(newEdit, { type: "reset" })).toBe(
      emptyLayoutDraft,
    );
  });
});
