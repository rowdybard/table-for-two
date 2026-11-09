import { MENU } from './content';
import { DESSERTS } from './evening';
import { getStoryCue, type CharacterStory, type StoryCueContext } from './story';
import type { DateId, Emotion, SceneUtterance } from './types';

export interface BlindDateIdentity {
  version: 1;
  seed: string;
  dateId: DateId;
  traits: { sociability: number; openness: number; competitiveness: number; directness: number; spontaneity: number };
  personality: string;
  preferences: string;
  boundaries: string;
  opening: string;
  biography: CharacterStory;
}
function generator(seed: string) {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619) >>> 0;
  return () => { value = value + 0x6D2B79F5 | 0; let next = Math.imul(value ^ value >>> 15, 1 | value); next = next + Math.imul(next ^ next >>> 7, 61 | next) ^ next; return ((next ^ next >>> 14) >>> 0) / 4294967296; };
}
const jobs = [
  ['sound technician at a small music venue', 'setting up a listening night for local bands', 'keeps a notebook of songs that sound better live'],
  ['ceramicist who also teaches evening classes', 'making a small collection of deliberately imperfect cups', 'has clay on at least one sleeve most days'],
  ['urban gardener maintaining community plots', 'building a rooftop herb garden with a neighbor', 'trades spare seedlings rather than selling them'],
  ['costume maker for a neighborhood theater', 'designing one original outfit without a director giving notes', 'can mend a loose button faster than they can choose a film'],
  ['aquarium technician', 'learning to film the tide pools on weekend trips', 'knows which fish at work always steals the food'],
  ['radio producer for the early morning shift', 'pitching a show about the strange jobs people do', 'has a complicated relationship with the alarm clock'],
  ['architectural model maker', 'making a tiny replica of their childhood street', 'keeps offcuts because a useful piece always turns up later'],
  ['repairer of vintage record players', 'hosting a bring-your-worst-record listening party', 'likes the repair bench more than the shop paperwork'],
  ['museum education coordinator', 'planning a late-night event without a single formal lecture', 'has an excellent story about a disastrous school visit'],
  ['community swimming instructor', 'finishing an open-water relay with friends', 'packs snacks for everyone and forgets their own towel'],
  ['train dispatcher', 'taking an unplanned holiday where someone else chooses the route', 'notices how people behave when plans change'],
  ['bakery delivery coordinator', 'learning one difficult pastry without help from the bakers', 'has strong opinions about which streets smell best in the morning'],
] as const;
const hobbies = ['badminton in the park', 'collecting obscure dance-pop singles', 'night walks with a cheap film camera', 'pub quizzes with a very unserious team', 'learning bass guitar', 'old science-fiction movies', 'weekend birdwatching', 'improvised cooking with leftovers', 'social dance classes', 'small independent comics', 'indoor climbing', 'finding the best breakfast after a late night'];
const histories = ['moved across the city last spring and is still finding a favorite local place', 'recently stopped taking extra shifts and is learning how to have an evening off', 'shares a flat with an old friend whose taste in music is completely different', 'grew up in a quiet coastal town and still misses the last bus arriving on time', 'has stayed close with a small group of friends since a disastrous first job', 'spent a year living with a sibling and finally has a place of their own'];
const humor = ['dry observations, said flatly, never explained', 'mild exaggeration about their own habits, never about the human', 'a quick comment on something that just happened, then moving on', 'playful teasing about something the human just said, stopping when it is not welcome', 'a short true story with an understated ending', 'warm, self-aware jokes about their own mistakes'];
/** How a blind date sounds, derived from the seeded traits so the three rigs do not all read as one narrator. */
const RHYTHM = {
  bursts: 'Quick, warm bursts: short sentences, “okay”, “oh”, “wait”, a laugh at yourself. Say what you feel straight away and tell small stories in two or three plain sentences.',
  measured: 'Quiet and measured: short, exact sentences of four to eight words (“Mm.” “Fair.” “Not really.”). Dry understatement, one clause, never explained. Short plain questions.',
  punchy: 'Fast and loose: opinions in short bursts (“Honestly?” “Look,” “No, but”), concrete nouns and numbers. Tease only about what they just said, then soften it.',
  easy: 'Easygoing and plain: ordinary words, medium sentences, friendly “yeah” and “right”. Alternate a small story with listening.',
} as const;
const values = ['people following through on small promises', 'curiosity without trying to impress anyone', 'being able to disagree without making it personal', 'kindness that does not need an audience', 'making room for friends as well as romance', 'someone who can own a mistake without a speech'];
const dislikes = ['someone choosing their order without asking', 'being pushed to share a personal story after declining', 'put-downs presented as flirting', 'turning every quiet moment into a test', 'being photographed or recorded without permission', 'being pressured to drink or prove they are fun'];
const flirt = ['flirts through a small challenge and a grin, but does not need to win', 'shows interest by remembering a specific detail rather than giving constant compliments', 'is happy to make the first move when the interest feels mutual', 'takes a little time to warm up and becomes more direct once comfortable', 'enjoys a bold joke, then makes room for an honest answer', 'prefers relaxed company to a polished performance'];

