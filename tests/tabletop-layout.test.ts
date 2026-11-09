import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as THREE from 'three';
import {
  SCENARIOS, TABLE_TOP, applyFrame, auditFlats, auditQuietTable, auditShadows, auditTargets, auditTransition, browserFixtureChecks, buildState,
  collectProps, createLayoutFixture, forkSides, mods as m, napkinClearances, restedCutlerySupport, runScenarios, shadowProblem, shown, type Finding, type LayoutFixture, type Mod, type Scenario,
} from './fixtures/tabletop-layout-harness';
import { CONTACT_SHADOW_MAX, VENUE_ENV } from '../src/restaurant/render/VenueContract';
import { PLACE_SETTING, SPILLED_GLASS } from '../src/restaurant/render/TabletopProps';

let f: LayoutFixture;
let findings: Finding[] = [];
before(async () => {
  f = await createLayoutFixture();
  findings = runScenarios(f, SCENARIOS);
});
const describe = (list: Finding[]) => list.map(x => `${x.scenario} ${x.type} ${x.a}${x.b ? ' x ' + x.b : ''} ${JSON.stringify(x.mm)}`);
const each = (check: (scenario: Scenario) => string[]) => SCENARIOS.flatMap(s => { applyFrame(f, buildState(s), s.motion); return check(s).map(line => `${s.label} ${line}`); });

/** The water puddle (RestaurantScene) lies at .7843, above the paper at .783. */
const puddle = () => f.set.spill.children[0]!;
const puddleAtPaperHeight = () => Math.abs(puddle().position.y - .783) < 1e-6;

test('every scenario rests: no interpenetration past .5 mm, nothing sinking, floating or hanging past the flat top', () => {
  assert.ok(SCENARIOS.length >= 170, `${SCENARIOS.length} scenarios`);
  assert.deepEqual(describe(findings.filter(x => x.type !== 'flat-stack' && x.type !== 'decal-on-paper' && x.type !== 'decal-under-solid')), []);
});

test('flat items never z-fight: paper and decals within .5 mm with overlapping footprints, or a stain on paper or under a prop', () => {
  assert.deepEqual(describe(findings.filter(x => (x.type === 'flat-stack' || x.type === 'decal-on-paper' || x.type === 'decal-under-solid'))), []);
});

test('the spill puddle sits above the paper at .7843', () => {
  assert.ok(!puddleAtPaperHeight(), 'the puddle must not share the paper height .783');
  assert.deepEqual(describe(findings.filter(x => x.type === 'flat-stack' && (x.a === 'spill-puddle' || x.b === 'spill-puddle'))), []);
});

test('the decals already clear a puddle raised to .7843', () => {
  const original = puddle().position.y, out: Finding[] = [];
  try {
    puddle().position.y = .7843;
    for (const s of SCENARIOS.filter(s => /spill|cloth|stain/.test(s.label))) { const state = buildState(s); applyFrame(f, state, s.motion); out.push(...auditFlats(s.label, collectProps(f, state))); }
  } finally { puddle().position.y = original; }
  assert.deepEqual(describe(out), []);
});

test('the silverware lies beside every napkin, at least 10 mm clear', () => {
  let measured = 0;
  const issues = SCENARIOS.flatMap(s => { const state = buildState(s); applyFrame(f, state, s.motion); return napkinClearances(f, state).filter(c => (measured++, c.mm < 10)).map(c => `${s.label} ${c.seat}.${c.utensil} ${c.mm.toFixed(1)} mm`); });
  assert.deepEqual(issues, []);
  assert.ok(measured > 1500, `${measured} napkin/utensil pairs measured`);
});

test('finished cutlery bridges the plate touching it at both ends, whichever way the plate is turned', () => {
  let measured = 0;
  const issues = SCENARIOS.flatMap(s => { applyFrame(f, buildState(s), s.motion); return restedCutlerySupport(f).filter(r => (measured++, Math.max(r.tipMm, r.handleMm) > .6)).map(r => `${s.label} ${r.seat}.${r.utensil} tip half ${r.tipMm.toFixed(2)} mm, handle half ${r.handleMm.toFixed(2)} mm`); });
  assert.deepEqual(issues, []);
  assert.ok(measured >= 150, `${measured} rested pieces measured`);
});

