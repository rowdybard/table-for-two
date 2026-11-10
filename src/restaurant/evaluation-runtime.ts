import { getDate } from './content';
import { createEvening } from './evening';
import { createBlindDate } from './blind-date';
import type { ClaudeModel, DinnerState, SceneTurn, SceneUtterance } from './types';
import type { DoubleDateActorId, DoubleHumanId } from './double-date-types';
import { EveningDirector } from '../../server/restaurant/evening';
import { soloSystem } from '../../server/restaurant/conversation-prompt';
import { dialogueLoopContext, tableNow } from '../../server/restaurant/dialogue-policy';
import { QUIET_GAP_SECONDS, conversationMessages, deliveryLabel, heardPrefix, turnNote, type TurnFlow } from '../../server/restaurant/turn-note';
import { mergeMemoryForDelivery, retireSharedPremise } from '../../server/restaurant/memory';
import { tableFacts } from '../../server/restaurant/table-facts';
import { roleplayInstructions } from '../../server/restaurant/roleplay';
import { EMOTIONS, SOCIAL_SIGNALS, TURN_SCHEMA, type ClaudeRequest } from '../../server/restaurant/providers';
import { validateTurn } from '../../server/restaurant';
import { DOUBLE_TURN_SCHEMA, validateDoubleTurn } from '../../server/double-date/conversation';
import { doubleConversationFlow, doubleMessages, doubleSystem, doubleTurnNote, friendNames, presetDateSheet, renderDoubleHistory, type Couple, type DateSheet, type HistoryEntry, type Playback } from '../../server/double-date/table-note';
import type { EvaluationScript, EvaluationTurn } from './evaluation-fixtures';

type Entry = { role: 'user' | 'assistant'; content: string };
type DoubleResult = ReturnType<typeof validateDoubleTurn>;
type HeardLine = { id: string; speaker: 'd1' | 'd2' | 'waiter' | 'diner'; text: string; emotion: SceneUtterance['emotion']; interrupted?: boolean };
export type EvaluationResult = { kind: 'solo'; turn: SceneTurn } | { kind: 'double'; turn: DoubleResult };
const humans: DoubleHumanId[] = ['h1', 'h2'];
const actors: DoubleDateActorId[] = ['d1', 'd2'];
export const EVALUATION_MAX_TOKENS = 700;
const names = { h1: 'Alex', h2: 'Casey' };
const owner = (actor: DoubleDateActorId): DoubleHumanId => actor === 'd1' ? 'h1' : 'h2';
const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, speechCharacters: 0, cacheHits: 0, claudeRequests: 0, claudeCost: 0, speechCost: 0, totalCost: 0, responseMs: null, firstAudioMs: null });

/** Controlled text-only server snapshots, not a booted game, transport, renderer or physics simulation. */
function snapshot(script: EvaluationScript, dateId: DinnerState['dateId'], human: DoubleHumanId): DinnerState {
  return { id: `${script.id}-${human}`, revision: 0, generation: 0, mode: script.mode === 'double' ? 'double-date' : script.mode === 'blind' ? 'blind-date' : 'ai-date',
    ...(script.blindSeed ? { blindDate: { seed: script.blindSeed } } : {}), dateId, phase: 'playing', stage: 'seated', elapsed: 120,
    participants: [{ id: 'p1', kind: 'human', name: script.humanNames?.[human] ?? names[human], position: [0, 0, 0] }, { id: 'p2', kind: 'ai', name: getDate(dateId)!.name, position: [0, 0, -2] }],
    events: [], emotion: 'neutral', seated: true, order: null, glassRaised: false, memory: '', usage: zeroUsage(), sessionLimit: 2, evening: createEvening(dateId) };
}

/** Production prompt, notes, transcript, validators and social/delivery controllers.
 * The fixture alone controls what was heard and any offstage transition; model prose never moves actors. */
export class EvaluationConversation {
  readonly views: Record<DoubleHumanId, DinnerState>;
  readonly directors: Record<DoubleHumanId, EveningDirector>;
  private history: Entry[] = [];
  private doubleHistory: HistoryEntry[] = [];
  private readonly heard = new Map<string, Record<DoubleHumanId, Playback>>();
  private readonly lines: HeardLine[] = [];
  private readonly recent: SceneUtterance[] = [];
  private readonly excluded = { d1: 0, d2: 0 };
  private trimmed = false;
  private readonly sheets: DateSheet[];
  private readonly dateNames: Record<DoubleDateActorId, string>;
  private readonly humanNames: Record<DoubleHumanId, string>;
  private previous: { lines: SceneUtterance[]; delivery: 'heard' | 'interrupted' | 'unheard' } | undefined;
  private prepared = -1;

