import { UI_THEME, canvasFont } from './theme';
import { getDate } from './content';
import { DESSERTS } from './evening';
import type { DateId, DinnerCommand, DinnerState } from './types';

type Activity = 'coasters' | 'napkin' | 'dessert';
type Point = [number, number];
const WIDTH = 350, HEIGHT = 230;
/** Tabletop tools send intentions; all scores, portions and completion come back from the server. */
export class TableActivities {
  private readonly panel: HTMLElement;
  private state?: DinnerState;
  private kind: Activity | null = null;
  private canvas?: HTMLCanvasElement;
  private angle = 0;
  private power = .5;
  private pointer: Point | null = null;
  private drawing = false;
  private heldPiece: number | null = null;
  private gesturePointer: number | null = null;
  private gestureDraft: { points: Point[]; dirty: boolean } | null = null;
  private readonly lifecycle = new AbortController();
  private points: Point[] = [];
  private draftDirty = false;
  private pendingUntil = 0;
  private signature = '';
  private lastRoom = '';
  private disposed = false;

  constructor(private readonly container: HTMLElement, private readonly onCommand: (command: DinnerCommand) => void, private readonly onClose?: () => void,
    private readonly boardView?: { project(x: number, z: number): Point | null }) {
    container.classList.add('table-activities');
    this.panel = document.createElement('section');
    this.panel.className = 'ta-panel';
    this.panel.dataset.gameMenu = '';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Table activity');
    container.append(this.panel);
    this.panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } });
    this.panel.addEventListener('pointerdown', event => event.stopPropagation());
    const cancel = () => this.cancelGesture();
    window.addEventListener('blur', cancel, { signal: this.lifecycle.signal });
    window.addEventListener('resize', cancel, { signal: this.lifecycle.signal });
    window.addEventListener('orientationchange', cancel, { signal: this.lifecycle.signal });
    screen.orientation?.addEventListener('change', cancel, { signal: this.lifecycle.signal });
    window.visualViewport?.addEventListener('resize', cancel, { signal: this.lifecycle.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, { signal: this.lifecycle.signal });
  }

  get activeKind() { return this.kind; }
  get isOpen() { return this.kind !== null; }

  open(kind: Activity) {
    const incident = this.state?.doubleDate?.role === 'wingman' ? this.state.doubleDate.otherView?.evening.incident : this.state?.evening.incident;
    if (this.disposed || (this.state?.doubleDate?.role === 'wingman' && !(kind === 'coasters' && this.watchingFriend())) || incident || (this.state?.doubleDate?.scenario ?? this.state?.evening.scenario)?.phase === 'active') return;
    this.cancelGesture();
    this.kind = kind;
    this.container.dataset.activity = kind;
    this.container.classList.toggle('physical-coasters', kind === 'coasters' && !!this.boardView);
    this.pointer = null;
    this.heldPiece = null;
    this.drawing = false;
    if (!this.draftDirty) this.points = this.state?.evening.napkin.points.map(p => [...p] as Point) ?? [];
    this.panel.hidden = false;
    this.signature = '';
    this.build();
    this.refresh();
    this.panel.querySelector<HTMLButtonElement>('.ta-close')?.focus({ preventScroll: true });
  }

  close() {
    if (!this.kind) return;
    this.cancelGesture();
    this.kind = null;
    delete this.container.dataset.activity;
    this.container.classList.remove('physical-coasters');
    this.pointer = null;
    this.heldPiece = null;
    this.drawing = false;
    this.panel.hidden = true;
    this.onClose?.();
  }

  update(state: DinnerState) {
    if (this.disposed) return;
    if (state.id !== this.lastRoom) { this.lastRoom = state.id; this.points = []; this.draftDirty = false; }
    this.state = state;
    if (state.phase === 'ended') { this.close(); return; }
    const incident = state.doubleDate?.role === 'wingman' ? state.doubleDate.otherView?.evening.incident : state.evening.incident;
    if (this.kind && ((state.doubleDate?.role === 'wingman' && !(this.kind === 'coasters' && this.watchingFriend())) || incident || (state.doubleDate?.scenario ?? state.evening.scenario)?.phase === 'active')) {
      this.close();
      const drawer = this.container.parentElement?.querySelector<HTMLDetailsElement>('.action-drawer');
      if (drawer) {
        drawer.open = true;
        drawer.querySelector('summary')?.focus({ preventScroll: true });
      }
      return;
    }
    if (state.phase !== 'playing') this.cancelGesture();
    if (!this.drawing && !this.draftDirty) this.points = state.evening.napkin.points.map(p => [...p] as Point);
    if (this.draftDirty && JSON.stringify(this.points) === JSON.stringify(state.evening.napkin.points)) this.draftDirty = false;
    if (this.kind) this.refresh();
  }

  private button(text: string, action: () => void, secondary = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.gameItem = ''; button.className = `ta-button${secondary ? ' secondary' : ''}`; button.textContent = text;
    button.addEventListener('click', action); return button;
  }

  private build() {
    this.cancelGesture();
    const title = { coasters: 'Coaster clash', napkin: 'Doodle duet', dessert: 'Sweet split' }[this.kind!];
    this.panel.innerHTML = `<div class="ta-top"><div><small>On the table</small><h3>${title}</h3></div><button type="button" data-game-item class="ta-close" aria-label="Close table activity">×</button></div><p class="ta-copy"></p><canvas class="ta-board" width="700" height="460"></canvas><div class="ta-score"></div><p class="ta-status" role="status" aria-live="polite"></p><div class="ta-extra"></div><p class="ta-note"></p>`;
    this.panel.querySelector('.ta-close')!.addEventListener('click', () => this.close());
    this.canvas = this.panel.querySelector('canvas')!;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', this.kind === 'coasters' ? 'Live coaster board. Aim with the sliders and Shoot button, or drag back from your disc.' : this.kind === 'napkin' ? 'A napkin with your date’s drawing. Add one continuous line using a pointer.' : 'Four dessert pieces and two plates. Drag an unserved piece onto a plate or use the serving buttons.');
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', event => this.pointerUp(event));
    for (const type of ['pointercancel', 'lostpointercapture']) this.canvas.addEventListener(type, event => {
      if ((event as PointerEvent).pointerId === this.gesturePointer) this.cancelGesture();
    });
    const extra = this.panel.querySelector('.ta-extra')!;
    if (this.kind === 'coasters') {
      extra.innerHTML = '<div class="ta-controls"><label>Aim <input class="ta-aim" aria-label="Coaster aim in degrees" type="range" min="-68" max="68" step="1" value="0"></label><label>Power <input class="ta-power" aria-label="Coaster shot power" type="range" min="10" max="100" step="1" value="50"></label></div><div class="ta-row"></div>';
      extra.querySelector<HTMLInputElement>('.ta-aim')!.value = String(Math.round(this.angle * 180 / Math.PI));
      extra.querySelector<HTMLInputElement>('.ta-power')!.value = String(Math.round(this.power * 100));
      extra.querySelector<HTMLInputElement>('.ta-aim')!.addEventListener('input', event => { this.angle = Number((event.target as HTMLInputElement).value) * Math.PI / 180; });
      extra.querySelector<HTMLInputElement>('.ta-power')!.addEventListener('input', event => { this.power = Number((event.target as HTMLInputElement).value) / 100; });
      extra.querySelector('.ta-row')!.append(this.button('Play', () => { this.pendingUntil = performance.now() + 2500; this.onCommand({ type: 'evening', action: 'start-coasters' }); }), this.button('Shoot', () => this.shoot()));
    } else if (this.kind === 'napkin') {
      const row = document.createElement('div'); row.className = 'ta-row';
      row.append(this.button('Clear my line', () => { this.points = []; this.draftDirty = true; this.onCommand({ type: 'napkin', points: [], complete: false }); }), this.button('Save our napkin', () => { if (this.canDraw() && this.points.length >= 8) { this.draftDirty = true; this.onCommand({ type: 'napkin', points: this.points.map(p => [...p] as Point), complete: true }); } }));
      extra.append(row);
    } else extra.innerHTML = '<details class="ta-serving"><summary>Serve by keyboard</summary><div class="ta-portions"></div></details>';
  }

  private canPlay() { return !!this.state && this.state.doubleDate?.role !== 'wingman' && this.state.phase === 'playing' && this.state.seated && !this.state.evening.incident && (this.state.doubleDate?.scenario ?? this.state.evening.scenario)?.phase !== 'active' && this.state.evening.stance !== 'leaving' && !this.state.evening.farewell.ending; }
  private watchingFriend() { const d = this.state?.doubleDate; return !!d?.tableActivity && d.tableActivity.owner !== d.localHumanId; }
  private boardState() { return this.watchingFriend() ? this.state?.doubleDate?.otherView : this.state; }
  private canShoot() { return !this.watchingFriend() && this.canPlay() && this.state?.evening.coasters.phase === 'aiming' && this.state.evening.coasters.turn === 'human' && performance.now() >= this.pendingUntil; }
  private canDraw() { return this.canPlay() && !this.state!.evening.napkin.complete; }
  private shoot() { if (this.canShoot()) { this.pendingUntil = performance.now() + 1800; this.onCommand({ type: 'coaster-shot', angle: this.angle, power: this.power }); } }
  private point(event: PointerEvent): Point {
    const r = this.canvas!.getBoundingClientRect();
    const normalized = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
    return [normalized((event.clientX - r.left) / r.width), normalized((event.clientY - r.top) / r.height)];
  }
  private pointerDown(event: PointerEvent) {
    event.preventDefault(); event.stopPropagation(); if (!this.state || this.gesturePointer !== null) return;
    const point = this.point(event);
    if (this.kind === 'napkin' && this.canDraw()) {
      this.gestureDraft = { points: this.points.map(point => [...point] as Point), dirty: this.draftDirty };
      this.drawing = true; this.addPoint(point);
    }
    else if (this.kind === 'coasters' && this.canShoot()) {
      const disc = this.boardPoint(this.state.evening.coasters.disc.x, this.state.evening.coasters.disc.z);
      const viewportDisc = this.boardView?.project(this.state.evening.coasters.disc.x, this.state.evening.coasters.disc.z);
      const distance = viewportDisc
        ? Math.hypot(event.clientX - viewportDisc[0], event.clientY - viewportDisc[1])
        : Math.hypot(point[0] * WIDTH - disc[0], point[1] * HEIGHT - disc[1]);
      if (distance < 32) this.pointer = point;
    } else if (this.kind === 'dessert' && this.canPlay() && this.state.evening.dessert.status === 'served') {
      for (let piece = 0; piece < 4; piece++) {
        if (this.state.evening.dessert.portions.some(p => p.piece === piece)) continue;
        const p = this.dessertPoint(piece);
        if (Math.hypot(point[0] * WIDTH - p[0], point[1] * HEIGHT - p[1]) < 23) { this.heldPiece = piece; this.pointer = point; break; }
      }
    }
    if (this.drawing || this.pointer || this.heldPiece !== null) {
      this.gesturePointer = event.pointerId;
      this.canvas!.setPointerCapture(event.pointerId);
    }
  }
  private pointerMove(event: PointerEvent) {
    if (event.pointerId !== this.gesturePointer) return;
    if (this.drawing) { event.preventDefault(); this.addPoint(this.point(event)); }
    if (this.pointer) {
      event.preventDefault(); this.pointer = this.point(event);
      if (this.kind === 'coasters' && this.state) {
        const disc = this.boardPoint(this.state.evening.coasters.disc.x, this.state.evening.coasters.disc.z);
        const dx = disc[0] - this.pointer[0] * WIDTH, dz = disc[1] - this.pointer[1] * HEIGHT;
        const xAxis = this.boardPoint(this.state.evening.coasters.disc.x + 1, this.state.evening.coasters.disc.z);
        const zAxis = this.boardPoint(this.state.evening.coasters.disc.x, this.state.evening.coasters.disc.z + .2);
        const pullX = dx / Math.max(1, xAxis[0] - disc[0]);
        const pullZ = dz * .2 / Math.max(1, zAxis[1] - disc[1]);
        this.angle = Math.max(-1.18, Math.min(1.18, Math.atan2(pullX, -pullZ)));
        this.power = Math.max(.1, Math.min(1, Math.hypot(pullX, pullZ) / .57));
        this.panel.querySelector<HTMLInputElement>('.ta-aim')!.value = String(Math.round(this.angle * 180 / Math.PI));
        this.panel.querySelector<HTMLInputElement>('.ta-power')!.value = String(Math.round(this.power * 100));
      }
    }
  }
  private pointerUp(event: PointerEvent) {
    if (event.pointerId !== this.gesturePointer) return;
    if (this.drawing) { this.addPoint(this.point(event)); this.drawing = false; this.draftDirty = true; this.onCommand({ type: 'napkin', points: this.points.map(p => [...p] as Point), complete: false }); }
    if (this.pointer && this.kind === 'coasters') this.shoot();
    if (this.heldPiece !== null && this.kind === 'dessert') {
      const point = this.point(event), x = point[0] * WIDTH, y = point[1] * HEIGHT;
      const plate = Math.hypot(x - 78, (y - 176) * 1.7) < 67 ? 'you' : Math.hypot(x - 272, (y - 176) * 1.7) < 67 ? 'date' : null;
      if (plate && this.canPlay()) this.serve(this.heldPiece, plate);
    }
    this.gestureDraft = null;
    this.cancelGesture();
  }
  private cancelGesture() {
    const pointerId = this.gesturePointer;
    this.gesturePointer = null;
    this.pointer = null; this.heldPiece = null; this.drawing = false;
    if (this.gestureDraft) {
      this.points = this.gestureDraft.points;
      this.draftDirty = this.gestureDraft.dirty;
      this.gestureDraft = null;
    }
    if (pointerId !== null && this.canvas?.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
  }
  private addPoint(point: Point) {
    if (this.points.length >= 600) return;
    const last = this.points.at(-1);
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > .004) this.points.push(point);
    this.draftDirty = true;
  }
  private serve(piece: number, plate: 'you' | 'date') {
    if (this.canPlay() && this.state?.evening.dessert.status === 'served' && !this.state.evening.dessert.portions.some(p => p.piece === piece)) this.onCommand({ type: 'evening', action: 'serve-dessert', piece, plate });
  }

  private refresh() {
    if (!this.state || !this.kind) return;
    const state = this.state, e = state.evening, name = getDate(state.dateId)!.name;
    const buttons = this.panel.querySelectorAll<HTMLButtonElement>('.ta-extra button');
    const status = this.panel.querySelector<HTMLElement>('.ta-status')!;
    const copy = this.panel.querySelector<HTMLElement>('.ta-copy')!;
    const note = this.panel.querySelector<HTMLElement>('.ta-note')!;
    const score = this.panel.querySelector<HTMLElement>('.ta-score')!;
    const text = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };
    if (this.kind === 'coasters') {
      const watching = this.watchingFriend(), board = this.boardState() ?? state, game = board.evening.coasters;
      const owner = state.doubleDate?.members.find(member => member.id === state.doubleDate?.tableActivity?.owner)?.name ?? 'Your friend';
      const boardDate = getDate(board.dateId)?.name ?? 'Date';
      text(copy, watching ? `${owner} and ${boardDate} ${game.phase === 'complete' ? 'finished their game' : 'are playing'}.` : `Aim for the centre. You and ${name} each get three shots.`);
      const watchedResult = game.lastResult.replace(/^Your date\b/, () => boardDate).replace(/^You\b/, () => owner);
      text(status, e.incident ? 'Finish the interruption before another shot.' : watching ? game.phase === 'complete' ? watchedResult || 'Game complete.' : game.phase === 'rolling' ? 'Coaster in motion…' : game.turn === 'date' ? `${boardDate} is lining up a shot…` : `${owner} is lining up a shot…` : !state.seated ? 'Take your seat to play.' : game.phase === 'idle' ? 'Aim for the center.' : game.phase === 'complete' ? game.lastResult || 'Game complete.' : game.phase === 'rolling' ? 'Coaster in motion…' : game.turn === 'date' ? `${name} is lining up a shot…` : 'Drag back and release, or aim and press Shoot.');
      const scoreSignature = JSON.stringify([watching ? owner : 'You', boardDate, game.humanScore, game.dateScore, game.round]);
      if (score.dataset.signature !== scoreSignature) {
        score.dataset.signature = scoreSignature;
        const result = (label: string, points: number) => { const span = document.createElement('span'); span.append(document.createTextNode(label + ' ')); const strong = document.createElement('strong'); strong.textContent = String(points); span.append(strong); return span; };
        const round = document.createElement('span'); round.textContent = `Round ${Math.min(3, game.round)} / 3`;
        score.replaceChildren(result(watching ? owner : 'You', game.humanScore), round, result(boardDate, game.dateScore));
      }
      buttons[0]!.disabled = watching && game.phase !== 'complete' || !this.canPlay() || !state.order || e.bill.requested || !['idle', 'complete'].includes(game.phase) || performance.now() < this.pendingUntil;
      buttons[0]!.textContent = game.phase === 'complete' ? 'Play again' : 'Play';
      buttons[0]!.hidden = (watching && (game.phase !== 'complete' || state.doubleDate?.role === 'wingman')) || !['idle', 'complete'].includes(game.phase);
      buttons[1]!.hidden = !buttons[0]!.hidden;
      if (watching) buttons[1]!.hidden = true;
      buttons[1]!.disabled = !this.canShoot();
      this.panel.querySelectorAll<HTMLInputElement>('input').forEach(input => input.disabled = !this.canShoot());
      text(note, 'Three rounds. Two shots each round. A lucky bounce still counts.');
    } else if (this.kind === 'napkin') {
      text(copy, `${name} started a doodle. Add one continuous line and make something together.`);
      text(status, e.napkin.complete ? 'Saved as a little moment from your evening.' : e.incident ? 'Deal with the interruption, then come back to your drawing.' : !state.seated ? 'Take a seat to draw.' : this.points.length >= 8 ? 'Keep going, or save your napkin.' : 'Draw on the napkin with your mouse or finger.');
      text(score, this.points.length >= 560 ? `${600 - this.points.length} drawing points left` : '');
      buttons[0]!.disabled = !this.canDraw() || this.points.length === 0;
      buttons[1]!.disabled = !this.canDraw() || this.points.length < 8;
      text(note, 'One line from each of you. Keep it wonderfully imperfect.');
    } else {
      const dessert = DESSERTS.find(d => d.id === e.dessert.choice || d.name === e.dessert.choice);
      text(copy, `${dessert?.name ?? 'Dessert'}, two plates. Drag pieces onto a plate or use the serving buttons.`);
      text(status, e.dessert.status === 'served' ? `${e.dessert.portions.length} of 4 pieces served.` : e.dessert.status === 'finished' ? 'The last sweet bite of the evening.' : 'Choose dessert and wait for it to arrive.');
      text(score, `Your plate: ${e.dessert.portions.filter(p => p.plate === 'you').length} · ${name}’s plate: ${e.dessert.portions.filter(p => p.plate === 'date').length}`);
      const signature = JSON.stringify([state.id, state.phase, state.seated, e.incident?.event, e.dessert.status, e.dessert.portions]);
      if (signature !== this.signature) {
        this.signature = signature;
        const list = this.panel.querySelector('.ta-portions')!; list.replaceChildren();
        for (let piece = 0; piece < 4; piece++) {
          const row = document.createElement('div'); row.className = 'ta-piece-row';
          const assigned = e.dessert.portions.find(p => p.piece === piece), label = document.createElement('span');
          label.textContent = `${['Top left', 'Top right', 'Bottom left', 'Bottom right'][piece]}${assigned ? ` · ${assigned.plate === 'you' ? 'your plate' : `${name}’s plate`}` : ''}`; row.append(label);
          if (!assigned) for (const plate of ['you', 'date'] as const) {
            const button = this.button(plate === 'you' ? 'For you' : `For ${name}`, () => this.serve(piece, plate), true);
            button.disabled = !this.canPlay() || e.dessert.status !== 'served'; row.append(button);
          }
          list.append(row);
        }
      }
      text(note, 'A little for you. A little for them. Or something in between.');
    }
    this.draw();
  }

  private boardPoint(x: number, z: number): Point {
    const projected = this.boardView?.project(x, z);
    if (projected && this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      return [(projected[0] - rect.left) * WIDTH / rect.width, (projected[1] - rect.top) * HEIGHT / rect.height];
    }
    return [WIDTH / 2 + x * 175, HEIGHT / 2 + z * 175];
  }
  private dessertPoint(piece: number): Point {
    const assigned = this.state?.evening.dessert.portions.find(p => p.piece === piece);
    if (assigned) return [(assigned.plate === 'you' ? 78 : 272) + (piece % 2 ? 14 : -14), 176 + (piece < 2 ? -9 : 9)];
    return [144 + (piece % 2) * 62, 56 + Math.floor(piece / 2) * 52];
  }
  private draw() {
    if (!this.canvas || !this.state || !this.kind) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (this.kind === 'coasters') this.drawCoasters(ctx);
    else if (this.kind === 'napkin') this.drawNapkin(ctx, this.state.dateId);
    else this.drawDessert(ctx);
  }
  private drawCoasters(ctx: CanvasRenderingContext2D) {
    const game = (this.boardState() ?? this.state!).evening.coasters;
    if (this.boardView) {
      if (!this.canShoot()) return;
      const length = .15 + .29 * this.power;
      const disc = this.boardPoint(game.disc.x, game.disc.z);
      const aim = this.boardPoint(game.disc.x + Math.sin(this.angle) * length, game.disc.z - Math.cos(this.angle) * length);
      ctx.strokeStyle = '#67263d'; ctx.lineWidth = 1.3; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(...disc); ctx.lineTo(...aim); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#67263d'; ctx.beginPath(); ctx.arc(...aim, 1.8, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.fillStyle = UI_THEME.board; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (let i = 0; i < 8; i++) { ctx.strokeStyle = '#ffffff55'; ctx.beginPath(); ctx.moveTo(0, i * 31); ctx.lineTo(WIDTH, i * 31 + 2); ctx.stroke(); }
    ctx.strokeStyle = UI_THEME.ink; ctx.lineWidth = 5; ctx.strokeRect(94, 17, 162, 196);
    const target = this.boardPoint(game.target.x, game.target.z);
    for (const [r, color] of [[.27, UI_THEME.paper], [.16, '#f5b6c1'], [.08, UI_THEME.signal]] as const) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(target[0], target[1], r * 175, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#101d3166'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(97, 173); ctx.lineTo(253, 173); ctx.stroke();
    const disc = this.boardPoint(game.disc.x, game.disc.z);
    if (this.canShoot()) {
      const length = 35 + this.power * 65, end: Point = [disc[0] + Math.sin(this.angle) * length, disc[1] - Math.cos(this.angle) * length];
      ctx.strokeStyle = UI_THEME.ink; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(...disc); ctx.lineTo(...end); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(end[0] - 5, end[1] + 8); ctx.lineTo(...end); ctx.lineTo(end[0] + 5, end[1] + 8); ctx.stroke();
    }
    ctx.fillStyle = '#2d261d44'; ctx.beginPath(); ctx.ellipse(disc[0] + 1, disc[1] + 2, 7, 6.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = game.turn === 'date' ? UI_THEME.signal : UI_THEME.boardAccent; ctx.beginPath(); ctx.arc(...disc, .035 * 175, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = UI_THEME.paper; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(...disc, 4, 0, Math.PI * 2); ctx.stroke();
  }
  private drawNapkin(ctx: CanvasRenderingContext2D, dateId: DateId) {
    ctx.fillStyle = '#f6e9d2'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (let y = 1; y < HEIGHT; y += 3) { ctx.fillStyle = '#6b4c3512'; ctx.fillRect(0, y, WIDTH, .6); }
    ctx.strokeStyle = '#bba380'; ctx.lineWidth = 1; ctx.strokeRect(12, 12, WIDTH - 24, HEIGHT - 24);
    for (let x = 20; x < WIDTH; x += 11) { ctx.fillStyle = '#b8b39a17'; ctx.fillRect(x, 14, 1, HEIGHT - 28); }
    ctx.strokeStyle = UI_THEME.signal; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    if (dateId === 'mira') {
      for (let i = 0; i <= 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 19 : 43; const x = 100 + Math.cos(a) * r, y = 101 + Math.sin(a) * r; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    } else if (dateId === 'jules') {
      ctx.moveTo(65, 149); ctx.bezierCurveTo(80, 110, 139, 102, 142, 56); ctx.bezierCurveTo(79, 65, 62, 91, 65, 149); ctx.moveTo(65, 149); ctx.lineTo(128, 76);
    } else {
      ctx.arc(103, 104, 41, 0, Math.PI * 2); ctx.moveTo(62, 104); ctx.lineTo(144, 104); ctx.moveTo(103, 63); ctx.lineTo(103, 145); ctx.moveTo(75, 73); ctx.bezierCurveTo(114, 88, 115, 120, 75, 135);
    }
    ctx.stroke();
    ctx.font = canvasFont(12, 'body', 600); ctx.fillStyle = UI_THEME.boardAccent; ctx.fillText(`${getDate(dateId)!.name} started this…`, 31, 202);
    ctx.strokeStyle = UI_THEME.boardAccent; ctx.lineWidth = 2.2; ctx.beginPath();
    this.points.forEach((point, index) => { if (!index) ctx.moveTo(point[0] * WIDTH, point[1] * HEIGHT); else ctx.lineTo(point[0] * WIDTH, point[1] * HEIGHT); }); ctx.stroke();
  }
  private drawDessert(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#a87055'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (let y = 0; y < HEIGHT; y += 7) { ctx.fillStyle = '#724a3926'; ctx.fillRect(0, y, WIDTH, 1); }
    ctx.fillStyle = '#e8cda7'; ctx.beginPath(); ctx.ellipse(175, 84, 86, 66, 0, 0, Math.PI * 2); ctx.fill();
    for (const [x, label] of [[78, 'YOU'], [272, getDate(this.state!.dateId)!.name.toUpperCase()]] as const) {
      ctx.fillStyle = UI_THEME.paper; ctx.beginPath(); ctx.ellipse(x, 176, 66, 38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = UI_THEME.boardAccent; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, 176, 54, 28, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.font = canvasFont(12); ctx.textAlign = 'center'; ctx.fillStyle = '#fff4de'; ctx.fillText(label, x, 225);
    }
    if (['served', 'finished'].includes(this.state!.evening.dessert.status)) for (let piece = 0; piece < 4; piece++) {
      const p = this.heldPiece === piece && this.pointer ? [this.pointer[0] * WIDTH, this.pointer[1] * HEIGHT] : this.dessertPoint(piece);
      ctx.fillStyle = '#54422d33'; ctx.beginPath(); ctx.ellipse(p[0]! + 2, p[1]! + 4, 19, 15, 0, 0, Math.PI * 2); ctx.fill();
      const choice = this.state!.evening.dessert.choice ?? '';
      ctx.fillStyle = choice.includes('chocolate') ? '#6d422e' : choice.includes('berries') ? '#be6552' : '#e8c66e';
      ctx.beginPath(); ctx.roundRect(p[0]! - 18, p[1]! - 15, 36, 30, 7); ctx.fill();
      ctx.fillStyle = '#f7eccd'; ctx.beginPath(); ctx.ellipse(p[0]!, p[1]! - 7, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.textAlign = 'left';
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.cancelGesture(); this.lifecycle.abort(); this.close(); this.panel.remove(); this.container.classList.remove('table-activities');
  }
}
