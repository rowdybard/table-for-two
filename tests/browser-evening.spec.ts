import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { attachRestaurantServer } from '../server/restaurant';
import type { DinnerState } from '../src/restaurant/types';
import { captureRestaurantScene, restaurantInterrupted, restaurantScenario, resolveRestaurantScenario, waitForRestaurantScene } from './restaurant-browser-helpers';

let http: Server, app: Awaited<ReturnType<typeof attachRestaurantServer>>, base = '';
const state = (page: Page) => page.evaluate(() => (window as unknown as { __restaurantState: DinnerState }).__restaurantState);
test.beforeAll(async () => {
  const root = resolve('dist');
  http = createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (app.handle(req, res)) return;
    const pathname = new URL(req.url || '/', 'http://localhost').pathname, file = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    void readFile(file).then(data => { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' } as Record<string, string>)[extname(file)] || 'application/octet-stream'); res.end(data); }).catch(() => res.writeHead(404).end());
  });
  // Only the authored story clock is accelerated. Movement and the real coaster world stay at normal speed.
  app = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none' }, ledgerPath: false, development: true, storyRate: 30, scenarioId: 'family-visit' });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  await mkdir('.qa', { recursive: true });
});
test.afterAll(async () => { await app.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });

async function openTableActions(page: Page) {
  const drawer = page.locator('#evening-panel > .action-drawer');
  // Desktop hides the closed drawer; G opens it and releases pointer capture.
  if (!await drawer.evaluate((node: HTMLDetailsElement) => node.open)) await page.keyboard.press('g');
  await expect(drawer).toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false);
}
async function action(page: Page, key: string) {
  const recovery = ['inspect-ticket', 'return-order', 'keep-order', 'wipe', 'steady-glass', 'ask-quiet', 'let-it-go', 'apologize'].includes(key);
  const desiredBites = key === 'taste' ? (await state(page)).evening.main.bites + 1 : null;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const snapshot = await state(page);
    if (desiredBites !== null && snapshot.evening.main.bites >= desiredBites) return;
    if (!recovery && restaurantInterrupted(snapshot)) { await resolveIncident(page); continue; }
    await openTableActions(page);
    const control = page.locator(`[data-evening="${key}"]`);
    if (!await control.isVisible()) { await page.waitForTimeout(80); continue; }
    try { await control.click({ timeout: 2000 }); }
    catch (error) { if (!recovery && restaurantInterrupted(await state(page))) continue; throw error; }
    if (desiredBites === null) return;
    // A timed interruption can win the race with the network command. Retry
    // only after observing that interruption and confirming no bite was taken.
    await expect.poll(async () => { const current = await state(page); return current.evening.main.bites >= desiredBites || restaurantInterrupted(current); }, { timeout: Math.max(100, deadline - Date.now()) }).toBe(true);
    if ((await state(page)).evening.main.bites >= desiredBites) return;
  }
  throw new Error(`The visible ${key} action did not become available before the deadline.`);
}
async function resolveIncident(page: Page) {
  if (await resolveRestaurantScenario(page, () => state(page), () => openTableActions(page))) return;
  const event = (await state(page)).evening.incident?.event;
  if (!event) return;
  if (event === 'wrong-order') {
    if (!(await state(page)).evening.incident!.progress) { await action(page, 'inspect-ticket'); await expect.poll(async () => (await state(page)).evening.incident?.progress).toBe(1); }
    await action(page, 'return-order');
  } else if (event === 'spilled-drink') {
    for (let progress = (await state(page)).evening.incident!.progress; progress < 3; progress++) {
      await action(page, 'wipe');
      await expect.poll(async () => (await state(page)).evening.incident?.progress).toBe(progress + 1);
      // The server gives the napkin 100ms to soak between accepted wipes.
      if (progress < 2) await page.waitForTimeout(120);
    }
    await action(page, 'steady-glass');
  } else await action(page, 'ask-quiet');
  await expect.poll(async () => !!(await state(page)).evening.resolutions[event]).toBe(true);
}
async function awaitCourse(page: Page, predicate: (state: DinnerState) => boolean) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) { const snapshot = await state(page); if (predicate(snapshot)) break; if (restaurantInterrupted(snapshot)) await resolveIncident(page); else await page.waitForTimeout(100); }
  await expect.poll(async () => predicate(await state(page))).toBe(true);
}
async function finishMain(page: Page) {
  const deadline = Date.now() + 15_000;
  while ((await state(page)).evening.main.status !== 'finished' && Date.now() < deadline) {
    if (restaurantInterrupted(await state(page))) await resolveIncident(page);
    else {
      await openTableActions(page);
      await page.locator('[data-evening="finish-main"]').click({ timeout: 650 }).catch(() => {});
      await page.waitForTimeout(120);
    }
  }
  await expect.poll(async () => (await state(page)).evening.main.status).toBe('finished');
}
async function awaitBill(page: Page) {
  const deadline = Date.now() + 15_000;
  // A timed interruption can replace the bill control between its appearance
  // and the click. Recover at the table, then ask through the visible button.
  while (!await page.locator('#bill-dialog').isVisible() && Date.now() < deadline) {
    if (restaurantInterrupted(await state(page))) await resolveIncident(page);
    else {
      await openTableActions(page);
      const button = page.getByRole('button', { name: /^(Ask for|Look at) the bill$/ });
      if (await button.isVisible()) {
        try { await button.click({ timeout: 5000 }); }
        catch (error) { if (restaurantInterrupted(await state(page))) continue; throw error; }
      }
      await page.waitForTimeout(120);
    }
  }
  await expect(page.locator('#bill-dialog')).toBeVisible();
}
async function openActivity(page: Page, kind: 'coasters' | 'napkin' | 'dessert') {
  const deadline = Date.now() + 12_000;
  const panel = page.locator('#activities-panel[data-activity="' + kind + '"] .ta-panel');
  while (Date.now() < deadline) {
    if (restaurantInterrupted(await state(page))) { await resolveIncident(page); continue; }
    if (await panel.isVisible()) return;
    await openTableActions(page);
    if (kind !== 'dessert') {
      const games = page.locator('#table-play');
      if (!await games.evaluate((node: HTMLDetailsElement) => node.open)) await games.locator(':scope > summary').click();
    }
    const control = kind === 'dessert' ? page.getByRole('button', { name: 'Share dessert', exact: true }) : page.locator(kind === 'coasters' ? '#play-coasters' : '#play-napkin');
    try { await control.click({ timeout: 2000 }); }
    catch (error) { if (restaurantInterrupted(await state(page))) continue; throw error; }
    await expect.poll(async () => await panel.isVisible() || restaurantInterrupted(await state(page))).toBe(true);
  }
  throw new Error('The ' + kind + ' activity did not open after handling interruptions.');
}
async function arrive(page: Page, dateId: string, mode: 'solo' | 'blind' = 'solo') {
  await page.goto(base);
  await expect(page.locator('#title-start')).toBeFocused({ timeout: 15000 });
  await page.keyboard.press('Enter');
  if (mode === 'blind') await page.locator('#mode-blind').click();
  else { await page.locator('#mode-solo').click(); await page.locator(`[data-date="${dateId}"]`).click(); await page.locator('#start-date').click(); }
  await expect(page.locator('#dinner-hud')).toBeVisible();
  await waitForRestaurantScene(page);
  for (let i = 0; i < 24 && (await state(page)).participants[0].position[2] > 1.5; i++) { await page.keyboard.down('w'); await page.waitForTimeout(180); await page.keyboard.up('w'); }
  await page.mouse.move(640, 390); await page.mouse.down(); await page.mouse.move(640, 610, { steps: 9 }); await page.mouse.up();
  await expect(page.locator('#interaction')).toContainText(/seat/i); await page.keyboard.press('e');
  await expect.poll(async () => (await state(page)).seated).toBe(true);
  // Escape releases captured mouse and pauses; Resume keeps the physical seat.
  await page.keyboard.press('Escape'); await expect(page.locator('#pause-dialog')).toBeVisible(); await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await openTableActions(page);
  await page.locator('#table-menu').click();
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'Reading the dinner menu at the table');
  await page.locator('[data-order="Wild mushroom risotto"]').click();
  await expect.poll(async () => (await state(page)).evening.main.status, { timeout: 8000 }).toBe('served');
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'First-person view of Table for Two restaurant');
  await openTableActions(page);
}

