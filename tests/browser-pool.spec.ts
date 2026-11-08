import { expect, test, type Page } from '@playwright/test';
import type { RoomState } from '../src/shared/protocol';
import { POOL } from '../src/shared/venue';

const state = (page: Page) => page.evaluate(() => (window as unknown as { __lfsState: RoomState }).__lfsState);
async function walk(page: Page, name: string, key: string, axis: 0 | 2, target: number) {
  await page.locator('canvas').click({ position: { x: 480, y: 400 } });
  for (let i = 0; i < 55; i++) {
    const p = (await state(page)).players.find(player => player.name === name)!.position;
    if (p[axis] <= target) return;
    await page.keyboard.down(key); await page.waitForTimeout(160); await page.keyboard.up(key);
  }
  throw new Error(`${name} could not reach pool`);
}

test('two players play pool, drag the cue and recover after interruption', async ({ browser }) => {
  test.setTimeout(180_000);
  const aContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const bContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const errors: string[] = [];
  try {
    const a = await aContext.newPage(), b = await bContext.newPage();
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    await a.goto('http://127.0.0.1:5173/?venue=bowling'); await a.locator('#name').fill('Alex'); await a.locator('#join').click();
    await expect(a.locator('#arrival')).toBeHidden();
    const room = (await state(a)).room;
    await b.goto('http://127.0.0.1:5173/?venue=bowling'); await b.locator('#name').fill('Sam'); await b.locator('#room').fill(room); await b.locator('#join').click();
    await expect.poll(async () => (await state(a)).phase).toBe('playing');

    const sound = a.locator('#sound-toggle');
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
    await sound.click(); await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await sound.click(); await expect(sound).toHaveAttribute('aria-pressed', 'false');

    for (const [page, name] of [[a, 'Alex'], [b, 'Sam']] as const) {
      await walk(page, name, 'w', 2, POOL.maxZ + 1.2);
      await page.locator('#interact').click(); await expect(page.locator('#pool')).toBeVisible();
      await page.locator('#pool-join').click();
    }
    await expect.poll(async () => (await state(a)).pool.phase).toBe('aiming');
    expect((await state(a)).pool.turn).toBe('p1');
    const initial = (await state(a)).pool, cue = initial.balls.find(ball => ball.id === 0)!.position;
    await a.locator('#pool-power').focus();
    await a.keyboard.press('Space');
    await expect.poll(async () => (await state(b)).pool.shots).toBe(initial.shots + 1);
    await expect.poll(async () => {
      const white = (await state(b)).pool.balls.find(ball => ball.id === 0);
      return white ? Math.hypot(white.position[0] - cue[0], white.position[2] - cue[2]) : 0;
    }).toBeGreaterThan(.1);
    await expect.poll(async () => (await state(b)).pool.phase, { timeout: 30_000 }).toBe('aiming');
    expect((await state(b)).pool.turn).toBe('p2');
    await b.locator('#pool-pass').click(); await expect.poll(async () => (await state(a)).pool.turn).toBe('p1');
    await a.locator('#pool-exit').click(); await expect.poll(async () => (await state(b)).pool.participants.length).toBe(1);
    await a.locator('#interact').click(); await a.locator('#pool-join').click();
    await expect.poll(async () => (await state(b)).pool.participants.length).toBe(2);

    // Project the observed cue position onto the real camera and use normal
    // pointer events; snapshots and the read-only view supply coordinates only.
    const before = (await state(a)).pool, white = before.balls.find(ball => ball.id === 0)!.position;
    const points = await a.evaluate(({ x, z, y }) => {
      const view = (window as unknown as { __lfsView: { projectWorld: (point: [number, number, number]) => { x: number; y: number; visible: boolean } } }).__lfsView;
      return [view.projectWorld([x, y, z]), view.projectWorld([x - .55, y, z])];
    }, { x: white[0], z: white[2], y: POOL.height });
    expect(points.every(point => point.visible)).toBe(true);
    await a.mouse.move(points[0].x, points[0].y); await a.mouse.down();
    await a.mouse.move(points[1].x, points[1].y, { steps: 8 }); await a.mouse.up();
    await expect.poll(async () => (await state(b)).pool.shots).toBe(before.shots + 1);
    await expect.poll(async () => (await state(a)).pool.phase).toBe('rolling');
    await expect(a.locator('#pool-shoot')).toBeDisabled(); await expect(b.locator('#pool-shoot')).toBeDisabled();
    await a.locator('#pause').click(); await expect.poll(async () => (await state(a)).phase).toBe('paused');
    const frozen = (await state(a)).pool.balls.map(ball => ball.position); await a.waitForTimeout(500);
    expect((await state(a)).pool.balls.map(ball => ball.position)).toEqual(frozen);
    await a.locator('#resume').click(); await b.locator('#resume').click();
    await expect.poll(async () => (await state(b)).pool.phase, { timeout: 30_000 }).toBe('aiming');

    await b.reload(); await expect.poll(async () => (await state(a)).pauseReason).toBe('reconnect');
    await b.locator('#name').fill('Sam'); await b.locator('#join').click();
    await expect.poll(async () => (await state(a)).pauseReason).toBe('manual');
    await a.locator('#resume').click(); await b.locator('#resume').click();
    await expect.poll(async () => (await state(a)).phase).toBe('playing');
    await b.locator('#interact').click(); await expect(b.locator('#pool')).toBeVisible();
    await expect(b.locator('#pool-join')).toBeHidden();
    expect(errors).toEqual([]);
  } finally { await aContext.close(); await bContext.close(); }
});
