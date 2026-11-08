export type GameMenuScope = {
  key: string;
  element: HTMLElement;
  items?: string;
  initial?: string;
  horizontal?: boolean;
  select?(item: HTMLElement): void;
  confirm?(item: HTMLElement): boolean;
};

const focusable = 'button, input, select, textarea, summary, [tabindex="0"]';
const available = (element: HTMLElement) => !element.matches(':disabled, [aria-disabled="true"]') && element.checkVisibility({ checkVisibilityCSS: true });

/** One focused game menu at a time, without replacing native field controls. */
export class GameMenuNavigation {
  private currentKey = '';
  private previousFocus: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement, private readonly getScope: () => GameMenuScope | null, private readonly onMenuEntry?: () => void) {}

  refresh(fallbackMode: string) {
    const scope = this.getScope();
    const key = scope?.key ?? fallbackMode;
    this.root.dataset.inputMode = key;
    const changed = key !== this.currentKey;
    const wasMenu = this.currentKey !== '' && !['gameplay', 'typing'].includes(this.currentKey);
    this.currentKey = key;
    if (scope) {
      const active = document.activeElement;
      const focusedControl = active instanceof HTMLElement && scope.element.contains(active) && active.matches(focusable) && available(active);
      if (!changed && focusedControl) return;
      if (changed) this.onMenuEntry?.();
      if (active instanceof HTMLElement && !scope.element.contains(active)) this.previousFocus = active;
      const target = scope.initial ? scope.element.querySelector<HTMLElement>(scope.initial) : null;
      const first = this.items(scope)[0];
      (target && available(target) ? target : first)?.focus({ preventScroll: true });
    } else if (changed && wasMenu) {
      // Opening Talk has already focused its field; restoring an old menu button would undo it.
      if (fallbackMode !== 'typing' && this.previousFocus && available(this.previousFocus)) this.previousFocus.focus({ preventScroll: true });
      this.previousFocus = null;
    }
  }

  focusInitial() {
    const scope = this.getScope();
    if (!scope) return;
    const target = scope.initial ? scope.element.querySelector<HTMLElement>(scope.initial) : this.items(scope)[0];
    if (target && available(target)) target.focus({ preventScroll: true });
  }

  handle(event: KeyboardEvent): boolean {
    const scope = this.getScope();
    if (!scope || event.altKey || event.ctrlKey || event.metaKey) return false;
    const active = document.activeElement as HTMLElement | null;
    // Text editing and native select/range behavior keep their usual keys.
    const text = active?.matches('textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"])');
    if (text && event.key !== 'Tab') return false;
    if (active?.matches('select') && event.key !== 'Tab') return false;
    if (active?.matches('input[type="range"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;

    if (event.key === 'Tab') {
      const items = Array.from(scope.element.querySelectorAll<HTMLElement>(focusable)).filter(available);
      if (!items.length) return false;
      const index = active ? items.indexOf(active) : -1;
      if (index === -1 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0].focus({ preventScroll: true });
        return true;
      }
      return false;
    }

    const direction = event.key === 'ArrowUp' || (scope.horizontal && event.key === 'ArrowLeft') ? -1
      : event.key === 'ArrowDown' || (scope.horizontal && event.key === 'ArrowRight') ? 1 : 0;
    if (direction) {
      const items = this.items(scope);
      if (!items.length) return false;
      event.preventDefault();
      const index = active ? items.indexOf(active) : -1;
      const next = items[index < 0 ? (direction > 0 ? 0 : items.length - 1) : (index + direction + items.length) % items.length];
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
      scope.select?.(next);
      return true;
    }

    if (event.key === 'Enter') {
      const items = this.items(scope);
      const target = active && scope.element.contains(active) ? active : items[0];
      if (!target || !available(target) || target.matches('input[type="range"]')) return false;
      event.preventDefault();
      if (event.repeat) return true;
      if (!scope.confirm?.(target)) target.click();
      return true;
    }
    return false;
  }

  private items(scope: GameMenuScope) {
    return Array.from(scope.element.querySelectorAll<HTMLElement>(scope.items ?? focusable)).filter(available);
  }
}
