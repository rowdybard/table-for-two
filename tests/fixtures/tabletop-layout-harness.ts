/**
 * Headless tabletop layout audit for the real TabletopProps, EveningTable and contact shadows.
 *
 *   pnpm exec tsx tests/fixtures/tabletop-layout-harness.ts            # full report, with clearance search
 *   pnpm exec tsx tests/fixtures/tabletop-layout-harness.ts --fast     # skip the clearance search
 *   pnpm exec tsx tests/fixtures/tabletop-layout-harness.ts --json --only=h1:
 *
 * It builds RestaurantScene (which owns TabletopProps), EveningTable and the contact-shadow mesh in Node
 * with a recording canvas stub, drives them with DinnerState objects, mirrors the placement lines that live
 * in RestaurantRenderer.update(), then tests every pair of visible props with exact triangle/triangle
 * separating-axis tests plus analytic solid containment. No WebGL, server or RAPIER.
 * It also audits support (including each end of finished cutlery bridging the plate) and table-edge overhang, flat
 * paper/decal stacking, stains under props, napkin-to-cutlery clearance, which side each fork is on, the contact blobs,
 * interaction targets, the quiet-table move and real-frame transitions.
 * tests/tabletop-layout.test.ts asserts all of it.
 */
import * as THREE from 'three';
import type { DinnerState, EveningState } from '../../src/restaurant/types';
import type { RestaurantSet } from '../../src/restaurant/render/RestaurantScene';
import { createEvening } from '../../src/restaurant/evening';
import { createScenarioCareState } from '../../src/restaurant/scenario-care';
import { createTabletopState } from '../../src/restaurant/tabletop';
import { MENU } from '../../src/restaurant/content';
import type { DoubleHumanId } from '../../src/restaurant/double-date-types';

/* ------------------------------------------------------------------ DOM stubs */
function fakeCanvas() {
  const store: Record<string, unknown> = { font: '10px sans-serif' };
  const canvas: Record<string, unknown> = { width: 300, height: 150, style: {}, addEventListener() {}, removeEventListener() {}, toDataURL: () => '' };
  const noop = () => {};
  const ctx: unknown = new Proxy(store, {
    get(target, key) {
      if (typeof key === 'symbol') return undefined;
      if (key === 'canvas') return canvas;
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: String(text).length * Number(String(target.font).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10) * .55 });
      if (/^create(Radial|Linear|Conic)Gradient$|^createPattern$/.test(key)) return () => ({ addColorStop: noop });
      if (key === 'getImageData' || key === 'createImageData') return (...a: number[]) => { const w = a.length >= 4 ? a[2]! : a[0]!, h = a.length >= 4 ? a[3]! : a[1]!; return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }; };
      return noop;
    },
    set(target, key, value) { target[key as string] = value; return true; },
  });
  canvas.getContext = () => ctx;
  return canvas;
}
export function installDomStubs() {
  const g = globalThis as Record<string, unknown>;
  if ((g.document as { __layoutStub?: boolean } | undefined)?.__layoutStub) return;
  const element = (tag: string) => tag === 'canvas' ? fakeCanvas() : { style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, set src(_v: string) {} };
  g.document = { __layoutStub: true, createElement: element, createElementNS: (_ns: string, tag: string) => element(tag) };
  // Licensed textures and GLB props never arrive; the authored fallbacks are what is audited.
  g.fetch = () => new Promise(() => {});
}

/* ------------------------------------------------------------------ fixture */
type PlaceGroup = { group: THREE.Group; plate: THREE.Group; cutlery: THREE.Group; napkin: THREE.Group; x: number; z: number };
export type TabletopInternals = {
  root: THREE.Group; solo: THREE.Group; doubles: THREE.Group; menu: THREE.Mesh; playerGlass: THREE.Group; targets: THREE.Mesh[];
  placeGroups: PlaceGroup[]; dateGlasses: { group: THREE.Group; x: number; z: number; double: boolean }[];
  carafe: THREE.Group; lamp: THREE.Group; vase: THREE.Group; basket: THREE.Group; shakers: THREE.Group[];
  geometry: Map<string, THREE.BufferGeometry>;
};
export type EveningInternals = {
  root: THREE.Group; targets: THREE.Mesh[]; meals: THREE.Group[][]; dessert: THREE.Group; otherDessert: THREE.Group;
  extraOrders: { root: THREE.Group; serving: THREE.Group; carton: THREE.Group }[];
  cleanupCloth: THREE.Group; offeredBites: THREE.Group[]; friendGlass: THREE.Group; napkin: THREE.Mesh; friendNapkin: THREE.Mesh; ticket: THREE.Group; wineStain: THREE.Group;
  update(state: DinnerState): void;
};
type Shadows = ReturnType<typeof import('../../src/restaurant/render/PlaceSettingShadows').createPlaceSettingShadows>;
export interface LayoutFixture {
  scene: THREE.Scene; set: RestaurantSet; tabletop: TabletopInternals; table: EveningInternals; shadows: Shadows;
  diningOffsetZ: (state: DinnerState) => number; blobY: number;
}

export async function createLayoutFixture(): Promise<LayoutFixture> {
  installDomStubs();
  const { TabletopProps } = await import('../../src/restaurant/render/TabletopProps');
  const { createRestaurantScene } = await import('../../src/restaurant/render/RestaurantScene');
  const { EveningTable } = await import('../../src/restaurant/render/EveningTable');
  const { createPlaceSettingShadows, CONTACT_BLOB_Y } = await import('../../src/restaurant/render/PlaceSettingShadows');
  const { diningOffsetZ } = await import('../../src/restaurant/dining-space');
  let captured: TabletopInternals | undefined;
  const proto = TabletopProps.prototype as unknown as { update: (...args: unknown[]) => unknown };
  const original = proto.update;
  proto.update = function (this: TabletopInternals, ...args: unknown[]) { captured = this; return original.apply(this, args); };
  const set = createRestaurantScene();
  const table = new EveningTable() as unknown as EveningInternals;
  const shadows = createPlaceSettingShadows();
  const scene = new THREE.Scene();
  scene.add(set.root, table.root, shadows.mesh);
  set.updateTabletop(baseState(), 1, true);
  proto.update = original;
  if (!captured) throw new Error('TabletopProps instance was not captured');
  partNames = new Map([...captured.geometry].map(([k, g]) => [g, k]));
  return { scene, set, tabletop: captured, table, shadows, diningOffsetZ, blobY: CONTACT_BLOB_Y };
}

/* ------------------------------------------------------------------ states */
export function baseState(dateId: DinnerState['dateId'] = 'mira', variation = 0): DinnerState {
  const evening: EveningState = { ...createEvening(dateId, variation), tabletop: createTabletopState(), scenarioCare: createScenarioCareState() };
  return {
    id: 'layout-audit', generation: 0, mode: 'ai-date', phase: 'playing', dateId, stage: 'seated', elapsed: 500,
    participants: [{ id: 'p1', kind: 'human', name: 'Alex', position: [0, 0, -.05] }, { id: 'p2', kind: 'ai', name: 'Mira', position: [0, 0, -2.25] }],
    events: [], emotion: 'neutral', seated: true, order: MENU[0]!, glassRaised: false, memory: '',
    usage: {} as DinnerState['usage'], sessionLimit: 2, evening,
  } as DinnerState;
}
export type Mod = (view: DinnerState) => void;
/**
 * `motion` frames play the beats at their peak. `lifted` names the props that are deliberately in the air in that frame
 * (a pour, a shake, a raised glass): they are exempt from the support check only, never from the overlap checks.
 */
