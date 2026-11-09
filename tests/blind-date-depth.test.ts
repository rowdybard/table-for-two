import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLIND_CONVERSATION_SEEDS, BLIND_OPENING_TEMPLATES, BLIND_VULNERABILITY_MOTIVES, createBlindDate } from '../src/restaurant/blind-date';
import { conversationContentNote as conversationContent } from '../src/restaurant/conversation-content';

test('the Blind corpus has three distinct authored pieces for each of twelve coherent jobs', () => {
  assert.equal(BLIND_CONVERSATION_SEEDS.length, 12);
  const seeds = BLIND_CONVERSATION_SEEDS.flat();
  assert.equal(seeds.length, 36); assert.equal(new Set(seeds.map(seed => seed.id)).size, 36);
  for (const bank of BLIND_CONVERSATION_SEEDS) {
    assert.equal(bank.length, 3); assert.equal(bank[0].kind, 'anecdote');
    assert.equal(bank[2].kind, 'desire'); assert.equal(bank[2].personal, true);
    for (const seed of bank) {
      assert.ok(seed.id.startsWith('blind-')); assert.ok(seed.text.length > 70 && seed.text.length < 420);
      assert.ok(seed.topics.length >= 3); assert.ok(seed.retellKeys.length >= 2);
      assert.equal(/\b(?:Mira|Jules|Dev|Ada|Inez|Leena|After Closing|Second Helping)\b/.test(seed.text), false, seed.id);
    }
  }
  assert.deepEqual(new Set(seeds.map(seed => seed.kind)), new Set(['anecdote', 'opinion', 'contradiction', 'desire']));
});

test('the twelve vulnerability motives and twelve openings are distinct, bounded, and reproducibly used', () => {
  assert.equal(BLIND_VULNERABILITY_MOTIVES.length, 12); assert.equal(new Set(BLIND_VULNERABILITY_MOTIVES).size, 12);
  assert.equal(BLIND_OPENING_TEMPLATES.length, 12); assert.equal(new Set(BLIND_OPENING_TEMPLATES).size, 12);
  assert.ok(BLIND_OPENING_TEMPLATES.every(opening => opening.length < 420));
  const identities = Array.from({ length: 400 }, (_, index) => createBlindDate(`depth-${index}`));
  assert.equal(new Set(identities.map(identity => identity.opening)).size, 12);
  for (const identity of identities) {
    assert.deepEqual(createBlindDate(identity.seed), identity);
    assert.equal(identity.biography.vulnerability.includes('{ambition}'), false);
    assert.ok(BLIND_VULNERABILITY_MOTIVES.some(motive => identity.biography.vulnerability.startsWith(motive.split('{ambition}')[0])));
    assert.equal('conversationSeeds' in identity.biography, false, 'private snippets are not serialized into the stable biography');
  }
});

test('a selected job always receives its own bank independently of appearance, with no preset lore', () => {
  const byOccupation = new Map<string, string[]>(), rigs = new Map<string, Set<string>>();
  for (let index = 0; index < 400; index++) {
    const identity = createBlindDate(`job-bank-${index}`), occupation = identity.biography.occupation;
    const ids = identity.conversationSeeds.map(seed => seed.id);
    if (byOccupation.has(occupation)) assert.deepEqual(ids, byOccupation.get(occupation)); else byOccupation.set(occupation, ids);
    const appearances = rigs.get(occupation) ?? new Set<string>(); appearances.add(identity.dateId); rigs.set(occupation, appearances);
    assert.equal(BLIND_CONVERSATION_SEEDS.some(bank => bank === identity.conversationSeeds), true);
    assert.equal(identity.conversationSeeds.length, 3);
  }
  assert.equal(byOccupation.size, 12);
  assert.equal(new Set([...byOccupation.values()].map(ids => ids.join(','))).size, 12);
  assert.ok([...rigs.values()].every(appearances => appearances.size === 3), 'every authored job can use all three visual rigs');
});

test('pre-existing seeds preserve their legacy traits, occupation and food choices', () => {
  const identity = createBlindDate('late-train-92');
  assert.equal(identity.version, 1); assert.equal(identity.dateId, 'dev');
  assert.deepEqual(identity.traits, { sociability: 74, openness: 73, competitiveness: 48, directness: 36, spontaneity: 13 });
  assert.equal(identity.biography.occupation, 'sound technician at a small music venue');
  assert.equal(identity.biography.preferredMain, 'Lemon & herb chicken'); assert.equal(identity.biography.preferredDessert, 'lemon');
  assert.ok(identity.preferences.includes('indoor climbing')); assert.ok(identity.preferences.includes('being photographed or recorded without permission'));
  const quiet = createBlindDate('blind-0');
  assert.equal(quiet.dateId, 'jules'); assert.equal(quiet.traits.sociability, 7); assert.equal(quiet.traits.spontaneity, 100);
  assert.equal(quiet.biography.occupation, 'urban gardener maintaining community plots');
  assert.ok(quiet.preferences.includes('small independent comics')); assert.equal(quiet.biography.preferredDessert, 'berries');
});

test('Blind content selection uses only its own job material, gates personal seeds, and remembers retell anchors', () => {
  const identity = createBlindDate('late-train-92');
  const base = { dateId: identity.dateId, latestHumanText: 'Tell me about music and your work.', seeds: identity.conversationSeeds, includeVoiceExample: false };
  const ordinary = conversationContent(base);
  assert.ok(ordinary.includes('desk fan') || ordinary.includes('small room'));
  assert.equal(ordinary.includes('no booked date'), false, 'private ambition is gated until disclosure is allowed');
  assert.equal(/Second Helping|After Closing|cookbook|Mira|Jules|Dev/.test(ordinary), false);
  const personal = conversationContent({ ...base, latestHumanText: 'What do you want to do with the local bands?', personalDisclosureAllowed: true });
  assert.ok(personal.includes('listening night'));
  const heard = conversationContent({ ...base, memory: 'TOLD THEM: desk fan in the guitar amp. A small room where people listen.' });
  assert.equal(heard.includes('ten minutes hunting a hum'), false);
});
