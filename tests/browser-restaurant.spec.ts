import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { attachRestaurantServer, type ClaudeAdapter } from '../server/restaurant';
import type { ClaudeModel, DinnerState, SceneTurn } from '../src/restaurant/types';
import { captureRestaurantScene, reloadRestaurantScene, waitForRestaurantScene } from './restaurant-browser-helpers';
import { createBlindDate } from '../src/restaurant/blind-date';

let http: Server, app: Awaited<ReturnType<typeof attachRestaurantServer>>, base = '';
const calls: { model: ClaudeModel; text: string }[] = [];
const claude: ClaudeAdapter = { async *stream(request, signal) {
  const content = request.messages.at(-1)!.content;
  calls.push({ model: request.model, text: content });
  yield { type: 'usage', usage: { inputTokens: 1200, outputTokens: 0, cacheReadTokens: 400, cacheWriteTokens: 0 } };
  const turn: SceneTurn = { utterances: [{ speaker: 'date', text: content.includes('mushroom') ? 'Mushroom risotto is a strong choice. What do you like to cook?' : 'You have my attention. Tell me a little more about that.', emotion: 'amused' }, { speaker: 'waiter', text: 'I will give you two another minute.', emotion: 'warm' }], emotion: 'amused', action: 'none', memory: 'The player enjoys mushroom dishes.' };
  const json = JSON.stringify(turn);
  for (let i = 0; i < json.length; i += 25) { if (signal.aborted) return; yield { type: 'text', text: json.slice(i, i + 25) }; await new Promise(resolve => setTimeout(resolve, 5)); }
  yield { type: 'usage', usage: { outputTokens: 100 } };
} };
type DolphinWaitGate = { marker: string; started: boolean; aborted: boolean; lateAttempted: boolean };
let dolphinWaitGate: DolphinWaitGate | undefined;
let dolphinCalls = 0;
const cancelledDolphinLine = 'The cancelled violet comet should never answer.';
const dolphinLlm: ClaudeAdapter = { async *stream(request, signal) {
  dolphinCalls++;
  const content = request.messages.at(-1)!.content, gate = dolphinWaitGate;
  if (!gate || !content.includes(gate.marker)) { yield* claude.stream(request, signal); return; }
  calls.push({ model: request.model, text: content });
  gate.started = true;
  await new Promise<void>(resolve => {
    const aborted = () => { gate.aborted = true; resolve(); };
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
  // Model a provider's final packet racing with cancellation. It must not play.
  gate.lateAttempted = true;
  yield { type: 'text', text: JSON.stringify({ utterances: [{ speaker: 'date', text: cancelledDolphinLine, emotion: 'neutral' }], emotion: 'neutral', action: 'none', memory: 'A cancelled response.' } satisfies SceneTurn) };
} };
const state = (page: Page) => page.evaluate(() => (window as unknown as Window & { __restaurantState: DinnerState }).__restaurantState);
const plantAsset = '/restaurant-props/potted_plant_02.glb';
const surfaceAssets = ['black_walnut_veneer_01', 'white_plaster_02', 'terlenka']
  .flatMap(material => ['albedo.jpg', 'roughness.jpg', 'normal-gl.jpg'].map(map => `/environment-assets/${material}/${map}`));
const licensedAssets = [...surfaceAssets, plantAsset];

async function openSettingsFromPause(page: Page) {
  await page.route('**/api/date/sessions/*/interrupt', async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ response });
  }, { times: 1 });
  // Navigate before the next game frame, then verify that its delayed menu
  // refresh does not steal focus from the control the guest selected.
  await page.evaluate(() => {
    const win = window as typeof window & { __testMenuRaf?: { original: typeof requestAnimationFrame; pending: FrameRequestCallback[] } };
    const original = window.requestAnimationFrame.bind(window), pending: FrameRequestCallback[] = [];
    win.__testMenuRaf = { original, pending };
    window.requestAnimationFrame = callback => { pending.push(callback); return -pending.length; };
  });
  try {
    await page.evaluate(() => new Promise<void>(resolve => {
      const gate = (window as typeof window & { __testMenuRaf: { original: typeof requestAnimationFrame } }).__testMenuRaf;
      gate.original(() => gate.original(() => resolve()));
    }));
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-dialog')).toBeVisible();
    await expect(page.locator('#pause-settings')).toBeDisabled();
    await expect(page.locator('#pause-talk')).toBeDisabled();
    await expect(page.locator('#resume-date')).toBeEnabled();
    await expect(page.locator('#resume-date')).toBeFocused();
    for (const id of ['pause-talk', 'pause-journal', 'pause-settings']) {
      await page.keyboard.press('ArrowDown');
      await expect(page.locator(`#${id}`)).toBeFocused();
    }
  } finally {
    await page.evaluate(() => {
      const win = window as typeof window & { __testMenuRaf?: { original: typeof requestAnimationFrame; pending: FrameRequestCallback[] } };
      const gate = win.__testMenuRaf;
      if (gate) { window.requestAnimationFrame = gate.original; gate.pending.forEach(callback => gate.original(callback)); delete win.__testMenuRaf; }
    });
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('#pause-settings')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-dialog')).toBeVisible();
}

