import { createServer, type Server } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { expect, test, type Page } from '@playwright/test';
import { createPairView } from '../server/double-date/scene';
import { emptyUsage } from '../server/restaurant/scene';
import { createEvening } from '../src/restaurant/evening';
import { createScenarioCareState } from '../src/restaurant/scenario-care';
import { createRestaurantScenario } from '../src/restaurant/scenarios';
import { createTabletopState } from '../src/restaurant/tabletop';
import { DOUBLE_TABLE, localDoubleDateView, type DoubleDateRoomState, type DoubleHumanId } from '../src/restaurant/double-date-types';
import { MENU } from '../src/restaurant/content';
import type { DateId, DinnerState } from '../src/restaurant/types';
import type { InspectionTarget } from '../src/restaurant/TabletopInspector';

type Target = { visible: boolean; position: number[]; radius: number | null };
type Snapshot = { spill:{visible:boolean;position:number[]};ownGlass:{angle:number;position:number[]};friendGlass:{angle:number;position:number[]};desserts:{visible:boolean;trayVisible:boolean;trayBottom:number;plateBottom:number;pieces:number;bottom:number|null}[];ticketVisible:boolean;ticketSignature:string;stationOffset:number;meals:number[];extra: {visible:boolean;serving:boolean;carton:boolean}[]; clothVisible:boolean;wineVisible:boolean; ready: boolean; frames: number; calls: number; triangles: number; textures: number; geometries: number; waterScale: number; waterVisible: boolean; menu: number[]; targets: Record<string, Target> };
type FixtureWindow = Window & { tabletopFixture: { setState(state: DinnerState): void; inspect(target: InspectionTarget | null): void; overview(enabled:boolean): void; intersections(): string[]; supportRadius():number; footprints():string[]; info(): Snapshot; aimAt(name:string): {target:string}|null; dispose(): void } };
let vite: ViteDevServer, server: Server, base = '';

const setupDinner = (state: DinnerState) => {
  state.phase = 'playing'; state.stage = 'dining'; state.seated = true; state.elapsed = 40; state.order = MENU[0];
  state.evening.tabletop = createTabletopState();
  state.evening.main = { status: 'served', bites: 0, servedDish: MENU[0]!, dateDish: MENU[1]! };
  return state;
};
function solo(date: DateId, blind = false) {
  const state = setupDinner(createPairView(`visual-${date}-${blind}`, 'h1', 'Alex', date, emptyUsage(), 2));
  state.mode = blind ? 'blind-date' : 'ai-date'; if (blind) state.blindDate = { seed: 'visual-blind' };
  state.evening = createEvening(date); state.evening.tabletop = createTabletopState();
  state.evening.main = { status: 'served', bites: 0, servedDish: MENU[0]!, dateDish: MENU[1]! };
  state.participants[0]!.position = [0, 0, .23]; state.participants[1]!.position = [0, 0, -2.25];
  return state;
}
function double(human: DoubleHumanId) {
  const usage = emptyUsage(), h1 = setupDinner(createPairView('visual-double', 'h1', 'Alex', 'mira', usage, 2)), h2 = setupDinner(createPairView('visual-double', 'h2', 'Jamie', 'jules', usage, 2));
  const room: DoubleDateRoomState = { id:'visual-double', code:'VISUAL', mode:'double-date', phase:'playing', hostId:'h1', generation:1, revision:1,
    members: [{id:'h1',name:'Alex',connected:true,ready:true,dateId:'mira',position:DOUBLE_TABLE.seats.h1,yaw:0,seated:true}, {id:'h2',name:'Jamie',connected:true,ready:true,dateId:'jules',position:DOUBLE_TABLE.seats.h2,yaw:0,seated:true}],
    dates: [{id:'d1',humanId:'h1',dateId:'mira',position:DOUBLE_TABLE.dateSeats.d1,seated:true,emotion:'neutral',stance:'curious'}, {id:'d2',humanId:'h2',dateId:'jules',position:DOUBLE_TABLE.dateSeats.d2,seated:true,emotion:'neutral',stance:'curious'}],
    views: { h1, h2 }, lines:[], usage, sessionLimit:2, model:'claude-haiku-5-5', voice:{enabled:{h1:false,h2:false},epoch:0,iceServers:[]} };
  return localDoubleDateView(room, human);
}
async function snapshot(page: Page) { return page.evaluate(() => (window as unknown as FixtureWindow).tabletopFixture.info()); }
async function setState(page: Page, state: DinnerState) { await page.evaluate(value => (window as unknown as FixtureWindow).tabletopFixture.setState(value), state); await expect.poll(async () => (await snapshot(page)).frames, {timeout:60_000}).toBeGreaterThanOrEqual(4); }
async function capture(page: Page, name: string) { await page.screenshot({ path: `.qa/tabletop/${name}.png` }); }

