import { createServer, type Server } from 'node:http';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { expect, test } from '@playwright/test';
import type { DinnerCommand, DinnerState } from '../src/restaurant/types';
import type { EveningInterface } from '../src/restaurant/EveningInterface';

interface ConsequenceWindow extends Window {
  __consequenceFixture: {
    state: DinnerState;
    ui: EveningInterface;
    commands: DinnerCommand[];
    notices: string[];
    update(): void;
    hold(presence: 'privacy-break' | 'cleanup-break' | 'at-table'): void;
    receipt(double?: boolean): void;
    replace(): void;
  };
}
let vite: ViteDevServer, server: Server, base = '';

test.beforeAll(async () => {
  vite = await createViteServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  server = createServer((req, res) => {
    if (req.url === '/__consequence_fixture') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module">
        import '/src/restaurant/style.css';import '/src/restaurant/mobile.css';
        import { markup } from '/src/restaurant/ui.ts';
        import { EveningInterface } from '/src/restaurant/EveningInterface.ts';
        import { createEvening } from '/src/restaurant/evening.ts';
        import { createRestaurantScenario } from '/src/restaurant/scenarios.ts';
        import { createScenarioCareState, buildDinnerBill } from '/src/restaurant/scenario-care.ts';
        import { installUiTheme } from '/src/restaurant/theme.ts';
        installUiTheme();document.querySelector('#app').innerHTML=markup;
        document.querySelector('#restaurant-app').dataset.mobile=String(innerWidth<900);
        document.querySelector('#arrival-screen').hidden=true;document.querySelector('#dinner-hud').hidden=false;
        function fresh(id='consequence-ui',dateId='mira') {
          const state={id,generation:1,mode:'ai-date',phase:'playing',dateId,stage:'dining',elapsed:300,participants:[{id:'p1',kind:'human',name:'You',position:[0,0,0]}],events:[],emotion:'neutral',seated:true,order:'Roasted tomato rigatoni',glassRaised:false,memory:'',usage:{},sessionLimit:2,evening:createEvening(dateId)};
          state.evening.scenarioCare=createScenarioCareState();state.evening.main={status:'served',bites:3,dateDish:'Lemon & herb chicken',servedDish:state.order};return state;
        }
        const fixture={state:fresh(),commands:[],notices:[],update(){ui.update(fixture.state);},
          hold(presence){const state=fixture.state;state.evening.scenario={...createRestaurantScenario('ui','feeling-unwell'),phase:'resolved',beat:'follow-through',choices:[]};const care=state.evening.scenarioCare;care.kitchen.held=true;care.kitchen.heldAt=state.elapsed;care.presence=presence;care.returnAt=presence==='at-table'?null:state.elapsed+8;fixture.update();},
          receipt(double=false){const state=fixture.state;state.evening.scenarioCare.extraOrder.items=[{id:'cancelled-extra',dish:'Lemon & herb chicken',quantity:1,unitPriceCents:2200,status:'cancelled'},{id:'boxed-extra',dish:'Wild mushroom risotto',quantity:1,unitPriceCents:2000,status:'boxed'},{id:'shared-extra',dish:'Roasted tomato rigatoni',quantity:1,unitPriceCents:1800,status:'shared'}];state.evening.main.status='finished';state.evening.dessert.status='skipped';state.evening.chapter='bill';Object.assign(state.evening.bill,{requested:true,...buildDinnerBill(state)});
            if(double){const other=fresh('friend-pair','jules');other.evening.main.status='finished';other.order='Wild mushroom risotto';other.evening.main.servedDish=other.order;other.evening.dessert.status='skipped';Object.assign(other.evening.bill,{requested:true,settlement:'separate',...buildDinnerBill(other)});state.mode='double-date';state.doubleDate={role:'dating',roomId:state.id,localHumanId:'h1',members:[{id:'h1',name:'Alex'},{id:'h2',name:'Sam'}],dates:[{id:'d1',humanId:'h1',dateId:'mira'},{id:'d2',humanId:'h2',dateId:'jules'}],speakingActor:null,otherView:other};}fixture.update();
          },replace(){fixture.state=fresh('replacement-session');fixture.update();}
        };
        const ui=new EveningInterface({async command(body){fixture.commands.push(body);if(body.type==='evening'&&body.action==='resume-dinner'){const view=fixture.state.doubleDate?.role==='wingman'?fixture.state.doubleDate.otherView:fixture.state;view.evening.scenarioCare.kitchen.held=false;view.evening.scenarioCare.kitchen.heldAt=null;fixture.update();}},releasePointer(){},modalChanged(){},notice(message){fixture.notices.push(message);}});
        fixture.ui=ui;window.__consequenceFixture=fixture;fixture.update();
      </script>`);
      return;
    }
    vite.middlewares(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/__consequence_fixture`;
});

test.afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); await vite?.close(); });

