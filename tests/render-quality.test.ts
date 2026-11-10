import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RENDER_TIERS, SOFTWARE_RENDER_BUDGET, detectRenderQuality, isConstrainedIntegratedGpu, isSoftwareRenderer, parseQualityOverride, readGpuName, readRenderQualityEnvironment, renderPixelRatio } from '../src/restaurant/render/RenderQuality';

const desktop = { search: '', coarsePointer: false, maxTouchPoints: 0, innerWidth: 1280, deviceMemory: 8, webdriver: false };

test('a fine-pointer desktop gets the high tier with adaptive pixel ratio', () => {
  const quality = detectRenderQuality(desktop);
  assert.equal(quality.tier, 'high');
  assert.equal(quality.pixelRatioCap, 1.5);
  assert.equal(quality.pixelBudget, RENDER_TIERS.high.pixelBudget);
  assert.equal(quality.minScale, .5);
  assert.equal(quality.adaptive, true);
  assert.equal(quality.forced, false);
});

test('coarse pointers, small touch screens and small memory pick the low tier', () => {
  assert.equal(detectRenderQuality({ ...desktop, coarsePointer: true }).tier, 'low');
  assert.equal(detectRenderQuality({ ...desktop, maxTouchPoints: 5, innerWidth: 1100 }).tier, 'low');
  assert.equal(detectRenderQuality({ ...desktop, maxTouchPoints: 5, innerWidth: 1366 }).tier, 'high', 'a wide touch laptop with a fine pointer stays high');
  assert.equal(detectRenderQuality({ ...desktop, maxTouchPoints: 0, innerWidth: 800 }).tier, 'high', 'a narrow desktop window without touch stays high');
  assert.equal(detectRenderQuality({ ...desktop, deviceMemory: 4 }).tier, 'low');
  assert.equal(detectRenderQuality({ ...desktop, deviceMemory: 2 }).tier, 'low');
  assert.equal(detectRenderQuality({ ...desktop, deviceMemory: undefined }).tier, 'high', 'browsers without deviceMemory are judged by input only');
  const phone = detectRenderQuality({ search: '', coarsePointer: true, maxTouchPoints: 5, innerWidth: 844 });
  assert.equal(phone.tier, 'low');
  assert.equal(phone.pixelRatioCap, 1);
  assert.equal(phone.pixelBudget, RENDER_TIERS.low.pixelBudget);
  assert.equal(phone.adaptive, true);
});

test('?quality=high|low overrides detection and disables adaptation', () => {
  const forcedHigh = detectRenderQuality({ ...desktop, coarsePointer: true, search: '?quality=high' });
  assert.equal(forcedHigh.tier, 'high');
  assert.equal(forcedHigh.adaptive, false);
  assert.equal(forcedHigh.forced, true);
  const forcedLow = detectRenderQuality({ ...desktop, search: '?mode=solo&quality=LOW' });
  assert.equal(forcedLow.tier, 'low');
  assert.equal(forcedLow.pixelRatioCap, RENDER_TIERS.low.pixelRatioCap);
  assert.equal(forcedLow.adaptive, false);
  assert.equal(detectRenderQuality({ ...desktop, search: '?quality=ultra' }).tier, 'high', 'unknown values fall back to detection');
  assert.equal(detectRenderQuality({ ...desktop, search: '?quality=ultra' }).forced, false);
  assert.equal(parseQualityOverride(undefined), null);
  assert.equal(parseQualityOverride('?venue=bowling'), null);
  assert.equal(parseQualityOverride('quality=low'), 'low');
});

test('automated browsers keep a stable pixel ratio', () => {
  assert.equal(detectRenderQuality({ ...desktop, webdriver: true }).adaptive, false);
  assert.equal(detectRenderQuality({ ...desktop, webdriver: true }).tier, 'high');
});

test('software WebGL (hardware acceleration off) drops to the low tier unless a tier is forced', () => {
  for (const name of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Google SwiftShader', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ]) assert.equal(isSoftwareRenderer(name), true, name);
  for (const name of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple GPU', 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Adreno (TM) 650', 'WebKit WebGL', '',
  ]) assert.equal(isSoftwareRenderer(name), false, name);
  const software = detectRenderQuality({ ...desktop, softwareRenderer: true });
  assert.equal(software.tier, 'low');
  assert.equal(software.software, true);
  assert.equal(software.adaptive, true);
  assert.equal(software.pixelBudget, SOFTWARE_RENDER_BUDGET.pixelBudget);
  assert.ok(software.pixelBudget < RENDER_TIERS.low.pixelBudget);
  assert.equal(detectRenderQuality(desktop).software, false);
  assert.equal(detectRenderQuality({ ...desktop, softwareRenderer: true, search: '?quality=high' }).tier, 'high', 'an explicit tier still wins');
});

