import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { attachRestaurantServer } from '../server/restaurant';
import { CHARACTER_STORIES } from '../src/restaurant/story';
import { EVENING_PACE } from '../src/restaurant/evening';
import type { DinnerCommand, DinnerState } from '../src/restaurant/types';
import { RESTAURANT_BROWSER_STORY_RATE, captureRestaurantScene, restaurantInterrupted, restaurantScenario, resolveRestaurantScenario, waitForRestaurantScene } from './restaurant-browser-helpers';

let http: Server, app: Awaited<ReturnType<typeof attachRestaurantServer>>, base = '';
const state = (page: Page) => page.evaluate(() => (window as unknown as { __restaurantState: DinnerState }).__restaurantState);
// Preserve the existing UI allowance; add only the extra wall time for the slower story clock.
const storyWait = (baseMs: number, sceneSeconds: number) => Math.ceil(baseMs + sceneSeconds * (1 / RESTAURANT_BROWSER_STORY_RATE - 1 / 30) * 1000);
const fullEveningSeconds = EVENING_PACE.mainKitchen + EVENING_PACE.mainCourse + EVENING_PACE.dessertDecision + EVENING_PACE.dessertKitchen + EVENING_PACE.dessertCourse + EVENING_PACE.checkDelay;
test.beforeAll(async () => {
  const root = resolve('dist');
  http = createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (app.handle(req, res)) return;
    const pathname = new URL(req.url || '/', 'http://localhost').pathname, file = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    void readFile(file).then(data => { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' } as Record<string, string>)[extname(file)] || 'application/octet-stream'); res.end(data); }).catch(() => res.writeHead(404).end());
  });
  // Only the authored story clock is accelerated. Movement and the physical table stay at normal speed.
  app = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none' }, ledgerPath: false, development: true, storyRate: RESTAURANT_BROWSER_STORY_RATE, scenarioId: 'family-visit' });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  await mkdir('.qa', { recursive: true });
});
test.afterAll(async () => { await app.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });

