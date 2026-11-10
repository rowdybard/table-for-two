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
const voicedCaption = 'I like that. I would love to hear what matters to you, the small things you enjoy, and the stories you never get tired of telling.';
const claude: ClaudeAdapter = { async *stream(request) {
  messages.push(request.messages.at(-1)!.content);
  const reply = messages.at(-1)!.includes('caption geometry') ? voicedCaption : 'I like that. What else should I know about you?';
  const turn: SceneTurn = { utterances: [{ speaker: 'date', text: reply, emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'A good first impression.' };
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

async function begin(page: Page, speech = false) {
  await page.addInitScript(speechEnabled => localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: speechEnabled, captions: true, ambience: false })), speech);
  await page.goto(base);
  await page.locator('#title-start').tap();
  await page.locator('#mode-solo').tap();
  await page.locator('[data-date="mira"]').tap();
  const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/date/sessions');
  await page.locator('#start-date').tap();
  const created = await (await createdResponse).json() as { state: DinnerState };
  expect(created.state.seated).toBe(true);
  const date = created.state.participants.find(participant => participant.kind === 'ai')!;
  expect(Math.hypot(date.position[0], date.position[2] + 2.25)).toBeGreaterThan(1);
  await expect(page.locator('#dinner-hud')).toBeVisible();
  await waitForRestaurantScene(page);
  await expect(page.locator('#mobile-controls')).toBeVisible();
  await expect.poll(async () => { const date = (await readState(page)).participants.find(participant => participant.kind === 'ai')!; return Math.hypot(date.position[0], date.position[2] + 2.25); }, { timeout: 20000 }).toBeLessThan(.2);
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

test.describe('Android voiced captions', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' });
  for (const layout of ['landscape', 'portrait', 'compact'] as const) test(`real audio keeps the ${layout} caption readable`, async ({ page }) => {
    test.setTimeout(240_000);
    const sampleRate = 8000, samples = sampleRate * 25, pcm = Buffer.alloc(44 + samples * 2);
    pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8);
    pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
    pcm.writeUInt32LE(sampleRate, 24); pcm.writeUInt32LE(sampleRate * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
    pcm.write('data', 36); pcm.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / sampleRate) * 8000), 44 + i * 2);
    let speechRequests = 0;
    await page.addInitScript(() => {
      const win = window as Window & { __actualVoice?: HTMLMediaElement; __actualVoiceStarted?: boolean };
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        win.__actualVoice = this;
        this.addEventListener('playing', () => { win.__actualVoiceStarted = true; }, { once: true });
        return play.call(this);
      };
    });
    await page.route('**/api/date/status', async route => {
      const response = await route.fetch(), status = await response.json();
      await route.fulfill({ response, json: { ...status, speech: true, speechProvider: 'none' } });
    });
    await page.route('**/api/date/sessions/*/speech', route => {
      speechRequests++;
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: pcm });
    });
    await begin(page, true);
    if (layout !== 'landscape') await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobile-talk').tap();
    await page.locator('#conversation-input').fill('What would you like to know about me? caption geometry');
    await expect(page.locator('#send-turn')).toBeEnabled();
    await page.locator('#send-turn').tap();
    await expect.poll(() => page.evaluate(() => (window as Window & { __actualVoiceStarted?: boolean }).__actualVoiceStarted), { timeout: 20000 }).toBe(true);
    await expect(page.locator('#caption')).toBeVisible();
    await expect(page.locator('#caption-text')).toHaveText(voicedCaption);
    if (layout === 'compact') {
      await page.locator('#mobile-talk').tap();
      await expect(page.locator('#conversation-input')).toBeFocused();
      await page.setViewportSize({ width: 390, height: 440 });
    }
    const verify = async () => {
      await assertFits(page, ['#caption', '#caption-text']);
      expect(await page.evaluate(() => { const audio = (window as Window & { __actualVoice?: HTMLMediaElement }).__actualVoice; return !!audio && !audio.paused && !audio.ended; })).toBe(true);
      const point = await center(page, '#caption-text');
      expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#caption'), point)).toBe(true);
      expect(await page.locator('#caption').evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
      const caption = await page.locator('#caption').boundingBox(), toolbar = await page.locator('.mobile-toolbar').boundingBox();
      if (toolbar) expect(caption!.y + caption!.height).toBeLessThanOrEqual(toolbar.y + 1);
      const form = await page.locator('#conversation-form').boundingBox();
      if (form) expect(caption!.y + caption!.height).toBeLessThanOrEqual(form.y + 1);
    };
    await verify();
    await page.screenshot({ timeout: 30000, path: `.qa/android-voiced-caption-${layout}.png` });
    await verify();
    expect(speechRequests).toBe(1);
  });
});

