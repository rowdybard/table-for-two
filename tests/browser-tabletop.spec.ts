import { createServer, type Server } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { attachRestaurantServer, type ClaudeAdapter } from '../server/restaurant';
import { RESTAURANT } from '../src/restaurant/content';
import type { DinnerCommand, DinnerState } from '../src/restaurant/types';
import type { InspectionTarget } from '../src/restaurant/TabletopInspector';
import { waitForRestaurantScene } from './restaurant-browser-helpers';

let http: Server, app: Awaited<ReturnType<typeof attachRestaurantServer>>, base = '', providerCalls = 0;
const sessions: { id: string; token: string }[] = [];
const claude: ClaudeAdapter = { async *stream() { providerCalls++; throw new Error('Tabletop input must never invoke the conversation provider.'); } };
const readState = (page: Page) => page.evaluate(() => (window as unknown as Window & { __restaurantState: DinnerState }).__restaurantState);
const targets: Partial<Record<InspectionTarget | 'seat', [number, number, number]>> = {
  // Looking down at the chair itself is how a seated guest stands up.
  seat: [0, .61, .1], glass: [.49, .88, -.77],
  // Aim above the lamp's proxy to reach the taller carafe behind it.
  carafe: [-.60, 1.065, -1.50], bread: [.34, .85, -1.28], salt: [.66, .84, -.91], pepper: [.745, .84, -.91],
  // The fork's near end is clear of the menu lying beside it.
  cutlery: [-.235, .84, -.535], lamp: [-.20, .92, -1.12], vase: [-.48, .95, -1.08], plate: [0, .82, -.64],
  menu: [-.42, .83, -.75], napkin: [.40, .85, -.48],
};
const objectNames: Partial<Record<InspectionTarget, string>> = {
  glass: 'Water glass', carafe: 'Water carafe', bread: 'Bread basket', salt: 'Salt', pepper: 'Pepper', cutlery: 'Cutlery',
  lamp: 'Table lamp', vase: 'Flowers', plate: 'Dinner plate', menu: 'Menu', napkin: 'Napkin',
};

test.beforeAll(async () => {
  const root = resolve('dist');
  http = createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (app.handle(req, res)) return;
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    const file = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    void readFile(file).then(data => {
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' } as Record<string, string>)[extname(file)] || 'application/octet-stream');
      res.end(data);
    }).catch(() => res.writeHead(404).end());
  });
  app = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none' }, claude, ledgerPath: false, development: true, scenarioId: 'family-visit' });
  await new Promise<void>(done => http.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  await mkdir('.qa/tabletop', { recursive: true });
});

test.afterAll(async () => {
  // Explicitly end each authored dinner before freeing every physics world.
  for (const session of sessions) await api(`/api/date/sessions/${session.id}/command`, session.token, { type: 'finish' }).catch(() => {});
  await app?.close();
  http?.closeAllConnections();
  await new Promise<void>(done => http?.close(() => done()));
});

async function api(path: string, token = '', body?: unknown) {
  return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

/** Walking uses the normal HTTP/controller/physics path, before spending browser frames on it. */
async function seatedSession() {
  const created = await api('/api/date/sessions', '', { dateId: 'mira' });
  expect(created.status).toBe(201);
  const session = await created.json() as { state: DinnerState; token: string };
  sessions.push({ id: session.state.id, token: session.token });
  const path = `/api/date/sessions/${session.state.id}`;
  let state = session.state;
  const deadline = Date.now() + 10_000;
  while (!state.seated && Date.now() < deadline) {
    const move = await api(path + '/command', session.token, { type: 'move', x: 0, z: -1, yaw: 0 });
    expect(move.status).toBe(200);
    // Real movement requires simulation time; refresh its 300 ms input lease.
    await delay(100);
    const seat = await api(path + '/command', session.token, { type: 'interact', target: 'seat' });
    expect([200, 409]).toContain(seat.status);
    if (seat.status === 200) state = (await seat.json()).state as DinnerState;
  }
  expect(state.seated, 'HTTP movement reaches the real chair').toBe(true);
  return { id: state.id, token: session.token, seenCues: state.evening.cues.map(cue => cue.id) };
}

async function begin(page: Page, touch = false) {
  const reference = await seatedSession();
  await page.addInitScript(saved => {
    sessionStorage.setItem('table-for-two-session', JSON.stringify(saved));
    localStorage.setItem('table-for-two-settings', JSON.stringify({ speech: false, ambience: false, captions: true }));
  }, reference);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await waitForRestaurantScene(page);
  if (touch) await page.locator('#resume-date').tap(); else await page.locator('#resume-date').click();
  await expect.poll(async () => (await readState(page)).phase).toBe('playing');
  await expect(page.locator('#pause-dialog')).toBeHidden();
  await expect(page.locator('#dinner-hud')).toBeVisible();
  await page.waitForTimeout(650); // Finish the seated camera transition before projecting real props.
  const commands: DinnerCommand[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/command')) commands.push(request.postDataJSON() as DinnerCommand);
  });
  return { reference, commands };
}

