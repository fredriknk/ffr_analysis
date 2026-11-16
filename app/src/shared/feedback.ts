export let toastFn: (s: string) => void = () => {};
export const error = (e: unknown) =>
  toastFn(
    typeof e === "object" && e && "message" in e
      ? String(e.message)
      : String(e),
  );
export function setToastHandler(fn: (s: string) => void) {
  toastFn = fn;
}
