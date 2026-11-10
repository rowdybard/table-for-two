import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FacialPerformance, type PerformanceInput } from '../src/restaurant/render/FacialPerformance';
import type { Emotion } from '../src/restaurant/types';

const input = (overrides: Partial<PerformanceInput> = {}): PerformanceInput =>
  ({ emotion: 'neutral', speaking: false, amplitude: 0, attentive: false, reducedMotion: false, ...overrides });

function run(face: FacialPerformance, seconds: number, from: number, next: PerformanceInput, step = 1 / 60) {
  const frames = [] as ReturnType<FacialPerformance['update']>[];
  for (let t = from; t < from + seconds; t += step) frames.push({ ...face.update(t, step, next) });
  return frames;
}

test('a smile blooms over a few frames instead of snapping', () => {
  const face = new FacialPerformance(3);
  run(face, 1, 0, input());
  const frames = run(face, 1, 1, input({ emotion: 'amused' }));
  assert.ok(frames[0].smile < .4, 'the first frame is still mostly neutral');
  assert.ok(frames[10].smile > frames[0].smile && frames[10].smile < .95, 'the smile is still rising a sixth of a second in');
  assert.ok(frames.at(-1)!.smile > .9, 'the smile settles near its target');
  assert.ok(frames.at(-1)!.squint > .4, 'a real smile raises the cheeks');
  assert.ok(frames.at(-1)!.asymmetry > .2, 'an amused smile is lopsided');
});

