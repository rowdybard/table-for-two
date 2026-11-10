import test from 'node:test';
import assert from 'node:assert/strict';
import { ENDING_RANK, bestEndings } from '../src/restaurant/best-endings';

const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null });

test('the best ending per date survives saved evenings rolling off and ignores blind strangers', () => {
  const best = bestEndings(storage({
    'table-for-two-best': JSON.stringify({ mira: 'another-evening', dev: 'not-an-ending' }),
    'table-for-two-evenings': JSON.stringify([
      { dateId: 'mira', ending: { kind: 'new-friend' } },
      { dateId: 'jules', ending: { kind: 'quiet-goodbye' } },
      { dateId: 'jules', ending: { kind: 'invited-home' } },
      { dateId: 'jules', ending: { kind: 'walked-away' } },
      { dateId: 'dev', blind: true, ending: { kind: 'invited-home' } },
      null, { dateId: 7 },
    ]),
  }));
  assert.deepEqual(best, { mira: 'another-evening', jules: 'invited-home' });
});

test('missing or broken storage is an empty collection', () => {
  assert.deepEqual(bestEndings(storage({})), {});
  assert.deepEqual(bestEndings(storage({ 'table-for-two-best': '{', 'table-for-two-evenings': 'x' })), {});
  assert.equal(ENDING_RANK.at(-1), 'invited-home');
});
