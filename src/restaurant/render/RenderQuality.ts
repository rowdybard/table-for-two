/**
 * One render tier per page load, chosen before the first shader compile.
 * Light count and shadow casters depend on it, so it never changes at runtime;
 * only the pixel ratio may step down while playing.
 */
export type RenderTier = 'high' | 'low';

export interface RenderQuality {
  readonly tier: RenderTier;
  /** Upper bound applied to window.devicePixelRatio. */
  readonly pixelRatioCap: number;
  /** The adaptive step-down never goes below this. */
  readonly pixelRatioFloor: number;
  /** Frame-time driven pixel-ratio step-down. Off for ?quality= overrides and automated browsers. */
  readonly adaptive: boolean;
  /** True when ?quality=high|low chose the tier. */
  readonly forced: boolean;
}

/** Browser facts the tier depends on. Every field is optional so tests can pass only what matters. */
export interface RenderQualityEnvironment {
  /** location.search, for the ?quality=high|low override. */
  search?: string;
  /** matchMedia('(pointer: coarse)').matches */
  coarsePointer?: boolean;
  maxTouchPoints?: number;
  innerWidth?: number;
  /** navigator.deviceMemory in GB (Chromium only). */
  deviceMemory?: number;
  /** navigator.webdriver */
  webdriver?: boolean;
}

export const RENDER_TIERS: Readonly<Record<RenderTier, { pixelRatioCap: number; pixelRatioFloor: number }>> = {
  high: { pixelRatioCap: 1.5, pixelRatioFloor: 1 },
  low: { pixelRatioCap: 1.25, pixelRatioFloor: .75 },
};

/** Same small-touch-screen test as the mobile controls. */
const TOUCH_WIDTH_LIMIT = 1100;
const LOW_DEVICE_MEMORY_GB = 4;

export function readRenderQualityEnvironment(): RenderQualityEnvironment {
  const env: RenderQualityEnvironment = {};
  try {
    if (typeof location !== 'undefined') env.search = location.search;
  } catch { /* opaque origin */ }
  try {
    if (typeof window !== 'undefined') {
      env.innerWidth = window.innerWidth;
      env.coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    }
  } catch { /* matchMedia unavailable */ }
  try {
    if (typeof navigator !== 'undefined') {
      env.maxTouchPoints = navigator.maxTouchPoints;
      env.webdriver = navigator.webdriver === true;
      const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      if (typeof memory === 'number') env.deviceMemory = memory;
    }
  } catch { /* restricted navigator */ }
  return env;
}

export function parseQualityOverride(search: string | undefined): RenderTier | null {
  if (!search) return null;
  try {
    const value = new URLSearchParams(search).get('quality')?.trim().toLowerCase();
    return value === 'high' || value === 'low' ? value : null;
  } catch {
    return null;
  }
}

export function detectRenderQuality(env: RenderQualityEnvironment = readRenderQualityEnvironment()): RenderQuality {
  const override = parseQualityOverride(env.search);
  const touchScreen = (env.maxTouchPoints ?? 0) > 0 && (env.innerWidth ?? Infinity) <= TOUCH_WIDTH_LIMIT;
  const memory = env.deviceMemory;
  const smallMemory = typeof memory === 'number' && Number.isFinite(memory) && memory > 0 && memory <= LOW_DEVICE_MEMORY_GB;
  const tier: RenderTier = override ?? (env.coarsePointer || touchScreen || smallMemory ? 'low' : 'high');
  return {
    tier,
    ...RENDER_TIERS[tier],
    adaptive: !override && !env.webdriver,
    forced: !!override,
  };
}
