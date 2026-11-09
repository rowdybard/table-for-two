import { MENU } from './content';
import { DESSERTS } from './evening';
import { getStoryCue, groundedEndingCue, guardedLine, isGuardedStance, spokenDessert, spokenDish, type CharacterStory, type StoryCueContext } from './story';
import type { DateId, Emotion, SceneUtterance } from './types';
import type { ConversationSeed } from './conversation-content';

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
  /** Private conversational material selected independently of the reused visual rig. */
  conversationSeeds: readonly ConversationSeed[];
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
const conversationSeed = (id: string, kind: ConversationSeed['kind'], text: string, topics: readonly string[], retellKeys: readonly string[], personal = false): ConversationSeed => ({ id: `blind-${id}`, kind, text, topics, retellKeys, ...(personal ? { personal } : {}) });

/** Three authored pieces for each existing job/ambition tuple, in exactly the same order as jobs. */
export const BLIND_CONVERSATION_SEEDS: readonly (readonly ConversationSeed[])[] = [
  [
    conversationSeed('sound-cable', 'anecdote', 'At a sound check, they spent ten minutes hunting a hum before discovering a singer had plugged a tiny desk fan into the guitar amp. The fan stayed; the hum did not.', ['work', 'music', 'bands', 'sound'], ['desk fan in the guitar amp', 'hunting the hum']),
    conversationSeed('sound-room', 'opinion', 'They would choose a small room where people actually listen over a huge show filmed through a wall of phones. An imperfect live version can be the one worth keeping.', ['music', 'concerts', 'phones', 'live'], ['small room where people listen', 'wall of phones']),
    conversationSeed('sound-listening-night', 'desire', 'They want their local-band listening night to include one song each musician is almost embarrassed to love. The event has no booked date yet; they are still working out who to ask.', ['music', 'bands', 'plans', 'ambition'], ['embarrassed to love one song', 'local-band listening night'], true),
  ],
  [
    conversationSeed('clay-wobbly-cup', 'anecdote', 'A student apologized for a lopsided cup, then came back a week later carrying it full of tea. They now use that cup as the example of a successful class.', ['work', 'teaching', 'pottery', 'cups'], ['lopsided cup full of tea', 'successful class']),
    conversationSeed('clay-neat-shelves', 'contradiction', 'They defend crooked handmade cups and then line every tool up square with the shelf edge. They know exactly how that sounds.', ['pottery', 'habits', 'perfection', 'work'], ['crooked cups and straight tools', 'square with the shelf edge']),
    conversationSeed('clay-imperfect-collection', 'desire', 'They are trying to make a small collection of imperfect cups that feel good in the hand. They keep smoothing away the very irregularities they meant to leave; the collection is unfinished.', ['pottery', 'cups', 'making', 'ambition'], ['smoothing away the irregularities', 'imperfect cup collection'], true),
  ],
  [
    conversationSeed('garden-mystery-seedlings', 'anecdote', 'A tray at the community plot lost its labels. Everyone adopted a mystery seedling, and one proud tomato owner spent weeks raising a very healthy marigold.', ['garden', 'plants', 'neighbors', 'work'], ['tomato was a marigold', 'mystery seedlings']),
    conversationSeed('garden-window-herbs', 'opinion', 'They think a pot of herbs someone actually uses is more impressive than a spotless garden nobody touches. A plant is allowed to look as though dinner happened.', ['garden', 'food', 'herbs', 'cooking'], ['a plant dinner happened to', 'herbs someone actually uses']),
    conversationSeed('garden-rooftop', 'desire', 'They want the rooftop herb garden with their neighbor to have enough room for two chairs, not just more planters. It is still a plan; agreeing what to grow has been easier than making space to sit.', ['garden', 'neighbors', 'home', 'ambition'], ['two chairs on the rooftop', 'more planters than seats'], true),
  ],
  [
    conversationSeed('costume-backward-cape', 'anecdote', 'An actor put a cape on backward and insisted it was a bold character choice. They moved the fastening before the next show and let the actor keep the explanation.', ['work', 'theater', 'clothes', 'mistakes'], ['backward cape', 'bold character choice']),
    conversationSeed('costume-movie-choice', 'contradiction', 'They can rescue a torn costume with minutes to spare, but choosing a film at home can take longer than the repair. A real deadline makes them remarkably decisive.', ['clothes', 'movies', 'decisions', 'work'], ['film takes longer than a repair', 'decisive with a deadline']),
    conversationSeed('costume-own-outfit', 'desire', 'They want to design one outfit without a director giving notes. They have sketches, but keep inventing an imaginary director who wants another revision.', ['clothes', 'theater', 'design', 'ambition'], ['imaginary director giving notes', 'one outfit of their own'], true),
  ],
  [
    conversationSeed('aquarium-food-thief', 'anecdote', 'The fish that steals everyone else\'s food once ignored a perfectly placed serving until a smaller fish approached it. Apparently it tastes better when somebody else wanted it.', ['work', 'fish', 'animals', 'food'], ['fish food tastes better stolen', 'smaller fish approached']),
    conversationSeed('aquarium-patient-looking', 'opinion', 'They like watching one ordinary creature for a few minutes more than rushing past a hundred impressive ones. Most of the good bits happen after people stop posing for a photo.', ['animals', 'aquarium', 'photos', 'patience'], ['one ordinary creature', 'after people stop posing']),
    conversationSeed('aquarium-tide-film', 'desire', 'They are learning to film tide pools on weekend trips. Their favorite attempt is mostly a crab refusing to emerge; they want to get better without making the animals perform.', ['animals', 'sea', 'film', 'ambition'], ['crab refusing to emerge', 'tide-pool film'], true),
  ],
  [
    conversationSeed('radio-silent-kettle', 'anecdote', 'They once recorded a beautiful interview and a much louder office kettle. The guest cheerfully offered to re-create their most heartfelt answer after the tea was made.', ['work', 'radio', 'interviews', 'tea'], ['office kettle interview', 'heartfelt answer after tea']),
    conversationSeed('radio-alarm', 'contradiction', 'They make calm, organized radio before most people wake up, then negotiate with an alarm clock as if it were an unreasonable coworker.', ['work', 'mornings', 'sleep', 'habits'], ['alarm clock coworker', 'calm radio before sunrise']),
    conversationSeed('radio-strange-jobs', 'desire', 'They want to pitch a show about strange jobs, with workers explaining one thing outsiders always get wrong. They have a list of possible guests, not an approved show.', ['work', 'radio', 'people', 'ambition'], ['one thing outsiders get wrong', 'strange-jobs show'], true),
  ],
  [
    conversationSeed('model-tiny-bench', 'anecdote', 'A client inspected an architectural model and moved a tiny bench so the miniature residents could have a nicer view. They left it there and adjusted the drawing.', ['work', 'buildings', 'design', 'details'], ['miniature residents nicer view', 'tiny bench moved']),
    conversationSeed('model-useful-offcuts', 'contradiction', 'They dislike clutter but keep a box of model-making offcuts because each one could become the exact piece they need. They will admit the box is beginning to need its own room.', ['home', 'habits', 'making', 'clutter'], ['offcut box needs its own room', 'the exact piece they need']),
    conversationSeed('model-childhood-street', 'desire', 'They are making a tiny replica of their childhood street. They keep wanting to include the crooked fence as they remember it, rather than straighten it to make the model look better.', ['home', 'childhood', 'making', 'ambition'], ['crooked childhood fence', 'tiny childhood street'], true),
  ],
  [
    conversationSeed('records-biscuit', 'anecdote', 'A record player arrived with a note saying it sounded crunchy. There was a small biscuit under the platter. The owner said they were relieved the description had been accurate.', ['work', 'music', 'records', 'repairs'], ['biscuit under the platter', 'record player sounded crunchy']),
    conversationSeed('records-bad-pop', 'opinion', 'They do not believe a record needs to be rare or tasteful to deserve playing. A ridiculous chorus that gets everyone singing has done its job.', ['music', 'pop', 'records', 'taste'], ['ridiculous chorus did its job', 'rare is not the point']),
    conversationSeed('records-worst-party', 'desire', 'They want to host a bring-your-worst-record party where every guest gets one uninterrupted song. They have not hosted it yet, partly because they keep changing their own nomination.', ['music', 'friends', 'parties', 'ambition'], ['one uninterrupted terrible song', 'worst-record party'], true),
  ],
  [
    conversationSeed('museum-dinosaur-map', 'anecdote', 'During a school visit, a child demanded to know where the museum kept its live dinosaurs. They made a map of the exhibits together, with an extremely clear distinction between alive and enormous.', ['work', 'museum', 'teaching', 'dinosaurs'], ['live dinosaur map', 'alive and enormous']),
    conversationSeed('museum-no-exam', 'opinion', 'They think a museum visit should leave someone with one thing they want to tell a friend, not the feeling they have failed an exam.', ['museum', 'learning', 'art', 'school'], ['museum is not an exam', 'one thing to tell a friend']),
    conversationSeed('museum-no-lecture', 'desire', 'They are planning a late-night museum event without a formal lecture. They want people to choose an object and argue about it over a drink, and are still figuring out how to persuade the committee.', ['museum', 'art', 'plans', 'ambition'], ['argue over one object', 'museum night without lectures'], true),
  ],
  [
    conversationSeed('swim-forgotten-towel', 'anecdote', 'They packed snacks for everyone after a swimming session, then realized their own towel was still at home. The snacks were excellent; drying off was less well organized.', ['work', 'swimming', 'friends', 'food'], ['snacks but no towel', 'drying off less organized']),
    conversationSeed('swim-last-place', 'contradiction', 'They tell nervous swimmers that getting in counts as a win, then become surprisingly competitive about catching the next buoy themselves.', ['swimming', 'competition', 'learning', 'habits'], ['getting in counts as a win', 'competitive about the next buoy']),
    conversationSeed('swim-relay', 'desire', 'They want to finish an open-water relay with friends without quietly doing all the organizing. The relay is still ahead of them; asking someone else to handle transport is the next small step.', ['swimming', 'friends', 'plans', 'ambition'], ['relay without organizing everything', 'someone else handles transport'], true),
  ],
  [
    conversationSeed('trains-platform-soup', 'anecdote', 'A traveler once thanked them for fixing a delay they had not fixed, because the extra wait had allowed time for a very good bowl of soup. They accepted credit for the soup alone.', ['work', 'trains', 'travel', 'food'], ['accepted credit for the soup', 'delay bowl of soup']),
    conversationSeed('trains-off-duty', 'contradiction', 'They want an unplanned holiday but instinctively check the last train before agreeing to anything. Being off duty apparently requires some preparation.', ['travel', 'plans', 'work', 'habits'], ['off duty requires preparation', 'checking the last train']),
    conversationSeed('trains-surprise-route', 'desire', 'They want to take a holiday where someone else chooses the route. They are practicing by agreeing not to inspect the plan in advance, rather than secretly dispatching the whole trip.', ['travel', 'trust', 'holidays', 'ambition'], ['secretly dispatching the holiday', 'someone else chooses the route'], true),
  ],
  [
    conversationSeed('bakery-warm-van', 'anecdote', 'A delivery route once left them smelling so strongly of warm bread that a stranger followed them off the bus to ask where breakfast was happening. They gave directions, not a free loaf.', ['work', 'bread', 'mornings', 'food'], ['followed the bread smell off the bus', 'directions not a free loaf']),
    conversationSeed('bakery-city-smells', 'opinion', 'They rank streets by how they smell before breakfast. A longer walk past a bakery beats a shortcut beside the bins, and they will defend those extra minutes.', ['city', 'walks', 'breakfast', 'food'], ['rank streets by breakfast smell', 'shortcut beside the bins']),
    conversationSeed('bakery-own-pastry', 'desire', 'They are trying to learn one difficult pastry without asking the bakers to rescue it. The current result tastes better than it looks; they want to serve a version they finished themselves.', ['baking', 'food', 'learning', 'ambition'], ['pastry without a rescue', 'tastes better than it looks'], true),
  ],
];

