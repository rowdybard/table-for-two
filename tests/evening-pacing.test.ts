import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { EveningDirector } from '../server/restaurant/evening';
import { validateCommand } from '../server/restaurant';
import { emptyUsage } from '../server/restaurant/scene';
import { tableFacts } from '../server/restaurant/table-facts';
import { MENU } from '../src/restaurant/content';
import { DESSERTS, EVENING_PACE, createEvening } from '../src/restaurant/evening';
import { BEAT_COLD, BEAT_CUES, CHARACTER_STORIES } from '../src/restaurant/story';
import type { DateId, DinnerState } from '../src/restaurant/types';
import { recordedAtTable } from './helpers/turn-note';

before(async () => { await RAPIER.init(); });

function seatedDinner(dateId: DateId = 'mira', variation = 0): DinnerState {
  return { id: `pacing-${dateId}-${variation}`, generation: 0, mode: 'ai-date', phase: 'playing', dateId, stage: 'seated', elapsed: 0,
    participants: [{ id: 'p1', kind: 'human', name: 'You', position: [0, 0, 3.3] }, { id: 'p2', kind: 'ai', name: 'Mira', position: [0, 0, -2.25] }],
    seated: true, order: null, events: [], emotion: 'neutral', glassRaised: false, memory: '', sessionLimit: 2, usage: emptyUsage(), evening: createEvening(dateId, variation) };
}
const quiet = { allowIncidents: false, allowScenarios: false } as const;
/** Advance one scene second at a time so each clock is observed on the second it fires. */
function run(state: DinnerState, director: EveningDirector, seconds: number, options: Parameters<EveningDirector['step']>[1] = quiet) { for (let i = 0; i < seconds; i++) { state.elapsed += 1; director.step(1, options); } }
const keys = (state: DinnerState) => state.evening.cues.map(cue => cue.key);
const count = (state: DinnerState, key: string) => keys(state).filter(item => item === key).length;
/** One real exchange: the human speaks, the date answers with a statement, and the reply is finished. */
function converse(director: EveningDirector, said = 'It has been a long week.', reply = 'That sounds like a lot. I hope tonight is easier.') {
  director.noteHumanTurn(said);
  director.social({ utterances: [{ speaker: 'date', text: reply, emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'We talked.', social: { signal: 'none', reason: '', wantsToLeave: false } }, said);
  director.replyEnded();
}
function order(state: DinnerState, director: EveningDirector) { state.order = MENU[0]; director.ordered(); }
function serveMain(state: DinnerState, director: EveningDirector) { order(state, director); run(state, director, EVENING_PACE.mainKitchen); assert.equal(state.evening.main.status, 'served'); }

test('Eli nudges a seated guest who has not opened the menu, once, and says nothing once the order is in', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  try {
    director.seated(); run(state, director, EVENING_PACE.orderNudge - 1); assert.equal(count(state, 'order-nudge'), 0);
    run(state, director, 1); assert.equal(count(state, 'order-nudge'), 1); assert.equal(state.evening.cues.at(-1)!.utterances[0].speaker, 'waiter');
    run(state, director, 120); assert.equal(count(state, 'order-nudge'), 1);
    assert.equal(state.evening.beats, 0, 'no authored beat plays before the order is in'); assert.equal(state.usage.claudeRequests, 0);
  } finally { director.free(); }
  const prompt = seatedDinner('jules'), eager = new EveningDirector(prompt);
  try { eager.seated(); order(prompt, eager); run(prompt, eager, 200); assert.equal(count(prompt, 'order-nudge'), 0); } finally { eager.free(); }
});

test('the main course is cleared by Eli on the course clock, after rested cutlery, or a while after the diner has eaten', () => {
  const clock = seatedDinner(), byClock = new EveningDirector(clock);
  try {
    serveMain(clock, byClock); assert.equal(count(clock, 'main-served'), 1);
    run(clock, byClock, EVENING_PACE.mainCourse - 1); assert.equal(clock.evening.main.status, 'served');
    run(clock, byClock, 1); assert.equal(clock.evening.main.status, 'finished'); assert.equal(clock.evening.main.finishedAt, clock.elapsed);
    const offer = clock.evening.cues.at(-1)!; assert.equal(offer.key, 'main-finished'); assert.equal(offer.utterances[0].speaker, 'waiter'); assert.equal(offer.utterances.at(-1)!.speaker, 'date');
    assert.equal(clock.evening.chapter, 'dessert'); assert.equal(clock.stage, 'dessert'); assert.equal(clock.evening.dessert.offeredAt, clock.elapsed);
    assert.throws(() => byClock.action({ type: 'evening', action: 'taste' }, 1000), /cleared the plates/);
  } finally { byClock.free(); }
  const rested = seatedDinner(), byCutlery = new EveningDirector(rested);
  try {
    serveMain(rested, byCutlery); byCutlery.tabletop.action('arrange-cutlery'); assert.equal(rested.evening.tabletop!.cutleryCrossed, true);
    run(rested, byCutlery, 30); byCutlery.tabletop.action('arrange-cutlery'); run(rested, byCutlery, 40); assert.equal(rested.evening.main.status, 'served', 'picking the cutlery back up keeps the course going');
    // Eli notices the rested cutlery on his next pass, so the clock starts one step after the action.
    byCutlery.tabletop.action('arrange-cutlery'); run(rested, byCutlery, EVENING_PACE.mainAfterCutleryRested); assert.equal(rested.evening.main.status, 'served');
    run(rested, byCutlery, 1); assert.equal(rested.evening.main.status, 'finished');
  } finally { byCutlery.free(); }
  const eaten = seatedDinner(), byEating = new EveningDirector(eaten);
  try {
    serveMain(eaten, byEating); for (let bite = 0; bite < 3; bite++) byEating.action({ type: 'evening', action: 'taste' }, 1000 + bite * 600);
    assert.equal(eaten.evening.main.bites, 3); assert.ok(eaten.evening.moments.some(moment => moment.id === 'dinner-tasted'));
    run(eaten, byEating, EVENING_PACE.mainAfterEating - 1); assert.equal(eaten.evening.main.status, 'served');
    run(eaten, byEating, 1); assert.equal(eaten.evening.main.status, 'finished');
  } finally { byEating.free(); }
  const standing = seatedDinner(), whileAway = new EveningDirector(standing);
  try {
    serveMain(standing, whileAway); standing.seated = false; run(standing, whileAway, EVENING_PACE.mainCourse + 30); assert.equal(standing.evening.main.status, 'served', 'Eli does not clear a table whose guest has stepped away');
    standing.seated = true; run(standing, whileAway, 1); assert.equal(standing.evening.main.status, 'finished');
  } finally { whileAway.free(); }
});

test('dessert: the date picks their favourite when nobody chooses, declines when the evening has cooled, and the plate finishes itself before the check', () => {
  for (const dateId of ['mira', 'jules', 'dev'] as const) {
    const state = seatedDinner(dateId), director = new EveningDirector(state);
    try {
      serveMain(state, director); run(state, director, EVENING_PACE.mainCourse);
      run(state, director, EVENING_PACE.dessertDecision - 1); assert.equal(state.evening.dessert.status, 'none');
      run(state, director, 1); assert.equal(state.evening.dessert.status, 'waiting'); assert.equal(state.evening.dessert.chosenBy, 'date');
      assert.equal(state.evening.dessert.choice, CHARACTER_STORIES[dateId].preferredDessert); assert.equal(count(state, 'dessert-date-choice'), 1);
      assert.ok(tableFacts(state).some(fact => fact.includes(DESSERTS.find(dessert => dessert.id === state.evening.dessert.choice)!.name.toLowerCase())), 'the date’s pick is a table fact the model cannot overwrite');
      run(state, director, EVENING_PACE.dessertKitchen); assert.equal(state.evening.dessert.status, 'served'); assert.equal(count(state, 'dessert-served'), 1);
      run(state, director, EVENING_PACE.dessertTalk); assert.ok(state.evening.sharedActivities.includes('dessert')); assert.ok(state.evening.moments.some(moment => moment.id === 'dessert')); assert.equal(count(state, 'dessert-shared'), 1);
      run(state, director, EVENING_PACE.dessertCourse - EVENING_PACE.dessertTalk - 1); assert.equal(state.evening.dessert.status, 'served');
      run(state, director, 1); assert.equal(state.evening.dessert.status, 'finished'); assert.equal(state.evening.bill.requested, false);
      run(state, director, EVENING_PACE.checkDelay - 1); assert.equal(state.evening.bill.requested, false);
      run(state, director, 1); assert.equal(state.evening.bill.requested, true); assert.equal(state.evening.chapter, 'bill'); assert.equal(state.evening.bill.arrivedAt, state.elapsed); assert.equal(count(state, 'bill-requested'), 1);
      assert.throws(() => director.action({ type: 'evening', action: 'order-dessert', choice: 'lemon' }, 9000), /already been decided/);
      director.action({ type: 'evening', action: 'settle-bill', choice: 'split' }, 9500); assert.equal(state.evening.chapter, 'farewell'); assert.equal(state.stage, 'farewell');
      assert.equal(state.usage.claudeRequests, 0);
    } finally { director.free(); }
  }
  const cooled = seatedDinner(), guarded = new EveningDirector(cooled);
  try {
    serveMain(cooled, guarded); run(cooled, guarded, EVENING_PACE.mainCourse); cooled.evening.stance = 'guarded';
    run(cooled, guarded, EVENING_PACE.dessertDecision); assert.equal(cooled.evening.dessert.status, 'skipped'); assert.equal(cooled.evening.dessert.chosenBy, 'date'); assert.equal(count(cooled, 'dessert-skipped'), 1);
    run(cooled, guarded, EVENING_PACE.checkDelay); assert.equal(cooled.evening.bill.requested, true);
  } finally { guarded.free(); }
  const chosen = seatedDinner(), byPlayer = new EveningDirector(chosen);
  try {
    serveMain(chosen, byPlayer); assert.throws(() => byPlayer.action({ type: 'evening', action: 'order-dessert', choice: 'berries' }, 500), /plates are cleared/);
    run(chosen, byPlayer, EVENING_PACE.mainCourse); assert.throws(() => byPlayer.action({ type: 'evening', action: 'order-dessert', choice: 'cake' }, 600), /from the menu/);
    byPlayer.action({ type: 'evening', action: 'order-dessert', choice: 'berries' }, 700); assert.equal(chosen.evening.dessert.chosenBy, 'you'); assert.equal(count(chosen, 'dessert-ordered'), 1);
    run(chosen, byPlayer, EVENING_PACE.dessertKitchen); assert.equal(chosen.evening.dessert.status, 'served');
    byPlayer.action({ type: 'evening', action: 'taste' }, 2000); byPlayer.action({ type: 'evening', action: 'taste' }, 2600); assert.equal(chosen.evening.dessert.bites, 2);
    run(chosen, byPlayer, 1); assert.ok(chosen.evening.sharedActivities.includes('dessert'), 'the first spoonful starts the shared moment');
    run(chosen, byPlayer, EVENING_PACE.dessertAfterEating - 1); assert.equal(chosen.evening.dessert.status, 'finished', 'two spoonfuls end dessert well before the course clock');
    assert.throws(() => byPlayer.action({ type: 'evening', action: 'settle-bill', choice: 'treat' }, 3000), /Wait for the check/);
  } finally { byPlayer.free(); }
  const shared = seatedDinner(), held = new EveningDirector(shared);
  try {
    serveMain(shared, held); run(shared, held, EVENING_PACE.mainCourse); held.action({ type: 'evening', action: 'skip-dessert' }, 800);
    run(shared, held, EVENING_PACE.checkDelay + 30, { ...quiet, holdBill: true }); assert.equal(shared.evening.bill.requested, false, 'a shared table keeps the check back for the other pair');
    run(shared, held, 1); assert.equal(shared.evening.bill.requested, true);
  } finally { held.free(); }
});

test('the date breaks long silences with authored lines: paced by the variation, distinct, never remembered, never a human turn, and capped', () => {
  for (const variation of [0, 2]) {
    const state = seatedDinner('mira', variation), director = new EveningDirector(state);
    try {
      director.seated(); converse(director); order(state, director);
      // While the kitchen works the silence is shorter than the cook's 45 seconds, so the waiting line is reachable.
      run(state, director, EVENING_PACE.beatSilenceWaiting - 1); assert.equal(state.evening.beats, 0);
      run(state, director, 1); assert.equal(state.evening.beats, 1); assert.equal(state.evening.cues.at(-1)!.key, BEAT_CUES.waiting[0]); assert.equal(state.evening.cues.at(-1)!.utterances[0].speaker, 'date');
      assert.equal(state.evening.dialogueTurns, 1, 'an authored beat is never a human turn'); assert.equal(state.usage.claudeRequests, 0);
      assert.ok(!state.memory.includes('silence') && !tableFacts(state).some(fact => /silence/i.test(fact)), 'an authored line is not a memory');
      const waitingBeatAt = state.elapsed, silence = EVENING_PACE.beatSilence + variation * 17;
      run(state, director, EVENING_PACE.mainKitchen - waitingBeatAt); assert.equal(state.evening.main.status, 'served'); const served = state.elapsed;
      // The next line waits for both the beat spacing and a fresh silence after the food arrives.
      const first = Math.max(served + silence, waitingBeatAt + EVENING_PACE.beatSpacing);
      run(state, director, first - state.elapsed - 1); assert.equal(state.evening.beats, 1, 'two beats keep their distance');
      run(state, director, 1); assert.equal(state.evening.beats, 2); assert.equal(state.evening.cues.at(-1)!.key, BEAT_CUES.eating[0]);
      const second = first + Math.max(EVENING_PACE.beatSpacing, silence);
      run(state, director, second - state.elapsed - 1); assert.equal(state.evening.beats, 2);
      run(state, director, 1); assert.equal(state.evening.beats, 3); assert.equal(state.evening.cues.at(-1)!.key, BEAT_CUES.eating[1]);
      assert.ok(state.elapsed - served < EVENING_PACE.mainCourse, 'both eating beats fit inside an untouched main course');
      run(state, director, EVENING_PACE.mainCourse); assert.equal(state.evening.main.status, 'finished');
      const afterClear = state.evening.beats;
      run(state, director, 400); assert.ok(state.evening.beats >= afterClear); assert.ok(state.evening.beats <= EVENING_PACE.beatsPerEvening);
      assert.ok(state.evening.bill.requested, 'the evening still reaches the check on its own');
      const spoken = state.evening.cues.filter(cue => cue.key.startsWith('beat-')).map(cue => cue.key);
      assert.equal(new Set(spoken).size, spoken.length, 'no authored line repeats');
      const beforeQuiet = state.evening.beats; run(state, director, 300); assert.equal(state.evening.beats, beforeQuiet, 'no beats once the check is on the table');
    } finally { director.free(); }
  }
  const talkative = seatedDinner(), director = new EveningDirector(talkative);
  try {
    director.seated(); order(talkative, director); run(talkative, director, EVENING_PACE.beatSilenceWaiting - 5);
    converse(director, 'I was saying something.', 'Go on, I am listening.');
    run(talkative, director, 10); assert.equal(talkative.evening.beats, 0, 'a real exchange resets the silence');
    talkative.evening.beats = EVENING_PACE.beatsPerEvening; run(talkative, director, 150); assert.equal(count(talkative, BEAT_CUES.eating[0]), 0, 'the evening’s beats are finite');
  } finally { director.free(); }
});

test('a table where nobody has spoken hears one plain invitation, and the ordinary beats take over once they answer', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  try {
    director.seated(); order(state, director);
    run(state, director, EVENING_PACE.beatSilenceWaiting - 1); assert.equal(state.evening.beats, 0);
    run(state, director, 1); assert.equal(state.evening.beats, 1);
    const cue = state.evening.cues.at(-1)!; assert.equal(cue.key, BEAT_COLD); assert.equal(cue.utterances.length, 1); assert.equal(cue.utterances[0].speaker, 'date');
    assert.equal(state.evening.dialogueTurns, 0); assert.equal(state.usage.claudeRequests, 0);
    assert.equal(director.pendingQuestion, cue.utterances[0].text, 'the invitation is an open question until the human answers');
    converse(director, 'Mostly work, honestly.', 'That sounds like a lot.');
    assert.equal(director.pendingQuestion, null, 'the answer closes it'); assert.equal(state.evening.dialogueTurns, 1);
    run(state, director, 260);
    assert.equal(count(state, BEAT_COLD), 1, 'the invitation is made once'); assert.equal(count(state, BEAT_CUES.eating[0]), 1, 'the ordinary silence breakers follow a real exchange');
  } finally { director.free(); }
  const silent = seatedDinner('jules'), mute = new EveningDirector(silent);
  try {
    mute.seated(); order(silent, mute); run(silent, mute, 400);
    assert.equal(silent.evening.beats, 1, 'with nobody speaking, the date does not keep guessing at what they are thinking');
    assert.deepEqual(silent.evening.cues.filter(cue => cue.key.startsWith('beat-')).map(cue => cue.key), [BEAT_COLD]);
  } finally { mute.free(); }
});

