import { UI_THEME, canvasFont } from './theme';
import './experience.css';
import { getDate } from './content';
import type { DinnerState, EveningMoment } from './types';

type Actions = { releasePointer(): void; modalChanged(): void; notice(message: string): void };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Conversation history and the evening the player actually had. No service director. */
export class EveningInterface {
  private state?: DinnerState;
  private momentsKey = '';
  private keptEndingSignature = '';
  constructor(private readonly actions: Actions) {
    for (const tab of ['chat', 'moments']) el('journal-' + tab).addEventListener('click', () => {
      el('conversation-log').hidden = tab !== 'chat'; el('moments-log').hidden = tab !== 'moments';
      el('journal-chat').classList.toggle('selected', tab === 'chat'); el('journal-moments').classList.toggle('selected', tab === 'moments');
    });
    el('save-postcard').addEventListener('click', () => this.savePostcard());
    el('past-evenings').addEventListener('click', () => { this.renderHistory(); this.actions.releasePointer(); el('history-dialog').hidden = false; this.actions.modalChanged(); });
    el('history-close').addEventListener('click', () => this.closeDialogs());
    try { el('past-evenings').hidden = !JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]').length; } catch { /* Optional storage. */ }
  }
  get isDialogOpen() { return !el('history-dialog').hidden; }
  closeDialogs() { el('history-dialog').hidden = true; this.actions.modalChanged(); }
  dismissPrompt() { return false; }
  update(state: DinnerState) {
    this.state = state;
    el('agenda-clues').hidden = true;
    const key = JSON.stringify(state.evening.moments);
    if (key !== this.momentsKey) { this.momentsKey = key; this.renderMoments(el('moments-list'), state.evening.moments); }
  }
  renderEnding(state: DinnerState) {
    const ending = state.evening.farewell.ending;
    if (!ending) return;
    el('ending-title').textContent = ending.title; el('ending-copy').textContent = ending.description;
    el('ending-date-line').textContent = ending.dateLine ? `“${ending.dateLine}”` : '';
    el('ending-date-line').hidden = !ending.dateLine;
    this.renderMoments(el('ending-moments'), state.evening.moments.slice(-4));
    el('ending-agenda').hidden = true; el('ending-agenda-evidence').hidden = true;
    const sessionKey = JSON.stringify([state.id, state.doubleDate?.localHumanId ?? 'solo']);
    const signature = JSON.stringify([sessionKey, ending, state.evening.moments]);
    if (this.keptEndingSignature !== signature) {
      try {
        const previous = JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]') as Array<{ sessionKey?: string; at?: string }>;
        const existing = previous.find(entry => entry?.sessionKey === sessionKey);
        const saved = { sessionKey, dateId: state.dateId, at: existing?.at ?? new Date().toISOString(), ending, moments: state.evening.moments.slice(-6) };
        let replaced = false;
        const entries = previous.flatMap(entry => {
          if (entry?.sessionKey !== sessionKey) return [entry];
          if (replaced) return [];
          replaced = true; return [saved];
        });
        if (!replaced) entries.unshift(saved);
        localStorage.setItem('table-for-two-evenings', JSON.stringify(entries.slice(0, 12)));
        this.keptEndingSignature = signature;
      } catch { /* The current memento is available without persistent storage. */ }
    }
  }
  private renderMoments(container: HTMLElement, moments: EveningMoment[]) {
    container.replaceChildren();
    if (!moments.length) { const copy = document.createElement('p'); copy.className = 'postcard-notice'; copy.textContent = 'No moments yet.'; container.append(copy); }
    for (const moment of moments) { const entry = document.createElement('div'); entry.className = 'moment-entry'; const title = document.createElement('strong'); title.textContent = moment.title; const copy = document.createElement('p'); copy.textContent = moment.description; entry.append(title, copy); container.append(entry); }
  }
  private renderHistory() {
    const container = el('past-evenings-list'); container.replaceChildren();
    try {
      const evenings = JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]') as { dateId: string; at: string; ending: { title: string; description: string; dateLine: string }; moments: EveningMoment[] }[];
      for (const night of evenings.slice(0, 12)) {
        const date = getDate(night.dateId); if (!date || !night.ending || typeof night.ending.title !== 'string') continue;
        const item = document.createElement('details'); item.className = 'past-evening'; const summary = document.createElement('summary'); summary.textContent = `${date.name} · ${night.ending.title}`;
        const description = document.createElement('p'); description.textContent = night.ending.description; const quote = document.createElement('blockquote'); quote.textContent = night.ending.dateLine;
        item.append(summary, description, quote);
        container.append(item);
      }
    } catch { container.textContent = 'Your next evening can be the first one you keep.'; }
  }
  private async savePostcard() {
    const state = this.state, ending = state?.evening.farewell.ending; if (!state || !ending) return;
    await Promise.all([document.fonts.load('700 58px \"Barlow Condensed\"'), document.fonts.load('600 25px Inter'), document.fonts.load('400 17px Inter')]);
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1400; const context = canvas.getContext('2d')!;
    context.fillStyle = UI_THEME.paper; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = UI_THEME.signal; context.beginPath(); context.moveTo(0, 0); context.lineTo(400, 0); context.lineTo(370, 14); context.lineTo(0, 14); context.fill();
    context.fillStyle = UI_THEME.ink; context.font = canvasFont(22, 'display'); context.fillText('TABLE FOR TWO', 85, 105);
    context.font = canvasFont(58, 'display'); context.fillText(ending.title, 85, 205, 1000);
    context.font = canvasFont(24, 'body', 600); context.fillStyle = UI_THEME.muted; context.fillText(`An evening with ${getDate(state.dateId)!.name}`, 85, 258);
    const lines = (text: string, x: number, y: number, width: number, step: number, maxLines = 8) => {
      const wrapped: string[] = []; let line = '';
      for (const word of text.split(/\s+/)) {
        if (context.measureText((line ? line + ' ' : '') + word).width > width && line) { wrapped.push(line); line = ''; }
        line += (line ? ' ' : '') + word;
      }
      if (line) wrapped.push(line);
      const visible = wrapped.slice(0, maxLines);
      if (wrapped.length > maxLines) {
        let last = visible[visible.length - 1];
        while (last && context.measureText(last + '…').width > width) last = last.slice(0, -1);
        visible[visible.length - 1] = last.trimEnd() + '…';
      }
      for (const value of visible) { context.fillText(value, x, y, width); y += step; }
      return y;
    };
    context.font = canvasFont(25, 'body', 600); let y = ending.dateLine ? lines(`“${ending.dateLine}”`, 85, 325, 1030, 36) + 25 : 325;
    for (const moment of state.evening.moments.slice(-3)) { context.fillStyle = UI_THEME.ink; context.font = canvasFont(22, 'display'); context.fillText(moment.title, 85, y, 710); y += 30; context.fillStyle = UI_THEME.muted; context.font = canvasFont(17); y = lines(moment.description, 85, y, 710, 25, 3) + 20; }
    const kept = document.createElement('canvas'); kept.width = canvas.width; kept.height = Math.max(900, Math.min(canvas.height, y + 70)); kept.getContext('2d')!.drawImage(canvas, 0, 0);
    const link = document.createElement('a'); link.download = `table-for-two-${state.dateId}.png`; link.href = kept.toDataURL('image/png'); link.click();
    this.actions.notice('Your evening’s memento is ready to keep.');
  }
}
