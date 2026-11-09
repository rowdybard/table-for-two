import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attachRestaurantServer, type ClaudeAdapter, type SpeechAdapter } from '../server/restaurant';
import { attachDoubleDateServer } from '../server/double-date';
import type { ClaudeRequest, SpeechRequest } from '../server/restaurant/providers';
import type { DoubleDateRoomState, DoubleRoomCredentials } from '../src/restaurant/double-date-types';
import type { DinnerState } from '../src/restaurant/types';
import { EVENING_PACE } from '../src/restaurant/evening';
import { doubleContext } from './helpers/double-note';
import { RESTAURANT_BROWSER_STORY_RATE, captureRestaurantScene, reloadRestaurantScene, restaurantEvening, restaurantInterrupted, restaurantScenario, resolveRestaurantScenario, waitForRestaurantScene } from './restaurant-browser-helpers';

let http: Server, restaurant: Awaited<ReturnType<typeof attachRestaurantServer>>;
let doubles: Awaited<ReturnType<typeof attachDoubleDateServer>>, browser: Browser, friendBrowser: Browser, base = '';
const requests: ClaudeRequest[] = [], speechRequests: SpeechRequest[] = [];
let releaseHeldTurn: (() => void) | undefined;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Repeated full-resolution PNG readbacks measured 7–15 seconds each on software CI.
// Extend only the total two-browser case budget; action and network deadlines remain unchanged.
const doubleTestBudget = (milliseconds: number) => process.env.LFS_SOFTWARE_GPU === '1' ? milliseconds * 2 : milliseconds;

// A generated tone exercises real HTMLAudioElement decoding without paid providers.
// These tests explicitly use SpeechPlayer's supported non-MSE fallback for WAV.
function tone() {
  const rate = 16000, samples = 4800, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 440 / rate) * 900), 44 + i * 2);
  return bytes;
}
const wav = tone();
const speech: SpeechAdapter = { async *stream(request, signal) {
  speechRequests.push(request);
  for (let i = 0; i < wav.length; i += 2048) { if (signal.aborted) return; yield wav.subarray(i, i + 2048); await sleep(8); }
} };
const claude: ClaudeAdapter = { async *stream(request, signal) {
  requests.push(request);
  // The request is prose now: who spoke, to whom and what they said come from the last paragraph of the note.
  const context = doubleContext(request), text = context.humanTurn.text;
  const repair = text.includes('all of us'), excluded = context.characters.some(actor => actor.friendOnlyTurns >= 3);
  const actor = ['d1', 'd2'].includes(context.humanTurn.target) ? context.humanTurn.target : context.characters.find(candidate => candidate.available)?.id ?? 'd1';
  const result = {
    utterances: text === 'a quiet beat' ? [] : [{ speaker: actor, text: `I heard you: ${text}`, emotion: repair ? 'warm' : excluded ? 'annoyed' : 'amused' }],
    dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: repair ? 'warm' : excluded ? 'annoyed' : 'amused', memory: `The table discussed ${text}.`, social: { signal: repair ? 'repair' : 'none', reason: repair ? 'Both dates were invited back into the conversation.' : '', wantsToLeave: false } })),
  };
  yield { type: 'usage', usage: { inputTokens: 1400, outputTokens: 0, cacheReadTokens: 300, cacheWriteTokens: 0 } };
  const json = JSON.stringify(result);
  if (text === 'hold until released') {
    await new Promise<void>(resolve => {
      const finish = () => { signal.removeEventListener('abort', finish); releaseHeldTurn = undefined; resolve(); };
      releaseHeldTurn = finish;
      if (signal.aborted) finish(); else signal.addEventListener('abort', finish, { once: true });
    });
    if (signal.aborted) return;
  }
  if (text === 'hold this response') {
    await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    // Deliberately emulate one late provider callback after cancellation.
    yield { type: 'text', text: json }; return;
  }
  for (let i = 0; i < json.length; i += 35) { if (signal.aborted) return; yield { type: 'text', text: json.slice(i, i + 35) }; await sleep(4); }
  yield { type: 'usage', usage: { outputTokens: 120 } };
} };

test.beforeAll(async () => {
  const root = resolve('dist');
  http = createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (doubles?.handle(req, res) || restaurant?.handle(req, res)) return;
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'index.html' : '.' + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    void readFile(file).then(bytes => {
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' } as Record<string, string>)[extname(file)] || 'application/octet-stream'); res.end(bytes);
    }).catch(() => res.writeHead(404).end());
  });
  restaurant = await attachRestaurantServer(http, { env: {}, claude, speech, ledgerPath: false, development: true });
  doubles = await attachDoubleDateServer(http, restaurant, { env: {}, storyRate: RESTAURANT_BROWSER_STORY_RATE, scenarioId: 'family-visit' });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const launchOptions = { channel: process.env.CI ? undefined : 'chrome', headless: true, args: [...(process.env.LFS_SOFTWARE_GPU === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] };
  browser = await chromium.launch(launchOptions);
  try { friendBrowser = await chromium.launch(launchOptions); }
  catch (error) { await browser.close(); throw error; }
  await mkdir('.qa/double-date', { recursive: true });
});
test.afterAll(async () => { await Promise.all([browser?.close(), friendBrowser?.close()]); await doubles?.close(); await restaurant?.close(); http?.closeAllConnections(); await new Promise<void>(resolve => http?.close(() => resolve())); });