test('the date does not break a silence they made themselves by asking a question', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  try {
    director.seated(); order(state, director); run(state, director, 20);
    converse(director, 'Hello.', 'Nice to meet you. What do you usually order here?');
    run(state, director, 125); assert.equal(state.evening.main.status, 'served'); assert.equal(state.evening.beats, 0, 'the date asked, so the date waits');
    converse(director, 'Probably the pasta.', 'Good choice.');
    run(state, director, EVENING_PACE.beatSilence - 1); assert.equal(state.evening.beats, 0);
    run(state, director, 1); assert.equal(state.evening.beats, 1); assert.equal(state.evening.cues.at(-1)!.key, BEAT_CUES.eating[0]);
  } finally { director.free(); }
});

test('the server rejects the removed course shortcuts and table games while accepting the remaining evening commands', () => {
  for (const action of ['finish-main', 'request-bill', 'serve-dessert', 'finish-dessert', 'start-coasters']) assert.throws(() => validateCommand({ type: 'evening', action }), action);
  for (const command of [{ type: 'coaster-shot', angle: 0, power: .5 }, { type: 'napkin', points: [[0, 0]], complete: true }, { type: 'interact', target: 'coasters' }, { type: 'evening', action: 'taste', extra: true }, { type: 'evening', action: 'order-dessert', choice: 'x'.repeat(130) }]) assert.throws(() => validateCommand(command), JSON.stringify(command));
  assert.equal(validateCommand({ type: 'evening', action: 'order-dessert', choice: 'lemon' }).type, 'evening');
  assert.equal(validateCommand({ type: 'evening', action: 'skip-dessert' }).type, 'evening');
  assert.equal(validateCommand({ type: 'interact', target: 'dessert' }).type, 'interact');
  assert.equal(validateCommand({ type: 'interact', target: 'bill' }).type, 'interact');
});

