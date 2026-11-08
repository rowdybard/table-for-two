import type { Emotion, SceneUtterance } from './types';
import type { RestaurantScenarioId, RestaurantScenarioState } from './scenario-types';

type Style = 'playful' | 'dry' | 'direct';
type Line = string | { playful: string; dry: string; direct: string };
type Choice = { id: string; label: string; fact: string; line: Line; follow?: string; reaction?: Emotion | Record<Style, Emotion>; followLabels?: Record<string, string>; effects?: Partial<RestaurantScenarioState['effects']> };
type Ending = Choice;
interface Track {
  id: RestaurantScenarioId; title: string; setup: string; opening: Line; openingSpeaker?: 'date' | 'waiter';
  follow: string; choices: Choice[]; endings: Ending[];
}
const c = (id: string, label: string, fact: string, line: Line, follow?: string): Choice => ({ id, label, fact, line, ...(follow ? { follow } : {}) });

/** Awkward situations stay about choices and boundaries, rather than making an identity the joke. */
export const RESTAURANT_SCENARIOS: readonly Track[] = [
  {
    id: 'feeling-unwell', title: 'An urgent detour',
    setup: 'Your date suddenly excuses themself for the bathroom. A long, awkward minute passes; Eli quietly asks whether to hold the food.',
    opening: 'Could you give me a minute? I’m sorry. This is spectacular timing.',
    follow: 'Your date returns looking embarrassed. They say their stomach has settled, but they would rather slow the evening down.',
    choices: [c('water', 'Ask Eli to hold dinner and bring water', 'Dinner was held and fresh water was requested while the date took a bathroom break.', 'Thank you. I was worried I’d come back to a cold plate and an investigation.'), c('fresh-air', 'Give them privacy and ask Eli to wait', 'The date was given privacy during an urgent bathroom break.', 'I appreciate you not turning that into tonight’s main event.'), c('support', 'Send a discreet check-in through Eli', 'Eli discreetly checked whether the date needed anything.', 'I’m all right. Thanks for checking without announcing it to the room.')],
    endings: [c('slow-dinner', 'Keep dinner gentle and unhurried', 'The date chose to stay, with water and a slower dinner.', { playful: 'A quieter second act. I can work with that.', dry: 'I’d like that. Fewer surprises for the next ten minutes, please.', direct: 'Yes. I want to stay; I just need to take it slowly.' }), { ...c('head-home', 'Offer an early finish', 'The date accepted an early finish after feeling unwell.', 'Heading home sounds sensible. Thank you for making that easy.'), effects: { earlyExit: true, service: 'water' } }],
  },
  {
    id: 'wine-spill', title: 'Wine on a sleeve',
    setup: 'A passing tray catches a glass of red wine. Some lands on your date’s sleeve. Eli stops short with a stack of napkins; your date freezes for a beat.',
    opening: { playful: 'Well. That is a very committed splash of colour.', dry: 'I had almost made it through dinner without wearing it.', direct: 'I’m okay. Please give me a napkin before anyone grabs my sleeve.' },
    follow: 'Eli has a clean cloth ready. Your date wants to decide whether to deal with the stain here or step away for a moment.',
    choices: [c('ask-first', 'Offer a cloth: “Want a hand?”', 'Handed over a clean cloth and held the spare napkins.', 'Thanks. I’ve got it—just hold that napkin stack for me.', 'Your date takes the cloth. With both hands occupied, they ask you to clear the glasses while they clean the sleeve.'), { ...c('get-eli', 'Flag down Eli for a fresh cloth', 'Eli brought a clean cloth and gave the table room to recover.', 'That helps. No need for the whole room to supervise my laundry.', 'Eli returns with a cloth and offers a quieter place to clean up. Your date wants to choose whether to step away or reset the table here.'), effects: { service: 'help' } }, { ...c('own-mishap', 'Say, “The sleeve needed a plot twist”', 'The player tried a sleeve joke while the date was still dealing with the spill.', { playful: 'An ambitious rewrite. Could the next scene involve a napkin?', dry: 'The joke can wait. Cloth first.', direct: 'Give me a napkin, then we can joke.' }, 'The joke lands unevenly. Your date reaches for a cloth and leaves a beat for you to help with the actual mess.'), reaction: { playful: 'amused', dry: 'annoyed', direct: 'embarrassed' }, followLabels: { 'fresh-start': 'Put the joke aside and offer a clean-up break', 'change-seat': 'Help move the wet things and reset the table' } }],
    endings: [c('fresh-start', 'Take a clean-up break, then carry on', 'The date cleaned up at their own pace and chose to continue dinner.', 'All right. I’m declaring this sleeve a problem for tomorrow.'), c('change-seat', 'Help move the wet things and reset the table', 'The wet glassware was moved and the table was reset together.', { playful: 'New table arrangement. Same excellent company.', dry: 'There. A small restoration of order.', direct: 'Much better. Let’s get back to dinner.' })],
  },
  {
    id: 'oversized-order', title: 'More than expected',
    setup: 'Your date orders several small plates, expecting tasting portions. Full-size dishes begin arriving. The table is running out of space.',
    opening: { playful: 'In my defence, the word “small” did a lot of work on that menu.', dry: 'I appear to have ordered for a committee.', direct: 'I misread the portions. We should sort this out before more arrives.' },
    follow: 'Eli can stop the dishes that have not been prepared. There is still plenty on the table, and your date asks what you feel comfortable sharing.',
    choices: [{ ...c('help', 'Ask Eli to cancel what is still in the kitchen', 'Eli cancelled the extra dishes still in the kitchen.', 'Thank you. I got carried away; that part is on me.', 'Eli cancels the dishes still in the kitchen. Your date looks at the plates already here and asks what you would actually like to share.'), effects: { service: 'help' } }, { ...c('joke', 'Call it a tasting menu and let your date choose first', 'The accidental feast became a tasting-menu joke and the date chose a first dish.', { playful: 'A tasting menu. Very elegant. Apparently we’re tasting Thursday through Sunday.', dry: 'Excellent branding. It remains a lot of potatoes.', direct: 'All right. First pick is mine, but nobody has to finish this.' }, 'Your date picks a favourite dish. The game is funny, but there is still more food than the table needs.'), reaction: { playful: 'amused', dry: 'amused', direct: 'amused' } }, { ...c('wait', 'Slide your own plate clear of the incoming feast', 'The player protected their own meal before the table had agreed what to share.', { playful: 'Protective of the risotto. I respect it. I did mean to ask before sharing.', dry: 'Ah. I thought we were sharing. Let’s establish the plate borders.', direct: 'Are you keeping your own meal? That’s fine; I should have asked.' }, 'Your date realises the sharing plan was never actually agreed. There is a small pause before you decide what belongs where.'), reaction: 'surprised', followLabels: { 'share-chosen': 'Choose one dish to share; box the rest', 'keep-own': 'Keep your meal and help with the leftovers' } }],
    endings: [c('share-chosen', 'Choose what to share and box the rest', 'Only the dishes everyone wanted were shared; the extras were boxed.', 'That is a much better plan than pretending this is a challenge.'), c('keep-own', 'Keep your own meal and help arrange leftovers', 'The player kept their own meal while helping sort the date’s leftovers.', 'Of course. You didn’t order my enthusiasm. I’ll take care of these.')],
  },
  {
    id: 'staff-flirt', title: 'A little too much charm',
    setup: 'Your date’s banter with Eli turns noticeably flirty. Eli keeps the exchange professional, but your date looks back to see how it landed with you.',
    opening: { playful: 'Was that charming, or did I just make this table awkward?', dry: 'I may have misjudged the audience for that line.', direct: 'That came out flirtier than I intended. How did it feel from your seat?' },
    follow: 'Eli returns to the order. Your date turns back to hear you.',
    choices: [c('be-clear', 'Ask, “Am I competing with the waiter?”', 'The player asked whether the date’s attention was still at their table.', 'That’s fair. I don’t want you spending dinner wondering whether I’m actually here with you.', 'Your date hears the concern behind the question and turns back to you. Eli has quietly returned to work.'), { ...c('light-joke', 'Grin: “Does that line come with dessert?”', 'The player teased the date about the flirty line instead of involving the waiter.', { playful: 'Only if you promise not to leave a review of it.', dry: 'All right. Point taken. That was a fairly bad line.', direct: 'Fair enough. I was showing off.' }, 'Your date laughs a little too quickly, then asks whether you were actually bothered. There is a chance to be clear instead of trading hints.'), reaction: { playful: 'amused', dry: 'embarrassed', direct: 'embarrassed' } }, c('not-bothered', 'Ask Eli about dessert, then turn back to your date', 'The player let Eli return to the order and redirected attention to the date.', 'Good to know. And yes, I’ll let the poor man do his job.', 'The waiter has gone. Your date asks whether that was comfortable banter or something they should leave out of the evening.')],
    endings: [c('reset', 'Agree on the boundary and return to your evening', 'The date agreed to the flirting boundary and returned their attention to the table.', 'Understood. You don’t have to keep hinting for me to hear it.'), { ...c('not-for-me', 'Say the mismatch matters and end dinner politely', 'The player chose to end a date over a mismatch in flirting boundaries.', 'I understand. Let’s get the check and finish here.'), effects: { earlyExit: true } }],
  },
  {
    id: 'awkward-ex', title: 'A familiar face',
    setup: 'Your date recognizes an ex at a nearby table. There is a brief wave, then a silence neither of you ordered.',
    opening: { playful: 'Unexpected guest appearance. I promise I didn’t book the extended cast.', dry: 'Well. That is an inconvenient coincidence.', direct: 'That’s my ex. We’re civil; I just wasn’t expecting to see them.' },
    follow: 'The ex returns to their dinner. Your date offers a brief explanation, then waits to see whether you want to move on.',
    choices: [c('check-in', 'Ask, “Want a minute, or a fresh subject?”', 'The player offered a choice between a minute of space and a fresh subject.', 'Thanks for asking. I’m okay—just briefly thrown.', 'Your date takes a breath and gives a short explanation. The ex has returned to their own meal; there is no invitation to go over.'), { ...c('make-space', 'Murmur, “Strong entrance from the supporting cast”', 'The player tried an aside about the ex’s unexpected appearance.', { playful: 'I was hoping for a cheaper production tonight.', dry: 'Please don’t give them a starring role.', direct: 'It’s a little weird for me. Give me a minute.' }, 'Your date gives you a look: there is a joke here, but they do not want the ex to become the whole evening.'), reaction: { playful: 'amused', dry: 'embarrassed', direct: 'embarrassed' }, followLabels: { 'leave-there': 'Let the joke go and give them room', 'say-need': 'Say honestly what would help you feel comfortable' } }, c('change-subject', 'Ask your date for their most defensible bad opinion', 'The player changed the subject with an invitation to a harmless disagreement.', 'A new subject sounds good. That table can have its own evening.', 'Your date is distracted for the first answer, then visibly returns to the conversation. They offer one brief explanation before letting the subject go.')],
    endings: [c('leave-there', 'Leave the ex story there', 'The date gave a brief explanation, and the table moved on.', 'I appreciate that. I’d rather get to know you than spend tonight narrating an old relationship.'), c('say-need', 'Say what would help you feel comfortable', 'Both people clarified what they needed after the unexpected encounter.', 'That’s reasonable. I’m glad you told me what you needed.')],
  },
  {
    id: 'family-visit', title: 'Unexpected introductions',
    setup: 'A relative spots your date from across the restaurant and comes over. The introduction starts warmly, then drifts into an embarrassing childhood story.',
    opening: { playful: 'Before the baby-photo archive opens, can I introduce you properly?', dry: 'And there goes my carefully maintained air of mystery.', direct: 'I’m glad to see them, but I didn’t plan a family introduction tonight.' },
    follow: 'Your date catches your eye. The relative is friendly, but they need a cue that this is still your evening.',
    choices: [c('welcome', 'Shake hands and ask for the short version', 'The unexpected relative was welcomed and offered a brief introduction.', 'You handled that well. I promise the family interview wasn’t on the reservation.', 'The relative warms to you immediately and starts another story. Your date smiles, but the glance they give you is a request for an exit.'), c('boundary', 'Say, “You can tell me the rest another time”', 'The player helped close the family visit with a promise of a less rushed introduction another time.', 'Thank you. I like them; I just wanted tonight to be ours.', 'The relative takes the hint and starts saying goodbye. Your date relaxes and offers to explain the family dynamic once you are alone.'), { ...c('follow-lead', 'Ask, “Is the haircut story public knowledge?”', 'The player joined the family’s haircut joke and checked the date’s reaction.', { playful: 'Regrettably, yes. You may hear the short version.', dry: 'It was not, until about ten seconds ago.', direct: 'Let me tell that one myself.' }, 'Your date takes over the story. The joke can stay affectionate if you let them decide where it ends.'), reaction: { playful: 'amused', dry: 'embarrassed', direct: 'defensive' }, followLabels: { 'return-date': 'Thank the relative and let your date close the story', 'laugh-after': 'Save the teasing until your date brings it up again' } }],
    endings: [c('return-date', 'Thank the relative and return to dinner', 'The family visit ended warmly and the date returned to the table.', 'All right. Back to the people who actually had a reservation with me.'), c('laugh-after', 'Wait until you are alone, then share the joke', 'The table waited for privacy before laughing about the awkward introduction.', { playful: 'You may tease me about that one photograph. One.', dry: 'I will neither confirm nor deny the haircut story.', direct: 'That was embarrassing, but I’m glad you were kind about it.' })],
  },
  {
    id: 'unexpected-tic', title: 'Something they choose to share',
    setup: 'Your date has an involuntary vocal tic, then chooses to explain that they have Tourette syndrome. They keep their voice low.',
    opening: 'That was a tic. I have Tourette syndrome. I’m comfortable carrying on.',
    follow: 'Your date says they are comfortable continuing. They will ask if they want a break.',
    choices: [c('acknowledge', 'Acknowledge it and carry on talking', 'Acknowledged the disclosure and kept the conversation going.', 'Thanks. I’m still the person you were talking to a second ago.'), c('ask-adjustment', 'Ask if anything would help', 'Asked whether the date wanted anything adjusted.', 'Nothing right now, thank you. If that changes, I’ll say so.'), c('give-privacy', 'Let them set the pace', 'The date’s disclosure was kept discreet and they set the pace.', 'I appreciate that. I didn’t want an announcement; I just wanted you to know.')],
    endings: [c('continue', 'Carry on talking', 'The date returned to the conversation at their own pace.', { playful: 'Now, where were we before my brain added its own punctuation?', dry: 'Good. We can resume our regularly scheduled opinions.', direct: 'Thank you. I’d rather hear what you were about to say.' }), c('keep-option', 'Leave a break open', 'Agreed the date could ask for a break whenever they wanted one.', 'That works for me. I’ll ask if I want one.')],
  },
  {
    id: 'allergic-reaction', title: 'Dinner can wait',
    setup: 'After a bite, your date develops a serious allergic reaction and reaches for their prescribed emergency medication. Eli is alerted immediately and calls for emergency help. Dinner stops.',
    openingSpeaker: 'waiter', opening: 'Medical help is on the way. We’re clearing this space and staying with them.',
    follow: 'Your date has used their prescribed emergency treatment. Eli makes room for the responders and stays nearby.',
    choices: [c('get-help', 'Help Eli make room for the responders', 'Staff called emergency help and cleared room while the date used their prescribed treatment.', 'Thank you. Please stay close while we wait.'), c('stay-close', 'Stay with your date while staff gets help', 'The player stayed nearby while staff arranged urgent medical help.', 'I’m glad someone is here. We can talk about the dinner another time.')],
    endings: [{ ...c('support-handoff', 'Stay for the medical handoff', 'The dinner ended so the date could receive medical care; staff handled the restaurant arrangements.', 'The evening can wait. Thank you for helping me get care.'), effects: { earlyExit: true, service: 'help' } }, { ...c('contact-person', 'Ask whom they want contacted', 'Asked whom the date wanted contacted while staff arranged medical care.', 'I’ll tell Eli whom to contact. Thank you for asking me.'), effects: { earlyExit: true, service: 'help' } }],
  },
  {
    id: 'too-many-drinks', title: 'A slower evening',
    setup: 'Your date has had more wine than they meant to and is sick at the table. Eli brings a basin and a cloth discreetly; the table gives them space to recover.',
    opening: 'I’ve overdone it. I’m sorry. Could we stop the drinks and slow everything down?',
    follow: 'The drinks are stopped. Eli stays nearby as your date asks for help getting home.',
    choices: [c('get-staff', 'Ask Eli to help quietly', 'Staff helped the unwell date discreetly and the alcoholic drinks stopped.', 'Thank you. I don’t want an audience for this.'), c('no-pressure', 'Agree to stop the drinks', 'The player removed any pressure to drink more or act cheerful.', 'Good. I was trying to keep up instead of listening to myself.')],
    endings: [{ ...c('safe-finish', 'Ask staff to help arrange a safe finish', 'Eli helped arrange a safe finish to the evening, and the alcoholic drinks were stopped.', 'Heading home is the right call. Thank you for not making me pretend I’m fine.'), effects: { earlyExit: true, service: 'help' } }, { ...c('trusted-person', 'Ask whether they want a trusted person contacted', 'Asked whether the date wanted a trusted person contacted; Eli helped arrange a safe finish.', 'Yes, please. I’d appreciate some help sorting that out.'), effects: { earlyExit: true, service: 'help' } }],
  },
  {
    id: 'questioning-attraction', title: 'An honest pause',
    setup: 'Someone elsewhere in the restaurant catches your date’s eye. They choose to say they are still figuring out who they want to date, and are unsure this is a romantic match.',
    opening: 'I’m still working something out about attraction. I shouldn’t pretend I’m sure when I’m not. Please let me choose how much I explain.',
    follow: 'Your date asks you to keep the personal details private. They are happy to finish dinner as friends.',
    choices: [c('respect-privacy', 'Thank them for telling you', 'The date chose to disclose uncertainty about attraction and their privacy was respected.', 'Thank you. I didn’t want to turn this into an explanation I wasn’t ready to give.'), c('clarify', 'Ask what kind of evening they want', 'Asked what kind of evening the date wanted.', 'Friendly company would be good, if that is something you want too.')],
    endings: [{ ...c('friendship', 'Continue the evening as friends', 'Both agreed to spend the rest of the evening as friends.', 'I’d like that. We can let tonight be good company.'), effects: { romanceClosed: true } }, { ...c('kind-goodbye', 'Choose a kind early goodbye', 'The player chose an honest early goodbye after learning the romantic interest was not mutual.', 'I understand. Thank you for being clear and keeping this between us.'), effects: { romanceClosed: true, earlyExit: true } }],
  },
  {
    id: 'unwelcome-comment', title: 'That was out of line',
    setup: 'The nearby diner makes a prejudiced remark about another guest’s background or appearance. Your date hears it and sets down their glass.',
    opening: { playful: 'That was out of line. How do you want to handle it?', dry: 'I would rather not give that comment a free pass.', direct: 'That isn’t acceptable. We can set a boundary without dragging that guest into it.' },
    follow: 'Eli asks what happened. The other guest has kept to their table; your date waits to hear what you would like to do.',
    choices: [c('ask-staff', 'Ask Eli quietly', 'Quietly reported the prejudiced comment to Eli.', 'Yes. The staff can handle their guest, and that person deserves some space.'), c('brief-boundary', 'Set a brief boundary, then call Eli', 'The player challenged the demeaning comment briefly and let staff take over.', 'That was clear. We don’t need to keep arguing with them to mean it.')],
    endings: [c('protect-space', 'Let staff handle it', 'Staff addressed the behaviour and the table gave the targeted guest privacy.', 'I’m glad we didn’t just laugh along. Let’s give everyone a little room now.'), c('move-away', 'Ask to move tables', 'The table asked for distance from the disruptive diner after setting a boundary.', 'That sounds good. We can be firm and still choose a quieter evening.')],
  },
];

