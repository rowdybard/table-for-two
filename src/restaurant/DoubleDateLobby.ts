import { DATES } from './content';
import type { DateId } from './types';
import type { DoubleDateRoomState, DoubleHumanId } from './double-date-types';

type LobbyAction = void | Promise<void>;
export type DoubleDateLobbyActions = {
  create(name: string): LobbyAction;
  join(code: string, name: string): LobbyAction;
  choose(dateId: DateId): LobbyAction;
  ready(ready: boolean): LobbyAction;
  start(): LobbyAction;
  copyInvite(): LobbyAction;
  back(): LobbyAction;
};
type LobbyStage = 'entry' | 'join' | 'room';

/** A small game menu over the restaurant; room state and transport live elsewhere. */
export class DoubleDateLobby {
  readonly element: HTMLElement;
  private stage: LobbyStage = 'entry';
  private room?: DoubleDateRoomState;
  private localId?: DoubleHumanId;
  private busy = false;
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly error: HTMLElement;

  constructor(container: HTMLElement, private readonly actions: DoubleDateLobbyActions) {
    const root = document.createElement('section');
    root.id = 'double-date-lobby'; root.dataset.gameMenu = ''; root.hidden = true;
    root.setAttribute('aria-label', 'Double date');
    root.innerHTML = `<div class="double-lobby-copy">
      <h2>Double date</h2>
      <div class="double-entry">
        <label class="double-field">Your name<input id="double-name" maxlength="24" autocomplete="nickname" placeholder="Your name"></label>
        <label class="double-field double-code" hidden>Invite code<input id="double-code" maxlength="32" autocomplete="off" spellcheck="false" placeholder="Invite code"></label>
        <div class="double-commands"><button id="double-create" data-game-item>Invite a friend</button><button id="double-join-open" data-game-item>Join a friend</button><button id="double-join" data-game-item hidden>Join</button><button id="double-entry-back" data-game-item>Back</button></div>
      </div>
      <div class="double-room" hidden>
        <p class="double-invite-code">Invite code <strong></strong></p>
        <div class="double-people" aria-live="polite"></div>
        <h3>Choose your date</h3>
        <div class="double-choices">${DATES.map(date => `<button data-game-item data-double-date="${date.id}"><span>${date.name}</span></button>`).join('')}</div>
        <p class="double-date-detail"></p>
        <div class="double-commands"><button id="double-invite" data-game-item>Copy invite</button><button id="double-ready" data-game-item>Ready</button><button id="double-start" data-game-item>Start</button><button id="double-room-back" data-game-item>Back</button></div>
      </div>
      <p class="double-error" role="status" hidden></p>
    </div>`;
    container.append(root); this.element = root;
    this.nameInput = root.querySelector<HTMLInputElement>('#double-name')!;
    this.codeInput = root.querySelector<HTMLInputElement>('#double-code')!;
    this.error = root.querySelector<HTMLElement>('.double-error')!;
    const on = (selector: string, action: () => LobbyAction) => root.querySelector<HTMLButtonElement>(selector)!.addEventListener('click', () => { void this.run(action); });
    on('#double-create', () => this.actions.create(this.name()));
    on('#double-join-open', () => { this.show('join'); this.codeInput.focus(); });
    on('#double-join', () => this.actions.join(this.codeInput.value.trim(), this.name()));
    on('#double-entry-back', () => this.stage === 'join' ? this.show('entry') : this.actions.back());
    on('#double-room-back', () => this.actions.back());
    on('#double-invite', () => this.actions.copyInvite());
    on('#double-ready', () => this.actions.ready(!this.room?.members.find(member => member.id === this.localId)?.ready));
    on('#double-start', () => this.actions.start());
    root.querySelectorAll<HTMLButtonElement>('[data-double-date]').forEach(button => button.addEventListener('click', () => { void this.run(() => this.actions.choose(button.dataset.doubleDate as DateId)); }));
    for (const input of [this.nameInput, this.codeInput]) input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); root.querySelector<HTMLButtonElement>(this.stage === 'join' ? '#double-join' : '#double-create')?.click(); } });
  }

  private name() { return this.nameInput.value.trim() || 'Guest'; }
  private async run(action: () => LobbyAction) {
    if (this.busy) return;
    this.showError('');
    try { this.setBusy(true); await action(); }
    catch (error) { this.showError(error instanceof Error ? error.message : 'Could not connect. Try again.'); }
    finally { this.setBusy(false); }
  }
  show(stage: LobbyStage = 'entry') {
    this.stage = stage; this.element.hidden = false;
    this.element.querySelector<HTMLElement>('.double-entry')!.hidden = stage === 'room';
    this.element.querySelector<HTMLElement>('.double-room')!.hidden = stage !== 'room';
    this.element.querySelector<HTMLElement>('.double-code')!.hidden = stage !== 'join';
    this.element.querySelector<HTMLButtonElement>('#double-create')!.hidden = stage === 'join';
    this.element.querySelector<HTMLButtonElement>('#double-join-open')!.hidden = stage === 'join';
    this.element.querySelector<HTMLButtonElement>('#double-join')!.hidden = stage !== 'join';
    this.showError('');
  }
  hide() { this.element.hidden = true; }
  setInviteCode(code: string) { this.codeInput.value = code; }
  setBusy(value: boolean) {
    this.busy = value; this.element.setAttribute('aria-busy', String(value));
    this.element.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.double-entry button, .double-entry input').forEach(control => { control.disabled = value; });
    this.renderRoom();
  }
  showError(message: string) { this.error.textContent = message; this.error.hidden = !message; }
  update(room: DoubleDateRoomState, localId: DoubleHumanId) {
    this.room = room; this.localId = localId;
    if (this.stage !== 'room') this.show('room');
    this.renderRoom();
  }
  private renderRoom() {
    if (!this.room || !this.localId) return;
    const room = this.room, me = room.members.find(member => member.id === this.localId);
    const other = room.members.find(member => member.id !== this.localId);
    this.element.querySelector<HTMLElement>('.double-invite-code strong')!.textContent = room.code;
    const people = this.element.querySelector<HTMLElement>('.double-people')!;
    people.replaceChildren(...[me, other].map((member, index) => {
      const row = document.createElement('p');
      const name = document.createElement('strong');
      const chosen = DATES.find(date => date.id === member?.dateId);
      name.textContent = `${member?.name || (index ? 'Friend' : 'You')}${chosen ? ` + ${chosen.name}` : ''}`;
      const status = document.createElement('span'); status.textContent = !member ? 'Waiting' : !member.connected ? 'Disconnected' : member.ready ? 'Ready' : 'Choosing';
      row.append(name, status); return row;
    }));
    this.element.querySelectorAll<HTMLButtonElement>('[data-double-date]').forEach(button => {
      const selected = button.dataset.doubleDate === me?.dateId;
      const taken = !!other?.dateId && other.dateId === button.dataset.doubleDate;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('taken', taken);
      button.title = taken ? `${other?.name || 'Your friend'} chose this date` : '';
      button.disabled = this.busy || taken;
    });
    const date = DATES.find(candidate => candidate.id === me?.dateId);
    this.element.querySelector<HTMLElement>('.double-date-detail')!.textContent = date ? `${date.age} · ${date.pronouns} — ${date.description}` : '';
    const ready = this.element.querySelector<HTMLButtonElement>('#double-ready')!;
    ready.textContent = me?.ready ? 'Not ready' : 'Ready'; ready.disabled = this.busy || !me?.dateId || !me.connected;
    const start = this.element.querySelector<HTMLButtonElement>('#double-start')!;
    start.hidden = room.hostId !== this.localId; start.disabled = this.busy || room.members.length < 2 || room.members.some(member => !member.connected || !member.ready || !member.dateId);
    this.element.querySelector<HTMLButtonElement>('#double-invite')!.disabled = this.busy;
  }
  dispose() { this.element.remove(); }
}