test.beforeAll(async () => {
  await mkdir('.qa/tabletop', { recursive:true });
  vite = await createViteServer({ configFile:false, server:{middlewareMode:true,watch:null,hmr:false,ws:false}, optimizeDeps:{noDiscovery:true,include:[]} });
  server = createServer((req,res) => {
    if (req.url === '/__tabletop_art_fixture') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#stage{width:100%;height:100%;margin:0;overflow:hidden;background:#172536}</style><div id="stage"></div><script type="module" src="/tests/fixtures/tabletop-renderer.ts"></script>'); return; }
    vite.middlewares(req,res);
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); base=`http://127.0.0.1:${(server.address() as {port:number}).port}/__tabletop_art_fixture`;
});
test.afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(()=>resolve())); await vite?.close(); });

test('real renderer: table compositions, close-ups, modes and dessert arrangements', async ({ page }) => {
  test.setTimeout(480_000); await page.setViewportSize({width:960,height:600}); await page.emulateMedia({ reducedMotion:'reduce' });
  const errors: string[] = []; page.on('pageerror', error => { if (error.message !== 'WebSocket closed without opened.') errors.push(error.message); });
  await page.goto(base); await page.waitForFunction(() => !!(window as unknown as FixtureWindow).tabletopFixture);
  await setState(page, solo('mira')); await expect.poll(async () => (await snapshot(page)).ready, { timeout:60_000 }).toBe(true);
  await page.waitForTimeout(500); await capture(page,'solo-mira');
  const baseline = await snapshot(page);
  await writeFile('.qa/tabletop/renderer-info.json', JSON.stringify({ current:baseline, note:'Current renderer; no equivalent earlier baseline captured.' },null,2));
  const remaining = process.env.TABLETOP_REMAINING_ONLY === '1';
  const inspected = remaining ? ['salt','pepper','meal'] : ['menu','glass','carafe','bread','salt','pepper','cutlery','lamp','vase','plate','meal','napkin'];
  for (const name of inspected as InspectionTarget[]) {
    expect(baseline.targets[name], `target ${name}`).toBeTruthy(); expect(baseline.targets[name]!.visible, `visible ${name}`).toBe(true);
    const before = (await snapshot(page)).frames; await page.evaluate(target => (window as unknown as FixtureWindow).tabletopFixture.inspect(target), name); await expect.poll(async () => (await snapshot(page)).frames, {timeout:30_000}).toBeGreaterThan(before); await capture(page,`inspect-${name}`);
  }
  const cases: ReadonlyArray<readonly [string,DinnerState]> = remaining ? [['double-h2',double('h2')]] : [['solo-jules',solo('jules')],['solo-dev',solo('dev')],['blind',solo('mira',true)],['double-h1',double('h1')],['double-h2',double('h2')]];
  for (const [label,state] of cases) {
    await setState(page,state); await expect.poll(async () => (await snapshot(page)).ready, {timeout:60_000}).toBe(true); await capture(page,label);
    const info = await snapshot(page);
    if (state.doubleDate) { const x=state.doubleDate.localHumanId==='h1'?-.57:.57; expect(info.targets.plate!.position[0]).toBeCloseTo(x,2); expect(info.targets.plate!.position[2]).toBeCloseTo(-.32,2); expect(info.targets.glass!.position[0]).toBeCloseTo(x+.25,2); }
  }
  const water=solo('mira'); water.evening.tabletop!.glassFill=0; await setState(page,water); expect((await snapshot(page)).waterVisible).toBe(false); await capture(page,'glass-empty');
  water.evening.tabletop!.glassFill=2; await setState(page,water); expect((await snapshot(page)).waterScale).toBeCloseTo(.5,2); await capture(page,'glass-half');
  for(const activity of ['dessert'] as const) {
    const state=solo('mira'); state.evening.main.status='finished'; state.evening.dessert.status='served'; state.evening.dessert.choice='lemon';
    await setState(page,state); const info=await snapshot(page); for(const item of ['lamp','bread','vase','carafe','salt','pepper']) expect(info.targets[item]!.visible, `${activity} ${item}`).toBe(true);
    await capture(page,activity);
    if(activity==='dessert') for(const prop of ['bread','lamp','vase','carafe'] as InspectionTarget[]) {
      const before=(await snapshot(page)).frames;await page.evaluate(target => (window as unknown as FixtureWindow).tabletopFixture.inspect(target),prop);
      await expect.poll(async () => (await snapshot(page)).frames,{timeout:30_000}).toBeGreaterThan(before);await capture(page,`dessert-${prop}`);
    }
  }
  const refill=solo('mira'); refill.evening.care.water.status='served'; refill.evening.tabletop!.shared.carafeFill=0; refill.evening.tabletop!.glassFill=1;
  await setState(page,refill); expect((await snapshot(page)).targets['service-bell']!.visible).toBe(true);
  const standing=solo('mira'); standing.seated=false;standing.stage='arrival';standing.participants[0]!.position=[-5.5,0,-1];
  await setState(page,standing);
  const windowHit=await page.evaluate(() => (window as unknown as FixtureWindow).tabletopFixture.aimAt('window'));
  expect(windowHit?.target).toBe('window');
  const standingTable=await page.evaluate(() => (window as unknown as FixtureWindow).tabletopFixture.aimAt('menu'));
  expect(standingTable?.target).not.toBe('menu');
  expect(errors).toEqual([]); await page.evaluate(() => (window as unknown as FixtureWindow).tabletopFixture.dispose());
});



