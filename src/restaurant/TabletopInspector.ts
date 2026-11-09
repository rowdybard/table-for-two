import type { DinnerCommand, DinnerState } from './types';
import { TouchButtonGesture } from './TouchButtonGesture';
import { tableActionForTarget, tabletopActionAvailability } from './tabletop';
import './tabletop.css';

export const INSPECTION_TARGETS = [
  'menu', 'glass', 'carafe', 'bread', 'salt', 'pepper', 'cutlery', 'lamp',
  'vase', 'plate', 'meal', 'napkin', 'dessert', 'ticket', 'bill', 'service-bell',
] as const;

export type InspectionTarget = typeof INSPECTION_TARGETS[number];
export interface InspectableInteraction { target: InspectionTarget; label: string }

export function isInspectionTarget(target: string): target is InspectionTarget {
  return (INSPECTION_TARGETS as readonly string[]).includes(target);
}

const OBJECT_NAMES: Record<InspectionTarget, string> = {
  menu: 'Menu', glass: 'Water glass', carafe: 'Water carafe', bread: 'Bread basket',
  salt: 'Salt', pepper: 'Pepper', cutlery: 'Cutlery', lamp: 'Table lamp', vase: 'Flowers',
  plate: 'Dinner plate', meal: 'Dinner', napkin: 'Napkin', dessert: 'Dessert',
  ticket: 'Order ticket', bill: 'Bill', 'service-bell': 'Service bell',
};

const DEFAULT_VERBS: Record<InspectionTarget, string> = {
  menu: 'Read menu', glass: 'Take a sip', carafe: 'Pour water', bread: 'Take some bread',
  salt: 'Add salt', pepper: 'Add pepper', cutlery: 'Arrange cutlery', lamp: 'Adjust light',
  vase: 'Turn vase', plate: 'Turn plate', meal: 'Take a bite', napkin: 'Fold napkin',
  dessert: 'Take a spoonful', ticket: 'Check order', bill: 'Read the check', 'service-bell': 'Call waiter',
};

interface InspectorCallbacks {
  inspect(target: InspectionTarget | null): void;
  use(target: InspectionTarget): void | Promise<void>;
  command(command: DinnerCommand): void | Promise<void>;
  releasePointer(): void;
  changed(): void;
}

/** Controls for leaning over a real table prop; the scene remains the inspection view. */
export class TabletopInspector {
  private readonly panel: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly heading: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly fold: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly lifecycle = new AbortController();
  private readonly touchGesture = new TouchButtonGesture();
  private compatibilityTouch: number | null = null;
  private aimed: InspectableInteraction | null = null;
  private inspected: InspectionTarget | null = null;
  private state: DinnerState | null = null;
  private session = '';
  private pending = false;
  private actionError: string | null = null;
  private actionSequence = 0;

