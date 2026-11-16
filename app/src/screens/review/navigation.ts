export function nextQueueId(
  current: number,
  direction: number,
  ids: number[],
  previous: number[],
): number | undefined {
  const index = ids.indexOf(current);
  if (index >= 0)
    return ids[Math.max(0, Math.min(ids.length - 1, index + direction))];
  const old = previous.indexOf(current),
    candidates =
      direction > 0
        ? previous.slice(old + 1)
        : previous.slice(0, old).reverse();
  return (
    candidates.find((id) => ids.includes(id)) ??
    (direction > 0 ? ids[0] : ids.at(-1))
  );
}