/** Seeded combinations create new personalities; the appearance is a separate reusable asset. */
export function createBlindDate(seed: string): BlindDateIdentity {
  const random = generator(seed), pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const dateId = pick<DateId>(['mira', 'jules', 'dev']);
  const traits = { sociability: Math.floor(random() * 101), openness: Math.floor(random() * 101), competitiveness: Math.floor(random() * 101), directness: Math.floor(random() * 101), spontaneity: Math.floor(random() * 101) };
  const [occupation, ambition, dailyDetail] = pick(jobs), hobby = pick(hobbies), history = pick(histories), voiceHabits = pick(humor), value = pick(values), dislike = pick(dislikes), flirting = pick(flirt);
  const preferredMain = pick(MENU), preferredDessert = pick(DESSERTS).id;
  const sociability = traits.sociability > 65 ? 'Talkative and quick to offer a concrete story, while leaving room for the other person.' : traits.sociability < 35 ? 'Comfortable with pauses; offers short, observant answers and warms up gradually.' : 'Easy company in a small group; alternates a story with listening.';
  const directness = traits.directness > 65 ? 'States likes and disagreements plainly without being cruel.' : traits.directness < 35 ? 'Usually tests an opinion with a gentle joke before saying what they really mean.' : 'Can be tactful without pretending to agree.';
  const competition = traits.competitiveness > 65 ? 'Enjoys a bit of friendly competition and can laugh about losing.' : traits.competitiveness < 35 ? 'Prefers doing something together over keeping score.' : 'Gets unexpectedly invested in a small wager, then lets it go.';
  const spontaneity = traits.spontaneity > 65 ? 'Often suggests trying something new before having a complete plan.' : traits.spontaneity < 35 ? 'Likes knowing the plan but can adapt when someone explains a change.' : 'Likes one new thing alongside something familiar.';
  const openness = traits.openness > 65 ? 'Willing to change an opinion when an interesting detail challenges it.' : traits.openness < 35 ? 'Has established favorites and does not pretend every new thing is better.' : 'Enjoys hearing a different taste without adopting it automatically.';
  const personality = `${sociability} ${directness} Humor: ${voiceHabits}. ${flirting}. ${competition} ${spontaneity} ${openness} Has their own opinions and may choose friendship, another date, or a courteous goodbye.`;
  const preferences = `Enjoys ${preferredMain.toLowerCase()}, ${hobby}, and ${value}. Dislikes ${dislike}. Food preferences are tastes, not allergies or medical conditions.`;
  const boundaries = `Will push back on ${dislike}. Other people choose their own food, drink, disclosures and physical contact. Repeated explicit pressure can make them leave. Kindness, winning an argument and paying for dinner never purchase affection.`;
  const opening = traits.sociability > 65 ? `There you are. I promised myself I’d leave work stories at the door. I’m giving that promise about five minutes.` : traits.directness > 65 ? `Hi. I’m glad you came. I vote we skip the impressive introductions and find out whether we actually enjoy dinner together.` : traits.sociability < 35 ? `Hi. This is a good table. Somewhere I can hear you without pretending I caught the last sentence.` : `Hi. I had a whole clever introduction on the way here. Apparently I’ve decided to start with “hi.”`;
  const biography: CharacterStory = {
    occupation,
    backstory: `Works as a ${occupation}; ${history}. Has a real but unfinished personal goal: ${ambition}. This is not the biography associated with the reused visual character.`,
    everydayLife: `${dailyDetail}. Makes time for ${hobby}. Their current goal is ${ambition}; it is a work in progress, not an achievement already completed.`,
    voiceHabits: `${traits.sociability > 65 ? RHYTHM.bursts : traits.sociability < 35 ? RHYTHM.measured : traits.directness > 65 ? RHYTHM.punchy : RHYTHM.easy} Humor: ${voiceHabits}. Avoid excessive praise, stock pet names, repeated metaphors and therapy language.`,
    preferences, preferredMain, preferredDessert,
    vulnerability: `Can put off ${ambition} because talking about it makes an unfinished idea feel exposed. Values ${value}; this is a specific preference, not a demand that a date prove their worth.`,
    dinnerArc: `Start with the actual restaurant and the human's conversation. A good moment might lead to a story about ${hobby} or work as a ${occupation}. Reveal the unfinished goal gradually when comfortable. React to the shared physical events. The ending depends on the evening, not on reaching a predetermined romantic result.`,
    disclosureRules: `Do not use the preset visual character's family, job, private project or backstory. Do not invent bereavement, allergies, medical diagnoses or trauma. The unfinished goal is ${ambition}. Reveal it in pieces when welcome; decline intrusive questions. A drawing's subject is unknown. Money does not buy intimacy.`,
  };
  return { version: 1, seed, dateId, traits, personality, preferences, boundaries, opening, biography };
}

