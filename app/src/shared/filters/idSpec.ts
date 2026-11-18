/**
 * Parses a flux ID list such as `59, 61-70` (ranges inclusive; `..` also
 * works, so older saved `from..to` filters keep working). Returns null when the
 * text selects nothing in particular (empty), else a membership test. Parts
 * that are not numbers or ranges are ignored.
 */
export function parseIdSpec(text: string): ((id: number) => boolean) | null {
  const parts = text
    .replace(/\s*(-|\.\.|–)\s*/g, "$1")
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const ranges: [number, number][] = [];
  for (const part of parts) {
    const m = /^(\d*)(?:-|\.\.|–)(\d*)$/.exec(part);
    if (m && (m[1] || m[2]))
      ranges.push([
        m[1] ? Number(m[1]) : -Infinity,
        m[2] ? Number(m[2]) : Infinity,
      ]);
    else if (/^\d+$/.test(part)) ranges.push([Number(part), Number(part)]);
  }
  if (!ranges.length) return null;
  return (id) =>
    ranges.some(([a, b]) => id >= Math.min(a, b) && id <= Math.max(a, b));
}
