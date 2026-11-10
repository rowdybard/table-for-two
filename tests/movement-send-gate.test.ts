import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementSendGate } from '../src/restaurant/MovementSendGate';

test('a delayed move cannot reorder input, and release sends as soon as it completes', () => {
  const gate = new MovementSendGate();
  const finish = gate.begin('date', 100, true, 0, 1);
  assert.ok(finish, 'walking starts immediately');
  assert.equal(gate.begin('date', 120, false, 0, 0), undefined, 'do not let a later stop overtake the first request');
  finish();
  const stop = gate.begin('date', 125, false, 0, 0);
  assert.ok(stop, 'release does not wait for the heartbeat');
  stop();
  assert.equal(gate.begin('date', 300, false, 0, 0), undefined, 'idle does not send recurring requests');
});

test('direction changes send immediately; held movement refreshes on the heartbeat', () => {
  const gate = new MovementSendGate();
  gate.begin('date', 100, true, 0, 1)!();
  const turn = gate.begin('date', 110, true, 1, 0);
  assert.ok(turn);
  turn();
  assert.equal(gate.begin('date', 150, true, 1, 0), undefined);
  assert.ok(gate.begin('date', 191, true, 1, 0));
});

test('a stalled old session cannot block or unlock a new session', () => {
  const gate = new MovementSendGate();
  const old = gate.begin('old', 100, true, 0, 1)!;
  const current = gate.begin('new', 101, true, 0, 1);
  assert.ok(current);
  old();
  assert.equal(gate.begin('new', 102, false, 0, 0), undefined);
  current();
  assert.ok(gate.begin('new', 103, false, 0, 0));
});

test('small analog jitter waits for the heartbeat but a meaningful turn does not', () => {
  const gate = new MovementSendGate();
  gate.begin('date', 100, true, .5, .5)!();
  assert.equal(gate.begin('date', 110, true, .54, .51), undefined);
  const turn = gate.begin('date', 120, true, .8, .5);
  assert.ok(turn);
  turn();
  assert.ok(gate.begin('date', 201, true, .81, .5));
});

test('losing focus queues a stop until the pending move completes, with no further frame', () => {
  const gate = new MovementSendGate(), sends: string[] = [];
  const finishMove = gate.begin('date', 100, true, 0, 1)!;
  let finishStop: (() => void) | undefined;
  gate.stop('date', 110, complete => { sends.push('stop'); finishStop = complete; });
  assert.deepEqual(sends, [], 'the stop must not overtake the outstanding move');
  finishMove();
  assert.deepEqual(sends, ['stop'], 'completion flushes without another animation frame');
  assert.equal(gate.begin('date', 120, true, 0, 1), undefined, 'the stop is still serialized');
  finishStop!();
  assert.ok(gate.begin('date', 125, true, 0, 1));
});

test('a queued stop from an old room cannot be sent after entering a new room', () => {
  const gate = new MovementSendGate(), sends: string[] = [];
  const old = gate.begin('old', 100, true, 0, 1)!;
  gate.stop('old', 110, () => sends.push('old stop'));
  const current = gate.begin('new', 111, true, 0, 1)!;
  old();
  assert.deepEqual(sends, []);
  assert.equal(gate.begin('new', 112, false, 0, 0), undefined);
  current();
  assert.ok(gate.begin('new', 113, false, 0, 0));
});

test('new movement supersedes a queued stop when focus returns before completion', () => {
  const gate = new MovementSendGate(), sends: string[] = [];
  const old = gate.begin('date', 100, true, 0, 1)!;
  gate.stop('date', 110, () => sends.push('stop'));
  gate.begin('date', 115, true, 1, 0);
  old();
  assert.deepEqual(sends, []);
  assert.ok(gate.begin('date', 116, true, 1, 0));
});

test('a direction event behind an in-flight move is sent on completion without another frame', () => {
  const gate = new MovementSendGate(), sent: string[] = [];
  let finishFirst!: () => void, finishTurn!: () => void;
  gate.submit('date', 100, true, 0, 1, complete => { sent.push('forward'); finishFirst = complete; });
  gate.submit('date', 110, true, 1, 0, complete => { sent.push('right'); finishTurn = complete; });
  assert.deepEqual(sent, ['forward']);
  finishFirst();
  assert.deepEqual(sent, ['forward', 'right']);
  finishTurn();
});

test('the latest event wins when direction and release arrive before the pending response', () => {
  const gate = new MovementSendGate(), sent: string[] = [];
  let finishFirst!: () => void, finishStop!: () => void;
  gate.submit('date', 100, true, 0, 1, complete => { sent.push('forward'); finishFirst = complete; });
  gate.submit('date', 110, true, 1, 0, () => sent.push('obsolete right'));
  gate.submit('date', 120, false, 0, 0, complete => { sent.push('stop'); finishStop = complete; });
  finishFirst();
  assert.deepEqual(sent, ['forward', 'stop']);
  finishStop();
});

test('a new event after release supersedes the stop and keeps the latest direction', () => {
  const gate = new MovementSendGate(), sent: string[] = [];
  let finishFirst!: () => void, finishTurn!: () => void;
  gate.submit('date', 100, true, 0, 1, complete => { sent.push('forward'); finishFirst = complete; });
  gate.submit('date', 110, false, 0, 0, () => sent.push('obsolete stop'));
  gate.submit('date', 120, true, -1, 0, complete => { sent.push('left'); finishTurn = complete; });
  finishFirst();
  assert.deepEqual(sent, ['forward', 'left']);
  finishTurn();
});

test('queued input and late completions cannot cross room identities', () => {
  const gate = new MovementSendGate(), sent: string[] = [];
  let finishOld!: () => void, finishNew!: () => void;
  gate.submit('old', 100, true, 0, 1, complete => { sent.push('old forward'); finishOld = complete; });
  gate.submit('old', 110, false, 0, 0, () => sent.push('old stop'));
  gate.submit('new', 111, true, 1, 0, complete => { sent.push('new right'); finishNew = complete; });
  finishOld();
  gate.submit('new', 112, false, 0, 0, () => sent.push('new stop'));
  assert.deepEqual(sent, ['old forward', 'new right']);
  finishNew();
  assert.deepEqual(sent, ['old forward', 'new right', 'new stop']);
});
