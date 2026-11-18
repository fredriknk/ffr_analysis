/** [first, last] time of every run of consecutive used points. */
export function usedRuns(t: number[], used: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  t.forEach((v, i) => {
    if (!used[i]) return;
    if (i > 0 && used[i - 1] && runs.length) runs[runs.length - 1][1] = v;
    else runs.push([v, v]);
  });
  return runs;
}
/**
 * Index of the valve switch the offset handle sits on: the one logged nearest
 * the middle of the view. It does not depend on the offset, so stepping the
 * offset moves the handle by exactly the step instead of hopping to another
 * switch.
 */
export function anchorSwitch(times: number[], centre: number) {
  return times.reduce(
    (best, t, i) =>
      Math.abs(t - centre) < Math.abs((times[best] ?? Infinity) - centre)
        ? i
        : best,
    0,
  );
}
/**
 * A usable reading, as in the core: zeros (dropouts) and analyser error codes
 * (about 1.8e304) are neither fitted nor drawn.
 */
export function validReading(y: number) {
  return y !== 0 && Number.isFinite(y) && Math.abs(y) < 1e30;
}