/** The table's own HTTP command route, exactly as the plate and glass use it when aimed at. */
const command = (page: Page, body: DinnerCommand) => page.evaluate(async body => {
  const saved = JSON.parse(sessionStorage.getItem('table-for-two-session')!) as { id: string; token: string };
  const response = await fetch(`/api/date/sessions/${saved.id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saved.token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) as { error?: string } | null };
}, body);
/** Chips sit on the prompt line. Looking around here is a drag, so the pointer is never captured away from them. */
async function prompt(page: Page) {
  expect(await page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  if (await page.locator('#bill-dialog').isVisible()) await page.locator('#bill-close').click();
  if (await page.locator('#conversation-form').isVisible()) await page.keyboard.press('Escape');
  if (await page.locator('#tabletop-inspector').isVisible()) await page.keyboard.press('Escape');
}
async function chip(page: Page, selector: string, timeout = 5000) {
  await prompt(page);
  const control = page.locator(`#prompt-chips ${selector}`);
  await expect(control).toBeVisible({ timeout }); await expect(control).toBeEnabled({ timeout });
  await control.click({ timeout });
}
async function resolveIncident(page: Page) {
  if (await resolveRestaurantScenario(page, () => state(page), () => prompt(page))) return;
  const event = (await state(page)).evening.incident?.event;
  if (!event) return;
  if (event === 'wrong-order') {
    if (!(await state(page)).evening.incident!.progress) { await chip(page, '[data-evening="inspect-ticket"]'); await expect.poll(async () => (await state(page)).evening.incident?.progress).toBe(1); }
    await chip(page, '[data-evening="return-order"]');
  } else if (event === 'spilled-drink') {
    for (let progress = (await state(page)).evening.incident!.progress; progress < 3; progress++) {
      await chip(page, '[data-evening="wipe"]');
      await expect.poll(async () => (await state(page)).evening.incident?.progress).toBe(progress + 1);
      // The server gives the napkin 100ms to soak between accepted wipes.
      if (progress < 2) await page.waitForTimeout(120);
    }
    await chip(page, '[data-evening="steady-glass"]');
  } else await chip(page, '[data-evening="ask-quiet"]');
  await expect.poll(async () => !!(await state(page)).evening.resolutions[event]).toBe(true);
}
/** Eli and the date carry the courses; the test only clears what interrupts them. */
async function awaitCourse(page: Page, predicate: (snapshot: DinnerState) => boolean, label: string, timeout = storyWait(15_000, EVENING_PACE.mainAfterEating)) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = await state(page);
    if (predicate(snapshot)) return snapshot;
    if (restaurantInterrupted(snapshot)) await resolveIncident(page); else await page.waitForTimeout(100);
  }
  await expect.poll(async () => predicate(await state(page)), { message: label }).toBe(true);
  return state(page);
}
/** Eating is a physical table action (aim at the plate, E); it reaches the same server route here. */
async function eat(page: Page, target: 'meal' | 'dessert', bites: number) {
  const read = async () => (await state(page)).evening[target === 'meal' ? 'main' : 'dessert'].bites;
  const deadline = Date.now() + 20_000;
  while (await read() < bites && Date.now() < deadline) {
    if (restaurantInterrupted(await state(page))) { await resolveIncident(page); continue; }
    const result = await command(page, { type: 'interact', target });
    if (result.status !== 200 && !/first\.$/.test(result.body?.error ?? '') && !restaurantInterrupted(await state(page))) throw new Error(`Eating was refused: ${result.status} ${result.body?.error}`);
    await page.waitForTimeout(520);
  }
  expect(await read()).toBeGreaterThanOrEqual(bites);
}
/** The offer stays open for forty scene seconds, then the date picks. */
async function chooseDessert(page: Page, choice: string | 'skip') {
  await awaitCourse(page, snapshot => snapshot.evening.main.status === 'finished', 'the main course cleared');
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await state(page);
    if (snapshot.evening.dessert.status !== 'none') break;
    if (restaurantInterrupted(snapshot)) { await resolveIncident(page); continue; }
    await prompt(page);
    try {
      await expect(page.locator('#prompt-copy')).toHaveText('Eli offers dessert to share.', { timeout: 2000 });
      await page.locator(`#prompt-chips ${choice === 'skip' ? '[data-evening="skip-dessert"]' : `[data-evening="order-dessert"][data-choice="${choice}"]`}`).click({ timeout: 2000 });
    } catch (error) { const current = await state(page); if (current.evening.dessert.status === 'none' && !restaurantInterrupted(current)) throw error; }
    break;
  }
  await expect.poll(async () => (await state(page)).evening.dessert.status).not.toBe('none');
}
async function awaitCheck(page: Page) {
  await awaitCourse(page, snapshot => snapshot.evening.bill.requested, 'Eli leaving the check', storyWait(20_000, EVENING_PACE.checkDelay));
  await prompt(page);
  await expect(page.locator('#prompt-copy')).toHaveText('Eli left the check.');
}
/** Keep the real movement key held across slow render frames; short taps can all fall between frames. */
async function walkUntil(page: Page, key: 'w' | 's', arrived: (snapshot: DinnerState) => boolean, message: string) {
  await page.keyboard.down(key);
  try {
    await expect.poll(async () => arrived(await state(page)), { message, timeout: 15_000, intervals: [100] }).toBe(true);
  } finally { await page.keyboard.up(key); }
}
/** Looking down at the chair stands a guest up; the door is a short walk behind the table. */
async function walkToTheDoor(page: Page) {
  await prompt(page);
  const viewport = page.viewportSize()!;
  for (let drag = 0; drag < 2; drag++) {
    await page.mouse.move(viewport.width / 2, viewport.height * .2); await page.mouse.down();
    await page.mouse.move(viewport.width / 2, viewport.height * .95, { steps: 10 }); await page.mouse.up();
  }
  await expect(page.locator('#interaction')).toBeVisible();
  await expect(page.locator('#interaction-label')).toHaveText('Stand up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await state(page)).seated).toBe(false);
  await waitForRestaurantScene(page);
  await walkUntil(page, 's', snapshot => snapshot.participants[0].position[2] >= 4.2, 'walking back to the restaurant door');
  await expect.poll(async () => (await state(page)).participants[0].position[2]).toBeGreaterThanOrEqual(4.2);
  await expect(page.locator('#prompt-copy')).toHaveText('One last thing, at the door.');
}
async function arrive(page: Page, dateId: string, mode: 'solo' | 'blind' = 'solo') {
  await page.goto(base);
  await expect(page.locator('#title-start')).toBeFocused({ timeout: 15000 });
  await page.keyboard.press('Enter');
  // Starting Blind is a same-page transition; the HUD and scene gates below establish readiness.
  if (mode === 'blind') await page.locator('#mode-blind').click({ noWaitAfter: true });
  else { await page.locator('#mode-solo').click(); await page.locator(`[data-date="${dateId}"]`).click(); await page.locator('#start-date').click(); }
  await expect(page.locator('#dinner-hud')).toBeVisible();
  await waitForRestaurantScene(page);
  await expect(page.locator('#prompt-line')).toBeHidden();
  await walkUntil(page, 'w', snapshot => snapshot.participants[0].position[2] <= 1.5, 'walking within reach of the table seat');
  await page.mouse.move(640, 390); await page.mouse.down(); await page.mouse.move(640, 610, { steps: 9 }); await page.mouse.up();
  await expect(page.locator('#interaction')).toBeVisible();
  await expect(page.locator('#interaction-label')).toHaveText('Take your seat'); await page.keyboard.press('e');
  await expect.poll(async () => (await state(page)).seated).toBe(true);
  // Escape releases captured mouse and pauses; Resume keeps the physical seat.
  await page.keyboard.press('Escape'); await expect(page.locator('#pause-dialog')).toBeVisible(); await page.locator('#resume-date').click();
  await expect.poll(async () => (await state(page)).phase).toBe('playing');
  await expect(page.locator('#prompt-copy')).toHaveText('Look over the menu whenever you’re ready.');
  await chip(page, 'button:has-text("Open the menu")');
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'Reading the dinner menu at the table');
  await page.locator('[data-order="Wild mushroom risotto"]').click();
  await expect.poll(async () => (await state(page)).evening.main.status, { timeout: storyWait(8000, EVENING_PACE.mainKitchen) }).toBe('served');
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-label', 'First-person view of Table for Two restaurant');
}

