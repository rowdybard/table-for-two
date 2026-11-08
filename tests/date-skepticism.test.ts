import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAdvanceAgenda, distinctHeardClueCount, hasEarnedConfidence } from '../server/restaurant/skepticism';
import type { DateAgendaProgress } from '../src/restaurant/agenda-types';
import RAPIER from '@dimforge/rapier3d-compat';
import { DinnerScene } from '../server/restaurant/scene';
import type { SceneTurn, SceneUtterance } from '../src/restaurant/types';
import { RESTAURANT } from '../src/restaurant/content';

const progress = (): DateAgendaProgress => ({ clues: [], milestones: [], score: 0, possible: 100, goal: null, reflection: null });
const firstClue = 'I want to make my own choices tonight.';
const secondClue = 'Being included matters; having my order chosen for me does not.';
const evidence = {
  noticed: 'You want your own say in the evening.',
  understood: 'Being considered matters more than having someone organize you.',
  respected: 'I prefer the risotto. What would you like to order for yourself?',
} as const;

test('skeptical dates require heard specifics before sequential agenda advancement', () => {
  const state = progress();
  assert.equal(canAdvanceAgenda('noticed', undefined), false);
  assert.equal(canAdvanceAgenda('none', state), false);
  assert.equal(canAdvanceAgenda('noticed', state), false);
  state.clues.push(firstClue);
  assert.equal(canAdvanceAgenda('noticed', state), true);
  assert.equal(canAdvanceAgenda('understood', state), false, 'clues do not bypass the earlier milestone');
  state.milestones.push({ kind: 'noticed', evidence: evidence.noticed });
  assert.equal(canAdvanceAgenda('noticed', state), false, 'the same milestone cannot pay again');
  assert.equal(canAdvanceAgenda('understood', state), false, 'one disclosed preference does not establish the full picture');
  state.clues.push(secondClue);
  assert.equal(canAdvanceAgenda('understood', state), true);
  assert.equal(canAdvanceAgenda('respected', state), false);
  state.milestones.push({ kind: 'understood', evidence: evidence.understood });
  assert.equal(canAdvanceAgenda('respected', state), true);
  state.milestones.push({ kind: 'respected', evidence: evidence.respected });
  assert.equal(canAdvanceAgenda('respected', state), false);
});

test('punctuation, case, whitespace and unicode formatting cannot manufacture two heard clues', () => {
  const state = progress();
  state.clues = [firstClue, ' I WANT TO MAKE MY OWN CHOICES TONIGHT!!! ', '', '…'];
  assert.equal(distinctHeardClueCount(state), 1);
  state.clues.push('Ｉ want to make my own choices tonight.');
  assert.equal(distinctHeardClueCount(state), 1);
  state.clues.push(secondClue);
  assert.equal(distinctHeardClueCount(state), 2);
  assert.equal(distinctHeardClueCount(undefined), 0);
});

test('confidence requires all distinct milestones and multiple heard clues, independent of raw score', () => {
  const state = progress();
  assert.equal(hasEarnedConfidence(undefined), false);
  state.score = 100; state.clues = [firstClue, secondClue];
  assert.equal(hasEarnedConfidence(state), false, 'a claimed numeric score does not establish belief');
  state.milestones = [{ kind: 'noticed', evidence: evidence.noticed }, { kind: 'noticed', evidence: 'An additional observation.' }, { kind: 'respected', evidence: evidence.respected }];
  assert.equal(hasEarnedConfidence(state), false, 'three entries are insufficient without understanding');
  state.milestones = Object.entries(evidence).map(([kind, quote]) => ({ kind: kind as keyof typeof evidence, evidence: quote }));
  state.clues = [firstClue];
  assert.equal(hasEarnedConfidence(state), false);
  state.clues.push(secondClue); state.score = 0;
  assert.equal(hasEarnedConfidence(state), true, 'the evidence milestones establish readiness, not a score threshold');
});

test('revoked respect removes earned confidence until new respect evidence is established', () => {
  const state = progress();
  state.clues = [firstClue, secondClue];
  state.milestones = Object.entries(evidence).map(([kind, quote]) => ({ kind: kind as keyof typeof evidence, evidence: quote }));
  assert.equal(hasEarnedConfidence(state), true);
  state.milestones = state.milestones.filter(milestone => milestone.kind !== 'respected');
  assert.equal(hasEarnedConfidence(state), false);
  assert.equal(canAdvanceAgenda('respected', state), true);
});

const friendlyTurn = (): SceneTurn => ({ utterances: [{ speaker: 'date', text: 'That sounds pleasant. I would like to see what you mean in practice.', emotion: 'amused' }], emotion: 'amused', action: 'none', memory: '', social: { signal: 'kindness', reason: 'A pleasant comment, without demonstrated follow-through yet.', wantsToLeave: false } });
const foodRefusal = 'Please let me choose my own food. Do not order for me.';
function deliverFoodBoundary(scene: DinnerScene) {
  const humanText = 'Shall I order dinner for you?';
  const line: SceneUtterance = { speaker: 'date', text: foodRefusal, emotion: 'neutral' };
  scene.applyTurn({ ...friendlyTurn(), utterances: [line], social: { signal: 'none', reason: 'The date chooses their own food.', wantsToLeave: false, boundary: { kind: 'set', topic: 'food-drink', refusal: foodRefusal, evidence: humanText } } }, humanText);
  scene.acknowledge(line);
}

