import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferrableCue } from '../server/restaurant/dialogue-policy';
import {
  COMMIT_FINISHED_MS, COMMIT_HESITANT_MS, COMMIT_UNFINISHED_MS, HUMAN_FLOOR_MAX_MS, RECEIPT_TIMEOUT_MS, TURN_WAIT_MS,
  commitDelay, cueYieldsToHuman, isBackchannel, isFillerOnly, settled, shouldDropBackchannel, timeoutSignal, waitWhile, type WaitClock,
} from '../src/restaurant/turn-endpointing';

const F = COMMIT_FINISHED_MS, H = COMMIT_HESITANT_MS, U = COMMIT_UNFINISHED_MS;

test('the delay for finished-looking text is the 550 ms the game has always used', () => {
  assert.equal(F, 550);
  for (const text of [
    'My graduating class was less than 70 people.',
    'I love sushi!',
    'Where did you grow up?',
    'What are you looking for?',
    'Who were you with?',
    'Yes it is.',
    'I think so.',
    "I'd love to.",
    'So did I.',
    'It was just my sister and I.',
    'I really liked that.',
    'I work as a nurse at the hospital',
    'I really like sushi',
    'We drove to the coast',
    'My graduating class was less than 70',
    'I grew up in Lisbon.”',
    '“Where are you from?”',
    '',
    '   ',
  ]) assert.equal(commitDelay(text), F, JSON.stringify(text));
});

test('obvious fragments wait 1400 ms for the rest of the sentence', () => {
  assert.equal(U, 1400);
  for (const text of [
    // Trailing connectives, determiners and possessives, with or without a period.
    'My graduating class was the', 'My graduating class was the.', 'I went there because', 'I went there because.', 'I work nights and', 'I work nights but', 'You could have the soup or',
    'I was thinking about the', 'It was a', 'It was an', 'That is my', 'Tell your', 'one of our', 'a friend of', 'come with', 'smaller than', 'someone whose', 'if', 'If you want, and if',
    // Hanging punctuation.
    'My graduating class was,', 'I grew up in a small town;', 'There were two reasons:', 'I was going to-', 'I was going to —', 'I was going to –',
    // Open ending with no punctuation: contractions, question words, hesitation sounds, adverbs.
    "I think I'm", "My sister said I've", "Honestly it's", "I thought there's", 'I wonder what', 'I wonder where', 'I wonder when', 'I never knew how', 'Tell me about who', 'I forgot which',
    'It was just', 'It was very', 'I am going to be gonna', 'I think, um', 'I could uh', 'I just er', 'I wonder, hmm', 'So I was at',
    // Copulas, auxiliaries and prepositions at the end of four or more words.
    'My graduating class was', 'My graduating class were', 'The thing about my job is', 'All the people I know are', 'I think that we have', 'She said she would', 'Nobody thought we could',
    'I was just going to', 'We were planning on', 'I have been looking for', 'I wasn’t sure about', 'I really felt like',
    // Trailing off with an ellipsis after an open word.
    'I was thinking about the…', 'I went there because...', 'and...', "I'm…",
    // Quotes and brackets do not hide an open ending.
    'He said “I went there because”', '(and',
  ]) assert.equal(commitDelay(text), U, JSON.stringify(text));
});

test('short or ambiguous endings without punctuation wait 800 ms, never the full 1400', () => {
  assert.equal(H, 800);
  for (const text of [
    'Sushi', 'Yes', 'Yes please', 'Lisbon', 'Mira', 'No',
    'Yes it is', 'I was', 'I do', 'I am', 'So am I', 'I would', 'I think so', 'I really liked that', 'I mean that', 'Yeah well', 'I did not', 'We saw her', 'Yesterday I', 'Neither do I', 'My sister and I',
    "I'd love to", 'It was on', 'Come in', 'Thanks for',
    // Trailing off on a word that could be the end.
    'Sushi...', 'Yes it is…', 'I guess…',
  ]) assert.equal(commitDelay(text), H, JSON.stringify(text));
});

test('a sentence ending in ? or ! is finished however it ends, and a plain period finishes anything but a determiner or conjunction', () => {
  for (const text of ['What is it about?', 'Is she in?', 'Come with?', 'And?', 'Or?', 'I was!', 'The!', 'Which one?!', 'What for?']) assert.equal(commitDelay(text), F, text);
  for (const text of ['I know where it is.', 'It was.', 'I told you about it.', 'Here we are.', 'Just so.', 'Where I am from.', 'Where I’m from.', 'That is how it was.']) assert.equal(commitDelay(text), F, text);
  for (const text of ['It was the.', 'Salt and.', 'A friend of.', 'But.']) assert.equal(commitDelay(text), U, text);
});

test('commit delays are one of exactly three values and never faster than the old 550 ms', () => {
  const samples = ['', 'a', 'The', 'Hello.', 'Hello there friend', 'Hello there friend,', 'what', 'I was thinking', 'um', 'Fine…', "can't", 'So...', '12', 'Dessert sounds great, and', 'Sure!', '—'];
  for (const text of samples) assert.ok([F, H, U].includes(commitDelay(text)), `${JSON.stringify(text)} -> ${commitDelay(text)}`);
  for (const text of samples) assert.ok(commitDelay(text) >= 550);
});