export interface Scenario { label: string; mode: 'solo' | DoubleHumanId; local?: Mod[]; other?: Mod[]; motion?: boolean; lifted?: string[]; room?: { incidentOwner?: DoubleHumanId; scenarioTarget?: DoubleHumanId; role?: 'dating' | 'wingman' } }
export function buildState(s: Scenario): DinnerState {
  const local = baseState('mira', 0);
  for (const mod of s.local ?? []) mod(local);
  if (s.mode === 'solo') return local;
  const human = s.mode;
  const other = baseState('jules', 1);
  for (const mod of s.other ?? []) mod(other);
  local.mode = other.mode = 'double-date';
  const member = (id: DoubleHumanId) => ({ id, name: id === 'h1' ? 'Alex' : 'Jamie', connected: true, ready: true, dateId: id === human ? 'mira' : 'jules', position: [id === 'h1' ? -.57 : .57, 0, .2] as [number, number, number], yaw: 0, seated: true });
  const dates = (['h1', 'h2'] as const).map(id => ({ id: id === 'h1' ? 'd1' : 'd2', humanId: id, dateId: id === human ? 'mira' : 'jules', position: [id === 'h1' ? -.57 : .57, 0, -2.5], seated: true, emotion: 'neutral', stance: 'curious', departed: false }));
  const scenario = s.room?.scenarioTarget ? { target: s.room.scenarioTarget, id: 'oversized-order', phase: 'resolved', effects: { wineStain: false } } : undefined;
  local.doubleDate = {
    role: s.room?.role ?? 'dating', localHumanId: human, roomId: 'layout-audit', members: [member('h1'), member('h2')], dates, speakingActor: null,
    incidentOwner: s.room?.incidentOwner, scenario, otherView: { ...other, doubleDate: undefined },
  } as unknown as DinnerState['doubleDate'];
  return local;
}
const act = (action: string) => (v: DinnerState) => { v.evening.tabletop!.lastAction = { sequence: 1, action, at: v.elapsed - .6 } as never; };
export const mods = {
  served: (v: DinnerState) => mods.dish(0)(v),
  dish: (index: number, dateIndex = (index + 2) % 3) => (v: DinnerState) => { v.order = MENU[index]!; v.evening.main = { ...v.evening.main, status: 'served', servedDish: MENU[index]!, dateDish: MENU[dateIndex]!, bites: 0 }; },
  finished: (v: DinnerState) => { v.evening.main = { ...v.evening.main, status: 'finished', servedDish: MENU[0]!, dateDish: MENU[2]!, bites: 3 }; },
  dessert: (choice: 'lemon' | 'chocolate' | 'berries' = 'chocolate', bites = 0) => (v: DinnerState) => { mods.finished(v); v.evening.dessert = { ...v.evening.dessert, choice, status: 'served', bites }; },
  dessertDone: (v: DinnerState) => { mods.finished(v); v.evening.dessert = { ...v.evening.dessert, choice: 'chocolate', status: 'finished', bites: 4 }; },
  billOnly: (v: DinnerState) => { v.evening.bill.requested = true; },
  bill: (v: DinnerState) => { mods.dessertDone(v); v.evening.bill.requested = true; },
  extras: (status: 'served' | 'boxed' | 'shared', count = 4) => (v: DinnerState) => { v.evening.scenarioCare!.extraOrder.items = Array.from({ length: count }, (_, i) => ({ id: `x${i}`, dish: MENU[i % 3]!, quantity: 1, unitPriceCents: 1800, status: i === 0 && status === 'shared' ? 'shared' : status === 'shared' ? 'boxed' : status })); },
  wrongOrder: (v: DinnerState) => { mods.served(v); v.evening.incident = { event: 'wrong-order', progress: 0, startedAt: 0 }; },
  spilled: (v: DinnerState) => { v.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 0 }; },
  glassesCleared: (v: DinnerState) => { v.evening.scenarioCare!.cleanup.glassesCleared = true; },
  clothReady: (v: DinnerState) => { v.evening.scenarioCare!.cleanup = { ...v.evening.scenarioCare!.cleanup, wine: 'wet', cloth: 'ready' }; },
  clothUsed: (v: DinnerState) => { v.evening.scenarioCare!.cleanup = { ...v.evening.scenarioCare!.cleanup, wine: 'clean', cloth: 'used' }; },
  wineWet: (v: DinnerState) => { v.evening.scenarioCare!.cleanup = { ...v.evening.scenarioCare!.cleanup, wine: 'wet' }; },
  spaceCleared: (v: DinnerState) => { v.evening.scenarioCare!.service.spaceCleared = true; },
  taste: (dish = 2) => (v: DinnerState) => { mods.dish(0, dish)(v); v.evening.care.tasteOffer = { result: 'accepted', dish: MENU[dish]! } as never; },
  crossed: (v: DinnerState) => { v.evening.tabletop!.cutleryCrossed = true; },
  folded: (v: DinnerState) => { v.evening.tabletop!.napkinFolded = true; },
  quiet: (v: DinnerState) => { v.evening.scenarioCare!.table = 'quiet'; },
  raised: (v: DinnerState) => { v.glassRaised = true; },
  pour: act('pour-water'), salt: act('salt-meal'), pepper: act('pepper-meal'),
  seasoned: (v: DinnerState) => { v.evening.tabletop!.salt = 2 as never; v.evening.tabletop!.pepper = 2 as never; },
  plateTurned: (v: DinnerState) => { v.evening.tabletop!.plateTurn = 3; },
  turn: (n: number) => (v: DinnerState) => { v.evening.tabletop!.plateTurn = n; },
  vaseTurned: (v: DinnerState) => { v.evening.tabletop!.shared.vaseTurn = 4; },
  lampOff: (v: DinnerState) => { v.evening.tabletop!.shared.lampLevel = 0; },
};
const m = mods;
function seatScenarios(mode: Scenario['mode']): Scenario[] {
  const L = (label: string, local: Mod[] = [], other: Mod[] = [], room?: Scenario['room'], motion = false, lifted: string[] = []): Scenario => ({ label: `${mode}:${label}`, mode, local, other, room, motion, lifted });
  const own = (key: 'incidentOwner' | 'scenarioTarget') => mode === 'solo' ? undefined : { [key]: mode } as Scenario['room'];
  const friend = mode === 'h1' ? 'h2' : 'h1';
  const list: Scenario[] = [
    L('seated'), L('mains', [m.served], [m.served]), L('mains+crossed', [m.served, m.crossed], [m.served, m.crossed]),
    L('chicken+crossed', [m.dish(1), m.crossed], [m.dish(1), m.crossed]), L('risotto+crossed', [m.dish(2), m.crossed], [m.dish(2), m.crossed]),
    L('mains+seasoned', [m.served, m.seasoned], [m.dish(1), m.seasoned]),
    L('crossed+folded+glasses-cleared', [m.crossed, m.folded, m.glassesCleared], [m.crossed, m.folded, m.glassesCleared]),
    L('napkin-folded', [m.folded], [m.folded]), L('glasses-cleared', [m.glassesCleared], [m.glassesCleared]),
    L('dessert-chocolate', [m.dessert('chocolate')]), L('dessert-lemon', [m.dessert('lemon')]), L('dessert-berries', [m.dessert('berries')]),
    L('dessert-half-eaten', [m.dessert('berries', 2)]),
    L('extras-served', [m.served, m.extras('served')], [], own('scenarioTarget')),
    L('extras-served+dessert', [m.dessert('lemon'), m.extras('served')], [], own('scenarioTarget')),
    L('extras-boxed+dessert', [m.dessert(), m.extras('boxed')], [], own('scenarioTarget')),
    L('extras-shared+bill', [m.bill, m.extras('shared')], [], own('scenarioTarget')),
    L('extras-served+bill', [m.served, m.billOnly, m.extras('served')], [], own('scenarioTarget')),
    L('bill', [m.bill]), L('wrong-order', [m.wrongOrder], [], own('incidentOwner')),
    L('spilled-drink', [m.spilled], [], own('incidentOwner')),
    L('cleanup-cloth', [m.clothReady], [], own('scenarioTarget')), L('cloth-used+bill', [m.clothUsed, m.bill], [], own('scenarioTarget')),
    L('cloth-used+dessert', [m.clothUsed, m.dessert('lemon')], [], own('scenarioTarget')),
    L('space-cleared', [m.spaceCleared]), L('taste-offer', [m.taste(2)]), L('taste-rigatoni', [m.taste(0)]), L('taste-chicken', [m.taste(1)]),
    L('glasses-cleared+dessert', [m.glassesCleared, m.dessert()]),
    // Edge cases from the layout review.
    L('crossed+dessert', [m.crossed, m.dessert()], [m.crossed, m.dessert()]), L('crossed+taste', [m.crossed, m.taste(2)], [m.crossed, m.taste(1)]),
    L('spilled+glasses-cleared', [m.spilled, m.glassesCleared], [], own('incidentOwner')),
    L('quiet+bill', [m.quiet, m.bill], [m.quiet]), L('folded+crossed+mains', [m.served, m.folded, m.crossed], [m.served, m.folded, m.crossed]),
    L('cloth+spilled', [m.clothReady, m.spilled], [], mode === 'solo' ? undefined : { incidentOwner: mode, scenarioTarget: mode }),
    // A stain that waits for its cloth while service carries on around it.
    L('wine-stain+mains', [m.wineWet, m.served], [m.served], own('scenarioTarget')), L('wine-stain+wrong-order', [m.wineWet, m.wrongOrder], [], mode === 'solo' ? undefined : { incidentOwner: mode, scenarioTarget: mode }),
    // One story runs per evening, so a stain never shares the table with the extra dishes of an oversized order.
    L('wine-stain+bill', [m.wineWet, m.bill], [], own('scenarioTarget')),
    L('wine-stain+dessert', [m.wineWet, m.dessert('berries')], [], own('scenarioTarget')),
    // Moving states: beats at their peak, the raised glass, a turned plate and vase, the lamp off.
    L('pour', [m.pour], [], undefined, true, ['carafe']), L('salt-shake', [m.served, m.salt], [m.served], undefined, true, ['salt']), L('pepper-shake', [m.dish(1), m.pepper], [m.served], undefined, true, ['pepper']),
    L('glass-raised', [m.raised], [], undefined, true, ['glass.you']), L('plate-turned+chicken', [m.dish(1), m.plateTurned], [m.dish(2), m.plateTurned], undefined, true),
    L('vase-turned+lamp-off', [m.vaseTurned, m.lampOff], [], undefined, true), L('dessert+pour', [m.dessert('lemon'), m.pour], [], undefined, true, ['carafe']),
    // Finished cutlery over every turn of the plate, so the rim marks pass under the resting fork and knife ('mains+crossed' is turn 0).
    ...Array.from({ length: 11 }, (_, i) => L(`crossed+plate-turn${i + 1}`, [m.dish((i + 1) % 3), m.crossed, m.turn(i + 1)], [m.dish(i % 3), m.crossed, m.turn(i + 1)])),
  ];
  if (mode !== 'solo') list.push(
    L('both-desserts', [m.dessert()], [m.dessert('berries')]), L('both-desserts+glasses-cleared', [m.dessert(), m.glassesCleared], [m.dessert(), m.glassesCleared]),
    L('other-dessert', [], [m.dessert('lemon')]),
    L('other-extras', [], [m.served, m.extras('served')], { scenarioTarget: friend }),
    L('other-extras+dessert', [m.dessert('chocolate')], [m.extras('boxed')], { scenarioTarget: friend }),
    L('other-wrong-order', [], [m.wrongOrder], { incidentOwner: friend }),
    L('other-spilled', [], [m.spilled], { incidentOwner: friend }),
    L('other-cloth', [], [m.clothReady], { scenarioTarget: friend }),
    L('both-taste', [m.taste(2)], [m.taste(0)]),
    L('both-desserts+bill', [m.dessert(), m.billOnly], [m.dessert()]), L('both-desserts+bill-other', [m.dessert()], [m.dessert(), m.billOnly]),
    L('both-desserts+extras', [m.dessert(), m.extras('boxed')], [m.dessert()], { scenarioTarget: mode }),
    L('both-desserts+cloth-used', [m.dessert(), m.clothUsed], [m.dessert('lemon')], { scenarioTarget: mode }),
    L('wingman-other-dessert', [m.dessertDone], [m.dessert('berries')], { role: 'wingman' }),
    L('remote-salt-shake', [m.served], [m.served, m.salt], undefined, true, ['salt']),
    L('both-desserts+pour', [m.dessert(), m.pour], [m.dessert('lemon')], undefined, true, ['carafe']),
  );
  list.push(L('quiet-table+mains', [m.quiet, m.served], [m.quiet, m.served]));
  return list;
}
export const SCENARIOS: Scenario[] = [...seatScenarios('solo'), ...seatScenarios('h1'), ...seatScenarios('h2')];

