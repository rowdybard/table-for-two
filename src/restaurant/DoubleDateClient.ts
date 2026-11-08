import type { ClaudeModel } from './types';
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

  constructor(private readonly callbacks: Callbacks) {}
  get credentials() { return this.membership; }
  get state() { return this.room; }
  get active() { return !!this.membership; }
  private get path() { return '/api/double-date/rooms/' + encodeURIComponent(this.membership!.roomId); }
  private get headers() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.membership?.token ?? ''}` }; }

  async create(name: string, model: ClaudeModel, sessionLimit: number) {
    const response = await this.json<DoubleRoomResponse>('/api/double-date/rooms', { name, model, sessionLimit });
    this.enter(response); return response.state;
  }
  async join(code: string, name: string) {
    const response = await this.json<DoubleRoomResponse>('/api/double-date/rooms/join', { code, name });
    this.enter(response); return response.state;
  }
  async restore() {
    let saved: (DoubleRoomCredentials & { seen?: string[] }) | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch {}
    if (!saved?.roomId || !saved.token || !['h1', 'h2'].includes(saved.memberId)) return false;
    this.expiryNotified = false;
    this.membership = { roomId: saved.roomId, memberId: saved.memberId, token: saved.token };
    for (const id of saved.seen ?? []) this.seen.add(id);
    try {
      const result = await this.json<DoubleRoomPoll>(this.path);
      this.accept(result.state); this.acceptSignals(result.signals ?? []); this.startPolling();
      return true;
    } catch (error) {
      if (expired(error)) { this.expire(error.message); return false; }
      this.membership = undefined;
      this.callbacks.onError((error as Error).message);
      return false;
    }
  }
  async command(command: DoubleRoomCommand) {
    const result = await this.json<{ state: DoubleDateRoomState }>(this.path + '/command', command);
    this.accept(result.state);
    return result.state;
  }
  async turn(text: string, target: ConversationTarget) {
    const result = await this.json<{ state: DoubleDateRoomState }>(this.path + '/turn', { turnId: crypto.randomUUID(), text, target });
    this.accept(result.state);
  }
  async interrupt() {
    const result = await this.json<{ state: DoubleDateRoomState }>(this.path + '/interrupt', {});
    this.accept(result.state);
  }
  speech(lineId: string, generation: number, signal: AbortSignal) {
    return fetch(this.path + '/speech', { method: 'POST', headers: this.headers, body: JSON.stringify({ lineId, generation }), signal });
  }
  receipt(lineId: string, generation: number, completed: boolean, playedSeconds: number) {
    return this.json(this.path + '/playback', { lineId, generation, completed, playedSeconds });
  }
  inviteUrl() {
    if (!this.room) return '';
    const url = new URL('/', location.href); url.searchParams.set('invite', this.room.code); return url.href;
  }
  async leave(forget = true) {
    this.stopPolling();
    if (this.membership) await fetch(this.path + '/leave', { method: 'POST', headers: this.headers, body: '{}', keepalive: true }).catch(() => {});
    if (forget) {
      try { sessionStorage.removeItem(storageKey); } catch {}
      this.membership = undefined; this.room = undefined; this.seen.clear(); this.cursor = 0;
    }
  }
  dispose() { this.disposed = true; this.stopPolling(); }

  private enter(result: DoubleRoomResponse) {
    this.stopPolling(); this.room = undefined; this.cursor = 0; this.seen.clear(); this.errorKey = ''; this.expiryNotified = false; this.failures = 0;
    this.membership = { roomId: result.roomId, memberId: result.memberId, token: result.token };
    this.accept(result.state); this.startPolling();
  }
  private accept(state: DoubleDateRoomState) {
    if (!this.membership || state.id !== this.membership.roomId || (this.room && state.revision < this.room.revision)) return;
    const oldGeneration = this.room?.generation;
    this.room = state;
    if (oldGeneration !== undefined && oldGeneration !== state.generation) this.callbacks.onGeneration(state.generation);
    this.callbacks.onState(state);
    const fresh = state.lines.filter(line => !this.seen.has(line.id));
    for (const line of fresh) this.seen.add(line.id);
    while (this.seen.size > 300) this.seen.delete(this.seen.values().next().value!);
    if (fresh.length) this.callbacks.onLines(fresh);
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
  private startPolling() { if (!this.polling && !this.disposed) { this.polling = true; void this.poll(); } }
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
      this.accept(response.state); this.acceptSignals(response.signals ?? []);
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
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: this.headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RoomRequestError(typeof data.error === 'string' ? data.error : data.error?.message ?? data.message ?? `Table request failed (${response.status}).`, response.status);
    return data as T;
  }
}
