import assert from 'node:assert/strict';
import { test } from 'node:test';
import { namedDessertIn, withdrawsDessert } from '../server/restaurant/evening';

test('only one clearly named dessert counts, and a negated or ambiguous mention decides nothing', () => {
  assert.equal(namedDessertIn('Let’s get the lemon one.'), 'lemon');
  assert.equal(namedDessertIn('I would love the chocolate fondant.'), 'chocolate');
  assert.equal(namedDessertIn('Strawberries, please.'), 'berries');
  assert.equal(namedDessertIn('Not the lemon, I had it last week.'), null);
  assert.equal(namedDessertIn('Lemon or chocolate?'), null);
  assert.equal(namedDessertIn('What is in the fondant?'), null, 'asking about a dessert is not choosing it, so the date is not recorded as ordering what they asked for');
  assert.equal(namedDessertIn('Shall we get the lemon?'), 'lemon', 'a question that proposes one still counts');
  assert.equal(namedDessertIn('What about the chocolate?'), 'chocolate');
  for (const text of ['I can’t have chocolate, I’m allergic.', 'I’m allergic to strawberries.', 'I avoid lemon, honestly.', 'Anything but the fondant.', 'I’m sick of chocolate.', 'Everything except the lemon.']) assert.equal(namedDessertIn(text), null, text);
  // A pick said as a question, or beside a question, still counts; a question only about a dessert does not.
  for (const [text, id] of [
    ['Chocolate?', 'chocolate'], ['The lemon one?', 'lemon'], ['Chocolate for me. You?', 'chocolate'], ['I was thinking chocolate, what do you think?', 'chocolate'], ['Can I have the lemon?', 'lemon'], ['I can’t wait to try the lemon.', 'lemon'], ['Shouldn’t we get the lemon?', 'lemon'],
    ['would like the lemon please', 'lemon'], ['has to be the chocolate', 'chocolate'], ['can’t go wrong with the chocolate', 'chocolate'], ['do the fondant', 'chocolate'], ['hmm the lemon one', 'lemon'],
    ['what are you having im going with the lemon', 'lemon'], ['do you mind if I go with the lemon', 'lemon'], ['would it be weird if I got the lemon', 'lemon'], ['I was wondering if I could get the lemon', 'lemon'], ['Why don’t we get the lemon?', 'lemon'], ['Why not the chocolate?', 'chocolate'],
    ['im allergic to nuts so the lemon please', 'lemon'], ['I can’t have dairy so the lemon', 'lemon'], ['not the lemon but the chocolate', 'chocolate'],
  ] as const) assert.equal(namedDessertIn(text), id, text);
  for (const text of [
    'I can’t decide between lemon and chocolate.', 'Does the lemon have nuts?', 'Is the chocolate any good?', 'Which one is the fondant?', 'What is in the fondant, is it very rich?', 'I won’t have the lemon.', 'Did you try the lemon?',
    'hmm what’s in the fondant', 'uhm what is in the lemon posset', 'excuse me what’s in the fondant', 'Eli what’s in the fondant', 'whats in the fondant', 'Can I ask what’s in the fondant?', 'Could I ask if the lemon has nuts?',
    'I’d like to know what’s in the fondant', 'I’ll ask what’s in the fondant', 'What about nuts in the fondant?', 'I was wondering what’s in the fondant', 'I wonder if the lemon is sweet', 'Tell me more about the fondant', 'quick question is the chocolate vegan',
  ]) assert.equal(namedDessertIn(text), null, text);
  // Taking a pick back clears it, without a question about it doing so.
  assert.equal(withdrawsDessert('actually not the lemon', 'lemon'), true);
  for (const text of ['is the lemon sweet', 'I’m allergic to strawberries', 'the lemon is fine']) assert.equal(withdrawsDessert(text, 'lemon'), false, text);
  assert.equal(namedDessertIn('That was a lovely main.'), null);
});
