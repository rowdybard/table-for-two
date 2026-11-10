import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PageActivity } from '../src/restaurant/PageActivity';

test('blur, hidden and page-cache suspension release once and resume only when all are active', () => {
  const changes: string[] = [], activity = new PageActivity(() => changes.push('suspend'), () => changes.push('resume'));
  activity.focus(false); activity.visibility(true); activity.page(false); activity.focus(true);
  assert.deepEqual(changes, ['suspend']);
  activity.page(true); assert.deepEqual(changes, ['suspend']);
  activity.visibility(false); assert.deepEqual(changes, ['suspend', 'resume']);
  activity.visibility(false); activity.focus(true); assert.deepEqual(changes, ['suspend', 'resume']);
  activity.visibility(true); activity.visibility(false); assert.deepEqual(changes, ['suspend', 'resume', 'suspend', 'resume']);
});