/* ------------------------------------------------------------------ frame (mirrors RestaurantRenderer.update) */
export function applyFrame(f: LayoutFixture, state: DinnerState, motion = false, dt?: number) {
  // RestaurantRenderer.syncDoubleActors -> set.setDoubleDate
  f.set.setDoubleDate(!!state.doubleDate);
  // The quiet-table offset moves the dining station, the evening table and the shadow mesh.
  const offset = f.diningOffsetZ(state);
  f.set.diningRoot.position.z = offset; f.table.root.position.z = offset; f.shadows.mesh.position.z = offset;
  // reducedMotion settles every pose at once. Motion frames use a long dt (ease = 1) with live beats; an explicit dt plays one real frame.
  f.set.updateTabletop(state, dt ?? (motion ? 10 : 1), dt === undefined && !motion);
  f.table.update(state);
  // RestaurantRenderer: service props owned by the set.
  const foreign = state.doubleDate?.incidentOwner && state.doubleDate.incidentOwner !== state.doubleDate.localHumanId;
  const service = state.doubleDate?.role === 'wingman' || foreign ? state.doubleDate?.otherView?.evening ?? state.evening : state.evening;
  f.set.food.visible = false; f.set.bill.visible = service.bill.requested;
  const spilled = service.incident?.event === 'spilled-drink';
  f.set.spill.visible = spilled && service.incident!.progress < 3;
  const spillSeatX = state.doubleDate ? (state.doubleDate.incidentOwner ?? state.doubleDate.localHumanId) === 'h1' ? -.57 : .57 : 0;
  f.set.spill.position.x = state.doubleDate ? spillSeatX + .1 - .37 : 0; f.set.spill.position.z = state.doubleDate ? .32 : 0;
  f.scene.updateMatrixWorld(true);
  f.shadows.sync(f.scene);
}

/* ------------------------------------------------------------------ props */
/**
 * `decal` lies on the cloth (wine, water). A stain must never lie on paper; a water puddle may spread under or over it, but
 * never at its height. A decal lies on open linen, clear of every solid prop, unless `solidsOk` (a puddle round its glass).
 */
export interface Prop { id: string; kind: 'solid' | 'flat' | 'food' | 'decal'; meshes: THREE.Mesh[]; root: THREE.Object3D; paperOk?: boolean; solidsOk?: boolean }
export const shown = (o: THREE.Object3D | null): boolean => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse(o => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.userData.target || o.userData.decor || !shown(o)) return;
    if ((o.material as THREE.Material).colorWrite === false) return;
    out.push(o);
  });
  return out;
}
export function seatLabel(x: number, z: number, double: boolean) {
  if (!double) return z > -1.15 ? 'you' : 'date';
  return z > -1.15 ? (x < 0 ? 'h1' : 'h2') : (x < 0 ? 'd1' : 'd2');
}
const DESSERT_PARTS = ['plate', 'spoon-a', 'spoon-b', 'lemon', 'chocolate', 'berries'];
export function collectProps(f: LayoutFixture, state: DinnerState): Prop[] {
  const props: Prop[] = [], double = !!state.doubleDate, tp = f.tabletop, t = f.table;
  const add = (id: string, kind: Prop['kind'], root: THREE.Object3D, ...more: THREE.Object3D[]) => { const meshes = [root, ...more].flatMap(meshesOf); if (meshes.length) props.push({ id, kind, meshes, root }); };
  for (const p of tp.placeGroups) {
    if (!shown(p.group)) continue;
    const seat = seatLabel(p.x, p.z, double);
    add(`${seat}.plate`, 'solid', p.plate);
    const [fork, knife, spoon] = p.cutlery.children;
    add(`${seat}.fork`, 'solid', fork!); add(`${seat}.knife`, 'solid', knife!); add(`${seat}.spoon`, 'solid', spoon!);
    add(`${seat}.napkin`, 'solid', p.napkin);
  }
  add('glass.you', 'solid', tp.playerGlass);
  for (const g of tp.dateGlasses) if (shown(g.group)) add(`glass.${double ? (g.x < 0 ? 'd1' : 'd2') : 'date'}`, 'solid', g.group);
  add('carafe', 'solid', tp.carafe); add('lamp', 'solid', tp.lamp); add('vase', 'solid', tp.vase); add('bread-basket', 'solid', tp.basket);
  add('salt', 'solid', tp.shakers[0]!); add('pepper', 'solid', tp.shakers[1]!); add('menu', 'flat', tp.menu);
  // Meal groups are positioned in the evening table's frame, so their local z names the seat on either table.
  t.meals.forEach(course => course.forEach(group => { if (shown(group)) add(`meal.${seatLabel(group.position.x, group.position.z, double)}`, 'food', group); }));
  for (const [name, root] of [['dessert.own', t.dessert], ['dessert.other', t.otherDessert]] as const) {
    if (!shown(root)) continue;
    root.children.forEach((child, i) => add(`${name}.${DESSERT_PARTS[i] ?? 'part' + i}`, i < 3 ? 'solid' : 'food', child));
  }
  t.extraOrders.forEach((x, i) => add(`extra${i}`, 'solid', x.root));
  add('cleanup-cloth', 'solid', t.cleanupCloth);
  t.offeredBites.forEach((b, i) => add(`offered-bite.${i ? 'other' : 'own'}`, 'food', b));
  add('glass.friend', 'solid', t.friendGlass);
  const bell = t.root.children.filter(o => o instanceof THREE.Mesh && !o.userData.target && Math.abs(o.position.x - .61) < 1e-6);
  if (bell.length) add('service-bell', 'solid', bell[0]!, ...bell.slice(1));
  add('paper-napkin', 'flat', t.napkin); add('friend-napkin', 'flat', t.friendNapkin); add('ticket', 'flat', t.ticket);
  add('wine-stain', 'decal', t.wineStain);
  add('bill-folio', 'solid', f.set.bill);
  add('spill-puddle', 'decal', f.set.spill); const puddle = props.at(-1); if (puddle?.id === 'spill-puddle') puddle.paperOk = puddle.solidsOk = true;
  return props;
}

