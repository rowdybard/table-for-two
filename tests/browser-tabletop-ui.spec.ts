import { createServer, type Server } from 'node:http';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { expect, test } from '@playwright/test';
import type { InspectionTarget, TabletopInspector } from '../src/restaurant/TabletopInspector';
import type { DinnerCommand, DinnerState } from '../src/restaurant/types';

interface TabletopWindow extends Window {
  __tabletopFixture: {
    ui: TabletopInspector;
    state: DinnerState;
    inspections: (InspectionTarget | null)[];
    uses: InspectionTarget[];
    commands: DinnerCommand[];
    releases: number;
    changes: number;
    escaped: number;
    hold: boolean;
    resolve(): void;
    update(): void;
    aim(target: InspectionTarget | null, label?: string): void;
  };
}

test('long captions stay separate from inspection controls on desktop and phone', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto(base);
    await page.waitForFunction(() => (window as unknown as TabletopWindow).__tabletopFixture);
    await page.evaluate(mobile => {
      const f = (window as unknown as TabletopWindow).__tabletopFixture;
      const parent = document.getElementById('restaurant-app')!;
      parent.dataset.mobile = String(mobile);
      f.state.seated = true; f.aim('napkin', 'Draw on napkin'); f.ui.open('napkin');
      const caption = document.createElement('aside'); caption.className = 'caption'; caption.id = 'caption';
      const text = document.createElement('p'); text.textContent = 'I was about to tell you why that mattered to me. '.repeat(7);
      caption.append(text); parent.append(caption);
    }, viewport.width < 900);
    const caption = await page.locator('#caption').boundingBox(), controls = await page.locator('#tabletop-inspector').boundingBox();
    expect(caption).not.toBeNull(); expect(controls).not.toBeNull();
    expect(caption!.x + caption!.width).toBeLessThan(controls!.x);
    expect(controls!.y).toBeGreaterThanOrEqual(0);
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(viewport.height);
  }
});

let vite: ViteDevServer, server: Server, base = '';

// UI-only fixture: no renderer, network providers, microphone, or live dinner server.
test.beforeAll(async () => {
  vite = await createViteServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  server = createServer((req, res) => {
    if (req.url === '/__tabletop_fixture') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="restaurant-app"></div><script type="module">
        import '/src/restaurant/style.css';
        import '/src/restaurant/mobile.css';
        import { TabletopInspector } from '/src/restaurant/TabletopInspector.ts';
        import { createEvening } from '/src/restaurant/evening.ts';
        import { tabletopSnapshot } from '/src/restaurant/tabletop.ts';
        import { installUiTheme } from '/src/restaurant/theme.ts';
        installUiTheme();
        const parent = document.querySelector('#restaurant-app');
        parent.dataset.mobile = String(innerWidth < 900);
        parent.innerHTML = '<div id="mobile-controls"><div class="mobile-move"></div><button id="mobile-interact" class="mobile-interact">Take some freshly baked bread</button></div><div class="interaction"><kbd>E</kbd><span>Take some bread</span></div><div class="controls-line">Seated</div>';
        parent.style.background = 'linear-gradient(130deg,#514536,#463027 65%,#282124)';
        const state = { id:'tabletop-ui', generation:1, mode:'ai-date', phase:'playing', dateId:'mira', stage:'dining', elapsed:60,
          participants:[], events:[], emotion:'neutral', seated:false, order:'Rigatoni', glassRaised:false, memory:'', usage:{},sessionLimit:2,evening:createEvening('mira') };
        state.evening.tabletop=tabletopSnapshot(state.evening.tabletop);
        state.evening.main.status='served';state.evening.main.servedDish='Rigatoni';
        let aimed = { target:'glass', label:'Take a sip' }, resolve;
        const fixture = {state,inspections:[],uses:[],commands:[],releases:0,changes:0,escaped:0,hold:false,
          resolve(){resolve?.();},update(){ui.update(state,aimed);},
          aim(target,label='Use object'){aimed=target?{target,label}:null;ui.update(state,aimed);}
        };
        const ui = new TabletopInspector(parent,{
          inspect(target){fixture.inspections.push(target);},
          use(target){fixture.uses.push(target);if(fixture.hold)return new Promise(done=>{resolve=done;});},
          command(command){fixture.commands.push(command);if(command.type==='tabletop'&&command.action==='fold-napkin'){
            state.evening.tabletop=tabletopSnapshot(state.evening.tabletop);state.evening.tabletop.napkinFolded=!state.evening.tabletop.napkinFolded;fixture.update();
          }},
          releasePointer(){fixture.releases++;},changed(){fixture.changes++;}
        });
        fixture.ui=ui;window.__tabletopFixture=fixture;
        document.addEventListener('keydown',event=>{if(event.key==='Escape')fixture.escaped++;});
        ui.update(state,aimed);
      </script>`);
      return;
    }
    vite.middlewares(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/__tabletop_fixture`;
});

test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()));
  await vite?.close();
});

