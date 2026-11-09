import assert from 'node:assert/strict';
import test from 'node:test';
import { createPairView } from '../server/double-date/scene';
import { EveningDirector } from '../server/restaurant/evening';
import { emptyUsage } from '../server/restaurant/scene';
import { applyScenarioToView } from '../server/restaurant/scenario';
import { applyScenarioEffects } from '../server/restaurant/scenario-effects';
import { hasEarnedConfidence } from '../server/restaurant/skepticism';
import { createBlindDate, getBlindDateCue } from '../src/restaurant/blind-date';
import { MENU, RESTAURANT } from '../src/restaurant/content';
import { activateRestaurantScenario, chooseRestaurantScenario, createRestaurantScenario } from '../src/restaurant/scenarios';
import { ENDING_MOTIFS, STORY_CUE_VARIANTS, getStoryCue } from '../src/restaurant/story';
import type { DateId, SceneTurn, SceneUtterance } from '../src/restaurant/types';

function fixture(dateId: DateId = 'mira', humanId: 'h1' | 'h2' = 'h1', blindSeed?: string) {
  const identity = blindSeed ? createBlindDate(blindSeed) : undefined;
  const view = createPairView('ending-depth', humanId, humanId === 'h1' ? 'Alex' : 'Jamie', identity?.dateId ?? dateId, emptyUsage(), 2);
  if (identity) { view.mode = 'blind-date'; view.blindDate = { seed: identity.seed }; }
  view.phase = 'playing'; view.stage = 'dining'; view.seated = true; view.order = MENU[0];
  view.evening.main.status = 'served'; view.evening.main.servedDish = MENU[0];
  const director = new EveningDirector(view, { humanId });
  const reply = (humanText: string, line: SceneUtterance, agenda?: SceneTurn['agenda'], social?: SceneTurn['social']) => {
    director.noteHumanTurn(humanText, humanId);
    director.social({ utterances: [line], emotion: line.emotion, action: 'none', memory: '', agenda,
      social: social ?? { signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false } }, humanText, { humanId, paired: true });
  };
  const earn = () => {
    const context = director.agenda.promptContext();
    const first: SceneUtterance = { speaker: 'date', text: context.naturalHint, emotion: 'warm' };
    const second: SceneUtterance = { speaker: 'date', text: context.goal, emotion: 'warm' };
    reply('What would make tonight good for you?', first, { signal: 'none', evidence: '', clue: first.text }); director.acknowledge(first);
    const notice = 'I noticed that preference matters to you.';
    reply(notice, second, { signal: 'noticed', evidence: notice, clue: second.text }); director.acknowledge(second);
    const understand = 'I understand the difference you explained, and why it matters.';
    reply(understand, { speaker: 'date', text: 'Yes, that is what I meant.', emotion: 'warm' }, { signal: 'understood', evidence: understand, clue: '' });
    const respect = 'I will leave that choice with you and take care of my own part.';
    reply(respect, { speaker: 'date', text: 'Thank you. I appreciate that.', emotion: 'warm' }, { signal: 'respected', evidence: respect, clue: '' }, { signal: 'curiosity', reason: 'Responded to the actual preference without taking over.', wantsToLeave: false });
    assert.ok(hasEarnedConfidence(view.evening.agenda)); assert.equal(view.evening.stance, 'comfortable');
  };
  const toast = (intention: 'tonight' | 'honesty' | 'friends' | 'mischief', listener: 'h1' | 'h2' | null = humanId) => {
    director.action({ type: 'evening', action: 'toast', choice: intention }, view.elapsed * 1000);
    const line = view.evening.cues.find(cue => cue.key === 'care-toast')!.utterances.find(line => line.speaker === 'date')!;
    if (listener) director.acknowledge(line, listener);
    return line;
  };
  const finish = (choice: 'again' | 'friendly' | 'goodbye' = 'again') => {
    // Controlled final-course snapshot; the acts above and the final choices still use the real controller.
    view.evening.main.status = 'finished'; view.evening.dessert.status = 'skipped'; view.evening.bill.requested = true;
    director.action({ type: 'evening', action: 'settle-bill', choice: 'split' }, view.elapsed * 1000);
    view.seated = false; view.participants[0].position = [...RESTAURANT.entrance];
    director.action({ type: 'evening', action: 'farewell', choice }, view.elapsed * 1000);
    assert.equal(view.usage.claudeRequests, 0); assert.equal(view.usage.totalCost, 0);
    return view.evening.farewell.ending!;
  };
  return { view, director, identity, reply, earn, toast, finish };
}

