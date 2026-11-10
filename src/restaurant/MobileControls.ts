import './mobile.css';
import { TouchButtonGesture } from './TouchButtonGesture';

export type MobileControlsActions = {
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
  micEnabled: boolean;
  micAvailable?: boolean;
  interactionLabel: string | null;
};
const emptyState: MobileControlsState = { joined: false, playing: false, blocked: false, modal: false, typing: false, seated: false, micEnabled: false, interactionLabel: null };

/** Native-sized conversation controls in either phone orientation. */
export class MobileControls {
  private readonly abort = new AbortController();
  private readonly buttonGestures = new Set<TouchButtonGesture>();
  private readonly coarse = matchMedia('(pointer: coarse)');
  private readonly controls: HTMLElement;
  private readonly micButton: HTMLButtonElement;
  private readonly displayButton: HTMLButtonElement;
  private readonly settingsDisplayButton: HTMLButtonElement;
  private readonly displayHelp: HTMLElement;
  private readonly closeTalkButton: HTMLButtonElement;
  private state = emptyState;
  private active = false;
  private isPortrait = false;
  private helpOpen = false;
  private disposed = false;
  private signature = '';
  private displayReturnFocus: HTMLElement | null = null;

  constructor(private readonly app: HTMLElement, private readonly actions: MobileControlsActions) {
    this.controls = document.createElement('div');
    this.controls.id = 'mobile-controls';
    this.controls.hidden = true;
    this.controls.innerHTML = `<nav class="mobile-toolbar" aria-label="Dinner controls"><button id="mobile-talk" type="button">Talk</button><button id="mobile-mic" type="button" aria-label="Turn microphone on" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" fill="none" stroke="currentColor" stroke-width="2"/><path class="mobile-mic-slash" d="m4 20 16-16" stroke="currentColor" stroke-width="2"/></svg><span class="sr-only">Microphone</span></button><button id="mobile-pause" type="button" aria-label="Pause dinner">Pause</button></nav>`;
    this.micButton = this.controls.querySelector('#mobile-mic')!;
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
    app.append(this.controls, this.displayButton, this.displayHelp);

    const click = (id: string, callback: () => void) => this.bindAction(this.controls.querySelector<HTMLButtonElement>('#' + id)!, callback);
    click('mobile-talk', () => this.actions.talk());
    click('mobile-mic', () => this.actions.mic());
    click('mobile-pause', () => this.actions.pause());
    for (const button of [this.displayButton, this.settingsDisplayButton]) button.addEventListener('click', () => { this.displayReturnFocus = button; void this.expandDisplay(); }, { signal: this.abort.signal });
    this.displayHelp.querySelector('button')!.addEventListener('click', () => this.closeDisplayHelp(), { signal: this.abort.signal });
    this.displayHelp.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeDisplayHelp(); } }, { signal: this.abort.signal });
    const suspend = () => this.clear();
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
  get movement() { return { horizontal: 0, forward: 0 }; }
  get menuScope() { return this.helpOpen ? this.displayHelp : null; }

  update(state: MobileControlsState) {
    if (this.disposed) return;
    if (this.state.typing && !state.typing) this.isPortrait = innerHeight > innerWidth;
    this.state = state;
    const signature = [this.active, this.isPortrait, this.helpOpen, document.hidden, !!document.fullscreenElement, this.isStandalone(), this.supportsFullscreen(), ...Object.values(state)].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    const enabled = this.active && state.joined && state.playing && !state.modal && !state.typing && !this.helpOpen;
    this.controls.hidden = !enabled || document.hidden;
    this.micButton.setAttribute('aria-pressed', String(state.micEnabled));
    this.micButton.disabled = state.micAvailable === false;
    this.micButton.setAttribute('aria-label', state.micEnabled ? 'Turn microphone off' : 'Turn microphone on');
    this.displayButton.hidden = !this.active || state.joined || state.modal || this.helpOpen || this.isStandalone();
    this.displayButton.textContent = this.supportsFullscreen() ? (document.fullscreenElement ? 'Exit full screen' : 'Full screen') : 'Home screen';
    this.settingsDisplayButton.hidden = !this.active || this.isStandalone();
    this.settingsDisplayButton.textContent = this.supportsFullscreen() ? (document.fullscreenElement ? 'Exit full screen' : 'Enter full screen') : 'Play from your Home Screen';
    this.app.dataset.mobileTyping = String(this.active && state.typing);
    this.app.dataset.mobilePlaying = String(this.active && state.joined && state.playing);
    this.app.dataset.mobileSeated = String(this.active && state.seated);
  }

  clear() {
    for (const gesture of this.buttonGestures) gesture.cancel(undefined, performance.now());
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
    this.controls.remove(); this.displayButton.remove(); this.settingsDisplayButton.remove(); this.displayHelp.remove(); this.closeTalkButton.remove();
    delete this.app.dataset.mobile; delete this.app.dataset.mobilePortrait; delete this.app.dataset.mobilePlaying; delete this.app.dataset.mobileTyping; delete this.app.dataset.mobileSeated;
    for (const property of ['--game-vh', '--game-vw', '--game-vtop', '--game-vleft']) this.app.style.removeProperty(property);
  }
}