/* ------------------------------------------------------------------ geometry tests */
interface Shape { key: string; mesh: THREE.Mesh; part: string; tri: Float64Array; triBox: Float64Array; box: THREE.Box3; verts: Float64Array; inside?: (x: number, y: number, z: number) => number }
const shapeCache = new WeakMap<THREE.Mesh, Shape>();
let partNames = new Map<THREE.BufferGeometry, string>();
const matrixKey = (mesh: THREE.Mesh) => mesh.id + ':' + Array.prototype.join.call(mesh.matrixWorld.elements, ',');
function shapeOf(mesh: THREE.Mesh, dy = 0, dx = 0, dz = 0): Shape {
  const shifted = !!(dx || dy || dz), key = matrixKey(mesh) + (shifted ? `|${dx},${dy},${dz}` : '');
  const hit = shapeCache.get(mesh); if (!shifted && hit && hit.key === key) return hit;
  const g = mesh.geometry, pos = g.getAttribute('position'), index = g.getIndex();
  const v = new THREE.Vector3(), verts = new Float64Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); verts[i * 3] = v.x + dx; verts[i * 3 + 1] = v.y + dy; verts[i * 3 + 2] = v.z + dz; }
  const count = index ? index.count / 3 : pos.count / 3, tri = new Float64Array(count * 9), triBox = new Float64Array(count * 6);
  const box = new THREE.Box3();
  for (let t = 0; t < count; t++) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(t * 3 + k) : t * 3 + k;
      const x = verts[i * 3]!, y = verts[i * 3 + 1]!, z = verts[i * 3 + 2]!;
      tri[t * 9 + k * 3] = x; tri[t * 9 + k * 3 + 1] = y; tri[t * 9 + k * 3 + 2] = z;
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
    triBox[t * 6] = minX; triBox[t * 6 + 1] = minY; triBox[t * 6 + 2] = minZ; triBox[t * 6 + 3] = maxX; triBox[t * 6 + 4] = maxY; triBox[t * 6 + 5] = maxZ;
    box.expandByPoint(v.set(minX, minY, minZ)); box.expandByPoint(v.set(maxX, maxY, maxZ));
  }
  const shape: Shape = { key, mesh, part: partNames.get(g) ?? g.type.replace('Geometry', ''), tri, triBox, box, verts, inside: solidTest(mesh, dx, dy, dz) };
  if (!shifted) shapeCache.set(mesh, shape);
  return shape;
}
/** Signed depth (world metres, >0 inside) for convex closed primitives; undefined for open, merged or concave meshes. */
function solidTest(mesh: THREE.Mesh, dx: number, dy: number, dz: number) {
  const g = mesh.geometry as THREE.BufferGeometry & { parameters?: Record<string, number | boolean> }, p = g.parameters ?? {};
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert(), scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld), s = Math.min(scale.x, scale.y, scale.z);
  const local = new THREE.Vector3();
  const to = (x: number, y: number, z: number) => local.set(x - dx, y - dy, z - dz).applyMatrix4(inv);
  if (g.type === 'BoxGeometry' || g.type === 'RoundedBoxGeometry') {
    g.computeBoundingBox(); const b = g.boundingBox!;
    return (x: number, y: number, z: number) => { const l = to(x, y, z); return Math.min(l.x - b.min.x, b.max.x - l.x, l.y - b.min.y, b.max.y - l.y, l.z - b.min.z, b.max.z - l.z) * s; };
  }
  if (g.type === 'CapsuleGeometry') { const r = Number(p.radius), h = Number(p.height ?? p.length) / 2;
    return (x: number, y: number, z: number) => { const l = to(x, y, z); const cy = Math.max(-h, Math.min(h, l.y)); return (r - Math.hypot(l.x, l.y - cy, l.z)) * s; }; }
  if (g.type === 'CylinderGeometry' && !p.openEnded && Number(p.thetaLength ?? Math.PI * 2) >= Math.PI * 2 - 1e-6) { const rt = Number(p.radiusTop), rb = Number(p.radiusBottom), h = Number(p.height);
    return (x: number, y: number, z: number) => { const l = to(x, y, z); const r = rb + (rt - rb) * (l.y + h / 2) / h; return Math.min(h / 2 - Math.abs(l.y), r - Math.hypot(l.x, l.z)) * s; }; }
  if (g.type === 'SphereGeometry' && Number(p.phiLength) >= Math.PI * 2 - 1e-6) { const r = Number(p.radius), hemi = Number(p.thetaLength) < Math.PI - 1e-6;
    return (x: number, y: number, z: number) => { const l = to(x, y, z); return Math.min(r - l.length(), hemi ? l.y : Infinity) * s; }; }
  return undefined;
}
const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
/** Separating-axis triangle/triangle test (11 axes). True when the closed triangles share any point. */
function triIntersect(A: Float64Array, ai: number, B: Float64Array, bi: number) {
  const a = [0, 1, 2].map(k => [A[ai + k * 3]!, A[ai + k * 3 + 1]!, A[ai + k * 3 + 2]!]), b = [0, 1, 2].map(k => [B[bi + k * 3]!, B[bi + k * 3 + 1]!, B[bi + k * 3 + 2]!]);
  const ea = [sub(a[1]!, a[0]!), sub(a[2]!, a[1]!), sub(a[0]!, a[2]!)], eb = [sub(b[1]!, b[0]!), sub(b[2]!, b[1]!), sub(b[0]!, b[2]!)];
  const na = cross(ea[0]!, ea[1]!), nb = cross(eb[0]!, eb[1]!), axes = [na, nb];
  for (const x of ea) for (const y of eb) axes.push(cross(x, y));
  if (Math.hypot(...cross(na, nb)) < 1e-14) for (const e of [...ea, ...eb]) axes.push(cross(na, e)); // coplanar: in-plane edge normals
  for (const axis of axes) {
    const len = Math.hypot(axis[0]!, axis[1]!, axis[2]!); if (len < 1e-14) continue;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of a) { const d = (p[0]! * axis[0]! + p[1]! * axis[1]! + p[2]! * axis[2]!) / len; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of b) { const d = (p[0]! * axis[0]! + p[1]! * axis[1]! + p[2]! * axis[2]!) / len; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a0 > b1 + 1e-9 || b0 > a1 + 1e-9) return false;
  }
  return true;
}
export interface Contact { a: string; b: string; crossings: number; inside: number; depth: number; overlap: [number, number, number] }
const EPS = 1e-4;
const DIRECTIONS: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
type Hit = { crossings: number; inside: number; depth: number; overlap: [number, number, number] } | null;
const pairCache = new Map<string, Hit>();
function shapesHit(A: Shape, B: Shape): Hit {
  if (!A.box.intersectsBox(B.box)) return null;
  const cacheKey = A.key < B.key ? A.key + '#' + B.key : B.key + '#' + A.key;
  if (pairCache.has(cacheKey)) return pairCache.get(cacheKey)!;
  let crossings = 0, depth = 0, inside = 0;
  const nb = B.triBox.length / 6, na = A.triBox.length / 6, ab = A.triBox, bb = B.triBox;
  for (let i = 0; i < na; i++) {
    if (ab[i * 6]! > B.box.max.x || ab[i * 6 + 3]! < B.box.min.x || ab[i * 6 + 1]! > B.box.max.y || ab[i * 6 + 4]! < B.box.min.y || ab[i * 6 + 2]! > B.box.max.z || ab[i * 6 + 5]! < B.box.min.z) continue;
    for (let j = 0; j < nb; j++) {
      if (ab[i * 6]! > bb[j * 6 + 3]! || ab[i * 6 + 3]! < bb[j * 6]! || ab[i * 6 + 1]! > bb[j * 6 + 4]! || ab[i * 6 + 4]! < bb[j * 6 + 1]! || ab[i * 6 + 2]! > bb[j * 6 + 5]! || ab[i * 6 + 5]! < bb[j * 6 + 2]!) continue;
      if (triIntersect(A.tri, i * 9, B.tri, j * 9)) crossings++;
    }
  }
  for (const [X, Y] of [[A, B], [B, A]] as const) if (Y.inside) for (let i = 0; i < X.verts.length; i += 3) { const d = Y.inside(X.verts[i]!, X.verts[i + 1]!, X.verts[i + 2]!); if (d > EPS) { inside++; depth = Math.max(depth, d); } }
  let result: Hit = null;
  if (crossings || inside) { const o = A.box.clone().intersect(B.box).getSize(new THREE.Vector3()); result = { crossings, inside, depth, overlap: [o.x, o.y, o.z] }; }
  if (pairCache.size > 400_000) pairCache.clear();
  pairCache.set(cacheKey, result);
  return result;
}
export function propsHit(a: Prop, b: Prop, shift?: [number, number, number]) {
  let best: Contact | null = null;
  for (const ma of a.meshes) {
    const A = shift ? shapeOf(ma, shift[1], shift[0], shift[2]) : shapeOf(ma);
    for (const mb of b.meshes) {
      const B = shapeOf(mb), hit = shapesHit(A, B);
      if (hit && (!best || hit.depth > best.depth)) best = { a: `${a.id}:${A.part}`, b: `${b.id}:${B.part}`, ...hit };
    }
  }
  return best;
}
export const propBox = (p: Prop) => p.meshes.reduce((box, mesh) => box.union(shapeOf(mesh).box), new THREE.Box3());
/** Smallest translation of `a` (lift, or horizontal in 4 directions) that removes every contact with `b`. */
export function clearance(a: Prop, b: Prop) {
  const step = .0005, search = (dir: [number, number, number], limit: number) => { for (let d = step; d <= limit + 1e-9; d += d < .01 ? step : .002) if (!propsHit(a, b, [dir[0] * d, dir[1] * d, dir[2] * d])) return d; return Infinity; };
  return { lift: search([0, 1, 0], .08), horizontal: Math.min(...DIRECTIONS.filter(d => !d[1]).map(d => search(d, .25))) };
}