test('the same cast and earned outcome close differently after two actual heard shared toasts', () => {
  for (const dateId of ['mira', 'jules', 'dev'] as const) {
    const honesty = fixture(dateId), friends = fixture(dateId);
    honesty.earn(); friends.earn(); honesty.toast('honesty'); friends.toast('friends');
    const one = honesty.finish(), two = friends.finish();
    assert.equal(one.kind, 'another-evening'); assert.equal(two.kind, one.kind);
    assert.match(one.dateLine, /honesty/); assert.match(two.dateLine, /friends/); assert.notEqual(one.dateLine, two.dateLine);
    assert.ok(one.dateLine.length <= 260 && two.dateLine.length <= 260);
    assert.equal(honesty.view.evening.agenda?.score, 100); assert.equal(friends.view.evening.agenda?.score, 100);
  }
});

test('an accepted heard taste can close the evening; a declined offer or unplayed response cannot', () => {
  for (const heard of [true, false]) {
    const f = fixture('mira'); f.earn();
    f.director.action({ type: 'evening', action: 'offer-taste' }, f.view.elapsed * 1000);
    assert.equal(f.view.evening.care.tasteOffer?.result, 'accepted');
    const line = f.view.evening.cues.find(cue => cue.key === 'care-taste')!.utterances.find(line => line.speaker === 'date')!;
    if (heard) f.director.acknowledge(line);
    const ending = f.finish();
    assert.equal(ending.kind, 'another-evening');
    assert.equal(/sharing a bite/.test(ending.dateLine), heard);
  }
  const declined = fixture('jules'); declined.earn();
  declined.director.action({ type: 'evening', action: 'offer-taste' }, declined.view.elapsed * 1000);
  assert.equal(declined.view.evening.care.tasteOffer?.result, 'declined');
  declined.director.acknowledge(declined.view.evening.cues.find(cue => cue.key === 'care-taste')!.utterances[0]);
  assert.equal(declined.finish().dateLine, getStoryCue('ending-another-evening', 'jules')[0].text);
});

test('a friend’s receipt, invented notebook and undisclosed project cannot supply this couple’s callback', () => {
  const own = fixture('mira', 'h1'), friend = fixture('jules', 'h2'); own.earn(); friend.earn();
  own.toast('honesty', 'h2'); // Heard only by the other human, not Mira’s own date partner.
  friend.toast('friends');
  own.view.memory = 'HUMAN: promised a second date\nTOLD THEM: invented private exhibition detail\nOPEN: shared premise: toast to honesty';
  const one = own.finish(), two = friend.finish();
  assert.equal(one.dateLine, getStoryCue('ending-another-evening', 'mira')[0].text);
  assert.doesNotMatch(one.dateLine, /honesty|friends|promised|private exhibition/);
  assert.match(two.dateLine, /friends/); assert.doesNotMatch(two.dateLine, /honesty/);
  assert.ok(!one.dateLine.includes(own.director.agenda.promptContext().goal));
});

test('an actual heard boundary, apology and renewed respect keep the existing second-chance branch', () => {
  const f = fixture(); f.earn();
  const refusal = 'Please let me choose my own food. Do not order for me.';
  const boundaryLine: SceneUtterance = { speaker: 'date', text: refusal, emotion: 'neutral' };
  const question = 'Shall I choose your dinner for you?';
  f.reply(question, boundaryLine, undefined, { signal: 'none', reason: 'The date wants their own choice.', wantsToLeave: false, boundary: { kind: 'set', topic: 'food-drink', refusal, evidence: question } });
  f.director.acknowledge(boundaryLine);
  const disregard = 'I am choosing your dinner anyway.';
  f.reply(disregard, { speaker: 'date', text: 'No. I asked you to leave that to me.', emotion: 'annoyed' }, undefined, { signal: 'pressure', reason: 'Disregarded the heard food choice boundary.', wantsToLeave: false, boundary: { kind: 'repeat', topic: 'food-drink', refusal, evidence: disregard } });
  assert.equal(f.view.evening.stance, 'guarded'); assert.equal(f.view.evening.agenda?.score, 65);
  const apology = 'You are right. Your food is your choice, and I will leave it to you.';
  f.reply(apology, { speaker: 'date', text: 'Thank you for hearing what I asked.', emotion: 'warm' }, undefined, { signal: 'repair', reason: 'Acknowledged the actual boundary.', wantsToLeave: false, boundary: { kind: 'repair', topic: 'food-drink', refusal, evidence: apology } });
  const followThrough = 'I will choose my own meal and let you decide yours without another suggestion.';
  f.reply(followThrough, { speaker: 'date', text: 'Good. I appreciate that.', emotion: 'warm' }, { signal: 'respected', evidence: followThrough, clue: '' }, { signal: 'curiosity', reason: 'Left the actual food choice with the date.', wantsToLeave: false });
  assert.equal(f.view.evening.agenda?.score, 100); assert.equal(f.view.evening.stance, 'comfortable');
  f.toast('honesty');
  const ending = f.finish(); assert.equal(ending.kind, 'second-chance'); assert.match(ending.dateLine, /honesty/); assert.match(ending.dateLine, /talked it through/);
});

