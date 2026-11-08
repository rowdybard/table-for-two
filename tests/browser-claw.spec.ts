import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { RoomState } from '../src/shared/protocol';
import { CLAW } from '../src/shared/venue';

const state = (page: Page) => page.evaluate(() => (window as unknown as { __lfsState: RoomState }).__lfsState);
async function walk(page: Page, name: string, key: string, axis: 0 | 2, target: number, sign: -1 | 1, errors: string[]) {
  await page.bringToFront();
  await page.locator('canvas').click({ position: { x: 480, y: 400 } });
  for (let i = 0; i < 60; i++) {
    const position = (await state(page)).players.find(player => player.name === name)!.position;
    if (sign * (position[axis] - target) >= 0) return;
    await page.keyboard.down(key); await page.waitForTimeout(160); await page.keyboard.up(key);
  }
  const snapshot = await state(page);
  const context = await page.evaluate(() => ({ focus: document.hasFocus(), visibility: document.visibilityState, connection: document.getElementById('connection')?.textContent }));
  throw new Error(`${name} could not reach ${axis}=${target} with ${key}; position ${JSON.stringify(snapshot.players.find(player => player.name === name)?.position)}, phase ${snapshot.phase}, pause ${snapshot.pauseReason}, players ${JSON.stringify(snapshot.players.map(player => ({ name: player.name, connected: player.connected })))}, context ${JSON.stringify(context)}, page errors ${JSON.stringify(errors)}`);
}

/** Hold the actual on-screen directional control; snapshots only decide when to release. */
async function steer(page: Page, axis: 'x' | 'z', target: number, tolerance = .16) {
  await page.bringToFront();
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = (await state(page)).claw[axis];
    if (Math.abs(current - target) <= tolerance) return;
    const positive = target > current;
    const control = page.locator(positive ? '#claw-right' : '#claw-left');
    await expect(control).toBeEnabled();
    const box = await control.boundingBox();
    if (!box) throw new Error('Claw direction control is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    try { await page.waitForTimeout(Math.max(35, Math.min(130, (Math.abs(current - target) - tolerance * .4) * 450))); }
    finally { await page.mouse.up(); }
    await page.waitForTimeout(150);
  }
  const actual = (await state(page)).claw[axis];
  if (Math.abs(actual - target) <= tolerance) return;
  throw new Error(`Could not align ${axis} with ${target}; actual ${actual}`);
}

async function resumeBoth(a: Page, b: Page) {
  await a.locator('#resume').click(); await b.locator('#resume').click();
  await expect.poll(async () => (await state(a)).phase).toBe('playing');
}
async function keyboardSteer(page: Page, key: string, axis: 'x' | 'z', start: number) {
  await page.bringToFront(); await page.locator('#claw-right').focus(); await page.keyboard.down(key);
  try { await expect.poll(async () => (await state(page)).claw[axis], { timeout: 10_000 }).toBeGreaterThan(start + .02); }
  catch (error) {
    const details = await page.evaluate(() => ({
      focus: document.hasFocus(), visibility: document.visibilityState, active: `${document.activeElement?.tagName}#${document.activeElement?.id}`,
      phase: (window as unknown as { __lfsState: RoomState }).__lfsState.phase,
      operators: (window as unknown as { __lfsState: RoomState }).__lfsState.claw.operators,
      overlays: Object.fromEntries(['chat','voice-panel','midnight-choice','celebration'].map(id => [id, !document.getElementById(id)!.hidden])),
    }));
    throw new Error(`Keyboard ${key} did not move ${axis}: ${JSON.stringify(details)}`, { cause: error });
  } finally { await page.keyboard.up(key); }
}

