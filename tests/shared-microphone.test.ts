import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SharedMicrophone } from '../src/restaurant/SharedMicrophone';

class Track {
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  stop() { this.readyState = 'ended'; }
  clone() { return new Track(); }
}
class Stream {
  constructor(readonly tracks: Track[]) {}
  getAudioTracks() { return this.tracks; }
  getTracks() { return this.tracks; }
}
function microphone(capture: () => Promise<Stream>) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const streamDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: capture } } });
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: Stream });
  return () => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else Reflect.deleteProperty(globalThis, 'navigator');
    if (streamDescriptor) Object.defineProperty(globalThis, 'MediaStream', streamDescriptor); else Reflect.deleteProperty(globalThis, 'MediaStream');
  };
}

test('friend voice and recognition share one permission grant while mute and release stay independent', async () => {
  const source = new Stream([new Track()]); let grants = 0;
  const restore = microphone(async () => { grants++; return source; });
  const capture = new SharedMicrophone();
  try {
    const [voice, recognition] = await Promise.all([capture.acquire(), capture.acquire()]);
    assert.equal(grants, 1);
    assert.notEqual(voice.getAudioTracks()[0], recognition.getAudioTracks()[0]);
    voice.getAudioTracks()[0].enabled = false;
    assert.equal(recognition.getAudioTracks()[0].enabled, true);
    capture.release(voice);
    assert.equal(voice.getTracks()[0].readyState, 'ended');
    assert.equal(source.tracks[0].readyState, 'live');
    assert.equal(recognition.getTracks()[0].readyState, 'live');
    capture.release(recognition);
    assert.equal(source.tracks[0].readyState, 'ended');
  } finally { capture.dispose(); restore(); }
});

test('denied capture can be retried and a permission result arriving after disposal is stopped', async () => {
  const source = new Stream([new Track()]); let calls = 0;
  let resolveLate!: (stream: Stream) => void;
  const restore = microphone(() => ++calls === 1 ? Promise.reject(new DOMException('Denied', 'NotAllowedError')) : new Promise(resolve => { resolveLate = resolve; }));
  const capture = new SharedMicrophone();
  try {
    await assert.rejects(capture.acquire(), { name: 'NotAllowedError' });
    const pending = capture.acquire();
    capture.dispose(); resolveLate(source);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(source.tracks[0].readyState, 'ended');
    assert.equal(calls, 2);
    await assert.rejects(capture.acquire(), { name: 'AbortError' });
  } finally { capture.dispose(); restore(); }
});

test('background suspension stops capture and a late permission result cannot reopen it', async () => {
  const old = new Stream([new Track()]), next = new Stream([new Track()]); let complete!: (stream: Stream) => void, calls = 0;
  const restore = microphone(() => ++calls === 1 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve(next));
  const capture = new SharedMicrophone();
  try {
    const pending = capture.acquire(); capture.suspend();
    const resumed = await capture.acquire(); complete(old);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(old.tracks[0].readyState, 'ended'); assert.equal(resumed.getTracks()[0].readyState, 'live');
    capture.suspend(); assert.equal(next.tracks[0].readyState, 'ended'); assert.equal(resumed.getTracks()[0].readyState, 'ended');
  } finally { capture.dispose(); restore(); }
});
