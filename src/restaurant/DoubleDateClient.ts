import type { ClaudeModel, TurnVia } from './types';
import { RECEIPT_TIMEOUT_MS, timeoutSignal } from './turn-endpointing';
import type { ConversationTarget, DoubleDateRoomState, DoubleDialogueLine, DoubleRoomCommand, DoubleRoomCredentials, DoubleRoomPoll, DoubleRoomResponse, DoubleVoiceSignal } from './double-date-types';

interface Callbacks {
  onState(state: DoubleDateRoomState): void;
  onLines(lines: DoubleDialogueLine[]): void;
  onGeneration(generation: number): void;
  onSignals(signals: DoubleVoiceSignal[]): void;
  onConnection(connected: boolean): void;
  onError(message: string): void;
  onExpired?(message: string): void;
}
const storageKey = 'table-for-two-double-date';
export const ROOM_REQUEST_TIMEOUT_MS = 15000;
export interface DoubleDateClientOptions { requestTimeoutMs?: number }
class RoomRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'RoomRequestError'; }
}
const expired = (error: unknown): error is RoomRequestError => error instanceof RoomRequestError && (error.status === 401 || error.status === 404);

/** Authenticated membership and bounded room snapshots; audio uses its own stream. */
export class DoubleDateClient {
  private membership?: DoubleRoomCredentials;
  private room?: DoubleDateRoomState;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private polling = false;
  private disposed = false;
  private cursor = 0;
  private failures = 0;
  private readonly seen = new Set<string>();
  private errorKey = '';
  private expiryNotified = false;
  private suspended = false;
  private activityEpoch = 0;
  private resyncing = false;
  private suspending?: Promise<void>;
  private readonly requests = new Set<AbortController>();