async function closeSettingsToGameplay(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await expect(page.locator('#resume-date')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
}

async function openDeveloperSettings(page: Page) {
  const settings = page.locator('#developer-settings');
  if (!await settings.evaluate((node: HTMLDetailsElement) => node.open)) await settings.locator(':scope > summary').click();
  await expect(settings).toHaveAttribute('open', '');
}

test.beforeAll(async () => {
  const root = resolve('dist');
  http = createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (app.handle(req, res)) return;
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'index.html' : '.' + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    void readFile(file).then(data => { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' } as Record<string, string>)[extname(file)] || 'application/octet-stream'); res.end(data); }).catch(() => res.writeHead(404).end());
  });
  app = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none', DATE_ALLOW_MODEL_SELECTION: '1' }, claude, dolphinLlm, development: true, ledgerPath: false });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  await mkdir('.qa', { recursive: true });
});
test.afterAll(async () => { await app?.close(); http?.closeAllConnections(); await new Promise<void>(resolve => http?.close(() => resolve())); });

test('solo restaurant: roster, real movement, seat, order, streamed cast, private model command, pause and ending', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(8000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const environmentResponses = new Map<string, number>();
  const environmentRequests = new Set<string>();
  page.on('request', request => { const path = new URL(request.url()).pathname; if (licensedAssets.includes(path)) environmentRequests.add(path); });
  page.on('response', response => { const path = new URL(response.url()).pathname; if (licensedAssets.includes(path)) environmentResponses.set(path, response.status()); });
  // The existing opt-in diagnostic reports the actual chosen tier, including software WebGL.
  await page.goto(base + '/?stats');
  await expect(page.locator('#arrival-title')).toBeVisible();
  await expect(page.locator('#arrival-title')).not.toHaveText('');
  await expect(page.locator('#restaurant-app')).toHaveAttribute('data-input-mode', 'title');
  await expect(page.locator('#title-start')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#arrival-screen')).toHaveAttribute('data-screen', 'mode');
  await expect(page.locator('#mode-solo')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#mode-double')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#mode-solo')).toBeFocused();
  await page.keyboard.down('Enter');
  await expect(page.locator('#arrival-screen')).toHaveAttribute('data-screen', 'select');
  await page.keyboard.down('Enter');
  await expect(page.locator('#arrival-screen')).toBeVisible();
  await expect(page.locator('#dinner-hud')).toBeHidden();
  await page.keyboard.up('Enter');
  await expect(page.locator('[data-date]')).toHaveCount(3);
  await expect(page.locator('[data-date="mira"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-date="jules"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.date-card.selected')).toHaveAttribute('data-date', 'jules');
  await expect(page.locator('.selection-stage-label strong')).toHaveText('Jules');
  await expect(page.locator('#perf-stats')).toContainText(/\b(?:high|low) tier\b/, { timeout: 15000 });
  const tier = /\b(high|low) tier\b/.exec(await page.locator('#perf-stats').innerText())![1];
  const expectedAssets = tier === 'high' ? licensedAssets : surfaceAssets;
  await expect.poll(() => expectedAssets.filter(path => !environmentResponses.has(path)), { timeout: 15000 }).toEqual([]);
  expect(expectedAssets.map(path => environmentResponses.get(path))).toEqual(expectedAssets.map(() => 200));
  if (tier === 'low') expect(environmentRequests.has(plantAsset)).toBe(false);
  await captureRestaurantScene(page, '.qa/restaurant-arrival.png');
  await page.keyboard.press('Enter');
  await expect(page.locator('#arrival-screen')).toBeHidden();
  await expect.poll(async () => (await state(page)).participants.map(p => p.kind).join(',')).toBe('human,ai');
  expect((await state(page)).dateId).toBe('jules');
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect(page.locator('#type-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('t');
  await expect(page.locator('#conversation-input')).toBeFocused();
  await page.locator('#conversation-input').fill('A thought I want to keep.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect(page.locator('#pause-dialog')).toBeHidden();
  expect((await state(page)).phase).toBe('playing');
  await page.keyboard.press('t');
  await expect(page.locator('#conversation-input')).toBeFocused();
  await expect(page.locator('#conversation-input')).toHaveValue('A thought I want to keep.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await expect(page.locator('#journal')).toBeVisible();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect(page.locator('#conversation-input')).toHaveValue('A thought I want to keep.');
  await page.locator('#journal-close').click(); await page.keyboard.press('t');
  await expect(page.locator('#conversation-input')).toBeFocused();
  const callsBeforeWhitespace = calls.length;
  await page.locator('#conversation-input').fill('   '); await page.locator('#send-turn').click();
  await expect(page.locator('#conversation-form')).toBeVisible(); expect(calls.length).toBe(callsBeforeWhitespace);
  await page.locator('#conversation-input').focus();
  const typingPosition = (await state(page)).participants[0].position;
  await page.keyboard.press('w'); await page.waitForTimeout(200);
  expect((await state(page)).participants[0].position).toEqual(typingPosition);
  await page.locator('#conversation-input').fill('I like mushroom pasta.');
  await page.locator('#send-turn').click();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect(page.locator('#type-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('j');
  await expect(page.locator('#conversation-log')).toContainText('What do you like to cook?');
  await expect(page.locator('#conversation-log')).toContainText('I will give you two another minute.');
  await page.locator('#journal-close').click();
  await waitForRestaurantScene(page);
  const before = (await state(page)).participants[0].position[2];
  await page.locator('#conversation-input').blur();
  // Hold animation callbacks to verify keyboard movement and release do not
  // depend on another rendered frame, then restore all queued callbacks.
  const movementResponse = (moving: boolean) => page.waitForResponse(response => {
    const request = response.request();
    if (request.method() !== 'POST' || !new URL(request.url()).pathname.endsWith('/command')) return false;
    const command = request.postDataJSON();
    return command.type === 'move' && (Math.hypot(command.x, command.z) > 0) === moving;
  }, { timeout: 15000 });
  await page.evaluate(() => {
    const win = window as typeof window & { __testRafGate?: { original: typeof requestAnimationFrame; pending: FrameRequestCallback[] } };
    const original = window.requestAnimationFrame.bind(window), pending: FrameRequestCallback[] = [];
    win.__testRafGate = { original, pending };
    window.requestAnimationFrame = callback => { pending.push(callback); return -pending.length; };
  });
  try {
    // Let any frame already queued before interception finish; new frames stay held.
    await page.evaluate(() => new Promise<void>(resolve => {
      const gate = (window as typeof window & { __testRafGate: { original: typeof requestAnimationFrame } }).__testRafGate;
      gate.original(() => gate.original(() => resolve()));
    }));
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __testRafGate?: { pending: FrameRequestCallback[] } }).__testRafGate!.pending.length), { timeout: 15000 }).toBeGreaterThan(0);
    const start = movementResponse(true);
    await page.keyboard.down('w');
    expect((await start).status()).toBe(200);
    const stop = movementResponse(false);
    await page.keyboard.up('w');
    expect((await stop).status()).toBe(200);
  } finally {
    await page.keyboard.up('w');
    await page.evaluate(() => {
      const win = window as typeof window & { __testRafGate?: { original: typeof requestAnimationFrame; pending: FrameRequestCallback[] } };
      const gate = win.__testRafGate;
      if (gate) { window.requestAnimationFrame = gate.original; gate.pending.forEach(callback => gate.original(callback)); delete win.__testRafGate; }
    });
  }
  // Aim at the real chair, walk to its interaction, and sit before releasing W.
  await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(640, 610, { steps: 8 }); await page.mouse.up();
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => (await state(page)).participants[0].position[2], { timeout: 15000 }).toBeLessThan(before - 2);
    await expect(page.locator('#interaction').filter({ hasText: /seat/i })).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('e');
  } finally { await page.keyboard.up('w'); }
  await expect.poll(async () => (await state(page)).seated).toBe(true);
  await expect.poll(async () => {
    const date = (await state(page)).participants.find(participant => participant.kind === 'ai')!;
    return Math.hypot(date.position[0], date.position[2] + 2.25);
  }, { timeout: 12_000 }).toBeLessThan(.2);
  await page.waitForTimeout(400);
  await captureRestaurantScene(page, '.qa/restaurant-seated.png');
  // The prompt line offers the menu; its numbered chip works under pointer lock, where no mouse can reach a button.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await expect(page.locator('#prompt-copy')).toHaveText('Look over the menu whenever you’re ready.');
  const menuChip = page.locator('#prompt-chips button', { hasText: 'Open the menu' });
  await expect(menuChip).toBeVisible();
  await expect(menuChip.locator('kbd')).toHaveText('1');
  await page.locator('.restaurant-canvas').click({ position: { x: 850, y: 350 } });
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await page.keyboard.press('1');
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'Reading the dinner menu at the table');
  await expect.poll(async () => (await state(page)).phase).toBe('paused');
  // A held Escape closes the menu once and never falls through into a pause.
  await page.keyboard.down('Escape');
  await expect(page.locator('#menu-dialog')).toBeHidden();
  await page.keyboard.down('Escape');
  await expect(page.locator('#pause-dialog')).toBeHidden();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await page.keyboard.up('Escape');
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'First-person view of Table for Two restaurant');
  // Deliberately hold the second menu's pause: ordering immediately must wait for
  // the pause before resuming and submitting the order, even on a slow connection.
  let releaseMenuPause!: () => void, pauseHeld = false;
  const menuPauseReleased = new Promise<void>(resolve => { releaseMenuPause = resolve; });
  const menuCommands: string[] = [];
  const holdMenuPause = async (route: Route) => {
    const command = route.request().postDataJSON();
    if (command.type === 'pause') {
      menuCommands.push(command.paused ? 'pause' : 'resume');
      if (command.paused) { pauseHeld = true; await menuPauseReleased; }
    } else if (command.type === 'interact' && command.target === 'menu') menuCommands.push('order');
    await route.continue();
  };
  const commandRoute = '**/api/date/sessions/*/command';
  await page.route(commandRoute, holdMenuPause);
  try {
    await menuChip.click();
    await expect(page.locator('#menu-dialog')).toBeVisible();
    await expect.poll(() => pauseHeld).toBe(true);
    await page.locator('[data-order="Wild mushroom risotto"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-order="Wild mushroom risotto"]')).toBeDisabled();
    expect(menuCommands).toEqual(['pause']);
    releaseMenuPause();
    await expect.poll(async () => (await state(page)).order).toBe('Wild mushroom risotto');
    expect(menuCommands).toEqual(['pause', 'resume', 'order']);
  } finally {
    releaseMenuPause();
    await page.unroute(commandRoute, holdMenuPause);
  }
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'First-person view of Table for Two restaurant');

  // Exercise the settings handler while playing. The visible settings entry is
  // normally under Pause, so invoke the same button handler directly here.
  let releaseSettingsPause!: () => void, settingsPauseHeld = false;
  const settingsPauseReleased = new Promise<void>(resolve => { releaseSettingsPause = resolve; });
  const settingsCommands: string[] = [];
  const holdSettingsPause = async (route: Route) => {
    const command = route.request().postDataJSON();
    if (command.type === 'pause') {
      settingsCommands.push(command.paused ? 'pause' : 'resume');
      if (command.paused) { settingsPauseHeld = true; await settingsPauseReleased; }
    }
    await route.continue();
  };
  await page.route(commandRoute, holdSettingsPause);
  try {
    await page.locator('#settings-open').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect.poll(() => settingsPauseHeld).toBe(true);
    await page.locator('#settings-close').click();
    await expect(page.locator('#settings-close')).toBeDisabled();
    expect(settingsCommands).toEqual(['pause']);
    releaseSettingsPause();
    await expect(page.locator('#settings-dialog')).toBeHidden();
    await expect.poll(async () => (await state(page)).phase).toBe('playing');
    expect(settingsCommands).toEqual(['pause', 'resume']);
  } finally {
    releaseSettingsPause();
    await page.unroute(commandRoute, holdSettingsPause);
  }

  await openSettingsFromPause(page);
  await expect(page.locator('#model-select')).toHaveCount(0);
  await page.screenshot({ path: '.qa/restaurant-settings-no-model-picker.png' });
  const volume = page.locator('#voice-volume');
  await volume.focus(); await page.keyboard.press('ArrowLeft');
  await expect(volume).toHaveValue('0.75'); await expect(volume).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(volume).toHaveValue('0.8');
  await openDeveloperSettings(page);
  await expect(page.locator('#model-select')).toHaveCount(0);
  await page.screenshot({ path: '.qa/restaurant-settings-limits-only.png' });
  await page.locator('#settings-save').click();
  await expect(page.locator('#settings-saved')).toContainText('Saved');
  await closeSettingsToGameplay(page);
  const beforeModelCommand = calls.length;
  await modelCommand(page, '/model sonnet');
  await expect(page.locator('#toast')).toHaveText('Sonnet selected for the next turn.');
  expect(calls.length).toBe(beforeModelCommand);
  expect((await state(page)).usage.claudeRequests).toBe(1);
  await expect(page.locator('#conversation-log')).not.toContainText('/model');
  await page.keyboard.press('t');
  await expect(page.locator('#conversation-input')).toBeFocused();
  await page.locator('#conversation-input').fill('What is your favorite place to travel?'); await page.locator('#send-turn').click();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect.poll(() => calls.at(-1)?.model).toBe('claude-sonnet-5-5');
  await expect.poll(async () => (await state(page)).usage.claudeRequests).toBe(2);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).phase).toBe('paused');
  const frozen = (await state(page)).elapsed;
  await page.waitForTimeout(300);
  expect((await state(page)).elapsed).toBeCloseTo(frozen, 1);
  await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await reloadRestaurantScene(page);
  await expect(page.locator('#pause-dialog')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#dinner-hud')).toBeHidden();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await expect(page.locator('#dinner-hud')).toBeVisible();
  await modelCommand(page, '/model');
  await expect(page.locator('#toast')).toHaveText('Conversation model: Sonnet.');
  expect(calls.length).toBe(beforeModelCommand + 1);
  await expect(page.locator('#model-select')).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.locator('#finish-date').click();
  await expect(page.locator('#ending-screen')).toBeVisible();
  await captureRestaurantScene(page, '.qa/restaurant-ending.png');
  expect(errors).toEqual([]);
});