test('audit actual tabletop geometry across courses and service states', async ({page}) => {
  test.setTimeout(240_000); await page.setViewportSize({width:1100,height:760}); await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(base);await page.waitForFunction(() => !!(window as unknown as FixtureWindow).tabletopFixture);
  const shot=async(name:string,overview=false)=>{ const before=(await snapshot(page)).frames;await page.evaluate(v=>(window as unknown as FixtureWindow).tabletopFixture.overview(v),overview);await expect.poll(async()=>(await snapshot(page)).frames,{timeout:30_000}).toBeGreaterThan(before);await capture(page,`audit-${name}`);};
  await setState(page,solo('mira'));const idleHits=await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.intersections());expect(idleHits.filter(pair=>pair.includes('bread')&&pair.includes('plate-'))).toEqual([]);
  for(let dish=0;dish<3;dish++){const state=solo('mira');state.order=MENU[dish]!;state.evening.main.servedDish=MENU[dish]!;state.evening.main.dateDish=MENU[(dish+1)%3]!;await setState(page,state);await shot(`solo-dish-${dish}`,true);await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.inspect('meal'));await page.waitForTimeout(200);await capture(page,`audit-detail-dish-${dish}`);}
  for(const human of ['h1','h2'] as const){const state=double(human);await setState(page,state);await shot(`double-${human}`,true);const menuIntersections=await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.footprints());expect(menuIntersections.filter(pair=>pair.includes('menu')&&(pair.includes('salt')||pair.includes('pepper')))).toEqual([]);expect(await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.supportRadius())).toBeLessThanOrEqual(1.30);}
  const dessert=solo('mira');dessert.evening.dessert.status='served';dessert.evening.dessert.choice='lemon';await setState(page,dessert);await shot('solo-dessert',true);
  const ticket=solo('mira');ticket.evening.incident={event:'wrong-order',progress:0,startedAt:40};await setState(page,ticket);await shot('ticket',true);
  const simultaneous=solo('mira');simultaneous.evening.main.status='finished';simultaneous.evening.dessert.status='served';simultaneous.evening.dessert.choice='lemon';await setState(page,simultaneous);await shot('dessert-served',true);
  const combinedInfo=await snapshot(page);expect(combinedInfo.desserts[0]!.visible).toBe(true);expect(combinedInfo.desserts[0]!.trayVisible).toBe(true);expect(combinedInfo.desserts[0]!.trayBottom).toBeCloseTo(.782,3);expect(combinedInfo.desserts[0]!.pieces).toBeGreaterThan(0);expect(combinedInfo.desserts[0]!.bottom!).toBeGreaterThan(.793);expect(combinedInfo.desserts[0]!.bottom!).toBeLessThan(.84);expect(combinedInfo.targets.dessert!.position[0]).toBeCloseTo(.06,2);
  const comboHits=await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.intersections());expect(comboHits.filter(pair=>pair.includes('dessert-own'))).toEqual([]);
  const foreignDessert=double('h1');foreignDessert.doubleDate!.otherView!.evening.dessert.status='served';foreignDessert.doubleDate!.otherView!.evening.dessert.choice='berries';await setState(page,foreignDessert);await shot('double-other-dessert',true);expect((await snapshot(page)).desserts.map(x=>x.visible)).toEqual([false,true]);
  foreignDessert.evening.dessert.status='served';foreignDessert.evening.dessert.choice='chocolate';await setState(page,foreignDessert);await shot('double-both-desserts',true);const dualInfo=await snapshot(page);expect(dualInfo.desserts.map(x=>x.visible&&x.trayVisible&&x.pieces>0)).toEqual([true,true]);const dualHits=await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.intersections());expect(dualHits.filter(pair=>pair.includes('dessert-'))).toEqual([]);expect(await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.supportRadius())).toBeLessThanOrEqual(1.30);
  const extra=solo('mira');extra.evening.scenarioCare=createScenarioCareState();extra.evening.scenarioCare.extraOrder.items=[0,1,2,0].map((dish,i)=>({id:`extra-${i}`,dish:MENU[dish]!,quantity:1,unitPriceCents:1800,status:i<2?'served':'pending'}));
  await setState(page,extra);await shot('extra-two',true);expect((await snapshot(page)).extra.filter(x=>x.visible)).toHaveLength(2);
  extra.evening.scenarioCare.extraOrder.items.forEach(item=>item.status='served');await setState(page,extra);await shot('extra-four',true);expect((await snapshot(page)).extra.filter(x=>x.serving&&x.visible)).toHaveLength(4);const extraIntersections=await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.intersections());expect(extraIntersections.filter(pair=>pair.includes('extra-'))).toEqual([]);
  extra.evening.scenarioCare.extraOrder.items.forEach((item,i)=>item.status=i<2?'boxed':'cancelled');await setState(page,extra);await shot('extra-boxed',true);expect((await snapshot(page)).extra.filter(x=>x.carton&&x.visible)).toHaveLength(2);
  const foreignTicket=double('h1');foreignTicket.doubleDate!.incidentOwner='h2';foreignTicket.doubleDate!.otherView!.order=MENU[2]!;foreignTicket.doubleDate!.otherView!.evening.main.dateDish=MENU[1]!;foreignTicket.doubleDate!.otherView!.evening.incident={event:'wrong-order',progress:0,startedAt:40};
  await setState(page,foreignTicket);await shot('double-other-ticket',true);const ticketInfo=await snapshot(page);expect(ticketInfo.ticketVisible).toBe(true);expect(ticketInfo.ticketSignature).toContain('Jamie');expect(ticketInfo.ticketSignature).toContain(MENU[2]!);const ticketIntersections=await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.footprints());expect(ticketIntersections.filter(pair=>pair.includes('ticket')&&pair.includes('menu'))).toEqual([]);
  const other=double('h1');other.doubleDate!.scenario={...createRestaurantScenario('audit','oversized-order'),target:'h2'};other.doubleDate!.otherView!.evening.scenarioCare=extra.evening.scenarioCare;
  await setState(page,other);await shot('double-other-boxed',true);expect((await snapshot(page)).extra.filter(x=>x.carton&&x.visible)).toHaveLength(2);
  const spill=solo('mira');spill.evening.scenarioCare=createScenarioCareState();spill.evening.scenarioCare.cleanup={wine:'wet',cloth:'ready',glassesCleared:true};
  await setState(page,spill);await shot('spill-wet',true);expect((await snapshot(page)).clothVisible).toBe(true);expect((await snapshot(page)).wineVisible).toBe(true);
  spill.evening.scenarioCare.cleanup={wine:'clean',cloth:'used',glassesCleared:false};await setState(page,spill);await shot('spill-clean',true);expect((await snapshot(page)).clothVisible).toBe(true);expect((await snapshot(page)).wineVisible).toBe(false);
  const medical=solo('mira');medical.evening.scenarioCare=createScenarioCareState();medical.evening.scenarioCare.service={staff:'medical',spaceCleared:true,alcoholStopped:true,contactRequested:true};await setState(page,medical);await shot('medical-space',true);
  const bite=solo('mira');await setState(page,bite);const beforeBite=(await snapshot(page)).meals;bite.evening.main.bites=2;await setState(page,bite);const afterBite=(await snapshot(page)).meals;expect(afterBite[0]!).toBeLessThan(beforeBite[0]!);expect(afterBite[1]).toBe(beforeBite[1]);bite.evening.scenarioCare=createScenarioCareState();bite.evening.scenarioCare.kitchen.held=true;await setState(page,bite);expect((await snapshot(page)).meals.slice(0,2)).toEqual([0,0]);bite.evening.scenarioCare.kitchen.held=false;await setState(page,bite);expect((await snapshot(page)).meals[1]).toBe(beforeBite[1]);
  const quiet=solo('mira');quiet.evening.scenarioCare=createScenarioCareState();quiet.evening.scenarioCare.table='quiet';quiet.participants.forEach(person=>person.position[2]+=3.85);
  await setState(page,quiet);await shot('quiet-table',true);const quietInfo=await snapshot(page);expect(quietInfo.stationOffset).toBeCloseTo(3.85,3);expect(quietInfo.targets.plate!.position[2]).toBeCloseTo(-.64+3.85,2);expect(quietInfo.targets.window!.position[2]).toBeCloseTo(-.8,2);
  const quietDouble=double('h2');quietDouble.evening.scenarioCare=createScenarioCareState();quietDouble.evening.scenarioCare.table='quiet';quietDouble.participants=quietDouble.participants.map(person=>({...person,position:[person.position[0],person.position[1],person.position[2]+3.85]}));quietDouble.doubleDate!.members=quietDouble.doubleDate!.members.map(member=>({...member,position:[member.position[0],member.position[1],member.position[2]+3.85]}));quietDouble.doubleDate!.dates=quietDouble.doubleDate!.dates.map(date=>({...date,position:[date.position[0],date.position[1],date.position[2]+3.85]}));
  await setState(page,quietDouble);await shot('quiet-double',true);expect((await snapshot(page)).targets.plate!.position[2]).toBeCloseTo(-.32+3.85,2);
  for(const owner of ['h1','h2'] as const){const observations:Snapshot[]=[];for(const observer of ['h1','h2'] as const){const view=double(observer);view.doubleDate!.incidentOwner=owner;const incident={event:'spilled-drink' as const,progress:0,startedAt:40};view.evening.incident=incident;view.doubleDate!.otherView!.evening.incident={...incident};await setState(page,view);await shot(`spill-${owner}-from-${observer}`,true);const seen=await snapshot(page);observations.push(seen);expect(seen.spill.visible).toBe(true);expect(seen.ownGlass.angle).toBeCloseTo(observer===owner?-.95:0,2);expect(seen.friendGlass.angle).toBeCloseTo(observer===owner?0:-.95,2);expect(seen.spill.position[1]).toBeCloseTo(.783,3);}
    for(let axis=0;axis<3;axis++)expect(observations[0]!.spill.position[axis]).toBeCloseTo(observations[1]!.spill.position[axis]!,3);
    const tipped=observations.map(seen=>seen.ownGlass.angle<-.5?seen.ownGlass.position:seen.friendGlass.position);for(let axis=0;axis<3;axis++)expect(tipped[0]![axis]).toBeCloseTo(tipped[1]![axis]!,3);
  }
  await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.dispose());
});



