import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDate } from '../../src/restaurant/content';
import { scenePresenceAvailable } from '../../src/restaurant/scenario-care';
import { scenarioMechanicsContext } from '../restaurant/scenario-effects';
import type { DoubleDateActorId, DoubleDateRoomState, DoubleDialogueLine, DoubleHumanId, DoubleTurnRequest } from '../../src/restaurant/double-date-types';
import type { Emotion, SocialResponse } from '../../src/restaurant/types';
import type { AgendaAssessment } from '../../src/restaurant/agenda-types';
import type { RestaurantPaidAccount, RestaurantServices } from '../restaurant';
import { completeUtterances } from '../restaurant';
import { DateApiError, EMOTIONS, SOCIAL_SIGNALS, isSilentDialogueLine } from '../restaurant/providers';
import { AGENDA_SCHEMA, validAgendaAssessment } from '../restaurant/agendas';
import { BOUNDARY_SCHEMA, validBoundaryAssessment } from '../restaurant/boundaries';
import { deferrableCue, dialogueLoopContext } from '../restaurant/dialogue-policy';
import { roleplayInstructions } from '../restaurant/roleplay';
import type { DoubleTableScene } from './scene';
import type { ConversationRoutingContext } from '../restaurant/conversation-routing';
import { MEMORY_REJECT, mergeMemoryForDelivery, retireSharedPremise } from '../restaurant/memory';
import { tableFacts } from '../restaurant/table-facts';
import { QUIET_GAP_SECONDS, heardPrefix } from '../restaurant/turn-note';
import { doubleConversationFlow, doubleMessages, doubleSystem, doubleTurnNote, friendNames, presetDateSheet, renderDoubleHistory } from './table-note';
import type { Couple, DateSheet, DoubleFlow } from './table-note';

const humans: DoubleHumanId[] = ['h1', 'h2'];
const actors: DoubleDateActorId[] = ['d1', 'd2'];
/** Remembered table entries (human turns and spoken line groups), and how many the next request sees verbatim. */
const HISTORY_ENTRIES = 60, RECENT_ENTRIES = 40;
const emotions = { type: 'string', enum: EMOTIONS };
const socialSchema = { type: 'object', additionalProperties: false, required: ['signal', 'reason', 'wantsToLeave', 'boundary'], properties: { signal: { type: 'string', enum: SOCIAL_SIGNALS }, reason: { type: 'string' }, wantsToLeave: { type: 'boolean' }, boundary: BOUNDARY_SCHEMA } };
export const DOUBLE_TURN_SCHEMA = { type: 'object', additionalProperties: false, required: ['utterances', 'dateUpdates'], properties: {
  utterances: { type: 'array', minItems: 0, maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['speaker', 'text', 'emotion'], properties: { speaker: { type: 'string', enum: ['d1', 'd2'] }, text: { type: 'string' }, emotion: emotions } } },
  dateUpdates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['actorId', 'emotion', 'memory', 'social', 'agenda'], properties: { actorId: { type: 'string', enum: actors }, emotion: emotions, memory: { type: 'string' }, social: socialSchema, agenda: AGENDA_SCHEMA } } },
} };
const schema = DOUBLE_TURN_SCHEMA;
type Delivery = { completed: boolean; playedSeconds: number };
type History = { human?: DoubleHumanId; text?: string; target?: string; lines?: DoubleDialogueLine[]; authored?: boolean };
type QueuedTurn = { human: DoubleHumanId; request: DoubleTurnRequest; fingerprint: string; key: string; memoryRevision: number; boundaries: Record<DoubleHumanId, ReturnType<DoubleTableScene['boundaryContext']>>; /** Questions each date was still waiting on, and the quiet before this turn, as they stood when it was spoken. */ pending: Record<DoubleHumanId, string | null>; quiet: number };
type AudioJob = { chunks: Buffer[]; total: number; subscribers: Set<ServerResponse>; done: boolean; error?: DateApiError; controller: AbortController; generation: number };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const error = (message: string, code = 'invalid_dialogue', status = 502) => new DateApiError(status, code, message);