test('small desktop layout and an early exit need no second client or provider keys', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(base);
  await page.locator('#title-start').click(); await page.locator('#mode-solo').click();
  await page.locator('[data-date="dev"]').click(); await page.locator('#start-date').click();
  await expect(page.locator('#dinner-hud')).toBeVisible();
  await captureRestaurantScene(page, '.qa/restaurant-small.png');
  await page.keyboard.press('Escape'); await page.locator('#finish-date').click();
  await expect(page.locator('#ending-screen')).toBeVisible();
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
});

test('menus and rapid date changes stay usable during warmup, including disposal for a different blind match', async ({ page }) => {
  test.setTimeout(90000); page.setDefaultTimeout(15000);
  const errors: string[] = [], inputCommands: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/Restaurant shader warmup failed|THREE\.WebGLProgram|INVALID_OPERATION|shader error/i.test(message.text())) errors.push(message.text());
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/command') && request.method() === 'POST') {
      const command = request.postDataJSON();
      if (command.type === 'move' || command.type === 'interact') inputCommands.push(command.type);
    }
  });
  let releaseAssets!: () => void, heldRequests = 0;
  const assetsReleased = new Promise<void>(resolve => { releaseAssets = resolve; });
  await page.route('**/environment-assets/black_walnut_veneer_01/albedo.jpg*', async route => {
    heldRequests++; await assetsReleased; await route.continue().catch(() => {});
  });
  const seed = Array.from({ length: 32 }, (_, index) => `warmup-disposal-${index}`).find(value => createBlindDate(value).dateId !== 'dev')!;
  const expected = createBlindDate(seed);
  await page.route('**/api/date/sessions', async route => {
    const body = route.request().postDataJSON();
    await route.continue(body.mode === 'blind-date' ? { postData: JSON.stringify({ ...body, seed }) } : {});
  });
  const callsBeforeWarmup = calls.length;
  async function expectWarmupState() {
    const parallel = await page.locator('.restaurant-canvas').evaluate(canvas => !!(canvas as HTMLCanvasElement).getContext('webgl2')?.getExtension('KHR_parallel_shader_compile'));
    if (parallel) {
      await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('#scene-loading')).toBeVisible();
    } else {
      // The existing serial fallback renders normally instead of awaiting assets in compileAsync.
      await waitForRestaurantScene(page);
    }
    return parallel;
  }
  try {
    await page.goto(base);
    await expect(page.locator('#title-start')).toBeFocused({ timeout: 15000 });
    await page.keyboard.press('Enter'); await expect(page.locator('#mode-menu')).toBeVisible();
    await page.locator('#mode-solo').click();
    await expect.poll(() => heldRequests).toBeGreaterThan(0);
    await expectWarmupState();
    for (const dateId of ['jules','mira','dev']) await page.locator(`[data-date="${dateId}"]`).click();
    await expect(page.locator('[data-date="dev"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.selection-stage-label strong')).toHaveText('Dev');
    const previousCanvas = await page.locator('.restaurant-canvas').elementHandle();
    await page.locator('#select-back').click(); await page.locator('#mode-blind').click();
    await expect(page.locator('#dinner-hud')).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await state(page)).mode).toBe('blind-date');
    expect((await state(page)).dateId).toBe(expected.dateId); expect(expected.dateId).not.toBe('dev');
    expect(await previousCanvas!.evaluate(canvas => canvas.isConnected)).toBe(false);
    await expect(page.locator('.restaurant-canvas')).toHaveCount(1);
    if (await expectWarmupState()) {
      const before = (await state(page)).participants[0].position;
      await page.keyboard.down('w'); await page.keyboard.press('e');
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.keyboard.up('w');
      (await state(page)).participants[0].position.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(before[index], 5));
    }
    expect(inputCommands).toEqual([]);
    releaseAssets();
    await waitForRestaurantScene(page);
    expect((await state(page)).dateId).toBe(expected.dateId);
    await captureRestaurantScene(page, '.qa/restaurant-warmup-rebuilt.png');
    const startZ = (await state(page)).participants[0].position[2];
    await page.keyboard.down('w');
    try { await expect.poll(async () => (await state(page)).participants[0].position[2]).toBeLessThan(startZ - .2); }
    finally { await page.keyboard.up('w'); }
    expect(inputCommands).toContain('move'); expect(calls.length).toBe(callsBeforeWarmup); expect(errors).toEqual([]);
  } finally { releaseAssets(); }
});

