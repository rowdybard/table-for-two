import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { attachRestaurantServer, type ClaudeAdapter } from '../server/restaurant';
import { attachDoubleDateServer } from '../server/double-date';
import { MENU, RESTAURANT } from '../src/restaurant/content';
import { QUIET_TABLE_OFFSET_Z } from '../src/restaurant/dining-space';
import type { DinnerCommand, DinnerState } from '../src/restaurant/types';
import type { RestaurantScenarioId } from '../src/restaurant/scenario-types';
import type { DoubleDateRoomState, DoubleHumanId, DoubleRoomCredentials, DoubleRoomResponse } from '../src/restaurant/double-date-types';
import { waitForRestaurantScene } from './restaurant-browser-helpers';

const readState = (page: Page) => page.evaluate(() => (window as unknown as { __restaurantState: DinnerState }).__restaurantState);
const readRoom = (page: Page) => page.evaluate(() => (window as unknown as { __doubleDateState: DoubleDateRoomState }).__doubleDateState);

/** The production HTTP/controller paths run against a manual scene clock. No private state is mutated. */
class AtlasGame {
  private http!: Server;
  private restaurant!: Awaited<ReturnType<typeof attachRestaurantServer>>;
  private double!: Awaited<ReturnType<typeof attachDoubleDateServer>>;
  private clock = Date.UTC(2026, 10, 8);
  base = '';
  providerCalls = 0;
  async start(scenarioId: RestaurantScenarioId) {
    const directory = resolve('dist');
    this.http = createServer((req, res) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      if (this.double?.handle(req, res) || this.restaurant?.handle(req, res)) return;
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      const file = resolve(directory, pathname === '/' ? 'index.html' : '.' + pathname);
      if (!file.startsWith(directory + sep)) { res.writeHead(403).end(); return; }
      void readFile(file).then(bytes => {
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' } as Record<string, string>)[extname(file)] || 'application/octet-stream');
        res.end(bytes);
      }).catch(() => res.writeHead(404).end());
    });
    const claude: ClaudeAdapter = { stream: async function* () { throw new Error('Encounter fixture must not use a paid conversation provider.'); } };
    const tracked: ClaudeAdapter = { stream: (...args) => { this.providerCalls++; return claude.stream(...args); } };
    const now = () => this.clock;
    this.restaurant = await attachRestaurantServer(this.http, { now, autoTick: false, env: { DATE_SPEECH_PROVIDER: 'none' }, claude: tracked, ledgerPath: false, development: true, scenarioId });
    this.double = await attachDoubleDateServer(this.http, this.restaurant, { now, autoTick: false, env: {}, scenarioId, disconnectMs: 1e9 });
    await new Promise<void>(done => this.http.listen(0, '127.0.0.1', done));
    this.base = `http://127.0.0.1:${(this.http.address() as { port: number }).port}`;
    return this;
  }
  advance(seconds: number) {
    for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
      this.clock += 1000 / 60; this.restaurant.tick(1 / 60, this.clock); this.double.tick(1 / 60, this.clock);
    }
  }
  async request(path: string, token = '', body?: unknown) {
    const response = await fetch(this.base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const json = await response.json();
    if (!response.ok) throw new Error(`${response.status} ${path}: ${JSON.stringify(json)}`);
    return json;
  }
  async solo() {
    const created = await this.request('/api/date/sessions', '', { dateId: 'mira' });
    const credentials = { id: created.state.id as string, token: created.token as string };
    const command = async (body: DinnerCommand) => {
      if (body.type !== 'move') this.clock += 600;
      return (await this.request(`/api/date/sessions/${credentials.id}/command`, credentials.token, body)).state as DinnerState;
    };
    for (let step = 0; step < 9; step++) { await command({ type: 'move', x: 0, z: -1, yaw: 0 }); this.advance(.2); }
    await command({ type: 'interact', target: 'seat' }); this.advance(10);
    return { credentials, command, state: async () => (await this.request(`/api/date/sessions/${credentials.id}`, credentials.token)).state as DinnerState };
  }
  async pair() {
    const a = await this.request('/api/double-date/rooms', '', { name: 'Alex' }) as DoubleRoomResponse;
    const b = await this.request('/api/double-date/rooms/join', '', { code: a.state.code, name: 'Jamie' }) as DoubleRoomResponse;
    const members = { h1: a, h2: b };
    const raw = async (human: DoubleHumanId, body: unknown) => {
      if (!(typeof body === 'object' && body !== null && 'command' in body && (body as { command?: { type?: string } }).command?.type === 'move')) this.clock += 600;
      return (await this.request(`/api/double-date/rooms/${a.roomId}/command`, members[human].token, body)).state as DoubleDateRoomState;
    };
    const command = (human: DoubleHumanId, body: DinnerCommand) => raw(human, { type: 'scene', command: body });
    for (const [human, dateId] of [['h1', 'mira'], ['h2', 'jules']] as const) {
      await raw(human, { type: 'choose-date', dateId }); await raw(human, { type: 'ready', ready: true });
    }
    await raw('h1', { type: 'start' });
    for (let step = 0; step < 9; step++) {
      for (const human of ['h1', 'h2'] as const) await command(human, { type: 'move', x: 0, z: -1, yaw: 0 });
      this.advance(.2);
    }
    for (const human of ['h1', 'h2'] as const) await command(human, { type: 'interact', target: 'seat' });
    this.advance(10);
    return { members, command, raw, state: async () => (await this.request(`/api/double-date/rooms/${a.roomId}`, a.token)).state as DoubleDateRoomState };
  }
  async stop() {
    this.double?.close(); await this.restaurant?.close(); this.http?.closeAllConnections();
    await new Promise<void>(done => this.http?.close(() => done()));
    expect(this.providerCalls).toBe(0);
  }
}

