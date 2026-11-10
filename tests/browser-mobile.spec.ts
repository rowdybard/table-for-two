import { createServer, type Server } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { attachRestaurantServer, type ClaudeAdapter } from '../server/restaurant';
import type { DinnerState, SceneTurn } from '../src/restaurant/types';
import { waitForRestaurantScene } from './restaurant-browser-helpers';
import { captureMobileGL, installMobileGLDiagnostics, readMobileGLDiagnostics } from './mobile-webgl-diagnostics';

let http: Server, app: Awaited<ReturnType<typeof attachRestaurantServer>>, base = '';
const messages: string[] = [];
const claude: ClaudeAdapter = { async *stream(request) {
  messages.push(request.messages.at(-1)!.content);
  const turn: SceneTurn = { utterances: [{ speaker: 'date', text: 'I like that. What else should I know about you?', emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'A good first impression.' };
  yield { type: 'text', text: JSON.stringify(turn) };
  yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 } };
} };
const readState = (page: Page) => page.evaluate(() => (window as unknown as Window & { __restaurantState: DinnerState }).__restaurantState);

test.use({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });

test.beforeAll(async () => {
  const root = resolve('dist');
  http = createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (app.handle(req, res)) return;
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'index.html' : '.' + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    void readFile(file).then(data => { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.glb': 'model/gltf-binary' } as Record<string, string>)[extname(file)] || 'application/octet-stream'); res.end(data); }).catch(() => res.writeHead(404).end());
  });
  app = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none' }, claude, development: true, ledgerPath: false });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  await mkdir('.qa', { recursive: true });
});
test.afterAll(async () => { await app?.close(); http?.closeAllConnections(); await new Promise<void>(resolve => http?.close(() => resolve())); });

async function begin(page: Page) {
  await page.addInitScript(() => localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: false, ambience: false })));
  await page.goto(base);
  await page.locator('#title-start').tap();
  await page.locator('#mode-solo').tap();
  await page.locator('[data-date="mira"]').tap();
  await page.locator('#start-date').tap();
  await expect(page.locator('#dinner-hud')).toBeVisible();
  await waitForRestaurantScene(page);
  await expect(page.locator('#mobile-controls')).toBeVisible();
}

class Thumbs {
  private readonly points = new Map<number, { x: number; y: number }>();
  constructor(private readonly cdp: CDPSession) {}
  async down(id: number, x: number, y: number) { this.points.set(id, { x, y }); await this.send('touchStart'); }
  async move(id: number, x: number, y: number) { this.points.set(id, { x, y }); await this.send('touchMove'); }
  async up(id: number) { this.points.delete(id); await this.send('touchEnd'); }
  async cancel() { this.points.clear(); await this.send('touchCancel'); }
  private send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel') { return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...this.points].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 7, radiusY: 7, force: .7 })) }); }
}
async function center(page: Page, selector: string) {
  const bounds = await page.locator(selector).boundingBox();
  if (!bounds) throw new Error(`Missing touch surface ${selector}`);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
async function assertFits(page: Page, selectors: string[]) {
  const viewport = page.viewportSize()!;
  await expect(async () => {
    for (const selector of selectors) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds, `${selector} must be visible`).not.toBeNull();
      expect(bounds!.x, selector).toBeGreaterThanOrEqual(0);
      expect(bounds!.y, selector).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width, selector).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds!.y + bounds!.height, selector).toBeLessThanOrEqual(viewport.height + 1);
    }
  }).toPass({ timeout: 8000 });
}
const settleFrame = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function assertCenterHit(page: Page, selector: string) {
  await expect(page.locator(selector)).toBeVisible();
  const point = await center(page, selector);
  expect(await page.evaluate(({ point, selector }) => !!document.elementFromPoint(point.x, point.y)?.closest(selector), { point, selector }), `${selector} must receive its center touch`).toBe(true);
  return point;
}