test('complete authored evening: physical play, drawing, recoveries, dessert, bill, walking goodbye and memento', async ({ page }) => {
  test.setTimeout(180_000); page.setDefaultTimeout(10_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await arrive(page, 'mira');
  const startDeadline = Date.now() + 12_000;
  while ((await state(page)).evening.coasters.phase === 'idle' && Date.now() < startDeadline) {
    await openActivity(page, 'coasters');
    const start = page.locator('#activities-panel').getByRole('button', { name: 'Play', exact: true });
    try { await start.click({ timeout: 2000 }); }
    catch (error) { if (restaurantInterrupted(await state(page))) continue; throw error; }
    await expect.poll(async () => (await state(page)).evening.coasters.phase !== 'idle' || restaurantInterrupted(await state(page))).toBe(true);
  }
  expect((await state(page)).evening.coasters.phase).not.toBe('idle');
  const deadline = Date.now() + 65_000;
  while ((await state(page)).evening.coasters.phase !== 'complete' && Date.now() < deadline) {
    const snapshot = await state(page);
    if (restaurantInterrupted(snapshot)) await resolveIncident(page);
    else {
      await openActivity(page, 'coasters');
      if (snapshot.evening.coasters.phase === 'aiming' && snapshot.evening.coasters.turn === 'human') {
      const shoot = page.getByRole('button', { name: 'Shoot', exact: true });
      if (await shoot.isEnabled()) await shoot.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(160);
      } else await page.waitForTimeout(180);
    }
  }
  expect((await state(page)).evening.coasters.phase).toBe('complete');
  expect((await state(page)).evening.coasters.shots).toBe(6);
  await openActivity(page, 'coasters');
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'Looking down at the physical coaster board');
  await captureRestaurantScene(page, '.qa/full-evening-coasters.png');
  await page.getByRole('button', { name: 'Close table activity' }).click();
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'First-person view of Table for Two restaurant');
  await awaitCourse(page, snapshot => !!snapshot.evening.resolutions['wrong-order']);
  for (let bite = (await state(page)).evening.main.bites; bite < 3; bite++) { await action(page, 'taste'); await expect.poll(async () => (await state(page)).evening.main.bites).toBe(bite + 1); await page.waitForTimeout(520); }
  await finishMain(page);
  await awaitCourse(page, snapshot => !!snapshot.evening.resolutions['spilled-drink']);
  await openActivity(page, 'napkin');
  const napkin = page.locator('#activities-panel canvas'); const box = (await napkin.boundingBox())!;
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .4); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .6, { steps: 18 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Save our napkin', exact: true }).click();
  await expect.poll(async () => (await state(page)).evening.napkin.complete).toBe(true);
  await captureRestaurantScene(page, '.qa/full-evening-napkin.png');
  await page.getByRole('button', { name: 'Close table activity' }).click();
  await page.getByRole('button', { name: 'Look at the dessert menu', exact: true }).click();
  await page.locator('[data-dessert="lemon"]').click();
  await awaitCourse(page, snapshot => snapshot.evening.dessert.status === 'served');
  if (restaurantInterrupted(await state(page))) await resolveIncident(page);
  await openActivity(page, 'dessert');
  await page.locator('#activities-panel .ta-serving > summary').click();
  for (let piece = 0; piece < 4; piece++) {
    const row = page.locator('.ta-piece-row').nth(piece);
    await row.getByRole('button', { name: piece % 2 ? /date|mira/i : /you|me/i }).click();
    await expect.poll(async () => (await state(page)).evening.dessert.portions.length).toBe(piece + 1);
  }
  await captureRestaurantScene(page, '.qa/full-evening-dessert.png');
  await page.getByRole('button', { name: 'Close table activity' }).click();
  await awaitCourse(page, snapshot => !!snapshot.evening.resolutions['disruptive-diner']);
  await action(page, 'finish-dessert');
  await awaitCourse(page, snapshot => snapshot.evening.dessert.status === 'finished');
  await awaitBill(page);
  await page.locator('[data-settlement="split"]').click();
  await expect.poll(async () => (await state(page)).evening.chapter).toBe('farewell');
  await page.locator('#table-stand').click(); await expect.poll(async () => (await state(page)).seated).toBe(false);
  await waitForRestaurantScene(page);
  for (let i = 0; i < 20 && (await state(page)).participants[0].position[2] < 4.2; i++) { await page.keyboard.down('s'); await page.waitForTimeout(160); await page.keyboard.up('s'); }
  await expect.poll(async () => (await state(page)).participants[0].position[2]).toBeGreaterThanOrEqual(4.2);
  await openTableActions(page);
  await page.getByRole('button', { name: 'Say goodnight at the door', exact: true }).click();
  await expect(page.locator('#farewell-dialog')).toBeVisible(); await page.locator('[data-farewell="again"]').click();
  await expect(page.locator('#ending-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#ending-title')).toContainText('A good kind of company');
  expect((await state(page)).evening.farewell.ending?.kind).toBe('new-friend');
  expect((await state(page)).evening.agenda?.score, 'activities alone do not establish understanding or buy another date').toBe(0);
  expect((await state(page)).evening.sharedActivities).toEqual(expect.arrayContaining(['coasters', 'napkin', 'dessert']));
  const completed = await state(page);
  expect(completed.evening.resolutions['wrong-order']).toBeTruthy();
  expect(completed.evening.resolutions['spilled-drink']).toBeTruthy();
  expect(completed.evening.resolutions['disruptive-diner']).toBeTruthy();
  expect(restaurantScenario(completed)?.phase).toBe('resolved');
  expect(restaurantScenario(completed)?.decisions).toHaveLength(2);
  expect(completed.evening.moments.some(moment => moment.id === 'scenario-family-visit')).toBe(true);
  expect((await state(page)).usage.claudeRequests).toBe(0);
  const downloadEvent = page.waitForEvent('download'); await page.locator('#save-postcard').click(); const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('table-for-two-mira.png');
  await captureRestaurantScene(page, '.qa/full-evening-ending.png');
  await page.locator('#new-date').click(); await expect(page.locator('#past-evenings')).toBeVisible();
  await page.locator('#past-evenings').click(); await expect(page.locator('#past-evenings-list')).toContainText('Mira');
  expect(errors).toEqual([]);
});

