import { MENU, RESTAURANT } from '../../src/restaurant/content';
import { DESSERTS, EVENING_PACE } from '../../src/restaurant/evening';
import { BEAT_COLD, BEAT_CUES, CHARACTER_STORIES, getStoryCue, type BeatPhase, type StoryCueContext } from '../../src/restaurant/story';
import { createBlindDate, getBlindDateCue, type BlindDateIdentity } from '../../src/restaurant/blind-date';
import type { DinnerCommand, DinnerEvent, DinnerState, EveningEnding, SceneTurn, SceneUtterance } from '../../src/restaurant/types';
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
import { noteTableFact } from './table-facts';
import { DateInterestDirector, openingInterest } from './interest';

type Action = Extract<DinnerCommand, { type: 'evening' }>;
const incidentActions = ['inspect-ticket', 'return-order', 'keep-order', 'wipe', 'steady-glass', 'ask-quiet', 'let-it-go', 'apologize'];
/** Actions that need the date present and the kitchen running. */
const serviceActions = ['taste', 'offer-taste', 'order-dessert', 'skip-dessert', 'settle-bill'];

export interface EveningStepOptions {
  allowIncidents?: boolean; allowScenarios?: boolean; dateReturned?: boolean;
  /** A shared table (Double) keeps the check back until every active pair has finished. */
  holdBill?: boolean;
}

/** Course-time remarks that are asides rather than reactions to what just happened on the table. */
const ASIDE_CUES = new Set(['main-finished', 'quiet-window', 'dessert-shared', 'bill-requested', 'taste', 'main-served', 'dessert-served']);
/** Seconds after a human line during which the table counts as mid-conversation. */
const CONVERSATION_WINDOW = 20;
/** A timed event (a spill, the date's dessert pick, a table story) lets the talk settle this long after a human line… */
const SETTLE = 8;
/** …and this long after the date's reply ends, and never waits on an unfinished reply for longer than this. */
const AFTER_SPEECH = 6, REPLY_CAP = 70;
const GUARDED = ['guarded', 'hurt', 'leaving'];

/** A line that hands the turn to the human: a question, or a plain invitation to speak. */
/** Scene seconds after which an unanswered aside is stale: the talk has moved on and the model should not wait for it. */
const QUESTION_EXPIRES = 90;
const ASKS = /\?|\b(?:your turn|your move|tell me|say something|start anywhere|anything will do)\b/i;
/** A date line whose last words are a question, which the human has not answered until they next speak. */
const ENDS_ASKING = /\?["”’)]*\s*$/;

/**
 * The desserts a human may name while Eli's offer is open. A word counts only when it is not negated
 * ("not the lemon") and exactly one dessert is named, so "lemon or chocolate?" decides nothing.
 */
const DESSERT_WORDS: Record<string, RegExp> = { lemon: /\b(?:lemon|posset)\b/gi, chocolate: /\b(?:chocolate|fondant)\b/gi, berries: /\b(?:strawberr\w*|berries)\b/gi };
// A negation reaches only as far as its own clause: "allergic to nuts so the lemon" and "not the lemon but the chocolate" keep the second dessert.
const NEGATED = /\b(?:not|no|never|don'?t|dont|hate|dislike|avoid|allergic|allergy|sick of|tired of|without|skip|except|but not|anything but|rather than|instead of|(?:can'?t|cannot|can not|won'?t|wouldn'?t) (?:really |even |actually )?(?:have|eat|do|stand|handle|take|touch|tolerate|stomach|digest|be around))\b(?:(?!\b(?:so|but|then)\b)[^.?!,;]){0,24}$/i;
/**
 * A clause that begins as a question (“what is in the fondant?”, “does the lemon have nuts?”, “I was wondering what is in it”)
 * and does not lead straight into a pick is about a dessert, not a choice of it. An auxiliary opens a question only when a
 * subject follows (“would like the lemon” is a pick; “would the lemon…” is not).
 */