test('all presets and seeded Blind dates remain skeptical after pleasing social signals', async () => {
  await RAPIER.init();
  for (const [id, options] of [['mira', {}], ['jules', {}], ['dev', {}], ['mira', { blindDate: { seed: 'skeptical-blind' } }]] as const) {
    const scene = new DinnerScene(id, 2, options);
    try {
      scene.applyTurn(friendlyTurn(), 'You are incredible. I am exactly the person you are looking for.');
      assert.equal(scene.state.evening.stance, 'curious');
      scene.applyTurn({ ...friendlyTurn(), social: { signal: 'humor', reason: 'A funny remark.', wantsToLeave: false } }, 'You have excellent taste; I totally agree with you.');
      assert.equal(scene.state.evening.stance, 'curious', 'polite warmth and laughter do not establish belief');
      assert.equal(scene.state.evening.agenda?.score, 0);
    } finally { scene.free(); }
  }
});

test('a cleanup or an apology button alone cannot buy confidence', async () => {
  await RAPIER.init();
  const scene = new DinnerScene('mira', 2);
  try {
    scene.state.seated = true;
    scene.state.evening.incident = { event: 'spilled-drink', progress: 3, startedAt: 0 };
    scene.command({ type: 'evening', action: 'steady-glass' });
    assert.equal(scene.state.evening.stance, 'curious');
    scene.command({ type: 'evening', action: 'apologize' });
    assert.equal(scene.state.evening.stance, 'curious');
    assert.equal(scene.state.evening.agenda?.score, 0);
  } finally { scene.free(); }
});

test('specific delivered evidence can establish confidence, and boundary repair must earn it back', async () => {
  await RAPIER.init();
  const scene = new DinnerScene('jules', 2);
  try {
    const disclose = (text: string) => {
      const line: SceneUtterance = { speaker: 'date', text, emotion: 'neutral' };
      scene.director.agenda.assess({ signal: 'none', evidence: '', clue: text }, '', [line]);
      scene.acknowledge(line);
    };
    const demonstrate = (kind: keyof typeof evidence) => scene.applyTurn({ ...friendlyTurn(), agenda: { signal: kind, evidence: evidence[kind], clue: '' } }, evidence[kind]);
    disclose(firstClue); demonstrate('noticed');
    assert.equal(scene.state.evening.stance, 'curious');
    disclose(secondClue); demonstrate('understood');
    assert.equal(scene.state.evening.stance, 'curious');
    demonstrate('respected');
    assert.equal(scene.state.evening.stance, 'comfortable', 'actual evidence can change the date’s view');
    deliverFoodBoundary(scene);
    scene.applyTurn({ ...friendlyTurn(), social: { signal: 'pressure', reason: 'Ignored the date’s request to choose their own order.', wantsToLeave: false, boundary: { kind: 'repeat', topic: 'food-drink', refusal: foodRefusal, evidence: 'I am ordering for you anyway.' } } }, 'I am ordering for you anyway.');
    assert.equal(scene.state.evening.stance, 'guarded');
    assert.equal(scene.state.evening.agenda?.score, 65);
    scene.state.seated = true;
    scene.command({ type: 'evening', action: 'apologize' });
    assert.equal(scene.state.evening.stance, 'curious', 'an apology reopens conversation without restoring lost trust');
    assert.equal(scene.state.evening.agenda?.score, 65);
  } finally { scene.free(); }
});

test('a single apology cannot bypass skepticism through a second-chance farewell', async () => {
  await RAPIER.init();
  const scene = new DinnerScene('dev', 2);
  try {
    deliverFoodBoundary(scene);
    scene.applyTurn({ ...friendlyTurn(), social: { signal: 'pressure', reason: 'Ignored a stated limit.', wantsToLeave: false, boundary: { kind: 'repeat', topic: 'food-drink', refusal: foodRefusal, evidence: 'I am not going to listen to your answer.' } } }, 'I am not going to listen to your answer.');
    scene.state.seated = true;
    scene.command({ type: 'evening', action: 'apologize' });
    assert.equal(scene.state.evening.stance, 'curious');
    scene.state.evening.bill = { requested: true, settlement: 'split' };
    scene.state.evening.chapter = 'farewell'; scene.state.stage = 'farewell';
    scene.state.seated = false;
    scene.state.participants[0].position = [...RESTAURANT.entrance];
    scene.command({ type: 'evening', action: 'farewell', choice: 'again' });
    assert.equal(scene.state.evening.farewell.ending?.kind, 'new-friend');
    assert.equal(scene.state.evening.agenda?.score, 0);
  } finally { scene.free(); }
});
