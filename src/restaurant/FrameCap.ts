/**
 * Runs the game on every Nth display refresh so a high-refresh monitor does not render 2-4 times as many
 * frames as a 60 Hz one: 120 and 240 Hz draw at 60, 144 Hz at 72, 165 Hz at 82.5, and 60-100 Hz draw every
 * refresh. The refresh rate is the median of recent requestAnimationFrame intervals, re-measured every
 * `window` callbacks, so moving the window to another monitor adapts. A device that cannot keep up sees long
 * intervals, measures a low rate and is never capped further.
 */
export function createFrameCap(target = 60, window = 60) {
  const deltas = new Float32Array(window), sorted = new Float32Array(window);
  let count = 0, last = 0, tick = 0, divisor = 1;
  return {
    get divisor() { return divisor; },
    /** Call on every animation frame; true when this one should run the game. */
    shouldRender(now: number) {
      const delta = now - last;
      last = now;
      // Ignore the first call and gaps from hidden tabs or long stalls.
      if (delta > 0 && delta < 100) {
        deltas[count++] = delta;
        if (count === window) {
          count = 0;
          sorted.set(deltas); sorted.sort();
          const hz = 1000 / sorted[window >> 1]!;
          const next = Math.max(1, Math.floor(hz / target + .05));
          if (next !== divisor) { divisor = next; tick = 0; }
        }
      }
      return tick++ % divisor === 0;
    },
  };
}

/** Limit drawing only: input, DOM focus and simulation can still update on every browser callback. */
export function createDrawCadence(maxFPS: number) {
  const interval = 1000 / Math.max(1, maxFPS);
  let last: number | null = null, previousSample: number | null = null;
  return {
    shouldDraw(now: number) {
      const clockReset = previousSample !== null && now < previousSample;
      previousSample = now;
      if (last === null || clockReset) { last = now; return true; }
      const elapsed = now - last;
      if (elapsed < interval - .5) return false;
      // Never replay missed draws after a long frame or a hidden tab.
      last += Math.max(1, Math.floor((elapsed + .5) / interval)) * interval;
      return true;
    },
    reset() { last = previousSample = null; },
  };
}

/** Wall time between real draws, kept separate from animation's clamped simulation dt. */
export function createFrameIntervalClock() {
  let previous: number | null = null;
  return {
    sample(now: number) {
      const elapsed = previous === null ? 0 : Math.max(0, (now - previous) / 1000);
      previous = now;
      return elapsed;
    },
    reset() { previous = null; },
  };
}
