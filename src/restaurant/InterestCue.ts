import type { DinnerState } from './types';

/** A word for the read-out, for screen readers and the tooltip. Never shown as a label on the playfield. */
export function interestWord(level: number): string {
  return level < 18 ? 'drifting' : level < 38 ? 'polite' : level < 58 ? 'interested' : level < 78 ? 'into it' : 'smitten';
}

/**
 * One small heart in the corner that fills as the date warms to the evening and drains when it cools.
 * It pulses once when interest rises and dims once when it falls. No numbers, no bar, no label on screen:
 * the date's body is the main read, this is the quiet confirmation. Optional in Settings.
 */
export class InterestCue {
  readonly root: HTMLDivElement;
  private readonly fill: SVGRectElement;
  private lastChange = -1;
  private shown = -1;

  constructor(host: HTMLElement) {
    const root = this.root = document.createElement('div');
    root.id = 'interest-cue'; root.className = 'interest-cue'; root.hidden = true; root.setAttribute('role', 'img');
    root.innerHTML = '<svg viewBox="0 0 24 22" aria-hidden="true"><defs><clipPath id="interest-cue-clip"><rect x="0" y="22" width="24" height="0"/></clipPath></defs>'
      + '<path class="interest-cue-shell" d="M12 20.4 3.6 12.2A5.1 5.1 0 0 1 12 5.3a5.1 5.1 0 0 1 8.4 6.9Z"/>'
      + '<path class="interest-cue-fill" clip-path="url(#interest-cue-clip)" d="M12 20.4 3.6 12.2A5.1 5.1 0 0 1 12 5.3a5.1 5.1 0 0 1 8.4 6.9Z"/></svg>';
    this.fill = root.querySelector('rect')!;
    host.append(root);
  }

  update(state: DinnerState, enabled: boolean) {
    const evening = state.doubleDate?.role === 'wingman' ? undefined : state.evening;
    const interest = evening?.interest;
    const visible = enabled && !!interest && state.phase === 'playing' && !evening?.farewell.ending;
    this.root.hidden = !visible;
    if (!visible || !interest) return;
    const level = Math.max(0, Math.min(100, interest.level));
    if (level !== this.shown) {
      // The heart's body spans y 5..20.4; a sliver stays visible even at zero so the shape reads.
      const height = 1 + (level / 100) * 15.4;
      this.fill.setAttribute('y', String(20.4 - height + .4)); this.fill.setAttribute('height', String(height));
      this.root.style.setProperty('--interest', String(level / 100));
      this.shown = level;
      const name = state.participants.find(participant => participant.kind === 'ai')?.name ?? 'Your date';
      const word = interestWord(level);
      this.root.setAttribute('aria-label', `${name} seems ${word}`); this.root.title = `${name} seems ${word}`;
    }
    if (interest.changedAt !== this.lastChange) {
      const first = this.lastChange < 0; this.lastChange = interest.changedAt;
      if (!first && interest.trend) {
        this.root.classList.remove('rising', 'falling'); void this.root.offsetWidth;
        this.root.classList.add(interest.trend > 0 ? 'rising' : 'falling');
      }
    }
  }
}
