import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { RoomState } from '../src/shared/protocol';
import { VENUE } from '../src/shared/venue';

const state = (page: Page) => page.evaluate(() => (window as unknown as { __lfsState: RoomState }).__lfsState);
async function walk(page: Page, name: string, key: string, axis: 0 | 2, target: number, sign: -1 | 1) {
  await page.bringToFront(); await page.locator('canvas').click({ position: { x: 480, y: 400 } });
  for (let i = 0; i < 70; i++) {
    const position = (await state(page)).players.find(player => player.name === name)!.position;
    if (sign * (position[axis] - target) >= 0) return;
    await page.keyboard.down(key); await page.waitForTimeout(150); await page.keyboard.up(key);
  }
  const snapshot = await state(page);
  throw new Error(`${name} could not reach ${axis}=${target}; position=${JSON.stringify(snapshot.players.find(player => player.name === name)?.position)}, phase=${snapshot.phase}`);
}
async function capture(a: Page, b: Page, label: string) {
  await a.screenshot({ path: `.qa/lane-${label}-1280.png` });
  await b.screenshot({ path: `.qa/lane-${label}-1000.png` });
}
async function angle(page: Page, side: 'left' | 'right') {
  const object = (await state(page)).objects.find(item => item.id === `lane-flipper-${side}`);
  if (!object) throw new Error(`${side} physical flipper is missing`);
  return 2 * Math.atan2(object.rotation[1], object.rotation[3]);
}
async function keyboardFlipper(page: Page, observer: Page, key: 'a' | 'd', side: 'left' | 'right') {
  const rest = await angle(observer, side);
  await page.bringToFront(); await page.locator(`#flipper-${side}`).focus(); await page.keyboard.down(key);
  try { await expect.poll(async () => Math.abs((await angle(observer, side)) - rest), { timeout: 10_000 }).toBeGreaterThan(.2); }
  finally { await page.keyboard.up(key); }
  await expect.poll(async () => Math.abs((await angle(observer, side)) - rest), { timeout: 10_000 }).toBeLessThan(.1);
}
async function pointerFlipper(page: Page, observer: Page, side: 'left' | 'right') {
  const rest = await angle(observer, side), button = page.locator(`#flipper-${side}`);
  await page.bringToFront(); await expect(button).toBeEnabled();
  const box = await button.boundingBox(); if (!box) throw new Error(`${side} flipper control is not visible`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  try { await expect.poll(async () => Math.abs((await angle(observer, side)) - rest), { timeout: 10_000 }).toBeGreaterThan(.2); }
  finally { await page.mouse.up(); }
  await expect.poll(async () => Math.abs((await angle(observer, side)) - rest), { timeout: 10_000 }).toBeLessThan(.1);
}
async function settled(page: Page) {
  await expect.poll(async () => (await state(page)).lane.canReset, { timeout: 45_000 }).toBe(true);
}

test('both people warm up, cooperate on arcade flippers and swap roles', async ({ browser }) => {
  test.setTimeout(240_000);
  await mkdir('.qa', { recursive: true });
  const aContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const bContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const errors: string[] = [];
  const laneFrames: string[] = [];
  try {
    const a = await aContext.newPage(), b = await bContext.newPage();
    for (const [page, label] of [[a, 'Alex'], [b, 'Sam']] as const) {
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => {
        socket.on('framesent', ({ payload }) => {
          try { const frame = JSON.parse(String(payload)); if (['bowl','reset-lane','lane-join','lane-mode'].includes(frame.type)) laneFrames.push(`${label} sent ${frame.type}`); } catch { /* Ignore non-JSON frames. */ }
        });
        socket.on('framereceived', ({ payload }) => {
          try { const frame = JSON.parse(String(payload)); if (frame.type === 'error') laneFrames.push(`${label} received error: ${frame.message}`); } catch { /* Ignore non-JSON frames. */ }
        });
      });
    }
    await a.goto('http://127.0.0.1:5173/?venue=bowling'); await a.locator('#name').fill('Alex'); await a.locator('#join').click(); await expect(a.locator('#arrival')).toBeHidden();
    const room = (await state(a)).room;
    await b.goto('http://127.0.0.1:5173/?venue=bowling'); await b.locator('#name').fill('Sam'); await b.locator('#room').fill(room); await b.locator('#join').click();
    await expect.poll(async () => (await state(a)).phase).toBe('playing');
    // Separate z paths avoid colliding with each other and leave the tee clear.
    await walk(a,'Alex','w',2,4.2,-1); await walk(a,'Alex','a',0,VENUE.laneX + 1.9,-1);
    await a.locator('#interact').click(); await expect(a.locator('#bowling')).toBeVisible();
    await walk(b,'Sam','w',2,2.2,-1); await walk(b,'Sam','a',0,VENUE.laneX,-1);
    await b.locator('#interact').click(); await expect(b.locator('#bowling')).toBeVisible();
    await expect.poll(async () => (await state(a)).lane.participants.length).toBe(2);
    await capture(a,b,'normal');

    await a.locator('#bowl').click(); await settled(a);
    expect((await state(a)).lane.warmups).toEqual({ p1: true, p2: false });
    const beforeFirstReset = await state(a);
    await a.locator('#reset-lane').click();
    try { await expect.poll(async () => (await state(a)).lane.canBowl, { timeout: 10_000 }).toBe(true); }
    catch (error) { const after = await state(a); throw new Error(`First reset failed: ${JSON.stringify({ before: { lane: beforeFirstReset.lane, players: beforeFirstReset.players, phase: beforeFirstReset.phase }, after: { lane: after.lane, players: after.players, phase: after.phase }, laneFrames, toast: await a.locator('#toast').textContent(), alerts: await a.getByRole('alert').allTextContents(), status: await a.locator('#lane-status').textContent() })}`, { cause: error }); }
    await b.locator('#bowl').click(); await settled(b);
    expect((await state(b)).lane.warmups).toEqual({ p1: true, p2: true });
    expect((await state(b)).lane.unlocked).toBe(true);
    const beforeActivation = await state(b);
    await b.locator('#reset-lane').click();
    try { await expect.poll(async () => (await state(a)).lane.mode, { timeout: 10_000 }).toBe('arcade'); }
    catch (error) {
      const after = await state(b);
      throw new Error(`Arcade activation failed: ${JSON.stringify({ before: { lane: beforeActivation.lane, players: beforeActivation.players, phase: beforeActivation.phase }, after: { lane: after.lane, players: after.players, phase: after.phase }, laneFrames, toast: await b.locator('#toast').textContent(), alerts: await b.getByRole('alert').allTextContents(), status: await b.locator('#lane-status').textContent() })}`, { cause: error });
    }
    await expect.poll(async () => (await state(b)).lane.pilot).toBe('p2');
    expect((await state(a)).lane.roller).toBe('p1'); expect((await state(a)).lane.round).toBe(1);
    await expect(a.locator('#lane-roller-controls')).toBeVisible(); await expect(b.locator('#lane-roller-controls')).toBeHidden();
    await expect(b.locator('#lane-flippers')).toBeVisible(); await capture(a,b,'activation');

    // The pilot's Space key must not roll the ball.
    await b.bringToFront(); await b.locator('#flipper-left').focus(); await b.keyboard.press('Space'); await b.waitForTimeout(500);
    expect((await state(a)).lane.canBowl).toBe(true); expect((await state(a)).lane.bowler).toBeNull();
    await keyboardFlipper(b,a,'a','left'); await pointerFlipper(b,a,'right');

    // Pause with a key held. Physics freezes, and resume must not retain the hold.
    const rest = await angle(a,'left');
    await b.bringToFront(); await b.locator('#flipper-left').focus(); await b.keyboard.down('a');
    await expect.poll(async () => Math.abs((await angle(a,'left')) - rest)).toBeGreaterThan(.2);
    await b.locator('#pause').click(); await expect.poll(async () => (await state(a)).phase).toBe('paused');
    const frozen = await angle(a,'left'); await a.waitForTimeout(600); expect(await angle(a,'left')).toBeCloseTo(frozen, 4);
    await a.locator('#resume').click(); await b.locator('#resume').click(); await expect.poll(async () => (await state(a)).phase).toBe('playing');
    await expect.poll(async () => Math.abs((await angle(a,'left')) - rest), { timeout: 10_000 }).toBeLessThan(.1);
    await b.keyboard.up('a');

    // Leaving the lane removes the pilot and prevents an absent player's keys from moving flippers.
    await b.locator('#bowling-exit').click(); await expect.poll(async () => (await state(a)).lane.participants).toEqual(['p1']);
    await expect.poll(async () => (await state(a)).lane.canBowl).toBe(false);
    const absentRest = await angle(a,'right'); await b.bringToFront(); await b.keyboard.down('d'); await b.waitForTimeout(350); await b.keyboard.up('d');
    expect(Math.abs((await angle(a,'right')) - absentRest)).toBeLessThan(.1);
    await b.locator('#interact').click(); await expect.poll(async () => (await state(a)).lane.participants.length).toBe(2);
    await expect.poll(async () => (await state(a)).lane.canBowl).toBe(true);

    const ballBefore = (await state(a)).objects.find(object => object.id === 'bowling-ball')!.position;
    await a.locator('#bowl').click(); await expect.poll(async () => (await state(b)).lane.canBowl).toBe(false);
    await expect.poll(async () => {
      const ball = (await state(b)).objects.find(object => object.id === 'bowling-ball')!;
      return Math.abs(ball.position[2] - ballBefore[2]);
    }).toBeGreaterThan(.5);
    await capture(a,b,'rolling'); await pointerFlipper(b,a,'right');
    await settled(a); await expect.poll(async () => (await state(a)).lane.roundSettled).toBe(true);
    const roundOne = (await state(a)).lane; expect(roundOne.score).toBe(roundOne.pinsDown);
    await a.locator('#reset-lane').click();
    await expect.poll(async () => (await state(a)).lane.round).toBe(2);
    await expect.poll(async () => (await state(b)).lane.roller).toBe('p2');
    expect((await state(b)).lane.pilot).toBe('p1');
    await expect(a.locator('#lane-flippers')).toBeVisible(); await expect(b.locator('#lane-roller-controls')).toBeVisible();
    await capture(a,b,'swap'); await keyboardFlipper(a,b,'d','right');
    await b.locator('#bowl').click(); await settled(b);
    await expect.poll(async () => (await state(a)).lane.complete).toBe(true);
    const finalA = (await state(a)).lane, finalB = (await state(b)).lane;
    expect(finalA.score).toBe(roundOne.score + finalA.pinsDown); expect(finalB.score).toBe(finalA.score);
    await expect(a.locator('#lane-score')).toContainText(`${finalA.score} / 20`); await capture(a,b,'result');

    // Show that an intentionally coordinated shot can clear the flippers
    // and reach the pins. Dispatch the roller's button click without shifting
    // the shared browser's focus away from the pilot's held controls.
    await a.locator('#reset-lane').click();
    await expect.poll(async () => (await state(a)).lane.round).toBe(1);
    await expect.poll(async () => (await state(a)).lane.canBowl).toBe(true);
    await a.locator('#power').fill('0.7');
    const leftRest = await angle(a,'left'), rightRest = await angle(a,'right');
    await b.bringToFront(); await b.locator('#flipper-left').focus();
    await b.keyboard.down('a'); await b.keyboard.down('d');
    try {
      await expect.poll(async () => Math.abs((await angle(a,'left')) - leftRest), { timeout: 10_000 }).toBeGreaterThan(.3);
      await expect.poll(async () => Math.abs((await angle(a,'right')) - rightRest), { timeout: 10_000 }).toBeGreaterThan(.3);
      await a.locator('#bowl').evaluate((button: HTMLButtonElement) => button.click());
      await expect.poll(async () => (await state(b)).lane.canBowl).toBe(false);
      await expect.poll(async () => (await state(b)).objects.find(object => object.id === 'bowling-ball')!.position[2], { timeout: 10_000, intervals: [100] }).toBeLessThan(-7);
    } catch (error) {
      const snapshot = await state(b);
      throw new Error(`Coordinated shot did not clear flippers: ${JSON.stringify({ ball: snapshot.objects.find(object => object.id === 'bowling-ball')?.position, left: await angle(b,'left'), right: await angle(b,'right'), lane: snapshot.lane })}`, { cause: error });
    } finally { await b.keyboard.up('a'); await b.keyboard.up('d'); }
    try { await expect.poll(async () => (await state(a)).lane.pinsDown, { timeout: 20_000 }).toBeGreaterThan(0); }
    catch (error) {
      const snapshot = await state(a);
      throw new Error(`Coordinated shot cleared flippers but did not hit pins: ${JSON.stringify({ ball: snapshot.objects.find(object => object.id === 'bowling-ball')?.position, left: await angle(a,'left'), right: await angle(a,'right'), lane: snapshot.lane })}`, { cause: error });
    }
    await capture(a,b,'coordinated-hit');
    expect(errors).toEqual([]);
  } finally { await aContext.close(); await bContext.close(); }
});
