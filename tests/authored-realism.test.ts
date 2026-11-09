import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { EveningDirector, namedDessertIn } from '../server/restaurant/evening';
import { emptyUsage } from '../server/restaurant/scene';
import { tableFacts } from '../server/restaurant/table-facts';
import { AUTHORED_UTTERANCES } from '../src/restaurant/authored';
import { createBlindDate, getBlindDateCue } from '../src/restaurant/blind-date';
import { DATES, MENU } from '../src/restaurant/content';
import { DESSERTS, EVENING_PACE, createEvening } from '../src/restaurant/evening';
import { BEAT_COLD, CHARACTER_STORIES, STORY_CUE_KEYS, STORY_CUE_VARIANTS, getStoryCue } from '../src/restaurant/story';
import type { DateId, DinnerState } from '../src/restaurant/types';

before(async () => { await RAPIER.init(); });

const NAMES: Record<DateId, string> = { mira: 'Mira', jules: 'Jules', dev: 'Dev' };
function seatedDinner(dateId: DateId = 'mira', variation = 0): DinnerState {
  return { id: `realism-${dateId}-${variation}`, generation: 0, mode: 'ai-date', phase: 'playing', dateId, stage: 'seated', elapsed: 0,
    participants: [{ id: 'p1', kind: 'human', name: 'You', position: [0, 0, 3.3] }, { id: 'p2', kind: 'ai', name: NAMES[dateId], position: [0, 0, -2.25] }],
    seated: true, order: null, events: [], emotion: 'neutral', glassRaised: false, memory: '', sessionLimit: 2, usage: emptyUsage(), evening: createEvening(dateId, variation) };
}
const quiet = { allowIncidents: false, allowScenarios: false } as const;
const open = { allowScenarios: false } as const;
function run(state: DinnerState, director: EveningDirector, seconds: number, options: Parameters<EveningDirector['step']>[1] = quiet) { for (let i = 0; i < seconds; i++) { state.elapsed += 1; director.step(1, options); } }
const count = (state: DinnerState, key: string) => state.evening.cues.filter(cue => cue.key === key).length;
const incidentOf = (state: DinnerState): string | undefined => state.evening.incident?.event;
const lastCue = (state: DinnerState, key: string) => state.evening.cues.filter(cue => cue.key === key).at(-1);
const reply = (text: string): Parameters<EveningDirector['social']>[0] => ({ utterances: [{ speaker: 'date', text, emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'We talked.', social: { signal: 'none', reason: '', wantsToLeave: false } });
/** One real exchange: the human speaks, the date answers with a statement, and the reply is finished. */
function converse(director: EveningDirector, said: string, answer = 'That sounds good.', speakerId?: string) { director.noteHumanTurn(said, speakerId); director.social(reply(answer), said); director.replyEnded(); }
function serveMain(state: DinnerState, director: EveningDirector) { state.order = MENU[0]; director.ordered(); run(state, director, EVENING_PACE.mainKitchen); assert.equal(state.evening.main.status, 'served'); }
/** The plates are cleared and Eli's dessert offer is open. */
function toOffer(dateId: DateId = 'mira', humanId?: string) {
  const state = seatedDinner(dateId), director = new EveningDirector(state, humanId ? { humanId } : {});
  director.seated(); serveMain(state, director); run(state, director, EVENING_PACE.mainCourse);
  assert.equal(state.evening.main.status, 'finished'); assert.equal(state.evening.dessert.status, 'none');
  return { state, director };
}

test('only one clearly named dessert counts, and a negated or ambiguous mention decides nothing', () => {
  assert.equal(namedDessertIn('Let’s get the lemon one.'), 'lemon');
  assert.equal(namedDessertIn('I would love the chocolate fondant.'), 'chocolate');
  assert.equal(namedDessertIn('Strawberries, please.'), 'berries');
  assert.equal(namedDessertIn('Not the lemon, I had it last week.'), null);
  assert.equal(namedDessertIn('Lemon or chocolate?'), null);
  assert.equal(namedDessertIn('What is in the fondant?'), 'chocolate', 'asking about a dessert still names it, and the date orders it only if nobody says otherwise');
  assert.equal(namedDessertIn('That was a lovely main.'), null);
});

test('a dessert the human names during the offer is the one the date orders, and the order says so', () => {
  const { state, director } = toOffer('mira');
  assert.equal(CHARACTER_STORIES.mira.preferredDessert, 'chocolate');
  run(state, director, 5); converse(director, 'I think I would go for the lemon one.', 'Lemon sounds lovely.');
  run(state, director, EVENING_PACE.dessertDecision);
  assert.equal(state.evening.dessert.status, 'waiting'); assert.equal(state.evening.dessert.choice, 'lemon'); assert.equal(state.evening.dessert.chosenBy, 'date');
  const pick = lastCue(state, 'dessert-date-choice')!.utterances.find(line => line.speaker === 'date')!;
  assert.match(pick.text, /^Lemon posset it is, then/); assert.doesNotMatch(pick.text, /\?|eyeing|objection/);
  assert.ok(tableFacts(state).some(fact => /lemon/.test(fact) && /said they wanted/.test(fact)), 'the pick is a table fact, and it says who suggested it');
  run(state, director, EVENING_PACE.dessertKitchen + EVENING_PACE.dessertTalk);
  assert.match(state.evening.moments.find(moment => moment.id === 'dessert')!.description, /the one you asked for/);
  assert.equal(state.usage.claudeRequests, 0);
});

test('with nothing named the date picks their own favourite, and an ambiguous mention does not count', () => {
  const { state, director } = toOffer('jules');
  run(state, director, 5); converse(director, 'Is it the chocolate or the strawberries that you like?', 'Neither, really.');
  run(state, director, EVENING_PACE.dessertDecision);
  assert.equal(state.evening.dessert.choice, 'lemon', 'Jules goes with their own favourite');
  const pick = lastCue(state, 'dessert-date-choice')!.utterances.find(line => line.speaker === 'date')!;
  assert.doesNotMatch(pick.text, /^Lemon posset it is, then/);
  assert.ok(tableFacts(state).some(fact => /when nobody picked/.test(fact)));
});

test('a human who says they are done with dessert gets the check, not the date’s pick', () => {
  const { state, director } = toOffer('dev');
  run(state, director, 5); converse(director, 'No dessert for me, I am stuffed.', 'Fair enough.');
  run(state, director, EVENING_PACE.dessertDecision);
  assert.equal(state.evening.dessert.status, 'skipped'); assert.equal(state.evening.dessert.chosenBy, 'you'); assert.equal(count(state, 'dessert-skipped'), 1); assert.equal(count(state, 'dessert-date-choice'), 0);
  run(state, director, EVENING_PACE.checkDelay); assert.equal(state.evening.bill.requested, true);
  const changed = toOffer('dev');
  run(changed.state, changed.director, 3); converse(changed.director, 'Maybe the berries, actually.'); converse(changed.director, 'No, I am too full for dessert after all.');
  run(changed.state, changed.director, EVENING_PACE.dessertDecision);
  assert.equal(changed.state.evening.dessert.status, 'skipped', 'the last thing they said wins');
});

test('words said before the offer, or by the friend in a shared room, never choose this couple’s dessert', () => {
  const early = seatedDinner('mira'), director = new EveningDirector(early);
  director.seated(); serveMain(early, director); converse(director, 'I always get the lemon after dinner.');
  run(early, director, EVENING_PACE.mainCourse); run(early, director, EVENING_PACE.dessertDecision);
  assert.equal(early.evening.dessert.choice, 'chocolate', 'talk before Eli’s offer is only talk');
  const { state, director: paired } = toOffer('mira', 'p1');
  run(state, paired, 5); converse(paired, 'The lemon one for me.', 'Nice.', 'p2');
  run(state, paired, EVENING_PACE.dessertDecision);
  assert.equal(state.evening.dessert.choice, 'chocolate', 'the other human’s words belong to the other couple');
  const own = toOffer('mira', 'p1');
  own.director.noteHumanTurn('The lemon one for me.', 'p1'); own.director.replyEnded();
  run(own.state, own.director, EVENING_PACE.dessertDecision);
  assert.equal(own.state.evening.dessert.choice, 'lemon');
});

test('the date’s dessert pick waits while the human is talking, for the reply and a breath after it, and never past the reply cap', () => {
  const { state, director } = toOffer('jules');
  run(state, director, 30); director.noteHumanTurn('So tell me about your sister.');
  run(state, director, 30); assert.equal(state.evening.dessert.status, 'none', 'the offer window has passed but the date is still answering');
  director.replyEnded(); run(state, director, 5); assert.equal(state.evening.dessert.status, 'none', 'a short breath after the reply');
  run(state, director, 1); assert.equal(state.evening.dessert.status, 'waiting');
  const stuck = toOffer('jules');
  run(stuck.state, stuck.director, 30); stuck.director.noteHumanTurn('Hello?');
  run(stuck.state, stuck.director, 69); assert.equal(stuck.state.evening.dessert.status, 'none');
  run(stuck.state, stuck.director, 1); assert.equal(stuck.state.evening.dessert.status, 'waiting', 'a reply that never finishes cannot hold the table for ever');
});

test('a spill waits for the exchange to settle, and a wrong plate still arrives with the food', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  director.seated(); state.order = MENU[0]; director.ordered(); run(state, director, EVENING_PACE.mainKitchen); assert.equal(state.evening.main.status, 'served');
  run(state, director, EVENING_PACE.spillAfterService - 5); director.noteHumanTurn('And then what happened?');
  run(state, director, 60, open); assert.equal(state.evening.incident, null, 'the glass does not go over while the date is answering');
  director.replyEnded(); run(state, director, 5, open); assert.equal(state.evening.incident, null);
  run(state, director, 1, open); assert.equal(incidentOf(state), 'spilled-drink');
  const capped = seatedDinner(), stuck = new EveningDirector(capped);
  stuck.seated(); capped.order = MENU[0]; stuck.ordered(); run(capped, stuck, EVENING_PACE.mainKitchen);
  run(capped, stuck, EVENING_PACE.spillAfterService - 5); stuck.noteHumanTurn('Hello?');
  run(capped, stuck, 69, open); assert.equal(capped.evening.incident, null); run(capped, stuck, 1, open);
  assert.equal(incidentOf(capped), 'spilled-drink', 'the 70 second reply cap lets the evening move again');
  const plate = seatedDinner('jules'), service = new EveningDirector(plate);
  service.seated(); plate.order = MENU[0]; service.ordered(); run(plate, service, EVENING_PACE.mainKitchen - 1); service.noteHumanTurn('Go on.');
  run(plate, service, 1, open); assert.equal(plate.evening.main.status, 'served'); assert.equal(incidentOf(plate), 'wrong-order', 'service is a physical event and does not wait for the talk');
});

test('a table story opens after the talk settles, not on top of it', () => {
  const state = { ...seatedDinner(), elapsed: 300, order: MENU[0], stage: 'dining' as const };
  state.evening.main.status = 'served'; state.evening.main.servedDish = MENU[0]; state.evening.main.servedAt = 100;
  state.evening.resolutions['wrong-order'] = 'Checked earlier.'; state.evening.resolutions['spilled-drink'] = 'Dried earlier.';
  const director = new EveningDirector(state, { scenarioId: 'family-visit' });
  director.noteHumanTurn('Do you have any family nearby?'); director.step(.016); assert.equal(state.evening.scenario?.phase, 'dormant');
  state.elapsed += 30; director.step(.016, open); assert.equal(state.evening.scenario?.phase, 'dormant', 'the reply is still on its way');
  director.replyEnded(); state.elapsed += 5; director.step(.016); assert.equal(state.evening.scenario?.phase, 'dormant');
  state.elapsed += 1; director.step(.016); assert.equal(state.evening.scenario?.phase, 'active');
});

test('a taste mid-conversation keeps the date’s pre-written remark out of the exchange', () => {
  const talking = seatedDinner(), director = new EveningDirector(talking);
  director.seated(); serveMain(talking, director); director.noteHumanTurn('How was your week?');
  director.action({ type: 'evening', action: 'taste' }, 1000);
  assert.equal(count(talking, 'taste'), 0); assert.equal(talking.evening.main.bites, 1);
  const silent = seatedDinner(), still = new EveningDirector(silent);
  still.seated(); serveMain(silent, still); run(silent, still, 20);
  still.action({ type: 'evening', action: 'taste' }, 1000);
  assert.equal(count(silent, 'taste'), 1); assert.equal(lastCue(silent, 'taste')!.utterances[0].speaker, 'date');
});

test('the canned thank-you after an apology only plays after real upset, and never on top of the model’s own acknowledgment', () => {
  const calm = seatedDinner(), easy = new EveningDirector(calm);
  easy.seated(); easy.action({ type: 'evening', action: 'apologize' }, 1000);
  assert.equal(count(calm, 'repair'), 0, 'nothing needed repairing');
  const upset = seatedDinner(), director = new EveningDirector(upset);
  director.seated(); upset.evening.stance = 'guarded'; director.action({ type: 'evening', action: 'apologize' }, 1000);
  assert.equal(count(upset, 'repair'), 1); assert.notEqual(upset.evening.stance, 'guarded');
  const answered = seatedDinner(), model = new EveningDirector(answered);
  model.seated(); answered.evening.stance = 'guarded';
  model.noteHumanTurn('I am sorry about that.');
  model.social({ ...reply('Thank you for saying so. Let’s start again.'), social: { signal: 'repair', reason: 'They apologised.', wantsToLeave: false } }, 'I am sorry about that.');
  assert.equal(count(answered, 'repair'), 0, 'the reply the model just gave is the acknowledgment'); assert.notEqual(answered.evening.stance, 'guarded');
});

test('a wrong plate is never the date’s own dish, for any dish the human orders and any evening', () => {
  for (const variation of [0, 1, 2, 3, 4, 5]) for (const dateId of ['mira', 'jules', 'dev'] as const) for (const dish of MENU) {
    const state = seatedDinner(dateId, variation), director = new EveningDirector(state);
    director.seated(); state.order = dish; director.ordered(); run(state, director, EVENING_PACE.mainKitchen, open);
    assert.equal(incidentOf(state), 'wrong-order', `${dateId}/${variation}/${dish}`);
    assert.notEqual(state.evening.main.servedDish, dish); assert.notEqual(state.evening.main.servedDish, state.evening.main.dateDish);
  }
});

test('a care action is a notebook moment, not a second copy in the memory a model reply rewrites', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  director.seated(); director.action({ type: 'evening', action: 'request-water' }, 1000);
  assert.ok(state.evening.moments.some(moment => /Asked Eli for fresh water/.test(moment.description)));
  assert.equal(state.memory, '');
});