async function restore(page: Page, base: string, credentials: { id: string; token: string } | DoubleRoomCredentials) {
  await page.addInitScript(saved => {
    sessionStorage.setItem('roomId' in saved ? 'table-for-two-double-date' : 'table-for-two-session', JSON.stringify(saved));
    localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: false, ambience: false, captions: true }));
  }, credentials);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base); await waitForRestaurantScene(page);
  if (!('roomId' in credentials)) {
    await expect(page.locator('#pause-dialog')).toBeVisible(); await page.locator('#resume-date').click();
  }
  await expect.poll(async () => (await readState(page)).phase).toBe('playing');
  await page.waitForTimeout(650);
}
/** Chips live on the prompt line. These specs look around by dragging, so the pointer is never captured away from them. */
async function prompt(page: Page) {
  expect(await page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  await expect(page.locator('#prompt-line')).toBeVisible();
}
async function choose(page: Page, id: string) { await prompt(page); await page.locator(`[data-scenario="${id}"]`).click(); }
/** Whoever owns an interruption clears it through the real table commands. */
async function clearIncident(command: (body: DinnerCommand) => Promise<unknown>, view: DinnerState) {
  const incident = view.evening.incident;
  if (!incident) return false;
  if (incident.event === 'wrong-order') { if (!incident.progress) await command({ type: 'evening', action: 'inspect-ticket' }); await command({ type: 'evening', action: 'return-order' }); }
  else if (incident.event === 'spilled-drink') { for (let wipe = incident.progress; wipe < 3; wipe++) await command({ type: 'evening', action: 'wipe' }); await command({ type: 'evening', action: 'steady-glass' }); }
  else await command({ type: 'evening', action: 'ask-quiet' });
  return true;
}
type Table = { read(): Promise<DinnerState>; command(body: DinnerCommand): Promise<unknown> };
/** Eli's service runs on the scene clock; this walks it forward one second at a time, clearing spills and wrong plates as they come. */
async function until(game: AtlasGame, tables: Table[], predicate: (views: DinnerState[]) => boolean, label: string, maxSeconds = 400) {
  for (let second = 0; second < maxSeconds; second++) {
    const views = await Promise.all(tables.map(table => table.read()));
    let cleared = false;
    for (const [index, view] of views.entries()) if (await clearIncident(tables[index]!.command, view)) cleared = true;
    if (cleared) continue;
    if (predicate(views)) return views;
    game.advance(1);
  }
  throw new Error(`The table never reached: ${label}.`);
}
const untilElapsed = (game: AtlasGame, tables: Table[], elapsed: number) => until(game, tables, views => views.every(view => view.elapsed >= elapsed), `${elapsed}s on the scene clock`);
/** Three bites, then Eli clears the plates on his own clock; declining dessert leaves the check to him as well. */
async function finishFood(game: AtlasGame, table: Table, others: Table[] = []) {
  for (let bite = 0; bite < 3; bite++) { await table.command({ type: 'evening', action: 'taste' }); game.advance(.6); }
  await until(game, [table, ...others], ([view]) => view!.evening.main.status === 'finished', 'the main course cleared');
  await table.command({ type: 'evening', action: 'skip-dessert' });
}
/** Initial seated/standing look angles are part of the real public input contract; later aims start from the look that was left behind. */
async function aimFromLook(page: Page, point: [number, number, number], from?: { yaw: number; pitch: number }) {
  const state = await readState(page), human = state.participants.find(person => person.kind === 'human')!, viewport = page.viewportSize()!;
  const camera = new PerspectiveCamera(state.seated ? 43 : 61, viewport.width / viewport.height, .05, 100);
  const offsetYaw = state.seated ? .245 : 0, look = from ?? { yaw: 0, pitch: state.seated ? -.095 : -.025 };
  camera.position.set(human.position[0] + (state.seated ? .51 : 0), (state.seated ? RESTAURANT.seat[1] + .075 : RESTAURANT.spawn[1]), human.position[2] - (state.seated ? .28 : 0));
  camera.lookAt(new Vector3(...point));
  const rotation = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const target = { yaw: offsetYaw - rotation.y, pitch: rotation.x };
  let dx = (target.yaw - look.yaw) / .002, dy = (look.pitch - target.pitch) / .002;
  while (Math.abs(dx) + Math.abs(dy) >= 8) {
    const x = Math.max(-viewport.width * .32, Math.min(viewport.width * .32, dx));
    const y = Math.max(-viewport.height * .30, Math.min(viewport.height * .30, dy));
    const start = { x: viewport.width * (x >= 0 ? .32 : .68), y: viewport.height * (y >= 0 ? .28 : .64) };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + x, start.y + y, { steps: 6 }); await page.mouse.up();
    dx -= x; dy -= y;
  }
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  return target;
}

