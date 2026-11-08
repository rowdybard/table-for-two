import { test, expect, type Page } from '@playwright/test';
import type { RoomState } from '../src/shared/protocol';
import { mkdir } from 'node:fs/promises';
import { VENUE } from '../src/shared/venue';

const state = (page: Page) => page.evaluate(() => (window as unknown as { __lfsState: RoomState }).__lfsState);
async function walkToAxis(page: Page, key: string, axis: 0 | 2, target: number, direction: -1 | 1) {
  for (let i = 0; i < 35; i++) {
    const position = (await state(page)).players.find(p => p.name === 'Alex')!.position;
    if (direction * (position[axis] - target) >= 0) return;
    await page.keyboard.down(key); await page.waitForTimeout(220); await page.keyboard.up(key);
  }
  throw new Error(`Could not walk to ${axis}=${target}`);
}

test('two players can join, communicate, move, pause and reconnect', async ({ browser }) => {
  test.setTimeout(180_000);
  await mkdir('.qa', { recursive: true });
  const alexContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const samContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  try {
    const alex = await alexContext.newPage(), sam = await samContext.newPage();
    await alex.goto('http://127.0.0.1:5173/?venue=bowling');
    await expect(alex.locator('#connection')).toContainText('alley is open');
    await alex.locator('#name').fill('Alex'); await alex.locator('#join').click();
    await expect(alex.locator('#arrival')).toBeHidden();
    await expect.poll(async () => (await state(alex)).room).toMatch(/^[A-Z0-9]{6}$/);
    const room = (await state(alex)).room;
    await sam.goto('http://127.0.0.1:5173/?venue=bowling');
    await sam.locator('#name').fill('Sam'); await sam.locator('#room').fill(room); await sam.locator('#join').click();
    await expect.poll(async () => (await state(alex)).phase).toBe('playing');
    await expect.poll(async () => (await state(sam)).players.length).toBe(2);
    await alex.screenshot({ path: '.qa/browser-1280.png' });
    await sam.screenshot({ path: '.qa/browser-1000.png' });

    const message = '<img src=x onerror="window.bad=1"> hello';
    await alex.locator('#chat-toggle').click(); await sam.locator('#chat-toggle').click();
    await alex.locator('#chat-input').fill(message); await alex.locator('#chat-form button').click();
    await expect(sam.locator('#chat-log')).toContainText(message);
    await expect(sam.locator('#chat-log img')).toHaveCount(0);
    await sam.locator('#chat-close').click(); await alex.locator('#chat-close').click();

    await alex.locator('#pause').click();
    await expect(alex.locator('#pause-screen')).toBeVisible(); await expect(sam.locator('#pause-screen')).toBeVisible();
    await alex.locator('#resume').click(); await expect(alex.locator('#resume')).toBeDisabled();
    expect((await state(sam)).phase).toBe('paused');
    await sam.locator('#resume').click(); await expect(alex.locator('#pause-screen')).toBeHidden();

    await alex.locator('canvas').click({ position: { x: 640, y: 400 } });
    // Walk down the central aisle, then across to the approach. Inputs go
    // through the game; the observed position only determines when to stop.
    await walkToAxis(alex, 'w', 2, 2.2, -1);
    await walkToAxis(alex, 'a', 0, VENUE.laneX + 1.8, -1);
    await expect(alex.locator('#interact')).toBeVisible();
    await alex.locator('#interact').click();
    await expect(alex.locator('#bowling')).toBeVisible();
    await alex.screenshot({ path: '.qa/browser-bowling.png' });
    const ballBefore = (await state(alex)).objects.find(o => o.id === 'bowling-ball')!.position;
    await alex.locator('#bowl').click();
    await expect.poll(async () => (await state(sam)).lane.canBowl).toBe(false);
    await expect.poll(async () => {
      const ball = (await state(sam)).objects.find(o => o.id === 'bowling-ball');
      return ball ? Math.abs(ball.position[2] - ballBefore[2]) : 0;
    }, { timeout: 15_000 }).toBeGreaterThan(1);
    await expect.poll(async () => (await state(sam)).lane.pinsDown, { timeout: 25_000 }).toBeGreaterThan(0);
    await alex.locator('#bowling-exit').click();

    // A real page reload closes Sam's connection, retaining only the room token
    // in that browser tab. Rejoining must restore the seat and require both ready.
    await sam.reload();
    await expect.poll(async () => (await state(alex)).pauseReason, { timeout: 15_000 }).toBe('reconnect');
    await sam.locator('#name').fill('Sam'); await sam.locator('#join').click();
    await expect.poll(async () => (await state(alex)).pauseReason, { timeout: 15_000 }).toBe('manual');
    await alex.locator('#resume').click(); await sam.locator('#resume').click();
    await expect.poll(async () => (await state(alex)).phase).toBe('playing');
    await alex.locator('#leave').click();
    await expect(alex.locator('#arrival')).toBeVisible(); await expect(sam.locator('#arrival')).toBeVisible();
    await expect(sam.locator('#connection')).toContainText('left the date');
  } finally { await alexContext.close(); await samContext.close(); }
});
