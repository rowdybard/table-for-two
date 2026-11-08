import { MENU, RESTAURANT } from '../../src/restaurant/content';
import { DESSERTS } from '../../src/restaurant/evening';
import { CHARACTER_STORIES, getStoryCue } from '../../src/restaurant/story';
import { createBlindDate, getBlindDateCue, type BlindDateIdentity } from '../../src/restaurant/blind-date';
import type { DinnerCommand, DinnerEvent, DinnerState, EveningEnding, SceneTurn, SceneUtterance } from '../../src/restaurant/types';
import { TableCoasters } from './coasters';
import { createRestaurantScenario, activateRestaurantScenario, chooseRestaurantScenario, type ScenarioChoiceResult } from '../../src/restaurant/scenarios';
import type { RestaurantScenarioId, ToastIntention } from '../../src/restaurant/scenario-types';
import { appendScenarioCue, applyScenarioToView, scenarioStyle } from './scenario';
import { DateAgendaDirector } from './agendas';
import { hasEarnedConfidence } from './skepticism';
import { DateBoundaryDirector } from './boundaries';
import { DateChemistryDirector } from './chemistry';
import { TabletopDirector } from './tabletop';
import { scenarioMayOpen, scenePresenceAvailable } from '../../src/restaurant/scenario-care';
import { applyScenarioEffects, stepScenarioEffects, scenarioKitchenDelay, refreshScenarioBill, resumeScenarioDinner } from './scenario-effects';

type Action = Extract<DinnerCommand, { type: 'evening' }>;
const incidentActions = ['inspect-ticket', 'return-order', 'keep-order', 'wipe', 'steady-glass', 'ask-quiet', 'let-it-go', 'apologize'];

