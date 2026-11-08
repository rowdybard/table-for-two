import { UI_THEME, canvasFont } from './theme';
import './experience.css';
import { DESSERTS } from './evening';
import { getDate, RESTAURANT } from './content';
import { buildDinnerBill, scenarioCareSnapshot, scenarioResumeAvailability } from './scenario-care';
import type { DateAgendaProgress } from './agenda-types';
import type { DinnerCommand, DinnerState, EveningAction, EveningMoment } from './types';

type Actions = { command(command: DinnerCommand): Promise<void>; scenario?(choice: string): Promise<void> | void; viewEnding?(): Promise<void> | void; openActivity(kind: 'coasters' | 'napkin' | 'dessert'): void; releasePointer(): void; modalChanged(): void; notice(message: string): void };
type Button = { label: string; action?: EveningAction; choice?: string; disabled?: boolean; run?: () => void };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dialogIds = ['dessert-dialog', 'bill-dialog', 'farewell-dialog', 'history-dialog'];

/** Course choices, incident recovery, and the night’s factual notebook. No model calls. */
export class EveningInterface {
  private state?: DinnerState;
  private renderKey = '';
  private momentsKey = '';
  private cluesKey = '';
  private keptEndingSignature = '';
  private deferred: DinnerCommand | null = null;
  private shownScenario = '';
  private sessionKey = '';
  private billKey = '';
  private readonly billTotal: HTMLElement;
  constructor(private readonly actions: Actions) {
    this.billTotal = document.getElementById('bill-total') ?? document.createElement('p');
    this.billTotal.id = 'bill-total';
    if (!this.billTotal.isConnected) el('bill-items').insertAdjacentElement('afterend', this.billTotal);
    const options = el('dessert-options');
    for (const dessert of DESSERTS) {
      const button = document.createElement('button'); button.dataset.gameItem = ''; button.dataset.dessert = dessert.id;
      const copy = document.createElement('span'); copy.className = 'dessert-choice-copy'; copy.textContent = dessert.name;
      button.append(copy); button.addEventListener('click', async () => { this.closeDialogs(); await this.perform({ type: 'evening', action: 'order-dessert', choice: dessert.id }); }); options.append(button);
    }
    el('dessert-close').addEventListener('click', () => this.closeDialogs());
    el('dessert-skip').addEventListener('click', async () => { this.closeDialogs(); await this.perform({ type: 'evening', action: 'skip-dessert' }); });
    el('bill-close').addEventListener('click', () => this.closeDialogs());
    el('farewell-close').addEventListener('click', () => this.closeDialogs());
    document.querySelectorAll<HTMLButtonElement>('[data-settlement]').forEach(button => button.addEventListener('click', async () => { this.closeDialogs(); await actions.command({ type: 'evening', action: 'settle-bill', choice: button.dataset.settlement }); }));
    document.querySelectorAll<HTMLButtonElement>('[data-farewell]').forEach(button => button.addEventListener('click', async () => { this.closeDialogs(); await actions.command({ type: 'evening', action: 'farewell', choice: button.dataset.farewell }); }));
    el('play-coasters').addEventListener('click', () => actions.openActivity('coasters'));
    el('play-napkin').addEventListener('click', () => actions.openActivity('napkin'));
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
  closeDialogs() { dialogIds.forEach(id => { el(id).hidden = true; }); this.actions.modalChanged(); }
  private open(id: string) { this.actions.releasePointer(); this.closeDialogs(); el(id).hidden = false; this.actions.modalChanged(); }
  openDessert() {
    if (!this.state?.seated) return this.actions.notice('Take a seat to look at dessert together.');
    const care = scenarioCareSnapshot(this.state.evening.scenarioCare);
    if (care.kitchen.held || care.presence !== 'at-table') return this.actions.notice(care.presence === 'at-table' ? 'Resume dinner before choosing dessert.' : 'Give your date time to return.');
    this.open('dessert-dialog');
  }
  async openBill() {
    if (!this.state) return;
    const session = this.state.id;
    const billState = () => this.state?.doubleDate?.role === 'wingman' ? this.state.doubleDate.otherView?.evening.bill : this.state?.evening.bill;
    if (!billState()?.requested) await this.perform({ type: 'evening', action: 'request-bill' });
    if (this.state.id !== session || this.state.phase !== 'playing' || !this.state.seated) return;
    if (!billState()?.requested || billState()?.settlement) return;
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
    const key = JSON.stringify(pairs.map(pair => [pair.human, pair.date, pair.view.evening.bill.settlement, pair.ledger]));
    if (key === this.billKey) return;
    this.billKey = key;
    const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
    const rows: string[] = [];
    let due = 0;
    for (const pair of pairs) {
      const settled = !!pair.view.evening.bill.settlement;
      if (pairs.length > 1) rows.push(`${pair.human} and ${pair.date}${settled ? ' · Already settled' : ''}`);
      for (const item of pair.ledger.items) {
        const owner = item.owner === 'you' ? pair.human : pair.date;
        const quantity = item.quantity > 1 ? ` × ${item.quantity}` : '';
        const status = item.status === 'cancelled' ? 'Cancelled before cooking · ' : item.status === 'pending' ? 'In the kitchen · ' : item.status === 'boxed' ? 'Packed to take home · ' : item.status === 'shared' ? 'To share · ' : '';
        const charge = ['cancelled', 'pending'].includes(item.status) ? 'Not charged' : money(item.chargedCents);
        rows.push(`${status}${owner} · ${item.label}${quantity} · ${charge}`);
      }
      if (pairs.length > 1 || settled) rows.push(`${settled ? 'Paid' : 'Pair total'} · ${money(pair.ledger.totalCents)}`);
      if (!settled) due += pair.ledger.totalCents;
      if (pairs.length > 1) rows.push('');
    }
    el('bill-items').textContent = rows.join('\n').trim();
    this.billTotal.textContent = `${pairs.length > 1 ? 'Amount due' : 'Total'} · ${money(due)}`;
  }
  openFarewell() {
    if (!this.state || this.state.evening.chapter !== 'farewell') return;
    const human = this.state.participants[0].position;
    if (this.state.seated || Math.hypot(human[0] - RESTAURANT.entrance[0], human[2] - RESTAURANT.entrance[2]) > RESTAURANT.entranceRadius) return this.actions.notice('Walk to the entrance together before saying goodnight.');
    el('farewell-copy').textContent = 'What would you like to say?';
    this.open('farewell-dialog');
  }
  handleTarget(target: Extract<DinnerCommand, { type: 'interact' }>['target']): boolean {
    const wingman = this.state?.doubleDate?.role === 'wingman';
    const double = this.state?.doubleDate;
    const remoteIncident = double?.incidentOwner && double.incidentOwner !== double.localHumanId;
    const evening = wingman || remoteIncident ? double?.otherView?.evening : this.state?.evening;
    if (target === 'napkin' && evening?.incident?.event === 'spilled-drink') { void this.actions.command({ type: 'evening', action: 'wipe' }); return true; }
    if (!wingman && target === 'glass' && evening?.incident?.event === 'spilled-drink') { void this.actions.command({ type: 'evening', action: 'steady-glass' }); return true; }
    const watchingFriend = !!this.state?.doubleDate?.tableActivity && this.state.doubleDate.tableActivity.owner !== this.state.doubleDate.localHumanId;
    if (wingman && ['meal', 'coasters', 'napkin', 'dessert'].includes(target) && !(target === 'coasters' && watchingFriend)) { this.actions.notice('Your date is complete. You can stay and help your friend.'); return true; }
    if (target === 'meal') {
      if (this.state) {
        const care = scenarioCareSnapshot(this.state.evening.scenarioCare);
        if (care.kitchen.held || care.presence !== 'at-table') this.actions.notice(care.presence === 'at-table' ? 'Dinner is held. Resume when you are ready.' : 'Give your date time to return.');
        else void this.perform({ type: 'evening', action: this.state.evening.main.bites < 3 ? 'taste' : 'finish-main' });
      }
      return true;
    }
    if (target === 'coasters' || target === 'napkin') { this.actions.openActivity(target); return true; }
    if (target === 'dessert') { if (this.state?.evening.dessert.status === 'served') this.actions.openActivity('dessert'); else this.openDessert(); return true; }
    if (target === 'ticket') { void this.actions.command({ type: 'evening', action: 'inspect-ticket' }); return true; }
    if (target === 'service-bell') {
      const incident = evening?.incident?.event;
      if (incident === 'disruptive-diner') void this.actions.command({ type: 'evening', action: 'ask-quiet' });
      else if (incident === 'wrong-order') void this.actions.command({ type: 'evening', action: 'return-order' });
      else if (evening?.care.water.status === 'none' || evening?.care.water.status === 'served' && evening.tabletop?.shared.carafeFill === 0 && evening.tabletop.glassFill < 4) void this.actions.command({ type: 'evening', action: 'request-water' });
      else this.actions.notice(evening?.care.water.status === 'requested' ? 'Water is on the way.' : 'The water has arrived.');
      return true;
    }
    if (target === 'bill') { void this.openBill(); return true; }
    if (target === 'exit' && this.state?.evening.chapter === 'farewell') { this.openFarewell(); return true; }
    return false;
  }
  update(state: DinnerState) {
    const sessionKey = `${state.id}/${state.doubleDate?.localHumanId ?? 'solo'}/${state.dateId}`;
    if (this.sessionKey && this.sessionKey !== sessionKey) {
      this.deferred = null; this.shownScenario = ''; this.renderKey = ''; this.momentsKey = ''; this.cluesKey = ''; this.billKey = '';
      this.closeDialogs();
    } else if (this.state?.doubleDate?.role !== state.doubleDate?.role) this.deferred = null;
    this.sessionKey = sessionKey;
    this.state = state;
    if (state.phase !== 'playing' && ['dessert-dialog', 'bill-dialog', 'farewell-dialog'].some(id => !el(id).hidden)) {
      for (const id of ['dessert-dialog', 'bill-dialog', 'farewell-dialog']) el(id).hidden = true;
      this.actions.modalChanged();
    }
    if (!el('bill-dialog').hidden) {
      const bill = state.doubleDate?.role === 'wingman' ? state.doubleDate.otherView?.evening.bill : state.evening.bill;
      if (!state.seated || bill?.settlement) { el('bill-dialog').hidden = true; this.actions.modalChanged(); }
      else this.renderBill(state);
    }
    const e = state.evening;
    const scenario = state.doubleDate?.scenario ?? e.scenario;
    const double = state.doubleDate;
    const actionEvening = double?.role === 'wingman' ? double.otherView?.evening ?? e : e;
    const targetDate = double?.dates.find(date => date.humanId === double.scenario?.target)?.dateId;
    // Only key the fields that change the drawer. Coaster coordinates, cues and
    // napkin strokes update independently and must not replace focused controls.
    const key = JSON.stringify([
      state.id, state.dateId, state.phase, state.seated, state.order, double?.role, double?.localHumanId,
      double?.role === 'wingman' ? double.otherView?.order : undefined,
      double?.role === 'wingman' ? double.tableActivity?.owner : undefined,
      actionEvening.chapter, actionEvening.main.status, actionEvening.main.bites,
      actionEvening.dessert.status, actionEvening.dessert.portions.length,
      actionEvening.incident?.event, actionEvening.incident?.progress,
      actionEvening.bill.requested, actionEvening.stance, !!actionEvening.farewell.ending,
      !!actionEvening.care.tasteOffer, !!actionEvening.care.toast,
      actionEvening.care.water.status, actionEvening.tabletop?.shared.carafeFill === 0 && (actionEvening.tabletop?.glassFill ?? 4) < 4, !!actionEvening.care.checkIn,
      scenario?.id, scenario?.phase, scenario?.title, scenario?.description,
      scenario?.choices, double?.scenario?.target, targetDate,
      actionEvening.scenarioCare,
      double?.scenario?.target !== double?.localHumanId ? double?.otherView?.evening.scenarioCare : undefined,
    ]);
    if (key !== this.renderKey) { this.renderKey = key; this.renderActions(state); }
    const scenarioBeat = scenario ? `${scenario.id}:${scenario.beat}` : '';
    if (scenario?.phase === 'active' && scenarioBeat !== this.shownScenario && state.phase === 'playing') {
      this.shownScenario = scenarioBeat;
      this.actions.releasePointer();
      el('evening-panel').querySelector<HTMLDetailsElement>('.action-drawer')!.open = true;
      this.actions.modalChanged();
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
    const activeEvening = state.doubleDate?.role === 'wingman' ? state.doubleDate.otherView?.evening ?? e : e;
    const care = scenarioCareSnapshot(activeEvening.scenarioCare);
    if (this.deferred && !activeEvening.incident && activeEvening.scenario?.phase !== 'active' && !care.kitchen.held && care.presence === 'at-table' && state.phase === 'playing' && state.seated) {
      const command = this.deferred; this.deferred = null;
      queueMicrotask(() => { void this.perform(command).then(() => {
        const bill = this.state?.doubleDate?.role === 'wingman' ? this.state.doubleDate.otherView?.evening.bill : this.state?.evening.bill;
        if (command.type === 'evening' && command.action === 'request-bill' && bill?.requested) void this.openBill();
      }); });
    }
  }
  private async perform(command: DinnerCommand) {
    const session = this.sessionKey;
    await this.actions.command(command);
    if (this.sessionKey !== session) return;
    const activeEvening = this.state?.doubleDate?.role === 'wingman' ? this.state.doubleDate.otherView?.evening : this.state?.evening;
    if (activeEvening?.incident && command.type === 'evening' && ['finish-main', 'order-dessert', 'skip-dessert', 'finish-dessert', 'request-bill'].includes(command.action)) this.deferred = command;
  }
  private renderActions(state: DinnerState) {
    const ownEvening = state.evening, wingman = state.doubleDate?.role === 'wingman';
    const e = wingman ? state.doubleDate?.otherView?.evening ?? ownEvening : ownEvening, panel = el('evening-panel');
    const scenario = state.doubleDate?.scenario ?? ownEvening.scenario;
    const activeView = wingman ? state.doubleDate?.otherView ?? state : state;
    const care = scenarioCareSnapshot(e.scenarioCare);
    const courseHeld = care.kitchen.held || care.presence !== 'at-table';
    panel.hidden = state.phase !== 'playing' || (!state.seated && !wingman && e.chapter !== 'farewell' && scenario?.phase !== 'active');
    const labels = { welcome: 'FIRST IMPRESSIONS', mains: 'DINNER DATE', 'shared-moment': 'BONUS ROUND', dessert: 'SWEET THINGS', bill: 'THE BILL', farewell: 'THE FINAL SCENE' };
    el('evening-chapter').textContent = labels[e.chapter];
    let title = 'At the table', copy = '';
    let buttons: Button[] = [];
    if (scenario?.phase === 'active') {
      const targetDate = state.doubleDate?.dates.find(date => date.humanId === state.doubleDate?.scenario?.target);
      const targetName = targetDate ? getDate(targetDate.dateId)?.name : undefined;
      const nameTarget = (text: string) => targetName ? text.replace(/\byour date\b/gi, targetName) : text;
      title = scenario.title; copy = nameTarget(scenario.description) + (state.seated ? '' : ' Take your seat to respond.');
      const targetView = state.doubleDate?.scenario?.target && state.doubleDate.scenario.target !== state.doubleDate.localHumanId ? state.doubleDate.otherView ?? state : state;
      const consequence = this.consequenceCopy(targetView);
      if (consequence) copy += ` ${consequence}`;
      const presence = scenarioCareSnapshot(targetView.evening.scenarioCare).presence;
      const returning = scenario.beat === 'follow-through' && ['privacy-break', 'cleanup-break'].includes(presence);
      if (returning) copy = ['They’re returning shortly. Choose together when they are back.', consequence].filter(Boolean).join(' ');
      buttons = scenario.choices.map(choice => ({ label: nameTarget(choice.label), choice: choice.id, disabled: !state.seated || returning, run: () => { void this.actions.scenario?.(choice.id); } }));
    } else if (wingman && !state.seated) {
      title = 'Stay for your friend'; copy = 'Take your seat to help at the table.';
    } else if (wingman && !e.incident) {
      title = 'Here for your friend'; copy = this.consequenceCopy(activeView);
      if (care.kitchen.held) {
        const resume = scenarioResumeAvailability({ ...activeView, seated: state.seated });
        buttons.push({ label: 'Resume your friend’s dinner', action: 'resume-dinner', disabled: !resume.enabled });
      }
      if ((e.care.water.status === 'none' || e.care.water.status === 'served' && e.tabletop?.shared.carafeFill === 0 && e.tabletop.glassFill < 4) && !e.bill.requested) buttons.push({ label: 'Ask for water for your friend', action: 'request-water' });
      if (care.presence === 'at-table' && state.doubleDate?.otherView?.order && !e.care.checkIn && !e.bill.requested) buttons.push({ label: 'Check in with their date', action: 'check-in' });
      if (state.doubleDate?.tableActivity && state.doubleDate.tableActivity.owner !== state.doubleDate.localHumanId) buttons.push({ label: 'Watch their coaster game', run: () => this.actions.openActivity('coasters') });
      if (e.bill.requested || (e.main.status === 'finished' && ['finished', 'skipped'].includes(e.dessert.status))) buttons.push({ label: 'Look at the shared bill', run: () => { void this.openBill(); } });
      if (!buttons.length && e.care.water.status === 'requested') copy = 'Water is on the way.';
    } else if (e.stance === 'leaving' || e.farewell.ending) {
      title = 'At the door'; copy = ''; buttons = [];
    } else if (e.incident?.event === 'wrong-order') {
      title = 'The wrong order?'; copy = e.incident.progress ? '' : 'Check the order ticket.';
      buttons = [{ label: e.incident.progress ? 'Ticket checked ✓' : 'Compare the order ticket', action: 'inspect-ticket', disabled: e.incident.progress > 0 }, { label: 'Ask for the right dish', action: 'return-order', disabled: !e.incident.progress }, { label: 'Keep the surprise', action: 'keep-order', disabled: !e.incident.progress }];
    } else if (e.incident?.event === 'spilled-drink') {
      title = 'Spilled drink'; copy = e.incident.progress < 3 ? 'Wipe the table.' : 'Set the glass upright.';
      buttons = [{ label: e.incident.progress < 3 ? 'Wipe with the napkin' : 'Table wiped ✓', action: 'wipe', disabled: e.incident.progress >= 3 }, { label: 'Set the glass upright', action: 'steady-glass', disabled: e.incident.progress < 3 }];
    } else if (e.incident?.event === 'disruptive-diner') {
      title = 'A noisy neighbor'; copy = '';
      buttons = [{ label: 'Ask the waiter for a little quiet', action: 'ask-quiet' }, { label: 'Let it pass. Back to us.', action: 'let-it-go' }];
    } else if (courseHeld) {
      title = care.presence === 'privacy-break' ? 'A private minute' : care.presence === 'cleanup-break' ? 'A moment to clean up' : care.presence === 'staff-care' ? 'Dinner can wait' : 'Dinner is held';
      copy = this.consequenceCopy(activeView);
      const resume = scenarioResumeAvailability(activeView);
      if (care.kitchen.held) buttons = [{ label: 'Resume dinner', action: 'resume-dinner', disabled: !resume.enabled }];
      if (!resume.enabled && care.presence === 'at-table' && resume.reason) copy = [copy, resume.reason].filter(Boolean).join(' ');
    } else if (e.chapter === 'farewell') {
      title = 'Say goodnight'; copy = 'Meet at the entrance.';
      buttons = [{ label: 'Say goodnight at the door', run: () => this.openFarewell() }];
    } else if (e.chapter === 'bill') {
      title = 'The bill'; copy = '';
      buttons = [{ label: 'Look at the bill', run: () => { void this.openBill(); } }];
    } else if (e.main.status === 'waiting') {
      title = 'Dinner is on the way'; copy = '';
      buttons = [{ label: 'Try coaster curl', run: () => this.actions.openActivity('coasters') }, { label: 'Pass the napkin', run: () => this.actions.openActivity('napkin') }];
    } else if (e.main.status === 'served') {
      title = 'Dinner'; copy = '';
      buttons = [{ label: e.main.bites >= 3 ? 'That was good ✓' : 'Try a bite', action: 'taste', disabled: e.main.bites >= 3 }, { label: 'Ready for something sweet', action: 'finish-main', disabled: e.main.bites < 3 }];
    } else if (e.dessert.status === 'none' && e.main.status === 'finished') {
      title = 'Dessert?'; copy = '';
      buttons = [{ label: 'Look at the dessert menu', run: () => this.openDessert() }, { label: 'Just the bill, please', action: 'skip-dessert' }];
    } else if (e.dessert.status === 'waiting') {
      title = 'Dessert is on the way'; copy = '';
      buttons = [{ label: 'Finish our napkin drawing', run: () => this.actions.openActivity('napkin') }];
    } else if (e.dessert.status === 'served') {
      title = 'Dessert'; copy = '';
      buttons = [{ label: 'Share dessert', run: () => this.actions.openActivity('dessert') }, { label: 'That was lovely. The bill?', action: 'finish-dessert', disabled: e.dessert.portions.length < 4 }];
    } else if (e.dessert.status === 'finished' || e.dessert.status === 'skipped') {
      title = 'The bill'; copy = '';
      buttons = [{ label: 'Ask for the bill', run: () => { void this.openBill(); } }];
    }
    if (!copy && scenario?.phase !== 'active') copy = this.consequenceCopy(activeView);
    if (!wingman && (e.stance === 'guarded' || e.stance === 'hurt') && !e.incident) buttons.push({ label: 'Acknowledge the awkward moment', action: 'apologize' });
    if (wingman) buttons.push({ label: 'Show my ending', run: () => { void this.actions.viewEnding?.(); } });
    el('evening-action-title').textContent = title; el('evening-action-copy').textContent = copy;
    const parent = el('evening-action-buttons');
    const gesturesOpen = parent.querySelector<HTMLDetailsElement>('.care-actions')?.open ?? false;
    const toastOpen = parent.querySelector<HTMLDetailsElement>('.toast-actions')?.open ?? false;
    parent.replaceChildren();
    for (const specification of buttons) {
      const button = document.createElement('button'); button.dataset.gameItem = ''; button.textContent = specification.label; button.disabled = !!specification.disabled;
      if (specification.action) button.dataset.evening = specification.action;
      if (scenario?.phase === 'active' && specification.choice) button.dataset.scenario = specification.choice;
      if (wingman && specification.label === 'Show my ending') button.id = 'view-own-ending';
      button.addEventListener('click', () => { if (specification.run) specification.run(); else if (specification.action) void this.perform({ type: 'evening', action: specification.action, ...(specification.choice ? { choice: specification.choice } : {}) }); }); parent.append(button);
    }
    if (!wingman && !courseHeld && state.seated && !e.incident && scenario?.phase !== 'active' && e.stance !== 'leaving' && !e.farewell.ending && !e.bill.requested) {
      const care = e.care;
      const gestures = document.createElement('details'); gestures.className = 'care-actions'; gestures.open = gesturesOpen;
      const summary = document.createElement('summary'); summary.textContent = 'Little gestures'; gestures.append(summary);
      const addAction = (label: string, action: EveningAction, choice?: string) => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.gameItem = ''; button.dataset.evening = action; button.textContent = label;
        button.addEventListener('click', () => { void this.perform({ type: 'evening', action, ...(choice ? { choice } : {}) }); }); gestures.append(button);
      };
      if (e.main.status === 'served' && !care.tasteOffer) addAction('Offer a taste', 'offer-taste');
      if (state.order && !care.toast) {
        const toast = document.createElement('details'); toast.className = 'toast-actions'; toast.open = toastOpen;
        const toastSummary = document.createElement('summary'); toastSummary.textContent = 'Make a toast'; toast.append(toastSummary);
        for (const [choice, label] of [['tonight', 'To tonight'], ['honesty', 'To honesty'], ['friends', 'To friendship'], ['mischief', 'To a little mischief']]) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.gameItem = ''; button.dataset.evening = 'toast'; button.dataset.choice = choice; button.textContent = label;
          button.addEventListener('click', () => { void this.perform({ type: 'evening', action: 'toast', choice }); }); toast.append(button);
        }
        gestures.append(toast);
      }
      if (care.water.status === 'none' || care.water.status === 'served' && e.tabletop?.shared.carafeFill === 0 && e.tabletop.glassFill < 4) addAction('Ask for water', 'request-water');
      else if (care.water.status === 'requested') { const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Water is on the way.'; gestures.append(status); }
      if (state.order && !care.checkIn) addAction('Check in with your date', 'check-in');
      if (gestures.children.length > 1) parent.append(gestures);
    }
    el('table-play').hidden = wingman || courseHeld || !!e.incident || scenario?.phase === 'active' || e.chapter === 'bill' || e.chapter === 'farewell' || !state.seated;
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
    const signature = JSON.stringify([sessionKey, ending, state.evening.moments, state.evening.napkin, agenda]);
    if (this.keptEndingSignature !== signature) {
      try {
        const previous = JSON.parse(localStorage.getItem('table-for-two-evenings') || '[]') as Array<{ sessionKey?: string; at?: string }>;
        const existing = previous.find(entry => entry?.sessionKey === sessionKey);
        const saved = { sessionKey, dateId: state.dateId, at: existing?.at ?? new Date().toISOString(), ending, moments: state.evening.moments.slice(-6), napkin: state.evening.napkin, ...(agenda?.goal ? { agenda } : {}) };
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
    const points = state.evening.napkin.points;
    if (points.length) { context.save(); context.translate(880, 540); context.rotate(-.1); context.fillStyle = UI_THEME.board; context.fillRect(-15, -15, 220, 220); context.strokeStyle = UI_THEME.signal; context.lineWidth = 2; context.beginPath(); points.forEach(([x, y], i) => { if (i) context.lineTo(x * 190, y * 190); else context.moveTo(x * 190, y * 190); }); context.stroke(); context.restore(); }
    const kept = document.createElement('canvas'); kept.width = canvas.width; kept.height = Math.max(900, Math.min(canvas.height, y + 70)); kept.getContext('2d')!.drawImage(canvas, 0, 0);
    const link = document.createElement('a'); link.download = `table-for-two-${state.dateId}.png`; link.href = kept.toDataURL('image/png'); link.click();
    this.actions.notice('Your evening’s memento is ready to keep.');
  }
}