export function scenarioSeed(seed: string) { let value = 2166136261; for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; }
export function createRestaurantScenario(seed: string, forced?: RestaurantScenarioId): RestaurantScenarioState {
  const track = (forced && RESTAURANT_SCENARIOS.find(candidate => candidate.id === forced)) || RESTAURANT_SCENARIOS[scenarioSeed(seed) % RESTAURANT_SCENARIOS.length];
  return { id: track.id, title: track.title, description: track.setup, phase: 'dormant', beat: 'setup', choices: track.choices.map(({ id, label }) => ({ id, label })), decisions: [], effects: { romanceClosed: false, earlyExit: false, wineStain: false, service: 'none' } };
}
/** The director may schedule a story before the characters know it happened. */
export function restaurantScenarioContext(state?: RestaurantScenarioState) {
  return state?.phase === 'dormant' ? { phase: 'dormant' as const } : state;
}
function script(line: Line, style: Style) { return typeof line === 'string' ? line : line[style]; }
const utterance = (text: string, emotion: Emotion = 'neutral', speaker: 'date' | 'waiter' = 'date'): SceneUtterance => ({ speaker, text, emotion });
export function activateRestaurantScenario(state: RestaurantScenarioState, at: number, style: Style): SceneUtterance[] {
  if (state.phase !== 'dormant') return [];
  const track = RESTAURANT_SCENARIOS.find(candidate => candidate.id === state.id)!;
  state.phase = 'active'; state.startedAt = at;
  if (state.id === 'wine-spill') state.effects.wineStain = true;
  if (state.id === 'allergic-reaction') state.effects.service = 'help';
  const emotion: Emotion = ['allergic-reaction', 'too-many-drinks', 'oversized-order'].includes(state.id) ? 'surprised' : ['wine-spill', 'feeling-unwell', 'staff-flirt', 'awkward-ex', 'family-visit'].includes(state.id) ? 'embarrassed' : state.id === 'unwelcome-comment' ? 'annoyed' : 'neutral';
  return [utterance(script(track.opening, style), emotion, track.openingSpeaker)];
}
export interface ScenarioChoiceResult { utterances: SceneUtterance[]; completed: boolean; fact: string }
export function chooseRestaurantScenario(state: RestaurantScenarioState, choiceId: string, by: string, at: number, style: Style): ScenarioChoiceResult {
  if (state.phase !== 'active') throw new Error('That table moment is no longer active.');
  const track = RESTAURANT_SCENARIOS.find(candidate => candidate.id === state.id)!;
  const options = state.beat === 'setup' ? track.choices : track.endings;
  const choice = options.find(candidate => candidate.id === choiceId);
  if (!choice || !state.choices.some(candidate => candidate.id === choiceId)) throw new Error('Choose one of the available responses.');
  state.decisions.push({ id: choice.id, label: state.choices.find(option => option.id === choice.id)!.label, by });
  Object.assign(state.effects, choice.effects);
  if (state.beat === 'setup') {
    state.beat = 'follow-through'; state.description = choice.follow ?? track.follow;
    state.choices = track.endings.map(({ id, label }) => ({ id, label: choice.followLabels?.[id] ?? label }));
    if (state.id === 'feeling-unwell' || state.id === 'too-many-drinks') state.effects.service = 'water';
    if (state.id === 'questioning-attraction') state.effects.romanceClosed = true;
    const emotion = typeof choice.reaction === 'string' ? choice.reaction : choice.reaction?.[style] ?? 'neutral';
    return { utterances: [utterance(script(choice.line, style), emotion)], completed: false, fact: choice.fact };
  }
  const ending = choice as Ending;
  Object.assign(state.effects, ending.effects);
  if (state.id === 'wine-spill') state.effects.wineStain = false;
  state.phase = 'resolved'; state.resolvedAt = at; state.resolution = [track.choices.find(first => first.id === state.decisions[0]?.id)?.fact, choice.fact].filter(Boolean).join(' '); state.choices = [];
  return { utterances: [utterance(script(choice.line, style), ['allergic-reaction', 'too-many-drinks'].includes(state.id) ? 'neutral' : 'warm')], completed: true, fact: choice.fact };
}