async function beginNewSolo(page: Page) {
  page.setDefaultTimeout(12000);
  await page.goto(base);
  await expect(page.locator('#restaurant-app')).toHaveAttribute('data-input-mode', 'title', { timeout: 12000 });
  await expect(page.locator('#title-start')).toBeFocused();
  await page.locator('#title-start').click();
  await page.locator('#mode-solo').click();
  await page.locator('#start-date').click();
  await expect(page.locator('#dinner-hud')).toBeVisible();
  await waitForRestaurantScene(page);
}

async function modelCommand(page: Page, text: string) {
  if (!await page.locator('#conversation-form').isVisible()) await page.keyboard.press('t');
  await expect(page.locator('#conversation-input')).toBeFocused();
  await page.locator('#conversation-input').fill(text);
  await page.locator('#send-turn').click();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect(page.locator('#conversation-input')).toHaveValue('');
}

test('Haiku is the default, private model commands survive reload and reset restores the same evening', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    if (!/^https?:$/.test(location.protocol) || sessionStorage.getItem('test-model-migration-seeded')) return;
    localStorage.setItem('table-for-two-settings', JSON.stringify({ model: 'claude-sonnet-5-5', speech: false, ambience: false }));
    sessionStorage.setItem('test-model-migration-seeded', 'true');
  });
  const turnPosts: { text: string; model: ClaudeModel; via?: string }[] = [], sessionModels: ClaudeModel[] = [], resetPosts: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/date/sessions') sessionModels.push(request.postDataJSON().model);
    if (/^\/api\/date\/sessions\/[^/]+\/turn$/.test(path)) turnPosts.push(request.postDataJSON());
    if (/^\/api\/date\/sessions\/[^/]+\/reset-model$/.test(path)) resetPosts.push(path);
  });
  const before = calls.length;
  await beginNewSolo(page);
  await expect(page.locator('#model-select')).toHaveCount(0);
  expect(sessionModels).toEqual(['claude-haiku-5-5']);
  await modelCommand(page, '/model');
  await expect(page.locator('#toast')).toHaveText('Conversation model: Haiku.');
  await modelCommand(page, '/model nonexistent');
  await expect(page.locator('#toast')).toHaveText('That model command is not valid.');
  await modelCommand(page, '/model horde');
  await expect(page.locator('#toast')).toHaveText('That model command is not valid.');
  await modelCommand(page, '/model ai-horde');
  await expect(page.locator('#toast')).toHaveText('That model command is not valid.');
  expect(turnPosts).toEqual([]); expect(calls.length).toBe(before);
  expect((await state(page)).usage.claudeRequests).toBe(0);

  const speak = async (text: string, model: ClaudeModel, completed: number) => {
    await page.keyboard.press('t');
    await page.locator('#conversation-input').fill(text);
    await page.locator('#send-turn').click();
    await expect.poll(() => calls.length).toBe(before + completed);
    expect(calls.at(-1)!.model).toBe(model);
    await expect.poll(async () => (await state(page)).usage.outputTokens).toBe(completed * 100);
    await expect(page.locator('#send-turn')).toBeEnabled();
  };
  await speak('A first evening together.', 'claude-haiku-5-5', 1);
  await modelCommand(page, '/model sonnet');
  await expect(page.locator('#toast')).toHaveText('Sonnet selected for the next turn.');
  expect(calls.length).toBe(before + 1); expect(turnPosts).toHaveLength(1);
  expect((await state(page)).usage.claudeRequests).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('table-for-two-settings')!))).toMatchObject({ model: 'claude-sonnet-5-5', modelSource: 'chat-command' });
  await speak('Where would you travel next?', 'claude-sonnet-5-5', 2);

  await reloadRestaurantScene(page);
  await expect(page.locator('#pause-dialog')).toBeVisible({ timeout: 15000 });
  await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await waitForRestaurantScene(page);
  await modelCommand(page, '/model');
  await expect(page.locator('#toast')).toHaveText('Conversation model: Sonnet.');
  expect(calls.length).toBe(before + 2); expect(turnPosts).toHaveLength(2);
  await speak('What would make tonight memorable?', 'claude-sonnet-5-5', 3);
  await modelCommand(page, '/model haiku');
  await expect(page.locator('#toast')).toHaveText('Haiku selected for the next turn.');
  expect(calls.length).toBe(before + 3); expect(turnPosts).toHaveLength(3);
  await speak('Let us keep talking.', 'claude-haiku-5-5', 4);
  expect(turnPosts.map(turn => turn.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  // Every one of these was typed, and the client says so (spoken turns say "voice"). Added with the turn-provenance work; not run in the authoring environment.
  expect(turnPosts.map(turn => turn.via)).toEqual(['typed', 'typed', 'typed', 'typed']);
  const directBefore = dolphinCalls;
  await modelCommand(page, '/model dolphin');
  await expect(page.locator('#toast')).toHaveText('Dolphin selected for the next turn.');
  expect(calls.length).toBe(before + 4);
  await modelCommand(page, '/model');
  await expect(page.locator('#toast')).toHaveText('Conversation model: Dolphin (next turn).');
  await speak('Tell me what makes a first date feel exciting.', 'dolphinllm/uncensored', 5);
  expect(dolphinCalls).toBe(directBefore + 1);
  await reloadRestaurantScene(page);
  await expect(page.locator('#pause-dialog')).toBeVisible({ timeout: 15000 });
  await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await waitForRestaurantScene(page);
  await modelCommand(page, '/model');
  await expect(page.locator('#toast')).toHaveText('Conversation model: Dolphin.');
  await speak('I like a little playful confidence.', 'dolphinllm/uncensored', 6);
  expect(dolphinCalls).toBe(directBefore + 2);
  expect(turnPosts.slice(-2).map(turn => turn.model)).toEqual(['dolphinllm/uncensored', 'dolphinllm/uncensored']);

  const beforeReset = await state(page);
  const savedSession = await page.evaluate(() => JSON.parse(sessionStorage.getItem('table-for-two-session')!));
  await modelCommand(page, '/model reset');
  await expect(page.locator('#toast')).toHaveText('Conversation reset to Haiku. Keep playing.');
  expect(resetPosts).toEqual([`/api/date/sessions/${beforeReset.id}/reset-model`]);
  expect(calls.length).toBe(before + 6);
  const resetPreferences = await page.evaluate(() => JSON.parse(localStorage.getItem('table-for-two-settings')!));
  expect(resetPreferences.model).toBe('claude-haiku-5-5');
  expect(resetPreferences).not.toHaveProperty('modelSource');
  const afterReset = await state(page);
  expect(afterReset).toMatchObject({ id: beforeReset.id, dateId: beforeReset.dateId, phase: 'playing', order: beforeReset.order, memory: beforeReset.memory, conversationModel: 'claude-haiku-5-5' });
  expect(afterReset.evening).toMatchObject({ chapter: beforeReset.evening.chapter, variation: beforeReset.evening.variation, dialogueTurns: beforeReset.evening.dialogueTurns });
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('table-for-two-session')!))).toMatchObject({ id: savedSession.id, token: savedSession.token });
  await modelCommand(page, '/model');
  await expect(page.locator('#toast')).toHaveText('Conversation model: Haiku.');
  await speak('Let us enjoy the rest of our evening.', 'claude-haiku-5-5', 7);

  await reloadRestaurantScene(page);
  await expect(page.locator('#pause-dialog')).toBeVisible({ timeout: 15000 });
  await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await waitForRestaurantScene(page);
  expect((await state(page)).id).toBe(beforeReset.id);
  expect(sessionModels).toEqual(['claude-haiku-5-5']);
  await modelCommand(page, '/model');
  await expect(page.locator('#toast')).toHaveText('Conversation model: Haiku.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('table-for-two-settings')!))).not.toHaveProperty('modelSource');
  await speak('What should we talk about next?', 'claude-haiku-5-5', 8);
  expect(turnPosts.slice(-2).map(turn => turn.model)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
  expect(turnPosts.every(turn => !turn.text.startsWith('/model'))).toBe(true);
  expect(calls.slice(before).every(call => !call.text.includes('/model'))).toBe(true);
  await expect(page.locator('#conversation-log')).not.toContainText('/model');
  await expect(page.locator('#caption-text')).not.toContainText('/model');
  await expect(page.locator('#model-select')).toHaveCount(0);
});