test('the greeting is the opening the model is seeded with, and only a greeting that asks something waits for an answer', () => {
  for (const date of DATES) {
    const welcome = getStoryCue('welcome', date.id);
    assert.equal(welcome[0].speaker, 'date'); assert.equal(welcome[0].text, date.opening, `${date.id}: the spoken greeting and the model’s seeded opening are one line`);
    assert.equal(welcome[1].speaker, 'waiter');
    const state = seatedDinner(date.id), director = new EveningDirector(state);
    assert.equal(state.evening.cues[0].utterances[0].text, date.opening);
    const asks = /\?/.test(date.opening);
    assert.equal(director.pendingQuestion, asks ? date.opening : null, date.id);
    director.noteHumanTurn('Hi, good to meet you.'); assert.equal(director.pendingQuestion, null);
  }
  assert.ok(DATES.some(date => /\?/.test(date.opening)) && DATES.some(date => !/\?/.test(date.opening)), 'the openers keep their own shapes');
});

test('scripted lines stay plain until something was earned, and a cooled date still hears Eli', () => {
  for (const date of DATES) {
    const plain = getStoryCue('dessert-shared', date.id, { reserved: true })[0].text, warm = getStoryCue('dessert-shared', date.id)[0].text;
    assert.notEqual(plain, warm); assert.match(plain, /worth saving room for/); assert.doesNotMatch(plain, /putting off|I keep|first date/i);
    assert.deepEqual(getStoryCue('bill-requested', date.id, { reserved: true }).map(line => line.speaker), ['waiter'], 'Eli brings the check and the date says nothing about an evening that earned nothing');
    assert.deepEqual(getStoryCue('bill-requested', date.id).map(line => line.speaker), ['waiter', 'date']);
    assert.notEqual(getStoryCue('farewell-invite', date.id, { reserved: true })[0].text, getStoryCue('farewell-invite', date.id)[0].text);
    assert.notEqual(getStoryCue('ending-new-friend', date.id, { reserved: true })[0].text, getStoryCue('ending-new-friend', date.id)[0].text);
    for (const resolution of ['guarded', 'hurt', 'leaving']) {
      for (const key of ['main-served', 'dessert-served', 'bill-requested', 'main-finished', 'spill-fixed', 'diner-quiet']) {
        const lines = getStoryCue(key, date.id, { resolution }), base = getStoryCue(key, date.id);
        assert.deepEqual(lines.filter(line => line.speaker !== 'date'), base.filter(line => line.speaker !== 'date'), `${date.id}/${resolution}/${key}: Eli’s and the neighbour’s lines still land`);
        assert.ok(lines.some(line => line.speaker === 'date') || key === 'spill-fixed' || key === 'diner-quiet', `${date.id}/${key}`);
      }
      assert.deepEqual(getStoryCue('main-served', date.id, { resolution }).map(line => line.speaker), ['waiter', 'date'], 'the plain thank-you follows the plate');
      assert.equal(getStoryCue('main-served', date.id, { resolution })[1].text, 'Thank you.');
    }
  }
});

