import './mobile.css';
import { MobileInput } from './MobileInput';
import { TouchButtonGesture } from './TouchButtonGesture';
import { TouchLookTap } from './TouchLookTap';

export type MobileControlsActions = {
  look(dx: number, dy: number): void;
  tap?(x: number, y: number): void;
  interact(): void;
  actions(): void;
  talk(): void;
  closeTalk(): void;
  mic(): void;
  pause(): void;
  release(): void;
  notice(message: string): void;
};
export type MobileControlsState = {
  joined: boolean;
  playing: boolean;
  blocked: boolean;
  modal: boolean;
  typing: boolean;
  seated: boolean;
  actionsAvailable: boolean;
  actionsOpen: boolean;
  micEnabled: boolean;
  interactionLabel: string | null;
  activityOpen?: boolean;
};
const emptyState: MobileControlsState = { joined: false, playing: false, blocked: false, modal: false, typing: false, seated: false, actionsAvailable: false, actionsOpen: false, micEnabled: false, interactionLabel: null };

/** Touch input is deliberately separate from keyboard state and server movement. */
export class MobileControls {
  private readonly input = new MobileInput();
  private readonly abort = new AbortController();
  private readonly buttonGestures = new Set<TouchButtonGesture>();
  private readonly lookTap = new TouchLookTap();
  private readonly coarse = matchMedia('(pointer: coarse)');
  private readonly controls: HTMLElement;
  private readonly movePad: HTMLElement;
  private readonly lookPad: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly context: HTMLButtonElement;
  private readonly actionsButton: HTMLButtonElement;
  private readonly micButton: HTMLButtonElement;
  private readonly rotate: HTMLElement;
  private readonly displayButton: HTMLButtonElement;
  private readonly settingsDisplayButton: HTMLButtonElement;
  private readonly displayHelp: HTMLElement;
  private readonly closeTalkButton: HTMLButtonElement;
  private state = emptyState;
  private active = false;
  private isPortrait = false;
  private canGesture = false;
  private helpOpen = false;
  private disposed = false;
  private signature = '';
  private displayReturnFocus: HTMLElement | null = null;