test('each human napkin lies in the same place for both Double observers; the place-setting napkins are the dates\'', () => {
  const issues: string[] = [];
  const rooms: [Mod[], Mod[]][] = [[[], []], [[m.folded], []], [[], [m.folded, m.crossed]], [[m.served, m.folded], [m.served, m.folded]]];
  for (const [h1, h2] of rooms) {
    const seen = new Map<string, { matrix: number[]; folded: boolean; observer: string }>();
    for (const observer of ['h1', 'h2'] as const) {
      const friend = observer === 'h1' ? 'h2' : 'h1';
      applyFrame(f, buildState({ label: 'napkins', mode: observer, local: observer === 'h1' ? h1 : h2, other: observer === 'h1' ? h2 : h1 }));
      for (const p of f.tabletop.placeGroups) if (shown(p.group) && p.z > -1.15 && shown(p.napkin)) issues.push(`${observer} sees a place-setting napkin at the human seat x ${p.x}`);
      for (const [owner, napkin] of [[observer, f.table.napkin], [friend, f.table.friendNapkin]] as const) {
        if (!shown(napkin)) { issues.push(`${observer} cannot see ${owner}'s napkin`); continue; }
        const view = { matrix: [...napkin.matrixWorld.elements], folded: napkin.children[0]!.visible, observer }, first = seen.get(owner);
        if (!first) { seen.set(owner, view); continue; }
        if (first.folded !== view.folded || first.matrix.some((value, i) => Math.abs(value - view.matrix[i]!) > 1e-9)) issues.push(`${owner}'s napkin differs between ${first.observer} and ${observer}`);
      }
    }
  }
  assert.deepEqual(issues, []);
  applyFrame(f, buildState({ label: 'solo', mode: 'solo' })); assert.equal(shown(f.table.friendNapkin), false);
});

test('far settings are turned so each date has the fork on their left and the napkin beyond it', () => {
  const issues = SCENARIOS.flatMap(s => { applyFrame(f, buildState(s), s.motion); return forkSides(f).filter(x => !x.forkOnLeft || !x.knifeOnRight || !x.napkinOutsideFork).map(x => `${s.label} ${JSON.stringify(x)}`); });
  assert.deepEqual(issues, []);
  for (const p of f.tabletop.placeGroups) assert.equal(p.group.rotation.y, p.z < -1.15 ? Math.PI : 0, `setting at z ${p.z}`);
  // Laid cutlery sits fork, plate, knife, spoon from the diner's left; the napkin is beyond the fork.
  const s = PLACE_SETTING;
  assert.ok(s.napkin.x + s.napkin.size[0] / 2 < s.fork.x - .02 && s.fork.x < -.15 && s.knife.x > .15 && s.spoon.x > s.knife.x);
});

test('contact shadows stay within 5 mm of their objects and hide with them', () => {
  const issues = each(() => auditShadows(f).flatMap(r => { const problem = shadowProblem(r); return problem ? [`${problem} ${JSON.stringify(r)}`] : []; }));
  assert.deepEqual(issues, []);
  const sources = f.shadows.sources();
  assert.ok(sources.length >= 49 && sources.length <= CONTACT_SHADOW_MAX, `${sources.length} tagged sources`);
  // Hidden objects (the other layout's settings, unserved extras) keep a zero-scale, zero-opacity instance.
  applyFrame(f, buildState({ label: 'solo', mode: 'solo' }));
  const reports = auditShadows(f);
  assert.ok(reports.some(r => !r.shown) && reports.every(r => r.shown || (r.scale === 0 && r.opacity === 0)));
});

test('contact shadows sync from their own mesh before it draws, never from scene.onBeforeRender', () => {
  const mesh = f.shadows.mesh;
  assert.equal(f.scene.onBeforeRender, THREE.Object3D.prototype.onBeforeRender);
  assert.notEqual(mesh.onBeforeRender, THREE.Object3D.prototype.onBeforeRender);
  assert.equal(mesh.frustumCulled, false); assert.equal(mesh.castShadow, false); assert.equal(mesh.renderOrder, -1);
  assert.equal(mesh.count, f.shadows.sources().length);
  // Move a tagged prop and let the mesh's own hook place its blob.
  const state = buildState({ label: 'solo', mode: 'solo' }); applyFrame(f, state);
  const carafe = f.tabletop.carafe, index = f.shadows.sources().indexOf(carafe), matrix = new THREE.Matrix4(), at = new THREE.Vector3();
  assert.ok(index >= 0);
  carafe.position.x += .1; f.scene.updateMatrixWorld(true);
  mesh.onBeforeRender(undefined as never, f.scene, undefined as never, mesh.geometry, mesh.material as THREE.Material, null as never);
  mesh.getMatrixAt(index, matrix); at.setFromMatrixPosition(matrix.premultiply(mesh.matrixWorld));
  assert.ok(Math.abs(at.x - carafe.getWorldPosition(new THREE.Vector3()).x) < 1e-6);
  // A still table uploads nothing: the instance buffers are flagged only when a blob changes.
  const versions = () => [mesh.instanceMatrix.version, (mesh.geometry.getAttribute('instanceOpacity') as THREE.InstancedBufferAttribute).version];
  const before = versions();
  mesh.onBeforeRender(undefined as never, f.scene, undefined as never, mesh.geometry, mesh.material as THREE.Material, null as never);
  assert.deepEqual(versions(), before);
  carafe.position.x -= .1; f.scene.updateMatrixWorld(true);
  mesh.onBeforeRender(undefined as never, f.scene, undefined as never, mesh.geometry, mesh.material as THREE.Material, null as never);
  assert.ok(versions()[0]! > before[0]!);
  applyFrame(f, state);
});

