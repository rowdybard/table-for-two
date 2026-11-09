import assert from 'node:assert/strict';
import test from 'node:test';
import { CONVERSATION_SEEDS, VOICE_EXCHANGES, conversationContentNote, estimatedConversationContentTokens, selectConversationSeeds } from '../src/restaurant/conversation-content';

test('Mira first slice has grounded variety and preserves the unfinished exhibition', () => {
  const bank = CONVERSATION_SEEDS.mira;
  assert.equal(bank.length, 18);
  assert.deepEqual(['anecdote', 'opinion', 'contradiction', 'desire'].map(kind => bank.filter(seed => seed.kind === kind).length), [6, 6, 3, 3]);
  assert.equal(VOICE_EXCHANGES.mira.length, 6);
  assert.match(bank.find(seed => seed.id === 'mira-after-closing')!.text, /no booking or date/);
  assert.equal(selectConversationSeeds({ dateId: 'mira', latestHumanText: 'What is your dream for After Closing?' }).length, 0);
  assert.ok(selectConversationSeeds({ dateId: 'mira', latestHumanText: 'What is your dream for After Closing?', personalDisclosureAllowed: true }).some(seed => seed.id === 'mira-after-closing'));
});

test('material follows the latest topic without retelling, overriding a stop or filling a greeting with lore', () => {
  const input = { dateId: 'mira' as const, latestHumanText: 'Tell me about the wedding photo job.' };
  assert.equal(selectConversationSeeds(input).length, 2);
  assert.ok(!selectConversationSeeds({ ...input, memory: 'HUMAN: likes weddings\nTOLD THEM: grandmother held the chair\nOPEN: nothing' }).some(seed => seed.id === 'mira-chair'));
  assert.ok(!selectConversationSeeds({ ...input, recentDateLines: ['The bride’s grandmother steadied the chair.'] }).some(seed => seed.id === 'mira-chair'));
  assert.deepEqual(selectConversationSeeds({ ...input, latestHumanText: 'No more wedding stories.' }), []);
  assert.deepEqual(selectConversationSeeds({ ...input, stoppedTopics: ['photo', 'wedding', 'job', 'work'] }), []);
  assert.deepEqual(selectConversationSeeds({ ...input, latestHumanText: 'Hi.' }), []);
  assert.equal(conversationContentNote({ ...input, latestHumanText: 'What is seven plus four?' }), '');
});

test('selected material and voice fit the bounded prompt budget; Blind never borrows the rig biography', () => {
  const note = conversationContentNote({ dateId: 'mira', latestHumanText: 'I am worried about work, music, your show and the wedding photos. Tell me your dream.', personalDisclosureAllowed: true });
  assert.ok(estimatedConversationContentTokens(note) <= 600);
  assert.ok(note.split('\n').filter(line => /^(?:anecdote|opinion|contradiction|desire):/.test(line)).length <= 2);
  assert.equal(conversationContentNote({ dateId: 'mira', latestHumanText: 'Hi.', seeds: [], includeVoiceExample: false }), '');
  const blind = { id: 'blind-clay', kind: 'anecdote' as const, text: 'A student made a cup with three handles.', topics: ['cup'], retellKeys: ['three handles'] };
  const own = conversationContentNote({ dateId: 'mira', latestHumanText: 'Tell me about the cup.', seeds: [blind], includeVoiceExample: false });
  assert.match(own, /three handles/);
  assert.doesNotMatch(own, /Ada|After Closing|photograph/);
});

test('all preset banks and exchanges have the agreed variety, unique anchors and bounded additions', () => {
  for (const dateId of ['mira', 'jules', 'dev'] as const) {
    const bank = CONVERSATION_SEEDS[dateId];
    assert.equal(bank.length, 18);
    assert.equal(new Set(bank.map(seed => seed.id)).size, 18);
    assert.deepEqual(['anecdote', 'opinion', 'contradiction', 'desire'].map(kind => bank.filter(seed => seed.kind === kind).length), [6, 6, 3, 3]);
    assert.deepEqual(VOICE_EXCHANGES[dateId].map(example => example.kind), ['teasing', 'attraction', 'disagreement', 'vulnerability', 'repair', 'opening']);
    for (const seed of bank) {
      assert.ok(seed.topics.length && seed.retellKeys.length);
      assert.ok(!selectConversationSeeds({ dateId, latestHumanText: seed.topics.join(' '), personalDisclosureAllowed: true, memory: `HUMAN: nothing yet\nTOLD THEM: ${seed.retellKeys[0]}\nOPEN: nothing` }).some(item => item.id === seed.id), `${seed.id} must not be told again`);
      assert.ok(estimatedConversationContentTokens(conversationContentNote({ dateId, latestHumanText: seed.topics.join(' '), personalDisclosureAllowed: true })) <= 600);
    }
  }
});

test('Double can divide the two-seed/600-token allowance and caller values cannot expand it', () => {
  const input = { dateId: 'dev' as const, latestHumanText: 'Tell me about work and the bike job. I like you.', personalDisclosureAllowed: true };
  assert.equal(selectConversationSeeds({ ...input, maxSeeds: 1 }).length, 1);
  assert.equal(selectConversationSeeds({ ...input, maxSeeds: 99 }).length, 2);
  assert.equal(selectConversationSeeds({ ...input, maxSeeds: 0 }).length, 0);
  assert.ok(estimatedConversationContentTokens(conversationContentNote({ ...input, maxSeeds: 1, maxEstimatedTokens: 300 })) <= 300);
  assert.ok(estimatedConversationContentTokens(conversationContentNote({ ...input, maxEstimatedTokens: 9000 })) <= 600);
  assert.equal(conversationContentNote({ ...input, maxEstimatedTokens: 0 }), '');
  assert.equal(conversationContentNote({ ...input, maxEstimatedTokens: 10 }), '');
  assert.ok(selectConversationSeeds({ ...input, latestHumanText: 'Don’t you like work on a bike?' }).length > 0);
});