test('inspection follows seating and session state and keeps focus during updates', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as TabletopWindow).__tabletopFixture);
  const trigger = page.locator('#inspect-table-object'), panel = page.locator('#tabletop-inspector');
  await expect(trigger).toBeHidden();
  await expect(panel).toBeHidden();
  await page.evaluate(() => { const f = (window as unknown as TabletopWindow).__tabletopFixture; f.state.seated = true; f.update(); });
  await expect(trigger).toHaveAccessibleName('Inspect water glass');
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-game-menu', '');
  await expect(page.locator('#tabletop-use')).toHaveText('Take a sip');
  await expect(page.locator('#tabletop-use')).toBeFocused();
  await expect(trigger).toBeHidden();
  await page.evaluate(() => { const f = (window as unknown as TabletopWindow).__tabletopFixture; f.aim('glass', 'Sip water'); f.state.generation++; f.update(); });
  await expect(page.locator('#tabletop-use')).toHaveText('Take a sip');
  await expect(page.locator('#tabletop-use')).toBeFocused();
  await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.aim(null));
  await expect(panel).toBeVisible();
  await page.locator('#tabletop-use').click();
  expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.uses)).toEqual(['glass']);
  await page.locator('#tabletop-back').click();
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.inspections)).toEqual(['glass', null]);

  for (const change of ['stand', 'pause', 'end', 'new-session'] as const) {
    await page.evaluate(() => { const f = (window as unknown as TabletopWindow).__tabletopFixture; f.state.phase = 'playing'; f.state.seated = true; f.aim('glass', 'Take a sip'); });
    await trigger.click();
    await page.evaluate(reason => {
      const f = (window as unknown as TabletopWindow).__tabletopFixture;
      if (reason === 'stand') f.state.seated = false;
      if (reason === 'pause') f.state.phase = 'paused';
      if (reason === 'end') f.state.phase = 'ended';
      if (reason === 'new-session') f.state.id += '-next';
      f.update();
    }, change);
    await expect(panel).toBeHidden();
  }
});

test('napkin folding is a separate action and Escape returns without pausing', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as TabletopWindow).__tabletopFixture);
  await page.evaluate(() => { const f = (window as unknown as TabletopWindow).__tabletopFixture; f.state.seated = true; f.aim('napkin', 'Draw on napkin'); });
  await page.locator('#inspect-table-object').click();
  await expect(page.locator('#tabletop-fold')).toHaveText('Fold your napkin');
  await page.locator('#tabletop-fold').click();
  await expect(page.locator('#tabletop-fold')).toHaveText('Unfold your napkin');
  expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.commands)).toEqual([{ type: 'tabletop', action: 'fold-napkin' }]);
  await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.ui.open('salt'));
  await expect(page.locator('#tabletop-object-name')).toHaveText('Salt');
  await expect(page.locator('#tabletop-fold')).toBeHidden();
  await page.locator('#tabletop-use').press('Escape');
  await expect(page.locator('#tabletop-inspector')).toBeHidden();
  await expect(page.locator('#inspect-table-object')).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.escaped)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.releases)).toBe(2);
});

test('an outstanding use cannot duplicate or update a closed inspection', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as TabletopWindow).__tabletopFixture);
  await page.evaluate(() => { const f = (window as unknown as TabletopWindow).__tabletopFixture; f.state.seated = true; f.hold = true; f.update(); });
  await page.locator('#inspect-table-object').click();
  await page.locator('#tabletop-use').click();
  await expect(page.locator('#tabletop-use')).toBeDisabled();
  await page.locator('#tabletop-back').click();
  await page.evaluate(() => { const f = (window as unknown as TabletopWindow).__tabletopFixture; f.hold = false; f.aim('bread', 'Take some bread'); f.ui.open('bread'); f.resolve(); });
  await expect(page.locator('#tabletop-use')).toHaveText('Take a piece');
  await expect(page.locator('#tabletop-use')).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.uses)).toEqual(['glass']);
});