  constructor(private readonly callbacks: Callbacks, private readonly options: DoubleDateClientOptions = {}) {}
  get credentials() { return this.membership; }
  get state() { return this.room; }
  get active() { return !!this.membership; }
  private get path() { return '/api/double-date/rooms/' + encodeURIComponent(this.membership!.roomId); }
  private get headers() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.membership?.token ?? ''}` }; }
  private get requestTimeoutMs() {
    const configured = this.options.requestTimeoutMs ?? ROOM_REQUEST_TIMEOUT_MS;
    return Number.isFinite(configured) ? Math.max(1, Math.min(60000, configured)) : ROOM_REQUEST_TIMEOUT_MS;
  }

  async create(name: string, model: ClaudeModel, sessionLimit: number) {
    const epoch = this.activityEpoch;
    const response = await this.json<DoubleRoomResponse>('/api/double-date/rooms', { name, model, sessionLimit });
    if (this.disposed || this.suspended || epoch !== this.activityEpoch) throw new DOMException('Table connection suspended.', 'AbortError');
    this.enter(response); return response.state;
  }
  async join(code: string, name: string) {
    const epoch = this.activityEpoch;
    const response = await this.json<DoubleRoomResponse>('/api/double-date/rooms/join', { code, name });
    if (this.disposed || this.suspended || epoch !== this.activityEpoch) throw new DOMException('Table connection suspended.', 'AbortError');
    this.enter(response); return response.state;
  }
  async restore() {
    let saved: (DoubleRoomCredentials & { seen?: string[] }) | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch {}
    if (!saved?.roomId || !saved.token || !['h1', 'h2'].includes(saved.memberId)) return false;
    const epoch = this.activityEpoch;
    this.expiryNotified = false;
    this.membership = { roomId: saved.roomId, memberId: saved.memberId, token: saved.token };
    for (const id of saved.seen ?? []) this.seen.add(id);
    try {
      const result = await this.json<DoubleRoomPoll>(this.path);
      if (this.disposed || this.suspended || epoch !== this.activityEpoch) return false;
      this.accept(result.state); this.acceptSignals(result.signals ?? []); this.startPolling();
      return true;
    } catch (error) {
      if (this.suspended || this.disposed || epoch !== this.activityEpoch) return false;
      if (expired(error)) { this.expire(error.message); return false; }
      this.membership = undefined;
      this.callbacks.onError((error as Error).message);
      return false;
    }
  }
  async command(command: DoubleRoomCommand) {
    if (this.resyncing) throw new Error('Reconnecting to the table. Please try again shortly.');
    const result = await this.json<{ state: DoubleDateRoomState }>(this.path + '/command', command);
    this.accept(result.state);
    return result.state;
  }
  /** `via` tells the table whether the words were spoken (an automatic transcript) or typed. */
  async turn(text: string, target: ConversationTarget, via?: TurnVia) {
    if (this.resyncing) throw new Error('Reconnecting to the table. Please try again shortly.');
    const result = await this.json<{ state: DoubleDateRoomState }>(this.path + '/turn', { turnId: crypto.randomUUID(), text, target, ...(via ? { via } : {}) });
    this.accept(result.state);
  }
  async interrupt() {
    const result = await this.json<{ state: DoubleDateRoomState }>(this.path + '/interrupt', {});
    this.accept(result.state);
  }
  speech(lineId: string, generation: number, signal: AbortSignal) {
    return fetch(this.path + '/speech', { method: 'POST', headers: this.headers, body: JSON.stringify({ lineId, generation }), signal });
  }
  /** A receipt that cannot land within the timeout is abandoned so it never queues the next turn behind it. */
  receipt(lineId: string, generation: number, completed: boolean, playedSeconds: number, timeoutMs = RECEIPT_TIMEOUT_MS) {
    return this.json(this.path + '/playback', { lineId, generation, completed, playedSeconds }, timeoutSignal(timeoutMs));
  }
  inviteUrl() {
    if (!this.room) return '';
    const url = new URL('/', location.href); url.searchParams.set('invite', this.room.code); return url.href;
  }
  async leave(forget = true) {
    const membership = this.membership;
    this.stopPolling();
    if (membership) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(); }, this.requestTimeoutMs); });
      try {
        const path = '/api/double-date/rooms/' + encodeURIComponent(membership.roomId) + '/leave';
        const leaving = fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${membership.token}` }, body: '{}', keepalive: true, signal: controller.signal })
          .then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }).catch(() => {});
        // A transport that ignores abort must not hold navigation forever.
        await Promise.race([leaving, deadline]);
      } catch { /* Leaving is best effort. */ }
      finally { clearTimeout(timer); }
    }
    if (forget && this.membership === membership) {
      try { sessionStorage.removeItem(storageKey); } catch {}
      this.membership = undefined; this.room = undefined; this.seen.clear(); this.cursor = 0;
    }
  }
  /** Release the room connection immediately; reconnect never replays unseen dialogue. */
  suspend() {
    if (this.suspended || this.disposed) return;
    this.suspended = true; this.activityEpoch++;
    this.stopPolling();
    for (const controller of this.requests) controller.abort();
    const prior = this.suspending;
    this.suspending = prior ? prior.then(() => this.leave(false)) : this.leave(false);
  }
  async resume() {
    if (!this.suspended || this.disposed) return;
    const epoch = ++this.activityEpoch; this.resyncing = !!this.membership; this.suspended = false;
    await this.suspending;
    if (this.disposed || this.suspended || epoch !== this.activityEpoch) return;
    if (!this.membership) { this.resyncing = false; return; }
    if (!this.polling) { this.polling = true; await this.poll(); }
  }
  dispose() { this.disposed = true; this.activityEpoch++; this.stopPolling(); for (const controller of this.requests) controller.abort(); }

  private enter(result: DoubleRoomResponse) {
    this.stopPolling(); this.room = undefined; this.cursor = 0; this.seen.clear(); this.errorKey = ''; this.expiryNotified = false; this.failures = 0;
    this.membership = { roomId: result.roomId, memberId: result.memberId, token: result.token };
    this.accept(result.state); this.startPolling();
  }
  private accept(state: DoubleDateRoomState, announce = true) {
    if (!this.membership || state.id !== this.membership.roomId || (this.room && state.revision < this.room.revision)) return;
    const oldGeneration = this.room?.generation;
    this.room = state;
    if (oldGeneration !== undefined && oldGeneration !== state.generation) this.callbacks.onGeneration(state.generation);
    this.callbacks.onState(state);
    const fresh = state.lines.filter(line => !this.seen.has(line.id));
    for (const line of fresh) this.seen.add(line.id);
    while (this.seen.size > 300) this.seen.delete(this.seen.values().next().value!);
    if (announce && fresh.length) this.callbacks.onLines(fresh);
    const errorKey = state.error ? `${state.generation}:${state.error.code}:${state.error.message}` : '';
    if (errorKey && errorKey !== this.errorKey) this.callbacks.onError(state.error!.message);
    this.errorKey = errorKey;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ ...this.membership, seen: [...this.seen] })); } catch {}
  }
  private acceptSignals(signals: DoubleVoiceSignal[]) {
    const fresh = signals.filter(signal => signal.id > this.cursor);
    if (!fresh.length) return;
    this.cursor = Math.max(this.cursor, ...fresh.map(signal => signal.id)); this.callbacks.onSignals(fresh);
  }
  private startPolling() { if (!this.polling && !this.disposed && !this.suspended) { this.polling = true; void this.poll(); } }
  private stopPolling() { this.polling = false; clearTimeout(this.timer); this.controller?.abort(); this.controller = undefined; }
  private expire(message: string) {
    this.stopPolling(); this.membership = undefined; this.seen.clear(); this.cursor = 0; this.errorKey = ''; this.failures = 0;
    try { sessionStorage.removeItem(storageKey); } catch {}
    if (this.expiryNotified) return;
    this.expiryNotified = true;
    if (this.callbacks.onExpired) this.callbacks.onExpired(message); else this.callbacks.onError(message);
  }
  private async poll() {
    if (!this.polling || !this.membership || this.disposed) return;
    const controller = new AbortController(); this.controller = controller;
    try {
      const response = await this.json<DoubleRoomPoll>(this.path + '?after=' + this.cursor, undefined, controller.signal);
      if (controller.signal.aborted) return;
      this.accept(response.state, !this.resyncing);
      if (this.resyncing) { for (const signal of response.signals ?? []) this.cursor = Math.max(this.cursor, signal.id); this.resyncing = false; }
      else this.acceptSignals(response.signals ?? []);
      this.failures = 0; this.callbacks.onConnection(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (expired(error)) { this.callbacks.onConnection(false); this.expire(error.message); return; }
      this.failures++; this.callbacks.onConnection(false);
      if (this.failures === 1) this.callbacks.onError('Connection interrupted. Rejoining the table…');
    }
    if (this.polling && !this.disposed) this.timer = setTimeout(() => void this.poll(), this.failures ? Math.min(3000, 300 * this.failures) : 100);
  }
  private async json<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    if (this.suspended || this.disposed) throw new DOMException('Table connection suspended.', 'AbortError');
    const epoch = this.activityEpoch;
    const controller = new AbortController(); this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: this.headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      const data = await response.json();
      controller.signal.throwIfAborted();
      if (!response.ok) throw new RoomRequestError(typeof data.error === 'string' ? data.error : data.error?.message ?? data.message ?? `Table request failed (${response.status}).`, response.status);
      return data as T;
    } catch (error) {
      if (controller.signal.aborted && (this.suspended || this.disposed || epoch !== this.activityEpoch)) throw new DOMException('Table connection suspended.', 'AbortError');
      if (controller.signal.aborted && !signal?.aborted) throw new Error('The table took too long to respond. You can try again.');
      throw error;
    } finally { clearTimeout(timeout); this.requests.delete(controller); signal?.removeEventListener('abort', cancel); }
  }
}