test('real Solo: a private break holds the waiting kitchen, returns the actor and resumes the remaining cook time', async ({ page }) => {
  const game = await new AtlasGame().start('feeling-unwell');
  try {
    const solo = await game.solo(); await solo.command({ type: 'interact', target: 'menu', choice: MENU[0] }); game.advance(15.1);
    expect((await solo.state()).evening.main.status).toBe('waiting');
    await restore(page, game.base, solo.credentials); await prompt(page);
    await expect(page.locator('[data-scenario="water"]')).toBeVisible();
    const absent = await readState(page); expect(absent.evening.scenarioCare!.presence).toBe('privacy-break');
    expect(absent.participants.find(person => person.kind === 'ai')!.position[2]).toBeGreaterThan(0);
    await choose(page, 'water');
    await expect(page.locator('[data-scenario="slow-dinner"]')).toBeDisabled();
    await expect(page.locator('#prompt-copy')).toContainText('They’re returning shortly.');
    game.advance(3.1); // Six seconds makes them start returning; walking back still takes real scene time.
    for (let step = 0; step < 80 && (await solo.state()).evening.scenarioCare!.presence !== 'at-table'; step++) game.advance(.25);
    await expect(page.locator('[data-scenario="slow-dinner"]')).toBeEnabled(); await choose(page, 'slow-dinner');
    await expect(page.locator('[data-evening="resume-dinner"]')).toBeEnabled();
    expect((await solo.state()).evening.main.status).toBe('waiting');
    const before = (await solo.state()).evening.main.orderedAt!;
    await page.locator('[data-evening="resume-dinner"]').click();
    await expect.poll(async () => (await readState(page)).evening.scenarioCare!.kitchen.held).toBe(false);
    const resumed = await solo.state(); expect(resumed.evening.scenarioCare!.presence).toBe('at-table');
    const remaining = 45 - (resumed.elapsed - before - resumed.evening.scenarioCare!.kitchen.pausedSeconds);
    game.advance(remaining - .1); expect((await solo.state()).evening.main.status).toBe('waiting');
    game.advance(.2); await expect.poll(async () => (await readState(page)).evening.main.status).toBe('served');
    expect((await solo.state()).evening.main.bites).toBe(0);
    expect((await solo.state()).evening.incident).toBeNull(); // Care quiet time suppresses a fresh disruption at service.
  } finally { await page.goto('about:blank'); await game.stop(); }
});

