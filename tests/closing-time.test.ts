import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOSING_STRETCH, EVENING_EXCHANGES, createEvening } from '../src/restaurant/evening';
import { closingContext, closingLine, closingVerdict, exchangesLeft, settledVerdict, type ClosingState } from '../server/restaurant/closing';
import { turnNote } from '../server/restaurant/turn-note';
import type { DinnerState, SceneUtterance } from '../src/restaurant/types';

const flat: ClosingState = { guarded: false, romanceClosed: false, repairedAfterHurt: false, chemistryUnlocked: false, comfortable: false, reciprocalFlirts: 0, trustEarned: false };
const date = (text: string, emotion: SceneUtterance['emotion'] = 'warm'): SceneUtterance => ({ speaker: 'date', text, emotion });

test('an evening is thirty-six exchanges and the verdict comes from earned state', () => {
  assert.equal(EVENING_EXCHANGES, 36); assert.equal(createEvening('mira').exchangesLeft, 36);
  assert.equal(exchangesLeft(0), 36); assert.equal(exchangesLeft(35), 1); assert.equal(exchangesLeft(40), 0);
  assert.equal(closingVerdict(flat), 'new-friend', 'a flat evening is a kind goodnight');
  assert.equal(closingVerdict({ ...flat, reciprocalFlirts: 1 }), 'another-evening', 'one flirt that landed both ways earns a second date');
  assert.equal(closingVerdict({ ...flat, trustEarned: true }), 'another-evening');
  assert.equal(closingVerdict({ ...flat, chemistryUnlocked: true, comfortable: true, reciprocalFlirts: 2 }), 'invited-home');
  assert.equal(closingVerdict({ ...flat, chemistryUnlocked: true, comfortable: false, reciprocalFlirts: 2 }), 'another-evening', 'chemistry without comfort is not an invitation');
  assert.equal(closingVerdict({ ...flat, chemistryUnlocked: true, comfortable: true, romanceClosed: true }), 'new-friend', 'closed romance never becomes an invitation');
  assert.equal(closingVerdict({ ...flat, chemistryUnlocked: true, comfortable: true, guarded: true }), 'quiet-goodbye');
  assert.equal(closingVerdict({ ...flat, repairedAfterHurt: true, reciprocalFlirts: 1 }), 'second-chance');
  assert.equal(settledVerdict('another-evening', 'invited-home'), 'another-evening', 'the ending never rises above what the date said');
  assert.equal(settledVerdict('invited-home', 'quiet-goodbye'), 'quiet-goodbye', 'a last-second insult still lowers it');
  assert.equal(settledVerdict(null, 'new-friend'), 'new-friend');
});

test('the date hears nothing about the clock until the last stretch, then its final line carries the verdict', () => {
  assert.equal(closingContext(0, 'new-friend'), null); assert.equal(closingContext(EVENING_EXCHANGES - CLOSING_STRETCH - 1, 'new-friend'), null);
  assert.deepEqual(closingContext(EVENING_EXCHANGES - CLOSING_STRETCH, 'new-friend'), { left: CLOSING_STRETCH, final: false, verdict: 'new-friend' });
  assert.deepEqual(closingContext(35, 'invited-home'), { left: 1, final: true, verdict: 'invited-home' });
  assert.equal(closingContext(36, 'new-friend'), null, 'nothing follows the last exchange');
  assert.equal(closingLine(null), '');
  const soon = closingLine({ left: 3, final: false, verdict: 'invited-home' });
  assert.match(soon, /closing soon/); assert.match(soon, /about 2 more exchanges/); assert.doesNotMatch(soon, /invite|second date/i, 'the verdict is not leaked early');
  assert.match(closingLine({ left: 2, final: false, verdict: 'new-friend' }), /about 1 more exchange after/);
  assert.match(closingLine({ left: 1, final: true, verdict: 'invited-home' }), /last thing you say tonight[\s\S]*Invite them to come back with you/);
  assert.match(closingLine({ left: 1, final: true, verdict: 'another-evening' }), /second date/);
  assert.match(closingLine({ left: 1, final: true, verdict: 'new-friend' }), /do not promise or hint at a second date/);
  assert.match(closingLine({ left: 1, final: true, verdict: 'quiet-goodbye' }), /short, civil goodnight/);
  const scene = { id: 'x', dateId: 'mira', mode: 'ai-date', phase: 'playing', stage: 'seated', seated: true, elapsed: 600, order: null, memory: '', evening: createEvening('mira') } as unknown as DinnerState;
  const base = { scene, dateName: 'Mira', humanText: 'This was fun.', tableNow: 'You are at your table together.', memory: '', facts: [], agenda: null, boundaries: { boundaries: [] }, avoid: [] };
  assert.doesNotMatch(turnNote(base), /closing/);
  const note = turnNote({ ...base, closing: { left: 1, final: true, verdict: 'another-evening' } });
  assert.ok(note.indexOf('last thing you say tonight') > note.indexOf('just said'), 'the closing instruction follows the human’s words');
});