/** This is camera math in the test process, not a browser hook into private renderer state. */
class TableView {
  private yaw = 0;
  private pitch = -.095;
  constructor(private readonly page: Page, private readonly touch?: CDPSession) {}
  private async camera() {
    const state = await readState(this.page), viewport = this.page.viewportSize()!, human = state.participants.find(person => person.kind === 'human')!;
    const camera = new PerspectiveCamera(43, viewport.width / viewport.height, .05, 100);
    camera.position.set(human.position[0] + .51, RESTAURANT.seat[1] + .075, human.position[2] - .28);
    camera.rotation.set(this.pitch, -this.yaw + .245, 0, 'YXZ'); camera.updateMatrixWorld();
    return camera;
  }
  async point(target: InspectionTarget) {
    const position = targets[target]; if (!position) throw new Error(`Missing world point for ${target}`);
    const projected = new Vector3(...position).project(await this.camera()), viewport = this.page.viewportSize()!;
    const point = { x: (projected.x + 1) / 2 * viewport.width, y: (1 - projected.y) / 2 * viewport.height };
    expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(viewport.width);
    expect(point.y).toBeGreaterThan(58); expect(point.y).toBeLessThan(viewport.height - 30);
    return point;
  }
  async aim(target: InspectionTarget | 'seat') {
    const camera = await this.camera(); camera.lookAt(new Vector3(...targets[target]!));
    const rotation = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    const desiredYaw = .245 - rotation.y, desiredPitch = rotation.x;
    const factor = this.touch ? .0033 : .002;
    let dx = (desiredYaw - this.yaw) / factor, dy = (this.pitch - desiredPitch) / factor;
    const viewport = this.page.viewportSize()!;
    while (Math.abs(dx) + Math.abs(dy) >= 8) {
      const x = Math.max(-viewport.width * .32, Math.min(viewport.width * .32, dx));
      const y = Math.max(-viewport.height * .30, Math.min(viewport.height * .30, dy));
      const start = { x: x >= 0 ? viewport.width * .32 : viewport.width * .68, y: y >= 0 ? Math.max(80, viewport.height * .28) : viewport.height * .64 };
      if (this.touch) {
        await this.touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...start }] });
        for (let step = 1; step <= 6; step++) await this.touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: start.x + x * step / 6, y: start.y + y * step / 6 }] });
        await this.touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await this.page.mouse.move(start.x, start.y); await this.page.mouse.down();
        await this.page.mouse.move(start.x + x, start.y + y, { steps: 6 }); await this.page.mouse.up();
      }
      this.yaw += x * factor; this.pitch -= y * factor; dx -= x; dy -= y;
    }
    // An animation frame must consume the final drag before its ray is tested.
    await this.page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await expect(this.page.locator('#tabletop-inspector')).toBeHidden();
  }
  async inspect(target: InspectionTarget, key = false) {
    await this.aim(target);
    if (key) await this.page.keyboard.press('r');
    else { const point = await this.point(target); if (this.touch) await this.page.touchscreen.tap(point.x, point.y); else await this.page.mouse.click(point.x, point.y); }
    await expect(this.page.locator('#tabletop-inspector')).toHaveAttribute('data-target', target);
    await expect(this.page.locator('#tabletop-object-name')).toHaveText(objectNames[target]!);
  }
  async back(touch = false) {
    if (touch) await this.page.locator('#tabletop-back').tap(); else await this.page.keyboard.press('Escape');
    await expect(this.page.locator('#tabletop-inspector')).toBeHidden();
    await expect(this.page.locator('#pause-dialog')).toBeHidden();
    await expect.poll(async () => (await readState(this.page)).phase).toBe('playing');
    // Returning from the close-up lerps the physical camera back to its chair.
    await this.page.waitForTimeout(650);
  }
}

