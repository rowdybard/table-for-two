import assert from 'node:assert/strict';
import { test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { DinnerScene } from '../server/restaurant/scene';
import { validateTurn } from '../server/restaurant/index';
import { MENU } from '../src/restaurant/content';
import { CHARACTER_STORIES } from '../src/restaurant/story';
import type { DateId, DinnerCommand, DinnerEvent, EveningAction, SceneTurn } from '../src/restaurant/types';

async function setup(dateId: DateId = 'mira', storyRate = 20) {
  await RAPIER.init(); const scene = new DinnerScene(dateId, 2, { storyRate, variation: 1, scenarioId: 'family-visit' }); let time = 1000;
  const settleStory = () => { while (scene.state.evening.scenario?.phase === 'active') { time += 600; scene.command({ type: 'scenario', choice: scene.state.evening.scenario.choices[0].id }, time); } };
  const command = (c: DinnerCommand) => { if (c.type !== 'scenario' && c.type !== 'pause' && c.type !== 'finish') settleStory(); time += 600; scene.command(c, time); };
  const action = (action: EveningAction, fields: Record<string, unknown> = {}) => command({ type: 'evening', action, ...fields } as DinnerCommand);
  const advance = (seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) { time += 1000 / 60; scene.step(1 / 60, time); } };
  const move = (x: number, z: number, seconds: number) => { for (let i = 0; i < seconds * 60; i++) { time += 1000 / 60; scene.command({ type: 'move', x, z, yaw: 0 }, time); scene.step(1 / 60, time); } };
  move(0, -1, 1.7); command({ type: 'interact', target: 'seat' }); advance(6); command({ type: 'interact', target: 'menu', choice: MENU[0] });
  const refusal = 'Please let me choose my own food. Do not order for me.';
  let boundaryDelivered = false;
  const social = (signal: NonNullable<SceneTurn['social']>['signal'], wantsToLeave = false) => {
    if ((signal === 'pressure' || signal === 'repair') && !boundaryDelivered) {
      const line = { speaker: 'date' as const, text: refusal, emotion: 'neutral' as const };
      const humanText = 'Shall I choose your dinner for you?';
      scene.applyTurn({ utterances: [line], emotion: 'neutral', action: 'none', memory: 'The date stated a food choice boundary.', social: { signal: 'none', reason: 'The date wants to choose their own food.', wantsToLeave: false, boundary: { kind: 'set', topic: 'food-drink', refusal, evidence: humanText } } }, humanText);
      scene.acknowledge(line); boundaryDelivered = true;
    }
    const humanText = signal === 'pressure' ? 'I am choosing your dinner anyway.' : signal === 'repair' ? 'You are right. Your food is your choice, and I will leave it to you.' : `The player's ${signal} response.`;
    scene.applyTurn({ utterances: [{ speaker: 'date', text: signal === 'repair' ? 'Thank you for hearing what I asked.' : 'A considered response.', emotion: 'neutral' }], emotion: 'neutral', action: 'none', memory: 'We are having dinner.', social: { signal, reason: `A specific ${signal} moment.`, wantsToLeave, ...(['pressure', 'repair'].includes(signal) ? { boundary: { kind: signal === 'pressure' ? 'repeat' as const : 'repair' as const, topic: 'food-drink' as const, refusal, evidence: humanText } } : {}) } }, humanText);
  };
  const earnConfidence = (recovery = false) => {
    const context = scene.director.agenda.promptContext();
    const first = { speaker: 'date' as const, text: context.naturalHint, emotion: 'neutral' as const };
    const second = { speaker: 'date' as const, text: context.goal, emotion: 'neutral' as const };
    const answer = (signal: NonNullable<SceneTurn['agenda']>['signal'], evidence: string, line = first, clue = '', socialSignal: NonNullable<SceneTurn['social']>['signal'] = 'none') => scene.applyTurn({ utterances: [line], emotion: 'warm', action: 'none', memory: 'The player responded to the date’s actual wishes.', social: { signal: socialSignal, reason: 'A concrete response to the date’s wishes.', wantsToLeave: false }, agenda: { signal, evidence, clue } }, evidence || 'What would you like from this evening?');
    answer('none', '', first, first.text); scene.acknowledge(first);
    answer('noticed', 'I noticed that you have a preference for how this evening goes.', second, second.text); scene.acknowledge(second);
    answer('understood', `That matters because ${context.rubric.understood}`);
    answer('respected', recovery ? 'You asked me to stop deciding for you, so I accept your answer and leave your choice alone.' : 'I prefer choosing our own food; I accept your different choice without changing it.', first, '', 'curiosity');
    assert.equal(scene.state.evening.agenda?.score, 100);
    assert.equal(scene.state.evening.stance, 'comfortable');
  };
  /** Let the evening carry itself, answering any table story that opens, until the predicate holds. */
  const until = (label: string, predicate: () => boolean, maxSeconds = 300) => {
    const start = scene.state.elapsed;
    while (!predicate()) {
      const e = scene.state.evening;
      assert.ok(scene.state.elapsed - start <= maxSeconds, `${label} did not happen within ${maxSeconds} scene seconds (incident ${e.incident?.event ?? 'none'}, main ${e.main.status}, dessert ${e.dessert.status}, elapsed ${scene.state.elapsed.toFixed(1)})`);
      advance(1 / storyRate); settleStory();
    }
  };
  const waitForIncident = (event: DinnerEvent) => until(`the ${event} interruption`, () => scene.state.evening.incident?.event === event);
  const main = () => { until('service', () => scene.state.evening.main.status === 'served'); assert.equal(scene.state.evening.incident?.event, 'wrong-order'); assert.equal(scene.state.evening.main.bites, 0); action('inspect-ticket'); action('return-order'); for (let i = 0; i < 4; i++) command({ type: 'interact', target: 'meal' }); assert.equal(scene.state.evening.main.bites, 3); };
  const spill = () => { waitForIncident('spilled-drink'); for (let i = 0; i < 3; i++) command({ type: 'interact', target: 'napkin' }); command({ type: 'interact', target: 'glass' }); };
  const dessert = (choice = 'lemon') => {
    until('Eli clearing the plates', () => scene.state.evening.main.status === 'finished');
    assert.equal(scene.state.evening.dessert.status, 'none', 'the dessert offer stays open for the table');
    action('order-dessert', { choice }); until('dessert service', () => scene.state.evening.dessert.status === 'served');
    for (let spoon = 0; spoon < 2; spoon++) command({ type: 'interact', target: 'dessert' });
    waitForIncident('disruptive-diner'); action('ask-quiet');
    until('the end of dessert', () => scene.state.evening.dessert.status === 'finished');
  };
  const check = () => until('the check', () => scene.state.evening.bill.requested);
  const entrance = () => { command({ type: 'interact', target: 'seat' }); move(0, 1, 1.5); };
  return { scene, action, command, advance, move, social, earnConfidence, until, waitForIncident, main, spill, dessert, check, entrance, settleStory };
}