test('reserved, hurt and romance-closed endings retain their existing protected wording', () => {
  const reserved = fixture(); reserved.toast('honesty');
  const plain = reserved.finish('friendly');
  assert.equal(plain.kind, 'new-friend'); assert.equal(plain.dateLine, getStoryCue('ending-new-friend', 'mira', { reserved: true })[0].text);
  const hurt = fixture(); hurt.earn(); hurt.toast('honesty'); hurt.view.evening.stance = 'hurt';
  const goodbye = hurt.finish(); assert.equal(goodbye.kind, 'quiet-goodbye'); assert.doesNotMatch(goodbye.dateLine, /honesty/);
  const closed = fixture(); closed.earn(); closed.toast('honesty'); closed.view.evening.care.romanceClosed = true;
  const friendship = closed.finish(); assert.equal(friendship.kind, 'new-friend'); assert.equal(friendship.dateLine, getStoryCue('ending-new-friend', 'mira')[0].text);
});

test('medical handoff retains its actual care line and cannot be replaced by an earlier toast', () => {
  const f = fixture(); f.earn(); f.toast('honesty');
  const scenario = createRestaurantScenario('ending-care', 'allergic-reaction'); f.view.evening.scenario = scenario;
  activateRestaurantScenario(scenario, 120, 'playful'); applyScenarioEffects(f.view, scenario);
  applyScenarioToView(f.view, scenario, chooseRestaurantScenario(scenario, scenario.choices[0].id, 'Alex', 121, 'playful'), 'Alex');
  const finish = chooseRestaurantScenario(scenario, 'support-handoff', 'Alex', 122, 'playful'); applyScenarioToView(f.view, scenario, finish, 'Alex');
  f.director.reconcileScenarioState();
  const ending = f.view.evening.farewell.ending!;
  assert.equal(ending.kind, 'early-exit'); assert.equal(ending.dateLine, finish.utterances.find(line => line.speaker === 'date')!.text);
  assert.doesNotMatch(ending.dateLine, /honesty|see you again|another evening/);
});

test('Blind closing callbacks follow seeded rhythm and actual events without borrowing preset biography', () => {
  for (const seed of ['late-train-92', 'blind-0']) {
    const f = fixture('mira', 'h1', seed); f.earn(); f.toast('honesty');
    const ending = f.finish(); assert.equal(ending.kind, 'another-evening'); assert.match(ending.dateLine, /honesty/);
    assert.doesNotMatch(ending.dateLine, /Mira|Jules|Dev|Ada|Inez|Leena|After Closing|Second Helping|cookbook|photo|food truck/);
    const noReceipt = fixture('mira', 'h1', seed); noReceipt.earn(); noReceipt.toast('honesty', null);
    assert.equal(noReceipt.finish().dateLine, getBlindDateCue(noReceipt.identity!, 'ending-another-evening')[0].text);
  }
});

test('fixed ending callback readings remain enumerable for the existing authored speech cache', () => {
  for (const endingMotif of ENDING_MOTIFS) {
    assert.ok(STORY_CUE_VARIANTS.some(variant => variant.context.endingMotif === endingMotif));
    for (const dateId of ['mira', 'jules', 'dev'] as const) for (const ending of ['another-evening', 'new-friend', 'second-chance']) {
      const [line] = getStoryCue(`ending-${ending}`, dateId, { endingMotif });
      assert.ok(line.text.length <= 260);
    }
  }
});