  constructor(private readonly app: HTMLElement, private readonly actions: MobileControlsActions) {
    this.controls = document.createElement('div');
    this.controls.id = 'mobile-controls';
    this.controls.hidden = true;
    this.controls.innerHTML = `<div id="mobile-look" class="mobile-look" role="group" aria-label="Drag with your right thumb to look"><span>Drag to look</span></div>
      <div id="mobile-move" class="mobile-move" role="group" aria-label="Drag with your left thumb to move"><span class="mobile-stick-ring"><span class="mobile-stick"></span></span><span class="mobile-pad-label">Move</span></div>
      <nav class="mobile-toolbar" aria-label="Dinner controls"><button id="mobile-actions" type="button" aria-expanded="false">Actions</button><button id="mobile-talk" type="button">Talk</button><button id="mobile-mic" type="button" aria-label="Turn microphone on" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" fill="none" stroke="currentColor" stroke-width="2"/><path class="mobile-mic-slash" d="m4 20 16-16" stroke="currentColor" stroke-width="2"/></svg><span class="sr-only">Microphone</span></button><button id="mobile-pause" type="button" aria-label="Pause dinner">Pause</button></nav>
      <button id="mobile-interact" class="mobile-interact" type="button" hidden></button>`;
    this.movePad = this.controls.querySelector('#mobile-move')!;
    this.lookPad = this.controls.querySelector('#mobile-look')!;
    this.stick = this.controls.querySelector('.mobile-stick')!;
    this.context = this.controls.querySelector('#mobile-interact')!;
    this.actionsButton = this.controls.querySelector('#mobile-actions')!;
    this.micButton = this.controls.querySelector('#mobile-mic')!;
    this.rotate = document.createElement('aside');
    this.rotate.id = 'mobile-rotate'; this.rotate.hidden = true;
    this.rotate.innerHTML = '<span aria-hidden="true">↻</span><strong>A little more room.</strong><p>Turn your phone sideways to play.</p><button type="button">Pause</button>';
    this.bindAction(this.rotate.querySelector('button')!, () => this.actions.pause());
    this.displayButton = document.createElement('button');
    this.displayButton.id = 'mobile-display'; this.displayButton.type = 'button'; this.displayButton.hidden = true;
    this.settingsDisplayButton = document.createElement('button');
    this.settingsDisplayButton.id = 'mobile-display-settings'; this.settingsDisplayButton.type = 'button'; this.settingsDisplayButton.hidden = true;
    this.settingsDisplayButton.dataset.gameItem = '';
    const settings = app.querySelector('#settings-dialog .paper-dialog');
    settings?.insertBefore(this.settingsDisplayButton, settings.querySelector('#developer-settings'));
    this.displayHelp = document.createElement('section');
    this.displayHelp.id = 'mobile-display-help'; this.displayHelp.hidden = true;
    this.displayHelp.dataset.gameMenu = '';
    this.displayHelp.setAttribute('role', 'dialog'); this.displayHelp.setAttribute('aria-modal', 'true');
    this.displayHelp.setAttribute('aria-labelledby', 'mobile-display-title');
    this.displayHelp.innerHTML = '<div><h2 id="mobile-display-title">A table without browser bars.</h2><p id="mobile-display-copy"></p><p>Playing here in your browser works too.</p><button id="mobile-display-close" type="button" data-game-item>Back to the evening</button></div>';
    this.closeTalkButton = document.createElement('button');
    this.closeTalkButton.id = 'mobile-talk-close'; this.closeTalkButton.type = 'button';
    this.closeTalkButton.textContent = 'Back'; this.closeTalkButton.setAttribute('aria-label', 'Close typing and return to dinner');
    this.closeTalkButton.addEventListener('click', () => { this.clear(); this.actions.closeTalk(); }, { signal: this.abort.signal });
    app.querySelector('#conversation-form')?.append(this.closeTalkButton);
    app.append(this.controls, this.rotate, this.displayButton, this.displayHelp);

    const click = (id: string, callback: () => void) => this.bindAction(this.controls.querySelector<HTMLButtonElement>('#' + id)!, callback);
    click('mobile-actions', () => this.actions.actions());
    click('mobile-talk', () => this.actions.talk());
    click('mobile-mic', () => this.actions.mic());
    click('mobile-pause', () => this.actions.pause());
    click('mobile-interact', () => this.actions.interact());
    for (const button of [this.displayButton, this.settingsDisplayButton]) button.addEventListener('click', () => { this.displayReturnFocus = button; void this.expandDisplay(); }, { signal: this.abort.signal });
    this.displayHelp.querySelector('button')!.addEventListener('click', () => this.closeDisplayHelp(), { signal: this.abort.signal });
    this.displayHelp.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeDisplayHelp(); } }, { signal: this.abort.signal });
    // Observe every touch, including a second finger outside the look surface.
    window.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') return;
      this.lookTap.pointerDown(event.pointerId);
    }, { capture: true, signal: this.abort.signal });
    for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, event => {
      if (event.pointerType === 'touch') this.lookTap.pointerUp(event.pointerId);
    }, { capture: true, signal: this.abort.signal });
    this.bindPad(this.movePad, 'move'); this.bindPad(this.lookPad, 'look');
    const suspend = () => { this.clear(); this.lookTap.reset(); };
    window.addEventListener('blur', suspend, { signal: this.abort.signal });
    window.addEventListener('pagehide', suspend, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', suspend, { signal: this.abort.signal });
    window.addEventListener('orientationchange', () => { this.clear(); this.actions.release(); this.syncViewport(); }, { signal: this.abort.signal });
    screen.orientation?.addEventListener('change', () => { this.clear(); this.actions.release(); this.syncViewport(); }, { signal: this.abort.signal });
    window.addEventListener('resize', () => { this.clear(); this.syncViewport(); }, { signal: this.abort.signal });
    window.visualViewport?.addEventListener('resize', () => { this.clear(); this.syncViewport(); }, { signal: this.abort.signal });
    window.visualViewport?.addEventListener('scroll', () => this.syncViewport(), { signal: this.abort.signal });
    this.coarse.addEventListener('change', () => this.syncViewport(), { signal: this.abort.signal });
    document.addEventListener('fullscreenchange', () => { this.clear(); this.syncViewport(); }, { signal: this.abort.signal });
    this.syncViewport();
  }

  get enabled() { return this.active; }
  get portrait() { return this.isPortrait; }
  get movement() { return this.canGesture && !this.state.seated ? this.input.movement : { horizontal: 0, forward: 0 }; }
  get menuScope() { return this.helpOpen ? this.displayHelp : null; }

  update(state: MobileControlsState) {
    if (this.disposed) return;
    if (this.state.typing && !state.typing) this.isPortrait = innerHeight > innerWidth;
    if (this.state.seated !== state.seated) this.lookTap.cancel();
    this.state = state;
    const signature = [this.active, this.isPortrait, this.helpOpen, document.hidden, !!document.fullscreenElement, this.isStandalone(), this.supportsFullscreen(), ...Object.values(state)].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    const enabled = this.active && state.joined && state.playing && !state.modal && !state.typing && !this.helpOpen;
    const gesture = enabled && !state.blocked && !state.activityOpen && !this.isPortrait && !document.hidden;
    if (this.canGesture && !gesture) this.clear();
    this.canGesture = gesture;
    this.controls.hidden = !enabled || this.isPortrait;
    this.movePad.hidden = !gesture || state.seated;
    this.lookPad.hidden = !gesture;
    this.context.hidden = !gesture || !state.interactionLabel;
    if (state.interactionLabel && this.context.textContent !== state.interactionLabel) this.context.textContent = state.interactionLabel;
    this.actionsButton.disabled = !state.actionsAvailable || !!state.activityOpen;
    this.actionsButton.setAttribute('aria-expanded', String(state.actionsOpen));
    this.micButton.setAttribute('aria-pressed', String(state.micEnabled));
    this.micButton.setAttribute('aria-label', state.micEnabled ? 'Turn microphone off' : 'Turn microphone on');
    this.rotate.hidden = !this.active || !this.isPortrait || !state.joined || !state.playing || state.modal || state.typing || this.helpOpen;
    this.displayButton.hidden = !this.active || state.joined || state.modal || this.helpOpen || this.isStandalone();
    this.displayButton.textContent = this.supportsFullscreen() ? (document.fullscreenElement ? 'Exit full screen' : 'Full screen') : 'Home screen';
    this.settingsDisplayButton.hidden = !this.active || this.isStandalone();
    this.settingsDisplayButton.textContent = this.supportsFullscreen() ? (document.fullscreenElement ? 'Exit full screen' : 'Enter full screen') : 'Play from your Home Screen';
    this.app.dataset.mobileTyping = String(this.active && state.typing);
    this.app.dataset.mobilePlaying = String(this.active && state.joined && state.playing);
    this.app.dataset.mobileSeated = String(this.active && state.seated);
  }

  clear() {
    this.lookTap.cancel();
    for (const gesture of this.buttonGestures) gesture.cancel(undefined, performance.now());
    const moveId = this.input.movementPointer, lookId = this.input.lookPointer;
    this.input.clear();
    if (moveId !== null && this.movePad.hasPointerCapture(moveId)) this.movePad.releasePointerCapture(moveId);
    if (lookId !== null && this.lookPad.hasPointerCapture(lookId)) this.lookPad.releasePointerCapture(lookId);
    this.stick.style.removeProperty('translate');
    delete this.movePad.dataset.active; delete this.lookPad.dataset.active;
  }

  private bindAction(button: HTMLButtonElement, callback: () => void) {
    const gesture = new TouchButtonGesture(), opts = { signal: this.abort.signal };
    this.buttonGestures.add(gesture);
    const activate = () => { this.clear(); this.actions.release(); callback(); };
    button.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' || button.disabled) return;
      // Keep a delayed compatibility mousedown from stealing focus from Talk's input.
      event.preventDefault();
      gesture.begin(event.pointerId, event.clientX, event.clientY);
    }, opts);
    button.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') gesture.move(event.pointerId, event.clientX, event.clientY);
    }, opts);
    button.addEventListener('pointerup', event => {
      if (event.pointerType !== 'touch') return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const inside = !button.disabled && button.checkVisibility({ checkVisibilityCSS: true }) && !!hit && button.contains(hit);
      if (!gesture.end(event.pointerId, event.clientX, event.clientY, inside, performance.now())) return;
      // After a resized/canceled canvas gesture some browsers deliver pointerup without click.
      event.preventDefault();
      activate();
    }, opts);
    // Touch targets stay on the original button even if activation hides the toolbar.
    // Cancel its compatibility mouse sequence so it cannot refocus the exposed canvas.
    button.addEventListener('touchend', event => event.preventDefault(), { passive: false, signal: this.abort.signal });
    for (const type of ['pointercancel', 'lostpointercapture']) button.addEventListener(type, event => gesture.cancel((event as PointerEvent).pointerId, performance.now()), opts);
    button.addEventListener('click', event => {
      const pointer = event as PointerEvent;
      const capabilities = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities;
      if (gesture.ignoreClick(event.detail, pointer.pointerType, pointer.pointerId, performance.now(), capabilities?.firesTouchEvents)) { event.preventDefault(); return; }
      activate();
    }, opts);
  }

  private bindPad(pad: HTMLElement, kind: 'move' | 'look') {
    const opts = { signal: this.abort.signal };
    pad.addEventListener('pointerdown', event => {
      if (!this.canGesture || event.pointerType === 'mouse' || (kind === 'move' && this.state.seated)) return;
      event.preventDefault(); event.stopPropagation();
      const accepted = kind === 'move' ? this.input.beginMove(event.pointerId, event.clientX, event.clientY) : this.input.beginLook(event.pointerId, event.clientX, event.clientY);
      if (!accepted) return;
      if (kind === 'look' && event.pointerType === 'touch' && this.state.seated) this.lookTap.begin(event.pointerId, event.clientX, event.clientY, performance.now());
      pad.setPointerCapture(event.pointerId); pad.dataset.active = 'true';
    }, opts);
    pad.addEventListener('pointermove', event => {
      if (!this.canGesture) { this.clear(); return; }
      if (kind === 'move') {
        if (!this.input.move(event.pointerId, event.clientX, event.clientY)) return;
        const vector = this.input.movement;
        this.stick.style.translate = `${vector.horizontal * 35}px ${-vector.forward * 35}px`;
      } else {
        this.lookTap.move(event.pointerId, event.clientX, event.clientY);
        const delta = this.input.look(event.pointerId, event.clientX, event.clientY);
        if (!delta) return;
        this.actions.look(delta.x * 1.65, delta.y * 1.65);
      }
      event.preventDefault(); event.stopPropagation();
    }, opts);
    const end = (event: PointerEvent) => {
      const owns = kind === 'move' ? this.input.movementPointer === event.pointerId : this.input.lookPointer === event.pointerId;
      if (!owns) return;
      const tapped = kind === 'look' && event.type === 'pointerup' && event.pointerType === 'touch' && this.canGesture && this.state.seated
        ? this.lookTap.end(event.pointerId, event.clientX, event.clientY, performance.now()) : false;
      if (kind === 'look' && event.type !== 'pointerup') this.lookTap.cancel();
      this.input.end(event.pointerId);
      if (pad.hasPointerCapture(event.pointerId)) pad.releasePointerCapture(event.pointerId);
      if (kind === 'move') this.stick.style.removeProperty('translate');
      delete pad.dataset.active;
      event.preventDefault(); event.stopPropagation();
      if (tapped) this.actions.tap?.(event.clientX, event.clientY);
    };
    pad.addEventListener('pointerup', end, opts); pad.addEventListener('pointercancel', end, opts); pad.addEventListener('lostpointercapture', end, opts);
    // Suppress the compatibility mouse sequence after a touch; the pad is not a button.
    pad.addEventListener('touchend', event => event.preventDefault(), { passive: false, signal: this.abort.signal });
    pad.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); }, opts);
    pad.addEventListener('contextmenu', event => event.preventDefault(), opts);
  }

  private syncViewport() {
    if (this.disposed) return;
    this.active = this.coarse.matches || (navigator.maxTouchPoints > 0 && innerWidth <= 1100);
    const viewport = window.visualViewport;
    // Browser chrome and the software keyboard can both change the visible viewport.
    this.app.style.setProperty('--game-vh', `${viewport?.height ?? innerHeight}px`);
    this.app.style.setProperty('--game-vw', `${viewport?.width ?? innerWidth}px`);
    this.app.style.setProperty('--game-vtop', `${viewport?.offsetTop ?? 0}px`);
    this.app.style.setProperty('--game-vleft', `${viewport?.offsetLeft ?? 0}px`);
    if (!this.state.typing) this.isPortrait = innerHeight > innerWidth;
    this.app.dataset.mobile = String(this.active);
    this.app.dataset.mobilePortrait = String(this.isPortrait);
    this.update(this.state);
  }

  private isStandalone() { return matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone; }
  private supportsFullscreen() { return !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function'; }
  private async expandDisplay() {
    this.clear(); this.actions.release();
    if (this.supportsFullscreen()) {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
          await document.documentElement.requestFullscreen();
          const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
          await orientation?.lock?.('landscape').catch(() => {});
        }
        this.syncViewport(); return;
      } catch { /* Some browsers advertise the API but reject the current context. */ }
    }
    const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.displayHelp.querySelector('#mobile-display-copy')!.textContent = apple
      ? 'On iPhone, Safari keeps its browser controls here. For a full screen table, open Safari’s Share menu, choose Add to Home Screen, turn on Open as Web App if it appears, then open Table for Two from your Home Screen.'
      : 'Your browser cannot enter full screen here. If your browser offers Install app or Add to Home Screen in its menu, you can use that to open the game in its own window.';
    this.helpOpen = true; this.displayHelp.hidden = false;
    this.update(this.state);
    this.displayHelp.querySelector<HTMLButtonElement>('button')!.focus({ preventScroll: true });
  }
  private closeDisplayHelp() {
    this.helpOpen = false; this.displayHelp.hidden = true; this.clear(); this.update(this.state);
    if (this.displayReturnFocus?.checkVisibility({ checkVisibilityCSS: true })) this.displayReturnFocus.focus({ preventScroll: true });
  }

  dispose() {
    this.disposed = true; this.clear(); this.abort.abort();
    this.buttonGestures.clear();
    this.controls.remove(); this.rotate.remove(); this.displayButton.remove(); this.settingsDisplayButton.remove(); this.displayHelp.remove(); this.closeTalkButton.remove();
    delete this.app.dataset.mobile; delete this.app.dataset.mobilePortrait; delete this.app.dataset.mobilePlaying; delete this.app.dataset.mobileTyping; delete this.app.dataset.mobileSeated;
    for (const property of ['--game-vh', '--game-vw', '--game-vtop', '--game-vleft']) this.app.style.removeProperty(property);
  }
}