test('model reset cancels a waiting Dolphin turn and keeps the same date playable on Haiku', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: false, ambience: false }));
  });
  const gate: DolphinWaitGate = { marker: 'A fictional violet comet waits at platform nine.', started: false, aborted: false, lateAttempted: false };
  const turnPosts: { text: string; model: ClaudeModel }[] = [], playbackTexts: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (/^\/api\/date\/sessions\/[^/]+\/turn$/.test(path)) turnPosts.push(request.postDataJSON());
    if (/^\/api\/date\/sessions\/[^/]+\/(speech|playback)$/.test(path)) {
      const data = request.postDataJSON(); playbackTexts.push(data.text ?? data.utterance?.text ?? '');
    }
  });
  dolphinWaitGate = gate;
  try {
    await beginNewSolo(page);
    const before = await state(page), callsBefore = calls.length;
    await modelCommand(page, '/model dolphin');
    await expect(page.locator('#toast')).toHaveText('Dolphin selected for the next turn.');
    await page.keyboard.press('t');
    await page.locator('#conversation-input').fill(gate.marker);
    await page.locator('#send-turn').click();
    await expect.poll(() => gate.started).toBe(true);
    expect(calls.at(-1)?.model).toBe('dolphinllm/uncensored');
    await expect(page.locator('#conversation-form')).toBeHidden();

    // Ordinary turns stay disabled while this request is pending; reset can escape it.
    await page.keyboard.press('t');
    await page.locator('#conversation-input').fill('An ordinary second thought.');
    await expect(page.locator('#send-turn')).toBeDisabled();
    await page.locator('#conversation-input').fill('/model reset');
    await expect(page.locator('#send-turn')).toBeEnabled();
    await page.locator('#send-turn').click();
    await expect(page.locator('#conversation-form')).toBeHidden();
    await expect(page.locator('#toast')).toHaveText('Conversation reset to Haiku. Keep playing.');
    await expect.poll(() => gate.aborted && gate.lateAttempted).toBe(true);
    expect((await state(page))).toMatchObject({ id: before.id, dateId: before.dateId, phase: 'playing', conversationModel: 'claude-haiku-5-5' });
    expect((await state(page)).evening.dialogueTurns).toBe(before.evening.dialogueTurns);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('table-for-two-settings')!))).not.toHaveProperty('modelSource');
    await expect(page.locator('#conversation-input')).toHaveValue('');
    await expect(page.locator('#caption')).toBeHidden();
    await expect(page.locator('#conversation-log')).not.toContainText(cancelledDolphinLine);
    await expect(page.locator('#caption-text')).not.toContainText(cancelledDolphinLine);
    await page.screenshot({ path: '.qa/restaurant-model-reset-cancelled-dolphin.png' });

    await modelCommand(page, '/model');
    await expect(page.locator('#toast')).toHaveText('Conversation model: Haiku.');
    await page.keyboard.press('t');
    await page.locator('#conversation-input').fill('I would like mushroom risotto tonight.');
    await page.locator('#send-turn').click();
    await expect.poll(() => calls.length).toBe(callsBefore + 2);
    expect(calls.at(-1)?.model).toBe('claude-haiku-5-5');
    await expect(page.locator('#conversation-log')).toContainText('What do you like to cook?');
    await expect.poll(async () => (await state(page)).usage.outputTokens).toBe(100);
    await expect(page.locator('#send-turn')).toBeEnabled();
    expect(turnPosts.map(turn => turn.model)).toEqual(['dolphinllm/uncensored', 'claude-haiku-5-5']);
    expect(playbackTexts).not.toContain(cancelledDolphinLine);
    await expect(page.locator('#conversation-log')).not.toContainText(cancelledDolphinLine);
    await expect(page.locator('#caption-text')).not.toContainText(cancelledDolphinLine);
  } finally { dolphinWaitGate = undefined; }
});