  constructor(readonly script: EvaluationScript, readonly model: ClaudeModel, readonly maxTokens = EVALUATION_MAX_TOKENS) {
    const ids = script.dateIds ?? [script.blindSeed ? createBlindDate(script.blindSeed).dateId : script.dateId, 'jules'];
    this.views = { h1: snapshot(script, ids[0], 'h1'), h2: snapshot(script, ids[1], 'h2') };
    this.humanNames = friendNames(humans.map(id => ({ id, name: script.humanNames?.[id] ?? names[id] })));
    this.directors = { h1: new EveningDirector(this.views.h1, { humanId: script.mode === 'double' ? 'h1' : 'player' }), h2: new EveningDirector(this.views.h2, { humanId: 'h2' }) };
    for (const view of Object.values(this.views)) {
      view.evening.cues = []; // Controlled dining snapshot; do not replay an arrival cue here.
    }
    this.sheets = actors.map(actorId => presetDateSheet(actorId, owner(actorId), this.views[owner(actorId)].dateId));
    this.dateNames = { d1: this.sheets[0].date.name, d2: this.sheets[1].date.name };
  }

  request(index: number): ClaudeRequest {
    const turn = this.script.turns[index];
    if (!turn) throw new Error('Unknown evaluation turn.');
    if (this.prepared !== index) {
      const speaker = this.script.mode === 'double' ? turn.human ?? 'h1' : 'h1';
      this.views[speaker].memory = retireSharedPremise(this.views[speaker].memory, turn.text);
      for (const view of Object.values(this.views)) view.elapsed = 120 + index * 25 + (turn.quietSeconds ?? 0);
      if (turn.offstage) {
        const view = this.views[owner(turn.offstage)];
        view.phase = 'ended'; view.evening.care.romanceClosed = true;
        view.evening.farewell.ending = { kind: 'new-friend', title: 'A good kind of company', description: 'This pairing ended as friendship.', dateLine: 'Good night.' };
        this.directors[owner(turn.offstage)].chemistry.revoke();
      }
      this.prepared = index;
    }
    if (this.script.mode === 'double') return this.doubleRequest(turn);
    const view = this.views.h1, director = this.directors.h1, dateName = getDate(view.dateId)!.name;
    const lastDateLine = this.previous?.lines.filter(line => line.speaker === 'date').at(-1);
    const cutOff = this.previous?.delivery === 'interrupted', keptTalking = this.previous?.delivery === 'unheard';
    const flow: TurnFlow = { pendingQuestion: director.pendingQuestion,
      ...(cutOff ? { talkedOver: { heard: heardPrefix(lastDateLine?.text ?? '', 1) } } : {}),
      ...(keptTalking ? { keptTalking: true } : {}),
      ...(turn.quietSeconds && turn.quietSeconds >= QUIET_GAP_SECONDS && !cutOff && !keptTalking ? { quietSeconds: turn.quietSeconds } : {}),
      ...(this.previous?.delivery === 'heard' && lastDateLine ? { lastDateLine: lastDateLine.text } : {}) };
    const note = turnNote({ scene: view, dateName, humanText: turn.text, via: turn.via ?? 'typed', tableNow: tableNow(view, dateName), memory: view.memory, facts: tableFacts(view),
      agenda: null, boundaries: director.boundaries.promptContext(), avoid: dialogueLoopContext(this.recent, turn.text).avoidUnpromptedTopics,
      recentDelivered: this.recent, flow });
    return { model: this.model, system: soloSystem({ dateId: view.dateId, blindDate: view.blindDate, model: this.model }),
      messages: conversationMessages(this.history, this.trimmed, dateName, note), maxTokens: this.maxTokens, outputSchema: TURN_SCHEMA };
  }

  private doubleRequest(turn: EvaluationTurn): ClaudeRequest {
    const names = this.humanNames;
    const speaker = turn.human ?? 'h1', target = turn.target ?? 'table';
    const couples: Couple[] = actors.map(actorId => {
      const humanId = owner(actorId), view = this.views[humanId], director = this.directors[humanId], available = view.phase !== 'ended';
      const recentOwn = this.lines.filter(line => line.speaker === actorId && this.heard.get(line.id)?.[speaker]?.completed).slice(-8).map(line => ({ speaker: 'date' as const, text: line.text, emotion: line.emotion }));
      return { actorId, humanId, dateName: this.dateNames[actorId], humanName: names[humanId], available, view, memory: view.memory, facts: tableFacts(view),
        agenda: null, boundaries: director.boundaries.promptContext(), avoid: dialogueLoopContext(recentOwn, turn.text).avoidUnpromptedTopics,
        friendOnlyTurns: this.excluded[actorId], recentOwn, pendingQuestion: director.pendingQuestion };
    });
    const flow = doubleConversationFlow({ history: this.doubleHistory, lines: this.lines, human: speaker, target, text: turn.text,
      quietSeconds: turn.quietSeconds ?? 0, dateNames: this.dateNames, available: id => this.views[owner(id)].phase !== 'ended', heard: (id, human) => this.heard.get(id)?.[human] });
    const note = doubleTurnNote({ couples, speaker, target, humanText: turn.text, via: turn.via ?? 'typed', elapsedMinutes: Math.floor(this.views.h1.elapsed / 60), flow });
    const schema = structuredClone(DOUBLE_TURN_SCHEMA);
    schema.properties.utterances.items.properties.speaker.enum = actors.filter(actor => this.views[owner(actor)].phase !== 'ended');
    return { model: this.model, system: doubleSystem(this.sheets, roleplayInstructions(this.model), { emotions: EMOTIONS, signals: SOCIAL_SIGNALS }),
      messages: doubleMessages(renderDoubleHistory(this.doubleHistory.slice(-40), names, this.dateNames, humans, (id, human) => this.heard.get(id)?.[human]), this.trimmed || this.doubleHistory.length > 40, note),
      maxTokens: this.maxTokens, outputSchema: schema };
  }