/** One table director request per committed human turn; both dates share its context. */
export class DoubleConversation {
  private readonly seen = new Map<string, string>();
  private readonly queue: QueuedTurn[] = [];
  private readonly heard = new Map<string, Partial<Record<DoubleHumanId, Delivery>>>();
  private readonly audio = new Map<string, AudioJob>();
  private readonly cues = new Set<string>();
  private readonly improvised = new Set<string>();
  private readonly history: History[] = [];
  private readonly excluded: Record<DoubleDateActorId, number> = { d1: 0, d2: 0 };
  private memoryRevision = 0;
  private readonly pendingMemory: Partial<Record<DoubleHumanId, { value: string; humanText: string; lines: string[]; generation: number; revision: number }>> = {};
  private controller?: AbortController;
  private authoredFloor?: { lines: string[]; until: number };
  private draining = false;
  private closed = false;
  private sequence = 0;
  private turnStarted = 0;
  /** Older table entries were dropped from `history`, so the model is told the transcript does not start at the beginning. */
  private trimmed = false;
  /** When the table last had talk (a friend finished hearing a line, or spoke); a long gap after it is worth telling the dates about. */
  private lastHeardAt?: number;

  constructor(private readonly state: DoubleDateRoomState, private readonly scene: DoubleTableScene, private readonly services: RestaurantServices, private readonly account: RestaurantPaidAccount) { this.turnStarted = services.now(); }

  private line(speaker: DoubleDialogueLine['speaker'], text: string, emotion: Emotion, clipId?: string) {
    const line: DoubleDialogueLine = { id: `line-${++this.sequence}`, generation: this.state.generation, speaker, text, emotion, at: this.services.now(), ...(clipId ? { clipId } : {}) };
    this.state.lines.push(line); this.state.lines = this.state.lines.slice(-120); this.state.revision++;
    return line;
  }

  private bound() {
    if (this.history.length > HISTORY_ENTRIES) { this.history.splice(0, this.history.length - HISTORY_ENTRIES); this.trimmed = true; }
    while (this.history.length > 2 && Buffer.byteLength(JSON.stringify(this.history), 'utf8') > 40_000) { this.history.shift(); this.trimmed = true; }
  }

  private availableForDialogue(actorId: DoubleDateActorId) {
    const actor = this.state.dates.find(date => date.id === actorId);
    if (!actor) return false;
    const view = this.state.views[actor.humanId];
    return scenePresenceAvailable(view);
  }

  private offstage(speaker: DoubleDialogueLine['speaker']) { return actors.includes(speaker as DoubleDateActorId) && !this.availableForDialogue(speaker as DoubleDateActorId); }

  collectCues(fromConversation = false) {
    if (this.state.phase === 'waiting') return;
    for (const line of this.state.lines) if (this.improvised.has(line.id) && this.offstage(line.speaker) && !line.interrupted) {
      line.interrupted = true; this.audio.get(line.id)?.controller.abort(); this.state.revision++;
    }
    const pending = humans.flatMap(human => this.state.views[human].evening.cues.filter(cue => !this.cues.has(`${human}:${cue.id}`)).map(cue => ({ human, cue })));
    // Authored actions change the shared facts and take the conversational floor.
    // A held response must not later replace those facts or their emotional result.
    // Routine pacing (a plate arriving, a scripted aside) waits until the table has been answered;
    // the completed turn collects it. Health, boundary, incident and farewell cues still interrupt.
    if (pending.length && !fromConversation && this.controller && !this.controller.signal.aborted && pending.every(({ cue }) => deferrableCue(cue.key))) return;
    const interruptsTurn = pending.length > 0 && !fromConversation && !!this.controller && !this.controller.signal.aborted;
    if (interruptsTurn) this.interrupt();
    const authored: DoubleDialogueLine[] = [];
    const cast = new Set<string>();
    for (const human of humans) for (const cue of this.state.views[human].evening.cues) {
      const key = `${human}:${cue.id}`; if (this.cues.has(key)) continue; this.cues.add(key);
      for (const utterance of cue.utterances) {
        const speaker = utterance.speaker === 'date' ? human === 'h1' ? 'd1' : 'd2' : utterance.speaker === 'other-date' ? human === 'h1' ? 'd2' : 'd1' : utterance.speaker;
        const castKey = `${cue.key}:${speaker}:${utterance.text}`;
        if (!actors.includes(speaker as DoubleDateActorId) && cast.has(castKey)) continue;
        cast.add(castKey); authored.push(this.line(speaker, utterance.text, utterance.emotion, utterance.clipId));
      }
    }
    // Spoken authored lines are part of the conversation the dates remember.
    if (authored.length) { this.history.push({ lines: authored, authored: true }); this.bound(); }
    // A turn already waiting in the queue predates this scene interruption.
    // Give both clients a chance to play it (or report unavailable audio) before
    // that old turn takes the floor. The timeout also supports caption-only or
    // disconnected listeners; a fresh human turn may always interrupt it.
    if (!fromConversation && authored.length && (interruptsTurn || this.authoredFloor)) this.authoredFloor = { lines: [...(this.authoredFloor?.lines ?? []), ...authored.map(line => line.id)], until: this.services.now() + Math.min(30_000, Math.max(4_000, authored.reduce((sum, line) => sum + line.text.length, 0) / 12 * 1000 + 3_000)) };
    if (this.queue.length && !this.waitingForAuthoredFloor()) void this.drain();
  }

