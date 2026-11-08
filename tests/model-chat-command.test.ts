import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelChatCommand, savedConversationModel } from '../src/restaurant/ModelChatCommand';
import { HORDE_MODEL } from '../src/restaurant/types';

test('typed model controls have exact names and never reinterpret ordinary conversation', () => {
  assert.deepEqual(parseModelChatCommand('/model'), { type: 'status' });
  assert.deepEqual(parseModelChatCommand(' /MODEL   Sonnet '), { type: 'set', model: 'claude-sonnet-5-5' });
  assert.deepEqual(parseModelChatCommand('/model haiku'), { type: 'set', model: 'claude-haiku-5-5' });
  assert.deepEqual(parseModelChatCommand('/model horde'), { type: 'set', model: HORDE_MODEL });
  assert.deepEqual(parseModelChatCommand(' /MODEL   HORDE '), { type: 'set', model: HORDE_MODEL });
  for (const text of ['', 'I like that model.', 'model sonnet', '/models sonnet', '/model-sonnet']) assert.equal(parseModelChatCommand(text), null);
  for (const text of ['/model anything', '/model sonnet please', '/model constructor', '/model __proto__', '/model dolphin', '/model horde please']) assert.deepEqual(parseModelChatCommand(text), { type: 'invalid' });
});

test('model reset is an exact private command and rejects extra arguments', () => {
  assert.deepEqual(parseModelChatCommand('/model reset'), { type: 'reset' });
  assert.deepEqual(parseModelChatCommand('  /MODEL   RESET  '), { type: 'reset' });
  for (const text of ['/model reset horde', '/model reset please', '/model reset reset', '/model resets']) assert.deepEqual(parseModelChatCommand(text), { type: 'invalid' });
  for (const text of ['model reset', '/modelreset', 'Can you /model reset for me?']) assert.equal(parseModelChatCommand(text), null);
});

test('Haiku stays the default and old picker choices cannot silently opt into Sonnet', () => {
  assert.equal(savedConversationModel({}), 'claude-haiku-5-5');
  assert.equal(savedConversationModel({ model: 'claude-sonnet-5-5' }), 'claude-haiku-5-5');
  assert.equal(savedConversationModel({ model: 'claude-sonnet-5-5', modelSource: 'picker' }), 'claude-haiku-5-5');
  assert.equal(savedConversationModel({ model: 'claude-sonnet-5-5', modelSource: 'chat-command' }), 'claude-sonnet-5-5');
  assert.equal(savedConversationModel({ model: 'claude-haiku-5-5', modelSource: 'chat-command' }), 'claude-haiku-5-5');
  assert.equal(savedConversationModel({ model: 'unknown', modelSource: 'chat-command' }), 'claude-haiku-5-5');
  assert.equal(savedConversationModel({ model: HORDE_MODEL }), 'claude-haiku-5-5');
  assert.equal(savedConversationModel({ model: HORDE_MODEL, modelSource: 'picker' }), 'claude-haiku-5-5');
  assert.equal(savedConversationModel({ model: HORDE_MODEL, modelSource: 'chat-command' }), HORDE_MODEL, 'a deliberate Horde command survives reload');
});