  validate(raw: string): EvaluationResult {
    return this.script.mode === 'double' ? { kind: 'double', turn: validateDoubleTurn(raw) } : { kind: 'solo', turn: validateTurn(JSON.parse(raw)) };
  }

  commit(index: number, result: EvaluationResult) {
    const input = this.script.turns[index], delivery = this.script.turns[index + 1]?.previousDelivery ?? 'heard';
    if (result.kind === 'solo') {
      const view = this.views.h1, director = this.directors.h1, turn = result.turn;
      director.noteHumanTurn(input.text);
      view.emotion = turn.emotion; view.memory = mergeMemoryForDelivery(turn.memory, view.memory, turn.utterances.some(line => line.speaker === 'date') && delivery === 'heard', input.text); director.social(turn, input.text);
      const spokenResponse = turn.utterances.map(line => ({ ...line, delivery: deliveryLabel(line.text, delivery === 'heard' ? { completed: true, playedSeconds: 4 } : delivery === 'interrupted' ? { completed: false, playedSeconds: 1 } : undefined, delivery !== 'heard'), playedSeconds: delivery === 'heard' ? 4 : delivery === 'interrupted' ? 1 : 0 }));
      this.history.push({ role: 'user', content: input.text }, { role: 'assistant', content: JSON.stringify({ spokenResponse }) });
      if (delivery === 'heard') for (const line of turn.utterances) { director.acknowledge(line); if (line.speaker === 'date') this.recent.push(line); }
      this.recent.splice(0, Math.max(0, this.recent.length - 8)); this.previous = { lines: turn.utterances, delivery };
      while (this.history.length > 60 || this.history.length > 2 && Buffer.byteLength(JSON.stringify(this.history)) > 20_000) { this.history.shift(); this.trimmed = true; }
      return;
    }
    const speaker = input.human ?? 'h1', nextListener = this.script.turns[index + 1]?.human ?? speaker;
    const lines = result.turn.utterances.filter(line => !actors.includes(line.speaker as DoubleDateActorId) || this.views[owner(line.speaker as DoubleDateActorId)].phase !== 'ended')
      .map((line, n): HeardLine => ({ ...line, id: `eval-${index}-${n}`, ...(delivery !== 'heard' ? { interrupted: true } : {}) }));
    this.doubleHistory.push({ human: speaker, target: input.target ?? 'table', text: input.text }, { lines });
    for (const update of result.turn.dateUpdates) {
      const human = owner(update.actorId), view = this.views[human], director = this.directors[human];
      if (view.phase === 'ended') continue;
      const ownLines = lines.filter(line => line.speaker === update.actorId).map(line => ({ speaker: 'date' as const, text: line.text, emotion: line.emotion }));
      const turn: SceneTurn = { utterances: ownLines, emotion: update.emotion, action: 'none', memory: update.memory, social: update.social, agenda: update.agenda };
      view.emotion = turn.emotion; view.memory = mergeMemoryForDelivery(turn.memory, view.memory, ownLines.length > 0 && (delivery === 'heard' || human !== nextListener), human === speaker ? input.text : '');
      director.noteHumanTurn(input.text, speaker); director.social(turn, input.text, { humanId: speaker, paired: speaker === human, name: this.humanNames[speaker] });
    }
    for (const line of lines) {
      const receipts = Object.fromEntries(humans.map(human => [human, { completed: delivery === 'heard' || human !== nextListener, playedSeconds: delivery === 'unheard' && human === nextListener ? 0 : human === nextListener && delivery === 'interrupted' ? 1 : 4 }])) as Record<DoubleHumanId, Playback>;
      this.heard.set(line.id, receipts);
      if (actors.includes(line.speaker as DoubleDateActorId)) for (const listener of humans) if (receipts[listener]?.completed) this.directors[owner(line.speaker as DoubleDateActorId)].acknowledge({ speaker: 'date', text: line.text, emotion: line.emotion }, listener);
    }
    this.lines.push(...lines);
    for (const actor of actors) this.excluded[actor] = ['h1', 'h2'].includes(input.target ?? '') ? this.excluded[actor] + 1 : 0;
    while (this.doubleHistory.length > 60 || this.doubleHistory.length > 2 && Buffer.byteLength(JSON.stringify(this.doubleHistory)) > 40_000) { this.doubleHistory.shift(); this.trimmed = true; }
  }

  reviewSnapshot() {
    return Object.fromEntries(humans.map(human => [human, { dateId: this.views[human].dateId, memory: this.views[human].memory, phase: this.views[human].phase, agenda: structuredClone(this.views[human].evening.agenda) }]));
  }
}