test('landscape phone: two thumbs, talk return, neutral input, context action and pause remain usable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch dispatch uses Chromium CDP; menu and viewport checks also run in WebKit.');
  page.setDefaultTimeout(8000);
  if (process.env.LFS_SOFTWARE_GPU === '1') test.setTimeout(240_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let pauseRequests = 0;
  page.on('request', request => { if (request.url().includes('/command') && request.postDataJSON()?.type === 'pause' && request.postDataJSON()?.paused === true) pauseRequests++; });
  const traceTouch = process.env.RESTAURANT_TOUCH_DIAGNOSTICS === '1';
  if (traceTouch) await page.addInitScript(() => {
    const trace: unknown[] = [];
    (window as Window & { __mobileTouchTrace?: unknown[] }).__mobileTouchTrace = trace;
    const name = (element: EventTarget | null) => element instanceof Element ? element.id || `${element.tagName.toLowerCase()}.${element.className}` : String(element);
    const record = (event: Event) => {
      const pointer = event as PointerEvent, touch = (event as TouchEvent).changedTouches?.[0];
      const x = pointer.clientX ?? touch?.clientX, y = pointer.clientY ?? touch?.clientY;
      const pause = document.querySelector<HTMLElement>('#mobile-pause');
      const entry = { time: Date.now(), event: event.type, target: name(event.target), focus: name(document.activeElement), pointerId: pointer.pointerId, pointerType: pointer.pointerType, isPrimary: pointer.isPrimary,
        touches: (event as TouchEvent).touches?.length, changedTouches: (event as TouchEvent).changedTouches?.length,
        x, y, defaultPrevented: event.defaultPrevented, preventedAfterDispatch: false, hit: Number.isFinite(x) && Number.isFinite(y) ? document.elementsFromPoint(x, y).slice(0, 5).map(name) : undefined,
        viewport: [innerWidth, innerHeight], app: { ...document.querySelector<HTMLElement>('#restaurant-app')?.dataset },
        pause: pause ? { rect: pause.getBoundingClientRect().toJSON(), hidden: pause.hidden } : null,
        dialogHidden: (document.querySelector('#pause-dialog') as HTMLElement | null)?.hidden, prompt: document.querySelector('#prompt-copy')?.textContent };
      trace.push(entry);
      setTimeout(() => { entry.preventedAfterDispatch = event.defaultPrevented; }, 0);
      if (trace.length > 350) trace.shift();
    };
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click', 'focusin', 'focusout']) document.addEventListener(type, record, { capture: true, passive: true });
    window.addEventListener('resize', record);
    visualViewport?.addEventListener('resize', record);
  });
  await begin(page);
  await assertFits(page, ['#mobile-move', '#mobile-talk', '#mobile-mic', '#mobile-pause']);
  const cdp = await page.context().newCDPSession(page), thumbs = new Thumbs(cdp);
  const move = await center(page, '#mobile-move'), look = await center(page, '#mobile-look');
  const before = (await readState(page)).participants[0].position[2];
  await thumbs.down(1, move.x, move.y); await thumbs.move(1, move.x, move.y - 46);
  await thumbs.down(2, look.x, look.y); await thumbs.move(2, look.x + 22, look.y + 8);
  await expect.poll(async () => (await readState(page)).participants[0].position[2]).toBeLessThan(before - .2);
  await thumbs.cancel();
  await thumbs.down(1, move.x, move.y); await thumbs.move(1, move.x, move.y - 46);
  await page.locator('#mobile-talk').tap();
  await thumbs.cancel();
  try {
    await expect(page.locator('#conversation-input')).toBeFocused();
  } finally {
    if (traceTouch) await writeFile('.qa/mobile-talk-touch-trace.json', JSON.stringify(await page.evaluate(() => (window as Window & { __mobileTouchTrace?: unknown[] }).__mobileTouchTrace), null, 2));
  }
  await expect(page.locator('#mobile-move')).toBeHidden();
  await page.locator('#conversation-input').fill('I wanted to say hello.');
  await page.locator('#mobile-talk-close').tap();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect(page.locator('#mobile-controls')).toBeVisible();
  await page.waitForTimeout(180);
  const stopped = (await readState(page)).participants[0].position;
  await page.waitForTimeout(250);
  expect((await readState(page)).participants[0].position).toEqual(stopped);
  await page.locator('#mobile-talk').tap();
  await expect(page.locator('#conversation-input')).toHaveValue('I wanted to say hello.');
  await page.locator('#send-turn').tap();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect.poll(() => messages.some(text => text.includes('I wanted to say hello.'))).toBe(true);
  await assertCenterHit(page, '#mobile-pause');
  await page.locator('#mobile-pause').tap();
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await assertFits(page, ['#resume-date', '#pause-talk', '#pause-journal', '#pause-settings', '#finish-date']);
  await expect(page.locator('#mobile-controls')).toBeHidden();
  await page.locator('#resume-date').tap();
  await expect(page.locator('#mobile-controls')).toBeVisible();

  // Rotate with a held thumb. Resizing must cancel the capture, even after returning to landscape.
  const pad = await center(page, '#mobile-move');
  await thumbs.down(1, pad.x, pad.y); await thumbs.move(1, pad.x, pad.y - 44);
  await page.setViewportSize({ width: 390, height: 844 });
  await thumbs.cancel();
  await expect(page.locator('#mobile-rotate')).toBeVisible();
  await page.locator('#mobile-rotate button').tap();
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('#resume-date').tap();
  await page.waitForTimeout(180);
  const afterRotation = (await readState(page)).participants[0].position;
  await page.waitForTimeout(250);
  expect((await readState(page)).participants[0].position).toEqual(afterRotation);

  const walkingPad = await center(page, '#mobile-move');
  // Earlier held-thumb checks can carry the guest past the chair on slow frames.
  // Return to its approach side with real touch movement before aiming at it.
  if ((await readState(page)).participants[0].position[2] < 2.4) {
    await thumbs.down(1, walkingPad.x, walkingPad.y);
    try {
      await thumbs.move(1, walkingPad.x, walkingPad.y + 44);
      await expect.poll(async () => (await readState(page)).participants[0].position[2], { timeout: 12_000, intervals: [60] }).toBeGreaterThan(2.4);
    } finally { await thumbs.up(1); }
  }
  const lookingPad = await center(page, '#mobile-look');
  await thumbs.down(2, lookingPad.x, lookingPad.y - 35); await thumbs.move(2, lookingPad.x, lookingPad.y + 35); await thumbs.up(2);
  await thumbs.down(1, walkingPad.x, walkingPad.y);
  try {
    await thumbs.move(1, walkingPad.x, walkingPad.y - 44);
    await expect.poll(() => page.locator('#mobile-interact').evaluate(node => node instanceof HTMLElement && !node.hidden && /seat/i.test(node.textContent ?? '')), { timeout: 12_000, intervals: [60] }).toBe(true);
  } finally { await thumbs.up(1); }
  await writeFile('.qa/mobile-seat-state.json', JSON.stringify({ state: await readState(page), hud: await page.locator('#restaurant-app').evaluate(node => ({ ...node.dataset })) }));
  await expect(page.locator('#mobile-interact')).toBeVisible();
  await expect(page.locator('#mobile-interact')).toContainText(/seat/i);
  await page.locator('#mobile-interact').tap();
  await expect.poll(async () => (await readState(page)).seated).toBe(true);
  await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-seated.png' });
  await expect(page.locator('#mobile-move')).toBeHidden();
  // The prompt line is the seated guest's whole menu: one chip, phone-sized, inside the safe area.
  const menuChip = page.locator('#prompt-chips button', { hasText: 'Open the menu' });
  await expect(menuChip).toBeVisible();
  await expect(page.locator('#restaurant-app')).toHaveAttribute('data-mobile-seated', 'true');
  await assertFits(page, ['#prompt-line', '#prompt-chips button']);
  expect((await menuChip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const chipPoint = await assertCenterHit(page, '#prompt-chips button');
  await assertCenterHit(page, '#mobile-pause');
  await assertCenterHit(page, '#mobile-look');
  await page.touchscreen.tap(chipPoint.x, chipPoint.y);
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await page.locator('[data-order="Wild mushroom risotto"]').tap();
  await expect.poll(async () => (await readState(page)).order).toBe('Wild mushroom risotto');
  await expect(menuChip).toBeHidden();
  await expect(page.locator('#mobile-pause')).toBeVisible();
  await settleFrame(page); await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-seated-prompt.png' });
  // Typing covers the prompt so no chip can be tapped under the keyboard, and it returns afterwards.
  await page.locator('#mobile-talk').tap();
  await expect(page.locator('#conversation-input')).toBeFocused();
  await expect(page.locator('#prompt-line')).toBeHidden();
  await page.locator('#mobile-talk-close').tap();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect(page.locator('#prompt-line')).toBeVisible();
  await page.setViewportSize({ width: 667, height: 320 });
  await assertFits(page, ['#prompt-line', '#mobile-pause']);
  const pause = await assertCenterHit(page, '#mobile-pause');
  const pauseRequestsBeforeTap = pauseRequests;
  await thumbs.down(3, pause.x, pause.y); await thumbs.move(3, pause.x + 24, pause.y); await thumbs.up(3);
  await settleFrame(page);
  await expect(page.locator('#pause-dialog')).toBeHidden();
  await expect(page.locator('#prompt-line')).toBeVisible();
  await page.locator('#mobile-pause').evaluate(button => button.addEventListener('pointerdown', event => { button.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId)); }, { once: true }));
  await thumbs.down(4, pause.x, pause.y);
  await expect(page.locator('#mobile-pause')).toHaveAttribute('data-test-pointer', /^\d+$/);
  const canceledPointer = Number(await page.locator('#mobile-pause').getAttribute('data-test-pointer'));
  await page.locator('#mobile-pause').dispatchEvent('pointercancel', { pointerId: canceledPointer, pointerType: 'touch', isPrimary: true });
  await thumbs.up(4); await settleFrame(page);
  await expect(page.locator('#pause-dialog')).toBeHidden();
  expect(pauseRequests).toBe(pauseRequestsBeforeTap);
  try {
    await page.locator('#mobile-pause').tap();
    await expect(page.locator('#pause-dialog')).toBeVisible();
    await expect.poll(() => pauseRequests - pauseRequestsBeforeTap).toBe(1);
  } finally {
    if (traceTouch) await writeFile('.qa/mobile-pause-touch-trace.json', JSON.stringify(await page.evaluate(() => (window as Window & { __mobileTouchTrace?: unknown[] }).__mobileTouchTrace), null, 2));
  }
  await expect(page.locator('#prompt-line')).toBeHidden();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  expect(errors).toEqual([]);
  if (process.env.RESTAURANT_CAPTURE_SCREENSHOTS === '1') await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-landscape.png' });
  await cdp.detach();
});

