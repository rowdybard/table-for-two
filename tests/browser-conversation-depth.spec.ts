import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { attachRestaurantServer, type ClaudeAdapter } from '../server/restaurant';
import { DateApiError } from '../server/restaurant/providers';
import type { DinnerState, SceneTurn } from '../src/restaurant/types';
import { waitForRestaurantScene } from './restaurant-browser-helpers';
import { captionReadingMs } from '../src/restaurant/caption-delivery';

// The user explicitly prohibits launching the game on their computer.
test.skip(!process.env.CI, 'Rendered conversation verification runs in GitHub Actions only.');
let http: Server, app: Awaited<ReturnType<typeof attachRestaurantServer>>, base: string;
const calls: string[] = [];
const STALL = 'A fictional silver lantern waits for the comet.';
const FAIL = 'A fictional clockwork owl loses its signal.';
const REPLY = 'That is an opening. I was expecting a hello, but I appreciate the confidence.';
let stalled = false, aborted = false;
const adapter: ClaudeAdapter = { async *stream(request, signal) {
  const content = request.messages.at(-1)!.content; calls.push(content);
  // Failed turns remain in the real transcript. Match the latest turn note,
  // never an earlier unanswered line merged into this user message.
  const latest = content.slice(content.lastIndexOf('The human just said:')).split('\n')[0];
  if (latest === `The human just said: “${STALL}”`) {
    stalled = true;
    await new Promise<void>(resolve => {
      const finish = () => { aborted = true; resolve(); };
      if (signal.aborted) finish(); else signal.addEventListener('abort', finish, { once: true });
    });
    return;
  }
  if (latest === `The human just said: “${FAIL}”`) throw new DateApiError(503, 'horde_provider', 'The mock reply service is unavailable.');
  const turn: SceneTurn = { utterances: [{ speaker: 'date', text: REPLY, emotion: 'amused' }], emotion: 'amused', action: 'none', memory: 'HUMAN: greeted me. TOLD THEM: nothing personal yet. OPEN: none.' };
  yield { type: 'text', text: JSON.stringify(turn) };
  yield { type: 'usage', usage: { outputTokens: 100 } };
} };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __restaurantState: DinnerState }).__restaurantState);

test.beforeAll(async () => {
  const root = resolve('dist');
  http = createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (app.handle(req, res)) return;
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'index.html' : '.' + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    void readFile(file).then(bytes => {
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary' } as Record<string, string>)[extname(file)] || 'application/octet-stream');
      res.end(bytes);
    }).catch(() => res.writeHead(404).end());
  });
  app = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none' }, claude: adapter, horde: adapter, development: true, ledgerPath: false, autoTick: true });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  await mkdir('.qa', { recursive: true });
});
test.afterAll(async () => { await app?.close(); http?.closeAllConnections(); await new Promise<void>(resolve => http?.close(() => resolve())); });

async function begin(page: Page, speech = false, captions = true) {
  await page.addInitScript(settings => localStorage.setItem('table-for-two-settings', JSON.stringify(settings)), { speech, captions, ambience: false });
  await page.goto(base); await page.locator('#title-start').click(); await page.locator('#mode-solo').click(); await page.locator('#start-date').click();
  await expect(page.locator('#dinner-hud')).toBeVisible(); await waitForRestaurantScene(page);
}
async function send(page: Page, text: string) {
  if (await page.locator('#conversation-form').isHidden()) await page.locator('#type-toggle').click();
  await page.locator('#conversation-input').fill(text); await page.locator('#send-turn').click();
}

test('headers-only replies time out, cancel the old job, and permit the next turn without reset', async ({ page }) => {
  test.setTimeout(90000); stalled = false; aborted = false;
  await page.route('**/api/date/status', async route => {
    const response = await route.fetch(), status = await response.json();
    await route.fulfill({ response, json: { ...status, conversationTimeoutMs: 50, hordeTimeoutMs: 50 } });
  });
  await begin(page); const id = (await state(page)).id;
  await send(page, STALL); await expect.poll(() => stalled).toBe(true);
  await expect(page.locator('#turn-status')).toContainText('thinking');
  await expect.poll(() => aborted, { timeout: 10000 }).toBe(true);
  await expect(page.locator('#send-turn')).toBeEnabled();
  await expect(page.locator('#turn-status')).toContainText('timed out');
  await send(page, 'HI BITCH');
  await expect(page.locator('#conversation-log')).toContainText(REPLY);
  await expect(page.locator('#send-turn')).toBeEnabled();
  expect((await state(page))).toMatchObject({ id, phase: 'playing' });
  await page.screenshot({ path: '.qa/conversation-depth-recovered.png' });
});