test('the quiet table moves every prop, interaction target and blob by exactly 3.85 m', () => {
  const states: [Scenario['mode'], Parameters<typeof auditQuietTable>[2], Parameters<typeof auditQuietTable>[3], Scenario['room']?][] = [
    ['solo', [m.served], [m.served]], ['h1', [m.served], [m.served]], ['h2', [m.served], [m.served]],
    ['solo', [m.dessert(), m.extras('boxed'), m.billOnly], []], ['solo', [m.crossed, m.spilled, m.glassesCleared], []],
    ['h1', [m.dessert(), m.clothReady], [m.dessert('lemon')], { scenarioTarget: 'h1' }], ['h2', [m.taste(1), m.crossed], [m.extras('served')], { scenarioTarget: 'h1' }],
  ];
  const issues = states.flatMap(([mode, local, other, room]) => auditQuietTable(f, mode, local, other, room).map(line => `${mode}: ${line}`));
  assert.deepEqual(issues, []);
});

test('interaction targets stay on the props they inspect', () => {
  assert.deepEqual(SCENARIOS.flatMap(s => { const state = buildState(s); applyFrame(f, state, s.motion); return auditTargets(f, state).map(line => `${s.label} ${line}`); }), []);
  // The solo points the browser tabletop spec aims at still land inside their targets.
  applyFrame(f, buildState({ label: 'solo', mode: 'solo', local: [m.served] }));
  const points: Record<string, [number, number, number]> = { glass: [.49, .88, -.77], bread: [.34, .85, -1.28], salt: [.66, .84, -.91], pepper: [.745, .84, -.91], cutlery: [-.235, .84, -.535], lamp: [-.20, .92, -1.12], vase: [-.48, .95, -1.08], plate: [0, .82, -.64], menu: [-.42, .83, -.75], napkin: [.40, .85, -.48] };
  for (const [name, point] of Object.entries(points)) {
    const target = [...f.set.targets, ...f.table.targets].find(t => t.userData.target === name) as THREE.Mesh;
    target.geometry.computeBoundingBox();
    const box = target.geometry.boundingBox!.clone().applyMatrix4(target.matrixWorld);
    assert.ok(box.containsPoint(new THREE.Vector3(...point)), `${name} target misses ${point}`);
  }
});

test('the browser fixture box checks hold in every settled state', () => {
  const issues = SCENARIOS.filter(s => !s.motion).flatMap(s => {
    const state = buildState(s); applyFrame(f, state);
    const r = browserFixtureChecks(f), out: string[] = [];
    out.push(...r.intersections.filter(pair => pair.includes('dessert-') || pair.includes('extra-') || (pair.includes('bread') && pair.includes('plate-'))));
    out.push(...r.footprints.filter(pair => pair.includes('menu')));
    if (state.doubleDate && r.supportRadius > 1.30) out.push(`support radius ${r.supportRadius.toFixed(3)}`);
    return out.map(line => `${s.label} ${line}`);
  });
  assert.deepEqual(issues, []);
});

test('props that step aside never slide through, or under, what is already on the table', () => {
  const pairs: [Scenario, Scenario][] = [];
  for (const mode of ['solo', 'h1', 'h2'] as const) {
    const S = (label: string, local: Scenario['local'] = [], other: Scenario['other'] = [], room?: Scenario['room']): Scenario => ({ label: `${mode}:${label}`, mode, local, other, room });
    const own = mode === 'solo' ? undefined : { incidentOwner: mode, scenarioTarget: mode } as Scenario['room'];
    pairs.push([S('mains', [m.served], [m.served]), S('dessert', [m.dessert()], [m.served])], [S('mains', [m.served], [m.served]), S('extras', [m.served, m.extras('served')], [m.served], own)],
      [S('dessert', [m.dessert()]), S('dessert+extras', [m.dessert(), m.extras('boxed')], [], own)], [S('mains', [m.served]), S('space-cleared', [m.served, m.spaceCleared])],
      [S('mains', [m.served], [m.served]), S('spilled', [m.served, m.spilled], [m.served], own)], [S('spilled', [m.served, m.spilled], [], own), S('mains', [m.served], [], own)],
      [S('mains', [m.served]), S('crossed', [m.served, m.crossed])], [S('mains', [m.served]), S('raised', [m.served, m.raised])]);
    if (mode !== 'solo') pairs.push([S('dessert', [m.dessert()], [m.served]), S('dual', [m.dessert()], [m.dessert()])]);
  }
  const out = pairs.flatMap(([from, to]) => auditTransition(f, from, to));
  assert.deepEqual(describe(out), []);
});