/* ------------------------------------------------------------------ audit */
export type FindingType = 'interpenetration' | 'sinks-into-table' | 'floating' | 'off-table-edge' | 'flat-stack' | 'decal-on-paper' | 'decal-under-solid';
export interface Finding { scenario: string; type: FindingType; a: string; b?: string; mm: Record<string, number>; detail?: string }
export const TABLE_TOP = .782;
export const flatRadius = (state: DinnerState) => state.doubleDate ? 1.285 : .885;
const round = (o: Record<string, number>, digits = 1) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : v]));
/** World xz footprint polygon test helpers: flat props are planes or thin boxes lying on the cloth. */
function footprint(p: Prop) {
  const pts: [number, number][] = []; let minY = Infinity, maxY = -Infinity;
  for (const mesh of p.meshes) { const s = shapeOf(mesh); for (let k = 0; k < s.verts.length; k += 3) { pts.push([s.verts[k]!, s.verts[k + 2]!]); minY = Math.min(minY, s.verts[k + 1]!); maxY = Math.max(maxY, s.verts[k + 1]!); } }
  return { hull: convexHull(pts), minY, maxY };
}
function convexHull(points: [number, number][]) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.reverse()) { while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
/** Convex polygons overlap (separating axis) by more than `slack` metres. */
function hullsOverlap(A: [number, number][], B: [number, number][], slack = 0) {
  for (const poly of [A, B]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!, nx = q[1] - p[1], nz = p[0] - q[0], len = Math.hypot(nx, nz) || 1;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of A) { const d = (v[0] * nx + v[1] * nz) / len; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const v of B) { const d = (v[0] * nx + v[1] * nz) / len; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a0 >= b1 - slack || b0 >= a1 - slack) return false;
  }
  return true;
}
export function auditState(f: LayoutFixture, scenario: string, state: DinnerState, options: { clearance?: boolean; lifted?: string[] } = {}): Finding[] {
  const props = collectProps(f, state), out: Finding[] = [];
  const centerZ = -1.15 + f.diningOffsetZ(state), radius = flatRadius(state);
  const boxes = props.map(propBox);
  for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
    const a = props[i]!, b = props[j]!;
    // A decal lies on the cloth: solids may stand on it. It is checked against paper below.
    if (a.kind === 'decal' || b.kind === 'decal') continue;
    if (!boxes[i]!.intersectsBox(boxes[j]!)) continue;
    // Food sits inside its own plate's dish; still checked, against a looser depth floor.
    const foodOnPlate = (a.kind === 'food' || b.kind === 'food') && [a.id, b.id].some(id => id.endsWith('.plate'));
    const hit = propsHit(a, b); if (!hit) continue;
    const floor = (foodOnPlate ? 1.5 : .5) / 1000;
    // Resting or side-by-side contact: a nudge of `floor` in some direction separates them.
    if (DIRECTIONS.some(d => !propsHit(a, b, [d[0] * floor, d[1] * floor, d[2] * floor]))) continue;
    const mm: Record<string, number> = { solidDepth: hit.depth * 1000, overlapX: hit.overlap[0] * 1000, overlapY: hit.overlap[1] * 1000, overlapZ: hit.overlap[2] * 1000 };
    if (options.clearance) { const c = clearance(a, b); mm.lift = c.lift * 1000; mm.slide = c.horizontal * 1000; }
    out.push({ scenario, type: 'interpenetration', a: hit.a, b: hit.b, mm: round(mm), detail: `${hit.crossings} crossing triangle pairs, ${hit.inside} vertices inside a solid${foodOnPlate ? ' (food/plate)' : ''}` });
  }
  // Support: lowest vertices rest on the table top or on another prop (dropped straight down); nothing hangs past the flat top.
  for (let i = 0; i < props.length; i++) {
    const p = props[i]!, box = boxes[i]!;
    let footprintR = 0;
    for (const mesh of p.meshes) { const s = shapeOf(mesh); for (let k = 0; k < s.verts.length; k += 3) if (s.verts[k + 1]! < box.min.y + .002) footprintR = Math.max(footprintR, Math.hypot(s.verts[k]!, s.verts[k + 2]! - centerZ)); }
    if (box.min.y < TABLE_TOP - .0005 && footprintR <= radius) out.push({ scenario, type: 'sinks-into-table', a: p.id, mm: round({ depth: (TABLE_TOP - box.min.y) * 1000 }) });
    if (footprintR > radius + .0005) out.push({ scenario, type: 'off-table-edge', a: p.id, mm: round({ beyondFlatTop: (footprintR - radius) * 1000 }) });
    if (p.kind !== 'decal' && box.min.y > TABLE_TOP + .0015 && !options.lifted?.includes(p.id)) {
      // `gap` is geometric (either winding); `visibleGap` only counts up-facing front faces, i.e. what the camera draws.
      const others = props.filter(q => q !== p && q.kind !== 'decal');
      let gap = Infinity, visibleGap = Infinity, support = 'table', visibleSupport = 'table';
      for (const mesh of p.meshes) { const s = shapeOf(mesh); for (let k = 0; k < s.verts.length; k += 3) {
        const x = s.verts[k]!, y = s.verts[k + 1]!, z = s.verts[k + 2]!; if (y > box.min.y + .0015) continue;
        const onTable = Math.hypot(x, z - centerZ) <= radius ? y - TABLE_TOP : Infinity;
        if (onTable < gap) { gap = onTable; support = 'table'; } if (onTable < visibleGap) { visibleGap = onTable; visibleSupport = 'table'; }
        for (const q of others) for (const qm of q.meshes) { const d = dropOnto(shapeOf(qm), x, y, z); if (d.any < gap) { gap = d.any; support = q.id; } if (d.front < visibleGap) { visibleGap = d.front; visibleSupport = q.id; } }
      } }
      // A ridge (a plate's rim crest) can carry a prop between the prop's own vertices: raise the support's vertices to its underside.
      if (gap > .0015 || visibleGap > .0015) for (const q of others) for (const qm of q.meshes) {
        const r = riseOnto(p, shapeOf(qm), box); if (r < gap) { gap = r; support = q.id; } if (r < visibleGap) { visibleGap = r; visibleSupport = q.id; }
      }
      if (gap > .0015) out.push({ scenario, type: 'floating', a: p.id, b: support, mm: round({ gap: gap * 1000, bottomAboveTable: (box.min.y - TABLE_TOP) * 1000 }) });
      else if (visibleGap > .0015) out.push({ scenario, type: 'floating', a: p.id, b: visibleSupport, mm: round({ visibleGap: visibleGap * 1000, geometricGap: gap * 1000 }), detail: `rests on ${support} geometrically, but that surface is back-face culled from above` });
    }
  }
  out.push(...auditFlats(scenario, props), ...auditDecalsUnderSolids(scenario, props));
  return out;
}
/** A decal's own triangles against each solid prop's plan footprint: a stain lies beside the props, never under one. */
export function auditDecalsUnderSolids(scenario: string, props: Prop[]): Finding[] {
  const out: Finding[] = [], solids = props.filter(p => p.kind === 'solid').map(p => ({ p, print: footprint(p) }));
  for (const decal of props.filter(p => p.kind === 'decal' && !p.solidsOk)) {
    const box = propBox(decal);
    for (const { p, print } of solids) {
      let triangles = 0, total = 0;
      for (const mesh of decal.meshes) { const t = shapeOf(mesh).tri; for (let i = 0; i < t.length; i += 9, total++) {
        const tri: [number, number][] = [[t[i]!, t[i + 2]!], [t[i + 3]!, t[i + 5]!], [t[i + 6]!, t[i + 8]!]];
        if (hullsOverlap(tri, print.hull, .0005)) triangles++;
      } }
      if (triangles) out.push({ scenario, type: 'decal-under-solid', a: decal.id, b: p.id, mm: { triangles, of: total, decalY: round({ y: box.min.y * 1000 }, 2).y!, solidBottom: round({ y: print.minY * 1000 }, 2).y! } });
    }
  }
  return out;
}
/** Paper and decals: two flat items within .5 mm of each other with overlapping footprints z-fight; a stain never lies on paper. */
export function auditFlats(scenario: string, props: Prop[], extra: Prop[] = []): Finding[] {
  const out: Finding[] = [], flats = [...props, ...extra].filter(p => p.kind === 'flat' || p.kind === 'decal');
  const prints = flats.map(footprint);
  for (let i = 0; i < flats.length; i++) for (let j = i + 1; j < flats.length; j++) {
    const a = flats[i]!, b = flats[j]!, A = prints[i]!, B = prints[j]!;
    if (!hullsOverlap(A.hull, B.hull, .0005)) continue;
    const gap = Math.min(Math.abs(A.minY - B.minY), Math.abs(A.maxY - B.maxY));
    if (gap < .0005) out.push({ scenario, type: 'flat-stack', a: a.id, b: b.id, mm: round({ heightGap: gap * 1000 }, 2) });
    else if ((a.kind === 'decal') !== (b.kind === 'decal') && !(a.paperOk || b.paperOk)) out.push({ scenario, type: 'decal-on-paper', a: a.id, b: b.id, mm: round({ heightGap: gap * 1000 }, 2) });
  }
  return out;
}
/** Smallest rise from a vertex of `support` to the underside of `p` just above it (0 when embedded up to 3 mm), near p's lowest level. */
function riseOnto(p: Prop, support: Shape, box: THREE.Box3) {
  let best = Infinity; const v = support.verts;
  if (support.box.max.y < box.min.y - .003 || support.box.min.y > box.min.y + .0015) return best;
  for (let k = 0; k < v.length; k += 3) {
    const x = v[k]!, y = v[k + 1]!, z = v[k + 2]!;
    if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z || y < box.min.y - .003 || y > box.min.y + .0015) continue;
    let underside = Infinity; for (const mesh of p.meshes) underside = Math.min(underside, surfaceAt(shapeOf(mesh), x, z, 'lowest'));
    if (underside > box.min.y + .0015) continue;
    best = Math.min(best, Math.max(0, underside - y));
  }
  return best;
}
/** Vertical distance from (x,y,z) down to the highest triangle of `s` below it: any winding / up-facing front faces only. */
function dropOnto(s: Shape, x: number, y: number, z: number) {
  let any = Infinity, front = Infinity, above = Infinity, below = Infinity;
  if (x < s.box.min.x || x > s.box.max.x || z < s.box.min.z || z > s.box.max.z || s.box.min.y > y + 1e-4) return { any, front };
  const t = s.tri;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i]!, ay = t[i + 1]!, az = t[i + 2]!, bx = t[i + 3]!, by = t[i + 4]!, bz = t[i + 5]!, cx = t[i + 6]!, cy = t[i + 7]!, cz = t[i + 8]!;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(det) < 1e-14) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const ty = l1 * ay + l2 * by + l3 * cy, d = y - ty;
    if (d < -1e-4) { above = Math.min(above, -d); continue; }
    below = Math.min(below, d);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // y of (b-a)x(c-a)
    any = Math.min(any, Math.max(0, d)); if (ny > 0) front = Math.min(front, Math.max(0, d));
  }
  // A vertex a hair inside a shell (surface just above it, another below) is embedded, not floating; the interpenetration pass reports it.
  if (above < .003 && below < Infinity) any = front = 0;
  return { any, front };
}