test('actual game: inspect and use the seated table with mouse, R and E while preserving menus and pause behavior', async ({ page }) => {
  page.setDefaultTimeout(10_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { commands } = await begin(page), view = new TableView(page);
  await view.inspect('bread', true); await view.back();
  await view.inspect('glass');
  for (let remaining = 3; remaining >= 0; remaining--) {
    await page.keyboard.press('e');
    await expect.poll(async () => (await readState(page)).evening.tabletop!.glassFill).toBe(remaining);
  }
  await expect(page.locator('#tabletop-use')).toBeDisabled();
  await expect(page.locator('#tabletop-inspector-status')).toContainText('empty'); await view.back();
  await view.inspect('carafe'); await page.locator('#tabletop-use').click();
  await expect.poll(async () => (await readState(page)).evening.tabletop!.glassFill).toBe(4);
  expect((await readState(page)).evening.tabletop!.shared.carafeFill).toBe(2); await view.back();
  const checks: { target: InspectionTarget; read(state: DinnerState): unknown; expected: unknown }[] = [
    { target: 'bread', read: state => state.evening.tabletop!.breadEaten, expected: 1 },
    { target: 'cutlery', read: state => state.evening.tabletop!.cutleryCrossed, expected: true },
    { target: 'lamp', read: state => state.evening.tabletop!.shared.lampLevel, expected: 1 },
    { target: 'vase', read: state => state.evening.tabletop!.shared.vaseTurn, expected: 1 },
    { target: 'plate', read: state => state.evening.tabletop!.plateTurn, expected: 1 },
  ];
  for (const check of checks) { await view.inspect(check.target); await page.locator('#tabletop-use').click(); await expect.poll(async () => check.read(await readState(page))).toBe(check.expected); await view.back(); }
  await view.inspect('salt'); await expect(page.locator('#tabletop-use')).toBeDisabled();
  await expect(page.locator('#tabletop-inspector-status')).toContainText('Season your own meal'); await view.back();
  await page.screenshot({ path: '.qa/tabletop/main-desktop.png' });

  await view.inspect('menu'); await page.locator('#tabletop-use').click();
  await expect(page.locator('#tabletop-inspector')).toBeHidden(); await expect(page.locator('#menu-dialog')).toBeVisible();
  await expect(page.locator('[data-order]').first()).toBeVisible();
  await page.locator('#menu-close').click(); await expect.poll(async () => (await readState(page)).phase).toBe('playing');
  await page.waitForTimeout(650); // Existing menu camera returns to the chair.
  // The napkin is an ordinary folded prop now; the only drawing left at the table is on the receipt.
  await view.inspect('napkin'); await expect(page.locator('#tabletop-use')).toHaveText('Fold your napkin'); await page.locator('#tabletop-use').click();
  await expect.poll(async () => (await readState(page)).evening.tabletop!.napkinFolded).toBe(true);
  await expect(page.locator('#tabletop-use')).toHaveText('Unfold your napkin');
  await page.keyboard.press('Escape'); await expect(page.locator('#tabletop-inspector')).toBeHidden();
  await expect(page.locator('#pause-dialog')).toBeHidden(); await page.waitForTimeout(650);
  await view.aim('seat'); await expect(page.locator('#interaction-label')).toHaveText('Stand up'); await page.keyboard.press('e');
  await expect.poll(async () => (await readState(page)).seated).toBe(false);
  await expect(page.locator('#inspect-table-object')).toBeHidden(); await page.keyboard.press('r');
  await expect(page.locator('#tabletop-inspector')).toBeHidden();
  expect(commands.filter(command => command.type === 'tabletop')).toHaveLength(11);
  expect((await readState(page)).usage.claudeRequests).toBe(0); expect(providerCalls).toBe(0); expect(errors).toEqual([]);
});

test('actual game: a late first prop reply cannot roll back a second completed table action', async ({ page }) => {
  const { commands } = await begin(page), view = new TableView(page);
  let release!: () => void, fetched!: () => void;
  const hold = new Promise<void>(done => { release = done; }), firstApplied = new Promise<void>(done => { fetched = done; });
  let firstRevision = -1, held = false;
  await page.route('**/api/date/sessions/*/command', async route => {
    const command = route.request().postDataJSON() as DinnerCommand;
    if (held || command.type !== 'tabletop' || command.action !== 'dim-lamp') { await route.continue(); return; }
    held = true;
    const response = await route.fetch();
    const snapshot = await response.json() as { state: DinnerState };
    firstRevision = snapshot.state.revision ?? -1;
    fetched();
    await hold;
    await route.fulfill({ response });
  });
  try {
    await view.inspect('lamp'); await page.locator('#tabletop-use').click(); await firstApplied;
    await expect(page.locator('#tabletop-inspector')).toHaveAttribute('aria-busy', 'true');
    // Back stays available while the first request is pending.
    await view.back();
    await view.inspect('vase'); await page.locator('#tabletop-use').click();
    await expect.poll(async () => (await readState(page)).evening.tabletop!.shared.vaseTurn).toBe(1);
    const second = await readState(page); expect(second.evening.tabletop!.shared.lampLevel).toBe(1);
    expect(second.revision).toBeGreaterThan(firstRevision);
    const staleReceived = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'dim-lamp');
    release(); await (await staleReceived).finished();
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const final = await readState(page);
    expect(final.revision).toBeGreaterThanOrEqual(second.revision!);
    expect(final.evening.tabletop!.shared.lampLevel).toBe(1); expect(final.evening.tabletop!.shared.vaseTurn).toBe(1);
    expect(commands.filter(command => command.type === 'tabletop')).toEqual([{ type: 'tabletop', action: 'dim-lamp' }, { type: 'tabletop', action: 'turn-vase' }]);
    expect(final.usage.claudeRequests).toBe(0); expect(providerCalls).toBe(0);
  } finally { release(); }
});

