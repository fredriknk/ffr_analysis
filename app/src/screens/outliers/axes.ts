export type AxisScale = "asinh" | "linear" | "log";
export function quantile(values: number[], p: number) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const x = (v.length - 1) * p,
    i = Math.floor(x);
  return v[i] + (v[Math.ceil(x)] - v[i]) * (x - i);
}
export function transformed(value: number, scale: AxisScale) {
  return scale === "asinh"
    ? Math.asinh(value)
    : scale === "log"
      ? Math.log10(Math.max(1e-12, value))
      : value;
}
export function inverse(value: number, scale: AxisScale) {
  return scale === "asinh"
    ? Math.sinh(value)
    : scale === "log"
      ? 10 ** value
      : value;
}
export function robustBounds(values: number[], full = false): [number, number] {
  if (!values.length) return [0, 1];
  let a = quantile(values, full ? 0 : 0.01),
    b = quantile(values, full ? 1 : 0.99);
  if (a === b) {
    a -= Math.abs(a) * 0.05 || 1;
    b += Math.abs(b) * 0.05 || 1;
  }
  return [a, b];
}
export const clamp = (value: number, bounds: [number, number]) =>
  Math.max(bounds[0], Math.min(bounds[1], value));