test('held dinner explains absence, blocks course use and resumes only after the date returns', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as ConsequenceWindow).__consequenceFixture);
  await page.evaluate(() => (window as unknown as ConsequenceWindow).__consequenceFixture.hold('privacy-break'));
  await expect(page.locator('#prompt-copy')).toContainText('Mira is taking a private minute.');
  await expect(page.locator('#prompt-copy')).toContainText('Dinner is held until they return.');
  const resume = page.locator('[data-evening="resume-dinner"]');
  await expect(resume).toBeDisabled();
  await expect(page.locator('#prompt-chips button')).toHaveCount(1);
  await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.ui.handleTarget('meal'); f.ui.handleTarget('dessert'); });
  expect(await page.evaluate(() => (window as unknown as ConsequenceWindow).__consequenceFixture.commands)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as ConsequenceWindow).__consequenceFixture.notices)).toEqual(['Give your date time to return.', 'Give your date time to return.']);
  await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.state.evening.scenarioCare!.presence = 'at-table'; f.state.evening.scenarioCare!.returnAt = null; f.update(); });
  await expect(resume).toBeEnabled();
  await resume.focus();
  await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; for (let i = 0; i < 20; i++) f.update(); });
  await expect(resume).toBeFocused();
  await resume.click();
  expect(await page.evaluate(() => (window as unknown as ConsequenceWindow).__consequenceFixture.commands)).toEqual([{ type: 'evening', action: 'resume-dinner' }]);
  // Dinner is back on: the prompt returns to the table's small gestures, never to a course button.
  await expect(page.locator('[data-evening="offer-taste"]')).toBeVisible();
  await expect(page.locator('[data-evening="resume-dinner"]')).toHaveCount(0);
  await expect(page.locator('#prompt-chips [data-evening="taste"], #prompt-chips [data-evening="skip-dessert"]')).toHaveCount(0);
});

test('privacy follow-through waits for the actor, while staff medical choices stay available', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as ConsequenceWindow).__consequenceFixture);
  await page.evaluate(() => {
    const f = (window as unknown as ConsequenceWindow).__consequenceFixture;
    f.hold('privacy-break');
    Object.assign(f.state.evening.scenario!, { phase: 'active', description: 'Your date returns looking embarrassed.', choices: [{ id: 'slow-dinner', label: 'Keep dinner gentle and unhurried' }] });
    f.update();
  });
  await expect(page.locator('[data-scenario="slow-dinner"]')).toBeDisabled();
  await expect(page.locator('#prompt-copy')).toContainText('They’re returning shortly.');
  await expect(page.locator('#prompt-copy')).not.toContainText('returns looking embarrassed');
  await page.evaluate(() => {
    const f = (window as unknown as ConsequenceWindow).__consequenceFixture;
    f.state.evening.scenarioCare!.presence = 'at-table'; f.update();
  });
  await expect(page.locator('[data-scenario="slow-dinner"]')).toBeEnabled();
  await expect(page.locator('#prompt-copy')).toContainText('Your date returns looking embarrassed.');
  await page.evaluate(() => {
    const f = (window as unknown as ConsequenceWindow).__consequenceFixture;
    f.state.evening.scenario!.id = 'allergic-reaction';
    f.state.evening.scenarioCare!.presence = 'staff-care'; f.update();
  });
  await expect(page.locator('[data-scenario="slow-dinner"]')).toBeEnabled();
});

test('physical service recovery follows the remote incident owner without blocking the local meal', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as ConsequenceWindow).__consequenceFixture);
  await page.evaluate(() => {
    const f = (window as unknown as ConsequenceWindow).__consequenceFixture;
    f.receipt(true); f.state.doubleDate!.incidentOwner = 'h2';
    f.state.doubleDate!.otherView!.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 0 };
    f.state.evening.main.bites = 0; f.update();
    f.ui.handleTarget('napkin'); f.ui.handleTarget('meal');
  });
  expect(await page.evaluate(() => (window as unknown as ConsequenceWindow).__consequenceFixture.commands)).toEqual([
    { type: 'evening', action: 'wipe' }, { type: 'evening', action: 'taste' },
  ]);
});

