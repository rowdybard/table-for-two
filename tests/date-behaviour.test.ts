import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { DateBehaviour, type DateBehaviourInput } from '../src/restaurant/render/DateBehaviour';

const base = (patch: Partial<DateBehaviourInput> = {}): DateBehaviourInput => ({
  interest: 45, stance: 'curious', emotion: 'neutral', seated: true, speaking: false, listening: false, thinking: false,
  mainServed: false, dateBites: 0, quietFor: 0, reducedMotion: false,
  glass: new THREE.Vector3(-.42, .782, .55), plate: new THREE.Vector3(0, .782, .58), head: new THREE.Vector3(0, 1.33, .02), ...patch,
});
function run(behaviour: DateBehaviour, from: number, seconds: number, input: DateBehaviourInput, step = 1 / 30) {
  const seen = new Set<string>(); let t = from;
  for (; t < from + seconds; t += step) { const out = behaviour.update(t, step, input); if (out.gesture) seen.add(out.gesture); }
  return { seen, t };
}

test('a new bite on the server plays one bite with the fork in hand, and the fork rests on the plate between bites', () => {
  const behaviour = new DateBehaviour(1);
  run(behaviour, 0, 1, base({ mainServed: true, dateBites: 0 }));
  assert.equal(behaviour.output.fork, 'plate');
  let inHand = false, reached = 0;
  for (let t = 1; t < 4; t += 1 / 30) {
    const out = behaviour.update(t, 1 / 30, base({ mainServed: true, dateBites: 1 }));
    if (out.fork === 'hand') inHand = true;
    reached = Math.max(reached, out.arms[1].weight);
  }
  assert.ok(inHand, 'the fork is in the hand during the bite'); assert.ok(reached > .9, 'the fork hand does the bite');
  assert.equal(behaviour.output.gesture === 'bite', false, 'the bite ends'); assert.equal(behaviour.output.fork, 'plate');
  run(behaviour, 4, 1, base({ mainServed: false, dateBites: 1 }));
  assert.equal(behaviour.output.fork, 'table', 'once the plates are cleared the fork is back in its place');
});

test('a sip lifts the glass to the lips with the glass hand and puts it back down', () => {
  const behaviour = new DateBehaviour(2); behaviour.force('sip', 0);
  let lifted = 0, tilt = 0, highest = -Infinity;
  for (let t = 0; t < 3.3; t += 1 / 30) {
    const out = behaviour.update(t, 1 / 30, base());
    lifted = Math.max(lifted, out.glass.weight); tilt = Math.max(tilt, out.glass.tilt);
    if (out.glass.weight > .9) highest = Math.max(highest, out.glass.position.y);
    assert.equal(out.arms[1].weight, 0, 'the other hand stays where it was');
  }
  assert.ok(lifted > .95); assert.ok(tilt > .5); assert.ok(highest > 1.1, `the glass reaches the mouth, got ${highest}`);
  assert.equal(behaviour.output.glass.weight, 0, 'the glass is back on the table');
});

test('interest shows in posture: leaning in and smiling when it goes well, sitting back and drifting when it does not', () => {
  const warm = new DateBehaviour(3), cold = new DateBehaviour(3);
  run(warm, 0, 6, base({ interest: 90 })); run(cold, 0, 6, base({ interest: 10 }));
  assert.ok(warm.output.lean > cold.output.lean + .03);
  assert.ok(warm.output.smile > cold.output.smile);
  assert.ok(cold.output.wander > warm.output.wander);
});

test('only real interest earns a chin on the hand while listening, and thinking raises a hand to the chin', () => {
  const keen = new DateBehaviour(4), polite = new DateBehaviour(4);
  assert.ok(run(keen, 0, 8, base({ interest: 85, listening: true })).seen.has('chin'));
  assert.ok(!run(polite, 0, 8, base({ interest: 40, listening: true })).seen.has('chin'));
  const thinking = new DateBehaviour(5);
  const { seen } = run(thinking, 0, 3, base({ thinking: true }));
  assert.ok(seen.has('think')); assert.ok(thinking.output.lookUp > .8);
  run(thinking, 3, 1, base({ thinking: false, speaking: true }));
  assert.equal(thinking.output.gesture, null, 'the hand comes down when they start to answer');
});

test('a bored date reaches for their phone in a long quiet, and puts it away when spoken to', () => {
  const bored = new DateBehaviour(6);
  const { seen, t } = run(bored, 0, 40, base({ interest: 10, quietFor: 30 }));
  assert.ok(seen.has('phone'));
  bored.force('phone', t);
  run(bored, t, 1.2, base({ interest: 10, quietFor: 30, listening: true }));
  assert.equal(bored.output.phone, false);
  const keen = new DateBehaviour(6);
  assert.ok(!run(keen, 0, 60, base({ interest: 80, quietFor: 30 })).seen.has('phone'), 'an interested date never checks out');
});

test('reduced motion and standing up stop table business', () => {
  const behaviour = new DateBehaviour(7);
  const still = run(behaviour, 0, 30, base({ reducedMotion: true, interest: 10, quietFor: 40, mainServed: true }));
  assert.equal(still.seen.size, 0);
  const standing = new DateBehaviour(7);
  assert.equal(run(standing, 0, 30, base({ seated: false, interest: 10, quietFor: 40 })).seen.size, 0);
});
