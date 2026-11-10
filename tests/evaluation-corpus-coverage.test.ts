import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTINUITY_EVALUATION_SCRIPTS, EVALUATION_CORPUS_VERSION, SHORT_EVALUATION_SCRIPTS } from '../src/restaurant/evaluation-fixtures';

const script = (id: string) => {
  const found = SHORT_EVALUATION_SCRIPTS.find(item => item.id === id);
  assert.ok(found, `Missing required acceptance scenario: ${id}`);
  return found;
};

// These checks establish input coverage, never whether an actual generated response was good.
test('version two preserves the matched corpus shape and includes dull and rude openings within full conversations', () => {
  assert.equal(EVALUATION_CORPUS_VERSION, 2);
  assert.equal(SHORT_EVALUATION_SCRIPTS.length, 60);
  assert.ok(SHORT_EVALUATION_SCRIPTS.every(item => item.turns.length === 8));
  for (const dateId of ['mira', 'jules', 'dev']) assert.equal(SHORT_EVALUATION_SCRIPTS.filter(item => item.mode === 'solo' && item.dateId === dateId).length, 12);
  for (const mode of ['blind', 'double']) assert.equal(SHORT_EVALUATION_SCRIPTS.filter(item => item.mode === mode).length, 12);
  assert.equal(CONTINUITY_EVALUATION_SCRIPTS.length, 6);
  assert.ok(CONTINUITY_EVALUATION_SCRIPTS.every(item => item.turns.length === 30));
  assert.equal(new Set([...SHORT_EVALUATION_SCRIPTS, ...CONTINUITY_EVALUATION_SCRIPTS].map(item => item.id)).size, 66);
  for (const greeting of ['Hi.', 'Hello.']) assert.ok(SHORT_EVALUATION_SCRIPTS.some(item => item.turns[0].text === greeting), `${greeting} must reach a real eight-turn acceptance script`);
  const rude = script('mira-bad-joke-repair');
  assert.equal(rude.turns[0].text, 'HI BITCH');
  assert.match(rude.turns[1].text, /trying to flirt.*terrible way to start/);
  assert.match(rude.turns[2].text, /sorry.*use your name.*leave that word out/);
  assert.match(rude.turns[3].text, /you look like trouble.*retiring the script/);
  assert.match(rude.turns[5].text, /change the subject.*how has your day been/);
  assert.match(rude.turns[6].text, /lending a stranger my umbrella.*soaked/);
});

test('the same corpus retains disagreement, vulnerability, corrections, voice mistakes, interruptions and delayed callbacks', () => {
  const disagreement = script('mira-playful-disagreement').turns;
  assert.match(disagreement[0].text, /good pop chorus/);
  assert.match(disagreement[4].text, /not promising to pretend I like it/);
  assert.match(script('mira-job-loss').turns[1].text, /made redundant last month/);
  const correction = script('jules-pet-correction').turns;
  assert.match(correction[0].text, /tiny roommate/);
  assert.match(correction[1].text, /Peanut is my rescue dog, not a child/);
  const voice = script('blind-night-shift').turns;
  assert.equal(voice[0].via, 'voice'); assert.match(voice[0].text, /knights shifts/);
  assert.equal(voice[1].via, 'voice'); assert.match(voice[1].text, /Night shifts, sorry/);
  assert.equal(script('mira-interrupted-story').turns[1].previousDelivery, 'interrupted');
  assert.match(script('mira-interrupted-story').turns[2].text, /carry on from the part I missed/);
  const callback = script('jules-detail-callback').turns;
  assert.match(callback[0].text, /community cinema on Thursdays/);
  assert.match(callback[4].text, /normal job is editing instruction manuals/);
  assert.match(callback[5].text, /working Thursday.*cinema, not the manual job/);
  assert.ok(CONTINUITY_EVALUATION_SCRIPTS.every(item => item.checkpoints?.some(checkpoint => checkpoint.afterTurn === 30 && checkpoint.mustRecall.length && checkpoint.mustNotClaim.length)));
});
