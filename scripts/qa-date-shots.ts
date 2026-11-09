/**
 * Local QA: renders the date from the player's seat in a handful of moments (interest levels, eating,
 * sipping, listening, thinking) and writes PNGs to .qa/date/. No providers, no network.
 *
 *   pnpm exec tsx scripts/qa-date-shots.ts [shot-name …]
 */
import { createServer, type Server } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import { chromium, type Page } from '@playwright/test';
import { createPairView } from '../server/double-date/scene';
import { emptyUsage } from '../server/restaurant/scene';
import { createEvening } from '../src/restaurant/evening';
import { createTabletopState } from '../src/restaurant/tabletop';
import { MENU } from '../src/restaurant/content';
import type { AudioPlayback, DateId, DinnerState } from '../src/restaurant/types';

type Fixture = { setState(s: DinnerState): void; setPlayback(p: AudioPlayback): void; setBehaviour(v: Record<string, unknown>): void; advance(s: number): boolean; view(from: number[], at: number[], fov?: number): string; ready(): boolean };
type W = Window & { dateFixture: Fixture };

function dinner(date: DateId, interest: number, patch: (s: DinnerState) => void = () => {}) {
  const state = createPairView(`qa-${date}`, 'h1', 'Alex', date, emptyUsage(), 2);
  state.mode = 'ai-date'; state.phase = 'playing'; state.stage = 'dining'; state.seated = true; state.elapsed = 60; state.order = MENU[0]!;
  state.evening = createEvening(date); state.evening.tabletop = createTabletopState();
  state.evening.main = { status: 'served', bites: 0, dateBites: 0, servedDish: MENU[0]!, dateDish: MENU[1]!, servedAt: 20 };
  state.evening.interest = { level: interest, trend: 0, changedAt: 0 };
  state.participants[0]!.position = [0, 0, .23]; state.participants[1]!.position = [0, 0, -2.25];
  patch(state);
  return state;
}

const SEAT = [.4, 1.3, -.3], FACE = [0, 1.12, -2.0];
const shots: Record<string, { date?: DateId; state: () => DinnerState; seconds: number; playback?: AudioPlayback; behaviour?: Record<string, unknown>; then?: (s: DinnerState) => void; after?: number; view?: [number[], number[], number?] }> = {
  'interest-low': { state: () => dinner('mira', 12), seconds: 6 },
  'interest-mid': { state: () => dinner('mira', 45), seconds: 6 },
  'interest-high': { state: () => dinner('mira', 92), seconds: 6, behaviour: { listening: true } },
  'bite': { state: () => dinner('mira', 50), seconds: 3, then: s => { s.evening.main.dateBites = 1; }, after: 1.1 },
  'sip': { state: () => dinner('mira', 50), seconds: 3, behaviour: { force: 'sip' }, after: 1.4 },
  'hair': { state: () => dinner('mira', 70), seconds: 3, behaviour: { force: 'hair' }, after: .8 },
  'laugh': { state: () => dinner('mira', 70), seconds: 2, playback: { speaker: 'date', amplitude: .5, emotion: 'amused', caption: 'Ha!' }, after: .5 },
  'thinking': { state: () => dinner('mira', 50), seconds: 3, behaviour: { thinking: true }, after: 1.5 },
  'phone': { state: () => dinner('mira', 10), seconds: 2, behaviour: { force: 'phone' }, after: 2 },
  'jules-high': { date: 'jules', state: () => dinner('jules', 90), seconds: 6, behaviour: { listening: true } },
  'dev-low': { date: 'dev', state: () => dinner('dev', 15), seconds: 6 },
  'side-bite': { state: () => dinner('mira', 50), seconds: 3, then: s => { s.evening.main.dateBites = 1; }, after: 1.1, view: [[1.3, 1.25, -1.6], [0, 1.0, -2.1], 45] },
  'side-sip': { state: () => dinner('mira', 50), seconds: 3, behaviour: { force: 'sip' }, after: 1.4, view: [[1.3, 1.25, -1.6], [0, 1.0, -2.1], 45] },
};

async function main() {
  const only = process.argv.slice(2);
  await mkdir('.qa/date', { recursive: true });
  const vite = await createViteServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  const server: Server = createServer((req, res) => {
    if (req.url?.startsWith('/__date_fixture')) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><style>html,body,#stage{width:100%;height:100%;margin:0;overflow:hidden;background:#172536}</style><div id="stage"></div><script type="module" src="/tests/fixtures/date-renderer.ts"></script>'); return; }
    vite.middlewares(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME ?? undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const [name, shot] of Object.entries(shots)) {
      if (only.length && !only.includes(name)) continue;
      const page: Page = await browser.newPage({ viewport: { width: 720, height: 480 } });
      page.on('pageerror', error => console.error(name, error.message));
      await page.goto(`http://127.0.0.1:${port}/__date_fixture?date=${shot.date ?? 'mira'}`);
      await page.waitForFunction(() => !!(window as unknown as W).dateFixture, null, { timeout: 120_000 });
      const state = shot.state();
      await page.evaluate(s => (window as unknown as W).dateFixture.setState(s), state);
      if (shot.behaviour) await page.evaluate(b => (window as unknown as W).dateFixture.setBehaviour(b), shot.behaviour);
      if (shot.playback) await page.evaluate(p => (window as unknown as W).dateFixture.setPlayback(p), shot.playback);
      await page.waitForFunction(() => (window as unknown as W).dateFixture.advance(.2), null, { timeout: 180_000, polling: 500 });
      await page.evaluate(seconds => (window as unknown as W).dateFixture.advance(seconds), shot.seconds);
      if (shot.then) {
        const next = structuredClone(state); next.elapsed += shot.seconds; shot.then(next);
        await page.evaluate(s => (window as unknown as W).dateFixture.setState(s), next);
      }
      if (shot.after) await page.evaluate(seconds => (window as unknown as W).dateFixture.advance(seconds), shot.after);
      const [from, at, fov] = shot.view ?? [SEAT, FACE, 34];
      const png = await page.evaluate(([f, a, v]) => (window as unknown as W).dateFixture.view(f as number[], a as number[], v as number), [from, at, fov ?? 34] as const);
      await writeFile(`.qa/date/${name}.png`, Buffer.from(png.split(',')[1]!, 'base64'));
      console.log('wrote', name);
      await page.close();
    }
  } finally { await browser.close(); server.close(); await vite.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