export const BLIND_VULNERABILITY_MOTIVES = [
  'Keeps enlarging the plan for {ambition}; choosing a first version would mean leaving other good ideas out.',
  'Worries that asking for help with {ambition} will turn a personal project into something everyone else gets to direct.',
  'Wants {ambition} to stay enjoyable, and resists turning every interest into a second job or something to sell.',
  'Finds it easier to meet somebody else\'s deadline than to protect time for {ambition}; an evening of their own still feels negotiable.',
  'Keeps asking for opinions about {ambition}, then loses track of which decision was theirs in the first place.',
  'Is used to being competent at work and finds being a beginner at {ambition} unexpectedly embarrassing.',
  'Can make a convincing plan for {ambition} over and over; starting the dull first task is the part they avoid.',
  'Would rather keep {ambition} small and personal than accept an impressive opportunity that changes why they wanted it.',
  'Compares the rough work for {ambition} with other people\'s finished results, and forgets they are seeing different stages.',
  'Wants someone to be pleased about {ambition} without immediately suggesting fixes; advice can make them stop sharing it.',
  'Worries about whether {ambition} will still matter after the first exciting week, and is trying to trust small regular effort.',
  'Can joke about {ambition} so quickly that people miss how much it actually matters; saying one plain sentence about it feels harder.',
] as const;