for (const mode of ['solo', 'double'] as const) test(`real ${mode}: cancelled kitchen extras are free, boxed food remains on the actual receipt`, async ({ page }) => {
  const game = await new AtlasGame().start('oversized-order');
  try {
    const solo = mode === 'solo' ? await game.solo() : undefined;
    const pair = mode === 'double' ? await game.pair() : undefined;
    if (solo) await solo.command({ type: 'interact', target: 'menu', choice: MENU[0] });
    if (pair) for (const [i, human] of (['h1', 'h2'] as const).entries()) await pair.command(human, { type: 'interact', target: 'menu', choice: MENU[i] });
    const tables: Table[] = solo ? [{ read: solo.state, command: solo.command }] : (['h1', 'h2'] as const).map(id => ({ read: async () => (await pair!.state()).views[id], command: body => pair!.command(id, body) }));
    // Eli's wrong plate and the spill both arrive on his clock before the table story opens at four minutes.
    await untilElapsed(game, tables, 240.1);
    const human = pair ? (await pair.state()).scenario!.target : 'h1';
    await restore(page, game.base, solo?.credentials ?? pair!.members[human]);
    await expect.poll(async () => (await readState(page)).evening.scenario?.phase).toBe('active');
    const opening = (await readState(page)).evening.scenarioCare!.extraOrder.items;
    expect(opening.map(item => item.status)).toEqual(['served', 'served', 'pending', 'pending']);
    await expect(page.locator('.restaurant-canvas')).toBeVisible();
    await choose(page, 'help');
    await expect.poll(async () => (await readState(page)).evening.scenarioCare!.extraOrder.items.filter(item => item.status === 'cancelled').length).toBe(2);
    await choose(page, 'share-chosen');
    await expect.poll(async () => (await readState(page)).evening.scenario?.phase).toBe('resolved');
    const view = await readState(page), extras = view.evening.scenarioCare!.extraOrder.items;
    expect(extras.map(item => item.status)).toEqual(['shared', 'boxed', 'cancelled', 'cancelled']);
    const own = tables[human === 'h2' ? 1 : 0]!, friend = tables.filter(table => table !== own);
    await finishFood(game, own, friend);
    for (const table of friend) await finishFood(game, table, [own]);
    // One check comes for the whole table once every pair has finished or declined dessert.
    await until(game, tables, views => views.every(view => view.evening.bill.requested), 'the check on the table');
    await expect.poll(async () => (await readState(page)).evening.dessert.status).toBe('skipped');
    await expect.poll(async () => (await readState(page)).evening.bill.requested).toBe(true); await prompt(page);
    await expect(page.locator('#prompt-copy')).toHaveText('Eli left the check.');
    await page.locator('#prompt-chips button', { hasText: 'See the check' }).click();
    await expect(page.locator('#bill-dialog')).toBeVisible();
    await expect(page.locator('#bill-items')).toContainText('Cancelled before cooking');
    await expect(page.locator('#bill-items')).toContainText('Not charged');
    await expect(page.locator('#bill-items')).toContainText('Packed to take home');
    const chargedExtras = (await readState(page)).evening.bill.items!.filter(item => item.id.startsWith('extra-'));
    expect(chargedExtras).toHaveLength(4);
    expect(chargedExtras.filter(item => item.status === 'cancelled').every(item => item.chargedCents === 0)).toBe(true);
    expect(chargedExtras.find(item => item.status === 'boxed')!.chargedCents).toBeGreaterThan(0);
    const ledger = (await readState(page)).evening.bill;
    expect(ledger.totalCents).toBe(ledger.items!.reduce((total, item) => total + item.chargedCents, 0));
  } finally { await page.goto('about:blank'); await game.stop(); }
});