test('blinks are irregular, close fast and open slower', () => {
  const face = new FacialPerformance(11);
  const frames = run(face, 30, 0, input(), 1 / 120);
  const closed: number[] = [];
  for (let i = 1; i < frames.length; i++) if (frames[i - 1].eyeOpen > .5 && frames[i].eyeOpen <= .5) closed.push(i / 120);
  assert.ok(closed.length >= 4 && closed.length <= 14, `about four to fourteen blinks in thirty seconds, saw ${closed.length}`);
  const gaps = closed.slice(1).map((t, i) => t - closed[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > .5, 'blink intervals vary');
  const start = frames.findIndex(f => f.eyeOpen < .95);
  const bottom = frames.slice(start).findIndex(f => f.eyeOpen <= .05) + start;
  const reopened = frames.slice(bottom).findIndex(f => f.eyeOpen > .95) + bottom;
  assert.ok(bottom - start < reopened - bottom, 'closing takes less time than reopening');
});

test('reduced motion keeps the expression but removes blinks, saccades and nods', () => {
  const face = new FacialPerformance(5);
  const frames = run(face, 20, 0, input({ emotion: 'warm', reducedMotion: true }));
  assert.ok(frames.every(f => f.eyeOpen > .9), 'no blinks');
  assert.ok(frames.every(f => Math.abs(f.gazeX) < .01 && Math.abs(f.gazeY) < .01), 'no saccades');
  assert.ok(frames.every(f => Math.abs(f.headYaw) < .01), 'no idle head drift');
  assert.ok(frames.at(-1)!.smile > .6, 'warmth still shows');
});

test('listening nods more than idling, and embarrassment looks down and away', () => {
  const attentive = new FacialPerformance(21), idle = new FacialPerformance(21);
  const nods = (frames: ReturnType<typeof run>) => frames.filter(f => f.headPitch > .02).length;
  const nodsAttentive = nods(run(attentive, 40, 0, input({ attentive: true })));
  const nodsIdle = nods(run(idle, 40, 0, input()));
  assert.ok(nodsAttentive > nodsIdle * 2, `attentive ${nodsAttentive} frames vs idle ${nodsIdle}`);
  const shy = new FacialPerformance(8);
  const frames = run(shy, 40, 0, input({ emotion: 'embarrassed' }));
  assert.ok(frames.some(f => f.gazeY < -.3), 'the eyes drop at some point');
  assert.ok(frames.every(f => f.headPitch > 0), 'the head stays a little lowered');
  assert.ok(frames.at(-1)!.browInner > .4, 'inner brows raise');
});

test('every emotion settles to bounded, finite values', () => {
  const emotions: Emotion[] = ['neutral', 'amused', 'warm', 'flirtatious', 'embarrassed', 'annoyed', 'angry', 'defensive', 'surprised'];
  for (const emotion of emotions) {
    const face = new FacialPerformance(2);
    const last = run(face, 6, 0, input({ emotion, speaking: emotion === 'warm', amplitude: .6 })).at(-1)!;
    for (const [key, value] of Object.entries(last)) {
      assert.ok(Number.isFinite(value), `${emotion}.${key} is finite`);
      assert.ok(Math.abs(value) <= 1.3, `${emotion}.${key}=${value} stays in range`);
    }
  }
  const surprised = new FacialPerformance(2);
  const early = run(surprised, .5, 0, input({ emotion: 'surprised' })).at(-1)!;
  const late = run(surprised, 6, .5, input({ emotion: 'surprised' })).at(-1)!;
  assert.ok(early.jaw > late.jaw + .1, 'a dropped jaw recovers while brows stay raised');
  assert.ok(late.browLift > .002);
});

test('hand beats ride speech peaks and never happen in silence or reduced motion', () => {
  const talking = new FacialPerformance(4);
  let beats = 0, previous = 0;
  for (let t = 0; t < 20; t += 1 / 60) {
    const amplitude = .35 + .45 * Math.max(0, Math.sin(t * 5.1)) * (Math.sin(t * .9) > 0 ? 1 : .2);
    const pose = talking.update(t, 1 / 60, input({ emotion: 'warm', speaking: true, amplitude }));
    if (previous < .5 && pose.beat >= .5) beats++;
    previous = pose.beat;
  }
  assert.ok(beats >= 4 && beats <= 20, `beats on peaks over twenty seconds of talking, saw ${beats}`);
  const quiet = run(new FacialPerformance(4), 10, 0, input({ emotion: 'warm' }));
  assert.ok(quiet.every(f => f.beat === 0), 'no beats while listening');
  const still = run(new FacialPerformance(4), 10, 0, input({ speaking: true, amplitude: .9, reducedMotion: true }));
  assert.ok(still.every(f => f.beat < .01), 'reduced motion keeps hands at rest');
});

test('a new delivered line refreshes the same emotion while a stable cue does not restart it', () => {
  const face = new FacialPerformance(2);
  run(face, 6, 0, input({ emotion: 'surprised', deliveryId: 'one' }));
  const settledJaw = face.pose.jaw;
  run(face, .5, 6, input({ emotion: 'surprised', deliveryId: 'two' }));
  assert.ok(face.pose.jaw > settledJaw + .2, 'a second surprise has its own reaction envelope');
  run(face, 6, 6.5, input({ emotion: 'surprised', deliveryId: 'two' }));
  assert.ok(face.pose.jaw < .05, 'the stable cue does not retrigger every frame');
});

test('delivery accents wait for actual presentation, cancel with it, and respect reduced motion', () => {
  const waiting = new FacialPerformance(4), delivered = new FacialPerformance(4);
  run(waiting, 4, 0, input({ deliveryId: null })); run(delivered, 4, 0, input({ deliveryId: null }));
  run(waiting, .35, 4, input({ deliveryId: null }));
  run(delivered, .35, 4, input({ deliveryId: 'actual' }));
  assert.ok(delivered.pose.browLift > waiting.pose.browLift + .0004);
  run(delivered, 1, 4.35, input({ deliveryId: null }));
  assert.ok(delivered.pose.browLift < .0001);
  const still = new FacialPerformance(4);
  assert.ok(run(still, 1, 0, input({ deliveryId: 'actual', reducedMotion: true })).every(pose => pose.browLift === 0));
});
