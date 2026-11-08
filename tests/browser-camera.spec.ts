import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { RoomState } from '../src/shared/protocol';
import { DESK, LOUNGE } from '../src/shared/venue';

const state = (page: Page) => page.evaluate(() => (window as unknown as { __lfsState: RoomState }).__lfsState);
async function walk(page: Page, name: string, key: string, axis: 0 | 2, target: number, direction: -1 | 1) {
  await page.bringToFront(); await page.locator('canvas').click({ position: { x: 480, y: 400 } });
  for (let i = 0; i < 80; i++) {
    const p = (await state(page)).players.find(player => player.name === name)!.position;
    if (direction * (p[axis] - target) >= 0) return;
    await page.keyboard.down(key); await page.waitForTimeout(120); await page.keyboard.up(key); await page.waitForTimeout(100);
  }
  throw new Error(`Movement blocked: ${JSON.stringify((await state(page)).players)}`);
}
async function projected(page: Page, position: number[]) {
  return page.evaluate(({x,y,z}) => {
    const view = (window as unknown as { __lfsView: { projectWorld: (p: [number,number,number]) => {x:number;y:number;visible:boolean} } }).__lfsView;
    return { head: view.projectWorld([x,y + 1,z]), foot: view.projectWorld([x,y - .75,z]) };
  }, {x: position[0], y: position[1], z: position[2]});
}
async function settledProjection(page: Page, name: string) {
  let last: { x: number; y: number } | undefined, stable = 0;
  await expect.poll(async () => {
    const position = (await state(page)).players.find(player => player.name === name)!.position;
    const point = (await projected(page, position)).head;
    stable = last && Math.hypot(point.x - last.x, point.y - last.y) < 2 ? stable + 1 : 0;
    last = point; return stable;
  }, {timeout: 10_000, intervals: [100]}).toBeGreaterThanOrEqual(3);
  const position = (await state(page)).players.find(player => player.name === name)!.position;
  return projected(page, position);
}

// These projection checks cover viewport framing; captured images are still
// needed to judge furniture occlusion and character presentation.
test('close camera follows the pair and keeps players framed near furniture', async ({ browser }) => {
  test.setTimeout(120_000); await mkdir('.qa', { recursive: true });
  const ac = await browser.newContext({viewport:{width:1280,height:800}}), bc = await browser.newContext({viewport:{width:1000,height:700}});
  try {
    const a = await ac.newPage(), b = await bc.newPage(), errors: string[] = [];
    for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
    await a.goto('/?venue=bowling'); await a.locator('#name').fill('Alex'); await a.locator('#join').click(); await expect(a.locator('#arrival')).toBeHidden();
    const room = (await state(a)).room;
    await b.goto('/?venue=bowling'); await b.locator('#name').fill('Sam'); await b.locator('#room').fill(room); await b.locator('#join').click();
    await expect.poll(async () => (await state(a)).phase).toBe('playing');
    await walk(a,'Alex','w',2,.2,-1); await a.bringToFront(); await a.keyboard.press('v');
    await walk(b,'Sam','w',2,2.5,-1);
    const normal = await settledProjection(a,'Alex');
    await a.bringToFront(); await a.keyboard.press('v');
    await expect.poll(async () => {
      const p = (await state(a)).players.find(player => player.name === 'Alex')!.position;
      const close = await projected(a, p);
      return Math.abs(close.foot.y-close.head.y) / Math.abs(normal.foot.y-normal.head.y);
    }, { timeout: 10_000 }).toBeGreaterThan(1.2);
    await settledProjection(a,'Alex');
    const pair = (await state(a)).players;
    const heads = await Promise.all(pair.map(p => projected(a,p.position)));
    expect(heads.every(p => p.head.visible)).toBe(true);
    expect(Math.abs(heads[0].head.x-heads[1].head.x)).toBeGreaterThan(30);
    await a.screenshot({path:'.qa/camera-z-conversation-1280.png'}); await a.keyboard.press('v');
    await walk(b,'Sam','d',0,LOUNGE.leftX - 1.0,1); await walk(b,'Sam','s',2,LOUNGE.z,1);
    const booth = await settledProjection(b,'Sam');
    expect(booth.head.visible && booth.foot.visible).toBe(true); expect(booth.head.y).toBeGreaterThan(108); expect(booth.foot.y).toBeLessThan(640);
    await b.screenshot({path:'.qa/camera-booth-1000.png'});
    await walk(a,'Alex','s',2,DESK.z - DESK.half[2] - 1.35,1); await walk(a,'Alex','a',0,DESK.x,-1);
    const counter = await settledProjection(a,'Alex');
    expect(counter.head.visible && counter.foot.visible).toBe(true); expect(counter.head.y).toBeGreaterThan(108); expect(counter.foot.y).toBeLessThan(740);
    await a.screenshot({path:'.qa/camera-counter-1280.png'});
    expect(errors).toEqual([]);
  } finally { await ac.close(); await bc.close(); }
});