test('model reset discards an ordinary turn still waiting for interruption before submission', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: false, ambience: false }));
  });
  const turnPosts: { text: string; model: ClaudeModel }[] = [], resetPosts: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (/^\/api\/date\/sessions\/[^/]+\/turn$/.test(path)) turnPosts.push(request.postDataJSON());
    if (/^\/api\/date\/sessions\/[^/]+\/reset-model$/.test(path)) resetPosts.push(path);
  });
  await beginNewSolo(page);
  const session = await state(page), callsBefore = calls.length;
  await page.keyboard.press('t');
  await page.locator('#conversation-input').fill('The mushroom risotto sounds lovely.');
  await page.locator('#send-turn').click();
  await expect.poll(async () => (await state(page)).usage.outputTokens).toBe(100);
  await expect(page.locator('#caption')).toBeVisible();
  await expect(page.locator('#caption-text')).toContainText('What do you like to cook?');

  let interruptionStarted = false, releaseInterruption!: () => void;
  const interruptionGate = new Promise<void>(resolve => { releaseInterruption = resolve; });
  await page.route('**/api/date/sessions/*/interrupt', async route => {
    const response = await route.fetch();
    interruptionStarted = true;
    await interruptionGate;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.keyboard.press('t');
    await page.locator('#conversation-input').fill('A fictional silver tram is waiting beside the moon.');
    await page.locator('#send-turn').click();
    await expect.poll(() => interruptionStarted).toBe(true);
    expect(turnPosts).toHaveLength(1);

    await page.keyboard.press('t');
    await page.locator('#conversation-input').fill('/model reset');
    await expect(page.locator('#send-turn')).toBeEnabled();
    // Submit the chat command before the bounded interruption wait expires.
    // Waiting for two slow mouse-actionability frames would test a later reset instead.
    await page.locator('#conversation-input').press('Enter');
    await expect(page.locator('#conversation-form')).toBeHidden();
    expect(resetPosts).toEqual([]);
    releaseInterruption();
    await expect(page.locator('#toast')).toHaveText('Conversation reset to Haiku. Keep playing.');
    expect(resetPosts).toEqual([`/api/date/sessions/${session.id}/reset-model`]);
    expect(turnPosts).toHaveLength(1);
    expect(calls.length).toBe(callsBefore + 1);
    expect((await state(page))).toMatchObject({ id: session.id, phase: 'playing', conversationModel: 'claude-haiku-5-5' });
    await expect(page.locator('#conversation-input')).toHaveValue('');
    await expect(page.locator('#conversation-log')).not.toContainText('A fictional silver tram');

    await page.keyboard.press('t');
    await page.locator('#conversation-input').fill('What else do you enjoy cooking?');
    await page.locator('#send-turn').click();
    await expect.poll(async () => (await state(page)).usage.outputTokens).toBe(200);
    expect(turnPosts.map(turn => turn.text)).toEqual(['The mushroom risotto sounds lovely.', 'What else do you enjoy cooking?']);
    expect(calls.length).toBe(callsBefore + 2);
    expect(calls.at(-1)?.model).toBe('claude-haiku-5-5');
    await expect(page.locator('#send-turn')).toBeEnabled();
  } finally { releaseInterruption(); }
});