test('the clock runs down per exchange and the thirty-sixth reply ends the evening on its verdict', async () => {
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  const { DinnerScene } = await import('../server/restaurant/scene');
  await RAPIER.init();
  const reply = (line = date('Ha, fair.')) => ({ utterances: [line], emotion: line.emotion, action: 'none' as const, memory: 'HUMAN: nothing yet\nTOLD THEM: nothing\nOPEN: nothing pending' });
  const run = (prepare: (scene: InstanceType<typeof DinnerScene>, turn: number) => boolean | void) => {
    const scene = new DinnerScene('mira', 1);
    try {
      for (let turn = 1; turn <= EVENING_EXCHANGES; turn++) {
        scene.state.generation = turn;
        const closing = scene.director.closingContext();
        assert.equal(!!closing, turn > EVENING_EXCHANGES - CLOSING_STRETCH, `turn ${turn}`);
        if (closing) assert.equal(closing.final, turn === EVENING_EXCHANGES);
        if (!prepare(scene, turn)) scene.applyTurn(reply(), `Remark ${turn}.`);
        assert.equal(scene.state.evening.exchangesLeft, EVENING_EXCHANGES - turn);
        assert.equal(!!scene.state.evening.farewell.ending, turn === EVENING_EXCHANGES, `no ending before the last exchange (turn ${turn})`);
      }
      const last = date('Goodnight, then.');
      assert.equal(scene.state.phase, 'playing', 'the last line still has to be heard');
      assert.equal(scene.director.closingContext(), null);
      scene.acknowledge(last);
      for (let i = 0; i < 120 && scene.state.phase === 'playing'; i++) scene.step(1 / 20);
      assert.equal(scene.state.phase, 'ended', 'the evening ends a few seconds after the last line is heard');
      return scene.snapshot().evening.farewell.ending!;
    } finally { scene.free(); }
  };
  const quiet = run(() => {});
  assert.equal(quiet.kind, 'new-friend'); assert.equal(quiet.dateLine, '', 'the verdict is spoken by the model, not authored');
  const flirt = (scene: InstanceType<typeof DinnerScene>, human: string, line: string) => { const said = date(line, 'flirtatious'); scene.applyTurn(reply(said), human); scene.acknowledge(said); return true; };
  const second = run((scene, turn) => turn === 3 ? flirt(scene, 'I really like your smile.', 'You are making me smile too.') : false);
  assert.equal(second.kind, 'another-evening');
  const home = run((scene, turn) => turn === 3 ? flirt(scene, 'I really like your smile.', 'You are making me smile too.') : turn === 5 ? flirt(scene, 'I would enjoy seeing you again.', 'I would like to keep talking with you.') : false);
  assert.equal(home.kind, 'invited-home'); assert.match(home.title, /Not ready to say goodnight/);
});
