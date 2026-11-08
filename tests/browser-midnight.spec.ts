import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attachGameServer } from '../server/index';
import type { RoomState } from '../src/shared/protocol';
import { VENUE } from '../src/shared/venue';

const state = (page: Page) => page.evaluate(() => (window as unknown as { __lfsState: RoomState }).__lfsState);

/** Real game server and the production client, isolated from the developer's server. */
async function reviewServer(startClock: number, storyRate: number) {
  const dist = resolve('dist');
  const http = createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    const file = resolve(dist, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!file.startsWith(dist + sep)) { res.statusCode = 403; res.end(); return; }
    try {
      const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  const game = await attachGameServer(http, { startClock, storyRate });
  await new Promise<void>(resolveListen => http.listen(0, '127.0.0.1', resolveListen));
  const port = (http.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/?venue=bowling`, async close() {
    await game.close();
    await new Promise<void>(resolveClose => http.close(() => resolveClose()));
  } };
}

async function pair(browser: Browser, url: string, gateFirstAnimationFrames = false) {
  const contexts: BrowserContext[] = await Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 800 } }),
    browser.newContext({ viewport: { width: 1000, height: 700 } }),
  ]);
  if (gateFirstAnimationFrames) await contexts[0].addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Map<number, { callback: FrameRequestCallback; native?: number }>();
    let paused = false, nextId = 1;
    function schedule(id: number) {
      const entry = pending.get(id);
      if (!entry || paused) return;
      entry.native = request(time => {
        const current = pending.get(id);
        if (!current) return;
        current.native = undefined;
        if (paused) return;
        pending.delete(id); current.callback(time);
      });
    }
    window.requestAnimationFrame = callback => { const id = nextId++; pending.set(id, { callback }); schedule(id); return id; };
    window.cancelAnimationFrame = id => { const entry = pending.get(id); if (entry?.native !== undefined) cancel(entry.native); pending.delete(id); };
    (window as unknown as Window & { __rafGate: { suspend(): number; resume(): void } }).__rafGate = {
      suspend() { paused = true; for (const entry of pending.values()) { if (entry.native !== undefined) cancel(entry.native); entry.native = undefined; } return pending.size; },
      resume() { paused = false; for (const id of pending.keys()) schedule(id); },
    };
  });
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  await a.goto(url); await a.locator('#name').fill('Alex'); await a.locator('#join').click();
  await expect(a.locator('#arrival')).toBeHidden();
  const room = (await state(a)).room;
  await b.goto(url); await b.locator('#name').fill('Sam'); await b.locator('#room').fill(room); await b.locator('#join').click();
  await expect.poll(async () => (await state(a)).phase).toBe('playing');
  return { a, b, errors, async close() { await Promise.all(contexts.map(context => context.close())); } };
}

test('a suspended client presents midnight before revealing its outcome card', async ({ browser }) => {
  test.setTimeout(120_000);
  const server = await reviewServer(VENUE.endTime - 40, 2);
  let players: Awaited<ReturnType<typeof pair>> | undefined;
  try {
    players = await pair(browser, server.url, true);
    const { a, b, errors } = players;
    await expect(a.locator('#midnight-choice')).toBeVisible();
    await expect(b.locator('#midnight-choice')).toBeVisible();
    await a.locator('#kiss-yes').click();
    await expect.poll(async () => (await state(a)).ending.ownChoice).toBe(true);
    expect((await state(b)).ending.ownChoice).toBeNull();
    await b.locator('#kiss-yes').click();
    await expect.poll(async () => (await state(b)).ending.ownChoice).toBe(true);
    expect((await state(a)).ending.phase).toBe('choice');

    // Freeze only client A's rendering; networking, server ticks and real time continue.
    const pending = await a.evaluate(() => (window as unknown as Window & { __rafGate: { suspend(): number } }).__rafGate.suspend());
    expect(pending).toBeGreaterThan(0);
    await b.bringToFront();
    await expect.poll(async () => (await state(a)).ending.phase, { timeout: 40_000 }).toBe('kiss');
    const frozenTick = (await state(a)).tick;
    const frozenAt = Date.now();
    await expect(b.locator('#celebration')).toBeVisible({ timeout: 35_000 });
    const remaining = 6000 - (Date.now() - frozenAt);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    expect((await state(a)).tick).toBeGreaterThan(frozenTick);
    expect((await state(a)).ending.phase).toBe('kiss');
    await expect(a.locator('#celebration')).toBeHidden();

    // B can finish its presentation and continue while A is still suspended.
    await b.locator('#stay').click();
    await expect(b.locator('#celebration')).toBeHidden();
    await b.locator('#chat-toggle').click();
    await expect(b.locator('#chat')).toBeVisible();
    await b.locator('#chat-close').click();
    await expect(b.locator('#chat')).toBeHidden();

    await a.bringToFront();
    await a.evaluate(() => (window as unknown as Window & { __rafGate: { resume(): void } }).__rafGate.resume());
    const resumedAt = Date.now();
    await expect(a.locator('#celebration')).toBeHidden();
    await expect(a.locator('#celebration')).toBeVisible({ timeout: 35_000 });
    expect(Date.now() - resumedAt).toBeGreaterThanOrEqual(5000);
    await expect(a.locator('#celebration-text')).toContainText('luck');
    await a.locator('#stay').click();
    await expect(a.locator('#celebration')).toBeHidden();
    await a.locator('#leave').click();
    await expect(a.locator('#arrival')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await players?.close();
    await server.close();
  }
});

async function walk(page: Page, key: string, axis: 0 | 2, target: number, direction: -1 | 1) {
  await page.bringToFront(); await page.locator('canvas').click({ position: { x: 480, y: 400 } });
  for (let i = 0; i < 70; i++) {
    const p = (await state(page)).players.find(player => player.name === 'Alex')!.position;
    if (direction * (p[axis] - target) >= 0) return;
    await page.keyboard.down(key); await page.waitForTimeout(150); await page.keyboard.up(key);
  }
  throw new Error(`Lane approach blocked: ${JSON.stringify((await state(page)).players)}`);
}

test('private midnight choice can be dismissed, reopened and is cleared by pause', async ({ browser }) => {
  test.setTimeout(90_000);
  const server = await reviewServer(VENUE.endTime - 120, 0);
  let players: Awaited<ReturnType<typeof pair>> | undefined;
  try {
    players = await pair(browser, server.url);
    const { a, b, errors } = players;
    await expect(a.locator('#midnight-choice')).toBeVisible();
    await expect(b.locator('#midnight-choice')).toBeVisible();
    await expect(a.locator('#midnight-hint')).toBeHidden();
    await a.locator('#kiss-yes').click();
    await expect.poll(async () => (await state(a)).ending.ownChoice).toBe(true);
    expect((await state(b)).ending.ownChoice).toBeNull();
    await expect(b.locator('#kiss-yes')).toHaveAttribute('aria-pressed', 'false');
    await expect(b.locator('#kiss-no')).toHaveAttribute('aria-pressed', 'false');
    await a.locator('#midnight-dismiss').click();
    await expect(a.locator('#midnight-choice')).toBeHidden();
    await expect(a.locator('#midnight-hint')).toBeVisible();
    await a.locator('#clock').click();
    await expect(a.locator('#midnight-choice')).toBeVisible();
    await expect(a.locator('#midnight-hint')).toBeHidden();
    await expect(a.locator('#kiss-yes')).toHaveAttribute('aria-pressed', 'true');
    await b.locator('#kiss-no').click();
    await expect.poll(async () => (await state(b)).ending.ownChoice).toBe(false);
    expect((await state(a)).ending.ownChoice).toBe(true);
    await a.locator('#midnight-dismiss').click(); await b.locator('#midnight-dismiss').click();
    await a.locator('#pause').click();
    await expect.poll(async () => (await state(a)).phase).toBe('paused');
    await expect(a.locator('#midnight-hint')).toBeHidden();
    await expect.poll(async () => (await state(a)).ending.ownChoice).toBeNull();
    await expect.poll(async () => (await state(b)).ending.ownChoice).toBeNull();
    await expect(a.locator('#pause-description')).toContainText(/choice/i);
    await a.locator('#resume').click(); await b.locator('#resume').click();
    await expect.poll(async () => (await state(a)).phase).toBe('playing');
    await expect(a.locator('#midnight-choice')).toBeVisible();
    await expect(b.locator('#midnight-choice')).toBeVisible();
    await expect(a.locator('#kiss-yes')).toHaveAttribute('aria-pressed', 'false');
    await expect(b.locator('#kiss-no')).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  } finally { await players?.close(); await server.close(); }
});

test('a rolling ball finishes before the choice and midnight blocks another shot', async ({ browser }) => {
  test.setTimeout(150_000);
  const server = await reviewServer(VENUE.endTime - 700, 10);
  let players: Awaited<ReturnType<typeof pair>> | undefined;
  try {
    players = await pair(browser, server.url);
    const { a, b, errors } = players;
    await expect(a.locator('#clock')).toBeDisabled();
    await expect(a.locator('#midnight-hint')).toBeHidden();
    await walk(a, 'w', 2, 2.2, -1); await walk(a, 'a', 0, VENUE.laneX + 1.8, -1);
    await a.locator('#interact').click(); await expect(a.locator('#bowling')).toBeVisible();
    await expect.poll(async () => (await state(a)).clockSeconds, { timeout: 50_000, intervals: [100] }).toBeGreaterThanOrEqual(VENUE.endTime - 312);
    expect((await state(a)).ending.phase).toBe('waiting');
    await a.locator('#bowl').click();
    await expect.poll(async () => (await state(a)).lane.canBowl).toBe(false);
    await expect.poll(async () => (await state(a)).clockSeconds, { timeout: 10_000, intervals: [100] }).toBeGreaterThanOrEqual(VENUE.endTime - 300);
    expect((await state(a)).lane.canReset).toBe(false);
    await expect(a.locator('#midnight-choice')).toBeHidden();
    await expect.poll(async () => (await state(a)).lane.canReset, { timeout: 40_000 }).toBe(true);
    await expect(a.locator('#midnight-choice')).toBeVisible();
    await expect(b.locator('#midnight-choice')).toBeVisible();
    await a.locator('#midnight-dismiss').click(); await b.locator('#midnight-dismiss').click();
    await expect(a.locator('#bowling')).toBeVisible();
    await a.locator('#reset-lane').click();
    await expect.poll(async () => (await state(a)).lane.canBowl).toBe(true);
    await expect.poll(async () => (await state(a)).clockSeconds, { timeout: 40_000, intervals: [100] }).toBeGreaterThanOrEqual(VENUE.endTime - 15);
    expect((await state(a)).clockSeconds).toBeLessThan(VENUE.endTime);
    await a.locator('#bowl').click();
    await expect.poll(async () => (await state(a)).lane.canBowl).toBe(false);
    await expect.poll(async () => (await state(a)).clockSeconds, { timeout: 10_000, intervals: [100] }).toBe(VENUE.endTime);
    expect((await state(a)).lane.canReset).toBe(false);
    await expect.poll(async () => (await state(a)).lane.canReset, { timeout: 40_000 }).toBe(true);
    await a.locator('#reset-lane').click();
    await expect.poll(async () => (await state(a)).lane.bowler).toBeNull();
    await expect(a.locator('#bowl')).toBeDisabled();
    expect((await state(a)).ending.phase).toBe('choice');
    expect(errors).toEqual([]);
  } finally { await players?.close(); await server.close(); }
});