/** Owns courses, physical recoveries and social consequences without model ticks. */
export class EveningDirector {
  readonly coasters: TableCoasters;
  readonly agenda: DateAgendaDirector;
  readonly boundaries: DateBoundaryDirector;
  readonly chemistry: DateChemistryDirector;
  readonly tabletop: TabletopDirector;
  private readonly ownHumanId: string;
  private redirectSequence = 0;
  private orderedAt = 0;
  private orderKitchenDelay = 0;
  private dessertAt = 0;
  private dessertKitchenDelay = 0;
  private lastIncidentAt = -1000;
  private lastWipe = -1000;
  private lastTaste = -1000;
  private cueSequence = 0;
  private waterDeliverySequence = 0;
  private pressure = 0;
  private repaired = false;
  private wasHurt = false;
  private leavingAt: number | null = null;
  private farewellHeard = false;
  private seatedOnce = false;
  private readonly blind?: BlindDateIdentity;
  constructor(private state: DinnerState, options: { scenarioId?: RestaurantScenarioId; humanId?: string } = {}) {
    this.ownHumanId = options.humanId ?? 'player';
    this.blind = state.blindDate ? createBlindDate(state.blindDate.seed) : undefined;
    this.agenda = new DateAgendaDirector(state);
    this.boundaries = new DateBoundaryDirector(state);
    this.chemistry = new DateChemistryDirector(state);
    this.tabletop = new TabletopDirector(state);
    this.coasters = new TableCoasters(state.evening.coasters, state.dateId, state.evening.variation);
    if (state.mode !== 'double-date') state.evening.scenario = createRestaurantScenario(state.blindDate?.seed ?? state.id, options.scenarioId);
    this.cue('welcome');
  }
  get departing() { return this.leavingAt !== null || !!this.state.evening.farewell.ending; }
  scenario(choice: string, byName = 'You') {
    const scenario = this.state.evening.scenario;
    if (this.state.phase !== 'playing' || !scenario || this.departing) throw new Error('That table moment is not active.');
    this.requireSeat();
    if (scenario.beat === 'follow-through' && ['privacy-break', 'cleanup-break'].includes(this.state.evening.scenarioCare?.presence ?? 'at-table')) throw new Error('Give your date time to return before deciding together.');
    this.applyScenarioOutcome(chooseRestaurantScenario(scenario, choice, byName, this.state.elapsed, scenarioStyle(this.state)), byName);
  }
  applyScenarioOutcome(result: ScenarioChoiceResult, byName = 'You') {
    const scenario = this.state.evening.scenario;
    if (!scenario) throw new Error('There is no table moment to resolve.');
    applyScenarioToView(this.state, scenario, result, byName);
    this.reconcileScenarioState();
  }
  /** Shared story outcomes must finalize the affected couple through its own director. */
  reconcileScenarioState() {
    const e = this.state.evening;
    if (e.care.romanceClosed || e.farewell.ending) this.chemistry.revoke();
    if (e.farewell.ending) { this.agenda.finish(); this.boundaries.clearPending(); }
  }
  private careMoment(id: string, title: string, description: string, line: SceneUtterance, byName: string) {
    this.moment(`care-${id}`, title, `${byName}: ${description}`);
    this.state.memory = `${this.state.memory}\n${byName}: ${description}`.trim().slice(-1000);
    this.state.evening.cues.push({ id: `care-${id}`, key: `care-${id}`, utterances: [line] });
  }
  private cue(key: string, context?: { choice?: string; dish?: string; resolution?: string }) {
    const cueContext = { resolution: this.state.evening.stance, ...context };
    const utterances = this.blind ? getBlindDateCue(this.blind, key, cueContext) : getStoryCue(key, this.state.dateId, cueContext);
    if (utterances.length) this.state.evening.cues.push({ id: `cue-${++this.cueSequence}`, key, utterances });
    this.state.evening.cues = this.state.evening.cues.slice(-70);
  }
  private moment(id: string, title: string, description: string) { if (!this.state.evening.moments.some(m => m.id === id)) this.state.evening.moments.push({ id, title, description }); }
  seated() { if (!this.seatedOnce) { this.seatedOnce = true; this.cue('seated'); } }
  ordered() { const e = this.state.evening; e.main.status = 'waiting'; e.main.dateDish = (this.blind?.biography ?? CHARACTER_STORIES[this.state.dateId]).preferredMain || MENU[({ mira: 0, jules: 2, dev: 1 }[this.state.dateId] + e.variation) % MENU.length]; e.chapter = 'mains'; this.orderedAt = this.state.elapsed; e.main.orderedAt = this.orderedAt; this.orderKitchenDelay = scenarioKitchenDelay(this.state); refreshScenarioBill(this.state); this.cue('ordered', { dish: e.main.dateDish }); }
  private startIncident(event: DinnerEvent) {
    const e = this.state.evening; if (e.incident || e.resolutions[event]) return false;
    if (event === 'wrong-order' && (e.main.status !== 'served' || e.main.bites !== 0)) return false;
    if (e.coasters.phase === 'rolling') throw new Error('Let the current coaster finish its roll before moving dinner along.');
    if (event === 'wrong-order') { const alternatives = MENU.filter(dish => dish !== this.state.order); e.main.servedDish = alternatives[Math.abs(e.variation) % alternatives.length]; }
    e.incident = { event, progress: 0, startedAt: this.state.elapsed }; if (!this.state.events.includes(event)) this.state.events.push(event);
    this.lastIncidentAt = this.state.elapsed; e.lastInterruptionAt = this.state.elapsed; this.cue(event === 'spilled-drink' ? 'spill' : event === 'disruptive-diner' ? 'diner' : event); return true;
  }
  private resolveIncident(resolution: string, cue: string) { const e = this.state.evening, incident = e.incident!; e.resolutions[incident.event] = resolution; this.moment(incident.event, { 'wrong-order': 'A plate with a story', 'spilled-drink': 'A little teamwork', 'disruptive-diner': 'Finding your quiet' }[incident.event], resolution); e.incident = null; this.lastIncidentAt = this.state.elapsed; e.lastInterruptionAt = this.state.elapsed; this.cue(cue); }
  private requireSeat() { if (!this.state.seated) throw new Error('Take your seat at the table first.'); }
  private ensureIncident(event: DinnerEvent) { if (this.state.evening.incident?.event !== event) throw new Error('That is not happening at the table right now.'); return this.state.evening.incident; }
  action(command: Action, now: number, byName = 'You') {
    const e = this.state.evening, { action, choice } = command;
    if (e.stance === 'leaving') throw new Error('Your date has chosen to leave. You can say goodbye.');
    if (action !== 'farewell') this.requireSeat();
    if (e.scenario?.phase === 'active') throw new Error('Respond to the moment at the table first.');
    if (e.coasters.phase === 'rolling' && ['finish-main', 'order-dessert', 'skip-dessert', 'finish-dessert', 'request-bill', 'settle-bill'].includes(action)) throw new Error('Let the current coaster finish its roll before moving dinner along.');
    if (e.incident && !incidentActions.includes(action)) throw new Error('There is something at the table to deal with first.');
    if (['toast', 'check-in'].includes(action) && !scenePresenceAvailable(this.state)) throw new Error('Give your date time to return to the table.');
    if (['taste', 'finish-main', 'offer-taste', 'order-dessert', 'skip-dessert', 'serve-dessert', 'finish-dessert', 'request-bill', 'settle-bill', 'start-coasters'].includes(action) && (e.scenarioCare?.kitchen.held || !scenePresenceAvailable(this.state))) throw new Error(e.scenarioCare?.presence !== 'at-table' ? 'Give your date time to return to the table.' : 'Ask Eli to resume dinner first.');
    refreshScenarioBill(this.state);
    if (action === 'resume-dinner') {
      resumeScenarioDinner(this.state);
    } else if (action === 'request-water') {
      const refill = e.care.water.status === 'served' && e.tabletop!.shared.carafeFill === 0 && e.tabletop!.glassFill < 4;
      if (e.care.water.status !== 'none' && !refill) throw new Error('Water has already been requested.');
      e.care.water = { status: 'requested', requestedAt: this.state.elapsed };
      if (!refill) this.careMoment('water', 'A little care', 'Asked Eli for fresh water.', { speaker: 'waiter', text: 'Of course. I’ll bring some fresh water over.', emotion: 'warm' }, byName);
    } else if (action === 'offer-taste') {
      if (e.main.status !== 'served' || !e.main.servedDish) throw new Error('Wait for your meal before offering a taste.');
      if (e.care.tasteOffer) throw new Error('Your date has already answered the offer.');
      const preferred = (this.blind?.biography ?? CHARACTER_STORIES[this.state.dateId]).preferredMain;
      const interested = !['guarded', 'hurt'].includes(e.stance) && (e.main.servedDish === preferred || (this.blind ? this.blind.traits.openness >= 50 : this.state.dateId !== 'jules'));
      e.care.tasteOffer = { result: interested ? 'accepted' : 'declined', dish: e.main.servedDish };
      if (interested && !e.sharedActivities.includes('tasting')) e.sharedActivities.push('tasting');
      const text = interested ? scenarioStyle(this.state) === 'playful' ? 'Yes, please. A small bite—this is curiosity, not a hostile takeover of your plate.' : scenarioStyle(this.state) === 'dry' ? 'I’d try a little. For research.' : 'Yes, I’d like to try that. Thanks for asking.' : scenarioStyle(this.state) === 'dry' ? 'No, thank you. I’m quite happy with mine.' : 'Thanks for offering. I’d rather stick with my own dish.';
      this.careMoment('taste', interested ? 'A taste of each other’s dinner' : 'An offer, not an obligation', `Offered a taste of ${e.main.servedDish}; the date ${interested ? 'accepted a small bite' : 'declined and the answer stood'}.`, { speaker: 'date', text, emotion: interested ? 'amused' : 'neutral' }, byName);
    } else if (action === 'toast') {
      if (!this.state.order || e.bill.requested) throw new Error('There is time for a toast after ordering and before the bill.');
      if (e.care.toast) throw new Error('You have already shared a toast tonight.');
      if (!['tonight', 'honesty', 'friends', 'mischief'].includes(choice || '')) throw new Error('Choose what to toast.');
      const intention = choice as ToastIntention;
      e.care.toast = { intention, at: this.state.elapsed }; this.state.glassRaised = true;
      if (!e.sharedActivities.includes('toast')) e.sharedActivities.push('toast');
      const replies: Record<ToastIntention, string[]> = {
        tonight: ['To tonight. No rehearsed lines required.', 'To an evening that actually happened.', 'To tonight. I’m glad we came.'],
        honesty: ['To honesty. Including admitting when the joke didn’t land.', 'A useful toast. Let’s mean it.', 'To saying what we mean and listening to the answer.'],
        friends: ['To friends who get you out of the house.', 'To good company, however the evening turns out.', 'To the people who make room for each other.'],
        mischief: ['A little mischief. Nothing that gets Eli fired.', 'Carefully rationed mischief. We are using real glassware.', 'A little mischief. We stop when somebody isn’t enjoying it.'],
      };
      const style = scenarioStyle(this.state), index = style === 'playful' ? 0 : style === 'dry' ? 1 : 2;
      this.careMoment('toast', 'A toast at the table', `Shared a toast to ${intention === 'tonight' ? 'the evening' : intention === 'mischief' ? 'a little mischief' : intention}.`, { speaker: 'date', text: replies[intention][index], emotion: 'warm' }, byName);
    } else if (action === 'check-in') {
      if (!this.state.order || e.bill.requested) throw new Error('Check in while you are spending time at dinner.');
      if (e.care.checkIn) throw new Error('You have already made room for a check-in.');
      const slow = ['guarded', 'hurt'].includes(e.stance) || (this.blind ? this.blind.traits.sociability < 40 : this.state.dateId === 'jules');
      e.care.checkIn = { answer: slow ? 'slow-down' : 'continue', at: this.state.elapsed };
      if (slow) e.care.quietUntil = this.state.elapsed + 45;
      const confident = hasEarnedConfidence(e.agenda);
      const text = slow ? 'A little slower would be good. We don’t need to fill every pause.' : !confident ? scenarioStyle(this.state) === 'playful' ? 'I’m enjoying dinner. You’re still being assessed, though. No victory lap yet.' : 'I’m fine staying. I’m still figuring you out.' : scenarioStyle(this.state) === 'playful' ? 'I’m having a good time. Keep being an actual person and we’re doing fine.' : 'I’m comfortable. Thank you for asking instead of guessing.';
      this.careMoment('check-in', 'Room to check in', `Asked how the evening felt; the date chose to ${slow ? 'slow the pace' : 'continue the evening'}.`, { speaker: 'date', text, emotion: slow ? 'neutral' : 'warm' }, byName);
    } else if (action === 'inspect-ticket') { const incident = this.ensureIncident('wrong-order'); incident.progress = 1; this.moment('ticket', 'Checked the ticket', `The ticket says ${this.state.order}, but the plate contains ${e.main.servedDish}.`); }
    else if (action === 'return-order' || action === 'keep-order') { const incident = this.ensureIncident('wrong-order'); if (!incident.progress) throw new Error('Check the order ticket before deciding.'); const unexpected = e.main.servedDish; if (action === 'return-order') e.main.servedDish = this.state.order; this.resolveIncident(action === 'return-order' ? `You returned the ${unexpected} politely, and the waiter brought your ${this.state.order}.` : `You kept the unexpected ${unexpected}, although your original order was ${this.state.order}.`, action === 'return-order' ? 'wrong-order-returned' : 'wrong-order-kept'); }
    else if (action === 'wipe') { const incident = this.ensureIncident('spilled-drink'); if (incident.progress >= 3) return; if (now - this.lastWipe < 100) throw new Error('Give the napkin a moment to soak up the water.'); this.lastWipe = now; incident.progress++; if (incident.progress === 1 && e.stance === 'comfortable') this.cue('spill-help'); if (incident.progress === 3) this.cue('spill-wiped'); }
    else if (action === 'steady-glass') { const incident = this.ensureIncident('spilled-drink'); if (incident.progress < 3) throw new Error('Wipe the water before setting the glass upright.'); this.state.glassRaised = false; this.resolveIncident('You dried the table and steadied the glass together.', 'spill-fixed'); if (e.stance === 'curious' && hasEarnedConfidence(e.agenda)) { e.stance = 'comfortable'; e.stanceReason = 'You helped dry the table after showing that you understood what mattered.'; } }
    else if (action === 'ask-quiet') { this.ensureIncident('disruptive-diner'); this.resolveIncident('You asked for quiet without making the neighboring diner the enemy.', 'diner-quiet'); }
    else if (action === 'let-it-go') { this.ensureIncident('disruptive-diner'); this.resolveIncident('You chose to focus on each other and let the call pass.', 'diner-ignored'); }
    else if (action === 'apologize') { if (e.incident?.event === 'disruptive-diner') this.resolveIncident('You cooled the exchange down and apologized for the tension.', 'diner-quiet'); this.repair('You made room to start again.'); }
    else if (action === 'taste') {
      if (e.main.status !== 'served') throw new Error('Wait for your dinner to arrive.');
      if (now - this.lastTaste < 500) throw new Error('Enjoy that bite first.'); this.lastTaste = now;
      if (e.main.bites < 3) { e.main.bites++; if (e.main.bites === 1) this.cue('taste', { dish: e.main.servedDish || '' }); if (e.main.bites === 3) this.moment('dinner-tasted', 'Dinner, finally', `You tried the ${e.main.servedDish}; your date tried their ${e.main.dateDish}.`); }
    } else if (action === 'finish-main') {
      if (e.main.status !== 'served' || e.main.bites < 3) throw new Error('Try a few bites of dinner before finishing the main course.');
      e.main.status = 'finished'; e.chapter = 'shared-moment'; this.cue('main-finished');
    } else if (action === 'start-coasters') {
      if (!this.state.order || e.bill.requested) throw new Error('Order first; there is time for a table game before the bill.'); this.coasters.start(); if (e.dessert.status === 'none') e.chapter = 'shared-moment'; this.cue('coasters-start');
    } else if (action === 'order-dessert' || action === 'skip-dessert') {
      if (e.main.status !== 'finished') throw new Error('Finish your main course first.');
      if (e.dessert.status !== 'none') throw new Error('You have already made your dessert choice.');
      if (action === 'order-dessert' && !DESSERTS.some(d => d.id === choice)) throw new Error('Choose a dessert from the menu.');
      if (action === 'skip-dessert') { e.dessert.status = 'skipped'; e.chapter = 'dessert'; this.state.stage = 'dessert'; this.cue('dessert-skipped'); }
      else { e.dessert.choice = choice!; e.dessert.status = 'waiting'; e.chapter = 'dessert'; this.state.stage = 'dessert'; this.dessertAt = this.state.elapsed; this.dessertKitchenDelay = scenarioKitchenDelay(this.state); this.cue('dessert-ordered', { choice }); }
    } else if (action === 'serve-dessert') {
      if (e.dessert.status !== 'served' || !Number.isInteger(command.piece) || command.piece! < 0 || command.piece! > 3 || !['you', 'date'].includes(command.plate as string)) throw new Error('Choose an unserved portion and one of the two plates.');
      if (e.dessert.portions.some(p => p.piece === command.piece)) throw new Error('That portion is already on a plate.');
      e.dessert.portions.push({ piece: command.piece!, plate: command.plate! });
      if (e.dessert.portions.length === 4) { const toDate = e.dessert.portions.filter(p => p.plate === 'date').length; if (!e.sharedActivities.includes('dessert')) e.sharedActivities.push('dessert'); this.moment('dessert', 'Something to share', `You served ${toDate} portions to your date and ${4 - toDate} to yourself.`); this.cue('dessert-shared', { resolution: ['guarded', 'hurt', 'leaving'].includes(e.stance) ? e.stance : toDate === 0 ? 'kept-all' : toDate === 4 ? 'gave-all' : e.stance }); }
    } else if (action === 'finish-dessert') {
      if (e.dessert.status !== 'served' || e.dessert.portions.length !== 4) throw new Error('Serve the four dessert portions first.');
      e.dessert.status = 'finished';
    } else if (action === 'request-bill') {
      if (e.bill.requested) return;
      if (e.main.status !== 'finished' || !['finished', 'skipped'].includes(e.dessert.status)) throw new Error('Finish dinner and decide about dessert before asking for the bill.');
      e.bill.requested = true; e.chapter = 'bill'; this.cue('bill-requested');
    } else if (action === 'settle-bill') {
      if (!e.bill.requested || e.bill.settlement || !['split', 'treat', 'separate'].includes(choice || '')) throw new Error('Ask for the bill, then choose how to settle it.');
      e.bill.settlement = choice as 'split' | 'treat' | 'separate'; e.chapter = 'farewell'; this.state.stage = 'farewell'; this.cue('bill-settled', { choice }); this.cue('farewell-invite'); this.moment('bill', 'Dinner is settled', choice === 'split' ? 'You split the dinner bill.' : choice === 'treat' ? 'You offered to cover dinner, and the bill was paid.' : 'You each paid for what you ordered.');
    } else if (action === 'farewell') {
      if (!e.bill.settlement || !['again', 'friendly', 'goodbye'].includes(choice || '')) throw new Error('Settle the bill before choosing your farewell.');
      const human = this.state.participants[0].position; if (this.state.seated || Math.hypot(human[0] - RESTAURANT.entrance[0], human[2] - RESTAURANT.entrance[2]) > RESTAURANT.entranceRadius) throw new Error('Walk to the entrance together for your goodbye.');
      e.farewell.choice = choice as typeof e.farewell.choice;
      const guarded = e.stance === 'guarded' || e.stance === 'hurt';
      const sharedConnection = e.dialogueTurns > 0 || e.sharedActivities.some(activity => activity === 'napkin' || activity === 'coasters');
      const confident = hasEarnedConfidence(e.agenda);
      const kind: EveningEnding['kind'] = choice === 'goodbye' || guarded ? 'quiet-goodbye' : e.care.romanceClosed ? 'new-friend' : choice === 'friendly' ? 'new-friend' : confident && this.repaired && this.wasHurt ? 'second-chance' : confident && e.stance === 'comfortable' && sharedConnection ? 'another-evening' : 'new-friend';
      this.beginEnding(kind);
    } else throw new Error('Unknown evening action.');
    refreshScenarioBill(this.state);
  }
  shot(angle: number, power: number) { this.requireSeat(); if (!scenePresenceAvailable(this.state) || this.state.evening.scenarioCare?.kitchen.held || this.state.evening.incident || this.state.evening.scenario?.phase === 'active' || this.departing) throw new Error('Finish the interruption before flicking another coaster.'); this.coasters.shoot(angle, power); }
  napkin(points: [number, number][], complete: boolean) {
    this.requireSeat(); if (this.departing || this.state.evening.incident || this.state.evening.scenario?.phase === 'active') throw new Error('There is something at the table to deal with first.');
    if (!scenePresenceAvailable(this.state)) throw new Error('Give your date time to return to the table.');
    if (points.length > 600 || points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isFinite(v) || v < 0 || v > 1)) || (complete && points.length < 8)) throw new Error('Draw at least eight points inside the napkin before keeping it.');
    this.tabletop.unfoldNapkin();
    const e = this.state.evening; e.napkin.points = points.map(p => [...p]); e.napkin.complete = complete;
    if (complete && !e.sharedActivities.includes('napkin')) { e.sharedActivities.push('napkin'); this.moment('napkin', 'A small souvenir', 'You added a drawing to the napkin and kept it as a memento.'); this.cue('napkin-kept'); }
  }
  social(turn: SceneTurn, humanText = '', context: { humanId?: string; paired?: boolean; name?: string } = {}) {
    const e = this.state.evening; e.dialogueTurns++;
    if (this.departing) return;
    const humanId = context.humanId ?? this.ownHumanId, paired = context.paired !== false;
    const boundary = this.boundaries.assess(turn.social?.boundary, humanText, turn.utterances, humanId);
    if (boundary.kind === 'disregard') { if (paired) { this.agenda.pressure(); this.chemistry.revoke(); } }
    else this.agenda.assess(paired ? turn.agenda : turn.agenda ? { ...turn.agenda, signal: 'none', evidence: '' } : undefined, paired ? humanText : '', turn.utterances);
    this.chemistry.observe(turn, humanText, { paired, boundaryEvent: boundary.kind });
    if (!turn.social) return;
    const { signal, reason, wantsToLeave } = turn.social;
    if (boundary.kind === 'disregard') { this.pressure = boundary.count; this.wasHurt = true; e.stance = boundary.count > 1 ? 'hurt' : 'guarded'; e.stanceReason = reason; }
    else if (boundary.kind === 'repair') { this.pressure = boundary.count + 1; this.repair(reason); }
    else if (signal === 'repair' && !this.pressure) this.repair(reason);
    else if (['kindness', 'curiosity', 'humor'].includes(signal) && e.stance !== 'hurt' && e.stance !== 'guarded' && hasEarnedConfidence(e.agenda)) { e.stance = 'comfortable'; e.stanceReason = reason; }
    if (wantsToLeave && boundary.canLeave) { e.stance = 'leaving'; e.stanceReason = reason; this.beginEnding('walked-away', paired ? undefined : context.name ?? 'your friend'); }
  }
  private repair(reason: string) { const e = this.state.evening; if (e.stance === 'leaving') return; this.repaired = true; this.pressure = Math.max(0, this.pressure - 1); e.stance = this.pressure ? 'guarded' : hasEarnedConfidence(e.agenda) ? 'comfortable' : 'curious'; e.stanceReason = reason; this.cue('repair'); }
  private beginEnding(kind: EveningEnding['kind'], responsibleFriend?: string) {
    if (this.departing) return;
    this.chemistry.revoke();
    this.agenda.finish();
    const descriptions: Record<EveningEnding['kind'], [string, string]> = { 'another-evening': ['Another evening', 'A second date sounds like a possibility you both want to explore.'], 'new-friend': ['A good kind of company', 'The evening became a connection without needing to become a romance.'], 'second-chance': ['Room to try again', 'You owned an awkward moment and found a kinder way forward.'], 'quiet-goodbye': ['A complete goodbye', 'Not every first date asks for a second. This evening still had its own story.'], 'early-exit': ['An early goodbye', 'You chose when this evening was finished for you.'], 'walked-away': ['A boundary respected', 'Your date chose to leave after repeated pressure. Their decision stands.'] };
    const lines = responsibleFriend ? [{ speaker: 'date' as const, text: `I asked ${responsibleFriend} to stop. I’m leaving the table. Take care.`, emotion: 'defensive' as const }] : this.blind ? getBlindDateCue(this.blind, `ending-${kind}`) : getStoryCue(`ending-${kind}`, this.state.dateId), [title, description] = descriptions[kind];
    this.state.evening.farewell.ending = { kind, title, description, dateLine: lines.find(line => line.speaker === 'date')?.text || 'Thank you for the evening. Take care.' };
    this.state.evening.chapter = 'farewell'; this.state.stage = 'farewell'; this.leavingAt = this.state.elapsed;
    if (responsibleFriend) this.state.evening.cues.push({ id: `cue-${++this.cueSequence}`, key: `ending-${kind}`, utterances: lines }); else this.cue(`ending-${kind}`);
  }
  earlyExit() { this.beginEnding('early-exit'); if (this.state.order && !this.state.evening.bill.settlement) { this.state.evening.bill.requested = true; this.state.evening.bill.settlement = 'separate'; this.moment('bill', 'Dinner is settled', 'The ordered dinner was settled separately before the early goodbye.'); } this.state.phase = 'ended'; this.state.stage = 'finished'; this.state.reason = this.state.evening.farewell.ending!.description; }
  window() { if (this.state.evening.moments.some(m => m.id === 'window')) return; this.moment('window', 'Away from the table', 'You took a quiet moment together by the rain-streaked window.'); this.cue('quiet-window'); }
  acknowledge(line: SceneUtterance, humanId = this.ownHumanId) { this.boundaries.acknowledge(line, humanId); if (humanId === this.ownHumanId) { this.agenda.acknowledge(line); this.chemistry.acknowledge(line); if (line.speaker === 'date' && line.text === this.state.evening.farewell.ending?.dateLine) this.farewellHeard = true; } }
  /** A provider limit creates a scene beat, never a personal-boundary strike. */
  redirectConversation(allowIncident = true) {
    if (this.state.phase !== 'playing' || this.departing) return;
    const e = this.state.evening;
    if (allowIncident && this.state.seated && e.main.status === 'served' && e.main.bites === 0 && !e.incident && e.scenario?.phase !== 'active' && !e.resolutions['wrong-order'] && !e.bill.requested && e.coasters.phase !== 'rolling' && this.state.elapsed - e.lastInterruptionAt > 25) {
      this.startIncident('wrong-order'); return;
    }
    const lines = ['Quick check—does anyone need anything for the table?', 'Sorry to cut in. Take your time with dinner; I’m nearby if you need me.', 'Just checking on the table. Everything all right here?'];
    const sequence = this.redirectSequence++;
    e.cues.push({ id: `redirect-${sequence}`, key: 'table-check', utterances: [{ speaker: 'waiter', text: lines[sequence % lines.length], emotion: 'neutral' }] });
    e.cues = e.cues.slice(-70);
  }
  step(dt: number, options: { allowIncidents?: boolean; allowScenarios?: boolean; dateReturned?: boolean } = {}) {
    if (this.state.phase !== 'playing') return;
    stepScenarioEffects(this.state, { allowReturn: options.dateReturned });
    this.tabletop.step();
    const e = this.state.evening;
    if (this.leavingAt === null && e.farewell.ending) this.leavingAt = this.state.elapsed;
    if (e.care.water.status === 'requested' && e.care.water.requestedAt !== null && this.state.elapsed - e.care.water.requestedAt >= 12 && !this.departing) {
      e.care.water.status = 'served';
      this.tabletop.restockWater();
      const delivery = this.waterDeliverySequence++;
      this.state.evening.cues.push({ id: delivery ? `care-water-served-${delivery}` : 'care-water-served', key: 'care-water-served', utterances: [{ speaker: 'waiter', text: 'Fresh water. Take your time; I’ll leave you to it.', emotion: 'warm' }] });
    }
    if (!this.departing && this.coasters.step(dt, !e.incident && e.scenario?.phase !== 'active' && this.state.seated)) { if (!e.sharedActivities.includes('coasters')) e.sharedActivities.push('coasters'); this.moment('coasters', 'A game on the table', `Three rounds of coaster curl: you ${e.coasters.humanScore}, date ${e.coasters.dateScore}.`); this.cue(e.coasters.humanScore === e.coasters.dateScore ? 'coasters-draw' : e.coasters.humanScore > e.coasters.dateScore ? 'coasters-win' : 'coasters-loss'); }
    const canInterrupt = options.allowIncidents !== false && this.state.seated && !e.bill.requested && !e.bill.settlement && e.chapter !== 'farewell' && this.state.stage !== 'farewell' && this.state.elapsed - e.lastInterruptionAt > 25 && e.scenario?.phase !== 'active' && this.state.elapsed >= e.care.quietUntil && !e.incident && !this.departing && scenePresenceAvailable(this.state) && !e.scenarioCare?.kitchen.held && this.state.elapsed - this.lastIncidentAt > 25 && e.coasters.phase !== 'rolling';
    let justServed = false;
    if (!this.departing && !e.scenarioCare?.kitchen.held && scenePresenceAvailable(this.state) && e.main.status === 'waiting' && this.state.elapsed - this.orderedAt - (scenarioKitchenDelay(this.state) - this.orderKitchenDelay) >= 45) {
      e.main.status = 'served'; e.main.servedDish = this.state.order; e.main.servedAt = this.state.elapsed; this.state.stage = 'dining'; justServed = true;
      // An incorrect plate arrives with service, before any bites, rather than replacing eaten food.
      if (!canInterrupt || !this.startIncident('wrong-order')) this.cue('main-served');
      e.lastInterruptionAt = this.state.elapsed;
    }
    if (!this.departing && !e.scenarioCare?.kitchen.held && scenePresenceAvailable(this.state) && e.scenario?.phase !== 'active' && e.dessert.status === 'waiting' && this.state.elapsed - this.dessertAt - (scenarioKitchenDelay(this.state) - this.dessertKitchenDelay) >= 20) { e.dessert.status = 'served'; this.cue('dessert-served'); }
    if (canInterrupt && !justServed && !e.incident) {
      if (!e.resolutions['spilled-drink'] && !this.state.events.includes('spilled-drink') && this.state.elapsed >= 8 * 60 && ['served', 'finished'].includes(e.main.status)) this.startIncident('spilled-drink');
      else if (!e.resolutions['disruptive-diner'] && !this.state.events.includes('disruptive-diner') && e.scenarioCare?.table !== 'quiet' && this.state.elapsed >= 15 * 60 && !!this.state.order) this.startIncident('disruptive-diner');
    }
    if (options.allowScenarios !== false && this.state.mode !== 'double-date' && e.scenario && scenarioMayOpen(this.state) && !this.departing && this.state.elapsed - this.lastIncidentAt > 25 && this.state.elapsed - e.lastInterruptionAt > 25 && this.state.elapsed >= e.care.quietUntil) {
      e.lastInterruptionAt = this.state.elapsed;
      appendScenarioCue(this.state, `${e.scenario.id}-opening`, activateRestaurantScenario(e.scenario, this.state.elapsed, scenarioStyle(this.state)));
      applyScenarioEffects(this.state, e.scenario);
    }
    refreshScenarioBill(this.state);
    if (this.leavingAt !== null && (this.farewellHeard || this.state.elapsed - this.leavingAt >= 30)) { const date = this.state.participants[1].position; if (Math.hypot(date[0] - .8, date[2] - 5.5) < .8 || this.state.elapsed - this.leavingAt > 45) { this.state.phase = 'ended'; this.state.stage = 'finished'; this.state.reason = e.farewell.ending!.description; } }
  }
  free() { this.coasters.free(); }
}