test('curly apostrophes, odd spacing and capitals do not change the verdict', () => {
  assert.equal(commitDelay('I think I’m'), U);
  assert.equal(commitDelay('  MY   GRADUATING   CLASS   WAS  '), U);
  assert.equal(commitDelay('My graduating class\twas\nthe'), U);
  assert.equal(commitDelay('MY GRADUATING CLASS WAS LESS THAN 70 PEOPLE.'), F);
});

test('hesitation sounds alone are never a turn, but real words are', () => {
  for (const text of ['um', 'Um.', 'Um,', 'uh', 'uhh', 'Uhm...', 'umm', 'ummm', 'er', 'err', 'Erm.', 'ehm', 'hm', 'Hmm.', 'hmmmm', 'mm', 'mmm', 'Mm.', 'um uh', 'Um, uh, er...', 'hmm mm', 'UM', 'Uh... um... uh', '...', '?!', '—', ',', '. . .']) assert.equal(isFillerOnly(text), true, JSON.stringify(text));
  for (const text of ['', '   ', 'huh?', 'Huh', 'oh', 'Oh!', 'ah', 'eh?', 'mm-hmm', 'Mm-hmm.', 'uh-huh', 'mhm', 'm', 'yeah', 'no', 'hmm, maybe', 'um, I think so', 'Hmm okay', 'er... sushi', 'human', 'umbrella', 'uhura', 'herm', '70', 'a', 'I', 'Zoë']) assert.equal(isFillerOnly(text), false, JSON.stringify(text));
});

test('a back-channel is a listening noise, not an answer', () => {
  for (const text of [
    'mm-hm', 'Mm-hmm.', 'mm hmm', 'mmhmm', 'mhm', 'uh-huh', 'Uh huh.', 'uhhuh', 'hm', 'Hmm', 'mm', 'mmm',
    'yeah', 'Yeah.', 'yeah!', 'yeaah', 'yea', 'yep', 'Yup', 'okay', 'Okay.', 'OK', 'ok', 'right', 'Right!', 'oh', 'Oh.', 'ohh', 'ah', 'Ahh', 'wow', 'Woow!', 'haha', 'Ha ha ha', 'ha', 'really', 'Really?', 'I see', 'I see.',
    'yeah, yeah', 'Yeah, right.', 'oh wow', 'Oh, wow!', 'okay okay', 'mm-hm, yeah', 'oh, I see', 'Wow, really?', 'uh huh, yeah, right',
  ]) assert.equal(isBackchannel(text), true, JSON.stringify(text));
  for (const text of [
    '', '   ', 'yes', 'Yes.', 'sure', 'Sure!', 'no', 'No.', 'nope', 'um', 'uh', 'huh?', 'yeah I do', 'Yeah, I love sushi', 'okay but why', 'right now', 'right on time', 'oh my god', 'really good', 'I see you',
    'yeah no', 'okay then', 'wow that is amazing', 'ha funny', 'mm delicious', 'alright', 'okayyyy', 'yeahhh sushi', 'wait', 'sorry', 'hold on', 'stop', 'stop, yeah',
  ]) assert.equal(isBackchannel(text), false, JSON.stringify(text));
});

test('a back-channel is dropped only while a line is playing, and not when that line asks a question', () => {
  const quiet = { speaking: false, caption: '' };
  const talking = { speaking: true, caption: 'It was a tiny place in Lisbon with six tables.' };
  const asking = { speaking: true, caption: 'It was a tiny place in Lisbon. Have you ever been?' };
  for (const text of ['yeah', 'Mm-hmm.', 'right', 'okay', 'oh wow', 'I see']) {
    assert.equal(shouldDropBackchannel(text, talking), true, text);
    assert.equal(shouldDropBackchannel(text, quiet), false, `${text} after she finished is an answer`);
    assert.equal(shouldDropBackchannel(text, asking), false, `${text} may answer her question`);
  }
  // Barge-in already cut the line, so nothing is playing and the turn goes through as before.
  assert.equal(shouldDropBackchannel('yeah', { speaking: false, caption: 'It was a tiny place in Lisbon' }), false);
  // Real turns are never dropped, speaking or not.
  for (const text of ['Wait, I have been there', 'yes', 'sure', 'no', 'Yeah I love Lisbon', 'hold on']) assert.equal(shouldDropBackchannel(text, talking), false, text);
});