/** Three openings per existing rhythm: sociable, direct, quiet, and easygoing. */
export const BLIND_OPENING_TEMPLATES = [
  'There you are. I promised myself I’d leave work stories at the door. I’m giving that promise about five minutes.',
  'Hi! I was early, so I’ve already changed my mind about dinner twice. Very decisive first impression.',
  'Hi. I nearly rehearsed an introduction. Then I remembered you’d be allowed to answer, and the plan fell apart.',
  'Hi. I’m glad you came. I vote we skip the impressive introductions and find out whether we actually enjoy dinner together.',
  'Hi. Honest question: are we doing the polished first-date version of ourselves, or can I start with the ordinary one?',
  'Hi. I’m glad we’re doing this. I’d rather have one good conversation than spend dinner trying to sound impressive.',
  'Hi. This is a good table. Somewhere I can hear you without pretending I caught the last sentence.',
  'Hi. I’m glad you’re here. I’m better at a conversation than an entrance.',
  'Hi. I haven’t prepared anything clever. That saves us both a little time.',
  'Hi. I had a whole clever introduction on the way here. Apparently I’ve decided to start with “hi.”',
  'Hi. Good to meet you. Getting here was the organized part; I’m happy to see how dinner goes.',
  'Hi. I’m glad I came out tonight. I was about to give the sofa a very convincing argument.',
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
  const job = pick(jobs);
  const [occupation, ambition, dailyDetail] = job, hobby = pick(hobbies), history = pick(histories), voiceHabits = pick(humor), value = pick(values), dislike = pick(dislikes), flirting = pick(flirt);
  const preferredMain = pick(MENU), preferredDessert = pick(DESSERTS).id;
  // New choices follow every legacy draw: existing seeds keep their appearance,
  // traits, job, history, tastes and voice rather than shifting the old stream.
  const vulnerabilityMotive = pick(BLIND_VULNERABILITY_MOTIVES).replace('{ambition}', ambition);
  const openingBank = traits.sociability > 65 ? 0 : traits.directness > 65 ? 3 : traits.sociability < 35 ? 6 : 9;
  const opening = pick(BLIND_OPENING_TEMPLATES.slice(openingBank, openingBank + 3));
  const conversationSeeds = BLIND_CONVERSATION_SEEDS[jobs.indexOf(job)]!;
  const sociability = traits.sociability > 65 ? 'Talkative and quick to offer a concrete story, while leaving room for the other person.' : traits.sociability < 35 ? 'Comfortable with pauses; offers short, observant answers and warms up gradually.' : 'Easy company in a small group; alternates a story with listening.';
  const directness = traits.directness > 65 ? 'States likes and disagreements plainly without being cruel.' : traits.directness < 35 ? 'Usually tests an opinion with a gentle joke before saying what they really mean.' : 'Can be tactful without pretending to agree.';
  const competition = traits.competitiveness > 65 ? 'Enjoys a bit of friendly competition and can laugh about losing.' : traits.competitiveness < 35 ? 'Prefers doing something together over keeping score.' : 'Gets unexpectedly invested in a small wager, then lets it go.';
  const spontaneity = traits.spontaneity > 65 ? 'Often suggests trying something new before having a complete plan.' : traits.spontaneity < 35 ? 'Likes knowing the plan but can adapt when someone explains a change.' : 'Likes one new thing alongside something familiar.';
  const openness = traits.openness > 65 ? 'Willing to change an opinion when an interesting detail challenges it.' : traits.openness < 35 ? 'Has established favorites and does not pretend every new thing is better.' : 'Enjoys hearing a different taste without adopting it automatically.';
  const personality = `${sociability} ${directness} Humor: ${voiceHabits}. ${flirting}. ${competition} ${spontaneity} ${openness} Has their own opinions and may choose friendship, another date, or a courteous goodbye.`;
  const preferences = `Enjoys ${preferredMain.toLowerCase()}, ${hobby}, and ${value}. Dislikes ${dislike}. Food preferences are tastes, not allergies or medical conditions.`;
  const boundaries = `Will push back on ${dislike}. Other people choose their own food, drink, disclosures and physical contact. Repeated explicit pressure can make them leave. Kindness, winning an argument and paying for dinner never purchase affection.`;
  const biography: CharacterStory = {
    occupation,
    backstory: `Works as a ${occupation}; ${history}. Has a real but unfinished personal goal: ${ambition}. This is not the biography associated with the reused visual character.`,
    everydayLife: `${dailyDetail}. Makes time for ${hobby}. Their current goal is ${ambition}; it is a work in progress, not an achievement already completed.`,
    voiceHabits: `${traits.sociability > 65 ? RHYTHM.bursts : traits.sociability < 35 ? RHYTHM.measured : traits.directness > 65 ? RHYTHM.punchy : RHYTHM.easy} Humor: ${voiceHabits}. Avoid excessive praise, stock pet names, repeated metaphors and therapy language.`,
    preferences, preferredMain, preferredDessert,
    vulnerability: `${vulnerabilityMotive} Values ${value}; this is a specific preference, not a demand that a date prove their worth.`,
    dinnerArc: `Start with the actual restaurant and the human's conversation. A good moment might lead to a story about ${hobby} or work as a ${occupation}. Reveal the unfinished goal gradually when comfortable. React to the shared physical events. The ending depends on the evening, not on reaching a predetermined romantic result.`,
    disclosureRules: `Do not use the preset visual character's family, job, private project or backstory. Do not invent bereavement, allergies, medical diagnoses or trauma. The unfinished goal is ${ambition}. Reveal it in pieces when welcome; decline intrusive questions. A drawing's subject is unknown. Money does not buy intimacy.`,
  };
  return { version: 1, seed, dateId, traits, personality, preferences, boundaries, opening, biography, conversationSeeds };
}