async function takeNewcomerSeat(page: Page) {
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height * .48);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2, viewport.height * .74, { steps: 9 });
  await page.mouse.up();
  await page.keyboard.down('w');
  try {
    await expect(page.locator('#interaction').filter({ hasText: /seat/i })).toBeVisible({ timeout: 20000 });
    await page.keyboard.press('e');
  } finally { await page.keyboard.up('w'); }
  await expect.poll(async () => (await state(page)).seated).toBe(true);
}

test('unavailable audio never traps a newcomer at start, typed conversation or Resume', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: false, ambience: false }));
    window.AudioContext = new Proxy(window.AudioContext, { construct() { throw new DOMException('Audio is unavailable on this test device.', 'NotSupportedError'); } });
  });
  await beginNewSolo(page);
  expect((await state(page)).phase).toBe('playing');
  await page.keyboard.press('t');
  await page.locator('#conversation-input').fill('I enjoy mushroom pasta.');
  await page.locator('#send-turn').click();
  await expect(page.locator('#conversation-log')).toContainText('What do you like to cook?');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await expect(page.locator('#resume-date')).toBeEnabled();
  await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await expect(page.locator('#pause-dialog')).toBeHidden();
  expect(errors).toEqual([]);
});

test('failed typed turns keep the player draft and rejected orders never become transcript facts', async ({ page }) => {
  test.setTimeout(120000);
  await beginNewSolo(page);
  const draft = 'I like mushroom pasta, but I have another question.';
  let rejectedTurn = false, rejectedOrder = false;
  await page.route('**/api/date/sessions/*/turn', route => {
    if (!rejectedTurn) { rejectedTurn = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The conversation service is taking a break. Please try again.' }) }); }
    return route.continue();
  });
  await page.keyboard.press('t');
  await page.locator('#conversation-input').fill(draft);
  await page.locator('#send-turn').click();
  await expect(page.locator('#toast')).toContainText(/try again/i);
  await expect(page.locator('#conversation-input')).toHaveValue(draft);
  if (!await page.locator('#conversation-form').isVisible()) await page.keyboard.press('t');
  await page.locator('#send-turn').click();
  await expect(page.locator('#conversation-log')).toContainText('What do you like to cook?');
  await expect(page.locator('#conversation-input')).toHaveValue('');
  await takeNewcomerSeat(page);
  await page.route('**/api/date/sessions/*/command', route => {
    const body = route.request().postDataJSON();
    if (!rejectedOrder && body.type === 'interact' && body.target === 'menu' && body.choice) {
      rejectedOrder = true;
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'The waiter needs another moment before taking that order.' }) });
    }
    return route.continue();
  });
  await page.locator('#prompt-chips button', { hasText: 'Open the menu' }).click();
  const dish = await page.locator('[data-order]').first().getAttribute('data-order');
  await page.locator('[data-order]').first().click();
  await expect(page.locator('#toast')).toContainText('another moment');
  expect((await state(page)).order).toBeNull();
  await expect(page.locator('#conversation-log')).not.toContainText(`You ordered ${dish}.`);
  if (!await page.locator('#menu-dialog').isVisible()) await page.locator('#prompt-chips button', { hasText: 'Open the menu' }).click();
  await page.locator('[data-order]').first().click();
  await expect.poll(async () => (await state(page)).order).toBe(dish);
  await expect(page.locator('#conversation-log')).toContainText(`You ordered ${dish}.`);
});