/** Scripted physical moments must stay consistent with the randomized life too. */
export function getBlindDateCue(identity: BlindDateIdentity, key: string, context: StoryCueContext = {}): SceneUtterance[] {
  const active = identity.traits.sociability > 65, dry = identity.traits.sociability < 35;
  const lines: Record<string, [string, Emotion?]> = {
    welcome: [identity.opening, 'warm'],
    seated: [dry ? 'Better. Now we can actually hear each other.' : 'Good table, good company. Let’s see what happens.', 'warm'],
    ordered: [`I’m having the ${identity.biography.preferredMain.toLowerCase()}. That was the easiest decision I made today.`, 'amused'],
    'main-served': ['That smells good. I’m ready to stop looking at the menu and start eating.', 'warm'],
    taste: [dry ? 'Mm. Good choice.' : 'Okay, that was worth waiting for.', 'warm'],
    'main-finished': ['I needed an evening away from work. I’m glad this one actually happened.', 'warm'],
    'quiet-window': [dry ? 'This is nice. We don’t have to fill every second.' : 'A little quieter here. I like this part of the evening.', 'warm'],
    'beat-waiting-1': ['I promised myself I’d leave work at the door, so here’s a question instead: what’s the last thing you did just because you wanted to?', 'warm'],
    'beat-waiting-2': [dry ? 'I’m happy with a quiet minute. I’d still like to know what you were thinking just now.' : 'Okay, I’ll break the silence first. What were you thinking about just now?', 'warm'],
    'beat-eating-1': ['This is good. I was ready to be polite about it. What’s the meal you’d defend to anyone?', 'amused'],
    'beat-eating-2': ['You’ve gone quiet in a thinking way, not a bored way. I hope. Tell me.', 'warm'],
    'beat-after-1': ['I like an evening where nobody’s performing. This one has mostly been that.', 'warm'],
    'beat-after-2': ['Small question, honest answer: is this the kind of night you’d do again?', 'warm'],
    'dessert-date-choice': [`If you’re happy to share, I’d pick the ${DESSERTS.find(item => item.id === identity.biography.preferredDessert)?.name.toLowerCase() ?? 'dessert'}. I’ll ask Eli.`, 'warm'],
    'dessert-ordered': ['Something to share sounds good. I can find a little room.', 'warm'],
    'dessert-served': ['That looks good. Two spoons. I like a dessert that assumes company.', 'warm'],
    'dessert-shared': [['guarded', 'hurt', 'leaving'].includes(context.resolution ?? '') ? 'Thanks for sharing. I’m still a little quiet after earlier.' : 'I don’t usually say this on a first date, but there’s something I keep putting off that I actually care about. Tonight makes it feel less heavy.', 'warm'],
    'dessert-skipped': [['guarded', 'hurt', 'leaving'].includes(context.resolution ?? '') ? 'I’ll skip dessert. We can ask for the bill when you’re ready.' : 'Fair enough. I’m happy taking our time with the rest of the evening.', 'neutral'],
    'bill-requested': ['I think that’s us. Let’s get this settled.', 'neutral'],
    'bill-settled': ['Thanks. I’m glad we sorted that out without making it strange.', 'warm'],
    'farewell-invite': ['Shall we walk to the door together?', 'warm'],
    'wrong-order': ['I don’t think this is what we ordered. Let’s check the ticket.', 'surprised'],
    'wrong-order-returned': ['Thanks for sorting that out. No need to make anyone feel worse about a wrong plate.', 'warm'],
    'wrong-order-kept': ['An unexpected dinner. All right, let’s give it a chance.', 'amused'],
    spill: ['Oh! Are you okay? Here, have this napkin.', 'surprised'],
    'spill-help': ['Thanks. I’ll hold this while you dry that bit.', 'warm'],
    'spill-wiped': ['That looks better. Can we set the glass upright now?', 'warm'],
    'spill-fixed': ['There. We survived a small table catastrophe.', 'amused'],
    diner: ['That phone call is getting a little hard to ignore.', 'annoyed'],
    'diner-quiet': ['Thank you. I’d much rather hear you than their whole conversation.', 'warm'],
    'diner-ignored': ['All right. Let’s leave them to it and come back to our evening.', 'neutral'],
    repair: ['Thank you for hearing me. We can try again from here.', 'warm'],
    'boundary-warning': ['I meant what I said. Please don’t keep pushing that.', 'annoyed'],
    'date-leaving': ['I’m going to leave now. Please respect that.', 'defensive'],
    'ending-another-evening': [active ? 'I had a good time. I’d like another evening with you, if you would too.' : 'I’d like to see you again. Tonight was good company.', 'warm'],
    'ending-new-friend': ['I enjoyed your company. I’d be happy to keep in touch as friends.', 'warm'],
    'ending-second-chance': ['We had an awkward moment, but I appreciated how you handled it afterward. I’d be open to trying again.', 'warm'],
    'ending-quiet-goodbye': ['Thank you for dinner. I don’t think I’m looking for another date, but I wish you well.', 'neutral'],
    'ending-early-exit': ['All right. Thanks for letting me know. Take care getting home.', 'neutral'],
    'ending-walked-away': ['I asked you to stop, and you kept pushing. I’m leaving. Take care.', 'defensive'],
  };
  const cast = getStoryCue(key, identity.dateId, context).filter(line => line.speaker !== 'date');
  const chosen = lines[key];
  if (!chosen) return cast;
  const dateLine: SceneUtterance = { speaker: 'date', text: chosen[0], emotion: chosen[1] ?? 'neutral' };
  // Eli leads the course changes for blind dates too.
  return ['main-finished', 'bill-requested'].includes(key) ? [...cast, dateLine] : [dateLine, ...cast];
}