/* ------------------------------------------------------------------ place-setting rules */
/** World xz convex hull of an object's visible meshes. */
function hullOf(...objects: THREE.Object3D[]) {
  const pts: [number, number][] = [];
  for (const mesh of objects.flatMap(meshesOf)) { const v = shapeOf(mesh).verts; for (let k = 0; k < v.length; k += 3) pts.push([v[k]!, v[k + 2]!]); }
  return convexHull(pts);
}
/** Horizontal gap between two convex xz polygons; 0 when they overlap. */
function hullGap(A: [number, number][], B: [number, number][]) {
  if (hullsOverlap(A, B)) return 0;
  const toSegment = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  };
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]] as const) for (const p of P) for (let i = 0; i < Q.length; i++) best = Math.min(best, toSegment(p, Q[i]!, Q[(i + 1) % Q.length]!));
  return best;
}
/**
 * Minimum horizontal distance between each visible napkin and every utensil of the same setting, in mm. That is each
 * place-setting napkin with its own cutlery, and each human's linen napkin (EveningTable: the local one, and in Double the
 * friend's) with theirs.
 */
export function napkinClearances(f: LayoutFixture, state?: DinnerState) {
  const out: { seat: string; utensil: string; mm: number }[] = [];
  const localX = state?.doubleDate ? (state.doubleDate.localHumanId === 'h1' ? -.57 : .57) : 0, nearZ = state?.doubleDate ? -.32 : -.64;
  for (const p of f.tabletop.placeGroups) {
    if (!shown(p.group)) continue;
    const seat = seatLabel(p.x, p.z, p.group.parent === f.tabletop.doubles);
    const napkins: [string, THREE.Object3D][] = [];
    if (shown(p.napkin)) napkins.push(['napkin', p.napkin]);
    if (state && p.x === localX && p.z === nearZ && shown(f.table.napkin)) napkins.push(['linen-napkin', f.table.napkin]);
    if (state?.doubleDate && p.x === -localX && p.z === nearZ && shown(f.table.friendNapkin)) napkins.push(['linen-napkin', f.table.friendNapkin]);
    for (const [which, napkin] of napkins) {
      const hull = hullOf(napkin);
      p.cutlery.children.forEach((utensil, i) => out.push({ seat: which === 'napkin' ? seat : `${seat}.${which}`, utensil: ['fork', 'knife', 'spoon'][i]!, mm: hullGap(hull, hullOf(utensil)) * 1000 }));
    }
  }
  return out;
}
/**
 * Each diner's fork lies on their own left: world -x for the humans (facing -z), world +x for the dates (facing +z).
 * Laid: fork left of the plate, knife right, napkin beyond the fork. Rested (finished): fork and knife lie side by
 * side across the right of the plate with the fork inside, toward the diner's left; the napkin keeps its place.
 */
export function forkSides(f: LayoutFixture) {
  return f.tabletop.placeGroups.filter(p => shown(p.group)).map(p => {
    const far = p.z < -1.15, centre = p.group.getWorldPosition(new THREE.Vector3());
    const fork = new THREE.Box3().setFromObject(p.cutlery.children[0]!).getCenter(new THREE.Vector3());
    const knife = new THREE.Box3().setFromObject(p.cutlery.children[1]!).getCenter(new THREE.Vector3());
    const napkin = p.napkin.getWorldPosition(new THREE.Vector3());
    const left = far ? 1 : -1, rested = Math.abs(p.cutlery.children[0]!.rotation.y) > 1e-6;
    const forkLeft = (fork.x - centre.x) * left, knifeLeft = (knife.x - centre.x) * left, napkinLeft = (napkin.x - centre.x) * left;
    return { seat: seatLabel(p.x, p.z, p.group.parent === f.tabletop.doubles), rested,
      forkOnLeft: rested ? forkLeft > knifeLeft + .01 : forkLeft > .15, knifeOnRight: rested ? knifeLeft < 0 : knifeLeft < -.15, napkinOutsideFork: napkinLeft > forkLeft + .03 };
  });
}

/** Height of the surface of `s` at plan point (x, z): its lowest triangle there, or its highest at or below `ceiling`. */
function surfaceAt(s: Shape, x: number, z: number, pick: 'lowest' | 'highest', ceiling = Infinity) {
  let best = pick === 'lowest' ? Infinity : -Infinity;
  if (x < s.box.min.x || x > s.box.max.x || z < s.box.min.z || z > s.box.max.z) return best;
  const t = s.tri, b = s.triBox;
  for (let i = 0, j = 0; i < t.length; i += 9, j += 6) {
    if (x < b[j]! || x > b[j + 3]! || z < b[j + 2]! || z > b[j + 5]!) continue;
    const ax = t[i]!, ay = t[i + 1]!, az = t[i + 2]!, bx = t[i + 3]!, by = t[i + 4]!, bz = t[i + 5]!, cx = t[i + 6]!, cy = t[i + 7]!, cz = t[i + 8]!;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(det) < 1e-14) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const y = l1 * ay + l2 * by + l3 * cy;
    if (pick === 'lowest') best = Math.min(best, y); else if (y <= ceiling) best = Math.max(best, y);
  }
  return best;
}
/**
 * A rested (finished) fork or knife bridges the plate's well, so its lowest point alone proves little: a rigid piece
 * touching the rim at one end can float at the other. Each piece's underside is sampled on a 1.5 mm grid in its own
 * frame (so a rim crest between its vertices still counts), and for each half along its axis this returns the smallest
 * gap down to that setting's plate, in mm (0 where they touch). Laid cutlery, on the cloth, is skipped.
 */
export function restedCutlerySupport(f: LayoutFixture) {
  const out: { seat: string; utensil: string; tipMm: number; handleMm: number }[] = [];
  const point = new THREE.Vector3(), step = .0015;
  for (const p of f.tabletop.placeGroups) {
    if (!shown(p.group)) continue;
    const plate = meshesOf(p.plate).map(mesh => shapeOf(mesh)), seat = seatLabel(p.x, p.z, p.group.parent === f.tabletop.doubles);
    p.cutlery.children.slice(0, 2).forEach((utensil, i) => {
      if (Math.abs(utensil.rotation.y) < 1e-6 || !shown(utensil) || !(utensil instanceof THREE.Mesh)) return;
      const shape = shapeOf(utensil), g = utensil.geometry; g.computeBoundingBox(); const local = g.boundingBox!, halves = [Infinity, Infinity];
      for (let u = local.min.x; u <= local.max.x + 1e-9; u += step) for (let v = local.min.z; v <= local.max.z + 1e-9; v += step) {
        point.set(u, 0, v).applyMatrix4(utensil.matrixWorld);
        const underside = surfaceAt(shape, point.x, point.z, 'lowest'); if (!Number.isFinite(underside)) continue;
        // A plate surface up to 3 mm above the underside is embedded (touching); the overlap checks judge its depth.
        let top = -Infinity; for (const q of plate) top = Math.max(top, surfaceAt(q, point.x, point.z, 'highest', underside + .003));
        if (!Number.isFinite(top)) continue;
        const half = v > 0 ? 1 : 0; halves[half] = Math.min(halves[half]!, Math.max(0, underside - top));
      }
      out.push({ seat, utensil: i ? 'knife' : 'fork', tipMm: halves[0]! * 1000, handleMm: halves[1]! * 1000 });
    });
  }
  return out;
}