test('a persisted page departure returns to the same usable paused dinner', async ({ page }) => {
  test.setTimeout(90000);
  await beginNewSolo(page);
  const sessionId = (await state(page)).id;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#pause-dialog')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => (await state(page)).id).toBe(sessionId);
  await expect(page.locator('#resume-date')).toBeEnabled();
  await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await waitForRestaurantScene(page);
  const initialZ = (await state(page)).participants[0].position[2];
  await page.keyboard.down('w');
  try { await expect.poll(async () => (await state(page)).participants[0].position[2]).toBeLessThan(initialZ - .25); }
  finally { await page.keyboard.up('w'); }
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-dialog')).toBeVisible();
});

test('pending starts and rejected resumes keep a single coherent newcomer flow', async ({ page }) => {
  test.setTimeout(90000); page.setDefaultTimeout(12000);
  let release!: () => void, requests = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/date/sessions', async route => { requests++; await held; await route.continue(); });
  try {
    await page.goto(base); await page.locator('#title-start').click(); await page.locator('#mode-solo').click();
    await page.locator('#start-date').click();
    await expect(page.locator('#arrival-screen')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#start-date')).toBeDisabled(); await expect(page.locator('#select-back')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#arrival-screen')).toHaveAttribute('data-screen', 'select');
    await expect(page.locator('#dinner-hud')).toBeHidden(); expect(requests).toBe(1);
    release(); await expect(page.locator('#dinner-hud')).toBeVisible(); await waitForRestaurantScene(page);
    // Nothing asks anything of a guest who is still walking in; the prompt line waits for the chair.
    await expect(page.locator('#prompt-line')).toBeHidden(); expect((await state(page)).seated).toBe(false);
    await page.keyboard.press('Escape'); await expect(page.locator('#pause-dialog')).toBeVisible();
    let rejectResume = true;
    await page.route('**/api/date/sessions/*/command', route => {
      const body = route.request().postDataJSON();
      if (rejectResume && body.type === 'pause' && body.paused === false) { rejectResume = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The restaurant connection is briefly unavailable. Please retry.' }) }); }
      return route.continue();
    });
    await expect(page.locator('#resume-date')).toBeEnabled(); await page.locator('#resume-date').click();
    await expect(page.locator('#toast')).toContainText('Please retry'); await expect(page.locator('#pause-dialog')).toBeVisible();
    expect((await state(page)).phase).toBe('paused'); await expect(page.locator('#resume-date')).toBeEnabled();
    await page.locator('#resume-date').click(); await expect.poll(async () => (await state(page)).phase).toBe('playing');
    await expect(page.locator('#pause-dialog')).toBeHidden();
  } finally { release(); }
});

test('an expired solo session returns to mode selection and removes its stale restore token', async ({ page }) => {
  test.setTimeout(90000);
  await beginNewSolo(page);
  await expect.poll(() => page.evaluate(() => !!sessionStorage.getItem('table-for-two-session'))).toBe(true);
  const callsBefore = calls.length;
  await page.route('**/api/date/sessions/*', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'This date session is no longer available.', code: 'session_missing' }) })
    : route.continue());
  await expect(page.locator('#mode-menu')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#dinner-hud')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('table-for-two-session'))).toBeNull();
  expect(calls.length).toBe(callsBefore);
  await expect(page.locator('#mode-solo')).toBeEnabled();
});