test('an evening can skip table games and dessert and end as friendship', async ({ page }) => {
  test.setTimeout(100_000); page.setDefaultTimeout(10_000);
  await arrive(page, 'jules'); await resolveIncident(page);
  for (let bite = 0; bite < 3; bite++) {
    if (restaurantInterrupted(await state(page))) await resolveIncident(page);
    await action(page, 'taste'); await expect.poll(async () => (await state(page)).evening.main.bites).toBe(bite + 1); await page.waitForTimeout(520);
  }
  await finishMain(page);
  await action(page, 'skip-dessert');
  await awaitCourse(page, snapshot => snapshot.evening.dessert.status === 'skipped');
  await awaitBill(page);
  await page.locator('[data-settlement="separate"]').click();
  await page.locator('#table-stand').click();
  await expect.poll(async () => (await state(page)).seated).toBe(false);
  await waitForRestaurantScene(page);
  for (let i = 0; i < 20 && (await state(page)).participants[0].position[2] < 4.2; i++) { await page.keyboard.down('s'); await page.waitForTimeout(160); await page.keyboard.up('s'); }
  await expect.poll(async () => (await state(page)).participants[0].position[2]).toBeGreaterThanOrEqual(4.2);
  await openTableActions(page);
  await page.getByRole('button', { name: 'Say goodnight at the door', exact: true }).click();
  await page.locator('[data-farewell="friendly"]').click();
  await expect(page.locator('#ending-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#ending-title')).toContainText('A good kind of company');
  expect((await state(page)).evening.farewell.ending?.kind).toBe('new-friend');
  expect((await state(page)).evening.sharedActivities).toHaveLength(0);
  await captureRestaurantScene(page, '.qa/full-evening-friendship.png');
});