test('only routine pacing cues yield to a speaking human, and the list matches the server', () => {
  for (const key of ['welcome', 'seated', 'ordered', 'order-nudge', 'main-served', 'taste', 'main-finished', 'quiet-window', 'dessert-date-choice', 'dessert-ordered', 'dessert-served', 'dessert-shared', 'dessert-skipped', 'bill-requested', 'bill-settled', 'care-water-served', 'beat-1', 'beat-story-two']) assert.equal(cueYieldsToHuman(key), true, key);
  for (const key of ['ending', 'ending-complete', 'ending-walkout', 'farewell-invite', 'spill-help', 'spill-wiped', 'glass', 'repair', 'medical-care', 'boundary-hold', 'incident-noisy', 'scenario-open', '']) assert.equal(cueYieldsToHuman(key), false, key);
  // Drift guard: the client must classify every cue the same way the server's deferral does, except
  // where it is deliberately stricter (never the other way round).
  for (const key of ['welcome', 'seated', 'ordered', 'order-nudge', 'main-served', 'taste', 'main-finished', 'quiet-window', 'dessert-date-choice', 'dessert-ordered', 'dessert-served', 'dessert-shared', 'dessert-skipped', 'bill-requested', 'bill-settled', 'care-water-served', 'beat-1', 'ending', 'ending-complete', 'farewell-invite', 'spill-help', 'spill-wiped', 'glass', 'repair', 'unknown-cue']) {
    assert.equal(cueYieldsToHuman(key), deferrableCue(key), `client and server disagree on ${key}`);
  }
});

function fakeClock() {
  let time = 0; const sleeps: number[] = [];
  const clock: WaitClock = { now: () => time, sleep: async ms => { sleeps.push(ms); time += ms; } };
  return { clock, sleeps, get time() { return time; }, advance(ms: number) { time += ms; } };
}

test('waitWhile returns at once when nothing holds the floor', async () => {
  const fake = fakeClock();
  assert.equal(await waitWhile(() => false, 6000, 100, fake.clock), true);
  assert.deepEqual(fake.sleeps, []);
});

test('waitWhile polls until the hold is released', async () => {
  const fake = fakeClock(); let holds = 3;
  assert.equal(await waitWhile(() => holds-- > 0, 6000, 100, fake.clock), true);
  assert.deepEqual(fake.sleeps, [100, 100, 100]);
});

test('waitWhile gives up at the cap so a stuck hold cannot mute the scene', async () => {
  const fake = fakeClock();
  assert.equal(await waitWhile(() => true, 6000, 100, fake.clock), false);
  assert.equal(fake.time, 6000);
  assert.equal(fake.sleeps.length, 60);
  const odd = fakeClock();
  assert.equal(await waitWhile(() => true, 250, 100, odd.clock), false);
  assert.deepEqual(odd.sleeps, [100, 100, 50]);
  assert.equal(HUMAN_FLOOR_MAX_MS, 6000);
});

test('waitWhile re-checks the hold every step, so a cancelled scene stops waiting immediately', async () => {
  const fake = fakeClock(); let epoch = 1; const mine = epoch;
  const result = await waitWhile(() => mine === epoch, 6000, 100, { now: fake.clock.now, sleep: async ms => { await fake.clock.sleep(ms); if (fake.time >= 300) epoch = 2; } });
  assert.equal(result, true);
  assert.equal(fake.time, 300);
});

test('waitWhile works with the real clock', async () => {
  let release = false; setTimeout(() => { release = true; }, 30);
  const started = performance.now();
  assert.equal(await waitWhile(() => !release, 2000, 10), true);
  assert.ok(performance.now() - started < 1000);
  assert.equal(await waitWhile(() => true, 40, 10), false);
});

test('settled resolves true when the promise settles in time, whether it resolves or rejects', async () => {
  assert.equal(await settled(Promise.resolve('fine'), 1000), true);
  assert.equal(await settled(Promise.reject(new Error('Connection failed.')), 1000), true);
  assert.equal(await settled(new Promise(resolve => setTimeout(resolve, 10)), 1000), true);
});

test('settled gives up on a stalled promise without cancelling or failing it', async () => {
  let finish!: (value: string) => void; const stalled = new Promise<string>(resolve => { finish = resolve; });
  const started = performance.now();
  assert.equal(await settled(stalled, 30), false);
  assert.ok(performance.now() - started < 1000);
  finish('late'); assert.equal(await stalled, 'late');
  const failing = new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late failure')), 60));
  assert.equal(await settled(failing, 10), false);
  await failing.catch(() => {});
});

test('the mic path bounds are tighter than a request timeout and looser than ordinary latency', () => {
  assert.equal(TURN_WAIT_MS, 2500);
  assert.equal(RECEIPT_TIMEOUT_MS, 5000);
  assert.ok(TURN_WAIT_MS < RECEIPT_TIMEOUT_MS);
});

test('timeoutSignal aborts after the delay with a timeout reason', async () => {
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout does not keep Node alive.
  try {
    const signal = timeoutSignal(20);
    assert.equal(signal.aborted, false);
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    assert.equal(signal.aborted, true);
    assert.equal((signal.reason as Error).name, 'TimeoutError');
  } finally { clearInterval(keepAlive); }
});

test('timeoutSignal falls back when AbortSignal.timeout is unavailable', async () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
  try {
    const signal = timeoutSignal(20);
    assert.equal(signal.aborted, false);
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    assert.equal(signal.aborted, true);
    assert.equal((signal.reason as Error).name, 'TimeoutError');
  } finally {
    if (original) Object.defineProperty(AbortSignal, 'timeout', original); else Reflect.deleteProperty(AbortSignal, 'timeout');
  }
});
