import type { Emotion } from './types';

export type ListeningPreviewTarget = 'date' | 'd1' | 'd2' | null;
export type ListeningCue = 'attentive' | 'reassuring' | 'guarded';
export interface ListeningPreview {
  readonly target: Exclude<ListeningPreviewTarget, null>;
  readonly cue: ListeningCue;
  readonly emotion: 'neutral' | 'warm' | 'defensive';
  readonly expiresAt: number;
}

const expiryMs = 2600;
const settleMs: Record<ListeningCue, number> = { attentive: 0, reassuring: 180, guarded: 360 };
const emotion: Record<ListeningCue, ListeningPreview['emotion']> = { attentive: 'neutral', reassuring: 'warm', guarded: 'defensive' };

function impression(text: string): ListeningCue {
  const words = text.slice(0, 2000).toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
  const said = words.replace(/^(?:(?:um|uh|well|so|okay)[, ]+)+/, '');
  // A fragment is evidence for attention, never a reason to invent a personal judgment.
  if (said.split(' ').length < 2) return 'attentive';
  const quotation = /["“”]|(?:^|\s)'[^']+'/.test(said);
  const repaired = /\b(?:kidding|joking|i mean|i meant|don't mean|didn't mean|he said|she said|they said|someone said|is what|that's what)\b/.test(said);
  if (!quotation && !repaired) {
    if (!/\bsorry\b/.test(said) && (/^you(?:'re| are) (?:really |so |just )?(?:stupid|pathetic|worthless|an idiot)\b/.test(said)
      || /^shut up(?: (?:now|already|please|for once))?[.!?]*$/.test(said))) return 'guarded';
    if (!/\b(?:stupid|pathetic|worthless|idiot)\b/.test(said)
      && !/\b(?:actually|no)[, ]+(?:i(?:'m| am) )?not\b/.test(said)
      && /^i(?:'m| am) (?:(?:a little|kind of|really|so|quite) )?(?:nervous|anxious|awkward|sorry)\b/.test(said)) return 'reassuring';
  }
  return 'attentive';
}

/** Ephemeral, local expression cues. No network, dialogue, transcript storage or memory writes. */
export class ListeningPreviewController {
  private target: ListeningPreviewTarget = null;
  private active = false;
  private updatedAt = 0;
  private current: ListeningCue = 'attentive';
  private candidate: ListeningCue = 'attentive';
  private candidateAt = 0;

  start(now: number, target: ListeningPreviewTarget = 'date') {
    this.clear();
    if (!Number.isFinite(now)) return;
    this.active = true;
    this.target = target;
    this.updatedAt = this.candidateAt = now;
  }

  partial(text: string, now: number) {
    if (!this.active || !Number.isFinite(now) || now < this.updatedAt) return;
    this.updatedAt = now;
    const next = impression(text);
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateAt = now;
      // Retract an abandoned impression immediately; a replacement settles on its own evidence.
      this.current = 'attentive';
    }
    if (next === 'attentive') this.current = 'attentive';
  }

  sample(now: number): ListeningPreview | null {
    if (!this.active || !Number.isFinite(now) || now < this.updatedAt) return null;
    if (now - this.updatedAt >= expiryMs) { this.clear(); return null; }
    if (!this.target) return null;
    if (now - this.candidateAt >= settleMs[this.candidate]) this.current = this.candidate;
    return { target: this.target, cue: this.current, emotion: emotion[this.current], expiresAt: this.updatedAt + expiryMs };
  }

  clear() {
    this.target = null;
    this.active = false;
    this.updatedAt = this.candidateAt = 0;
    this.current = this.candidate = 'attentive';
  }
}

/** Authored expressions and consequential feelings take priority over a transient listening cue. */
export function calmEnoughForListening(current: Emotion): boolean {
  return current === 'neutral' || current === 'warm';
}