test('real Double: medical departure reveals their agenda and the other pair can finish their own dinner', async ({ page }) => {
  const game = await new AtlasGame().start('allergic-reaction');
  try {
    const pair = await game.pair();
    for (const [i, human] of (['h1', 'h2'] as const).entries()) await pair.command(human, { type: 'interact', target: 'menu', choice: MENU[i] });
    const tables = Object.fromEntries((['h1', 'h2'] as const).map(id => [id, { read: async () => (await pair.state()).views[id], command: (body: DinnerCommand) => pair.command(id, body) } satisfies Table])) as Record<DoubleHumanId, Table>;
    await untilElapsed(game, Object.values(tables), 240.1);
    let room = await pair.state(); const target = room.scenario!.target, friend = target === 'h1' ? 'h2' : 'h1';
    await restore(page, game.base, pair.members[target]);
    await choose(page, 'get-help'); await choose(page, 'support-handoff');
    await expect.poll(async () => (await readState(page)).doubleDate?.role).toBe('wingman');
    await prompt(page); await page.locator('#view-own-ending').click();
    await expect(page.locator('#ending-screen')).toBeVisible();
    await expect(page.locator('#ending-agenda')).toBeVisible();
    await expect(page.locator('#ending-agenda-goal')).not.toHaveText('');
    await expect(page.locator('#ending-agenda-reflection')).not.toHaveText('');
    room = await pair.state(); expect(room.phase).toBe('playing'); expect(room.views[friend].phase).toBe('playing');
    expect(room.views[friend].evening.agenda!.goal).toBeNull(); expect(room.views[target].evening.bill.settlement).toBe('separate');
    await page.locator('#back-to-table').click();
    await finishFood(game, tables[friend]);
    // The remaining pair's check does not wait for the date that already ended.
    await until(game, [tables[friend]], ([view]) => view!.evening.bill.requested, 'the remaining pair’s check');
    await pair.command(friend, { type: 'evening', action: 'settle-bill', choice: 'separate' });
    await expect.poll(async () => (await readRoom(page)).views[friend].evening.bill.settlement).toBe('separate');
  } finally { await page.goto('about:blank'); await game.stop(); }
});

test('real Solo: quieter-table relocation moves the camera, props and usable chair together', async ({ page }) => {
  page.setDefaultTimeout(10_000);
  const game = await new AtlasGame().start('unwelcome-comment');
  try {
    const solo = await game.solo(); await solo.command({ type: 'interact', target: 'menu', choice: MENU[0] });
    await untilElapsed(game, [{ read: solo.state, command: solo.command }], 240.1);
    await restore(page, game.base, solo.credentials); const before = await readState(page);
    await choose(page, 'ask-staff'); await choose(page, 'move-away');
    await expect.poll(async () => (await readState(page)).evening.scenarioCare!.table).toBe('quiet');
    const after = await readState(page);
    expect(after.participants[0]!.position[2] - before.participants[0]!.position[2]).toBeCloseTo(QUIET_TABLE_OFFSET_Z, 4);
    expect(after.participants[1]!.position[2] - before.participants[1]!.position[2]).toBeCloseTo(QUIET_TABLE_OFFSET_Z, 4);
    await expect(page.locator('#prompt-chips [data-scenario]')).toHaveCount(0);
    await page.waitForTimeout(700);
    // Aim at the physical relocated bread target through ordinary mouse drag, then R/E.
    const breadLook = await aimFromLook(page, [.34, .85, -1.28 + QUIET_TABLE_OFFSET_Z]);
    await page.keyboard.press('r'); await expect(page.locator('#tabletop-inspector')).toBeVisible();
    await expect(page.locator('#tabletop-inspector')).toContainText('Bread basket'); await page.keyboard.press('e');
    await expect.poll(async () => (await readState(page)).evening.tabletop!.breadEaten).toBe(1);
    await page.keyboard.press('Escape'); await expect(page.locator('#tabletop-inspector')).toBeHidden(); await page.waitForTimeout(700);
    // Looking down at the moved chair is how a guest stands up from it.
    await aimFromLook(page, [0, .61, .1 + QUIET_TABLE_OFFSET_Z], breadLook);
    await expect(page.locator('#interaction-label')).toHaveText('Stand up'); await page.keyboard.press('e');
    await expect.poll(async () => (await readState(page)).seated).toBe(false);
    await page.waitForTimeout(650);
    await aimFromLook(page, [0, .61, .1 + QUIET_TABLE_OFFSET_Z]);
    await expect(page.locator('#interaction-label')).toHaveText('Take your seat'); await page.keyboard.press('e');
    await expect.poll(async () => (await readState(page)).seated).toBe(true);
    expect((await solo.state()).participants[0]!.position[2]).toBeCloseTo(after.participants[0]!.position[2], 4);
  } finally { await page.goto('about:blank'); await game.stop(); }
});