const state = (page: Page) => page.evaluate(() => (window as unknown as { __restaurantState: DinnerState }).__restaurantState);
const credentials = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('table-for-two-double-date') || 'null') as DoubleRoomCredentials);
async function room(page: Page): Promise<DoubleDateRoomState> {
  return page.evaluate(async () => {
    const membership = JSON.parse(sessionStorage.getItem('table-for-two-double-date')!);
    const response = await fetch(`/api/double-date/rooms/${membership.roomId}`, { headers: { Authorization: `Bearer ${membership.token}` } });
    if (!response.ok) throw new Error('Authenticated room read failed: ' + response.status);
    return (await response.json()).state;
  });
}
async function api(page: Page, route: string, body: unknown) {
  return page.evaluate(async ({ route, body }) => {
    const membership = JSON.parse(sessionStorage.getItem('table-for-two-double-date')!);
    const response = await fetch(`/api/double-date/rooms/${membership.roomId}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${membership.token}` }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { route, body });
}
type Receipt = { lineId: string; generation: number; completed: boolean; playedSeconds: number };
type TransportProbe = { signals: { kind: string; epoch?: number }[]; httpErrors: { path: string; status: number }[] };
type Pair = { a: Page; b: Page; aContext: BrowserContext; bContext: BrowserContext; errors: string[]; receipts: Record<'a'|'b', Receipt[]>; transport: Record<'a'|'b', TransportProbe>; close(): Promise<void> };
async function boundedDiagnostic(task: Promise<unknown>, milliseconds = 1500): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task.catch(error => ({ unavailable: String(error) })), new Promise(resolve => { timer = setTimeout(() => resolve({ unavailable: 'Diagnostic deadline exceeded.' }), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function inviteDiagnostics(page: Page) {
  const dom = await boundedDiagnostic(page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('#double-join'), bounds = button?.getBoundingClientRect();
    const canvas = document.querySelector<HTMLCanvasElement>('.restaurant-canvas');
    return { visibility: document.visibilityState, hasFocus: document.hasFocus(), readyState: document.readyState, focus: document.activeElement?.id,
      inputMode: document.getElementById('restaurant-app')?.dataset.inputMode, error: document.getElementById('start-error')?.textContent,
      lobbyHidden: document.getElementById('double-date-lobby')?.hidden, inviteCode: document.querySelector<HTMLInputElement>('#double-code')?.value,
      join: button ? { hidden: button.hidden, disabled: button.disabled, visible: button.checkVisibility({ checkVisibilityCSS: true }), bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null } : null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, canvas: canvas ? { width: canvas.width, height: canvas.height, busy: canvas.getAttribute('aria-busy') } : null };
  }));
  const [raf, gpu] = await Promise.all([
    boundedDiagnostic(page.evaluate(() => new Promise<{ frames: number; elapsedMs: number }>(resolve => {
      const started = performance.now(); let frames = 0, pending = 0;
      const finish = () => { clearTimeout(timer); cancelAnimationFrame(pending); resolve({ frames, elapsedMs: Math.round(performance.now() - started) }); };
      const timer = setTimeout(finish, 750);
      const tick = () => { if (++frames === 2) finish(); else pending = requestAnimationFrame(tick); };
      pending = requestAnimationFrame(tick);
    }))),
    boundedDiagnostic(page.evaluate(() => {
      const gl = document.querySelector<HTMLCanvasElement>('.restaurant-canvas')?.getContext('webgl2');
      if (!gl) return null;
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), contextLost: gl.isContextLost(), parallelCompile: !!gl.getExtension('KHR_parallel_shader_compile') };
    })),
  ]);
  return { location: page.url(), browser: page.context().browser()?.version(), dom, raf, gpu };
}
async function diagnose(p: Pair, label: string) {
  const data: unknown[] = [];
  for (const [id,page] of [['a',p.a],['b',p.b]] as const) {
    data.push(await page.evaluate(() => ({ room: (window as unknown as { __doubleDateState?: DoubleDateRoomState }).__doubleDateState, toast: document.getElementById('toast')?.textContent, speech: document.getElementById('speech-status')?.textContent, turn: document.getElementById('turn-status')?.textContent, captionSpeaker: document.getElementById('caption-speaker')?.textContent, caption: document.getElementById('caption-text')?.textContent, focus: document.activeElement?.id })).catch(String));
    await page.screenshot({ path: `.qa/double-date/${label}-${id}.png` }).catch(() => {});
  }
  const report = JSON.stringify({ data, errors: p.errors, receipts: p.receipts }, null, 2);
  await writeFile(`.qa/double-date/${label}.json`, report);
  await test.info().attach(label, { contentType: 'application/json', body: report });
}
async function instrumentVoice(context: BrowserContext) {
  // Keep recognition deterministic here; the audio capture, tracks, peer
  // connection, HTTP signaling and RTP traffic remain native browser APIs.
  await context.route(/moonshine\.worker-.*\.js$/, route => route.fulfill({ contentType: 'text/javascript', headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }, body: `self.onmessage = ({data}) => { if(data.type === 'load') self.postMessage({type:'ready'}); if(data.type === 'audio') self.postMessage({type:'ack',epoch:data.epoch}); };` }));
  await context.addInitScript(() => {
    if (!/^https?:$/.test(location.protocol)) return;
    const w = window as unknown as { __doubleVoiceProbe: { calls: number; streams: MediaStream[]; peers: RTCPeerConnection[]; statuses: string[] } };
    w.__doubleVoiceProbe = { calls: 0, streams: [], peers: [], statuses: [] };
    document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
      const text = ['toast','speech-status','turn-status'].map(id => document.getElementById(id)?.textContent || '').join(' | ');
      if (text !== w.__doubleVoiceProbe.statuses.at(-1)) w.__doubleVoiceProbe.statuses.push(text);
      w.__doubleVoiceProbe.statuses.splice(0, Math.max(0, w.__doubleVoiceProbe.statuses.length - 100));
    }).observe(document.body, { childList: true, subtree: true, characterData: true }));
    const nativeGet = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      w.__doubleVoiceProbe.calls++;
      try { const stream = await nativeGet(constraints); w.__doubleVoiceProbe.streams.push(stream); return stream; }
      catch (error) { w.__doubleVoiceProbe.statuses.push('Capture error: ' + String(error)); throw error; }
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('error', error => w.__doubleVoiceProbe.statuses.push('Worker error: ' + error.message));
        this.addEventListener('message', event => { if (event.data.type !== 'ack') w.__doubleVoiceProbe.statuses.push('Worker: ' + JSON.stringify(event.data)); });
      }
    };
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer { constructor(configuration?: RTCConfiguration) { super(configuration); w.__doubleVoiceProbe.peers.push(this); } };
  });
}
async function pair(speechEnabled = false, voiceProbe = false): Promise<Pair> {
  // Friends use separate browser processes, including independent software-GPU queues in CI.
  const aContext = await browser.newContext({ viewport: { width: 1280, height: 800 } }), bContext = await friendBrowser.newContext({ viewport: { width: 1000, height: 700 } });
  try {
  if (voiceProbe) for (const context of [aContext,bContext]) await instrumentVoice(context);
  for (const context of [aContext, bContext]) await context.addInitScript(speechEnabled => {
    if (!/^https?:$/.test(location.protocol)) return;
    const saved = JSON.parse(localStorage.getItem('table-for-two-settings') || '{}');
    localStorage.setItem('table-for-two-settings', JSON.stringify({ ...saved, speech: speechEnabled, ambience: false }));
    if (window.MediaSource) MediaSource.isTypeSupported = () => false;
  }, speechEnabled);
  const a = await aContext.newPage(), b = await bContext.newPage(), errors: string[] = [], receipts: Pair['receipts'] = { a: [], b: [] }, transport: Pair['transport'] = { a: { signals: [], httpErrors: [] }, b: { signals: [], httpErrors: [] } };
  for (const [id,page] of [['a',a],['b',b]] as const) {
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/playback')) receipts[id].push(request.postDataJSON() as Receipt);
      if (path.endsWith('/command') && request.method() === 'POST') {
        const command = request.postDataJSON();
        if (command.type === 'voice-signal') transport[id].signals.push({ kind: command.signal.kind === 'description' ? command.signal.description.type : command.signal.kind, epoch: command.epoch });
        else if (command.type === 'voice-enable') transport[id].signals.push({ kind: `enabled:${command.enabled}` });
      }
    });
    page.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/double-date/') && response.status() >= 400) transport[id].httpErrors.push({ path, status: response.status() }); });
  }
  await a.goto(base);
  await expect(a.locator('#title-start')).toBeFocused({ timeout: 15000 }); await a.keyboard.press('Enter');
  await expect(a.locator('#mode-menu')).toBeVisible();
  await captureRestaurantScene(a, '.qa/double-date/modes-1280.png');
  await a.setViewportSize({ width: 1000, height: 700 }); await captureRestaurantScene(a, '.qa/double-date/modes-1000.png');
  await a.setViewportSize({ width: 1280, height: 800 });
  await a.locator('#mode-double').click();
  await expect(a.locator('#double-date-lobby')).toBeVisible();
  await captureRestaurantScene(a, '.qa/double-date/entry-1280.png');
  await a.locator('#double-name').fill('Alex'); await a.locator('#double-create').click();
  await expect(a.locator('.double-invite-code strong')).not.toHaveText('');
  const code = (await a.locator('.double-invite-code strong').innerText()).trim();
  await expect(a.locator('#double-start')).toBeDisabled();
  await b.bringToFront();
  await b.goto(`${base}/?invite=${encodeURIComponent(code)}`);
  try {
    await expect(b.locator('#double-code')).toHaveValue(code, { timeout: 15000 });
    await b.locator('#double-name').fill('Sam'); await b.locator('#double-join').click();
  }
  catch (error) {
    await test.info().attach('invite-startup', { contentType: 'application/json', body: JSON.stringify({ errors, expectedInviteCode: code, diagnostics: await inviteDiagnostics(b) }) });
    throw error;
  }
  await expect(a.locator('.double-people')).toContainText('Sam');
  await expect(b.locator('.double-people')).toContainText('Alex');
  await captureRestaurantScene(b, '.qa/double-date/room-1000.png');
  return { a, b, aContext, bContext, errors, receipts, transport, close: async () => { await aContext.close(); await bContext.close(); } };
  } catch (error) { await aContext.close(); await bContext.close(); throw error; }
}
async function start(pair: Pair) {
  const { a, b } = pair;
  await a.locator('[data-double-date="mira"]').click();
  await expect(b.locator('[data-double-date="mira"]')).toBeDisabled();
  await b.locator('[data-double-date="jules"]').click();
  for (const page of [a,b]) {
    // SwiftShader traces show a single page.evaluate can take 5.5s while cast
    // shaders compile, even though it returns the correct two-date state.
    await expect.poll(() => page.evaluate(() => (window as unknown as { __doubleDateState?: DoubleDateRoomState }).__doubleDateState?.dates.length), { timeout: 15000 }).toBe(2);
    await expect(page.locator('.double-people')).toContainText('Sam + Jules');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  await captureRestaurantScene(a, '.qa/double-date/room-selected-1280.png'); await captureRestaurantScene(b, '.qa/double-date/room-selected-1000.png');
  await a.locator('#double-ready').click(); await expect(a.locator('#double-start')).toBeDisabled();
  await b.locator('#double-ready').click(); await expect(a.locator('#double-start')).toBeEnabled();
  await a.locator('#double-start').click();
  for (const page of [a,b]) { await expect(page.locator('#double-date-lobby')).toBeHidden(); await expect(page.locator('#dinner-hud')).toBeVisible(); await waitForRestaurantScene(page); }
  await expect.poll(async () => (await room(a)).phase).toBe('playing');
}
async function seat(page: Page) {
  await page.bringToFront();
  await waitForRestaurantScene(page);
  const local = (await credentials(page)).memberId;
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height * .48); await page.mouse.down();
  await page.mouse.move(viewport.width / 2, viewport.height * .74, { steps: 9 }); await page.mouse.up();
  await page.keyboard.down('w');
  try {
    await expect(page.locator('#interaction').filter({ hasText: /seat/i })).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('e');
  } finally { await page.keyboard.up('w'); }
  await expect.poll(async () => (await room(page)).members.find(member => member.id === local)!.seated).toBe(true);
}
async function say(page: Page, text: string, target = 'table') {
  await page.bringToFront();
  if (!await page.locator('#conversation-form').isVisible()) await page.keyboard.press('t');
  await expect(page.locator('#conversation-input')).toBeFocused();
  await page.locator('#conversation-target').selectOption(target); await page.locator('#conversation-input').fill(text);
  await page.locator('#send-turn').click();
  await expect.poll(async () => (await room(page)).lines.some(line => line.text === `I heard you: ${text}`)).toBe(true);
  await expect.poll(async () => !!(await room(page)).processing).toBe(false);
}
async function modelCommand(page: Page, text: string) {
  await page.bringToFront();
  if (!await page.locator('#conversation-form').isVisible()) await page.keyboard.press('t');
  await expect(page.locator('#conversation-input')).toBeFocused();
  await page.locator('#conversation-input').fill(text); await page.locator('#send-turn').click();
  await expect(page.locator('#conversation-form')).toBeHidden();
  await expect(page.locator('#conversation-input')).toHaveValue('');
}
async function closeComposer(page: Page) { if (await page.locator('#conversation-form').isVisible()) { await page.bringToFront(); await page.keyboard.press('Escape'); } }
/** Chips sit on the prompt line. Looking around here is a drag, so the pointer is never captured away from them. */
async function prompt(page: Page) {
  await page.bringToFront();
  await closeComposer(page);
  expect(await page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  if (await page.locator('#bill-dialog').isVisible()) await page.locator('#bill-close').click();
  if (await page.locator('#tabletop-inspector').isVisible()) await page.keyboard.press('Escape');
}
/** The numbered choices are a supported in-game keyboard control. */
async function activateDisplayedChoice(page: Page, control: ReturnType<Page['locator']>, timeout = 5000) {
  await expect(control).toBeVisible({ timeout }); await expect(control).toBeEnabled({ timeout });
  const shortcut = (await control.locator('kbd').innerText()).trim();
  expect(shortcut).toMatch(/^[1-4]$/);
  await page.keyboard.press(shortcut);
}
async function chip(page: Page, selector: string, timeout = 5000) {
  await prompt(page);
  const control = page.locator(`#prompt-chips ${selector}`);
  await activateDisplayedChoice(page, control, timeout);
}
async function resolveInterruption(page: Page): Promise<boolean> {
  const snapshot = await state(page);
  if (await resolveRestaurantScenario(page, () => state(page), () => prompt(page))) return true;
  const incident = restaurantEvening(snapshot).incident;
  if (!incident) return false;
  if (incident.event === 'wrong-order') {
    if (!incident.progress) { await chip(page, '[data-evening="inspect-ticket"]'); await expect.poll(async () => restaurantEvening(await state(page)).incident?.progress).toBe(1); }
    await chip(page, '[data-evening="return-order"]');
  } else if (incident.event === 'spilled-drink') {
    for (let progress = incident.progress; progress < 3; progress++) {
      await chip(page, '[data-evening="wipe"]'); await expect.poll(async () => restaurantEvening(await state(page)).incident?.progress).toBe(progress + 1);
      if (progress < 2) await page.waitForTimeout(120);
    }
    await chip(page, '[data-evening="steady-glass"]');
  } else await chip(page, '[data-evening="ask-quiet"]');
  await expect.poll(async () => !!restaurantEvening(await state(page)).resolutions[incident.event]).toBe(true);
  return true;
}
/** The friend's active story or incident takes priority over the ending chip. */
async function openWingmanEnding(page: Page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await resolveInterruption(page)) continue;
    try { await chip(page, '#view-own-ending'); return; }
    catch (error) {
      // A new authored interruption can arrive after the initial check.
      if (restaurantInterrupted(await state(page))) continue;
      throw error;
    }
  }
  throw new Error('The wingman ending remained blocked by table interruptions.');
}
async function course(page: Page, predicate: (snapshot: DinnerState) => boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!predicate(await state(page)) && Date.now() < deadline) if (!await resolveInterruption(page)) await page.waitForTimeout(100);
  await expect.poll(async () => predicate(await state(page))).toBe(true);
}
async function eveningAction(page: Page, name: string, predicate?: (snapshot: DinnerState) => boolean) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (predicate?.(await state(page))) return;
    if (await resolveInterruption(page)) continue;
    await prompt(page);
    const button = page.locator(`#prompt-chips [data-evening="${name}"]`);
    if (await button.isVisible() && await button.isEnabled()) {
      try { await button.click({ timeout: 5000 }); if (!predicate) return; }
      catch (error) {
        const current = await state(page);
        if (predicate?.(current)) return;
        if (restaurantInterrupted(current)) continue;
        throw error;
      }
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`The ${name} action did not complete through the visible table controls.`);
}
/** Eating is a physical table action (aim at the plate, E); it reaches the same room command route here. */
async function eat(page: Page, target: 'meal' | 'dessert', bites: number) {
  const read = async () => (await state(page)).evening[target === 'meal' ? 'main' : 'dessert'].bites;
  const deadline = Date.now() + 20000;
  while (await read() < bites && Date.now() < deadline) {
    if (await resolveInterruption(page)) continue;
    const result = await api(page, 'command', { type: 'scene', command: { type: 'interact', target } });
    if (result.status !== 200 && !/first\.$/.test(result.body?.error ?? '') && !restaurantInterrupted(await state(page))) throw new Error(`Eating was refused: ${result.status} ${JSON.stringify(result.body)}`);
    await page.waitForTimeout(520);
  }
  expect(await read()).toBeGreaterThanOrEqual(bites);
}
/** The offer stays open for forty scene seconds, then the date picks; either way the pair ends up with a decision. */
async function chooseDessert(page: Page, choice: string | 'skip') {
  await course(page, snapshot => snapshot.evening.main.status === 'finished');
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await state(page);
    if (snapshot.evening.dessert.status !== 'none') break;
    if (await resolveInterruption(page)) continue;
    await prompt(page);
    const option = page.locator(`#prompt-chips ${choice === 'skip' ? '[data-evening="skip-dessert"]' : `[data-evening="order-dessert"][data-choice="${choice}"]`}`);
    try {
      await expect(page.locator('#prompt-copy')).toHaveText('Eli offers dessert to share.', { timeout: 2000 });
      await activateDisplayedChoice(page, option, 2000);
      break;
    } catch (error) {
      const current = await state(page);
      if (current.evening.dessert.status !== 'none') break;
      if (restaurantInterrupted(current)) continue;
      // A rendering stall can delay the displayed choice while the same offer
      // remains open. Retry only that observed, enabled offer.
      const stillOffered = current.evening.dessert.offeredAt !== undefined
        && await page.locator('#prompt-copy').textContent() === 'Eli offers dessert to share.'
        && await option.isVisible() && await option.isEnabled();
      if (stillOffered) continue;
      throw error;
    }
  }
  await expect.poll(async () => (await state(page)).evening.dessert.status).not.toBe('none');
}
/** Looking down at the chair stands a guest up; the door is a short walk behind the table. */
async function walkToTheDoor(page: Page) {
  await prompt(page);
  const viewport = page.viewportSize()!;
  for (let drag = 0; drag < 2; drag++) {
    await page.mouse.move(viewport.width / 2, viewport.height * .2); await page.mouse.down();
    await page.mouse.move(viewport.width / 2, viewport.height * .95, { steps: 10 }); await page.mouse.up();
  }
  await expect(page.locator('#interaction-label')).toHaveText('Stand up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await state(page)).seated).toBe(false);
  await waitForRestaurantScene(page);
  const human = (await credentials(page)).memberId;
  await page.keyboard.down('s');
  try { await expect.poll(async () => (await room(page)).members.find(member => member.id === human)!.position[2], { timeout: 15000 }).toBeGreaterThanOrEqual(4.2); }
  finally { await page.keyboard.up('s'); }
}

test('private double date: distinct choices, readiness, independent first-person seats, pause and reconnect', async () => {
  test.setTimeout(doubleTestBudget(150000));
  const p = await pair();
  try {
    await captureRestaurantScene(p.a, '.qa/double-date/lobby-entry-1280.png');
    for (const dateId of ['mira','jules','dev']) {
      await p.a.locator(`[data-double-date="${dateId}"]`).click();
      await expect(p.a.locator(`[data-double-date="${dateId}"]`)).toHaveAttribute('aria-pressed', 'true');
      await captureRestaurantScene(p.a, `.qa/double-date/lobby-${dateId}-1280.png`);
    }
    await start(p);
    const aCreds = await credentials(p.a), bCreds = await credentials(p.b);
    expect(aCreds.memberId).toBe('h1'); expect(bCreds.memberId).toBe('h2'); expect(aCreds.token).not.toBe(bCreds.token);
    const joined = await room(p.a);
    expect(joined.members.map(member => member.name)).toEqual(['Alex', 'Sam']);
    expect(joined.dates.map(actor => actor.dateId)).toEqual(['mira', 'jules']);
    expect(JSON.stringify(joined)).not.toContain(aCreds.token); expect(JSON.stringify(joined)).not.toContain(bCreds.token);
    const friendPosition = [...joined.members.find(member => member.id === 'h2')!.position];
    await seat(p.a);
    await expect.poll(async () => (await room(p.b)).members.find(member => member.id === 'h1')!.seated).toBe(true);
    expect((await room(p.b)).members.find(member => member.id === 'h2')!.seated).toBe(false);
    expect((await room(p.b)).members.find(member => member.id === 'h2')!.position).toEqual(friendPosition);
    await seat(p.b);
    for (const [page, human] of [[p.a,'h1'], [p.b,'h2']] as const) {
      const view = await state(page); expect(view.mode).toBe('double-date'); expect(view.doubleDate?.localHumanId).toBe(human);
      expect(view.doubleDate?.members).toHaveLength(2); expect(view.doubleDate?.dates).toHaveLength(2);
      await expect(page.locator('#conversation-form')).toBeHidden();
    }
    await expect.poll(async () => (await room(p.a)).dates.every(actor => actor.seated), { timeout: 10000 }).toBe(true);
    await captureRestaurantScene(p.a, '.qa/double-date/seated-1280.png'); await captureRestaurantScene(p.b, '.qa/double-date/seated-1000.png');
    await p.a.keyboard.press('Escape'); await expect(p.a.locator('#pause-dialog')).toBeVisible();
    await expect.poll(async () => (await room(p.b)).phase).toBe('paused');
    const before = (await room(p.b)).members.map(member => member.position);
    await p.b.keyboard.down('w'); await p.b.waitForTimeout(220); await p.b.keyboard.up('w');
    expect((await room(p.b)).members.map(member => member.position)).toEqual(before);
    await p.a.locator('#resume-date').click(); await expect.poll(async () => (await room(p.b)).phase).toBe('playing');
    await reloadRestaurantScene(p.b);
    await expect(p.b.locator('#dinner-hud')).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await credentials(p.b)).token).toBe(bCreds.token);
    await expect.poll(async () => (await state(p.b)).doubleDate?.localHumanId).toBe('h2');
    expect((await room(p.a)).members.filter(member => member.id === 'h2')).toHaveLength(1);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
});