test('complete restaurant night carries itself: Eli serves and clears, three recoveries, a shared dessert, one check and a heard farewell', async () => {
  const f = await setup('mira', 2); try {
    assert.equal(f.scene.state.evening.main.status, 'waiting'); assert.ok(f.scene.state.evening.main.dateDish); f.earnConfidence(); f.main();
    assert.equal(f.scene.state.evening.main.status, 'served', 'the plates stay until Eli clears them');
    f.spill(); assert.equal(f.scene.state.evening.incident, null); f.dessert();
    assert.ok(f.scene.state.evening.main.finishedAt! - f.scene.state.evening.main.servedAt! >= 90, 'the main course ran its own length after the third bite');
    assert.ok(f.scene.state.evening.cues.some(cue => cue.key === 'main-finished' && cue.utterances[0].speaker === 'waiter'), 'Eli offers dessert as he clears');
    assert.equal(f.scene.state.evening.dessert.status, 'finished'); assert.equal(f.scene.state.evening.dessert.chosenBy, 'you'); assert.equal(f.scene.state.evening.dessert.bites, 2);
    assert.equal(Object.keys(f.scene.state.evening.resolutions).length, 3);
    f.check(); assert.equal(f.scene.state.evening.chapter, 'bill'); assert.ok(f.scene.state.evening.cues.some(cue => cue.key === 'bill-requested' && cue.utterances[0].speaker === 'waiter'));
    const stance = f.scene.state.evening.stance; f.action('settle-bill', { choice: 'treat' }); assert.equal(f.scene.state.evening.stance, stance, 'paying must not purchase romance');
    assert.equal(f.scene.state.stage, 'farewell'); assert.equal(f.scene.state.phase, 'playing'); assert.throws(() => f.action('farewell', { choice: 'again' })); f.entrance();
    f.action('farewell', { choice: 'again' }); assert.equal(f.scene.state.evening.farewell.ending?.kind, 'another-evening'); assert.equal(f.scene.state.phase, 'playing', 'do not cut off the goodbye line');
    const last = f.scene.state.evening.cues.at(-1)!; assert.ok(last.utterances.length); f.scene.acknowledge(last.utterances.find(line => line.speaker === 'date')!); f.advance(7); assert.equal(f.scene.state.phase, 'ended');
    assert.ok(f.scene.state.evening.moments.some(m => m.id === 'dessert')); assert.ok(new Set(f.scene.state.evening.cues.map(c => c.id)).size === f.scene.state.evening.cues.length);
    assert.equal(f.scene.state.usage.claudeRequests, 0, 'progression itself makes no API calls');
  } finally { f.scene.free(); }
});