test.describe('iPhone landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  test('actual game: a drag looks, a real prop tap inspects, and Use fires once without a ghost click', async ({ page, context }) => {
    page.setDefaultTimeout(10_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const { commands } = await begin(page, true), cdp = await context.newCDPSession(page), view = new TableView(page, cdp);
    await expect(page.locator('#mobile-controls')).toBeVisible();
    await expect(page.locator('#mobile-look')).toBeVisible();
    const before = (await readState(page)).evening.tabletop!;
    await view.aim('bread'); // Actual multi-step touch movement must not become an inspection tap.
    await expect(page.locator('#tabletop-inspector')).toBeHidden();
    expect((await readState(page)).evening.tabletop).toEqual(before);
    const point = await view.point('bread'); await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator('#tabletop-inspector')).toHaveAttribute('data-target', 'bread');
    await expect(page.locator('#tabletop-object-name')).toHaveText('Bread basket');
    expect((await readState(page)).evening.tabletop!.breadEaten).toBe(0);
    expect(commands.filter(command => command.type === 'tabletop')).toHaveLength(0);
    await page.screenshot({ path: '.qa/tabletop/main-mobile-inspection.png' });
    await page.locator('#tabletop-use').tap();
    await expect.poll(async () => (await readState(page)).evening.tabletop!.breadEaten).toBe(1);
    await view.back(true);
    expect((await readState(page)).evening.tabletop!.shared.breadRemaining).toBe(3);
    expect(commands.filter(command => command.type === 'tabletop')).toEqual([{ type: 'tabletop', action: 'take-bread' }]);
    expect((await readState(page)).usage.claudeRequests).toBe(0); expect(providerCalls).toBe(0); expect(errors).toEqual([]);
    await cdp.detach();
  });
});