test('shared table turns: one request, both identities, exclusion and repair, private host model command and interruption', async () => {
  test.setTimeout(doubleTestBudget(150000));
  const p = await pair(true);
  try {
    await start(p); await seat(p.a); await seat(p.b);
    const count = requests.length;
    await say(p.a, 'mushrooms are underrated', 'd1');
    await expect.poll(async () => (await room(p.b)).lines.some(line => line.text === 'I heard you: mushrooms are underrated')).toBe(true);
    expect(requests.length - count).toBe(1);
    const context = doubleContext(requests.at(-1)!);
    expect(context.humanTurn).toMatchObject({ speaker: 'h1', target: 'd1', text: 'mushrooms are underrated' });
    expect(context.characters.map(actor => [actor.id, actor.dateName])).toEqual([['d1','Mira'],['d2','Jules']]);
    // Both date sheets (life, personality, boundaries) are in the cached system prompt, not repeated in every note.
    for (const sheet of ['d1 is Mira', 'd2 is Jules']) expect(requests.at(-1)!.system).toContain(sheet);
    expect(requests.at(-1)!.system).toContain('Personality:'); expect(requests.at(-1)!.system).toContain('Boundaries:');
    await expect(p.b.locator('#conversation-log')).toContainText('mushrooms are underrated');
    const spoken = (await room(p.a)).lines.find(line => line.text === 'I heard you: mushrooms are underrated')!;
    for (const id of ['a','b'] as const) await expect.poll(() => p.receipts[id].some(receipt => receipt.lineId === spoken.id && receipt.completed), { timeout: 15000 }).toBe(true);
    expect(speechRequests.filter(request => request.text === spoken.text)).toHaveLength(1);
    for (let i = 0; i < 3; i++) await say(p.a, `friend-only story ${i}`, 'h2');
    await expect.poll(async () => (await room(p.b)).dates.map(actor => actor.emotion)).toEqual(['annoyed','annoyed']);
    await say(p.b, 'Let us include all of us', 'table');
    await expect.poll(async () => (await room(p.a)).dates.map(actor => actor.emotion)).toEqual(['warm','warm']);
    const beforeQuiet = (await room(p.a)).dates.map(actor => actor.stance);
    await closeComposer(p.a); await closeComposer(p.b); await p.a.waitForTimeout(500);
    expect((await room(p.a)).dates.map(actor => actor.stance)).toEqual(beforeQuiet);
    for (const page of [p.a, p.b]) await expect(page.locator('#model-select')).toHaveCount(0);
    expect((await room(p.a)).model).toBe('claude-haiku-5-5');
    const beforeModelCommands = requests.length;
    const guestPreferences = await p.b.evaluate(() => localStorage.getItem('table-for-two-settings'));
    const commandTurnTexts: string[] = [];
    for (const page of [p.a, p.b]) page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/turn')) commandTurnTexts.push(request.postDataJSON().text);
    });
    await modelCommand(p.b, '/model sonnet');
    await expect(p.b.locator('#toast')).toContainText('Your host chooses');
    expect((await room(p.a)).model).toBe('claude-haiku-5-5');
    expect(await p.b.evaluate(() => localStorage.getItem('table-for-two-settings'))).toBe(guestPreferences);
    expect(requests.length).toBe(beforeModelCommands); expect(commandTurnTexts).toEqual([]);
    await modelCommand(p.a, '/model sonnet');
    await expect(p.a.locator('#toast')).toHaveText('Sonnet selected for the next turn.');
    await expect.poll(async () => (await room(p.b)).model).toBe('claude-sonnet-5-5');
    expect(requests.length).toBe(beforeModelCommands); expect(commandTurnTexts).toEqual([]);
    expect(await p.a.evaluate(() => JSON.parse(localStorage.getItem('table-for-two-settings')!))).toMatchObject({ model: 'claude-sonnet-5-5', modelSource: 'chat-command' });
    expect(await p.b.evaluate(() => localStorage.getItem('table-for-two-settings'))).toBe(guestPreferences);
    expect((await room(p.a)).lines.some(line => line.text.includes('/model'))).toBe(false);
    for (const page of [p.a, p.b]) {
      await expect(page.locator('#conversation-log')).not.toContainText('/model');
      await expect(page.locator('#caption-text')).not.toContainText('/model');
    }
    await say(p.b, 'the saved model is next', 'd2');
    expect(requests.at(-1)!.model).toBe('claude-sonnet-5-5');
    expect(requests.length).toBe(beforeModelCommands + 1);
    expect(commandTurnTexts).toEqual(['the saved model is next']);
    expect(requests.slice(count).every(request => request.messages.every(message => !message.content.includes('/model')))).toBe(true);
    await closeComposer(p.b);
    await reloadRestaurantScene(p.b); await expect(p.b.locator('#dinner-hud')).toBeVisible({ timeout: 15000 });
    await expect(p.b.locator('#conversation-log')).toContainText('mushrooms are underrated');
    await expect(p.b.locator('#conversation-log')).toContainText('the saved model is next');
    await modelCommand(p.b, '/model');
    await expect(p.b.locator('#toast')).toHaveText('Conversation model: Sonnet.');
    expect(requests.length).toBe(beforeModelCommands + 1);
    expect(await p.b.evaluate(() => localStorage.getItem('table-for-two-settings'))).toBe(guestPreferences);
    await expect(p.b.locator('#conversation-log')).not.toContainText('/model');
    // Keep the room processing while opening the composer. When the same
    // generation finishes, Send must recover without another input event.
    const held = await api(p.a, 'turn', { turnId: 'held-for-send-control', text: 'hold until released', target: 'table' });
    expect(held.status).toBe(202);
    await expect.poll(() => !!releaseHeldTurn).toBe(true);
    await expect.poll(() => p.a.evaluate(() => !!(window as unknown as { __doubleDateState?: DoubleDateRoomState }).__doubleDateState?.processing), { timeout: 15000 }).toBe(true);
    await p.a.bringToFront();
    if (!await p.a.locator('#conversation-form').isVisible()) await p.a.keyboard.press('t');
    await p.a.locator('#conversation-input').fill('Ready for the next turn');
    await expect(p.a.locator('#send-turn')).toBeDisabled();
    releaseHeldTurn!();
    await expect.poll(async () => !!(await room(p.a)).processing).toBe(false);
    await expect(p.a.locator('#send-turn')).toBeEnabled({ timeout: 15000 });
    await p.a.locator('#conversation-input').fill(''); await closeComposer(p.a);
    // An unfinished provider response is canceled room-wide; late text must never become a caption or speech line.
    const response = await api(p.a, 'turn', { turnId: 'slow-interrupted-turn', text: 'hold this response', target: 'table' });
    expect(response.status).toBe(202);
    await expect.poll(async () => (await room(p.a)).processing).toBe(true);
    const generation = (await room(p.a)).generation;
    expect((await api(p.b, 'interrupt', {})).status).toBe(200);
    await expect.poll(async () => (await room(p.a)).generation).toBeGreaterThan(generation);
    await p.a.waitForTimeout(350);
    expect((await room(p.a)).lines.some(line => line.text === 'I heard you: hold this response')).toBe(false);
    const roomId = (await credentials(p.a)).roomId; let expiredPolls = 0;
    await p.aContext.route(new RegExp(`/api/double-date/rooms/${roomId}(?:\\?.*)?$`), route => {
      expiredPolls++; return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'room_missing', error: 'That evening has closed.' }) });
    });
    await expect(p.a.locator('#arrival-screen')).toHaveAttribute('data-screen', 'mode');
    await expect(p.a.locator('#dinner-hud')).toBeHidden(); expect(await credentials(p.a)).toBeNull();
    const terminalPolls = expiredPolls; await p.a.waitForTimeout(350); expect(expiredPolls).toBe(terminalPolls);
    expect(p.errors).toEqual([]);
  } catch (error) { await diagnose(p, 'shared-turn-failure'); throw error;
  } finally { releaseHeldTurn?.(); await p.close(); }
});