test('complete authored evening: a wrong plate, a spill, dinner, a shared dessert, one check, the walk to the door and a memento', async ({ page }) => {
  test.setTimeout(storyWait(180_000, fullEveningSeconds)); page.setDefaultTimeout(10_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await arrive(page, 'mira');
  // The wrong plate arrives with service, before any bite; the prompt line carries the recovery.
  await awaitCourse(page, snapshot => !!snapshot.evening.resolutions['wrong-order'], 'the wrong plate sent back');
  await expect(page.locator('#prompt-chips [data-evening="taste"]')).toHaveCount(0);
  await eat(page, 'meal', 3);
  await awaitCourse(page, snapshot => snapshot.evening.main.status === 'finished', 'Eli clearing the plates');
  expect((await state(page)).evening.cues.some(cue => cue.key === 'main-finished' && cue.utterances[0]!.speaker === 'waiter')).toBe(true);
  await captureRestaurantScene(page, '.qa/full-evening-main-cleared.png');
  await chooseDessert(page, 'lemon');
  await awaitCourse(page, snapshot => snapshot.evening.dessert.status === 'served', 'dessert served');
  const dessert = (await state(page)).evening.dessert;
  expect(['you', 'date']).toContain(dessert.chosenBy);
  if (dessert.chosenBy === 'you') expect(dessert.choice).toBe('lemon'); else expect(dessert.choice).toBe(CHARACTER_STORIES.mira.preferredDessert);
  await eat(page, 'dessert', 2);
  await captureRestaurantScene(page, '.qa/full-evening-dessert.png');
  await awaitCourse(page, snapshot => !!snapshot.evening.resolutions['spilled-drink'], 'the spill dried', storyWait(20_000, EVENING_PACE.spillAfterService));
  await awaitCourse(page, snapshot => !!snapshot.evening.resolutions['disruptive-diner'] || snapshot.evening.bill.requested, 'the noisy diner or the check', storyWait(20_000, EVENING_PACE.dinerAfterDessertServed + EVENING_PACE.checkDelay));
  await awaitCourse(page, snapshot => snapshot.evening.dessert.status === 'finished', 'the dessert plate cleared', storyWait(20_000, EVENING_PACE.dessertCourse));
  await awaitCheck(page);
  await chip(page, 'button:has-text("See the check")');
  await expect(page.locator('#bill-dialog')).toBeVisible();
  // The date may have picked her favorite when the accelerated offer expired.
  // The check must name the dessert that was actually served in either branch.
  await expect(page.locator('#bill-items')).toContainText(dessert.chosenBy === 'you' ? 'Lemon posset' : 'Chocolate fondant');
  await page.locator('[data-settlement="split"]').click();
  await expect.poll(async () => (await state(page)).evening.chapter).toBe('farewell');
  await expect(page.locator('#bill-dialog')).toBeHidden();
  await expect(page.locator('#prompt-copy')).toHaveText('Dinner is settled. Walk to the door together.');
  await walkToTheDoor(page);
  await chip(page, '[data-evening="farewell"][data-choice="again"]');
  await expect(page.locator('#ending-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#ending-title')).toContainText('A good kind of company');
  const completed = await state(page);
  expect(completed.evening.farewell.ending?.kind).toBe('new-friend');
  expect(completed.evening.agenda?.score, 'dinner alone does not establish understanding or buy another date').toBe(0);
  expect(completed.evening.sharedActivities).toEqual(['dessert']);
  expect(completed.evening.resolutions['wrong-order']).toBeTruthy();
  expect(completed.evening.resolutions['spilled-drink']).toBeTruthy();
  if (completed.events.includes('disruptive-diner')) expect(completed.evening.resolutions['disruptive-diner']).toBeTruthy();
  expect(restaurantScenario(completed)?.phase).toBe('resolved');
  expect(restaurantScenario(completed)?.decisions).toHaveLength(2);
  expect(completed.evening.moments.some(moment => moment.id === 'scenario-family-visit')).toBe(true);
  expect(completed.evening.moments.some(moment => moment.id === 'dessert')).toBe(true);
  expect(completed.usage.claudeRequests).toBe(0);
  const downloadEvent = page.waitForEvent('download'); await page.locator('#save-postcard').click(); const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('table-for-two-mira.png');
  await captureRestaurantScene(page, '.qa/full-evening-ending.png');
  await page.locator('#new-date').click(); await expect(page.locator('#past-evenings')).toBeVisible();
  await page.locator('#past-evenings').click(); await expect(page.locator('#past-evenings-list')).toContainText('Mira');
  expect(errors).toEqual([]);
});

test('an evening can decline dessert, settle from the prompt line and end as friendship', async ({ page }) => {
  test.setTimeout(storyWait(100_000, EVENING_PACE.mainKitchen + EVENING_PACE.mainCourse + EVENING_PACE.checkDelay)); page.setDefaultTimeout(10_000);
  await arrive(page, 'jules'); await resolveIncident(page);
  await eat(page, 'meal', 3);
  await chooseDessert(page, 'skip');
  expect((await state(page)).evening.dessert.status).toBe('skipped');
  await awaitCheck(page);
  await chip(page, '[data-evening="settle-bill"][data-choice="separate"]');
  await expect.poll(async () => (await state(page)).evening.bill.settlement).toBe('separate');
  await walkToTheDoor(page);
  await chip(page, '[data-evening="farewell"][data-choice="friendly"]');
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
      // Water is asked of Eli at the bell on the table; the other gestures are chips on the prompt line.
      if (key === 'request-water') { const result = await command(page, { type: 'evening', action: 'request-water' }); if (result.status !== 200 && !restaurantInterrupted(await state(page))) throw new Error(result.body?.error); }
      else {
        if (key === 'toast') await chip(page, 'button:has-text("Make a toast")');
        await chip(page, `[data-evening="${key}"]${choice ? `[data-choice="${choice}"]` : ''}`);
      }
      await expect.poll(async () => { const next = await state(page); return applied(next) || restaurantInterrupted(next); }).toBe(true);
      if (applied(await state(page))) return;
    }
    catch (error) { if (restaurantInterrupted(await state(page))) continue; throw error; }
  }
  throw new Error(`The ${key} gesture did not become usable after table interruptions.`);
}