/* ------------------------------------------------------------------ contact shadows */
/** Contact footprint of an object: its vertices within 5 mm of its lowest point, framed in the object's own yaw. */
function contactCentre(object: THREE.Object3D) {
  const meshes = meshesOf(object); if (!meshes.length) return null;
  let low = Infinity; for (const mesh of meshes) { const s = shapeOf(mesh); for (let k = 1; k < s.verts.length; k += 3) low = Math.min(low, s.verts[k]!); }
  const e = object.matrixWorld.elements, yaw = Math.hypot(e[0]!, e[2]!) >= Math.hypot(e[8]!, e[10]!) ? Math.atan2(-e[2]!, e[0]!) : Math.atan2(e[8]!, e[10]!);
  const c = Math.cos(yaw), s = Math.sin(yaw), ox = e[12]!, oz = e[14]!;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const mesh of meshes) { const sh = shapeOf(mesh); for (let k = 0; k < sh.verts.length; k += 3) {
    if (sh.verts[k + 1]! > low + .005) continue;
    const dx = sh.verts[k]! - ox, dz = sh.verts[k + 2]! - oz, u = dx * c - dz * s, v = dx * s + dz * c;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  } }
  const u = (minU + maxU) / 2, v = (minV + maxV) / 2;
  return { x: ox + u * c + v * s, z: oz - u * s + v * c, low };
}
/** Area-weighted centroid of an object's visible surface, in world space: where a soft overhead blob of a lifted body falls. */
function surfaceCentroid(object: THREE.Object3D) {
  const sum = new THREE.Vector3(); let area = 0;
  for (const mesh of meshesOf(object)) { const t = shapeOf(mesh).tri; for (let i = 0; i < t.length; i += 9) {
    const ux = t[i + 3]! - t[i]!, uy = t[i + 4]! - t[i + 1]!, uz = t[i + 5]! - t[i + 2]!, vx = t[i + 6]! - t[i]!, vy = t[i + 7]! - t[i + 1]!, vz = t[i + 8]! - t[i + 2]!;
    const a = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; area += a;
    sum.x += a * (t[i]! + t[i + 3]! + t[i + 6]!) / 3; sum.y += a * (t[i + 1]! + t[i + 4]! + t[i + 7]!) / 3; sum.z += a * (t[i + 2]! + t[i + 5]! + t[i + 8]!) / 3;
  } }
  return area > 0 ? sum.divideScalar(area) : null;
}
/**
 * `offsetMm` is measured from the object's contact footprint when it rests, and from the ground projection of its
 * surface centroid when it is lifted or tipped mid-beat (a soft overhead blob falls under the body, not under one rim).
 * `liftMm` is the object's lowest point above whatever it would rest on (the table, or the plate under rested cutlery).
 */
export interface ShadowReport { source: string; shown: boolean; offsetMm: number; heightMm: number; liftMm: number; opacity: number; scale: number }
/** Each blob (after sync) against the object it belongs to. */
export function auditShadows(f: LayoutFixture): ShadowReport[] {
  const mesh = f.shadows.mesh, opacity = mesh.geometry.getAttribute('instanceOpacity') as THREE.BufferAttribute;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return f.shadows.sources().map((source, i) => {
    mesh.getMatrixAt(i, matrix); matrix.premultiply(mesh.matrixWorld).decompose(position, q, s);
    // decompose() reports unit scale for a singular (hidden) matrix, so read the basis lengths directly.
    const e = matrix.elements;
    const visible = shown(source), centre = visible ? contactCentre(source) : null;
    let offsetMm = 0, liftMm = 0;
    if (centre) {
      liftMm = (centre.low - TABLE_TOP) * 1000;
      const middle = liftMm > 1.5 ? surfaceCentroid(source) : null;
      offsetMm = Math.min(Math.hypot(position.x - centre.x, position.z - centre.z), middle ? Math.hypot(position.x - middle.x, position.z - middle.z) : Infinity) * 1000;
    }
    return { source: describe(source), shown: visible, offsetMm, heightMm: (position.y - f.blobY) * 1000, liftMm, opacity: opacity.getX(i), scale: Math.max(Math.hypot(e[0]!, e[1]!, e[2]!), Math.hypot(e[8]!, e[9]!, e[10]!)) };
  });
}
/** Blob rules: a shown source has its blob at the cloth within 5 mm of it, or faded out only once it is well off the table; a hidden source has none. */
export function shadowProblem(r: ShadowReport) {
  if (!r.shown) return r.scale !== 0 || r.opacity !== 0 ? 'blob left behind by a hidden object' : null;
  if (Math.abs(r.heightMm) > .01) return 'blob is not at the cloth';
  if (r.opacity === 0) return r.scale === 0 && r.liftMm > 100 ? null : 'blob missing under a resting object';
  return r.offsetMm > 5 ? 'blob more than 5 mm from its object' : null;
}
function describe(object: THREE.Object3D) {
  const names: string[] = [];
  for (let o: THREE.Object3D | null = object; o && names.length < 4; o = o.parent) names.push(o.name || o.type);
  return names.join('<') + '@' + object.id;
}

/* ------------------------------------------------------------------ interaction targets */
/** Every visible tabletop interaction target sits on the prop it inspects: its centre within that prop's bounds (xz, 1 cm slack) and near its height. */
export function auditTargets(f: LayoutFixture, state: DinnerState) {
  const tp = f.tabletop, t = f.table, out: string[] = [];
  const localX = state.doubleDate ? (state.doubleDate.localHumanId === 'h1' ? -.57 : .57) : 0, nearZ = state.doubleDate ? -.32 : -.64;
  const place = tp.placeGroups.find(p => shown(p.group) && p.x === localX && p.z === nearZ);
  const bell = t.root.children.filter(o => o instanceof THREE.Mesh && !o.userData.target && Math.abs(o.position.x - .61) < 1e-6);
  const owners: Record<string, THREE.Object3D[]> = {
    glass: [tp.playerGlass], carafe: [tp.carafe], bread: [tp.basket], salt: [tp.shakers[0]!], pepper: [tp.shakers[1]!], lamp: [tp.lamp], vase: [tp.vase],
    plate: place ? [place.plate] : [], cutlery: place ? place.cutlery.children.slice(0, 2) : [], menu: [f.set.menu], napkin: [t.napkin], ticket: [t.ticket],
    dessert: [t.dessert.children[0]!], 'service-bell': bell, meal: t.meals.flatMap(course => course.filter(group => shown(group) && Math.abs(group.position.x - localX) < 1e-6 && Math.abs(group.position.z - nearZ) < 1e-6)), bill: [f.set.bill],
  };
  for (const target of [...f.set.targets, ...t.targets]) {
    const name = String(target.userData.target), objects = owners[name];
    if (!objects || !shown(target)) continue;
    const meshes = objects.flatMap(meshesOf);
    // Some targets (the bill, the meal) are filtered by the renderer's interaction rules rather than their own visibility.
    if (!meshes.length) continue;
    const box = meshes.reduce((b, mesh) => b.union(shapeOf(mesh).box), new THREE.Box3()), c = target.getWorldPosition(new THREE.Vector3());
    const slack = .01, inside = c.x >= box.min.x - slack && c.x <= box.max.x + slack && c.z >= box.min.z - slack && c.z <= box.max.z + slack && c.y >= box.min.y - .05 && c.y <= box.max.y + .1;
    if (!inside) out.push(`${name}: target at (${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}) is off its prop x[${box.min.x.toFixed(3)}, ${box.max.x.toFixed(3)}] y[${box.min.y.toFixed(3)}, ${box.max.y.toFixed(3)}] z[${box.min.z.toFixed(3)}, ${box.max.z.toFixed(3)}]`);
  }
  return out;
}

/* ------------------------------------------------------------------ browser fixture checks */
/**
 * The same bounding-box checks tests/fixtures/tabletop-renderer.ts runs in the browser specs (Box3.setFromObject ignores
 * visibility), so a layout change cannot pass here and fail there.
 */