test('an evening with no course actions still reaches the door: Eli nudges, serves and clears, the date fills a silence and picks dessert, the check comes on its own', async () => {
  const f = await setup('dev', 20); try {
    assert.ok(f.scene.state.evening.cues.some(cue => cue.key === 'order-nudge' && cue.utterances[0].speaker === 'waiter'), 'Eli came over while the menu sat unopened');
    f.until('service', () => f.scene.state.evening.main.status === 'served'); assert.equal(f.scene.state.evening.incident?.event, 'wrong-order');
    f.action('inspect-ticket'); f.action('keep-order'); f.spill();
    f.until('Eli clearing the plates', () => f.scene.state.evening.main.status === 'finished', 260);
    assert.ok(f.scene.state.evening.main.finishedAt! - f.scene.state.evening.main.servedAt! >= 199, 'an untouched plate runs the full course clock');
    assert.ok(f.scene.state.evening.beats >= 1, 'the date filled a long silence with a line of their own'); assert.ok(f.scene.state.evening.cues.some(cue => cue.key === 'beat-cold'), 'nobody had spoken, so the line was a plain invitation to start');
    assert.equal(f.scene.state.memory.includes('silence'), false, 'an authored line is not written into the model’s memory');
    assert.equal(f.scene.state.evening.dialogueTurns, 0, 'an authored beat is not a human turn');
    f.until('the date choosing dessert', () => f.scene.state.evening.dessert.status !== 'none');
    assert.equal(f.scene.state.evening.dessert.chosenBy, 'date'); assert.equal(f.scene.state.evening.dessert.choice, CHARACTER_STORIES.dev.preferredDessert);
    assert.ok(f.scene.state.evening.cues.some(cue => cue.key === 'dessert-date-choice'));
    f.until('dessert service', () => f.scene.state.evening.dessert.status === 'served');
    f.waitForIncident('disruptive-diner'); f.action('let-it-go');
    f.until('the end of dessert', () => f.scene.state.evening.dessert.status === 'finished'); assert.equal(f.scene.state.evening.dessert.bites, 0);
    assert.ok(f.scene.state.evening.sharedActivities.includes('dessert'), 'a dessert put on the table was still shared');
    f.check(); f.action('settle-bill', { choice: 'split' }); f.entrance(); f.action('farewell', { choice: 'friendly' });
    assert.equal(f.scene.state.evening.farewell.ending?.kind, 'new-friend'); assert.equal(f.scene.state.usage.claudeRequests, 0);
  } finally { f.scene.free(); }
});

test('repeat pressure allows a real NPC departure while repair supports a distinct second chance', async () => {
  const f = await setup('jules', 1); try {
    f.social('pressure', true); assert.equal(f.scene.state.evening.stance, 'guarded'); assert.equal(f.scene.state.evening.farewell.ending, null);
    f.social('pressure', true); assert.equal(f.scene.state.evening.stance, 'leaving'); assert.equal(f.scene.snapshot().evening.farewell.ending?.kind, 'walked-away'); assert.equal(f.scene.state.phase, 'playing');
    const date = f.scene.state.participants[1].position.slice(); f.advance(3); assert.notDeepEqual(f.scene.state.participants[1].position, date); assert.equal(f.scene.state.phase, 'playing', 'departure line gets a delivery window');
    const goodbye = f.scene.state.evening.cues.at(-1)!.utterances.find(u => u.speaker === 'date')!; f.scene.acknowledge(goodbye); f.advance(8); assert.equal(f.scene.state.phase, 'ended');
  } finally { f.scene.free(); }
  const repaired = await setup(); try { repaired.earnConfidence(); repaired.social('pressure'); assert.equal(repaired.scene.state.evening.agenda?.score, 65); repaired.social('repair'); assert.equal(repaired.scene.state.evening.stance, 'curious', 'an apology reopens conversation before belief is earned'); repaired.earnConfidence(true); repaired.main(); repaired.spill(); repaired.dessert(); repaired.check(); repaired.action('settle-bill', { choice: 'split' }); repaired.entrance(); repaired.action('farewell', { choice: 'again' }); assert.equal(repaired.scene.state.evening.farewell.ending?.kind, 'second-chance'); } finally { repaired.scene.free(); }
  const wordsOnly = await setup(); try { wordsOnly.social('pressure'); wordsOnly.social('repair'); wordsOnly.main(); wordsOnly.spill(); wordsOnly.dessert(); wordsOnly.check(); wordsOnly.action('settle-bill', { choice: 'split' }); wordsOnly.entrance(); wordsOnly.action('farewell', { choice: 'again' }); assert.equal(wordsOnly.scene.state.evening.farewell.ending?.kind, 'new-friend', 'an apology without corroboration does not manufacture a second-chance romance'); } finally { wordsOnly.scene.free(); }
});