  private waitingForAuthoredFloor() {
    if (!this.authoredFloor) return false;
    const listeners = this.state.members.filter(member => member.connected).map(member => member.id);
    if (this.services.now() >= this.authoredFloor.until || this.authoredFloor.lines.every(id => listeners.every(human => this.heard.get(id)?.[human] !== undefined))) { this.authoredFloor = undefined; return false; }
    return true;
  }

  resume() { this.lastHeardAt = undefined; void this.drain(); } // time spent paused is not a quiet table

  private commitHeardMemory(human: DoubleHumanId) {
    const pending = this.pendingMemory[human];
    if (!pending || pending.generation !== this.state.generation || pending.revision !== this.memoryRevision || !pending.lines.length || !pending.lines.every(id => this.heard.get(id)?.[human]?.completed)) return;
    const view = this.state.views[human];
    view.memory = mergeMemoryForDelivery(pending.value, view.memory, true, pending.humanText);
    delete this.pendingMemory[human];
    this.state.revision++;
  }

  submit(human: DoubleHumanId, request: DoubleTurnRequest) {
    if (this.closed || this.state.phase !== 'playing') throw error('Resume the evening before speaking.', 'inactive_room', 409);
    const key = `${human}:${request.turnId}`, fingerprint = JSON.stringify([request.text, request.target]);
    if (this.seen.has(key)) { if (this.seen.get(key) !== fingerprint) throw error('That turn ID already has another transcript.', 'turn_conflict', 409); return false; }
    if (this.seen.size >= 250 || this.queue.length >= 4) throw error('Let the current conversation finish before adding another turn.', 'turn_limit', 429);
    this.memoryRevision++;
    delete this.pendingMemory.h1; delete this.pendingMemory.h2;
    const ownView = this.state.views[human]; ownView.memory = retireSharedPremise(ownView.memory, request.text);
    this.authoredFloor = undefined;
    const boundaries = { h1: this.scene.boundaryContext('h1'), h2: this.scene.boundaryContext('h2') };
    this.scene.clearPendingBoundaries();
    // Speaking answers the question a date was waiting on and ends any quiet, so read both before recording the turn.
    const pending = { h1: this.scene.pendingQuestion('h1'), h2: this.scene.pendingQuestion('h2') };
    const quiet = this.lastHeardAt === undefined ? 0 : Math.round((this.services.now() - this.lastHeardAt) / 1000);
    this.seen.set(key, fingerprint); this.queue.push({ human, request, fingerprint, key, memoryRevision: this.memoryRevision, boundaries, pending, quiet });
    this.lastHeardAt = this.services.now();
    this.scene.noteHumanTurn(request.text, human);
    this.line(human, request.text, 'neutral');
    this.state.error = undefined;
    void this.drain(); return true;
  }

  interrupt() {
    this.scene.clearPendingBoundaries();
    delete this.pendingMemory.h1; delete this.pendingMemory.h2;
    this.authoredFloor = undefined;
    this.state.generation++; this.state.revision++;
    this.controller?.abort();
    for (const line of this.state.lines) if (!humans.includes(line.speaker as DoubleHumanId) && line.generation < this.state.generation && !humans.every(id => this.heard.get(line.id)?.[id]?.completed)) line.interrupted = true;
    for (const job of this.audio.values()) if (!job.done) job.controller.abort();
  }

  resetModel() {
    this.interrupt();
    this.queue.length = 0;
    this.controller = undefined;
    this.state.processing = false;
    this.state.activeTurnId = undefined;
    this.state.error = undefined;
    this.scene.replyEnded(); // nothing is on its way any more
  }