/** Blind-date wording for a hurt or guarded date; other keys borrow the preset's plain lines, which carry no preset biography. */
const BLIND_GUARDED: Record<string, string> = {
  'dessert-shared': 'Thanks for sharing. I’m still a little quiet after earlier.',
  'dessert-skipped': 'I’ll skip dessert. We can ask for the bill when you’re ready.',
};

/** Scripted physical moments must stay consistent with the randomized life too. */
export function getBlindDateCue(identity: BlindDateIdentity, key: string, context: StoryCueContext = {}): SceneUtterance[] {
  const active = identity.traits.sociability > 65, dry = identity.traits.sociability < 35;
  const dish = identity.biography.preferredMain.toLowerCase(), dessertName = DESSERTS.find(item => item.id === identity.biography.preferredDessert)?.name.toLowerCase() ?? 'dessert';
  const lines: Record<string, [string, Emotion?]> = {
    welcome: [identity.opening, 'warm'],
    seated: [dry ? 'Good, we can actually hear each other here.' : 'Good table, good company. Let’s see what happens.', 'warm'],
    ordered: [context.humanDish && context.humanDish === identity.biography.preferredMain ? `Same as you, then: the ${dish}. We can compare notes.` : `${context.humanDish ? `Nice, ${spokenDish(context.humanDish)}. ` : ''}I’m having the ${dish}. That was the easiest decision I made today.`, 'amused'],
    'main-served': ['That smells good. I’m ready to stop looking at the menu and start eating.', 'warm'],
    taste: [dry ? 'Mm. Good choice.' : 'Okay, that was worth waiting for.', 'warm'],
    'main-finished': [context.reserved ? 'That was a good meal.' : 'I’m glad I came out tonight.', 'warm'],
    'quiet-window': [dry ? 'This is nice. We don’t have to fill every second.' : 'A little quieter here. I like this part of the evening.', 'warm'],
    'beat-cold': ['I’m happy to start if you’d rather, but I’d like to hear something about your week first. Anything will do.', 'warm'],
    'beat-waiting-1': ['Okay, I’ll start. What’s the last thing you did just because you wanted to?', 'warm'],
    'beat-waiting-2': [dry ? 'I’m happy with a quiet minute. Tell me if you’d rather talk.' : 'Okay, I’ll break the silence first. Pick any subject and I’ll follow.', 'warm'],
    'beat-eating-1': ['This is good. I was ready to be polite about it. What’s the meal you’d defend to anyone?', 'amused'],
    'beat-eating-2': ['You’ve gone quiet. Is that a good quiet? I’ll take either answer.', 'warm'],
    'beat-after-1': ['I’m usually decided by now. I’m still working this one out.', 'warm'],
    'beat-after-2': ['Small question, honest answer: is this the kind of night you’d do again?', 'warm'],
    'dessert-date-choice': [context.named && DESSERTS.some(item => item.id === context.choice) ? `${spokenDessert(context.choice!)} it is, then. I’ll ask Eli.` : `I’m going to order the ${dessertName}. There will be two spoons, if you’d like one.`, 'warm'],
    'dessert-ordered': ['Something to share sounds good. I can find a little room.', 'warm'],
    'dessert-served': ['That looks good. Two spoons. I like a dessert that assumes company.', 'warm'],
    'dessert-shared': [context.reserved ? 'This was worth saving room for.' : 'I don’t usually say this on a first date, but there’s something I keep putting off that I actually care about.', 'warm'],
    'dessert-skipped': ['Fair enough. I’m happy taking our time with the rest of the evening.', 'neutral'],
    'bill-requested': ['I think that’s us. Let’s get this settled.', 'neutral'],
    'bill-settled': [context.choice === 'treat' ? 'Thank you. That was kind of you.' : context.choice === 'separate' ? 'Our own orders, then. That works for me.' : 'Thanks. I’m glad we sorted that out without making it strange.', 'warm'],
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
    'ending-new-friend': [context.reserved ? 'It was good to meet you. I’m happy to leave it as friends. Take care.' : 'I enjoyed your company. I’d be happy to keep in touch as friends.', 'warm'],
    'ending-second-chance': ['We had an awkward moment, but I appreciated how you handled it afterward. I’d be open to trying again.', 'warm'],
    'ending-quiet-goodbye': ['Thank you for dinner. I don’t think I’m looking for another date, but I wish you well.', 'neutral'],
    'ending-early-exit': ['All right. Thanks for letting me know. Take care getting home.', 'neutral'],
    'ending-walked-away': ['I asked you to stop, and you kept pushing. I’m leaving. Take care.', 'defensive'],
  };
  const cast = getStoryCue(key, identity.dateId, context).filter(line => line.speaker !== 'date');
  // A hurt or guarded date speaks plainly here too, and Eli's lines still land.
  const quiet = isGuardedStance(context.resolution) ? BLIND_GUARDED[key] ?? guardedLine(identity.dateId, key) : undefined;
  const ending = groundedEndingCue(key, active ? 'warm' : dry ? 'measured' : identity.traits.directness > 65 ? 'direct' : 'easy', context);
  const chosen: [string, Emotion?] | undefined = quiet ? [quiet, 'neutral'] : ending ? [ending.text, ending.emotion] : lines[key];
  if (!chosen) return cast;
  const dateLine: SceneUtterance = { speaker: 'date', text: chosen[0], emotion: chosen[1] ?? 'neutral' };
  // Little earned yet: Eli brings the check and the date says nothing about the evening.
  if (key === 'bill-requested' && context.reserved && !quiet) return cast;
  // Eli leads the course changes for blind dates too, and a plain thank-you follows the plate.
  return ['main-finished', 'bill-requested'].includes(key) || quiet && ['main-served', 'dessert-served'].includes(key) ? [...cast, dateLine] : [dateLine, ...cast];
}
