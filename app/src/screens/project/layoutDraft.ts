import type { Layout } from "../../api/types";

export interface LayoutDraft {
  past: (Layout | null)[];
  current: Layout | null;
  future: Layout[];
}

export const emptyLayoutDraft: LayoutDraft = {
  past: [],
  current: null,
  future: [],
};

type DraftAction =
  | { type: "edit"; layout: Layout; saved: Layout | undefined }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

export function layoutDraftReducer(
  draft: LayoutDraft,
  action: DraftAction,
): LayoutDraft {
  switch (action.type) {
    case "edit":
      if (
        JSON.stringify(action.layout) ===
        JSON.stringify(draft.current ?? action.saved)
      )
        return draft;
      return {
        past: [...draft.past, draft.current],
        current: action.layout,
        future: [],
      };
    case "undo":
      if (!draft.current || draft.past.length === 0) return draft;
      return {
        past: draft.past.slice(0, -1),
        current: draft.past.at(-1) ?? null,
        future: [draft.current, ...draft.future],
      };
    case "redo": {
      const [next, ...rest] = draft.future;
      if (!next) return draft;
      return {
        past: [...draft.past, draft.current],
        current: next,
        future: rest,
      };
    }
    case "reset":
      return emptyLayoutDraft;
  }
}