test('named older integrated GPUs select low, while discrete and unknown GPUs retain high', () => {
  for (const name of [
    'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'AMD Radeon Vega 3 Graphics', 'Radeon Vega 6 Graphics', 'Radeon Vega 7 Graphics',
    'AMD Radeon Vega 10 Graphics', 'AMD Radeon Vega 11 Graphics',
    'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'Intel UHD Graphics 630',
  ]) {
    assert.equal(isConstrainedIntegratedGpu(name), true, name);
    const quality = detectRenderQuality({ ...desktop, gpuName: name });
    assert.equal(quality.tier, 'low', name);
    assert.equal(quality.software, false, 'integrated hardware is not a CPU rasterizer');
    assert.equal(quality.pixelBudget, RENDER_TIERS.low.pixelBudget);
  }
  for (const name of [
    'ANGLE (AMD, AMD Radeon RX 560X Series Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'AMD Radeon RX Vega 8', 'AMD Radeon RX 6700 XT', 'Intel(R) Arc(TM) A770 Graphics',
    'Intel(R) Iris(R) Xe Graphics', 'AMD Radeon Vega 80', 'Apple GPU', 'WebKit WebGL', '',
  ]) {
    assert.equal(isConstrainedIntegratedGpu(name), false, name);
    assert.equal(detectRenderQuality({ ...desktop, gpuName: name }).tier, 'high', name);
  }
  const vega = { ...desktop, gpuName: 'AMD Radeon(TM) Vega 8 Graphics' };
  assert.equal(detectRenderQuality({ ...vega, search: '?quality=high' }).tier, 'high');
  assert.equal(detectRenderQuality({ ...vega, search: '?quality=high' }).forced, true);
  assert.equal(detectRenderQuality({ ...vega, search: '?quality=low' }).tier, 'low');
});

test('the GPU name prefers the unmasked renderer and never throws', () => {
  const unmasked = { UNMASKED_RENDERER_WEBGL: 0x9246 };
  const gl = (extension: object | null, values: Record<number, string>) => ({ RENDERER: 0x1F01, getExtension: () => extension, getParameter: (key: number) => values[key] }) as unknown as WebGLRenderingContext;
  assert.equal(readGpuName(gl(unmasked, { 0x9246: 'NVIDIA GeForce', 0x1F01: 'WebKit WebGL' })), 'NVIDIA GeForce');
  assert.equal(readGpuName(gl(null, { 0x1F01: 'WebKit WebGL' })), 'WebKit WebGL');
  assert.equal(readGpuName({ getExtension() { throw new Error('lost'); } } as unknown as WebGLRenderingContext), '');
});

test('big windows draw at most the tier pixel budget, and the adaptive scale stops at minPixels', () => {
  const { high, low } = RENDER_TIERS;
  const drawn = (tier: typeof high, dpr: number, w: number, h: number, scale = 1) => { const r = renderPixelRatio(tier, dpr, w, h, scale); return Math.round(w * r) * Math.round(h * r); };
  // A maximised 1080p window at 150% scaling would draw 4.7 million pixels; it draws the budget instead.
  assert.ok(Math.abs(drawn(high, 1.5, 1920, 1080) - high.pixelBudget) < 5000);
  assert.ok(Math.abs(drawn(high, 1, 2560, 1440) - high.pixelBudget) < 5000, '1440p at 100% too');
  assert.equal(renderPixelRatio(high, 1, 1280, 720), 1, 'a window inside the budget keeps its device ratio');
  assert.equal(renderPixelRatio(high, 2, 1600, 900), Math.sqrt(high.pixelBudget / (1600 * 900)), 'retina is held to the budget');
  assert.equal(renderPixelRatio(high, 3, 800, 450), 1.5, 'the tier cap still applies to small canvases');
  // The adaptive scale lowers the ratio, but never below minPixels...
  assert.ok(Math.abs(drawn(high, 1, 1920, 1080, .75) - 1920 * 1080 * .5625) < 5000);
  assert.ok(Math.abs(drawn(high, 1, 1920, 1080, .5) - high.minPixels) < 5000);
  // ...and a canvas already under minPixels keeps its unscaled ratio.
  assert.equal(renderPixelRatio(high, 1, 640, 360, .5), 1);
  // A phone: 844x390 at 3x is held to the low cap, and can still step down.
  assert.equal(renderPixelRatio(low, 3, 844, 390), 1);
  assert.ok(renderPixelRatio(low, 3, 844, 390, .5) < 1 && drawn(low, 3, 844, 390, .5) >= low.minPixels - 2000);
  assert.equal(renderPixelRatio(high, NaN, 1000, 500), 1, 'a missing device ratio counts as 1');
  assert.equal(renderPixelRatio(high, 1, 0, 0), 1, 'a zero-size canvas is safe');
});

test('software WebGL bounds actual shader pixels separately while automated captures remain deterministic', () => {
  const software = detectRenderQuality({ ...desktop, softwareRenderer: true, webdriver: true });
  const ratio = renderPixelRatio(software, 2, 1280, 800);
  assert.ok(Math.abs(1280 * 800 * ratio ** 2 - 320_000) < 1);
  assert.equal(software.adaptive, false);
  const minimum = renderPixelRatio(software, 2, 1920, 1080, .5);
  assert.ok(Math.abs(1920 * 1080 * minimum ** 2 - 160_000) < 1);
  assert.equal(detectRenderQuality({ ...desktop, softwareRenderer: true, search: '?quality=high' }).pixelBudget, RENDER_TIERS.high.pixelBudget);
  assert.equal(detectRenderQuality({ ...desktop, softwareRenderer: true, search: '?quality=low' }).pixelBudget, SOFTWARE_RENDER_BUDGET.pixelBudget);
});

test('detection is safe without a browser', () => {
  assert.doesNotThrow(() => readRenderQualityEnvironment());
  const quality = detectRenderQuality();
  assert.ok(quality.tier === 'high' || quality.tier === 'low');
  assert.ok(quality.minPixels < quality.pixelBudget && quality.minScale < 1);
});