test('small landscape menus, portrait browsing, Home Screen fallback and PWA metadata are reachable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: false, ambience: false }));
    // Exercise the actual unsupported-browser branch in every engine.
    Object.defineProperty(document, 'fullscreenEnabled', { get: () => false });
  });
  await page.setViewportSize({ width: 667, height: 320 });
  await page.goto(base);
  await expect(page.locator('#restaurant-app')).toHaveAttribute('data-mobile', 'true');
  await assertFits(page, ['#title-start', '#settings-open', '#mobile-display']);
  await page.locator('#mobile-display').tap();
  await expect(page.locator('#mobile-display-help')).toBeVisible();
  await expect(page.locator('#mobile-display-copy')).toContainText('Add to Home Screen');
  await expect(page.locator('#mobile-display-close')).toBeFocused();
  await page.locator('#mobile-display-close').tap();
  await page.locator('#title-start').tap();
  await assertFits(page, ['#mode-solo', '#mode-double', '#mode-blind', '#mode-back']);
  await page.locator('#mode-solo').tap();
  await assertFits(page, ['[data-date="mira"]', '[data-date="dev"]', '[data-date="jules"]', '#start-date', '#select-back']);
  for (const id of ['mira', 'jules', 'dev']) {
    await page.locator(`[data-date="${id}"]`).tap();
    await expect(page.locator(`[data-date="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await settleFrame(page); await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-small-roster.png' });
  await page.locator('#select-back').tap();
  await page.locator('#mode-double').tap();
  await page.locator('#double-name').fill('Alex');
  await page.locator('#double-join-open').tap();
  await page.locator('#double-code').fill('A real code');
  await page.locator('#double-entry-back').tap();
  await page.locator('#double-entry-back').tap();
  await page.locator('#mode-back').tap();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertFits(page, ['#title-start', '#settings-open']);
  await page.locator('#settings-open').tap();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await settleFrame(page); await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-portrait-settings.png' });
  await page.locator('#mobile-display-settings').tap();
  await expect(page.locator('#mobile-display-help')).toBeVisible();
  await page.locator('#mobile-display-close').tap();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#settings-dialog'))).toBe(true);
  await page.locator('#settings-close').tap();
  const manifest = await (await page.request.get(base + '/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone'); expect(manifest.orientation).toBe('landscape');
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('viewport-fit=cover');
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).not.toContain('user-scalable=no');
  expect((await page.request.get(base + '/table-for-two-180.png')).ok()).toBe(true);
});

test('WebKit phone: live dinner, compact typing viewport, Back and portrait Pause work', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'The Chromium multi-touch test covers this gameplay path in the other engine.');
  page.setDefaultTimeout(8000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const diagnoseGL = process.env.RESTAURANT_GL_DIAGNOSTICS === '1', warnings: string[] = [];
  if (diagnoseGL) {
    await installMobileGLDiagnostics(page);
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) warnings.push(message.text()); });
  }
  const sample = async (tag: string) => {
    if (!diagnoseGL) return;
    const snapshot = await captureMobileGL(page, tag);
    await writeFile(`.qa/restaurant-mobile-webkit-gl-${tag}.png`, Buffer.from(snapshot.image.split(',')[1], 'base64'));
    await writeFile('.qa/mobile-webkit-gl-diagnostics.json', JSON.stringify({ ...(await readMobileGLDiagnostics(page)), warnings }, null, 2));
    expect(snapshot.contextLost, `${tag}: the WebGL context remains available`).toBe(false);
    expect(snapshot.frameDrawCalls, `${tag}: the game still submits draws`).toBeGreaterThan(0);
    expect(snapshot.errors, `${tag}: WebGL calls succeed`).toEqual([]);
    expect(snapshot.framebuffer, `${tag}: final scene reaches the default framebuffer`).toBe(false);
    expect(snapshot.viewport, `${tag}: drawing viewport matches its resized buffer`).toEqual([0, 0, ...snapshot.buffer]);
    expect(new Set(snapshot.pixels.map(pixel => pixel.slice(0, 3).join(','))).size, `${tag}: the scene contains varied RGB pixels`).toBeGreaterThan(8);
    if (snapshot.attributes?.alpha === false) expect(snapshot.alpha.min, `${tag}: an opaque backing context reads alpha255`).toBe(255);
    // Three r187 creates an RGBA context; hair's alpha-to-coverage legitimately leaves fractional edge samples.
    else expect(snapshot.alpha.opaqueSamples, `${tag}: opaque room/background samples remain around coverage edges`).toBeGreaterThan(snapshot.alpha.sampleCount / 2);
  };
  await begin(page);
  await sample('gameplay');
  await settleFrame(page); await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-webkit-gameplay.png' });
  await page.locator('#mobile-talk').tap();
  await expect(page.locator('#conversation-input')).toBeFocused();
  await page.locator('#conversation-input').fill('A hello from my phone.');
  await page.setViewportSize({ width: 844, height: 220 });
  await assertFits(page, ['#conversation-input', '#send-turn', '#mobile-talk-close']);
  await page.waitForTimeout(500);
  await settleFrame(page);
  await sample('typing');
  await writeFile('.qa/mobile-webkit-viewport.json', JSON.stringify(await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.restaurant-canvas')!, app = document.querySelector<HTMLElement>('#restaurant-app')!;
    return { viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport?.width, visualHeight: visualViewport?.height, offsetTop: visualViewport?.offsetTop }, app: app.getBoundingClientRect().toJSON(), canvas: { rect: canvas.getBoundingClientRect().toJSON(), width: canvas.width, height: canvas.height, visibility: getComputedStyle(canvas).visibility, display: getComputedStyle(canvas).display }, state: app.dataset };
  })));
  await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-webkit-typing.png' });
  await page.locator('#mobile-talk-close').tap();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#mobile-controls')).toBeVisible();
  await page.waitForTimeout(500); await settleFrame(page); await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-webkit-restored.png' });
  await sample('restored');
  if (diagnoseGL) await writeFile('.qa/mobile-webkit-gl-diagnostics.json', JSON.stringify({ ...(await readMobileGLDiagnostics(page)), warnings }, null, 2));
  await page.locator('#mobile-talk').tap();
  await expect(page.locator('#conversation-input')).toHaveValue('A hello from my phone.');
  await page.locator('#mobile-talk-close').tap();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mobile-rotate')).toBeVisible();
  await page.locator('#mobile-rotate button').tap();
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await settleFrame(page);
  await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-webkit-portrait-pause.png' });
  expect(errors).toEqual([]);
});