  constructor(private readonly parent: HTMLElement, private readonly callbacks: InspectorCallbacks) {
    this.trigger = document.createElement('button');
    this.trigger.id = 'inspect-table-object';
    this.trigger.type = 'button';
    this.trigger.hidden = true;
    this.trigger.setAttribute('aria-controls', 'tabletop-inspector');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5.5 5.5"/><path d="M7 10h6m-3-3v6"/></svg><kbd>R</kbd>';

    this.panel = document.createElement('section');
    this.panel.id = 'tabletop-inspector';
    this.panel.dataset.gameMenu = '';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-labelledby', 'tabletop-object-name');
    this.panel.hidden = true;
    this.panel.innerHTML = '<h2 id="tabletop-object-name"></h2><div class="tabletop-inspector-actions"><button type="button" id="tabletop-use"></button><button type="button" id="tabletop-fold" hidden></button><button type="button" id="tabletop-back"><span aria-hidden="true">↩</span> Back</button></div><p id="tabletop-inspector-status" role="status" hidden></p>';
    this.heading = this.panel.querySelector('#tabletop-object-name')!;
    this.primary = this.panel.querySelector('#tabletop-use')!;
    this.primary.setAttribute('aria-keyshortcuts', 'E');
    this.fold = this.panel.querySelector('#tabletop-fold')!;
    this.status = this.panel.querySelector('#tabletop-inspector-status')!;
    parent.append(this.trigger, this.panel);

    // Touch-up may reveal another game menu before its compatibility click arrives.
    // Consume that same pointer's click even if it lands on a newly exposed button.
    parent.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') this.compatibilityTouch = null;
    }, { capture: true, signal: this.lifecycle.signal });
    parent.addEventListener('click', event => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType !== 'touch' || pointer.pointerId !== this.compatibilityTouch || !this.touchGesture.ignoreClick(event.detail, pointer.pointerType, pointer.pointerId, performance.now())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, signal: this.lifecycle.signal });

    this.bindButton(this.trigger, () => { if (this.aimed) this.open(this.aimed.target); });
    this.bindButton(this.primary, () => {
      const target = this.inspected;
      if (target) void this.perform(() => this.callbacks.use(target));
    });
    this.bindButton(this.fold, () => void this.perform(() => this.callbacks.command({ type: 'tabletop', action: 'fold-napkin' })));
    this.bindButton(this.panel.querySelector('#tabletop-back')!, () => this.close());
    this.panel.addEventListener('keydown', event => {
      if ((event.code === 'KeyE' || event.key.toLowerCase() === 'e') && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && !this.primary.disabled) this.primary.click();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }, { signal: this.lifecycle.signal });
    window.addEventListener('blur', () => this.touchGesture.cancel(undefined, performance.now()), { signal: this.lifecycle.signal });
  }

  get isOpen() { return this.inspected !== null; }
  get target() { return this.inspected; }

  update(state: DinnerState, target: InspectableInteraction | null) {
    const nextSession = `${state.id}/${state.mode}/${state.dateId}`;
    const replaced = this.session !== '' && this.session !== nextSession;
    this.session = nextSession;
    this.state = state;
    this.aimed = this.eligible && target && isInspectionTarget(target.target) ? { ...target } : null;
    if (replaced || !this.eligible) this.close();
    if (this.inspected && this.aimed?.target === this.inspected) this.primary.textContent = this.aimed.label;
    this.refresh();
  }

  open(target: InspectionTarget) {
    if (!this.eligible || !isInspectionTarget(target) || this.inspected === target) return;
    this.callbacks.releasePointer();
    this.inspected = target;
    this.actionSequence++;
    this.pending = false;
    this.panel.dataset.target = target;
    this.heading.textContent = OBJECT_NAMES[target];
    this.primary.textContent = this.aimed?.target === target ? this.aimed.label : DEFAULT_VERBS[target];
    this.actionError = null;
    this.status.hidden = true;
    this.status.textContent = '';
    this.refresh();
    this.callbacks.inspect(target);
    this.callbacks.changed();
    this.panel.querySelector<HTMLButtonElement>('button:not([disabled]):not([hidden])')?.focus({ preventScroll: true });
  }

  close() {
    if (!this.inspected) return;
    const restoreFocus = this.panel.contains(document.activeElement);
    this.inspected = null;
    this.actionSequence++;
    this.pending = false;
    this.actionError = null;
    delete this.panel.dataset.target;
    this.refresh();
    this.callbacks.inspect(null);
    this.callbacks.changed();
    if (restoreFocus && !this.trigger.hidden) this.trigger.focus({ preventScroll: true });
  }

  dispose() {
    this.close();
    this.lifecycle.abort();
    this.trigger.remove();
    this.panel.remove();
    delete this.parent.dataset.tableInspection;
  }

  private get eligible() { return this.state?.phase === 'playing' && this.state.seated && this.state.stage !== 'finished'; }

  private refresh() {
    this.panel.hidden = !this.inspected;
    this.trigger.hidden = !this.eligible || !this.aimed || !!this.inspected;
    this.trigger.setAttribute('aria-expanded', String(this.isOpen));
    if (this.aimed) this.trigger.setAttribute('aria-label', `Inspect ${OBJECT_NAMES[this.aimed.target].toLowerCase()}`);
    this.parent.dataset.tableInspection = String(this.isOpen);
    const action = this.inspected ? tableActionForTarget(this.inspected) : null;
    // During a spill the napkin wipes and the glass is set upright; otherwise both are ordinary table actions.
    const spill = this.state?.evening.incident?.event === 'spilled-drink';
    const usesTableAction = action && !((this.inspected === 'napkin' || this.inspected === 'glass') && spill);
    const primary = usesTableAction && this.state ? tabletopActionAvailability(this.state, action) : null;
    if (primary) this.primary.textContent = primary.label;
    this.primary.disabled = this.pending || !!primary && !primary.enabled;
    const fold = this.state ? tabletopActionAvailability(this.state, 'fold-napkin') : null;
    this.fold.disabled = this.pending || !fold?.enabled;
    this.fold.hidden = this.inspected !== 'napkin' || !spill;
    this.fold.textContent = fold?.label ?? 'Fold napkin';
    const unavailable = primary?.reason ?? null;
    const message = this.pending ? null : this.actionError ?? unavailable;
    this.status.textContent = message ?? '';
    this.status.hidden = !message;
    this.panel.setAttribute('aria-busy', String(this.pending));
  }

  private async perform(action: () => void | Promise<void>) {
    if (this.pending || !this.inspected || !this.eligible) return;
    const sequence = ++this.actionSequence;
    this.pending = true;
    this.actionError = null;
    this.refresh();
    try {
      await action();
    } catch {
      if (sequence !== this.actionSequence) return;
      this.actionError = 'That action didn’t go through. Try again.';
    } finally {
      if (sequence === this.actionSequence) { this.pending = false; this.refresh(); }
    }
  }

  private bindButton(button: HTMLButtonElement, activate: () => void) {
    const gesture = this.touchGesture;
    const options = { signal: this.lifecycle.signal };
    button.addEventListener('pointerdown', event => {
      event.stopPropagation();
      if (event.pointerType !== 'touch' || button.disabled) return;
      event.preventDefault();
      if (gesture.begin(event.pointerId, event.clientX, event.clientY)) button.setPointerCapture(event.pointerId);
    }, options);
    button.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') gesture.move(event.pointerId, event.clientX, event.clientY);
    }, options);
    button.addEventListener('pointerup', event => {
      if (event.pointerType !== 'touch') return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = button.getBoundingClientRect();
      const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      const tapped = gesture.end(event.pointerId, event.clientX, event.clientY, inside, performance.now());
      this.compatibilityTouch = event.pointerId;
      if (tapped && !button.disabled) activate();
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    }, options);
    button.addEventListener('pointercancel', event => gesture.cancel(event.pointerId, performance.now()), options);
    button.addEventListener('lostpointercapture', event => gesture.cancel(event.pointerId, performance.now()), options);
    button.addEventListener('click', event => {
      event.stopPropagation();
      const pointer = event as PointerEvent;
      const capabilities = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities;
      if (gesture.ignoreClick(event.detail, pointer.pointerType, pointer.pointerId, performance.now(), capabilities?.firesTouchEvents)) return;
      if (!button.disabled) activate();
    }, options);
  }
}