test('the date answers the dish the human ordered and the plates Eli clears', () => {
  for (const date of DATES) {
    const same = getStoryCue('ordered', date.id, { humanDish: CHARACTER_STORIES[date.id].preferredMain });
    assert.ok(same.some(line => line.speaker === 'waiter' && /both of those/.test(line.text)), 'Eli puts both orders through');
    assert.match(same[0].text, /same/i, 'a shared choice is noticed');
    assert.equal(getStoryCue('ordered', date.id, { humanDish: 'Wild mushroom risotto', dish: 'Roasted tomato rigatoni' })[0].text, `Nice, the mushroom risotto. ${getStoryCue('ordered', date.id, { dish: 'Roasted tomato rigatoni' })[0].text}`);
    const offers = [0, 1, 3, undefined].map(bites => getStoryCue('main-finished', date.id, { bites })[0].text);
    assert.match(offers[0], /take these away/); assert.match(offers[1], /Not hungry/); assert.match(offers[2], /All finished/); assert.equal(offers[3], offers[2]);
    for (const text of offers) assert.match(text, /lemon posset, chocolate fondant, or strawberries and cream/, 'the menu is always read out');
  }
});

test('every authored line the director can now play is enumerated for the optional clip generator', () => {
  const spoken = new Set(AUTHORED_UTTERANCES.map(line => `${line.speaker}|${line.text}`));
  assert.ok(STORY_CUE_KEYS.includes(BEAT_COLD));
  for (const date of DATES) {
    assert.ok(AUTHORED_UTTERANCES.some(line => line.cue === BEAT_COLD && line.dateId === date.id), `${date.id} has a cold beat row`);
    const contexts = [
      ...DESSERTS.map(dessert => ({ choice: dessert.id, named: true })), { reserved: true }, { bites: 0 }, { bites: 1 }, { bites: 3 }, { resolution: 'guarded' },
      ...MENU.map(humanDish => ({ humanDish })), ...MENU.map(dish => ({ dish })),
    ];
    for (const key of STORY_CUE_KEYS) for (const context of contexts) for (const line of getStoryCue(key, date.id, context)) assert.ok(spoken.has(`${line.speaker}|${line.text}`), `${date.id}/${key}/${JSON.stringify(context)}: "${line.text}" is not in the enumeration`);
  }
  assert.equal(new Set(AUTHORED_UTTERANCES.map(line => line.clipId)).size, AUTHORED_UTTERANCES.length, 'clip ids stay unique');
  assert.ok(STORY_CUE_VARIANTS.length > 10);
});

