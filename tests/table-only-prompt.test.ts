import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPairView } from '../server/double-date/scene';
import { doubleSystem, doubleTurnNote, presetDateSheet, type Couple } from '../server/double-date/table-note';
import { soloSystem } from '../server/restaurant/conversation-prompt';
import { tableNow } from '../server/restaurant/dialogue-policy';
import { ACTIONS, EMOTIONS, SOCIAL_SIGNALS, TURN_SCHEMA } from '../server/restaurant/providers';
import { roleplayInstructions } from '../server/restaurant/roleplay';
import { emptyUsage } from '../server/restaurant/scene';
import { turnNote } from '../server/restaurant/turn-note';
import { getDate } from '../src/restaurant/content';
import type { DateId } from '../src/restaurant/types';

const texts = ['Hi.', 'Hello.', 'I like you, but I disagree that every favor deserves a yes.'];
const neutralAgenda = /agenda (?:to|to be) \{signal none, evidence “”, clue “”\}/;
const legacyDirection = /Actions:.*(?:follow|sit|order)|server owns courses|may now signal|private goal, not to recite|Eli has offered|already.*menu|invested in the menu|just eat and talk/;

function assertSocialAgency(prompt: string) {
  assert.match(prompt, /social\.signal is one of/);
  assert.match(prompt, /pressure means explicit disregard for a boundary, not ordinary disagreement/);
  assert.match(prompt, /Set wantsToLeave only after repeated pressure/);
  assert.match(prompt, /disagree confidently/);
  assert.match(prompt, /bold, confident flirting/);
  assert.match(prompt, /When nothing happened(?: for a date)?, use social/);
  assert.doesNotMatch(prompt, legacyDirection);
}

test('production Solo prompts keep legacy action and agenda keys neutral without suppressing conversation or boundaries', () => {
  for (const dateId of ['mira', 'jules', 'dev'] as const) for (const humanText of texts) {
    const scene = createPairView('table-only-prompt', 'h1', 'Alex', dateId, emptyUsage(), 2);
    scene.phase = 'playing';
    const system = soloSystem({ dateId, model: 'claude-haiku-5-5' });
    const note = turnNote({ scene, dateName: getDate(dateId)!.name, humanText, tableNow: tableNow(scene, getDate(dateId)!.name),
      memory: '', facts: [], agenda: null, boundaries: { boundaries: [] }, avoid: [] });
    const prompt = `${system}\n${note}`;
    assert.match(system, /Always set "action" to "none"/);
    assert.match(system, neutralAgenda);
    assert.match(note, /at your table together/);
    assertSocialAgency(prompt);
  }
  assert.deepEqual(TURN_SCHEMA.properties.action.enum, ACTIONS, 'public transport still accepts its existing action vocabulary');
  assert.ok(TURN_SCHEMA.required.includes('action') && TURN_SCHEMA.required.includes('agenda'));
});

test('production Double prompts leave both agendas neutral while preserving separate voices, social updates and mutual progress', () => {
  for (const dateIds of [['mira', 'jules'], ['dev', 'mira']] as const) for (const humanText of texts) {
    const sheets = [presetDateSheet('d1', 'h1', dateIds[0]), presetDateSheet('d2', 'h2', dateIds[1])];
    const system = doubleSystem(sheets, roleplayInstructions('claude-haiku-5-5'), { emotions: EMOTIONS, signals: SOCIAL_SIGNALS });
    const couple = (dateId: DateId, index: number): Couple => {
      const actorId = index === 0 ? 'd1' : 'd2', humanId = index === 0 ? 'h1' : 'h2';
      const humanName = index === 0 ? 'Alex' : 'Jamie';
      const view = createPairView('table-only-prompt', humanId, humanName, dateId, emptyUsage(), 2); view.phase = 'playing';
      return { actorId, humanId, humanName, dateName: getDate(dateId)!.name, available: true, view, memory: '', facts: [], agenda: null,
        boundaries: { boundaries: [] }, avoid: [], friendOnlyTurns: 0, recentOwn: [], pendingQuestion: null };
    };
    const note = doubleTurnNote({ couples: dateIds.map(couple), speaker: 'h1', target: 'table', humanText, flow: {}, elapsedMinutes: 0 });
    const prompt = `${system}\n${note}`;
    assert.match(system, /Always set each date’s agenda to \{signal none, evidence “”, clue “”\}/);
    assert.match(system, /Each date’s emotion and social update are their own/);
    assert.match(system, /Each couple earns chemistry independently/);
    assertSocialAgency(prompt);
  }
});