test('friend voice uses one opted-in microphone per browser and exchanges native RTP in both directions', async () => {
  test.setTimeout(doubleTestBudget(150000));
  const p = await pair(false, true);
  let phase = 'starting';
  const checkpoints: { phase: string; bytes: number }[] = [];
  const media = (page: Page) => page.evaluate(() => {
    const probe = (window as unknown as { __doubleVoiceProbe: { calls: number; streams: MediaStream[]; peers: RTCPeerConnection[]; statuses: string[] } }).__doubleVoiceProbe;
    return { calls: probe.calls, tracks: probe.streams.flatMap(stream => stream.getTracks().map(track => ({ enabled: track.enabled, readyState: track.readyState }))), peers: probe.peers.map(peer => ({ connection: peer.connectionState, ice: peer.iceConnectionState, signaling: peer.signalingState })), configurations: probe.peers.map(peer => peer.getConfiguration()), statuses: probe.statuses, mic: { pressed: document.getElementById('mic-toggle')?.getAttribute('aria-pressed'), title: document.getElementById('mic-toggle')?.title }, isolated: window.crossOriginIsolated };
  });
  const packets = (page: Page, direction: 'inbound-rtp' | 'outbound-rtp') => page.evaluate(async direction => {
    let bytes = 0;
    for (const peer of (window as unknown as { __doubleVoiceProbe: { peers: RTCPeerConnection[] } }).__doubleVoiceProbe.peers) {
      if (peer.connectionState !== 'connected') continue;
      const stats = await peer.getStats();
      stats.forEach(stat => { if (stat.type === direction && (stat.kind === 'audio' || stat.mediaType === 'audio')) bytes += direction === 'inbound-rtp' ? stat.bytesReceived || 0 : stat.bytesSent || 0; });
    }
    return bytes;
  }, direction);
  try {
    await start(p);
    for (const page of [p.a,p.b]) expect((await media(page)).calls).toBe(0);
    await p.a.locator('#mic-toggle').click(); await p.b.locator('#mic-toggle').click();
    for (const page of [p.a,p.b]) {
      await expect.poll(async () => (await media(page)).tracks.some(track => track.readyState === 'live'), { timeout: 20000 }).toBe(true);
      // Recognition and friend voice share one physical getUserMedia request.
      expect((await media(page)).calls).toBe(1);
      await expect.poll(async () => (await media(page)).configurations.length, { timeout: 15000 }).toBeGreaterThan(0);
      expect((await media(page)).configurations.every(config => config.iceServers?.some(server => String(server.urls).startsWith('stun:')))).toBe(true);
      for (const direction of ['inbound-rtp','outbound-rtp'] as const) { phase = `initial ${page === p.a ? 'a' : 'b'} ${direction}`; await expect.poll(() => packets(page, direction), { timeout: 30000 }).toBeGreaterThan(0); checkpoints.push({ phase, bytes: await packets(page, direction) }); }
    }
    // A real page departure suspends the room and releases both voice/ASR
    // leases. Rejoining restores membership, while microphone consent resets.
    await p.b.goto('about:blank');
    await expect.poll(async () => (await room(p.a)).pauseReason).toBe('reconnect');
    await expect.poll(async () => (await media(p.a)).tracks.every(track => track.readyState === 'ended')).toBe(true);
    await p.b.goto(base, { waitUntil: 'commit' }); await waitForRestaurantScene(p.b); await expect(p.b.locator('#dinner-hud')).toBeVisible({ timeout: 15000 });
    expect((await media(p.b)).calls).toBe(0);
    for (const page of [p.a,p.b]) await expect(page.locator('#mic-toggle')).toHaveAttribute('aria-pressed', 'false');
    await p.a.locator('#mic-toggle').click(); await p.b.locator('#mic-toggle').click();
    for (const page of [p.a,p.b]) await expect.poll(async () => (await media(page)).tracks.some(track => track.readyState === 'live'), { timeout: 15000 }).toBe(true);
    expect((await media(p.a)).calls).toBe(2); expect((await media(p.b)).calls).toBe(1);
    await p.a.keyboard.press('Escape'); await expect.poll(async () => (await room(p.b)).phase).toBe('paused');
    await p.a.locator('#resume-date').click(); await expect.poll(async () => (await room(p.b)).phase).toBe('playing');
    for (const page of [p.a,p.b]) for (const direction of ['inbound-rtp','outbound-rtp'] as const) { phase = `resumed ${page === p.a ? 'a' : 'b'} ${direction}`; await expect.poll(() => packets(page, direction), { timeout: 15000 }).toBeGreaterThan(0); checkpoints.push({ phase, bytes: await packets(page, direction) }); }
    await p.a.locator('#mic-toggle').click();
    await expect.poll(async () => (await media(p.a)).tracks.every(track => track.readyState === 'ended')).toBe(true);
    expect((await media(p.b)).tracks.some(track => track.readyState === 'live')).toBe(true);
    await p.b.locator('#mic-toggle').click();
    await expect.poll(async () => (await media(p.b)).tracks.every(track => track.readyState === 'ended')).toBe(true);
    expect(p.errors).toEqual([]);
    await writeFile('.qa/double-date/native-voice-result.json', JSON.stringify({ status: 'passed', checkpoints, transport: p.transport }, null, 2));
  } catch (error) {
    const diagnostics = JSON.stringify({ phase, checkpoints, a: await media(p.a), b: await media(p.b), room: await room(p.a), transport: p.transport, errors: p.errors }, null, 2);
    await writeFile('.qa/double-date/native-voice-diagnostics.json', diagnostics);
    await test.info().attach('native-voice-diagnostics', { contentType: 'application/json', body: diagnostics });
    throw error;
  } finally { await p.close(); }
});

