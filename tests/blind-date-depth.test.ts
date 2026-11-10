import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLIND_CONVERSATION_SEEDS, BLIND_OPENING_TEMPLATES, BLIND_VULNERABILITY_MOTIVES, createBlindDate } from '../src/restaurant/blind-date';
import { conversationContentNote as conversationContent, estimatedConversationContentTokens, selectConversationSeeds } from '../src/restaurant/conversation-content';

test('the Blind corpus preserves its original pieces and gives every job three anecdotes or opinions', () => {
  assert.equal(BLIND_CONVERSATION_SEEDS.length, 12);
  const seeds = BLIND_CONVERSATION_SEEDS.flat();
  assert.equal(seeds.length, 54); assert.equal(new Set(seeds.map(seed => seed.id)).size, 54);
  assert.equal(seeds.filter(seed => seed.kind === 'anecdote').length, 18);
  assert.equal(seeds.filter(seed => seed.kind === 'opinion').length, 18);
  assert.equal(seeds.filter(seed => seed.kind === 'contradiction').length, 6);
  assert.equal(seeds.filter(seed => seed.kind === 'desire').length, 12);
  assert.equal(new Set(seeds.map(seed => seed.retellKeys[0])).size, 54);
  assert.equal(new Set(BLIND_CONVERSATION_SEEDS.flatMap(bank => bank.slice(3).map(seed => seed.topics[0]))).size, 18);
  const original = [
    ['sound-cable', 'sound-room', 'sound-listening-night'], ['clay-wobbly-cup', 'clay-neat-shelves', 'clay-imperfect-collection'],
    ['garden-mystery-seedlings', 'garden-window-herbs', 'garden-rooftop'], ['costume-backward-cape', 'costume-movie-choice', 'costume-own-outfit'],
    ['aquarium-food-thief', 'aquarium-patient-looking', 'aquarium-tide-film'], ['radio-silent-kettle', 'radio-alarm', 'radio-strange-jobs'],
    ['model-tiny-bench', 'model-useful-offcuts', 'model-childhood-street'], ['records-biscuit', 'records-bad-pop', 'records-worst-party'],
    ['museum-dinosaur-map', 'museum-no-exam', 'museum-no-lecture'], ['swim-forgotten-towel', 'swim-last-place', 'swim-relay'],
    ['trains-platform-soup', 'trains-off-duty', 'trains-surprise-route'], ['bakery-warm-van', 'bakery-city-smells', 'bakery-own-pastry'],
  ];
  for (const [index, bank] of BLIND_CONVERSATION_SEEDS.entries()) {
    assert.deepEqual(bank.slice(0, 3).map(seed => seed.id), original[index].map(id => `blind-${id}`));
    assert.equal(bank.filter(seed => seed.kind === 'anecdote' || seed.kind === 'opinion').length, 3);
    assert.equal(bank[0].kind, 'anecdote');
    assert.equal(bank[2].kind, 'desire'); assert.equal(bank[2].personal, true);
    assert.ok(bank.slice(3).every(seed => !seed.personal && (seed.kind === 'anecdote' || seed.kind === 'opinion')));
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
    assert.ok(identity.conversationSeeds.length === 4 || identity.conversationSeeds.length === 5);
  }
  assert.equal(byOccupation.size, 12);
  assert.equal(new Set([...byOccupation.values()].map(ids => ids.join(','))).size, 12);
  assert.ok([...rigs.values()].every(appearances => appearances.size === 3), 'every authored job can use all three visual rigs');
});

test('new job-specific material is selectable, cannot be retold, and stays within the two-seed budget', () => {
  for (const bank of BLIND_CONVERSATION_SEEDS) {
    const overlapping = { dateId: 'mira' as const, latestHumanText: bank.map(seed => seed.topics[0]).join(' '), seeds: bank, maxSeeds: 99, includeVoiceExample: false };
    assert.ok(selectConversationSeeds(overlapping).length <= 2, 'callers cannot expand the two-seed limit');
    assert.ok(estimatedConversationContentTokens(conversationContent(overlapping)) <= 600);
    for (const item of bank.slice(3)) {
      const input = { dateId: 'mira' as const, latestHumanText: `What do you think about ${item.topics[0]}?`, seeds: bank, includeVoiceExample: false };
      const selected = selectConversationSeeds(input);
      assert.ok(selected.some(seed => seed.id === item.id), `${item.id} is reachable through its own topic`);
      assert.ok(selected.length <= 2);
      assert.ok(estimatedConversationContentTokens(conversationContent(input)) <= 600);
      assert.equal(selectConversationSeeds({ ...input, memory: `TOLD THEM: ${item.retellKeys[0]}.` }).some(seed => seed.id === item.id), false);
    }
  }
});

test('ordinary job follow-ups can reach new material after the original stories have been told', () => {
  const topics = ['music', 'pottery', 'garden', 'theater', 'aquarium', 'radio', 'buildings', 'records', 'museum', 'swimming', 'trains', 'bakery'];
  for (const [index, bank] of BLIND_CONVERSATION_SEEDS.entries()) {
    const memory = `TOLD THEM: ${bank[0].retellKeys[0]}. ${bank[1].retellKeys[0]}.`;
    for (const topic of [topics[index], 'work']) {
      const input = { dateId: 'mira' as const, latestHumanText: `Tell me more about your ${topic}.`, seeds: bank, memory, includeVoiceExample: false };
      const selected = selectConversationSeeds(input);
      assert.ok(selected.length > 0, `${bank[0].id}: ${topic} should reach new material`);
      assert.ok(selected.every(seed => bank.slice(3).some(item => item.id === seed.id)), `${topic} must not retell old material or expose a private desire`);
      assert.ok(selected.length <= 2);
      assert.ok(estimatedConversationContentTokens(conversationContent(input)) <= 600);
    }
    assert.deepEqual(selectConversationSeeds({ dateId: 'mira', latestHumanText: 'Do you prefer astronomy or chess?', seeds: bank, memory }), []);
  }
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
  assert.equal(selectConversationSeeds(base)[0]?.id, 'blind-sound-cable');
  assert.ok(ordinary.includes('desk fan') || ordinary.includes('small room'));
  assert.equal(ordinary.includes('no booked date'), false, 'private ambition is gated until disclosure is allowed');
  assert.equal(/Second Helping|After Closing|cookbook|Mira|Jules|Dev/.test(ordinary), false);
  const personal = conversationContent({ ...base, latestHumanText: 'What do you want to do with the local bands?', personalDisclosureAllowed: true });
  assert.ok(personal.includes('listening night'));
  const heard = conversationContent({ ...base, memory: 'TOLD THEM: desk fan in the guitar amp. A small room where people listen.' });
  assert.equal(heard.includes('ten minutes hunting a hum'), false);
});