test('two people retry, catch and release the oversized claw prize', async ({ browser }) => {
  test.setTimeout(180_000);
  await mkdir('.qa', { recursive: true });
  const aContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const bContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const errors: string[] = [];
  try {
    const a = await aContext.newPage(), b = await bContext.newPage();
    for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
    await a.goto('http://127.0.0.1:5173/?venue=bowling'); await a.locator('#name').fill('Alex'); await a.locator('#join').click();
    await expect(a.locator('#arrival')).toBeHidden();
    const room = (await state(a)).room;
    await b.goto('http://127.0.0.1:5173/?venue=bowling'); await b.locator('#name').fill('Sam'); await b.locator('#room').fill(room); await b.locator('#join').click();
    await expect.poll(async () => (await state(a)).phase).toBe('playing');
    for (const [page, name, x] of [[a, 'Alex', CLAW.centerX - .8], [b, 'Sam', CLAW.centerX + .6]] as const) {
      await walk(page, name, 'w', 2, CLAW.centerZ + 5.1, -1, errors); await walk(page, name, 'd', 0, x, 1, errors); await walk(page, name, 'w', 2, CLAW.centerZ + 2.6, -1, errors);
      await page.locator('#interact').click(); await expect(page.locator('#claw')).toBeVisible(); await page.locator('#claw-join').click();
    }
    await expect.poll(async () => (await state(a)).claw.operators).toEqual({ x: 'p1', z: 'p2' });
    await a.screenshot({ path: '.qa/claw-ordinary-1280.png' }); await b.screenshot({ path: '.qa/claw-ordinary-1000.png' });

    // The assigned axes also respond to their advertised keyboard controls.
    const keyboardStart = (await state(a)).claw;
    await keyboardSteer(a, 'd', 'x', keyboardStart.x);
    await keyboardSteer(b, 's', 'z', keyboardStart.z);

    // Make a deliberate miss: each person moves their own axis away from the prize.
    await steer(a, 'x', CLAW.minX, .015); await steer(b, 'z', CLAW.maxZ, .04);
    expect((await state(a)).claw.moved).toEqual({ x: true, z: true });
    await a.locator('#claw-ready').click(); await expect.poll(async () => (await state(b)).claw.ready.p1).toBe(true);
    await a.locator('#pause').click(); await expect.poll(async () => (await state(a)).phase).toBe('paused');
    expect((await state(a)).claw.ready).toEqual({ p1: false, p2: false });
    await resumeBoth(a, b);
    expect((await state(a)).claw.ready).toEqual({ p1: false, p2: false });
    await a.locator('#claw-ready').click(); await b.locator('#claw-ready').click();
    await expect.poll(async () => (await state(a)).claw.phase).toBe('dropping');
    await a.locator('#pause').click(); await expect.poll(async () => (await state(a)).phase).toBe('paused');
    const frozen = (await state(a)).claw.y; await a.waitForTimeout(600);
    expect((await state(a)).claw.y).toBe(frozen);
    await resumeBoth(a, b);
    await expect.poll(async () => (await state(a)).claw.phase, { timeout: 15_000 }).toBe('aiming');
    expect((await state(a)).claw.attempts).toBe(1);
    expect((await state(a)).objects.some(object => object.kind === 'giant-prize')).toBe(false);

    // Use both controls to align with the actual prize and opt in to the drop.
    const prize = (await state(a)).objects.find(object => object.kind === 'claw-prize')!;
    await steer(a, 'x', prize.position[0]); await steer(b, 'z', prize.position[2]);
    const aligned = (await state(a)).claw;
    expect(Math.hypot(aligned.x - prize.position[0], aligned.z - prize.position[2])).toBeLessThan(CLAW.captureRadius);
    await a.screenshot({ path: '.qa/claw-aim-1280.png' }); await b.screenshot({ path: '.qa/claw-aim-1000.png' });
    await a.locator('#claw-ready').click(); await b.locator('#claw-ready').click();
    await expect.poll(async () => (await state(a)).claw.phase).toBe('dropping');
    await a.screenshot({ path: '.qa/claw-drop-1280.png' }); await b.screenshot({ path: '.qa/claw-drop-1000.png' });
    await expect.poll(async () => (await state(a)).claw.prizeHeld, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await state(a)).claw.phase, { timeout: 15_000 }).toBe('surprise');
    await expect.poll(async () => (await state(b)).objects.some(object => object.kind === 'giant-prize')).toBe(true);
    expect((await state(a)).objects.some(object => object.kind === 'claw-prize')).toBe(false);
    await a.screenshot({ path: '.qa/claw-surprise-1280.png' }); await b.screenshot({ path: '.qa/claw-surprise-1000.png' });

    await steer(a, 'x', CLAW.surpriseMinX, .04); await steer(b, 'z', CLAW.maxZ, .04);
    await expect(a.locator('#claw-ready')).toBeEnabled(); await expect(b.locator('#claw-ready')).toBeEnabled();
    const beforeA = (await state(a)).objects.find(object => object.kind === 'giant-prize')!.position;
    const beforeB = (await state(b)).objects.find(object => object.kind === 'giant-prize')!.position;
    await a.locator('#claw-ready').click(); await b.locator('#claw-ready').click();
    await expect.poll(async () => (await state(a)).claw.phase).toBe('won');
    await expect.poll(async () => (await state(b)).claw.phase).toBe('won');
    for (const [page, before] of [[a,beforeA],[b,beforeB]] as const) {
      await expect.poll(async () => {
        const p = (await state(page)).objects.find(object => object.kind === 'giant-prize')?.position;
        return p ? Math.hypot(p[0] - before[0], p[1] - before[1], p[2] - before[2]) : 0;
      }, { timeout: 10_000 }).toBeGreaterThan(.3);
    }
    expect((await state(a)).claw.prizeHeld).toBe(false); expect((await state(b)).claw.prizeHeld).toBe(false);
    await a.screenshot({ path: '.qa/claw-release-1280.png' }); await b.screenshot({ path: '.qa/claw-release-1000.png' });
    expect(errors).toEqual([]);
  } finally { await aContext.close(); await bContext.close(); }
});