test('a live conversation is never talked over by a scripted silence breaker or aside', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  try {
    director.seated(); order(state, director);
    // The human keeps talking every 15 seconds from the order to well past the cleared plates.
    for (let i = 0; i * 15 < EVENING_PACE.mainKitchen + EVENING_PACE.mainCourse + 60; i++) { director.noteHumanTurn('Go on.'); run(state, director, 15); }
    assert.equal(state.evening.beats, 0, 'no silence breaker interrupts an ongoing conversation');
    // Eli still serves and clears on his clock, but the date's pre-written asides are held back mid-exchange.
    assert.equal(state.evening.main.status, 'finished');
    for (const key of ['main-served', 'main-finished']) {
      const cues = state.evening.cues.filter(cue => cue.key === key); assert.equal(cues.length, 1, key);
      assert.deepEqual(cues[0].utterances.map(line => line.speaker), ['waiter'], key);
    }
  } finally { director.free(); }
  const silent = seatedDinner(), quietDirector = new EveningDirector(silent);
  try {
    quietDirector.seated(); serveMain(silent, quietDirector); run(silent, quietDirector, EVENING_PACE.beatSilence + 40);
    assert.ok(silent.evening.cues.some(cue => cue.key === BEAT_COLD), 'a genuinely quiet table still gets its authored line');
  } finally { quietDirector.free(); }
  const cold = seatedDinner(), coldDirector = new EveningDirector(cold);
  try {
    coldDirector.seated(); cold.evening.stance = 'guarded'; serveMain(cold, coldDirector); run(cold, coldDirector, EVENING_PACE.beatSilence + 120);
    assert.equal(cold.evening.beats, 0, 'a guarded date does not chirp a warm scripted line into the silence');
  } finally { coldDirector.free(); }
});