test('shared spill ownership is consistent in all four views', async ({page}) => {
  test.setTimeout(120_000);await page.setViewportSize({width:960,height:600});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(base);await page.waitForFunction(() => !!(window as unknown as FixtureWindow).tabletopFixture);
  for(const owner of ['h1','h2'] as const){const observations:Snapshot[]=[];
    for(const observer of ['h1','h2'] as const){const view=double(observer);view.doubleDate!.incidentOwner=owner;const incident={event:'spilled-drink' as const,progress:0,startedAt:40};view.evening.incident=incident;view.doubleDate!.otherView!.evening.incident={...incident};
      await setState(page,view);const before=(await snapshot(page)).frames;await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.overview(true));await expect.poll(async()=>(await snapshot(page)).frames,{timeout:30_000}).toBeGreaterThan(before);await capture(page,`spill-${owner}-from-${observer}`);
      const seen=await snapshot(page);observations.push(seen);expect(seen.spill.visible).toBe(true);expect(seen.ownGlass.angle).toBeCloseTo(observer===owner?-.95:0,2);expect(seen.friendGlass.angle).toBeCloseTo(observer===owner?0:-.95,2);expect(seen.spill.position[1]).toBeCloseTo(.783,3);
    }
    for(let axis=0;axis<3;axis++)expect(observations[0]!.spill.position[axis]).toBeCloseTo(observations[1]!.spill.position[axis]!,3);
    const tipped=observations.map(seen=>seen.ownGlass.angle<-.5?seen.ownGlass.position:seen.friendGlass.position);for(let axis=0;axis<3;axis++)expect(tipped[0]![axis]).toBeCloseTo(tipped[1]![axis]!,3);
  }
  await page.evaluate(()=>(window as unknown as FixtureWindow).tabletopFixture.dispose());
});
