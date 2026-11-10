import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { DoubleTableScene, createPairView } from '../server/double-date/scene';
import { emptyUsage } from '../server/restaurant/scene';
import type { DoubleDateRoomState } from '../src/restaurant/double-date-types';

before(async () => { await RAPIER.init(); });

function fixture() {
  const usage = emptyUsage();
  const room: DoubleDateRoomState = {
    id: 'scene-regression', code: 'SCENES', mode: 'double-date', phase: 'playing', hostId: 'h1', generation: 0, revision: 0,
    members: [
      { id: 'h1', name: 'Alex', connected: true, ready: true, dateId: 'mira', position: [0, 0, 0], yaw: 0, seated: true },
      { id: 'h2', name: 'Sam', connected: true, ready: true, dateId: 'jules', position: [0, 0, 0], yaw: 0, seated: true },
    ],
    dates: [], views: { h1: createPairView('scene-regression', 'h1', 'Alex', 'mira', usage, 2), h2: createPairView('scene-regression', 'h2', 'Sam', 'jules', usage, 2) },
    lines: [], usage, sessionLimit: 2, model: 'claude-haiku-5-5', voice: { enabled: { h1: false, h2: false }, epoch: 0, iceServers: [] },
  };
  const scene = new DoubleTableScene(room);
  scene.chooseDate('h1', 'mira'); scene.chooseDate('h2', 'jules'); scene.setPhase('playing');
  return { room, scene };
}

test('ending one pair preserves the other pair’s private notebook and conversation', () => {
  const { room, scene } = fixture();
  try {
    const firstNotebook = 'HUMAN: An established conversation before the date ended.';
    const secondNotebook = `HUMAN: ${'A'.repeat(500)}\nTOLD THEM: a private fact\nOPEN: a promise to share music`;
    room.views.h1.memory = firstNotebook; room.views.h2.memory = secondNotebook;
    scene.command('h1', { type: 'finish' }, 1100);
    assert.equal(room.views.h1.phase, 'ended'); assert.equal(room.views.h1.memory, firstNotebook);
    assert.equal(room.views.h2.phase, 'playing'); assert.equal(room.views.h2.memory, secondNotebook);
    assert.ok(secondNotebook.length <= 700); assert.match(secondNotebook, /^HUMAN:.*\nTOLD THEM:.*\nOPEN:/);
    assert.equal(room.views.h2.evening.cues.length, 0);
  } finally { scene.free(); }
});
