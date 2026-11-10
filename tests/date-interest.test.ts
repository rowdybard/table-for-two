import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { EveningDirector } from '../server/restaurant/evening';
import { INTEREST_IDLE_AFTER, INTEREST_IDLE_EVERY } from '../server/restaurant/interest';
import { emptyUsage } from '../server/restaurant/scene';
import { MENU } from '../src/restaurant/content';
import { EVENING_PACE, createEvening } from '../src/restaurant/evening';
import type { DateId, DinnerState, Emotion, SceneTurn, SocialResponse } from '../src/restaurant/types';

before(async () => { await RAPIER.init(); });

function seatedDinner(dateId: DateId = 'mira'): DinnerState {
  return { id: `interest-${dateId}`, generation: 0, mode: 'ai-date', phase: 'playing', dateId, stage: 'seated', elapsed: 0,
    participants: [{ id: 'p1', kind: 'human', name: 'You', position: [0, 0, 3.3] }, { id: 'p2', kind: 'ai', name: 'Mira', position: [0, 0, -2.25] }],
    seated: true, order: null, events: [], emotion: 'neutral', glassRaised: false, memory: '', sessionLimit: 2, usage: emptyUsage(), evening: createEvening(dateId, 0) };
}
const quiet = { allowIncidents: false, allowScenarios: false } as const;
function run(state: DinnerState, director: EveningDirector, seconds: number) { for (let i = 0; i < seconds; i++) { state.elapsed += 1; director.step(1, quiet); } }
function turn(emotion: Emotion, signal: SocialResponse['signal'] = 'none', text = 'Ha, that is a good one.'): SceneTurn {
  return { utterances: [{ speaker: 'date', text, emotion }], emotion, action: 'none', memory: '', social: { signal, reason: '', wantsToLeave: false } };
}
let said = 0;
function exchange(state: DinnerState, director: EveningDirector, reply: SceneTurn) {
  const human = `I told you about the time I got lost number ${++said}.`;
  director.noteHumanTurn(human); director.social(reply, human); director.replyEnded(); state.generation++;
}
const level = (state: DinnerState) => state.evening.interest!.level;

test('interest starts polite, warms with delivered warmth and cools with a wince', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  const start = level(state);
  assert.ok(start > 20 && start < 45, 'a first date starts curious, not smitten');
  exchange(state, director, turn('amused', 'humor'));
  assert.ok(level(state) > start); assert.equal(state.evening.interest!.trend, 1);
  const warmed = level(state);
  exchange(state, director, turn('annoyed'));
  assert.ok(level(state) < warmed); assert.equal(state.evening.interest!.trend, -1);
  assert.equal(state.usage.claudeRequests, 0, 'the read-out never asks a model');
});

test('charm alone cannot run ahead of trust: interest is capped until confidence is earned', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  for (let i = 0; i < 40; i++) exchange(state, director, turn('flirtatious', 'humor'));
  assert.ok(level(state) <= 72, `capped at 72 without earned confidence, got ${level(state)}`);
  assert.ok(level(state) >= 60, 'a long warm exchange still reads as clearly interested');
});

test('a disregarded boundary drops interest hard and a guarded stance holds it down', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  for (let i = 0; i < 6; i++) exchange(state, director, turn('warm', 'kindness'));
  const before = level(state);
  state.evening.stance = 'guarded';
  exchange(state, director, turn('defensive', 'pressure'));
  assert.ok(level(state) <= 30, 'guarded caps the read-out');
  assert.ok(before - level(state) >= 15);
});

test("a friend's line in a shared table can cool a date but never warm them", () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  const start = level(state);
  director.noteHumanTurn('hello'); director.social(turn('flirtatious', 'humor'), 'You are lovely.', { humanId: 'h2', paired: false });
  assert.equal(level(state), start);
  director.social(turn('angry', 'pressure'), 'Whatever.', { humanId: 'h2', paired: false });
  assert.ok(level(state) < start);
});

test('quiet stretches do not introduce scripted penalties or affection rewards', () => {
  const state = seatedDinner(), director = new EveningDirector(state);
  try {
    exchange(state, director, turn('warm', 'kindness'));
    const before = level(state);
    run(state, director, INTEREST_IDLE_AFTER + INTEREST_IDLE_EVERY * 4);
    assert.equal(level(state), before);
    assert.equal(state.evening.main.status, 'none');
    assert.deepEqual(state.evening.cues, []);
    assert.equal(state.evening.incident, null);
  } finally { director.free(); }
});