const FILLER = String.raw`and|so|but|u+m+|u+h+m*|e+r+m*|h+m+|m{2,}|oh|well|hey|ok(?:ay)?|wait|sorry|excuse me|actually|like|yeah|eli`;
const SUBJECT = String.raw`(?:it|that|this|these|those|there|the|you|we|they|he|she|i|any|both|either)`;
const ASKS_ABOUT = new RegExp(`^(?:(?:${FILLER})\\s+)*(?:(?:what|which|who|whose|where|when|why|how)(?:'?s)?\\b|(?:is|are|was|were|does|did|has|have|had|can|could|would|will|should|shall)(?![\\w'])\\s+${SUBJECT}\\b|do(?![\\w'])\\s+(?!the\\b)${SUBJECT}\\b|isn'?t\\b|aren'?t\\b|tell me (?:more )?(?:about|what)|describe\\b|explain\\b|(?:i (?:was )?wonder(?:ing)?|just wondering|wondering|curious|quick question|one question|i'?d (?:like|love) to know|i'?ll (?:ask|check)|let me (?:ask|know|see|check)|i'?m (?:just )?(?:asking|checking)|just (?:asking|checking))\\b)`, 'i');
/** A proposal counts only when it leads straight to the dessert (“can we get the lemon”), not when a question sits in between (“can I ask what is in the fondant”). */
const PROPOSAL = String.raw`let'?s|(?:can|could|may|might) (?:i|we)|shall we|should we|shouldn'?t we|wouldn'?t (?:it|that|the)|why (?:don'?t we|not)|we could|we'?ll|i'?ll|i'?d|i would|i want|i'?m (?:having|going|gonna)|i (?:think|might|may|fancy|guess|reckon|got|get|take|choose|pick|will|could)|(?:go|going|went) (?:with|for)|how about|what about|do the`;
const PROPOSES_NEAR = new RegExp(`(?:${PROPOSAL})(?:\\s+(?!(?:ask|know|see|wonder|check|if|whether|what|which|in)\\b)[\\p{L}']+){0,2}\\s*$`, 'iu');
const NO_DESSERT = /\b(?:no|skip|pass on|don'?t want|don'?t need|too full for)\s+(?:any\s+)?(?:dessert|pudding)\b|\b(?:i'?m|we'?re|i am|we are)\s+(?:so\s+|really\s+|too\s+)?(?:full|stuffed)\b/i;
function dessertMentions(text: string, id: string) {
  return [...text.matchAll(DESSERT_WORDS[id])].map(hit => {
    const index = hit.index ?? 0, before = text.slice(0, index), clause = before.slice(Math.max(before.lastIndexOf('.'), before.lastIndexOf('?'), before.lastIndexOf('!'), before.lastIndexOf(';'), before.lastIndexOf(',')) + 1).trim();
    const near = text.slice(Math.max(0, index - 30), index).replace(/\bwhy (?:don'?t we|not)\b/gi, 'why');
    return { negated: NEGATED.test(near), asking: ASKS_ABOUT.test(clause) && !PROPOSES_NEAR.test(clause) };
  });
}
const plainSpeech = (spoken: string) => spoken.replace(/[’‘]/g, "'");
export function namedDessertIn(spoken: string): string | null {
  const text = plainSpeech(spoken);
  // "Chocolate?" or "I was thinking chocolate, what do you think?" still name one; a question that merely mentions one does not.
  const named = DESSERTS.filter(({ id }) => dessertMentions(text, id).some(mention => !mention.negated && !mention.asking)).map(({ id }) => id);
  return named.length === 1 ? named[0] : null;
}
/** True when the human takes back the dessert they named earlier (“actually, not the lemon”). */
export function withdrawsDessert(spoken: string, id: string | null): boolean {
  if (!id || !DESSERT_WORDS[id]) return false;
  const mentions = dessertMentions(plainSpeech(spoken), id);
  return mentions.length > 0 && mentions.every(mention => mention.negated);
}

/**
 * Owns courses, physical recoveries and social consequences without model ticks.
 * The waiter serves and clears on scene time and the date fills silences with authored
 * lines, so the evening moves on its own; the player eats, talks and makes the real choices.
 */
export class EveningDirector {
  readonly agenda: DateAgendaDirector;
  readonly boundaries: DateBoundaryDirector;
  readonly chemistry: DateChemistryDirector;
  readonly tabletop: TabletopDirector;
  readonly interest: DateInterestDirector;
  private readonly ownHumanId: string;
  private redirectSequence = 0;
  private orderedAt = 0;
  private orderKitchenDelay = 0;
  private mainServeDelay = 0;
  private dessertAt = 0;
  private dessertKitchenDelay = 0;
  private dessertServeDelay = 0;
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
  private seatedAt: number | null = null;
  private nudged = false;
  private cutleryRestedAt: number | null = null;
  private thirdBiteAt: number | null = null;
  private secondSpoonAt: number | null = null;
  private dessertTalkDone = false;
  private lastSpokeAt = 0;
  private lastHumanAt = -1000;
  private repliedAt = -1000;
  private awaitingReply = false;
  /** The date's last model line was a question the human has not answered yet. */
  private dateAsked = false;
  /** The authored line the date asked that is still waiting for an answer. */
  private openQuestion: string | null = null;
  private openQuestionAt = 0;
  private namedDessert: string | null = null;
  private declinedDessert = false;
  private dessertNamed = false;
  private lastBeatAt = -1000;
  private lastDateBiteAt = 0;
  private readonly usedBeats = new Set<string>();
  private readonly blind?: BlindDateIdentity;
  constructor(private state: DinnerState, options: { scenarioId?: RestaurantScenarioId; humanId?: string } = {}) {
    this.ownHumanId = options.humanId ?? 'player';
    this.blind = state.blindDate ? createBlindDate(state.blindDate.seed) : undefined;
    this.agenda = new DateAgendaDirector(state);
    this.boundaries = new DateBoundaryDirector(state);
    this.chemistry = new DateChemistryDirector(state);
    this.tabletop = new TabletopDirector(state);
    this.interest = new DateInterestDirector(state, openingInterest(state, this.blind?.traits.openness));
    if (state.mode !== 'double-date') state.evening.scenario = createRestaurantScenario(state.blindDate?.seed ?? state.id, options.scenarioId);
    this.cue('welcome');
  }
  get departing() { return this.leavingAt !== null || !!this.state.evening.farewell.ending; }
  private get story() { return this.blind?.biography ?? CHARACTER_STORIES[this.state.dateId]; }
  private get dateName() { return this.state.participants.find(p => p.kind === 'ai')?.name ?? 'Your date'; }
  /** The table is quiet enough for the evening to move: nobody away, nothing to deal with. */
  private calm() {
    const e = this.state.evening;
    return !this.departing && !e.incident && e.scenario?.phase !== 'active' && scenePresenceAvailable(this.state) && !e.scenarioCare?.kitchen.held;
  }
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
    this.lastSpokeAt = this.state.elapsed;
    this.reconcileScenarioState();
  }
  /** Shared story outcomes must finalize the affected couple through its own director. */
  reconcileScenarioState() {
    const e = this.state.evening;
    if (e.care.romanceClosed || e.farewell.ending) this.chemistry.revoke();
    if (e.farewell.ending) { this.agenda.finish(); this.boundaries.clearPending(); }
  }
  private careMoment(id: string, title: string, description: string, line: SceneUtterance, byName: string) {
    // Moments are what the date reads back, and a model reply cannot erase them, so there is no second copy in the notebook.
    this.moment(`care-${id}`, title, `${byName}: ${description}`);
    this.state.evening.cues.push({ id: `care-${id}`, key: `care-${id}`, utterances: [line] });
    this.lastSpokeAt = this.state.elapsed;
  }
  /** The authored lines for a cue, in this date's voice and for the evening as it stands. */
  private lines(key: string, context?: StoryCueContext) {
    const cueContext = { resolution: this.state.evening.stance, ...context };
    return this.blind ? getBlindDateCue(this.blind, key, cueContext) : getStoryCue(key, this.state.dateId, cueContext);
  }
  /** Little has been earned yet, or the evening has cooled: scripted lines stay plain rather than confiding or warm. */
  private get reserved() { const e = this.state.evening; return e.dialogueTurns < 3 || GUARDED.includes(e.stance); }
  /** The human spoke recently, or the date is still answering them. */
  private get talkingNow() { const since = this.state.elapsed - this.lastHumanAt; return since < CONVERSATION_WINDOW || this.awaitingReply && since < REPLY_CAP; }
  /** A timed event must not land on top of the conversation or cancel the reply that is on its way. */
  private get conversing() { const t = this.state.elapsed; return this.awaitingReply && t - this.lastHumanAt < REPLY_CAP || t - this.lastHumanAt < SETTLE || t - this.repliedAt < AFTER_SPEECH; }
  private cue(key: string, context?: StoryCueContext) {
    let utterances = this.lines(key, context);
    // A pre-written aside dropped into a live exchange ignores what the human just said. While
    // the two of them are talking, staff lines still land but the date's scripted remark is left out.
    if (ASIDE_CUES.has(key) && this.talkingNow) utterances = utterances.filter(line => line.speaker !== 'date');
    if (utterances.length) { this.state.evening.cues.push({ id: `cue-${++this.cueSequence}`, key, utterances }); this.lastSpokeAt = this.state.elapsed; }
    this.state.evening.cues = this.state.evening.cues.slice(-70);
    // A greeting that ends on a question (how was your day?) is waiting for its answer too.
    const greeting = key === 'welcome' ? utterances.find(line => line.speaker === 'date') : undefined;
    if (greeting && ASKS.test(greeting.text)) this.askOpen(greeting.text);
    return utterances;
  }
  private moment(id: string, title: string, description: string) { if (!this.state.evening.moments.some(m => m.id === id)) this.state.evening.moments.push({ id, title, description }); }
  /**
   * A human just spoke to the table: it is a conversation, not a silence to fill, and the date's
   * reply is on its way. What they said can also settle the dessert while Eli's offer is open. In a
   * shared Double room only the pair's own human can choose that pair's dessert (`speakerId`).
   */
  noteHumanTurn(text = '', speakerId?: string) {
    this.lastHumanAt = this.state.elapsed; this.lastSpokeAt = this.state.elapsed; this.awaitingReply = true;
    // A question this date put to their own human is answered (or not) by that human; the friend's words do not settle it.
    if (!speakerId || speakerId === this.ownHumanId) { this.dateAsked = false; this.openQuestion = null; this.noteDessertWords(text); }
  }
  /** The date's reply to the latest human turn has finished (or was cut off). */
  replyEnded() { this.awaitingReply = false; this.lastSpokeAt = this.repliedAt = this.state.elapsed; }
  /** An authored line the date asked that the human has not answered yet, if any. */
  get pendingQuestion(): string | null { return this.openQuestion && this.state.elapsed - this.openQuestionAt <= QUESTION_EXPIRES ? this.openQuestion : null; }
  private askOpen(line: string) { this.openQuestion = line; this.openQuestionAt = this.state.elapsed; }
  private noteDessertWords(text: string) {
    const e = this.state.evening; if (e.main.status !== 'finished' || e.dessert.status !== 'none') return;
    const hit = namedDessertIn(text);
    if (hit) { this.namedDessert = hit; this.declinedDessert = false; } else if (NO_DESSERT.test(text)) this.declinedDessert = true;
    else if (withdrawsDessert(text, this.namedDessert)) this.namedDessert = null;
  }
  seated() { if (!this.seatedOnce) { this.seatedOnce = true; this.seatedAt = this.state.elapsed; this.cue('seated'); } }
  ordered() {
    const e = this.state.evening; e.main.status = 'waiting';
    e.main.dateDish = this.story.preferredMain || MENU[({ mira: 0, jules: 2, dev: 1 }[this.state.dateId] + e.variation) % MENU.length];
    e.chapter = 'mains'; this.orderedAt = this.state.elapsed; e.main.orderedAt = this.orderedAt; this.orderKitchenDelay = scenarioKitchenDelay(this.state);
    refreshScenarioBill(this.state); this.cue('ordered', { dish: e.main.dateDish ?? undefined, humanDish: this.state.order ?? undefined });
  }
  private startIncident(event: DinnerEvent) {
    const e = this.state.evening; if (e.incident || e.resolutions[event]) return false;
    if (event === 'wrong-order' && (e.main.status !== 'served' || e.main.bites !== 0)) return false;
    // The wrong plate is a dish neither of them ordered, so "that isn't ours" is true for both of them.
    if (event === 'wrong-order') { const strangers = MENU.filter(dish => dish !== this.state.order && dish !== e.main.dateDish), pool = strangers.length ? strangers : MENU.filter(dish => dish !== this.state.order); e.main.servedDish = pool[Math.abs(e.variation) % pool.length]; }
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
    if (e.incident && !incidentActions.includes(action)) throw new Error('There is something at the table to deal with first.');
    if (['toast', 'check-in'].includes(action) && !scenePresenceAvailable(this.state)) throw new Error('Give your date time to return to the table.');
    if (serviceActions.includes(action) && (e.scenarioCare?.kitchen.held || !scenePresenceAvailable(this.state))) throw new Error(e.scenarioCare?.presence !== 'at-table' ? 'Give your date time to return to the table.' : 'Ask Eli to resume dinner first.');
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
      const preferred = this.story.preferredMain;
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
      // One action for eating: the main course while it is on the table, dessert once it arrives.
      if (e.dessert.status === 'served') {
        if (now - this.lastTaste < 500) throw new Error('Enjoy that spoonful first.'); this.lastTaste = now;
        if (e.dessert.bites < 4) { e.dessert.bites++; if (e.dessert.bites === 2) this.secondSpoonAt = this.state.elapsed; }
      } else {
        if (e.main.status !== 'served') throw new Error(e.main.status === 'finished' ? 'Eli has cleared the plates.' : 'Wait for your dinner to arrive.');
        if (now - this.lastTaste < 500) throw new Error('Enjoy that bite first.'); this.lastTaste = now;
        if (e.main.bites < 3) { e.main.bites++; if (e.main.bites === 1) this.cue('taste', { dish: e.main.servedDish || '' }); if (e.main.bites === 3) { this.thirdBiteAt = this.state.elapsed; this.moment('dinner-tasted', 'Dinner, finally', `You tried the ${e.main.servedDish}; your date tried their ${e.main.dateDish}.`); } }
      }
    } else if (action === 'order-dessert' || action === 'skip-dessert') {
      if (e.main.status !== 'finished') throw new Error('Eli will offer dessert once the plates are cleared.');
      if (e.dessert.status !== 'none') throw new Error('Dessert has already been decided.');
      if (action === 'order-dessert' && !DESSERTS.some(d => d.id === choice)) throw new Error('Choose a dessert from the menu.');
      if (action === 'skip-dessert') this.skipDessert('you');
      else this.orderDessert(choice!, 'you');
    } else if (action === 'settle-bill') {
      if (!e.bill.requested || e.bill.settlement || !['split', 'treat', 'separate'].includes(choice || '')) throw new Error('Wait for the check, then choose how to settle it.');
      e.bill.settlement = choice as 'split' | 'treat' | 'separate'; e.chapter = 'farewell'; this.state.stage = 'farewell'; this.cue('bill-settled', { choice }); this.cue('farewell-invite', { reserved: this.reserved }); this.moment('bill', 'Dinner is settled', choice === 'split' ? 'You split the dinner bill.' : choice === 'treat' ? 'You offered to cover dinner, and the bill was paid.' : 'You each paid for what you ordered.');
    } else if (action === 'farewell') {
      if (!e.bill.settlement || !['again', 'friendly', 'goodbye'].includes(choice || '')) throw new Error('Settle the bill before choosing your farewell.');
      const human = this.state.participants[0].position; if (this.state.seated || Math.hypot(human[0] - RESTAURANT.entrance[0], human[2] - RESTAURANT.entrance[2]) > RESTAURANT.entranceRadius) throw new Error('Walk to the entrance together for your goodbye.');
      e.farewell.choice = choice as typeof e.farewell.choice;
      const guarded = e.stance === 'guarded' || e.stance === 'hurt';
      const sharedConnection = e.dialogueTurns > 0 || e.sharedActivities.some(activity => ['toast', 'tasting', 'dessert'].includes(activity));
      const confident = hasEarnedConfidence(e.agenda);
      const kind: EveningEnding['kind'] = choice === 'goodbye' || guarded ? 'quiet-goodbye' : e.care.romanceClosed ? 'new-friend' : choice === 'friendly' ? 'new-friend' : confident && this.repaired && this.wasHurt ? 'second-chance' : confident && e.stance === 'comfortable' && sharedConnection ? 'another-evening' : 'new-friend';
      this.beginEnding(kind);
    } else throw new Error('Unknown evening action.');
    refreshScenarioBill(this.state);
  }
  /** `named` means the date is going with the dessert the human said they wanted, rather than their own favourite. */
  private orderDessert(choice: string, chosenBy: 'you' | 'date', named = false) {
    const e = this.state.evening;
    e.dessert.choice = choice; e.dessert.status = 'waiting'; e.dessert.chosenBy = chosenBy; e.chapter = 'dessert'; this.state.stage = 'dessert';
    this.dessertAt = this.state.elapsed; this.dessertKitchenDelay = scenarioKitchenDelay(this.state); this.dessertNamed = named;
    this.cue(chosenBy === 'date' ? 'dessert-date-choice' : 'dessert-ordered', { choice, ...(named ? { named } : {}) });
    const dessert = DESSERTS.find(d => d.id === choice)?.name.toLowerCase() ?? 'dessert';
    if (chosenBy === 'date') noteTableFact(this.state, named ? `${this.dateName} ordered the ${dessert} that the human had said they wanted.` : `${this.dateName} chose the ${dessert} to share when nobody picked.`);
  }
  private skipDessert(chosenBy: 'you' | 'date') {
    const e = this.state.evening;
    e.dessert.status = 'skipped'; e.dessert.chosenBy = chosenBy; e.dessert.finishedAt = this.state.elapsed; e.chapter = 'dessert'; this.state.stage = 'dessert';
    this.cue('dessert-skipped');
  }
  private finishMain() {
    const e = this.state.evening;
    e.main.status = 'finished'; e.main.finishedAt = this.state.elapsed; e.dessert.offeredAt = this.state.elapsed;
    e.chapter = 'dessert'; this.state.stage = 'dessert'; e.lastInterruptionAt = this.state.elapsed;
    this.cue('main-finished', { bites: e.main.bites, reserved: this.reserved });
  }
  social(turn: SceneTurn, humanText = '', context: { humanId?: string; paired?: boolean; name?: string } = {}) {
    const e = this.state.evening; e.dialogueTurns++; this.lastSpokeAt = this.state.elapsed;
    if (this.departing) return;
    // A reply that ends on a question is waiting for its answer, so no silence breaker piles another on top.
    const lastLine = turn.utterances.filter(line => line.speaker === 'date').at(-1)?.text.trim() ?? '';
    this.dateAsked = ENDS_ASKING.test(lastLine);
    const humanId = context.humanId ?? this.ownHumanId, paired = context.paired !== false;
    const boundary = this.boundaries.assess(turn.social?.boundary, humanText, turn.utterances, humanId);
    if (boundary.kind === 'disregard') { if (paired) { this.agenda.pressure(); this.chemistry.revoke(); } }
    else this.agenda.assess(paired ? turn.agenda : turn.agenda ? { ...turn.agenda, signal: 'none', evidence: '' } : undefined, paired ? humanText : '', turn.utterances);
    this.chemistry.observe(turn, humanText, { paired, boundaryEvent: boundary.kind });
    if (turn.social) {
      const { signal, reason, wantsToLeave } = turn.social;
      if (boundary.kind === 'disregard') { this.pressure = boundary.count; this.wasHurt = true; e.stance = boundary.count > 1 ? 'hurt' : 'guarded'; e.stanceReason = reason; }
      // The reply the model just gave is already the acknowledgment, so no canned repair line follows it.
      else if (boundary.kind === 'repair') { this.pressure = boundary.count + 1; this.repair(reason, true); }
      else if (signal === 'repair' && !this.pressure) this.repair(reason, true);
      else if (['kindness', 'curiosity', 'humor'].includes(signal) && e.stance !== 'hurt' && e.stance !== 'guarded' && hasEarnedConfidence(e.agenda)) { e.stance = 'comfortable'; e.stanceReason = reason; }
      if (wantsToLeave && boundary.canLeave) { e.stance = 'leaving'; e.stanceReason = reason; this.beginEnding('walked-away', paired ? undefined : context.name ?? 'your friend'); }
    }
    // A read-out only: it follows what this turn established and feeds nothing back.
    this.interest.observe(turn, { paired, boundary: boundary.kind });
    this.interest.noticeProgress();
  }
  /**
   * Settle the date down after an apology. The canned line is for the apologize gesture only (no model
   * reply answers it), and only when the date was actually upset: a diner apology or a passing sorry
   * must not earn "I needed you to hear me", and a model reply is its own acknowledgment.
   */
  private repair(reason: string, modelSpoke = false) {
    const e = this.state.evening; if (e.stance === 'leaving') return;
    const wasUpset = this.pressure > 0 || e.stance === 'guarded' || e.stance === 'hurt'; // read before the lines below calm it
    this.repaired = true; this.pressure = Math.max(0, this.pressure - 1); e.stance = this.pressure ? 'guarded' : hasEarnedConfidence(e.agenda) ? 'comfortable' : 'curious'; e.stanceReason = reason;
    if (wasUpset && !modelSpoke) this.cue('repair');
  }
  private beginEnding(kind: EveningEnding['kind'], responsibleFriend?: string) {
    if (this.departing) return;
    this.chemistry.revoke();
    this.agenda.finish();
    const descriptions: Record<EveningEnding['kind'], [string, string]> = { 'another-evening': ['Another evening', 'A second date sounds like a possibility you both want to explore.'], 'new-friend': ['A good kind of company', 'The evening became a connection without needing to become a romance.'], 'second-chance': ['Room to try again', 'You owned an awkward moment and found a kinder way forward.'], 'quiet-goodbye': ['A complete goodbye', 'Not every first date asks for a second. This evening still had its own story.'], 'early-exit': ['An early goodbye', 'You chose when this evening was finished for you.'], 'walked-away': ['A boundary respected', 'Your date chose to leave after repeated pressure. Their decision stands.'] };
    // A friendship farewell is warm only when the date came to trust the human; otherwise it is kind and plain.
    const context: StoryCueContext = { reserved: !hasEarnedConfidence(this.state.evening.agenda) };
    const lines = responsibleFriend ? [{ speaker: 'date' as const, text: `I asked ${responsibleFriend} to stop. I’m leaving the table. Take care.`, emotion: 'defensive' as const }] : this.lines(`ending-${kind}`, context), [title, description] = descriptions[kind];
    this.state.evening.farewell.ending = { kind, title, description, dateLine: lines.find(line => line.speaker === 'date')?.text || 'Thank you for the evening. Take care.' };
    this.state.evening.chapter = 'farewell'; this.state.stage = 'farewell'; this.leavingAt = this.state.elapsed;
    if (responsibleFriend) this.state.evening.cues.push({ id: `cue-${++this.cueSequence}`, key: `ending-${kind}`, utterances: lines }); else this.cue(`ending-${kind}`, context);
  }
  earlyExit() { this.beginEnding('early-exit'); if (this.state.order && !this.state.evening.bill.settlement) { this.state.evening.bill.requested = true; this.state.evening.bill.settlement = 'separate'; this.moment('bill', 'Dinner is settled', 'The ordered dinner was settled separately before the early goodbye.'); } this.state.phase = 'ended'; this.state.stage = 'finished'; this.state.reason = this.state.evening.farewell.ending!.description; }
  window() { if (this.state.evening.moments.some(m => m.id === 'window')) return; this.moment('window', 'Away from the table', 'You took a quiet moment together by the rain-streaked window.'); this.cue('quiet-window'); }
  acknowledge(line: SceneUtterance, humanId = this.ownHumanId) { this.boundaries.acknowledge(line, humanId); if (humanId === this.ownHumanId) { this.agenda.acknowledge(line); this.chemistry.acknowledge(line); this.interest.noticeProgress(); if (line.speaker === 'date' && line.text === this.state.evening.farewell.ending?.dateLine) this.farewellHeard = true; } }
  /** A provider limit creates a scene beat, never a personal-boundary strike. */
  redirectConversation(allowIncident = true) {
    if (this.state.phase !== 'playing' || this.departing) return;
    const e = this.state.evening;
    if (allowIncident && this.state.seated && e.main.status === 'served' && e.main.bites === 0 && !e.incident && e.scenario?.phase !== 'active' && !e.resolutions['wrong-order'] && !e.bill.requested && this.state.elapsed - e.lastInterruptionAt > 25) {
      this.startIncident('wrong-order'); return;
    }
    const lines = ['Quick check—does anyone need anything for the table?', 'Sorry to cut in. Take your time with dinner; I’m nearby if you need me.', 'Just checking on the table. Everything all right here?'];
    const sequence = this.redirectSequence++;
    e.cues.push({ id: `redirect-${sequence}`, key: 'table-check', utterances: [{ speaker: 'waiter', text: lines[sequence % lines.length], emotion: 'neutral' }] });
    e.cues = e.cues.slice(-70); this.lastSpokeAt = this.state.elapsed;
  }
  /** Which authored silence breakers fit the moment. */
  private beatPhase(): BeatPhase | null {
    const e = this.state.evening;
    if (!this.state.order || e.bill.requested) return null;
    if (e.main.status === 'waiting') return 'waiting';
    if (e.main.status === 'served') return 'eating';
    if (e.main.status === 'finished') return 'after';
    return null;
  }
  step(dt: number, options: EveningStepOptions = {}) {
    if (this.state.phase !== 'playing') return;
    stepScenarioEffects(this.state, { allowReturn: options.dateReturned });
    this.tabletop.step();
    const e = this.state.evening, t = this.state.elapsed, P = EVENING_PACE;
    if (this.leavingAt === null && e.farewell.ending) this.leavingAt = t;
    if (e.care.water.status === 'requested' && e.care.water.requestedAt !== null && t - e.care.water.requestedAt >= 12 && !this.departing) {
      e.care.water.status = 'served';
      this.tabletop.restockWater();
      const delivery = this.waterDeliverySequence++;
      this.state.evening.cues.push({ id: delivery ? `care-water-served-${delivery}` : 'care-water-served', key: 'care-water-served', utterances: [{ speaker: 'waiter', text: 'Fresh water. Take your time; I’ll leave you to it.', emotion: 'warm' }] });
    }
    const canInterrupt = options.allowIncidents !== false && this.state.seated && !e.bill.requested && !e.bill.settlement && e.chapter !== 'farewell' && this.state.stage !== 'farewell' && t - e.lastInterruptionAt > 25 && t >= e.care.quietUntil && t - this.lastIncidentAt > 25 && this.calm();
    // Interruptions land before the courses move on, so a spill is never lost to the plates being cleared in the same moment.
    // Each has its own window and none depends on another having happened: the glass goes over a minute into the main course
    // (or as soon as the table is calm again, any time before dessert reaches it) and the neighbour's call starts over dessert.
    // A wrong plate is a physical event of service and arrives regardless; a spill or a loud neighbour waits for the
    // talk to settle, so it never lands on a question or cancels the answer that is on its way.
    if (canInterrupt && !e.incident && !this.conversing) {
      if (!e.resolutions['spilled-drink'] && !this.state.events.includes('spilled-drink') && ['served', 'finished'].includes(e.main.status) && !['served', 'finished'].includes(e.dessert.status) && e.main.servedAt !== undefined && t - e.main.servedAt >= P.spillAfterService) this.startIncident('spilled-drink');
      else if (!e.resolutions['disruptive-diner'] && !this.state.events.includes('disruptive-diner') && e.scenarioCare?.table !== 'quiet' && e.dessert.status === 'served' && e.dessert.servedAt !== undefined && t - e.dessert.servedAt >= P.dinerAfterDessertServed) this.startIncident('disruptive-diner');
    }
    const calm = this.calm(), seatedAndCalm = calm && this.state.seated;
    // Eli notices a seated guest who has not opened the menu.
    if (!this.nudged && seatedAndCalm && !this.state.order && this.seatedAt !== null && t - this.seatedAt >= P.orderNudge) { this.nudged = true; this.cue('order-nudge'); }
    let justServed = false;
    if (calm && e.main.status === 'waiting' && t - this.orderedAt - (scenarioKitchenDelay(this.state) - this.orderKitchenDelay) >= P.mainKitchen) {
      e.main.status = 'served'; e.main.servedDish = this.state.order; e.main.servedAt = t; e.main.dateBites = 0; this.lastDateBiteAt = t - P.dateBiteEvery + P.dateFirstBite; this.state.stage = 'dining'; justServed = true;
      this.mainServeDelay = scenarioKitchenDelay(this.state); this.cutleryRestedAt = null; this.thirdBiteAt = null;
      // An incorrect plate arrives with service, before any bites, rather than replacing eaten food.
      if (!canInterrupt || !this.startIncident('wrong-order')) this.cue('main-served', { dish: this.state.order ?? '' });
      e.lastInterruptionAt = t;
    }
    // The date eats their own plate at their own pace while it is in front of them, never mid-reply or
    // during something at the table. It is how the plate looks, not a step towards clearing it.
    if (e.main.status === 'served' && seatedAndCalm && !this.awaitingReply && (e.main.dateBites ?? 0) < P.dateBiteLimit && t - this.lastDateBiteAt >= P.dateBiteEvery) {
      e.main.dateBites = (e.main.dateBites ?? 0) + 1; this.lastDateBiteAt = t;
    }
    // Resting the cutlery across the plate tells Eli the course is done.
    if (e.main.status === 'served') {
      if (e.tabletop?.cutleryCrossed) this.cutleryRestedAt ??= t; else this.cutleryRestedAt = null;
      const held = scenarioKitchenDelay(this.state) - this.mainServeDelay, onTable = t - (e.main.servedAt ?? t) - held;
      const rested = this.cutleryRestedAt !== null && t - this.cutleryRestedAt >= P.mainAfterCutleryRested;
      const eaten = this.thirdBiteAt !== null && t - this.thirdBiteAt >= P.mainAfterEating;
      if (seatedAndCalm && !justServed && (onTable >= P.mainCourse || rested || eaten)) this.finishMain();
    }
    // The dessert offer stays open for a while; then the date goes with what the human said they wanted, or picks their
    // own favourite, unless the evening has cooled or the human said they were done. Never in the middle of an exchange.
    if (seatedAndCalm && !this.conversing && e.main.status === 'finished' && e.dessert.status === 'none' && e.dessert.offeredAt !== undefined && t - e.dessert.offeredAt >= P.dessertDecision) {
      if (GUARDED.includes(e.stance) || this.declinedDessert) this.skipDessert(this.declinedDessert ? 'you' : 'date');
      else this.orderDessert(this.namedDessert ?? this.story.preferredDessert, 'date', !!this.namedDessert);
    }
    if (calm && e.dessert.status === 'waiting' && t - this.dessertAt - (scenarioKitchenDelay(this.state) - this.dessertKitchenDelay) >= P.dessertKitchen) {
      e.dessert.status = 'served'; e.dessert.servedAt = t; this.dessertServeDelay = scenarioKitchenDelay(this.state); this.secondSpoonAt = null; this.dessertTalkDone = false;
      e.lastInterruptionAt = t; this.cue('dessert-served', { choice: e.dessert.choice ?? undefined });
    }
    if (e.dessert.status === 'served') {
      const held = scenarioKitchenDelay(this.state) - this.dessertServeDelay, onTable = t - (e.dessert.servedAt ?? t) - held;
      if (seatedAndCalm && !this.dessertTalkDone && (e.dessert.bites >= 1 || onTable >= P.dessertTalk)) {
        this.dessertTalkDone = true;
        if (!e.sharedActivities.includes('dessert')) e.sharedActivities.push('dessert');
        const name = DESSERTS.find(d => d.id === e.dessert.choice)?.name.toLowerCase() ?? 'dessert';
        this.moment('dessert', 'Something to share', `You shared the ${name}${e.dessert.chosenBy === 'date' ? this.dessertNamed ? ', the one you asked for' : ', your date’s pick' : ''}, two spoons and one plate.`);
        this.cue('dessert-shared', { reserved: this.reserved });
      }
      const eaten = this.secondSpoonAt !== null && t - this.secondSpoonAt >= P.dessertAfterEating;
      if (seatedAndCalm && this.dessertTalkDone && (onTable >= P.dessertCourse || eaten)) { e.dessert.status = 'finished'; e.dessert.finishedAt = t; }
    }
    // Eli brings the check once dessert is over, unless the shared table is still eating.
    if (seatedAndCalm && ['finished', 'skipped'].includes(e.dessert.status) && !e.bill.requested && !options.holdBill && e.dessert.finishedAt !== undefined && t - e.dessert.finishedAt >= P.checkDelay) {
      e.bill.requested = true; e.bill.arrivedAt = t; e.chapter = 'bill'; e.lastInterruptionAt = t; this.cue('bill-requested', { reserved: this.reserved });
    }
    if (options.allowScenarios !== false && this.state.mode !== 'double-date' && e.scenario && scenarioMayOpen(this.state) && !this.departing && !this.conversing && t - this.lastIncidentAt > 25 && t - e.lastInterruptionAt > 25 && t >= e.care.quietUntil) {
      e.lastInterruptionAt = t;
      appendScenarioCue(this.state, `${e.scenario.id}-opening`, activateRestaurantScenario(e.scenario, t, scenarioStyle(this.state)));
      applyScenarioEffects(this.state, e.scenario); this.lastSpokeAt = t;
    }
    // The date breaks a long silence with an authored line; no model request is made for it.
    // It waits for the human to answer the date's own question, and says so plainly when the human has not spoken at all.
    const phase = this.beatPhase(), silence = phase === 'waiting' ? P.beatSilenceWaiting : P.beatSilence + (e.variation % 3) * 17;
    if (phase && seatedAndCalm && !this.conversing && !GUARDED.includes(e.stance) && !this.dateAsked && e.beats < P.beatsPerEvening && t >= e.care.quietUntil && t - e.lastInterruptionAt > 25 && t - this.lastSpokeAt >= silence && t - this.lastBeatAt >= P.beatSpacing) {
      const key = e.dialogueTurns === 0 ? BEAT_COLD : BEAT_CUES[phase].find(candidate => !this.usedBeats.has(candidate));
      if (key && !this.usedBeats.has(key)) {
        this.usedBeats.add(key);
        const line = this.cue(key).find(u => u.speaker === 'date');
        // The line is already in the spoken history; the only thing to carry is that it still wants an answer.
        if (line) { e.beats++; this.lastBeatAt = t; if (ASKS.test(line.text)) this.askOpen(line.text); }
      }
    }
    this.interest.step(t - this.lastHumanAt, { calm: seatedAndCalm && !this.departing && !this.awaitingReply && !!this.state.order && !e.bill.requested, likesQuiet: this.agenda.likesQuiet, quietRequested: t < e.care.quietUntil });
    refreshScenarioBill(this.state);
    if (this.leavingAt !== null && (this.farewellHeard || t - this.leavingAt >= 30)) { const date = this.state.participants[1].position; if (Math.hypot(date[0] - .8, date[2] - 5.5) < .8 || t - this.leavingAt > 45) { this.state.phase = 'ended'; this.state.stage = 'finished'; this.state.reason = e.farewell.ending!.description; } }
  }
  /** Nothing outside the JS heap is held any more; kept for the scene lifecycle. */
  free() {}
}
