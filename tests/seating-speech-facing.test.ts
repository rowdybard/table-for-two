import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SeatingSpeechFacing, facingPlayerYaw } from '../src/restaurant/render/SeatingSpeechFacing';

test('local speech turns toward the player on its first approach frame and holds until arrival', () => {
  const facing = new SeatingSpeechFacing();
  assert.equal(facing.update('room', false, false, true, true), false, 'ordinary walking is unchanged');
  assert.equal(facing.update('room', true, false, false, true), false, 'the approach is unchanged before speech');
  assert.equal(facing.update('room', true, false, true, true), true, 'the first speech frame faces the player');
  assert.equal(facingPlayerYaw(1, -1, 0, 1), Math.atan2(-1, 2));
  assert.equal(facing.update('room', true, false, false, true), true, 'the completed line does not turn the date away while approaching');
  assert.equal(facing.update('room', true, true, false, true), true, 'arrival still faces the player');
  assert.equal(facing.update('room', true, true, true, true), false, 'ordinary seated posing resumes afterward');
});

test('another speaker and an unavailable local date do not redirect the walking actor', () => {
  const facing = new SeatingSpeechFacing();
  assert.equal(facing.update('room', true, false, false, true), false, 'another speaker does not claim the local date');
  assert.equal(facing.update('room', true, false, true, false), false, 'hidden, departed or wingman dates do not claim facing');
  assert.equal(facing.update('room', false, false, true, true), false, 'speech during ordinary walking keeps existing facing');
});

test('standing, unavailable scenes and room changes clear any seating claim', () => {
  for (const reset of [
    (facing: SeatingSpeechFacing) => facing.update('old', false, false, false, true),
    (facing: SeatingSpeechFacing) => facing.update('old', true, false, false, false),
    (facing: SeatingSpeechFacing) => facing.update('new', true, false, false, true),
  ]) {
    const facing = new SeatingSpeechFacing();
    assert.equal(facing.update('old', true, false, true, true), true);
    assert.equal(reset(facing), false);
    assert.equal(facing.update('new', true, false, false, true), false, 'an old line cannot steer a fresh scene');
  }
});