  /** How this turn's words arrived: over the date, before the last reply landed, or after a long quiet. */
  private flowFor(turn: QueuedTurn, dateNames: Record<DoubleDateActorId, string>): DoubleFlow {
    return doubleConversationFlow({ history: this.history, lines: this.state.lines, human: turn.human, target: turn.request.target,
      text: turn.request.text, quietSeconds: turn.quiet, dateNames, available: id => this.availableForDialogue(id), heard: (id, human) => this.heard.get(id)?.[human] });
  }

  private async drain() {
    if (this.draining || this.closed || this.waitingForAuthoredFloor()) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.closed && this.state.phase === 'playing' && !this.waitingForAuthoredFloor()) {
        const turn = this.queue.shift()!;
        this.interrupt(); const generation = this.state.generation, controller = new AbortController(); this.controller = controller;
        this.state.processing = true; this.state.activeTurnId = turn.request.turnId; this.turnStarted = this.services.now(); this.account.usage.firstAudioMs = null;
        let effectiveModel = this.state.model;
        const routingContext: ConversationRoutingContext = { text: turn.request.text, recentTurns: this.history.slice(-RECENT_ENTRIES).flatMap<{ role: 'user' | 'assistant'; content: string }>(entry => entry.human
          ? [{ role: 'user' as const, content: entry.text ?? '' }]
          : (entry.lines ?? []).filter(line => actors.includes(line.speaker as DoubleDateActorId) && this.heard.get(line.id)?.[turn.human]?.completed).map(line => ({ role: 'assistant' as const, content: line.text }))) };
        try { effectiveModel = this.services.modelFor?.(this.state.model, this.state.views[turn.human], routingContext) ?? this.state.model; }
        catch (caught) { const failure = caught instanceof DateApiError ? caught : error('That conversation route is unavailable.'); this.state.error = { code: failure.code, message: failure.message }; this.state.processing = false; this.controller = undefined; this.state.revision++; if (!this.queue.length) this.scene.replyEnded(); continue; }
        this.state.views[turn.human].conversationModel = effectiveModel;
        const outputSchema = structuredClone(schema);
        outputSchema.properties.utterances.items.properties.speaker.enum = [...actors.filter(actor => this.availableForDialogue(actor))];
        const names = friendNames(this.state.members), dateOf = (id: DoubleDateActorId) => this.state.dates.find(date => date.id === id)!;
        const dateNames = { d1: getDate(dateOf('d1').dateId)!.name, d2: getDate(dateOf('d2').dateId)!.name };
        const sheets: DateSheet[] = actors.map(id => { const actor = dateOf(id); return presetDateSheet(id, actor.humanId, actor.dateId); });
        const system = doubleSystem(sheets, roleplayInstructions(effectiveModel), { emotions: EMOTIONS, signals: SOCIAL_SIGNALS });
        const couples: Couple[] = actors.map(id => {
          const actor = dateOf(id), view = this.state.views[actor.humanId], available = this.availableForDialogue(id);
          const recentOwn = this.state.lines.filter(line => line.speaker === id && this.heard.get(line.id)?.[turn.human]?.completed).slice(-8).map(line => ({ speaker: 'date' as const, text: line.text, emotion: line.emotion }));
          return { actorId: id, humanId: actor.humanId, dateName: dateNames[id], humanName: names[actor.humanId], available, view, memory: view.memory, facts: tableFacts(view),
            agenda: available ? this.scene.agendaContext(actor.humanId) : null, boundaries: turn.boundaries[actor.humanId], avoid: dialogueLoopContext(recentOwn, turn.request.text).avoidUnpromptedTopics,
            mechanics: scenarioMechanicsContext(view) as Record<string, unknown> | undefined, friendOnlyTurns: this.excluded[id], recentOwn, pendingQuestion: turn.pending[actor.humanId] };
        });
        const scenario = this.state.scenario;
        const note = doubleTurnNote({ couples, speaker: turn.human, target: turn.request.target, humanText: turn.request.text, ...(turn.request.via ? { via: turn.request.via } : {}),
          ...(scenario ? { scenario: { phase: scenario.phase, description: scenario.description, target: scenario.target } } : {}), flow: this.flowFor(turn, dateNames),
          elapsedMinutes: Math.floor(Math.max(...Object.values(this.state.views).map(view => view.elapsed)) / 60),
          previousHuman: this.history.filter(entry => entry.human === turn.human && entry.text).slice(-3).map(entry => entry.text!) });
        const listeners = this.state.members.filter(member => member.connected).map(member => member.id);
        const recent = this.history.slice(-RECENT_ENTRIES);
        const messages = doubleMessages(renderDoubleHistory(recent, names, dateNames, listeners, (lineId, human) => this.heard.get(lineId)?.[human]), this.trimmed || this.history.length > RECENT_ENTRIES, note);
        this.history.push({ human: turn.human, text: turn.request.text, target: turn.request.target });
        let raw = '', historyRecorded = false, parsedUtterances = 0; const lines: DoubleDialogueLine[] = [];
        try {
          for await (const chunk of this.services.streamClaude(this.account, { model: effectiveModel, system, messages, maxTokens: 1000, outputSchema }, controller.signal)) {
            if (controller.signal.aborted || generation !== this.state.generation) throw error('Conversation interrupted.', 'interrupted', 499);
            if (chunk.type === 'text') {
              raw += chunk.text; if (raw.length > 16_000) throw error('The table returned too much dialogue.');
              const complete = completeUtterances(raw);
              while (parsedUtterances < complete.length) {
                const candidate = complete[parsedUtterances++];
                if (isSilentDialogueLine(candidate, ['d1', 'd2', 'waiter', 'diner'])) continue;
                const utterance = validateLine(candidate);
                if (this.offstage(utterance.speaker)) continue;
                if (['waiter', 'diner'].includes(utterance.speaker) && lines.some(line => ['waiter', 'diner'].includes(line.speaker))) throw error('Only one supporting character may speak per turn.');
                const line = this.line(utterance.speaker, utterance.text.trim(), utterance.emotion); lines.push(line); this.improvised.add(line.id);
              }
            }
          }
          if (controller.signal.aborted || generation !== this.state.generation) throw error('Conversation interrupted.', 'interrupted', 499);
          const parsed = validateDoubleTurn(raw);
          for (const update of parsed.dateUpdates) {
            if (!this.availableForDialogue(update.actorId)) continue;
            const actor = this.state.dates.find(item => item.id === update.actorId)!;
            const pairedSpeaker = actor.humanId === turn.human;
            const agenda = pairedSpeaker ? update.agenda : update.agenda ? { ...update.agenda, signal: 'none' as const, evidence: '' } : undefined;
            const ownLines = parsed.utterances.filter(line => line.speaker === actor.id).map(line => ({ speaker: 'date' as const, text: line.text.trim(), emotion: line.emotion }));
            const proposedBoundary = update.social.boundary;
            const priorBoundary = proposedBoundary && turn.boundaries[actor.humanId].boundaries.find(boundary => boundary.humanId === turn.human && boundary.topic === proposedBoundary.topic && boundary.delivered && (!proposedBoundary.refusal || proposedBoundary.refusal === boundary.refusal));
            const social = proposedBoundary && ['repeat', 'repair'].includes(proposedBoundary.kind) && !priorBoundary
              ? { ...update.social, boundary: { ...proposedBoundary, kind: 'none' as const, evidence: '', refusal: '' } } : update.social;
            const view = this.state.views[actor.humanId];
            const current = turn.memoryRevision === this.memoryRevision;
            const memoryHumanText = current && pairedSpeaker ? turn.request.text : '';
            const memory = current ? mergeMemoryForDelivery(update.memory, view.memory, false, memoryHumanText) : view.memory;
            this.scene.social(actor.humanId, { utterances: ownLines, emotion: update.emotion, memory, action: 'none', social, ...(agenda ? { agenda } : {}) }, turn.request.text, turn.human, memoryHumanText);
            const spoken = lines.filter(line => line.speaker === actor.id);
            if (current && spoken.length === ownLines.length && spoken.length) {
              this.pendingMemory[actor.humanId] = { value: update.memory, humanText: memoryHumanText, lines: spoken.map(line => line.id), generation, revision: turn.memoryRevision };
              this.commitHeardMemory(actor.humanId);
            }
            // A short streamed line can finish playback before its enclosing JSON.
            // Replaying an existing receipt makes disclosure ordering deterministic.
            for (const line of lines) if (line.speaker === actor.id) for (const listener of humans) if (this.heard.get(line.id)?.[listener]?.completed) this.scene.acknowledge(actor.humanId, { speaker: 'date', text: line.text, emotion: line.emotion }, listener);
            actor.emotion = update.emotion; actor.stance = this.state.views[actor.humanId].evening.stance;
            if (update.social.signal === 'repair') this.excluded[actor.id] = 0;
          }
          this.history.push({ lines }); historyRecorded = true; this.bound(); this.collectCues(true);
        } catch (caught) {
          if (!controller.signal.aborted && generation === this.state.generation) {
            const failure = caught instanceof DateApiError ? caught : error('The table conversation could not finish. Try another turn.', 'claude_provider');
            if (failure.code === 'conversation_refusal') {
              const refused = [...this.history].reverse().find(entry => entry.human === turn.human && entry.text === turn.request.text);
              if (refused) refused.text = '[A provider-limited topic was redirected back to dinner. No personal boundary strike occurred.]';
              this.state.error = { code: failure.code, message: failure.message };
            }
            else { this.state.error = { code: failure.code, message: failure.message }; if (lines.length) this.interrupt(); }
          }
        } finally {
          if (lines.length && !historyRecorded) { this.history.push({ lines }); this.bound(); }
          if (this.controller === controller) { this.controller = undefined; this.state.processing = false; this.state.activeTurnId = undefined; if (!this.queue.length) this.scene.replyEnded(); }
          this.state.revision++;
        }
      }
    } finally { this.draining = false; if (this.queue.length && !this.closed && this.state.phase === 'playing' && !this.waitingForAuthoredFloor()) void this.drain(); }
  }

  async speech(req: IncomingMessage, res: ServerResponse, lineId: string, generation: number) {
    const line = this.state.lines.find(item => item.id === lineId);
    if (!line || humans.includes(line.speaker as DoubleHumanId)) throw error('That line is not an AI utterance.', 'unknown_utterance', 400);
    if (this.improvised.has(line.id) && this.offstage(line.speaker)) throw error('That date has left the conversation.', 'speaker_unavailable', 409);
    if (generation !== this.state.generation || line.generation !== generation || line.interrupted || this.state.phase !== 'playing') throw error('That line was interrupted.', 'stale_generation', 409);
    let job = this.audio.get(line.id);
    if (!job) {
      if ([...this.audio.values()].filter(item => !item.done).length >= 2) throw error('Wait for the current character voice.', 'speech_busy', 429);
      job = { chunks: [], total: 0, subscribers: new Set(), done: false, controller: new AbortController(), generation };
      this.audio.set(line.id, job); const producer = job;
      void (async () => {
        try {
          const actor = this.state.dates.find(item => item.id === line.speaker);
          const voice = actor?.dateId ?? (line.speaker === 'waiter' ? 'waiter' : 'diner');
          for await (const bytes of this.services.streamSpeech(this.account, { text: line.text, emotion: line.emotion, voice }, producer.controller.signal)) {
            if (producer.controller.signal.aborted || generation !== this.state.generation) throw error('Speech interrupted.', 'interrupted', 499);
            if (this.improvised.has(line.id) && this.offstage(line.speaker)) throw error('That date has left the conversation.', 'speaker_unavailable', 409);
            const buffer = Buffer.from(bytes); producer.chunks.push(buffer); producer.total += buffer.length;
            if (producer.total > 5 * 1024 * 1024) throw error('That voice line exceeded its size limit.', 'speech_limit');
            if (this.account.usage.firstAudioMs === null) this.account.usage.firstAudioMs = Math.max(0, this.services.now() - this.turnStarted);
            for (const listener of producer.subscribers) { if (!listener.headersSent) listener.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-speech-cache': 'shared' }); if (!listener.destroyed) listener.write(buffer); }
          }
          if (!producer.total) throw error('The voice service returned no audio.', 'speech_empty');
        } catch (caught) {
          producer.error = caught instanceof DateApiError ? caught : error('Character speech is unavailable. Captions remain available.', 'speech_provider');
          if (!producer.controller.signal.aborted) this.state.error = { code: producer.error.code, message: producer.error.message };
        } finally {
          producer.done = true;
          for (const listener of producer.subscribers) { if (listener.destroyed) continue; if (producer.error && !listener.headersSent) { listener.writeHead(producer.error.status, { 'content-type': 'application/json' }); listener.end(JSON.stringify({ error: producer.error.message, code: producer.error.code })); } else listener.end(); }
          producer.subscribers.clear(); this.state.revision++;
          while ([...this.audio.values()].reduce((sum, item) => sum + item.total, 0) > 24 * 1024 * 1024) { const oldest = [...this.audio].find(([, item]) => item.done); if (!oldest) break; this.audio.delete(oldest[0]); }
        }
      })();
    }
    if (job.error && job.done) throw job.error;
    if (job.chunks.length) { res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-speech-cache': 'shared' }); for (const chunk of job.chunks) res.write(chunk); }
    if (job.done) { res.end(); return; }
    job.subscribers.add(res); res.on('close', () => job!.subscribers.delete(res));
  }

  playback(human: DoubleHumanId, lineId: string, generation: number, completed: boolean, playedSeconds: number) {
    const line = this.state.lines.find(item => item.id === lineId && item.generation === generation);
    if (!line || humans.includes(line.speaker as DoubleHumanId)) throw error('That playback line is unknown.', 'unknown_playback', 409);
    const listeners = this.heard.get(line.id) ?? {}, previous = listeners[human];
    listeners[human] = { completed: !!previous?.completed || completed, playedSeconds: Math.max(previous?.playedSeconds ?? 0, playedSeconds) }; this.heard.set(line.id, listeners);
    const actor = this.state.dates.find(item => item.id === line.speaker);
    if (completed && !line.interrupted) this.lastHeardAt = this.services.now();
    if (completed && actor && !line.interrupted && generation === this.state.generation && this.state.phase === 'playing') { this.scene.acknowledge(actor.humanId, { speaker: 'date', text: line.text, emotion: line.emotion }, human); if (human === actor.humanId) this.commitHeardMemory(human); }
    if (this.queue.length && !this.waitingForAuthoredFloor()) void this.drain();
  }

  close() { if (this.closed) return; this.closed = true; this.interrupt(); this.queue.length = 0; for (const job of this.audio.values()) { job.controller.abort(); for (const listener of job.subscribers) listener.destroy(); } this.audio.clear(); }
}

function validateLine(line: unknown): { speaker: 'd1' | 'd2' | 'waiter' | 'diner'; text: string; emotion: Emotion } {
  if (!record(line) || !exact(line, ['speaker', 'text', 'emotion']) || !['d1', 'd2'].includes(line.speaker) || typeof line.text !== 'string' || !line.text.trim() || line.text.length > 420 || /[\u0000-\u001f]/.test(line.text) || !EMOTIONS.includes(line.emotion)) throw error('A character returned an invalid line.');
  return line as ReturnType<typeof validateLine>;
}
export function validateDoubleTurn(text: string): { utterances: ReturnType<typeof validateLine>[]; dateUpdates: { actorId: DoubleDateActorId; emotion: Emotion; memory: string; social: SocialResponse; agenda?: AgendaAssessment }[] } {
  let value: unknown; try { value = JSON.parse(text); } catch { throw error('The table returned incomplete dialogue. Try another turn.'); }
  if (!record(value) || !exact(value, ['utterances', 'dateUpdates']) || !Array.isArray(value.utterances) || value.utterances.length > 2 || !Array.isArray(value.dateUpdates) || value.dateUpdates.length !== 2) throw error('The table returned invalid dialogue.');
  const utterances = value.utterances.filter((line: unknown) => !isSilentDialogueLine(line, ['d1', 'd2', 'waiter', 'diner']));
  if (utterances.filter((line: unknown) => record(line) && ['waiter', 'diner'].includes(line.speaker)).length > 1) throw error('Only one supporting character may speak per turn.');
  const seen = new Set<string>();
  for (const line of utterances) validateLine(line);
  for (const update of value.dateUpdates) {
    if (!record(update) || !exact(update, ['actorId', 'emotion', 'memory', 'social', 'agenda']) || !actors.includes(update.actorId) || seen.has(update.actorId) || !EMOTIONS.includes(update.emotion) || typeof update.memory !== 'string' || update.memory.length > MEMORY_REJECT || !record(update.social) || !exact(update.social, ['signal', 'reason', 'wantsToLeave', 'boundary']) || !SOCIAL_SIGNALS.includes(update.social.signal) || typeof update.social.reason !== 'string' || update.social.reason.length > 180 || typeof update.social.wantsToLeave !== 'boolean' || (update.social.boundary !== undefined && !validBoundaryAssessment(update.social.boundary)) || (update.agenda !== undefined && !validAgendaAssessment(update.agenda))) throw error('A character returned an invalid emotional update.');
    seen.add(update.actorId);
  }
  return { ...value, utterances } as ReturnType<typeof validateDoubleTurn>;
}