async function pauseFromRestaurant(page: Page) {
  await prompt(page);
  await page.keyboard.press('Escape'); await expect(page.locator('#pause-dialog')).toBeVisible();
  await expect(page.locator('#finish-date')).toBeEnabled();
}

test('a finished date can stay as a wingman, help the active pair and return from their own ending', async () => {
  test.setTimeout(doubleTestBudget(150000));
  const p = await pair();
  try {
    await start(p); await seat(p.a); await seat(p.b);
    await chip(p.b, 'button:has-text("Open the menu")');
    await p.b.locator('[data-order="Wild mushroom risotto"]').click();
    await course(p.b, snapshot => snapshot.evening.main.status === 'served');
    await pauseFromRestaurant(p.a); await p.a.locator('#finish-date').click();
    await expect.poll(async () => (await room(p.a)).views.h1.phase).toBe('ended');
    await expect.poll(async () => (await room(p.a)).phase).toBe('playing');
    await expect.poll(async () => (await state(p.a)).doubleDate?.role).toBe('wingman');
    await expect(p.a.locator('#ending-screen')).toBeHidden(); await expect(p.a.locator('#dinner-hud')).toBeVisible();
    expect((await room(p.a)).views.h1.order).toBeNull();
    const departedMemory = (await room(p.a)).views.h1.memory;
    await openWingmanEnding(p.a);
    await expect(p.a.locator('#ending-screen')).toBeVisible();
    const earlyHistory = await p.a.evaluate(() => JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]'));
    expect(earlyHistory).toHaveLength(1);
    await p.a.locator('#back-to-table').click(); await expect(p.a.locator('#ending-screen')).toBeHidden();
    await resolveInterruption(p.a);
    await eveningAction(p.a, 'request-water', snapshot => restaurantEvening(snapshot).care.water.status !== 'none');
    await expect.poll(async () => (await room(p.b)).views.h2.evening.care.water.status).toBe('served');
    await eveningAction(p.a, 'check-in', snapshot => !!restaurantEvening(snapshot).care.checkIn);
    await expect.poll(async () => !!(await room(p.b)).views.h2.evening.care.checkIn).toBe(true);
    await course(p.a, snapshot => !!restaurantEvening(snapshot).resolutions['wrong-order']);
    const helped = await room(p.a);
    expect(helped.views.h1.evening.care.water.status).toBe('none');
    expect(helped.views.h1.order).toBeNull(); expect(helped.views.h1.memory).toBe(departedMemory);
    expect(helped.views.h2.evening.moments.some(moment => moment.description.includes('Alex') && /water/i.test(moment.description))).toBe(true);
    expect(helped.views.h1.evening.moments.some(moment => moment.description.includes('Alex') && /water/i.test(moment.description))).toBe(true);
    // A wingman keeps their friend company; no course, dessert or check of their own is on offer.
    await expect(p.a.locator('#prompt-copy')).toHaveText('Here for your friend.');
    await expect(p.a.locator('#prompt-chips [data-evening="skip-dessert"], #prompt-chips [data-evening="order-dessert"], #prompt-chips [data-evening="settle-bill"]')).toHaveCount(0);
    await openWingmanEnding(p.a);
    await expect(p.a.locator('#ending-screen')).toBeVisible(); expect((await room(p.b)).phase).toBe('playing');
    const updatedHistory = await p.a.evaluate(() => JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]') as { moments: { description: string }[] }[]);
    expect(updatedHistory).toHaveLength(1);
    expect(updatedHistory[0].moments.some(moment => moment.description.includes('Alex') && /water/i.test(moment.description))).toBe(true);
    await p.a.locator('#back-to-table').click(); await expect(p.a.locator('#ending-screen')).toBeHidden();
    await prompt(p.a);
    const viewport = p.a.viewportSize()!;
    for (let drag = 0; drag < 2; drag++) { await p.a.mouse.move(viewport.width / 2, viewport.height * .2); await p.a.mouse.down(); await p.a.mouse.move(viewport.width / 2, viewport.height * .95, { steps: 10 }); await p.a.mouse.up(); }
    await expect(p.a.locator('#interaction-label')).toHaveText('Stand up'); await p.a.keyboard.press('e');
    await expect.poll(async () => (await state(p.a)).seated).toBe(false);
    await expect(p.a.locator('#prompt-copy')).toHaveText('Take your seat to keep your friend company.');
    const before = (await state(p.a)).participants[0].position[2];
    await p.a.keyboard.down('s');
    try { await expect.poll(async () => (await state(p.a)).participants[0].position[2]).toBeGreaterThan(before + .2); }
    finally { await p.a.keyboard.up('s'); }
    const count = requests.length;
    await say(p.a, 'Jules, would you like another quiet minute?', 'table');
    expect(requests.length - count).toBe(1);
    const context = doubleContext(requests.at(-1)!);
    expect(context.humanTurn.target).toBe('table');
    expect(context.characters.find(actor => actor.id === 'd1')!.available).toBe(false);
    expect(context.characters.find(actor => actor.id === 'd2')!.available).toBe(true);
    // The note states the evening's age in whole minutes, from the shared clock.
    expect(context.minutes).toBeGreaterThanOrEqual(Math.floor(helped.views.h1.elapsed / 60));
    await expect(p.a.locator('#conversation-target option[value="d1"]')).toHaveCount(0);
    expect((await room(p.a)).views.h1.memory).toBe(departedMemory);
    await pauseFromRestaurant(p.b); await p.b.locator('#finish-date').click();
    await expect.poll(async () => (await room(p.a)).phase).toBe('ended');
    for (const page of [p.a,p.b]) await expect(page.locator('#ending-screen')).toBeVisible();
    expect(p.errors).toEqual([]);
  } catch (error) { await diagnose(p, 'wingman-failure'); throw error; }
  finally { await p.close(); }
});

