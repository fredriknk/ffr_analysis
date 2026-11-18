/** Fluxes selected in any chart (union) or in every chart with a selection. */
export function combineSelections(
  sets: number[][],
  mode: "union" | "intersection",
): number[] {
  if (!sets.length) return [];
  if (mode === "union") return [...new Set(sets.flat())];
  const [first, ...rest] = sets,
    others = rest.map((ids) => new Set(ids));
  return [...new Set(first)].filter((id) => others.every((s) => s.has(id)));
}