export function browserFixtureChecks(f: LayoutFixture) {
  const tp = f.tabletop, t = f.table, root = tp.root, shared = root.children[2]!, settings = (root.children[1]!.visible ? root.children[1] : root.children[0])!;
  const entries: { name: string; object: THREE.Object3D }[] = [...shared.children.map((object, i) => ({ name: ['carafe', 'lamp', 'vase', 'bread', 'salt', 'pepper'][i] ?? `shared-${i}`, object })), { name: 'playerGlass', object: tp.playerGlass }, { name: 'menu', object: f.set.menu }, { name: 'napkin', object: t.napkin }, ...settings.children.map((object, i) => ({ name: `plate-${i}`, object: object.children[0]! }))];
  if (t.dessert.visible) entries.push({ name: 'dessert-own', object: t.dessert.children[0]! });
  if (t.otherDessert.visible) entries.push({ name: 'dessert-other', object: t.otherDessert.children[0]! });
  if (t.ticket.visible) entries.push({ name: 'ticket', object: t.ticket });
  t.extraOrders.forEach((x, i) => { if (x.root.visible) entries.push({ name: `extra-${i}`, object: x.root }); });
  const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o), intersections: string[] = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) { const a = entries[i]!, b = entries[j]!; if (box(a.object).intersectsBox(box(b.object))) intersections.push(`${a.name}/${b.name}`); }
  const flat = [{ name: 'salt', object: shared.children[4]! }, { name: 'pepper', object: shared.children[5]! }, { name: 'menu', object: f.set.menu }, ...(t.ticket.visible ? [{ name: 'ticket', object: t.ticket }] : [])].map(x => ({ name: x.name, box: box(x.object) })), footprints: string[] = [];
  for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) { const a = flat[i]!, b = flat[j]!; if (a.box.min.x <= b.box.max.x && a.box.max.x >= b.box.min.x && a.box.min.z <= b.box.max.z && a.box.max.z >= b.box.min.z) footprints.push(`${a.name}/${b.name}`); }
  const centerZ = -1.15 + f.set.diningRoot.position.z, point = new THREE.Vector3(), transform = new THREE.Matrix4(), instance = new THREE.Matrix4(); let supportRadius = 0;
  for (const top of [root, t.root]) top.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.target) return; const positions = object.geometry.getAttribute('position'); if (!positions) return;
    const count = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let k = 0; k < count; k++) { if (object instanceof THREE.InstancedMesh) { object.getMatrixAt(k, instance); transform.multiplyMatrices(object.matrixWorld, instance); } else transform.copy(object.matrixWorld);
      for (let i = 0; i < positions.count; i++) { point.fromBufferAttribute(positions, i).applyMatrix4(transform); supportRadius = Math.max(supportRadius, Math.hypot(point.x, point.z - centerZ)); } }
  });
  return { intersections, footprints, supportRadius };
}

/* ------------------------------------------------------------------ quiet table */
/** Every visible prop, interaction target and contact blob moves by exactly the quiet-table offset (dining-space.ts). */
export function auditQuietTable(f: LayoutFixture, mode: Scenario['mode'], local: Mod[] = [m.served], other: Mod[] = [m.served], room?: Scenario['room']) {
  const offset = 3.85, out: string[] = [];
  const snapshot = (quiet: boolean) => {
    const s = buildState({ label: 'q', mode, local: [...local, ...(quiet ? [m.quiet] : [])], other: [...other, ...(quiet ? [m.quiet] : [])], room }); applyFrame(f, s);
    const centres = new Map(collectProps(f, s).map(p => [p.id, propBox(p).getCenter(new THREE.Vector3())]));
    for (const t of [...f.set.targets, ...f.table.targets]) if (t.userData.target !== 'window' && t.userData.target !== 'exit') centres.set(`target:${t.userData.target}`, t.getWorldPosition(new THREE.Vector3()));
    const shadows = auditShadows(f), matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    shadows.forEach((blob, i) => { if (!blob.shown) return; f.shadows.mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix.premultiply(f.shadows.mesh.matrixWorld)); centres.set(`shadow:${i}`, position.clone()); });
    return centres;
  };
  const before = snapshot(false), after = snapshot(true);
  for (const [id, c] of before) { const d = after.get(id); if (!d) { out.push(`${id}: hidden after the move`); continue; } const e = Math.hypot(d.x - c.x, d.y - c.y, d.z - c.z - offset); if (e > 1e-6) out.push(`${id}: moved ${(d.z - c.z).toFixed(4)} m (expected ${offset})`); }
  for (const id of after.keys()) if (!before.has(id)) out.push(`${id}: only visible after the move`);
  return out;
}

/* ------------------------------------------------------------------ transitions */
/**
 * Play real (non-reduced-motion) frames from one settled state toward another. Props that slide aside must not pass
 * through, or sink under, anything that was already on the table; a dish that is served or parked appears at its place
 * at once, so contacts with props new to the frame are not counted.
 */
export function auditTransition(f: LayoutFixture, from: Scenario, to: Scenario, frames = 14, dt = 1 / 30): Finding[] {
  const start = buildState(from); applyFrame(f, start);
  const before = new Set(collectProps(f, start).map(p => p.id)), out: Finding[] = [], seen = new Set<string>();
  const state = buildState(to);
  for (let frame = 0; frame < frames; frame++) {
    applyFrame(f, state, false, dt);
    for (const x of auditState(f, `${from.label} -> ${to.label} @${frame}`, state)) {
      if (x.type !== 'interpenetration' && x.type !== 'sinks-into-table') continue;
      const ids = [x.a, x.b].filter((id): id is string => !!id).map(id => id.split(':')[0]!);
      if (!ids.every(id => before.has(id))) continue;
      const key = `${x.type}|${x.a}|${x.b ?? ''}`; if (seen.has(key)) continue; seen.add(key); out.push(x);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ run */
export function runScenarios(f: LayoutFixture, scenarios: Scenario[], options: { clearance?: boolean } = {}) {
  const findings: Finding[] = [];
  for (const s of scenarios) { const state = buildState(s); applyFrame(f, state, s.motion); findings.push(...auditState(f, s.label, state, { ...options, lifted: s.lifted })); }
  return findings;
}

async function main() {
  const args = new Set(process.argv.slice(2)), only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
  const f = await createLayoutFixture(), started = Date.now();
  const scenarios = SCENARIOS.filter(s => !only || s.label.includes(only));
  const findings = runScenarios(f, scenarios, { clearance: !args.has('--fast') });
  const shadowIssues: string[] = [], napkinIssues: string[] = [], forkIssues: string[] = [], targetIssues: string[] = [], restIssues: string[] = [];
  for (const s of scenarios) {
    const state = buildState(s); applyFrame(f, state, s.motion);
    for (const r of auditShadows(f)) { const problem = shadowProblem(r); if (problem) shadowIssues.push(`${s.label} ${problem} ${JSON.stringify(r)}`); }
    for (const c of napkinClearances(f, state)) if (c.mm < 10) napkinIssues.push(`${s.label} ${c.seat}.${c.utensil} ${c.mm.toFixed(1)} mm`);
    for (const side of forkSides(f)) if (!side.forkOnLeft || !side.knifeOnRight || !side.napkinOutsideFork) forkIssues.push(`${s.label} ${JSON.stringify(side)}`);
    for (const issue of auditTargets(f, state)) targetIssues.push(`${s.label} ${issue}`);
    for (const r of restedCutlerySupport(f)) if (Math.max(r.tipMm, r.handleMm) > .6) restIssues.push(`${s.label} ${r.seat}.${r.utensil} tip ${r.tipMm.toFixed(2)} mm handle ${r.handleMm.toFixed(2)} mm`);
  }
  const quiet = (['solo', 'h1', 'h2'] as const).map(mode => ({ mode, issues: auditQuietTable(f, mode) }));
  if (args.has('--json')) { console.log(JSON.stringify({ findings, shadowIssues, napkinIssues, forkIssues, targetIssues, restIssues, quiet }, null, 1)); return; }
  const groups = new Map<string, { f: Finding; scenarios: string[] }>();
  for (const x of findings) { const key = `${x.type}|${x.a}|${x.b ?? ''}|${JSON.stringify(x.mm)}`; const g = groups.get(key); if (g) g.scenarios.push(x.scenario); else groups.set(key, { f: x, scenarios: [x.scenario] }); }
  console.log(`# tabletop layout audit: ${scenarios.length} scenarios, ${findings.length} findings in ${groups.size} groups (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  for (const { f: x, scenarios: where } of groups.values())
    console.log(`${x.type.padEnd(17)} ${x.a}${x.b ? '  x  ' + x.b : ''}  ${Object.entries(x.mm).map(([k, v]) => `${k}=${v}`).join(' ')}  ${x.detail ?? ''}\n    in: ${where.join(', ')}`);
  console.log(`\n# contact shadows: ${f.shadows.sources().length} sources, ${shadowIssues.length} issues`); shadowIssues.slice(0, 40).forEach(line => console.log(line));
  console.log(`\n# napkin clearance (>= 10 mm): ${napkinIssues.length} issues`); napkinIssues.slice(0, 40).forEach(line => console.log(line));
  console.log(`\n# fork on each diner's left: ${forkIssues.length} issues`); forkIssues.slice(0, 40).forEach(line => console.log(line));
  console.log(`\n# finished cutlery touches the plate at both ends (<= .6 mm): ${restIssues.length} issues`); restIssues.slice(0, 40).forEach(line => console.log(line));
  console.log(`\n# interaction targets on their props: ${targetIssues.length} issues`); targetIssues.slice(0, 40).forEach(line => console.log(line));
  console.log('\n# quiet-table move consistency'); for (const q of quiet) console.log(`${q.mode}: ${q.issues.length ? q.issues.join('; ') : 'ok'}`);
}
if (process.argv[1]?.endsWith('tabletop-layout-harness.ts')) void main().catch(error => { console.error(error); process.exitCode = 1; });