test('live availability updates verbs and explains empty props while E obeys the disabled state', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as TabletopWindow).__tabletopFixture);
  await page.evaluate(() => {
    const f = (window as unknown as TabletopWindow).__tabletopFixture;
    f.state.seated = true;
    f.aim('lamp', 'Adjust light');
  });
  await page.locator('#inspect-table-object').click();
  await expect(page.locator('#tabletop-use')).toHaveText('Lower the light');
  await page.evaluate(() => {
    const f = (window as unknown as TabletopWindow).__tabletopFixture;
    f.state.evening.tabletop!.shared.lampLevel = 1;
    f.aim(null);
  });
  await expect(page.locator('#tabletop-use')).toHaveText('Turn the light off');
  await expect(page.locator('#tabletop-use')).toBeFocused();
  await page.evaluate(() => {
    const f = (window as unknown as TabletopWindow).__tabletopFixture;
    f.state.evening.tabletop!.glassFill = 0;
    f.aim('glass', 'Take a sip');
    f.ui.open('glass');
  });
  await expect(page.locator('#tabletop-use')).toBeDisabled();
  await expect(page.locator('#tabletop-inspector-status')).toHaveText('Your glass is empty. Pour some water.');
  await page.locator('#tabletop-back').press('e');
  expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.uses)).toEqual([]);
  await page.evaluate(() => {
    const f = (window as unknown as TabletopWindow).__tabletopFixture;
    f.state.evening.tabletop!.glassFill = 1;
    f.update();
  });
  await expect(page.locator('#tabletop-inspector-status')).toBeHidden();
  await page.locator('#tabletop-use').press('e');
  expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.uses)).toEqual(['glass']);
  await page.evaluate(() => {
    const f = (window as unknown as TabletopWindow).__tabletopFixture;
    f.state.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 60 };
    f.aim('glass', 'Steady your glass');
  });
  await expect(page.locator('#tabletop-use')).toHaveText('Steady your glass');
  await expect(page.locator('#tabletop-use')).toBeEnabled();
  await expect(page.locator('#tabletop-inspector-status')).toBeHidden();
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 844, height: 390 }]) {
  test(`table controls fit the edge and leave the prop clear at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base);
    await page.waitForFunction(() => (window as unknown as TabletopWindow).__tabletopFixture);
    await page.evaluate(() => { const f = (window as unknown as TabletopWindow).__tabletopFixture; f.state.seated = true; f.aim('bread', 'Take some freshly baked bread'); });
    const trigger = await page.locator('#inspect-table-object').boundingBox();
    expect(trigger!.width).toBeGreaterThanOrEqual(44);
    expect(trigger!.height).toBeGreaterThanOrEqual(44);
    if (viewport.width < 900) {
      const interaction = await page.locator('#mobile-interact').boundingBox();
      expect(interaction!.x + interaction!.width).toBeLessThanOrEqual(trigger!.x - 8);
    }
    await page.locator('#inspect-table-object').click();
    const panel = await page.locator('#tabletop-inspector').boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(viewport.height);
    expect(panel!.height).toBeLessThan(viewport.height * .3);
    expect(panel!.y).toBeGreaterThan(viewport.height * .6);
    expect(await page.locator('#tabletop-inspector').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    for (const button of await page.locator('#tabletop-inspector button:visible').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator('#tabletop-inspector').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  });
}

test('touch activates once even with a compatibility click; keyboard remains usable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(base);
    await page.waitForFunction(() => (window as unknown as TabletopWindow).__tabletopFixture);
    await page.evaluate(() => { const f = (window as unknown as TabletopWindow).__tabletopFixture; f.state.seated = true; f.update(); });
    await page.locator('#inspect-table-object').tap();
    await expect(page.locator('#tabletop-inspector')).toBeVisible();
    await page.locator('#tabletop-use').tap();
    expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.uses)).toEqual(['glass']);
    await page.locator('#tabletop-use').press('Enter');
    expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.uses)).toEqual(['glass', 'glass']);
    await page.locator('#tabletop-back').tap();
    await expect(page.locator('#tabletop-inspector')).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as TabletopWindow).__tabletopFixture.inspections)).toEqual(['glass', null]);
  } finally { await context.close(); }
});