test('complete double evening: both dinners, a shared dessert, one check for the table and independent farewells', async () => {
  test.setTimeout(doubleTestBudget(240000));
  const p = await pair();
  try {
    await start(p); await seat(p.a); await seat(p.b);
    for (const page of [p.a,p.b]) {
      for (let attempt = 0; attempt < 5 && (await state(page)).order !== 'Wild mushroom risotto'; attempt++) {
        if (await resolveInterruption(page)) continue;
        await chip(page, 'button:has-text("Open the menu")');
        try { await page.locator('[data-order="Wild mushroom risotto"]').click({ timeout: 5000 }); }
        catch (error) { if (!restaurantInterrupted(await state(page))) throw error; }
        await expect.poll(async () => (await state(page)).order === 'Wild mushroom risotto' || restaurantInterrupted(await state(page))).toBe(true);
      }
      expect((await state(page)).order).toBe('Wild mushroom risotto');
      await course(page, snapshot => snapshot.evening.main.status === 'served');
    }
    // One wrong plate reaches the table at service; whoever sees it can send it back for the pair it belongs to.
    await course(p.b, snapshot => !!restaurantEvening(snapshot).resolutions['wrong-order'] || !!snapshot.doubleDate?.otherView?.evening.resolutions['wrong-order']);
    for (const page of [p.a,p.b]) await expect(page.locator('#prompt-chips [data-evening="taste"], #prompt-chips [data-evening="finish-main"]')).toHaveCount(0);
    // Two dinners, each eaten from its own plate; Eli clears both on his own clock.
    for (let bite = 1; bite <= 3; bite++) for (const page of [p.a,p.b]) await eat(page, 'meal', bite);
    await course(p.a, snapshot => snapshot.evening.main.status === 'finished', 20000);
    expect((await room(p.a)).views.h1.evening.cues.some(cue => cue.key === 'main-finished' && cue.utterances[0]!.speaker === 'waiter')).toBe(true);
    // Each pair can choose while the offer is open; otherwise the date makes the choice.
    // Eat the first pair's dessert when it is served; the second main and a
    // software PNG readback can otherwise outlast the authored serving window.
    await chooseDessert(p.a, 'lemon');
    await course(p.a, snapshot => snapshot.evening.dessert.status === 'served', 20000);
    expect((await state(p.b)).evening.bill.requested).toBe(false);
    await eat(p.a, 'dessert', 2);
    await course(p.b, snapshot => snapshot.evening.main.status === 'finished', 20000);
    await captureRestaurantScene(p.a, '.qa/double-date/plates-cleared-1280.png');
    // The table's check waits for both pairs' dessert decisions.
    await chooseDessert(p.b, 'skip');
    await captureRestaurantScene(p.a, '.qa/double-date/shared-dessert-1280.png');
    await course(p.a, snapshot => snapshot.evening.dessert.status === 'finished', 30000);
    // The other pair may let their date order and finish dessert unaided.
    const unattendedDessertSeconds = EVENING_PACE.dessertDecision + EVENING_PACE.dessertKitchen + EVENING_PACE.dessertCourse + EVENING_PACE.checkDelay;
    const billWaitMs = 15000 + Math.ceil(unattendedDessertSeconds * 1000 / RESTAURANT_BROWSER_STORY_RATE);
    for (const page of [p.a,p.b]) await course(page, snapshot => snapshot.evening.bill.requested, billWaitMs);
    const billed = await room(p.a), money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    expect(billed.views.h1.evening.bill.arrivedAt).toBe(billed.views.h2.evening.bill.arrivedAt);
    await prompt(p.a); await expect(p.a.locator('#prompt-copy')).toHaveText('Eli left the check.');
    await chip(p.a, 'button:has-text("See the check")');
    await expect(p.a.locator('#bill-dialog')).toBeVisible();
    const receipt = await p.a.locator('#bill-items').innerText();
    expect(receipt).toContain('You and Mira'); expect(receipt).toContain('Sam and Jules');
    for (const [human, player, date] of [['h1','You','Mira'],['h2','Sam','Jules']] as const) {
      const bill = billed.views[human].evening.bill;
      expect(bill.settlement).toBeNull();
      expect(bill.items!.filter(item => item.id.startsWith('main-'))).toHaveLength(2);
      expect(bill.items!.find(item => item.id === 'main-you')).toMatchObject({ label: 'Wild mushroom risotto', owner: 'you', chargedCents: 2000, status: 'served' });
      expect(bill.totalCents).toBe(bill.items!.reduce((sum, item) => sum + item.chargedCents, 0));
      for (const item of bill.items!) expect(receipt).toContain(`${item.owner === 'you' ? player : date} · ${item.label} · ${money(item.chargedCents)}`);
      expect(receipt).toContain(`Pair total · ${money(bill.totalCents!)}`);
    }
    const desserts = (['h1', 'h2'] as const).filter(human => billed.views[human].evening.dessert.choice);
    const dessertMenu: Record<string, { label: string; price: number }> = {
      lemon: { label: 'Lemon posset', price: 900 },
      chocolate: { label: 'Chocolate fondant', price: 1100 },
      berries: { label: 'Strawberries & cream', price: 800 },
    };
    expect(desserts).toContain('h1'); // This pair shared and ate dessert above.
    for (const human of ['h1', 'h2'] as const) {
      const choice = billed.views[human].evening.dessert.choice;
      const item = billed.views[human].evening.bill.items!.find(entry => entry.id === 'dessert-shared');
      if (!choice) { expect(item).toBeUndefined(); continue; }
      const expected = dessertMenu[choice]; expect(expected).toBeDefined();
      expect(item).toEqual({ id: 'dessert-shared', label: expected.label, quantity: 1, unitPriceCents: expected.price, status: 'served', chargedCents: expected.price, owner: 'you' });
    }
    expect(receipt.split('\n').filter(line => /^(You|Mira|Sam|Jules) · /.test(line))).toHaveLength(4 + desserts.length);
    expect(receipt).not.toContain('Not charged'); expect(receipt).not.toContain('Already settled');
    await expect(p.a.locator('#bill-total')).toHaveText(`Amount due · ${money(billed.views.h1.evening.bill.totalCents! + billed.views.h2.evening.bill.totalCents!)}`);
    await captureRestaurantScene(p.a, '.qa/double-date/shared-bill-1280.png');
    await p.a.locator('[data-settlement="split"]').click();
    await expect.poll(async () => (await state(p.b)).evening.bill.settlement).toBe('split');
    expect(Object.values((await room(p.a)).views).map(view => view.evening.bill.settlement)).toEqual(['split', 'split']);
    for (const page of [p.a,p.b]) await expect(page.locator('#prompt-copy')).toHaveText('Dinner is settled. Walk to the door together.');
    for (const [page, farewell] of [[p.a,'again'], [p.b,'friendly']] as const) {
      await walkToTheDoor(page);
      await expect(page.locator('#prompt-copy')).toHaveText('One last thing, at the door.');
      await chip(page, `[data-evening="farewell"][data-choice="${farewell}"]`);
      const human = (await credentials(page)).memberId;
      await expect.poll(async () => (await room(page)).views[human].phase, { timeout: 15000 }).toBe('ended');
      if (human === 'h1') {
        await expect.poll(async () => (await state(p.a)).doubleDate?.role).toBe('wingman');
        await expect(p.a.locator('#dinner-hud')).toBeVisible(); await expect(p.a.locator('#ending-screen')).toBeHidden();
        await expect(p.a.locator('#prompt-copy')).toHaveText('Take your seat to keep your friend company.');
        await expect(p.a.locator('#view-own-ending')).toHaveCount(0);
        const z = (await state(p.a)).participants[0].position[2];
        await p.a.keyboard.down('w');
        try { await expect.poll(async () => (await state(p.a)).participants[0].position[2]).toBeLessThan(z - .2); }
        finally { await p.a.keyboard.up('w'); }
        const oldMemory = (await room(p.a)).views.h1.memory, count = requests.length;
        await say(p.a, 'Jules, I hope the rest of your evening is lovely', 'd2');
        expect(requests.length - count).toBe(1);
        const context = doubleContext(requests.at(-1)!);
        expect(context.characters.find(actor => actor.id === 'd1')!.available).toBe(false);
        expect(context.characters.find(actor => actor.id === 'd2')!.available).toBe(true);
        expect((await room(p.a)).views.h1.memory).toBe(oldMemory);
      }
    }
    await expect.poll(async () => (await room(p.a)).phase).toBe('ended');
    for (const page of [p.a,p.b]) await expect(page.locator('#ending-screen')).toBeVisible({ timeout: 15000 });
    const completed = await room(p.a);
    expect(completed.views.h1.evening.sharedActivities).toEqual(['dessert']);
    expect(completed.views.h2.evening.farewell.ending?.kind).toBe('new-friend');
    expect(restaurantScenario(await state(p.a))?.phase).toBe('resolved');
    expect(completed.scenario?.id).toBe('family-visit'); expect(completed.scenario?.decisions).toHaveLength(2);
    for (const view of Object.values(completed.views)) expect(view.evening.moments.some(moment => moment.id === 'scenario-family-visit')).toBe(true);
    expect(completed.usage.claudeRequests).toBe(1);
    await captureRestaurantScene(p.a, '.qa/double-date/ending-mira-1280.png'); await captureRestaurantScene(p.b, '.qa/double-date/ending-jules-1000.png');
    await p.a.locator('#new-date').click();
    await expect(p.a.locator('#title-start')).toBeVisible({ timeout: 15000 });
    await expect(p.a.locator('#arrival-screen')).toHaveAttribute('data-screen', 'title');
    expect(await credentials(p.a)).toBeNull();
    await reloadRestaurantScene(p.a); await expect(p.a.locator('#title-start')).toBeVisible({ timeout: 15000 });
    await expect(p.a.locator('#dinner-hud')).toBeHidden();
    await p.a.keyboard.press('Enter'); await expect(p.a.locator('#mode-menu')).toBeVisible();
    expect(p.errors).toEqual([]);
  } catch (error) { await diagnose(p, 'full-evening-failure'); throw error;
  } finally { await p.close(); }
});