test('a blind date plays the same rules in its own seeded voice', () => {
  const identity = createBlindDate('authored-realism-seed');
  const cold = getBlindDateCue(identity, BEAT_COLD); assert.equal(cold.length, 1); assert.equal(cold[0].speaker, 'date'); assert.match(cold[0].text, /week/);
  assert.deepEqual(getBlindDateCue(identity, 'bill-requested', { reserved: true }).map(line => line.speaker), ['waiter']);
  assert.deepEqual(getBlindDateCue(identity, 'bill-requested').map(line => line.speaker), ['waiter', 'date']);
  assert.deepEqual(getBlindDateCue(identity, 'main-served', { resolution: 'guarded' }).map(line => line.speaker), ['waiter', 'date']);
  assert.equal(getBlindDateCue(identity, 'main-served', { resolution: 'guarded' })[1].text, 'Thank you.');
  assert.ok(getBlindDateCue(identity, 'dessert-served', { resolution: 'hurt' }).some(line => line.speaker === 'waiter'), 'Eli’s line still lands for a hurt blind date');
  const settled = ['treat', 'separate', 'split'].map(choice => getBlindDateCue(identity, 'bill-settled', { choice }).find(line => line.speaker === 'date')!.text);
  assert.equal(new Set(settled).size, 3, 'the bill choice is acknowledged differently');
  assert.equal(getBlindDateCue(identity, 'dessert-date-choice', { choice: 'lemon', named: true })[0].text, 'Lemon posset it is, then. I’ll ask Eli.');
  const other = MENU.find(dish => dish !== identity.biography.preferredMain)!;
  assert.match(getBlindDateCue(identity, 'ordered', { humanDish: other })[0].text, /^Nice, /);
  assert.match(getBlindDateCue(identity, 'main-finished', { bites: 0 })[0].text, /take these away/);
  assert.notEqual(getBlindDateCue(identity, 'dessert-shared', { reserved: true })[0].text, getBlindDateCue(identity, 'dessert-shared')[0].text);
});