for (const mode of ['solo', 'blind'] as const) test(`${mode} evening: two story decisions, character-led gestures, service and reload preserve the actual evening`, async ({ page }) => {
  test.setTimeout(storyWait(120000, fullEveningSeconds)); page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  if (mode === 'blind') await page.setViewportSize({ width: 1000, height: 700 });
  await arrive(page, 'mira', mode); await resolveIncident(page);
  // The gestures belong to the main course, which Eli clears on his own clock; they come before the table story opens.
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
  await awaitCourse(page, snapshot => restaurantScenario(snapshot)?.phase === 'active', 'the table story opening', storyWait(25_000, 240));
  const first = restaurantScenario(await state(page))!;
  expect(first.id).toBe('family-visit'); expect(first.beat).toBe('setup'); expect(first.decisions).toHaveLength(0);
  await expect(page.locator('#prompt-copy')).toContainText(first.description);
  await chip(page, `[data-scenario="${first.choices[0]!.id}"]`);
  await expect.poll(async () => restaurantScenario(await state(page))?.beat).toBe('follow-through');
  const follow = restaurantScenario(await state(page))!;
  expect(follow.phase).toBe('active'); expect(follow.decisions).toHaveLength(1); expect(follow.description).not.toBe(first.description);
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
  const choices = page.locator('#prompt-chips [data-scenario]');
  await expect(choices).toHaveCount(follow.choices.length);
  expect((await state(page)).evening.moments.some(moment => moment.id === 'scenario-family-visit')).toBe(false);
  await chip(page, `[data-scenario="${follow.choices[0]!.id}"]`);
  await expect.poll(async () => restaurantScenario(await state(page))?.phase).toBe('resolved');
  expect(restaurantScenario(await state(page))?.decisions).toHaveLength(2);
  expect((await state(page)).evening.moments.some(moment => moment.id === 'scenario-family-visit')).toBe(true);
  const completed = await state(page);
  expect(completed.evening.moments.filter(moment => moment.id === 'scenario-family-visit')).toHaveLength(1);
  expect(completed.usage.claudeRequests).toBe(0);
  const care = completed.evening.care, story = restaurantScenario(completed), seed = completed.blindDate?.seed;
  await page.reload(); await expect(page.locator('#pause-dialog')).toBeVisible({ timeout: 15000 });
  await page.locator('#resume-date').click(); await waitForRestaurantScene(page);
  expect((await state(page)).evening.care).toEqual(care);
  expect(restaurantScenario(await state(page))).toEqual(story);
  if (mode === 'blind') expect((await state(page)).blindDate?.seed).toBe(seed);
  // Every gesture has been used once, so the prompt line has nothing to offer until the evening moves on.
  await expect(page.locator('#prompt-chips [data-evening="offer-taste"], #prompt-chips [data-evening="toast"], #prompt-chips [data-evening="check-in"]')).toHaveCount(0);
  if (mode === 'blind') {
    // By now Eli has cleared an untouched main on his own clock and the date has likely chosen dessert; the check still follows.
    await awaitCourse(page, snapshot => snapshot.evening.main.status === 'finished', 'the plates cleared', storyWait(30_000, EVENING_PACE.mainCourse));
    if ((await state(page)).evening.dessert.status === 'none') await chooseDessert(page, 'skip');
    await awaitCheck(page);
    await chip(page, '[data-evening="settle-bill"][data-choice="separate"]');
    await walkToTheDoor(page);
    await chip(page, '[data-evening="farewell"][data-choice="friendly"]');
    await expect.poll(async () => (await state(page)).evening.farewell.ending?.kind, { timeout: 15000 }).toBe('new-friend');
    expect((await state(page)).blindDate?.seed).toBe(seed);
  } else {
    await page.keyboard.press('Escape'); await expect(page.locator('#pause-dialog')).toBeVisible(); await page.locator('#finish-date').click();
  }
  await expect(page.locator('#ending-screen')).toBeVisible(); expect(errors).toEqual([]);
});