test('a provider failure releases controls and the next ordinary reply succeeds', async ({ page }) => {
  await begin(page); const id = (await state(page)).id, before = calls.length;
  await send(page, FAIL); await expect(page.locator('#toast')).toContainText('mock reply service is unavailable');
  await expect(page.locator('#send-turn')).toBeEnabled();
  await send(page, 'What makes a good first impression?');
  await expect(page.locator('#conversation-log')).toContainText(REPLY);
  await expect(page.locator('#send-turn')).toBeEnabled();
  expect(calls.length).toBe(before + 2); expect((await state(page)).id).toBe(id);
});

test('an incomplete reply cancels its queued caption and permits another turn in the same evening', async ({ page }) => {
  test.setTimeout(45000);
  const receipts: { generation: number; completed: boolean }[] = [];
  let failedGeneration = -1, intercept = true;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/playback')) {
      const body = request.postDataJSON();
      if (body.text === REPLY) receipts.push({ generation: body.generation, completed: body.completed });
    }
  });
  await begin(page); const id = (await state(page)).id;
  await page.route('**/api/date/sessions/*/turn', async route => {
    if (!intercept) { await route.continue(); return; }
    intercept = false;
    // The upstream is the local mock adapter. Simulate a broken connection after
    // a valid streamed line, before the terminal snapshot and done arrive.
    const response = await route.fetch();
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    failedGeneration = events.find(event => event.type === 'start').generation;
    const partial = events.filter(event => event.type === 'start' || event.type === 'utterance');
    await route.fulfill({ response, body: partial.map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await send(page, 'Hello before a broken reply.');
  await expect(page.locator('#conversation-log')).toContainText(REPLY);
  await expect(page.locator('#toast')).toContainText('reply was interrupted');
  await expect(page.locator('#send-turn')).toBeEnabled();
  await expect(page.locator('#caption')).toBeHidden();
  expect(failedGeneration).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(captionReadingMs(REPLY) + 250);
  expect(receipts.some(receipt => receipt.generation === failedGeneration && receipt.completed)).toBe(false);
  await send(page, 'Another greeting after the broken reply.');
  await expect.poll(() => receipts.some(receipt => receipt.generation !== failedGeneration && receipt.completed), { timeout: 12000 }).toBe(true);
  expect((await state(page))).toMatchObject({ id, phase: 'playing' });
});

test('unavailable voice uses readable captions and completes only after visible reading', async ({ page }) => {
  const receipts: boolean[] = [];
  await page.route('**/api/date/status', async route => {
    const response = await route.fetch(), status = await response.json();
    await route.fulfill({ response, json: { ...status, speech: true, speechProvider: 'none' } });
  });
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/playback')) {
      const body = request.postDataJSON(); if (body.text === REPLY) receipts.push(body.completed);
    }
  });
  await begin(page, true); await send(page, 'A very ordinary hello.');
  await expect(page.locator('#caption-text')).toHaveText(REPLY);
  expect(receipts.includes(true)).toBe(false);
  await page.screenshot({ path: '.qa/conversation-depth-caption-reading.png' });
  await expect.poll(() => receipts.includes(true), { timeout: 12000 }).toBe(true);
  await page.screenshot({ path: '.qa/conversation-depth-caption-fallback.png' });
});

test('disabled captions cannot manufacture a completed caption-only receipt', async ({ page }) => {
  const completed: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/playback')) {
      const body = request.postDataJSON(); if (body.completed) completed.push(body.text);
    }
  });
  await begin(page, false, false); await send(page, 'Hello without audio or captions.');
  await expect(page.locator('#conversation-log')).toContainText(REPLY);
  await expect(page.locator('#send-turn')).toBeEnabled();
  await expect(page.locator('#caption')).toBeHidden();
  expect(completed.includes(REPLY)).toBe(false);
});

test('disabling then re-enabling a visible caption cancels that reading interval and permits the next delivery', async ({ page }) => {
  const receipts: { generation: number; completed: boolean }[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/playback')) {
      const body = request.postDataJSON();
      if (body.text === REPLY) receipts.push({ generation: body.generation, completed: body.completed });
    }
  });
  await begin(page); await send(page, 'An ordinary greeting before a brief caption interruption.');
  await expect(page.locator('#caption')).toBeVisible();
  await expect(page.locator('#caption-text')).toHaveText(REPLY);
  const generation = (await state(page)).generation;
  // Exercise the actual Settings change handler without opening a pause surface:
  // an unrelated generation cancellation would conceal this subscription bug.
  await page.evaluate(() => {
    const toggle = document.querySelector<HTMLInputElement>('#captions-enabled')!;
    toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true }));
    toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => receipts.some(receipt => receipt.generation === generation && !receipt.completed)).toBe(true);
  await page.waitForTimeout(captionReadingMs(REPLY) + 250);
  expect(receipts.some(receipt => receipt.generation === generation && receipt.completed)).toBe(false);
  await send(page, 'Another ordinary greeting after the interruption.');
  await expect.poll(() => receipts.some(receipt => receipt.generation !== generation && receipt.completed), { timeout: 12000 }).toBe(true);
});
