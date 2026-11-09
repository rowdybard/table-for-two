import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { expect, test } from '@playwright/test';
import type { EveningInterface } from '../src/restaurant/EveningInterface';
import type { DinnerState } from '../src/restaurant/types';

interface AgendaWindow extends Window { __agendaFixture: { ui: EveningInterface; state: DinnerState; finish(): void } }
let vite: ViteDevServer, server: Server, base = '';

// Exercise notebook, farewell, history and export without a renderer or provider.
test.beforeAll(async () => {
  vite = await createViteServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  server = createServer((req, res) => {
    if (req.url === '/__agenda_fixture') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module">
        import '/src/restaurant/style.css';
        import '/src/restaurant/mobile.css';
        import { markup } from '/src/restaurant/ui.ts';
        import { EveningInterface } from '/src/restaurant/EveningInterface.ts';
        import { createEvening } from '/src/restaurant/evening.ts';
        import { installUiTheme } from '/src/restaurant/theme.ts';
        installUiTheme(); document.querySelector('#app').innerHTML = markup;
        document.querySelector('#restaurant-app').dataset.mobile = String(innerWidth < 900);
        document.querySelector('#arrival-screen').hidden = true;
        document.querySelector('#dinner-hud').hidden = false;
        const state = { id:'agenda-ui', generation:1, mode:'ai-date', phase:'playing', dateId:'mira', stage:'dining', elapsed:60,
          participants:[], events:[], emotion:'warm', seated:true, order:'Rigatoni', glassRaised:false, memory:'', usage:{},sessionLimit:2,evening:createEvening('mira') };
        state.evening.agenda = {clues:['I want to be heard, even when we disagree.'],milestones:[{kind:'noticed',evidence:'You want room to disagree.'},{kind:'understood',evidence:'You want someone to listen, not just agree.'}],score:65,possible:100,goal:null,reflection:null};
        const ui = new EveningInterface({async command(){},releasePointer(){},modalChanged(){},notice(){}});
        ui.update(state);
        window.__agendaFixture = {ui,state,finish(){
          state.phase='ended'; state.evening.agenda.goal='To feel heard without having someone take over or fix everything.';
          state.evening.agenda.reflection='You noticed what mattered and understood why. There was still room to follow through.';
          state.evening.farewell.ending={kind:'new-friend',title:'A good kind of company',description:'The evening became a connection without needing to become a romance.',dateLine:'I liked that we could disagree and still enjoy dinner.'};
          ui.update(state);ui.renderEnding(state);document.querySelector('#journal').hidden=true;document.querySelector('#ending-screen').hidden=false;
        }};
      </script>`);
      return;
    }
    vite.middlewares(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/__agenda_fixture`;
});
test.afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); await vite?.close(); });

for (const viewport of [{ width: 1280, height: 800 }, { width: 844, height: 390 }]) {
  test(`agenda clues stay in the notebook and the farewell fits ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(base);
    await page.waitForFunction(() => (window as unknown as AgendaWindow).__agendaFixture);
    await expect(page.locator('#journal')).toBeHidden();
    await expect(page.locator('#ending-agenda')).toBeHidden();
    await expect(page.getByText('Understanding · 65 / 100')).toHaveCount(0);
    await expect(page.locator('#restaurant-app')).not.toContainText('take over or fix');
    expect(await page.evaluate(() => localStorage.getItem('table-for-two-evenings'))).toBeNull();

    await page.evaluate(() => { document.getElementById('journal')!.hidden = false; });
    await page.locator('#journal-moments').click();
    await expect(page.locator('#agenda-clues')).toBeVisible();
    await expect(page.locator('#agenda-clues-heading')).toHaveText('What Mira said');
    await expect(page.locator('#agenda-clues-lines')).toHaveText('“I want to be heard, even when we disagree.”');
    await page.locator('#journal-moments').focus();
    await page.evaluate(() => { const fixture = (window as unknown as AgendaWindow).__agendaFixture; fixture.ui.update(fixture.state); });
    await expect(page.locator('#journal-moments')).toBeFocused();

    await page.evaluate(() => (window as unknown as AgendaWindow).__agendaFixture.finish());
    await expect(page.locator('#ending-date-line')).toHaveText('“I liked that we could disagree and still enjoy dinner.”');
    await expect(page.locator('#ending-agenda')).toBeVisible();
    await expect(page.locator('#ending-agenda-heading')).toHaveText('What Mira wanted');
    await expect(page.locator('#ending-agenda-score')).toHaveText('Understanding · 65 / 100');
    await expect(page.locator('#ending-agenda-reflection')).toContainText('understood why');
    await page.locator('.ending-memories summary').click();
    await expect(page.locator('#ending-agenda-evidence')).toContainText('You want someone to listen, not just agree.');
    const overflow = await page.locator('.ending-dialog').evaluate(node => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]')[0].agenda.score)).toBe(65);

    const downloadEvent = page.waitForEvent('download');
    await page.locator('#save-postcard').click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('table-for-two-mira.png');
    const png = await readFile((await download.path())!);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(900);
    expect(png.readUInt32BE(20)).toBeLessThanOrEqual(1400);
  });
}