test('phone: seated conversation, portrait and landscape, touch cancellation and pause', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch cancellation uses Chromium CDP; WebKit has its own gameplay check.');
  page.setDefaultTimeout(8000);
  if (process.env.LFS_SOFTWARE_GPU === '1') test.setTimeout(240_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let pauseRequests = 0, moveRequests = 0;
  page.on('request', request => {
    if (!request.url().includes('/command') || request.method() !== 'POST') return;
    const command = request.postDataJSON();
    if (command.type === 'pause' && command.paused === true) pauseRequests++;
    if (command.type === 'move' || command.type === 'interact') moveRequests++;
  });
  await begin(page);
  expect((await readState(page)).seated).toBe(true);
  await expect(page.locator('#mobile-move')).toBeHidden();
  await expect(page.locator('#mobile-look')).toBeHidden();
  await expect(page.locator('#mobile-interact')).toBeHidden();
  await expect(page.locator('#prompt-line')).toHaveCount(0);
  await expect(page.locator('#menu-dialog')).toHaveCount(0);
  await assertFits(page, ['#mobile-talk', '#mobile-mic', '#mobile-pause']);
  await settleFrame(page); await page.screenshot({ timeout: 30000, path: '.qa/restaurant-mobile-seated.png' });
  const position = (await readState(page)).participants[0].position;
  await page.touchscreen.tap(420, 210);
  await page.waitForTimeout(250);
  expect((await readState(page)).participants[0].position).toEqual(position);
  expect(moveRequests).toBe(0);

  await page.locator('#mobile-talk').tap();
  await expect(page.locator('#conversation-input')).toBeFocused();
  await page.locator('#conversation-input').fill('I wanted to say hello.');
  await page.locator('#mobile-talk-close').tap();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await page.locator('#mobile-talk').tap();
  await expect(page.locator('#conversation-input')).toHaveValue('I wanted to say hello.');
  await page.locator('#send-turn').tap();
  await expect.poll(() => messages.some(text => text.includes('I wanted to say hello.'))).toBe(true);
  await assertCenterHit(page, '#mobile-pause');
  await page.locator('#mobile-pause').tap();
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await page.locator('#resume-date').tap();
  await expect(page.locator('#mobile-controls')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mobile-rotate')).toBeHidden();
  await assertFits(page, ['#mobile-talk', '#mobile-mic', '#mobile-pause']);
  await assertCenterHit(page, '#mobile-pause');
  await settleFrame(page); await page.screenshot({ timeout: 30000, path: '.qa/restaurant-mobile-portrait-seated.png' });
  await page.locator('#mobile-talk').tap();
  await expect(page.locator('#conversation-input')).toBeFocused();
  await page.locator('#mobile-talk-close').tap();
  await expect(page.locator('#mobile-controls')).toBeVisible();

  await page.setViewportSize({ width: 667, height: 320 });
  await assertFits(page, ['#mobile-talk', '#mobile-mic', '#mobile-pause']);
  const pause = await assertCenterHit(page, '#mobile-pause');
  const cdp = await page.context().newCDPSession(page), thumbs = new Thumbs(cdp);
  const pauseRequestsBeforeTap = pauseRequests;
  await thumbs.down(3, pause.x, pause.y); await thumbs.move(3, pause.x + 24, pause.y); await thumbs.up(3);
  await settleFrame(page);
  await expect(page.locator('#pause-dialog')).toBeHidden();
  await page.locator('#mobile-pause').evaluate(button => button.addEventListener('pointerdown', event => { button.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId)); }, { once: true }));
  await thumbs.down(4, pause.x, pause.y);
  await expect(page.locator('#mobile-pause')).toHaveAttribute('data-test-pointer', /^\d+$/);
  const canceledPointer = Number(await page.locator('#mobile-pause').getAttribute('data-test-pointer'));
  await page.locator('#mobile-pause').dispatchEvent('pointercancel', { pointerId: canceledPointer, pointerType: 'touch', isPrimary: true });
  await thumbs.up(4); await settleFrame(page);
  await expect(page.locator('#pause-dialog')).toBeHidden();
  expect(pauseRequests).toBe(pauseRequestsBeforeTap);
  await page.locator('#mobile-pause').tap();
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await expect.poll(() => pauseRequests - pauseRequestsBeforeTap).toBe(1);
  expect(errors).toEqual([]);
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
  await expect(page.locator('#mobile-rotate')).toBeHidden();
  await assertFits(page, ['#mobile-talk', '#mobile-pause']);
  await page.locator('#mobile-pause').tap();
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await settleFrame(page);
  await page.screenshot({ timeout: 30_000, path: '.qa/restaurant-mobile-webkit-portrait-pause.png' });
  expect(errors).toEqual([]);
});