test('progression rejects bypasses and social payloads while an unresolved wrong plate holds the whole evening', async () => {
  const f = await setup('mira', 60); try {
    assert.throws(() => f.action('settle-bill', { choice: 'split' })); assert.throws(() => f.action('taste'), /Wait for your dinner/); assert.throws(() => f.action('order-dessert', { choice: 'lemon' })); assert.throws(() => f.action('skip-dessert'));
    assert.throws(() => f.command({ type: 'evening', action: 'finish-main' } as unknown as DinnerCommand), 'the removed course shortcuts are gone');
    f.advance(20); f.settleStory(); f.advance(26 / 60); assert.deepEqual(f.scene.state.events, ['wrong-order']); assert.equal(f.scene.state.evening.incident?.event, 'wrong-order');
    assert.equal(f.scene.state.evening.main.status, 'served', 'Eli never clears a plate nobody has agreed to');
    assert.throws(() => f.action('return-order')); f.action('inspect-ticket'); f.action('keep-order'); assert.equal(f.scene.state.evening.incident, null); f.advance(1 / 60); assert.equal(f.scene.state.evening.incident, null, 'one story second cannot dump old timed events');
    assert.equal(f.scene.state.evening.main.status, 'finished', 'once the plate is agreed on, Eli clears the long-overdue course');
    f.advance(26 / 60); assert.equal(f.scene.snapshot().evening.incident?.event, 'spilled-drink', 'a later interruption waits for a real calm interval');
    const malformed = { utterances: [{ speaker: 'date', text: 'Hello', emotion: 'neutral' }], emotion: 'neutral', action: 'none', memory: '', social: { signal: 'admin', reason: '', wantsToLeave: false } }; assert.throws(() => validateTurn(malformed));
  } finally { f.scene.free(); }
});

test('friendly, reserved and explicit early departures are complete distinct outcomes', async () => {
  for (const [choice, expected] of [['friendly', 'new-friend'], ['goodbye', 'quiet-goodbye'], ['again', 'new-friend']] as const) { const f = await setup(); try { f.main(); f.spill(); f.dessert(); f.check(); f.action('settle-bill', { choice: 'separate' }); f.entrance(); f.action('farewell', { choice }); assert.equal(f.scene.state.evening.farewell.ending?.kind, expected); } finally { f.scene.free(); } }
  for (const choice of ['friendly', 'again'] as const) { const f = await setup(); try { f.social('pressure'); f.main(); f.spill(); f.dessert(); f.check(); f.action('settle-bill', { choice: 'split' }); assert.equal(f.scene.state.evening.stance, 'guarded'); f.entrance(); f.action('farewell', { choice }); assert.equal(f.scene.state.evening.farewell.ending?.kind, 'quiet-goodbye', 'an uncomfortable date can decline friendship as well as another date'); } finally { f.scene.free(); } }
  const f = await setup(); try { f.command({ type: 'pause', paused: true }); f.command({ type: 'finish' }); assert.equal(f.scene.state.phase, 'ended'); assert.equal(f.scene.state.evening.farewell.ending?.kind, 'early-exit'); } finally { f.scene.free(); }
});

test('wrong-order recovery changes the actual served meal while retaining the original order ticket', async () => {
  for (const resolution of ['return-order', 'keep-order'] as const) {
    const f = await setup('mira', 60); try {
      const original = f.scene.state.order; f.advance(46 / 60); assert.equal(f.scene.state.evening.incident?.event, 'wrong-order'); assert.equal(f.scene.state.evening.main.bites, 0);
      const wrong = f.scene.state.evening.main.servedDish; assert.notEqual(wrong, original); assert.ok(MENU.includes(wrong!));
      f.action('inspect-ticket'); f.action(resolution);
      assert.equal(f.scene.state.order, original, 'the original order remains on the ticket');
      assert.equal(f.scene.state.evening.main.servedDish, resolution === 'return-order' ? original : wrong);
      assert.ok(f.scene.state.evening.resolutions['wrong-order']?.includes(resolution === 'return-order' ? original! : wrong!));
    } finally { f.scene.free(); }
  }
});