async function careAction(page: Page, key: 'offer-taste' | 'toast' | 'request-water' | 'check-in', choice?: string) {
  const deadline = Date.now() + 20000;
  const applied = (snapshot: DinnerState) => {
    const care = snapshot.evening.care;
    return key === 'offer-taste' ? !!care.tasteOffer : key === 'toast' ? !!care.toast : key === 'request-water' ? care.water.status !== 'none' : !!care.checkIn;
  };
  while (Date.now() < deadline) {
    const snapshot = await state(page);
    if (applied(snapshot)) return;
    if (restaurantInterrupted(snapshot)) { await resolveIncident(page); continue; }
    try {
      await openTableActions(page);
      const gestures = page.locator('#evening-action-buttons .care-actions');
      if (!await gestures.evaluate((node: HTMLDetailsElement) => node.open)) await gestures.locator(':scope > summary').click({ timeout: 5000 });
      if (key === 'toast') {
        const toast = gestures.locator('.toast-actions');
        if (!await toast.evaluate((node: HTMLDetailsElement) => node.open)) await toast.locator(':scope > summary').click({ timeout: 5000 });
      }
      const control = gestures.locator(`[data-evening="${key}"]${choice ? `[data-choice="${choice}"]` : ''}`);
      await control.click({ timeout: 5000 });
      await expect.poll(async () => { const next = await state(page); return applied(next) || restaurantInterrupted(next); }).toBe(true);
      if (applied(await state(page))) return;
    }
    catch (error) { if (restaurantInterrupted(await state(page))) continue; throw error; }
  }
  throw new Error(`The ${key} gesture did not become usable after table interruptions.`);
}

