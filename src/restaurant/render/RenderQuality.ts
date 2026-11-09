/**
 * One render tier per page load, chosen before the first shader compile.
 * Light count and shadow casters depend on it, so it never changes at runtime;
 * only the resolution scale may step down while playing.
 */
export type RenderTier = 'high' | 'low';

export interface RenderQuality {
  readonly tier: RenderTier;
  /** Upper bound applied to window.devicePixelRatio. */
  readonly pixelRatioCap: number;
  /** Most drawing-buffer pixels at full scale: a big window renders at this many pixels and is scaled up. */
  readonly pixelBudget: number;
  /** Fewest drawing-buffer pixels the adaptive scale may reach (small canvases keep their device ratio). */
  readonly minPixels: number;
  /** The adaptive resolution scale never goes below this. */
  readonly minScale: number;
  /** Frame-time driven resolution step-down. Off for ?quality= overrides and automated browsers. */
  readonly adaptive: boolean;
  /** True when ?quality=high|low chose the tier. */
  readonly forced: boolean;
  /** WebGL runs on the CPU (SwiftShader, llvmpipe, Basic Render Driver): the browser is not using the graphics card. */
  readonly software: boolean;
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
  /** The WebGL context reports a CPU rasterizer (see isSoftwareRenderer). */
  softwareRenderer?: boolean;
}

/**
 * Fill cost grows with drawn pixels, and every lit pixel shades every light, so the tiers budget pixels rather
 * than only capping the device ratio: a maximised 1440p or 150%-scaled window would otherwise draw 4-5 million.
 */
export const RENDER_TIERS: Readonly<Record<RenderTier, { pixelRatioCap: number; pixelBudget: number; minPixels: number; minScale: number }>> = {
  high: { pixelRatioCap: 1.5, pixelBudget: 2_100_000, minPixels: 560_000, minScale: .5 },
  low: { pixelRatioCap: 1, pixelBudget: 600_000, minPixels: 240_000, minScale: .5 },
};
/** CPU rasterizers need a lower starting load; DOM menus/captions retain their native resolution. */
export const SOFTWARE_RENDER_BUDGET = { pixelRatioCap: 1, pixelBudget: 320_000, minPixels: 160_000, minScale: .5 } as const;

type ResolutionPolicy = Pick<RenderQuality, 'pixelRatioCap' | 'pixelBudget' | 'minPixels'>;

/**
 * The pixel ratio for a canvas of cssWidth x cssHeight: the device ratio up to the tier cap, lowered so the
 * drawing buffer fits the pixel budget, times the adaptive scale, but never under minPixels (and never above
 * the unscaled ratio, so a tiny canvas simply keeps it).
 */
export function renderPixelRatio(quality: ResolutionPolicy, devicePixelRatio: number, cssWidth: number, cssHeight: number, scale = 1) {
  const area = Math.max(1, cssWidth * cssHeight);
  const device = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const full = Math.min(device, quality.pixelRatioCap, Math.sqrt(quality.pixelBudget / area));
  const floor = Math.min(full, Math.sqrt(quality.minPixels / area));
  return Math.max(floor, full * Math.min(1, Math.max(0, scale)));
}

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
  const software = !!env.softwareRenderer;
  const tier: RenderTier = override ?? (env.coarsePointer || touchScreen || smallMemory || software ? 'low' : 'high');
  return {
    tier,
    ...(software && tier === 'low' ? SOFTWARE_RENDER_BUDGET : RENDER_TIERS[tier]),
    adaptive: !override && !env.webdriver,
    forced: !!override,
    software,
  };
}

/** The GPU the browser actually draws with, as WebGL reports it (unmasked where the browser allows). */
export function readGpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return String((debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '');
  } catch {
    return '';
  }
}

/** True for CPU rasterizers: Chrome falls back to SwiftShader when hardware acceleration is off or the GPU is blocklisted. */
export function isSoftwareRenderer(gpuName: string) {
  return /swiftshader|llvmpipe|softpipe|lavapipe|basic render driver|software rasterizer|mesa offscreen/i.test(gpuName);
}