test('receipt keeps cancelled dishes uncharged and boxes charged, updating without stealing focus', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as ConsequenceWindow).__consequenceFixture);
  await page.evaluate(async () => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.receipt(); await f.ui.openBill(); });
  await expect(page.locator('#bill-items')).toContainText('Cancelled before cooking · Mira · Lemon & herb chicken · Not charged');
  await expect(page.locator('#bill-items')).toContainText('Packed to take home · Mira · Wild mushroom risotto · $20.00');
  await expect(page.locator('#bill-items')).toContainText('To share · Mira · Roasted tomato rigatoni · $18.00');
  await expect(page.locator('#bill-total')).toHaveText('Total · $78.00');
  const split = page.locator('[data-settlement="split"]');
  await split.focus();
  await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.state.evening.bill.items!.find(item => item.id === 'boxed-extra')!.status = 'served'; f.update(); });
  await expect(page.locator('#bill-items')).not.toContainText('Packed to take home');
  await expect(split).toBeFocused();
  await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.state.phase = 'ended'; f.update(); });
  await expect(page.locator('#bill-dialog')).toBeHidden();
});

test('shared receipt separates an already settled pair from the amount still due', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as ConsequenceWindow).__consequenceFixture);
  await page.evaluate(async () => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.receipt(true); await f.ui.openBill(); });
  await expect(page.locator('#bill-items')).toContainText('You and Mira');
  await expect(page.locator('#bill-items')).toContainText('Sam and Jules · Already settled');
  await expect(page.locator('#bill-items')).toContainText('Paid · $42.00');
  await expect(page.locator('#bill-total')).toHaveText('Amount due · $78.00');
  await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.state.evening.bill.settlement = 'split'; f.update(); });
  await expect(page.locator('#bill-dialog')).toBeHidden();
});

test('a seated wingman can resume the other pair after their date returns', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as ConsequenceWindow).__consequenceFixture);
  await page.evaluate(() => {
    const f = (window as unknown as ConsequenceWindow).__consequenceFixture;
    f.receipt(true);
    f.state.doubleDate!.role = 'wingman';
    f.state.evening.bill.settlement = 'separate';
    const other = f.state.doubleDate!.otherView!;
    other.seated = false; other.evening.bill.requested = false; other.evening.bill.settlement = null;
    other.evening.scenarioCare!.kitchen.held = true; other.evening.scenarioCare!.kitchen.heldAt = 300;
    f.update();
  });
  const resume = page.getByRole('button', { name: 'Resume your friend’s dinner', exact: true });
  await expect(resume).toBeEnabled();
  await resume.click();
  expect(await page.evaluate(() => (window as unknown as ConsequenceWindow).__consequenceFixture.commands)).toEqual([{ type: 'evening', action: 'resume-dinner' }]);
  await expect(resume).toHaveCount(0);
});

test('a replacement evening closes the old check and asks for nothing the kitchen has not offered', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as ConsequenceWindow).__consequenceFixture);
  // Before Eli brings the check there is nothing to open; the request is Eli's to make, not a button.
  await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.ui.openBill(); });
  await expect(page.locator('#bill-dialog')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as ConsequenceWindow).__consequenceFixture.notices)).toEqual(['Eli brings the check once dessert is done.']);
  await page.evaluate(async () => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.receipt(); await f.ui.openBill(); });
  await expect(page.locator('#bill-dialog')).toBeVisible();
  await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.replace(); });
  await expect(page.locator('#bill-dialog')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as ConsequenceWindow).__consequenceFixture.commands)).toEqual([]);
  await expect(page.locator('[data-evening="offer-taste"]')).toBeVisible();
  await expect(page.locator('#prompt-chips [data-evening="settle-bill"]')).toHaveCount(0);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 844, height: 390 }]) {
  test(`ledger and compact consequences fit ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(base);
    await page.waitForFunction(() => (window as unknown as ConsequenceWindow).__consequenceFixture);
    await page.evaluate(async () => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.receipt(true); await f.ui.openBill(); });
    const receipt = page.locator('#bill-dialog .paper-dialog');
    const box = await receipt.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await receipt.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator('#bill-close').click();
    await page.evaluate(() => { const f = (window as unknown as ConsequenceWindow).__consequenceFixture; f.state.evening.bill.requested = false; f.state.evening.scenarioCare!.table = 'quiet'; f.hold('cleanup-break'); });
    await expect(page.locator('#prompt-copy')).toContainText('You are at the quieter table.');
    await expect(page.locator('#prompt-copy')).toContainText('packed to take home');
    const prompt = await page.locator('#prompt-line').boundingBox();
    expect(prompt!.x).toBeGreaterThanOrEqual(0); expect(prompt!.x + prompt!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.locator('#prompt-line').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  });
}