test('a knocked glass rolls over on its edge instead of swinging its foot through the cloth', () => {
  const lowest = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object, true).min.y;
  for (const [from, to] of [[[m.served], [m.served, m.spilled]], [[m.served, m.spilled], [m.served]], [[m.served], [m.served, m.raised]], [[m.served, m.raised], [m.served]]] as const) {
    applyFrame(f, buildState({ label: 'from', mode: 'solo', local: [...from] }));
    const state = buildState({ label: 'to', mode: 'solo', local: [...to] });
    for (let frame = 0; frame < 40; frame++) { applyFrame(f, state, false, 1 / 60); assert.ok(lowest(f.tabletop.playerGlass) >= TABLE_TOP - .0005, `frame ${frame}: glass base at ${lowest(f.tabletop.playerGlass).toFixed(4)}`); }
  }
  applyFrame(f, buildState({ label: 'spilled', mode: 'solo', local: [m.spilled] }));
  assert.ok(Math.abs(f.tabletop.playerGlass.rotation.z - SPILLED_GLASS.tilt) < 1e-9 && Math.abs(f.tabletop.playerGlass.position.y - SPILLED_GLASS.y) < 1e-9);
});

test('materials carry the venue tags, and nothing on the table renders into a shadow map', () => {
  const visit = (root: THREE.Object3D, fn: (mesh: THREE.Mesh, material: THREE.MeshStandardMaterial) => void) => root.traverse(o => { if (o instanceof THREE.Mesh && !o.userData.target) for (const mat of ([] as THREE.Material[]).concat(o.material)) fn(o, mat as THREE.MeshStandardMaterial); });
  const issues: string[] = [];
  for (const root of [f.tabletop.root, f.table.root]) visit(root, (mesh, mat) => {
    const name = `${mesh.geometry.type}/${mat.type}`;
    if (mat.metalness === 1 && mat.userData.venueEnv !== VENUE_ENV.metal) issues.push(`${name}: metal without venueEnv.metal`);
    if (mat.transparent && mat.opacity <= .3 && mat.side === THREE.DoubleSide && mat.depthWrite === false && (mat as THREE.Material).type === 'MeshStandardMaterial' && !mat.userData.venueGlass) issues.push(`${name}: glass without venueGlass`);
    // Contact blobs ground the props; a per-frame shadow pass for them cost frames for little.
    if (mesh.castShadow) issues.push(`${name}: casts a shadow-map shadow`);
  });
  for (const course of f.table.meals) for (const group of course) group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.castShadow) issues.push('food casts a shadow'); });
  const place = f.tabletop.placeGroups[0]!;
  assert.ok((place.plate.children[0] as THREE.Mesh).receiveShadow && place.napkin.children.every(c => (c as THREE.Mesh).receiveShadow));
  assert.ok(f.tabletop.menu.receiveShadow && f.table.napkin.receiveShadow);
  assert.deepEqual(issues, []);
  // The lamp bulb stays the lamp's child and does not tone-map, for the lighting's halo to follow.
  const flame = (f.tabletop as unknown as { flame: THREE.Mesh }).flame;
  assert.equal(flame.parent, f.tabletop.lamp); assert.equal((flame.material as THREE.MeshBasicMaterial).toneMapped, false);
});

test('child-index contracts used by the browser specs hold', () => {
  const tp = f.tabletop, shared = tp.root.children[2]!;
  assert.deepEqual(shared.children, [tp.carafe, tp.lamp, tp.vase, tp.basket, tp.shakers[0], tp.shakers[1]]);
  assert.equal((tp.playerGlass.children[1] as THREE.Mesh).geometry.type, 'CylinderGeometry');
  for (const p of tp.placeGroups) assert.equal(p.group.children[0], p.plate);
  for (const dessert of [f.table.dessert, f.table.otherDessert]) assert.equal(dessert.children[0]!.userData.centralTray, true);
  assert.ok(shown(tp.root));
});
