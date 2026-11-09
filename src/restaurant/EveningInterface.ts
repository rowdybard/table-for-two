import { UI_THEME, canvasFont } from './theme';
import './experience.css';
import { DESSERTS } from './evening';
import { getDate, RESTAURANT } from './content';
import { buildDinnerBill, scenarioCareSnapshot, scenarioResumeAvailability } from './scenario-care';
import type { DateAgendaProgress } from './agenda-types';
import type { DinnerCommand, DinnerState, EveningAction, EveningMoment, InteractionTarget } from './types';

type Actions = { command(command: DinnerCommand): Promise<void>; scenario?(choice: string): Promise<void> | void; viewEnding?(): Promise<void> | void; openMenu?(): Promise<void> | void; releasePointer(): void; modalChanged(): void; notice(message: string): void };
type Chip = { label: string; action?: EveningAction; choice?: string; scenario?: string; disabled?: boolean; id?: string; run?: () => void };
type Prompt = { copy: string; chips: Chip[]; farewell?: boolean };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dialogIds = ['bill-dialog', 'history-dialog'];

/**
 * One compact prompt line for the evening’s real choices, the receipt on demand, and the
 * night’s factual notebook. Eli and the date carry the pacing; nothing here makes a model call.
 */
export class EveningInterface {
  private state?: DinnerState;
  private promptKey = '';
  private momentsKey = '';
  private cluesKey = '';
  private keptEndingSignature = '';
  private shownScenario = '';
  private sessionKey = '';
  private billKey = '';
  private toastOpen = false;
  private chips: Chip[] = [];
  private farewellShowing = false;
  private readonly billTotal: HTMLElement;
  constructor(private readonly actions: Actions) {
    this.billTotal = document.getElementById('bill-total') ?? document.createElement('p');
    this.billTotal.id = 'bill-total';
    if (!this.billTotal.isConnected) el('bill-items').insertAdjacentElement('afterend', this.billTotal);
    el('bill-close').addEventListener('click', () => this.closeDialogs());
    document.querySelectorAll<HTMLButtonElement>('[data-settlement]').forEach(button => button.addEventListener('click', async () => { this.closeDialogs(); await actions.command({ type: 'evening', action: 'settle-bill', choice: button.dataset.settlement }); }));
    for (const tab of ['chat', 'moments']) el('journal-' + tab).addEventListener('click', () => {
      el('conversation-log').hidden = tab !== 'chat'; el('moments-log').hidden = tab !== 'moments';
      el('journal-chat').classList.toggle('selected', tab === 'chat'); el('journal-moments').classList.toggle('selected', tab === 'moments');
    });
    el('save-postcard').addEventListener('click', () => this.savePostcard());
    el('past-evenings').addEventListener('click', () => { this.renderHistory(); this.open('history-dialog'); });
    el('history-close').addEventListener('click', () => this.closeDialogs());
    try { el('past-evenings').hidden = !JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]').length; } catch {}
  }
  get isDialogOpen() { return dialogIds.some(id => !el(id).hidden); }
  /** The goodbye chips are showing at the door, so the camera can hold the two-shot. */
  get farewellReady() { return this.farewellShowing; }
  get promptVisible() { return !el('prompt-line').hidden; }
  closeDialogs() { dialogIds.forEach(id => { el(id).hidden = true; }); this.actions.modalChanged(); }
  /** Escape steps back out of a sub-choice before it pauses the evening. */
  dismissPrompt() { if (!this.toastOpen) return false; this.toastOpen = false; this.refreshPrompt(); return true; }
  private open(id: string) { this.actions.releasePointer(); this.closeDialogs(); el(id).hidden = false; this.actions.modalChanged(); }
  /** Press the numbered chip, as the 1–4 keys do. */
  chip(index: number) {
    const chip = this.chips[index - 1];
    if (!chip || chip.disabled || el('prompt-line').hidden) return false;
    this.activate(chip); return true;
  }
  private activate(chip: Chip) {
    if (chip.run) chip.run();
    else if (chip.scenario) void this.actions.scenario?.(chip.scenario);
    else if (chip.action) void this.perform({ type: 'evening', action: chip.action, ...(chip.choice ? { choice: chip.choice } : {}) });
  }
  private billFor(state: DinnerState) { return state.doubleDate?.role === 'wingman' ? state.doubleDate.otherView?.evening.bill : state.evening.bill; }
  openBill() {
    if (!this.state) return;
    const bill = this.billFor(this.state);
    if (!bill?.requested) return this.actions.notice('Eli brings the check once dessert is done.');
    if (!this.state.seated) return this.actions.notice('The check is on the table.');
    this.renderBill(this.state);
    this.open('bill-dialog');
  }
  private renderBill(state: DinnerState) {
    const friend = state.doubleDate?.members.find(member => member.id !== state.doubleDate?.localHumanId)?.name ?? 'Friend';
    const pairs = [{ view: state, human: 'You' }, ...(state.doubleDate?.otherView ? [{ view: state.doubleDate.otherView, human: friend }] : [])].map(pair => ({
      ...pair,
      date: getDate(pair.view.dateId)!.name,
      ledger: pair.view.evening.bill.items ? { items: pair.view.evening.bill.items, totalCents: pair.view.evening.bill.totalCents ?? pair.view.evening.bill.items.reduce((total, item) => total + item.chargedCents, 0) } : buildDinnerBill(pair.view),
    }));
    const settled = !!this.billFor(state)?.settlement;
    document.querySelectorAll<HTMLButtonElement>('[data-settlement]').forEach(button => { button.hidden = settled; });
    const key = JSON.stringify(pairs.map(pair => [pair.human, pair.date, pair.view.evening.bill.settlement, pair.ledger]));
    if (key === this.billKey) return;
    this.billKey = key;
    const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
    const rows: string[] = [];
    let due = 0;
    for (const pair of pairs) {
      const paid = !!pair.view.evening.bill.settlement;
      if (pairs.length > 1) rows.push(`${pair.human} and ${pair.date}${paid ? ' · Already settled' : ''}`);
      for (const item of pair.ledger.items) {
        const owner = item.owner === 'you' ? pair.human : pair.date;
        const quantity = item.quantity > 1 ? ` × ${item.quantity}` : '';
        const status = item.status === 'cancelled' ? 'Cancelled before cooking · ' : item.status === 'pending' ? 'In the kitchen · ' : item.status === 'boxed' ? 'Packed to take home · ' : item.status === 'shared' ? 'To share · ' : '';
        const charge = ['cancelled', 'pending'].includes(item.status) ? 'Not charged' : money(item.chargedCents);
        rows.push(`${status}${owner} · ${item.label}${quantity} · ${charge}`);
      }
      if (pairs.length > 1 || paid) rows.push(`${paid ? 'Paid' : 'Pair total'} · ${money(pair.ledger.totalCents)}`);
      if (!paid) due += pair.ledger.totalCents;
      if (pairs.length > 1) rows.push('');
    }
    el('bill-items').textContent = rows.join('\n').trim();
    this.billTotal.textContent = settled && pairs.length === 1 ? `Paid · ${money(pairs[0]!.ledger.totalCents)}` : `${pairs.length > 1 ? 'Amount due' : 'Total'} · ${money(due)}`;
  }
  private atDoor(state: DinnerState) {
    const human = state.participants[0].position;
    return !state.seated && Math.hypot(human[0] - RESTAURANT.entrance[0], human[2] - RESTAURANT.entrance[2]) <= RESTAURANT.entranceRadius;
  }
  handleTarget(target: InteractionTarget): boolean {
    const wingman = this.state?.doubleDate?.role === 'wingman';
    const double = this.state?.doubleDate;
    const remoteIncident = double?.incidentOwner && double.incidentOwner !== double.localHumanId;
    const evening = wingman || remoteIncident ? double?.otherView?.evening : this.state?.evening;
    if (target === 'napkin' && evening?.incident?.event === 'spilled-drink') { void this.actions.command({ type: 'evening', action: 'wipe' }); return true; }
    if (!wingman && target === 'glass' && evening?.incident?.event === 'spilled-drink') { void this.actions.command({ type: 'evening', action: 'steady-glass' }); return true; }
    if (wingman && ['meal', 'dessert'].includes(target)) { this.actions.notice('Your date is complete. You can stay and help your friend.'); return true; }
    if (target === 'meal' || target === 'dessert') {
      if (this.state) {
        const care = scenarioCareSnapshot(this.state.evening.scenarioCare);
        if (care.kitchen.held || care.presence !== 'at-table') this.actions.notice(care.presence === 'at-table' ? 'Dinner is held. Resume when you are ready.' : 'Give your date time to return.');
        else void this.perform({ type: 'evening', action: 'taste' });
      }
      return true;
    }
    if (target === 'ticket') { void this.actions.command({ type: 'evening', action: 'inspect-ticket' }); return true; }
    if (target === 'service-bell') {
      const incident = evening?.incident?.event;
      if (incident === 'disruptive-diner') void this.actions.command({ type: 'evening', action: 'ask-quiet' });
      else if (incident === 'wrong-order') void this.actions.command({ type: 'evening', action: 'return-order' });
      else if (evening?.care.water.status === 'none' || evening?.care.water.status === 'served' && evening.tabletop?.shared.carafeFill === 0 && evening.tabletop.glassFill < 4) void this.actions.command({ type: 'evening', action: 'request-water' });
      else this.actions.notice(evening?.care.water.status === 'requested' ? 'Water is on the way.' : 'The water has arrived.');
      return true;
    }
    if (target === 'bill') { this.openBill(); return true; }
    if (target === 'exit' && this.state?.evening.chapter === 'farewell' && this.state.evening.bill.settlement && !this.state.evening.farewell.ending) { if (!this.farewellShowing) this.actions.notice('Walk to the door together before saying goodnight.'); return true; }
    return false;
  }
  update(state: DinnerState) {
    const sessionKey = `${state.id}/${state.doubleDate?.localHumanId ?? 'solo'}/${state.dateId}`;
    if (this.sessionKey && this.sessionKey !== sessionKey) {
      this.shownScenario = ''; this.promptKey = ''; this.momentsKey = ''; this.cluesKey = ''; this.billKey = ''; this.toastOpen = false;
      this.closeDialogs();
    }
    this.sessionKey = sessionKey;
    this.state = state;
    if (state.phase !== 'playing' && !el('bill-dialog').hidden) { el('bill-dialog').hidden = true; this.actions.modalChanged(); }
    if (!el('bill-dialog').hidden) {
      if (!state.seated) { el('bill-dialog').hidden = true; this.actions.modalChanged(); }
      else this.renderBill(state);
    }
    const e = state.evening;
    const scenario = state.doubleDate?.scenario ?? e.scenario;
    this.refreshPrompt();
    const scenarioBeat = scenario ? `${scenario.id}:${scenario.beat}` : '';
    if (scenario?.phase === 'active' && scenarioBeat !== this.shownScenario && state.phase === 'playing') {
      this.shownScenario = scenarioBeat;
      this.actions.releasePointer();
    }
    if (scenario?.phase !== 'active') this.shownScenario = '';
    const moments = JSON.stringify(e.moments);
    if (moments !== this.momentsKey) { this.momentsKey = moments; this.renderMoments(el('moments-list'), e.moments); }
    const clues = e.agenda?.clues ?? [];
    const cluesKey = JSON.stringify([state.dateId, clues]);
    if (cluesKey !== this.cluesKey) {
      this.cluesKey = cluesKey;
      el('agenda-clues').hidden = !clues.length;
      el('agenda-clues-heading').textContent = `What ${getDate(state.dateId)!.name} said`;
      const container = el('agenda-clues-lines'); container.replaceChildren();
      for (const clue of clues) { const quote = document.createElement('blockquote'); quote.textContent = `“${clue}”`; container.append(quote); }
    }
  }
  private async perform(command: DinnerCommand) { await this.actions.command(command); }
  private refreshPrompt() {
    const state = this.state; if (!state) return;
    const prompt = this.buildPrompt(state);
    const key = JSON.stringify([prompt?.copy, prompt?.farewell, prompt?.chips.map(chip => [chip.label, chip.action, chip.choice, chip.scenario, chip.disabled, chip.id])]);
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.chips = prompt?.chips ?? [];
    this.farewellShowing = !!prompt?.farewell;
    const line = el('prompt-line');
    line.hidden = !prompt || (!prompt.copy && !prompt.chips.length);
    line.classList.toggle('prompt-farewell', !!prompt?.farewell);
    el('prompt-copy').textContent = prompt?.copy ?? '';
    el('prompt-copy').hidden = !prompt?.copy;
    const parent = el('prompt-chips'); parent.replaceChildren();
    prompt?.chips.forEach((chip, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.gameItem = ''; button.disabled = !!chip.disabled;
      if (chip.action) button.dataset.evening = chip.action;
      if (chip.choice) button.dataset.choice = chip.choice;
      if (chip.scenario) button.dataset.scenario = chip.scenario;
      if (chip.id) button.id = chip.id;
      const key = document.createElement('kbd'); key.textContent = String(index + 1);
      const label = document.createElement('span'); label.textContent = chip.label;
      button.append(key, label);
      button.addEventListener('click', () => this.activate(chip));
      parent.append(button);
    });
  }
  private buildPrompt(state: DinnerState): Prompt | null {
    if (state.phase !== 'playing') return null;
    const own = state.evening, double = state.doubleDate, wingman = double?.role === 'wingman';
    const e = wingman ? double?.otherView?.evening ?? own : own;
    const activeView = wingman ? double?.otherView ?? state : state;
    const scenario = double?.scenario ?? own.scenario;
    const care = scenarioCareSnapshot(e.scenarioCare);
    const courseHeld = care.kitchen.held || care.presence !== 'at-table';
    if (scenario?.phase === 'active') {
      const targetDate = double?.dates.find(date => date.humanId === double?.scenario?.target);
      const targetName = targetDate ? getDate(targetDate.dateId)?.name : undefined;
      const nameTarget = (text: string) => targetName ? text.replace(/\byour date\b/gi, targetName) : text;
      const targetView = double?.scenario?.target && double.scenario.target !== double.localHumanId ? double.otherView ?? state : state;
      const consequence = this.consequenceCopy(targetView);
      const presence = scenarioCareSnapshot(targetView.evening.scenarioCare).presence;
      const returning = scenario.beat === 'follow-through' && ['privacy-break', 'cleanup-break'].includes(presence);
      let copy = nameTarget(scenario.description) + (state.seated ? '' : ' Take your seat to respond.');
      if (consequence) copy += ` ${consequence}`;
      if (returning) copy = ['They’re returning shortly. Choose together when they are back.', consequence].filter(Boolean).join(' ');
      return { copy, chips: scenario.choices.map(choice => ({ label: nameTarget(choice.label), scenario: choice.id, disabled: !state.seated || returning })) };
    }
    if (e.stance === 'leaving' || e.farewell.ending) return null;
    if (wingman) {
      if (!state.seated) return { copy: 'Take your seat to keep your friend company.', chips: [] };
      if (!e.incident) {
        const chips: Chip[] = [];
        if (care.kitchen.held) { const resume = scenarioResumeAvailability({ ...activeView, seated: state.seated }); chips.push({ label: 'Resume your friend’s dinner', action: 'resume-dinner', disabled: !resume.enabled }); }
        if ((e.care.water.status === 'none' || e.care.water.status === 'served' && e.tabletop?.shared.carafeFill === 0 && e.tabletop.glassFill < 4) && !e.bill.requested) chips.push({ label: 'Water for the table', action: 'request-water' });
        if (care.presence === 'at-table' && double?.otherView?.order && !e.care.checkIn && !e.bill.requested) chips.push({ label: 'Check in with their date', action: 'check-in' });
        if (e.bill.requested) chips.push({ label: 'See the check', run: () => this.openBill() });
        chips.push({ label: 'Show my ending', id: 'view-own-ending', run: () => { void this.actions.viewEnding?.(); } });
        return { copy: this.consequenceCopy(activeView) || (e.care.water.status === 'requested' ? 'Water is on the way.' : 'Here for your friend.'), chips: chips.slice(0, 4) };
      }
    }
    if (!state.seated) {
      if (own.chapter === 'farewell' && own.bill.settlement && !wingman) {
        if (this.atDoor(state)) return { farewell: true, copy: 'One last thing, at the door.', chips: [
          { label: 'I’d like to see you again', action: 'farewell', choice: 'again' },
          { label: 'Let’s stay friends', action: 'farewell', choice: 'friendly' },
          { label: 'Thank you for tonight. Goodnight.', action: 'farewell', choice: 'goodbye' },
        ] };
        return { copy: 'Walk to the door together.', chips: [] };
      }
      return null;
    }
    if (e.incident?.event === 'wrong-order') {
      const checked = e.incident.progress > 0;
      return { copy: checked ? `The ticket says ${activeView.order ?? 'your order'}; the plate is ${e.main.servedDish ?? 'something else'}.` : 'That isn’t what you ordered.', chips: checked
        ? [{ label: 'Send it back', action: 'return-order' }, { label: 'Keep the surprise', action: 'keep-order' }]
        : [{ label: 'Check the ticket', action: 'inspect-ticket' }] };
    }
    if (e.incident?.event === 'spilled-drink') {
      const wiped = e.incident.progress >= 3;
      return { copy: wiped ? 'The table is dry again.' : 'Water everywhere.', chips: wiped ? [{ label: 'Set the glass upright', action: 'steady-glass' }] : [{ label: 'Wipe it up', action: 'wipe' }] };
    }
    if (e.incident?.event === 'disruptive-diner') return { copy: 'A loud phone call at the next table.', chips: [{ label: 'Ask Eli for a little quiet', action: 'ask-quiet' }, { label: 'Let it go', action: 'let-it-go' }] };
    if (courseHeld) {
      const resume = scenarioResumeAvailability(activeView);
      let copy = this.consequenceCopy(activeView);
      if (!resume.enabled && care.presence === 'at-table' && resume.reason) copy = [copy, resume.reason].filter(Boolean).join(' ');
      return { copy, chips: care.kitchen.held ? [{ label: 'Resume dinner', action: 'resume-dinner', disabled: !resume.enabled }] : [] };
    }
    if (own.chapter === 'farewell' && own.bill.settlement) return { copy: 'Dinner is settled. Walk to the door together.', chips: [] };
    if (e.bill.requested && !e.bill.settlement) return { copy: 'Eli left the check.', chips: [
      { label: 'Split it', action: 'settle-bill', choice: 'split' }, { label: 'My treat', action: 'settle-bill', choice: 'treat' },
      { label: 'Separate checks', action: 'settle-bill', choice: 'separate' }, { label: 'See the check', run: () => this.openBill() },
    ] };
    if (e.main.status === 'finished' && e.dessert.status === 'none') return { copy: 'Eli offers dessert to share.', chips: [
      ...DESSERTS.map(dessert => ({ label: dessert.name, action: 'order-dessert' as const, choice: dessert.id })),
      { label: 'Just the bill', action: 'skip-dessert' },
    ] };
    if (!state.order) return { copy: 'Look over the menu whenever you’re ready.', chips: [{ label: 'Open the menu', run: () => { void this.actions.openMenu?.(); } }] };
    if (this.toastOpen && !e.care.toast) return { copy: 'Raise your glass to…', chips: [['tonight', 'Tonight'], ['honesty', 'Honesty'], ['friends', 'Friends'], ['mischief', 'A little mischief']].map(([choice, label]) => ({ label: label!, action: 'toast' as const, choice, run: () => { this.toastOpen = false; void this.perform({ type: 'evening', action: 'toast', choice }); } })) };
    this.toastOpen = false;
    const gestures: Chip[] = [];
    if (e.stance === 'guarded' || e.stance === 'hurt') gestures.push({ label: 'Acknowledge the awkward moment', action: 'apologize' });
    if (e.main.status === 'served' && !e.care.tasteOffer) gestures.push({ label: 'Offer a taste', action: 'offer-taste' });
    if (!e.care.toast) gestures.push({ label: 'Make a toast', run: () => { this.toastOpen = true; this.refreshPrompt(); } });
    if (!e.care.checkIn && e.main.status !== 'none') gestures.push({ label: 'Check in', action: 'check-in' });
    return gestures.length ? { copy: '', chips: gestures.slice(0, 4) } : null;
  }
  private consequenceCopy(view: DinnerState) {
    const care = scenarioCareSnapshot(view.evening.scenarioCare);
    const name = getDate(view.dateId)!.name;
    const lines: string[] = [];
    if (care.presence === 'privacy-break') lines.push(`${name} is taking a private minute.`);
    else if (care.presence === 'cleanup-break') lines.push(`${name} is cleaning up away from the table.`);
    else if (care.presence === 'staff-care') lines.push(`Eli is helping ${name}.`);
    if (care.kitchen.held) lines.push(care.presence === 'at-table' ? 'Eli is keeping dinner on hold until you are ready.' : 'Dinner is held until they return.');
    if (care.table === 'quiet') lines.push('You are at the quieter table.');
    const boxed = care.extraOrder.items.filter(item => item.status === 'boxed').length;
    const cancelled = care.extraOrder.items.filter(item => item.status === 'cancelled').length;
    if (boxed) lines.push(`${boxed === 1 ? 'One extra dish is' : `${boxed} extra dishes are`} packed to take home.`);
    if (cancelled) lines.push(`${cancelled === 1 ? 'One dish was' : `${cancelled} dishes were`} cancelled before cooking.`);
    return lines.join(' ');
  }
  renderEnding(state: DinnerState) {
    const ending = state.evening.farewell.ending;
    if (!ending) return;
    el('ending-title').textContent = ending.title; el('ending-copy').textContent = ending.description;
    el('ending-date-line').textContent = `“${ending.dateLine}”`;
    this.renderMoments(el('ending-moments'), state.evening.moments.slice(-4));
    const agenda = state.evening.agenda;
    this.renderAgenda(el('ending-agenda'), agenda, getDate(state.dateId)!.name);
    const evidence = el('ending-agenda-evidence'); evidence.replaceChildren(); evidence.hidden = !agenda?.goal || !agenda.milestones.length;
    if (!evidence.hidden && agenda) {
      const heading = document.createElement('h3'); heading.textContent = 'What you showed'; evidence.append(heading);
      for (const milestone of agenda.milestones.slice(-2)) { const quote = document.createElement('p'); quote.textContent = `“${milestone.evidence}”`; evidence.append(quote); }
    }
    const sessionKey = JSON.stringify([state.id, state.doubleDate?.localHumanId ?? 'solo']);
    const signature = JSON.stringify([sessionKey, ending, state.evening.moments, agenda]);
    if (this.keptEndingSignature !== signature) {
      try {
        const previous = JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]') as Array<{ sessionKey?: string; at?: string }>;
        const existing = previous.find(entry => entry?.sessionKey === sessionKey);
        const saved = { sessionKey, dateId: state.dateId, at: existing?.at ?? new Date().toISOString(), ending, moments: state.evening.moments.slice(-6), ...(agenda?.goal ? { agenda } : {}) };
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
  private renderAgenda(container: HTMLElement, agenda: DateAgendaProgress | undefined, name: string) {
    container.hidden = !agenda?.goal;
    if (!agenda?.goal) return;
    const heading = container.querySelector<HTMLElement>('h3') ?? document.createElement('h3');
    heading.textContent = `What ${name} wanted`;
    const goal = container.querySelector<HTMLElement>('#ending-agenda-goal') ?? document.createElement('p'); goal.textContent = agenda.goal;
    const score = container.querySelector<HTMLElement>('#ending-agenda-score') ?? document.createElement('p'); score.className = 'agenda-understanding'; score.textContent = `Understanding · ${agenda.score} / ${agenda.possible}`;
    const reflection = container.querySelector<HTMLElement>('#ending-agenda-reflection') ?? document.createElement('p'); reflection.textContent = agenda.reflection ?? '';
    // Reuse the ending nodes so keyboard focus and open memories stay put on polling updates.
    if (!heading.parentElement) container.append(heading);
    if (!goal.parentElement) container.append(goal);
    if (!score.parentElement) container.append(score);
    if (!reflection.parentElement) container.append(reflection);
  }
  private renderMoments(container: HTMLElement, moments: EveningMoment[]) {
    container.replaceChildren();
    if (!moments.length) { const copy = document.createElement('p'); copy.className = 'postcard-notice'; copy.textContent = 'No moments yet.'; container.append(copy); }
    for (const moment of moments) { const entry = document.createElement('div'); entry.className = 'moment-entry'; const title = document.createElement('strong'); title.textContent = moment.title; const copy = document.createElement('p'); copy.textContent = moment.description; entry.append(title, copy); container.append(entry); }
  }
  private renderHistory() {
    const container = el('past-evenings-list'); container.replaceChildren();
    try {
      const evenings = JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]') as { dateId: string; at: string; ending: { title: string; description: string; dateLine: string }; moments: EveningMoment[]; agenda?: DateAgendaProgress }[];
      for (const night of evenings.slice(0, 12)) {
        const date = getDate(night.dateId); if (!date || !night.ending || typeof night.ending.title !== 'string') continue;
        const item = document.createElement('details'); item.className = 'past-evening'; const summary = document.createElement('summary'); summary.textContent = `${date.name} · ${night.ending.title}`;
        const description = document.createElement('p'); description.textContent = night.ending.description; const quote = document.createElement('blockquote'); quote.textContent = night.ending.dateLine;
        item.append(summary, description, quote);
        if (night.agenda?.goal && typeof night.agenda.goal === 'string' && Number.isFinite(night.agenda.score) && Number.isFinite(night.agenda.possible)) { const agenda = document.createElement('section'); agenda.className = 'agenda-reflection'; this.renderAgenda(agenda, night.agenda, date.name); item.append(agenda); }
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
    context.font = canvasFont(25, 'body', 600); let y = lines(`“${ending.dateLine}”`, 85, 325, 1030, 36) + 25;
    for (const moment of state.evening.moments.slice(-3)) { context.fillStyle = UI_THEME.ink; context.font = canvasFont(22, 'display'); context.fillText(moment.title, 85, y, 710); y += 30; context.fillStyle = UI_THEME.muted; context.font = canvasFont(17); y = lines(moment.description, 85, y, 710, 25, 3) + 20; }
    const agenda = state.evening.agenda;
    if (agenda?.goal) {
      y += 8; context.fillStyle = UI_THEME.ink; context.font = canvasFont(22, 'display'); context.fillText(`What ${getDate(state.dateId)!.name} wanted`, 85, y); y += 30;
      context.fillStyle = UI_THEME.muted; context.font = canvasFont(17); y = lines(agenda.goal, 85, y, 710, 25, 3) + 7;
      context.fillStyle = UI_THEME.signal; context.font = canvasFont(17, 'body', 600); context.fillText(`Understanding · ${agenda.score} / ${agenda.possible}`, 85, y); y += 25;
    }
    // A small ticket stub keeps the card from reading as a form: date, table, the dessert if one was shared.
    const dessert = DESSERTS.find(item => item.id === state.evening.dessert.choice);
    context.save(); context.translate(880, 540); context.rotate(-.1); context.fillStyle = UI_THEME.board; context.fillRect(-15, -15, 220, 140);
    context.fillStyle = UI_THEME.ink; context.font = canvasFont(18, 'display'); context.fillText('TABLE 02', 8, 22);
    context.font = canvasFont(14); context.fillStyle = UI_THEME.muted; context.fillText(state.order ?? 'No order', 8, 52, 190);
    if (dessert && ['served', 'finished'].includes(state.evening.dessert.status)) context.fillText(`${dessert.name}, two spoons`, 8, 76, 190);
    if (state.evening.bill.settlement) context.fillText({ split: 'Split evenly', treat: 'Your treat', separate: 'Separate checks' }[state.evening.bill.settlement], 8, 100, 190);
    context.restore();
    const kept = document.createElement('canvas'); kept.width = canvas.width; kept.height = Math.max(900, Math.min(canvas.height, y + 70)); kept.getContext('2d')!.drawImage(canvas, 0, 0);
    const link = document.createElement('a'); link.download = `table-for-two-${state.dateId}.png`; link.href = kept.toDataURL('image/png'); link.click();
    this.actions.notice('Your evening’s memento is ready to keep.');
  }
}