test('blind date starts directly, restores its seeded match and can finish without another human', async () => {
  test.setTimeout(90000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: false, ambience: false })));
  const page = await context.newPage(), errors: string[] = [];
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base); await expect(page.locator('#title-start')).toBeFocused({ timeout: 15000 }); await page.keyboard.press('Enter');
    await expect(page.locator('#mode-blind')).toBeVisible(); await page.locator('#mode-blind').click();
    await expect(page.locator('#dinner-hud')).toBeVisible(); await expect(page.locator('#arrival-screen')).toBeHidden();
    await expect(page.locator('#double-date-lobby')).toBeHidden();
    const matched = await state(page);
    expect(matched.mode).toBe('blind-date'); expect(matched.blindDate?.seed).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(matched.participants.map(person => person.kind)).toEqual(['human','ai']);
    await captureRestaurantScene(page, '.qa/double-date/blind-arrival-1280.png');
    await reloadRestaurantScene(page); await expect(page.locator('#pause-dialog')).toBeVisible({ timeout: 15000 });
    await page.locator('#resume-date').click(); await expect(page.locator('#dinner-hud')).toBeVisible();
    await expect.poll(async () => (await state(page)).blindDate?.seed).toBe(matched.blindDate!.seed);
    expect((await state(page)).dateId).toBe(matched.dateId);
    if (!await page.locator('#pause-dialog').isVisible()) await page.keyboard.press('Escape');
    await page.locator('#finish-date').click(); await expect(page.locator('#ending-screen')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