for (const mode of ['solo', 'blind'] as const) test(`${mode} evening: two story decisions, character-led gestures, service and reload preserve the actual evening`, async ({ page }) => {
  test.setTimeout(120000); page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  if (mode === 'blind') await page.setViewportSize({ width: 1000, height: 700 });
  await arrive(page, 'mira', mode);
  await awaitCourse(page, snapshot => restaurantScenario(snapshot)?.phase === 'active');
  const first = restaurantScenario(await state(page))!;
  expect(first.id).toBe('family-visit'); expect(first.beat).toBe('setup'); expect(first.decisions).toHaveLength(0);
  await openTableActions(page); await page.locator(`[data-scenario="${first.choices[0].id}"]`).click();
  await expect.poll(async () => restaurantScenario(await state(page))?.beat).toBe('follow-through');
  const follow = restaurantScenario(await state(page))!;
  expect(follow.phase).toBe('active'); expect(follow.decisions).toHaveLength(1); expect(follow.description).not.toBe(first.description);
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
  const choices = page.locator('#evening-action-buttons [data-scenario]');
  expect(await choices.count()).toBe(follow.choices.length);
  expect((await state(page)).evening.moments.some(moment => moment.id === 'scenario-family-visit')).toBe(false);
  await openTableActions(page); await page.locator(`[data-scenario="${follow.choices[0].id}"]`).click();
  await expect.poll(async () => restaurantScenario(await state(page))?.phase).toBe('resolved');
  expect(restaurantScenario(await state(page))?.decisions).toHaveLength(2);
  expect((await state(page)).evening.moments.some(moment => moment.id === 'scenario-family-visit')).toBe(true);

  await careAction(page, 'offer-taste');
  await expect.poll(async () => !!(await state(page)).evening.care.tasteOffer).toBe(true);
  const offered = (await state(page)).evening.care.tasteOffer!;
  expect(['accepted','declined']).toContain(offered.result); expect(offered.dish).toBe((await state(page)).evening.main.servedDish);
  await expect(page.locator('[data-evening="offer-taste"]')).toHaveCount(0);
  await careAction(page, 'toast', 'honesty');
  await expect.poll(async () => (await state(page)).evening.care.toast?.intention).toBe('honesty');
  await expect(page.locator('[data-evening="toast"]')).toHaveCount(0);
  await careAction(page, 'request-water');
  await expect.poll(async () => (await state(page)).evening.care.water.status).toBe('served');
  await careAction(page, 'check-in');
  await expect.poll(async () => !!(await state(page)).evening.care.checkIn).toBe(true);
  const completed = await state(page);
  expect(completed.evening.moments.filter(moment => moment.id === 'scenario-family-visit')).toHaveLength(1);
  expect(completed.usage.claudeRequests).toBe(0);
  const care = completed.evening.care, story = restaurantScenario(completed), seed = completed.blindDate?.seed;
  await page.reload(); await expect(page.locator('#pause-dialog')).toBeVisible({ timeout: 15000 });
  await page.locator('#resume-date').click(); await waitForRestaurantScene(page);
  expect((await state(page)).evening.care).toEqual(care);
  expect(restaurantScenario(await state(page))).toEqual(story);
  if (mode === 'blind') expect((await state(page)).blindDate?.seed).toBe(seed);
  await openTableActions(page);
  expect(await page.locator('[data-evening="offer-taste"], [data-evening="toast"], [data-evening="request-water"], [data-evening="check-in"]').count()).toBe(0);
  if (mode === 'blind') {
    for (let bite = (await state(page)).evening.main.bites; bite < 3; bite++) {
      await action(page, 'taste'); await expect.poll(async () => (await state(page)).evening.main.bites).toBe(bite + 1); await page.waitForTimeout(520);
    }
    await finishMain(page); await action(page, 'skip-dessert');
    await awaitCourse(page, snapshot => snapshot.evening.dessert.status === 'skipped');
    await awaitBill(page);
    await page.locator('[data-settlement="separate"]').click();
    await page.locator('#table-stand').click(); await expect.poll(async () => (await state(page)).seated).toBe(false);
    for (let i = 0; i < 20 && (await state(page)).participants[0].position[2] < 4.2; i++) { await page.keyboard.down('s'); await page.waitForTimeout(160); await page.keyboard.up('s'); }
    await expect.poll(async () => (await state(page)).participants[0].position[2]).toBeGreaterThanOrEqual(4.2);
    await openTableActions(page); await page.getByRole('button', { name: 'Say goodnight at the door', exact: true }).click();
    await page.locator('[data-farewell="friendly"]').click();
    await expect.poll(async () => (await state(page)).evening.farewell.ending?.kind, { timeout: 15000 }).toBe('new-friend');
    expect((await state(page)).blindDate?.seed).toBe(seed);
  } else {
    await page.keyboard.press('g');
    await page.keyboard.press('Escape'); await expect(page.locator('#pause-dialog')).toBeVisible(); await page.locator('#finish-date').click();
  }
  await expect(page.locator('#ending-screen')).toBeVisible(); expect(errors).toEqual([]);
});
