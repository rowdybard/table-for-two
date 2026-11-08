import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsAdultConversation, type ConversationRoutingContext } from '../server/restaurant/conversation-routing';

const user = (content: string) => ({ role: 'user' as const, content });
const assistant = (content: string) => ({ role: 'assistant' as const, content });
const adultHistory = [user('How important is sexual compatibility to you?'), assistant('Trust and clear communication matter to me.')];

test('explicit sexual compatibility, preferences and boundaries select adult conversation', () => {
  for (const text of [
    'How important is sex in a relationship?',
    'Can we discuss sexual boundaries and preferences?',
    'What turns you on?',
    'Do you have any kinks?',
    'Would you share a fetish you feel comfortable discussing?',
    'What is your sex drive like?',
    'Does flirting ever make you feel horny?',
    'What do you like in bed?',
    'How do you feel about physical intimacy?',
    'Would you prefer being dominant or submissive?',
    'How do you feel about one-night stands?',
    'Sex is not very important to me. What about you?',
  ]) assert.equal(needsAdultConversation({ text }), true, text);
});

test('ordinary bold flirting, food, weather and bedtime stay on normal conversation', () => {
  for (const text of [
    'You are hot, and I want to kiss you.',
    'I am attracted to you. Want to go on another date?',
    'You look sexy tonight.',
    'Being rude to staff is a big turn-off for me.',
    'I would love to take you home.',
    'This curry is hot!',
    'It is hot outside today.',
    'I go to bed early because I work in the morning.',
    'I like emotional intimacy and feeling understood.',
    'What is your idea of a fun first date?',
    'I visited Essex and Sussex last year.',
  ]) assert.equal(needsAdultConversation({ text, recentTurns: adultHistory }), false, text);
});

test('factual orientation, identity and pet sex do not select the adult provider', () => {
  for (const text of [
    'What is your sexual orientation?',
    'How do you describe your sexual identity?',
    'What does sexuality mean to you?',
    'Are you sexually attracted to men or women?',
    'Are you in favor of same-sex marriage?',
    'What sex is your dog?',
    'What is the sex of your cat?',
    'Can a vet tell the sex of a kitten?',
    'We learned about sex chromosomes in biology.',
    'What is your sex?',
  ]) assert.equal(needsAdultConversation({ text, recentTurns: adultHistory }), false, text);
  assert.equal(needsAdultConversation({ text: 'Sexual orientation aside, what sexual preferences matter to you?' }), true);
});

test('declining a sexual topic exits immediately, including inherited short followups', () => {
  for (const text of [
    "I don't want to talk about sex.",
    "I'd rather not discuss that.",
    'I am not comfortable talking about sex.',
    'I would prefer not to discuss sex.',
    'Can we stop talking about sex?',
    "Let's not discuss sex.",
    'Can we change the subject?',
    "Let's talk about something else.",
    "Let's not go there.",
    'Keep it PG, please.',
    'I am not ready for sex.',
    "I don't want sex right now.",
  ]) {
    assert.equal(needsAdultConversation({ text, recentTurns: adultHistory }), false, text);
    assert.equal(needsAdultConversation({ text: 'What about you?', recentTurns: [...adultHistory, user(text)] }), false, text);
  }
});

test('short followups inherit a recent actual adult discussion but do not initiate one', () => {
  for (const text of ['What about you?', 'Tell me more.', 'How so?', 'And you?', 'What do you prefer?', 'That makes sense. Tell me more, please.']) {
    assert.equal(needsAdultConversation({ text, recentTurns: adultHistory }), true, text);
    assert.equal(needsAdultConversation({ text }), false, text);
    assert.equal(needsAdultConversation({ text, recentTurns: [user('What music do you enjoy?'), assistant('Jazz.')] }), false, text);
  }
  assert.equal(needsAdultConversation({ text: 'Tell me more about your work.', recentTurns: adultHistory }), false);
  assert.equal(needsAdultConversation({ text: 'I enjoy gardening.', recentTurns: adultHistory }), false);
});

test('the newest concrete topic wins both across turns and within the latest message', () => {
  const examples: [string, boolean][] = [
    ['How important is sex? What is your favorite movie?', false],
    ["Let's change the subject. What turns you on?", true],
    ["What are your kinks? Actually, let's talk about music.", false],
    ['How important is sex? On another note, I enjoy gardening.', false],
    ['What music do you like? How important is sexual compatibility?', true],
  ];
  for (const [text, expected] of examples) assert.equal(needsAdultConversation({ text }), expected, text);
  assert.equal(needsAdultConversation({ text: 'What about you?', recentTurns: [...adultHistory, user('I enjoy gardening.')] }), false);
  assert.equal(needsAdultConversation({ text: 'Tell me more.', recentTurns: [...adultHistory, assistant('What is your favorite movie?')] }), false);
  assert.equal(needsAdultConversation({ text: 'What about you?', recentTurns: [user('I love music.'), user('What are your sexual boundaries?')] }), true);
});

test('only completed spoken JSON history contributes, never scene or private metadata', () => {
  const spoken = (delivery: string) => JSON.stringify({ spokenResponse: [{ speaker: 'date', text: 'Sexual compatibility matters to me.', delivery }], memory: 'sex', social: { boundary: { topic: 'sex' } } });
  assert.equal(needsAdultConversation({ text: 'Tell me more.', recentTurns: [assistant(spoken('heard completely'))] }), true);
  for (const delivery of ['not heard; response was interrupted', 'awaiting playback; do not assume it was heard', 'interrupted partway; do not assume the whole line was heard']) {
    assert.equal(needsAdultConversation({ text: 'Tell me more.', recentTurns: [assistant(spoken(delivery))] }), false, delivery);
  }
  assert.equal(needsAdultConversation({ text: 'Tell me more.', recentTurns: [assistant(JSON.stringify({ memory: 'Sexual preferences.', scene: { topic: 'sex' } }))] }), false);
  assert.equal(needsAdultConversation({ text: 'Tell me more.', recentTurns: [assistant(JSON.stringify({ spokenResponse: [{ speaker: 'waiter', text: 'Sexual compatibility.', delivery: 'heard completely' }] }))] }), false);
  assert.equal(needsAdultConversation({ text: 'Tell me more.', recentTurns: [...adultHistory, assistant(JSON.stringify({ spokenResponse: [{ speaker: 'diner', text: 'This dessert is wonderful.', delivery: 'heard completely' }] }))] }), true, 'incidental diners cannot change the date conversation topic');
  assert.equal(needsAdultConversation({ text: 'Tell me more.', recentTurns: [user(JSON.stringify({ playerSaid: 'How important is sex?', scene: { topic: 'movies' } }))] }), true);
  assert.equal(needsAdultConversation({ text: 'Tell me more.', recentTurns: [assistant('{"spokenResponse":')] }), false);
});

test('history is bounded and the detector does not mutate caller data', () => {
  const recentTurns = Object.freeze([user('How important is sex?'), ...Array.from({ length: 8 }, () => assistant('That makes sense.'))].map(turn => Object.freeze(turn)));
  const context: ConversationRoutingContext = Object.freeze({ text: 'Tell me more.', recentTurns });
  assert.equal(needsAdultConversation(context), false, 'a topic outside the eight-turn window does not linger');
  assert.equal(recentTurns[0].content, 'How important is sex?');
});
