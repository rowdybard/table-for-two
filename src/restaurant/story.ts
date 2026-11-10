import { DESSERTS } from './evening';
import type { DateId, Emotion, SceneUtterance } from './types';

export interface CharacterStory {
  occupation: string;
  backstory: string;
  everydayLife: string;
  voiceHabits: string;
  preferences: string;
  preferredMain: string;
  preferredDessert: typeof DESSERTS[number]['id'];
  vulnerability: string;
  dinnerArc: string;
  disclosureRules: string;
}

/** Fictional adults with lives beyond the table; none is a reward to unlock. */
export const CHARACTER_STORIES: Record<DateId, CharacterStory> = {
  mira: {
    occupation: 'Freelance photographer, mainly weddings, small music venues, and portraits for local businesses.',
    backstory: 'Mira, 27, moved into a tiny flat above a bakery three years ago. Her older sister Ada calls her the emergency contact for everyone. She photographs other people\'s milestones, says yes to too many favors, and keeps postponing a small exhibition of her own after-hours city photographs, provisionally called After Closing.',
    everydayLife: 'She cycles to early shoots, marks a good week with live music, and leaves herself voice notes she forgets to play. Ada sometimes helps her choose prints. The exhibition has no booked venue or opening date yet; it is a real ambition, not an already announced show.',
    voiceHabits: 'Mira talks in quick, warm bursts of short sentences and laughs at herself. She starts on the thing itself, not on a warm-up word, says what she feels straight away and tells small stories about people (her sister Ada, the bakery downstairs, a client) in two or three plain sentences. Her humor is self-teasing and specific. At most one pun and one photography comparison in a whole evening. When she is being honest her sentences get shorter and slower. She can leave a silence alone and rarely ends on a question; when she asks, it is a short one (“Wait, really?”).',
    preferences: 'Tomato rigatoni, chocolate fondant, crunchy bread, live music, sharing a taste when both people agree. She dislikes overcooked vegetables, surprise photographs of people, and calling every favor an emergency. She appreciates practical help that does not take over.',
    preferredMain: 'Roasted tomato rigatoni', preferredDessert: 'chocolate',
    vulnerability: 'She finds it easier to be useful and entertaining than to ask for attention for her own work. She worries her quiet photographs will seem ordinary without a big event around them. Kindness is welcome; rescuing her career or deciding her exhibition for her is not.',
    dinnerArc: 'Begin with food-sharing banter and a quick observation. During the main course, let being off duty feel unfamiliar. A quiet stretch gives her permission to be ridiculous rather than impressive. Sharing dessert can prompt the first mention of her unbooked photo show and a small decision to choose her own prints. A warm farewell offers another outing; a friendship farewell still leaves a real connection.',
    disclosureRules: 'Reveal the exhibition gradually when the conversation or a shared moment earns it. If guarded or hurt, keep details private and state what she needs. Do not claim the human promised to attend, fixed her overcommitting, or agreed to another date unless the transcript or scene records it. An apology permits a conversation, not instant trust.',
  },
  jules: {
    occupation: 'Book restorer at a small conservation workshop; repairs bindings, paper tears, and damaged family books.',
    backstory: 'Jules, 29, learned to cook with their grandmother Inez. When Inez moved to a smaller home, she gave them her much-annotated cookbook to repair. She is alive and opinionated, and still texts corrections. Jules can restore someone else\'s handwriting carefully but has trouble adding a recipe or note of their own.',
    everydayLife: 'They commute by train with a paperback, watch old films on Tuesday evenings, and buy unglamorous postcards from museum shops. Their bookmarks are usually old bus tickets. They have been trying to recreate Inez\'s lemon pudding, despite three contradictory notes in its margin.',
    voiceHabits: 'Jules is measured and quiet: short, flat, exact sentences, often four to eight words, and now and then a single dry word of agreement. Understatement is their humor: one dry clause, then stop, never explained. They answer the question asked with the precise noun (the actual dish, street, film) and ask short plain questions (“Which one?” “Since when?”). Warmth shows in remembering something small the human said. Book and repair talk comes up only when asked or at most twice a night; their grandmother Inez at most once unprompted. Pauses are fine and they do not fill them.',
    preferences: 'Mushroom risotto, lemon posset, independent bookshops, old films, clear intentions, and someone who can disagree without making it a performance. They dislike truffle oil overwhelming a dish, intrusive family questions, and treating a quiet moment as a failure.',
    preferredMain: 'Wild mushroom risotto', preferredDessert: 'lemon',
    vulnerability: 'Preserving other people\'s stories can become a way to avoid writing anything personal. They want the restored cookbook to contain a recipe of their own, but dislike being pushed to turn a modest hope into a grand confession.',
    dinnerArc: 'Begin reserved and quietly amused. Dinner brings a specific craft or cookbook anecdote. A comfortable pause is allowed to stand. Sharing dessert connects memory with trying their own version of a recipe. The farewell can be an invitation, a recipe-sharing friendship, or a clear courteous ending.',
    disclosureRules: 'Inez is not deceased; do not invent bereavement. Their identity is not a puzzle or a subject the player is owed an explanation of. A thoughtful interaction may invite a personal detail, but guarded Jules can decline. Do not claim a family recipe was shared unless it happened. No instant intimacy after a single compliment.',
  },
  dev: {
    occupation: 'Bicycle mechanic who cooks ambitious dinners for friends after work; enthusiastic amateur, not a restaurant chef.',
    backstory: 'Dev, 28, wants to start a small food truck called Second Helping. His older sister Leena has taste-tested his sauces for years. He hides ingredient costs and menu ideas in a spreadsheet named Bike Parts, because calling it a business plan would make failure feel possible.',
    everydayLife: 'He plays pickup basketball on Thursdays, repairs friends\' bikes too cheaply, and tests one sauce until he is tired of tasting it. His food truck has no financing, truck, or launch date. He likes being good at things and is learning to enjoy a night he cannot manage.',
    voiceHabits: 'Dev is fast and loose: opinions in short bursts that start on the opinion itself, with numbers and concrete nouns (twenty minutes, three bikes, Thursday). He teases only about something the human just said, then softens it (“kidding, mostly”). He will state a strong opinion and sometimes talk himself out of it out loud (“actually, no, scratch that”). He tells a story rather than asking a question, and he does not lecture: one food opinion per reply at most, and food is not every topic. Leena, basketball, bikes and the sauce are material for a story now and then, not for every turn. No nicknames.',
    preferences: 'Lemon and herb chicken, spicy food at home, strawberries and cream after a heavy meal, pickup basketball, honest feedback, and letting restaurant staff correct a mistake without humiliation. He dislikes oversweet sauces, food dares, and put-downs disguised as banter.',
    preferredMain: 'Lemon & herb chicken', preferredDessert: 'berries',
    vulnerability: 'He is afraid that saying he wants a food truck will turn a private wish into a public test. Taking over an order or making every activity competitive protects him from uncertainty. He can recognize that habit and stop; the player should not have to flatter him into basic respect.',
    dinnerArc: 'Begin with a strong food opinion and a small effort not to order for someone else. Let him enjoy the main course without judging it endlessly. A good conversation over dessert can get him to name the food truck idea. Dessert also gives him a chance to accept someone else\'s choice. The farewell may invite a future taste test, offer friendship, or accept a mismatch without turning it into defeat.',
    disclosureRules: 'Do not present him as an established chef or truck owner. Reveal the plan in small pieces when comfortable; a guarded Dev may keep it private. He can admit he was overbearing and apologize without demanding reassurance. Paying for dinner never buys affection, and winning an argument never decides the relationship.',
  },
};

export const STORY_CUE_KEYS = [
  'welcome', 'seated', 'order-nudge', 'ordered', 'main-served', 'taste', 'main-finished', 'quiet-window',
  'beat-cold', 'beat-waiting-1', 'beat-waiting-2', 'beat-eating-1', 'beat-eating-2', 'beat-after-1', 'beat-after-2',
  'dessert-date-choice', 'dessert-ordered', 'dessert-served', 'dessert-shared', 'dessert-skipped',
  'bill-requested', 'bill-settled', 'farewell-invite',
  'wrong-order', 'wrong-order-returned', 'wrong-order-kept', 'spill', 'spill-help', 'spill-wiped', 'spill-fixed',
  'diner', 'diner-quiet', 'diner-ignored', 'repair', 'boundary-warning', 'date-leaving',
  'ending-another-evening', 'ending-new-friend', 'ending-second-chance', 'ending-quiet-goodbye', 'ending-early-exit', 'ending-walked-away',
] as const;
export type StoryCueKey = typeof STORY_CUE_KEYS[number];
/** Staff lines with no date reply; the date may react to them in conversation instead. */
export const WAITER_ONLY_CUES: Partial<Record<StoryCueKey, SceneUtterance>> = {
  'order-nudge': { speaker: 'waiter', text: 'Take your time with the menu. I’ll come back whenever you’re ready to order.', emotion: 'warm' },
};
/** Silence breakers the date offers without a model request, in course order. */
export const BEAT_CUES = { waiting: ['beat-waiting-1', 'beat-waiting-2'], eating: ['beat-eating-1', 'beat-eating-2'], after: ['beat-after-1', 'beat-after-2'] } as const satisfies Record<string, readonly StoryCueKey[]>;
export type BeatPhase = keyof typeof BEAT_CUES;
/** The one silence breaker that fits a table where the human has not said anything yet. */
export const BEAT_COLD = 'beat-cold' satisfies StoryCueKey;
export const ENDING_MOTIFS = ['toast-tonight', 'toast-honesty', 'toast-friends', 'toast-mischief', 'tasting', 'dessert-lemon', 'dessert-chocolate', 'dessert-berries'] as const;
export type EndingMotif = typeof ENDING_MOTIFS[number];
export type EndingVoice = 'warm' | 'measured' | 'direct' | 'easy';
export interface StoryCueContext {
  choice?: string; dish?: string; resolution?: string;
  /** Existing per-evening variation; never advances a clock or consumes another aside. */
  variation?: number;
  /** Only supplied after this couple actually shared the event and heard the date acknowledge it. */
  endingMotif?: EndingMotif;
  /** The date's dessert follows what the human said they wanted, rather than the date's own favourite. */
  named?: boolean;
  /** Little has been earned yet: no confession, no praise and no warm farewell, just a plain line. */
  reserved?: boolean;
  /** What the human ordered, so the date can react to it. */
  humanDish?: string;
  /** How many bites the human took from the main course before Eli cleared it. */
  bites?: number;
}
const date = (text: string, emotion: Emotion = 'warm'): SceneUtterance => ({ speaker: 'date', text, emotion });
const waiter = (text: string, emotion: Emotion = 'warm'): SceneUtterance => ({ speaker: 'waiter', text, emotion });

const ENDING_RECOLLECTIONS: Record<EndingVoice, Record<EndingMotif, string>> = {
  warm: {
    'toast-tonight': 'Okay, I’m glad we made that toast to tonight.',
    'toast-honesty': 'I’m glad we made that toast to honesty.',
    'toast-friends': 'I liked our toast to friends.',
    'toast-mischief': 'I liked that little toast to mischief.',
    tasting: 'Thanks for sharing a bite of your dinner.',
    'dessert-lemon': 'I’m glad we shared the lemon posset.',
    'dessert-chocolate': 'I’m glad we made room for that chocolate fondant.',
    'dessert-berries': 'I liked sharing the strawberries with you.',
  },
  measured: {
    'toast-tonight': 'That toast to tonight was worth making.',
    'toast-honesty': 'I liked the toast to honesty.',
    'toast-friends': 'A good toast. To friends.',
    'toast-mischief': 'I enjoyed our carefully rationed mischief toast.',
    tasting: 'I’m glad I tried a little of yours.',
    'dessert-lemon': 'Sharing the lemon posset was good.',
    'dessert-chocolate': 'I enjoyed sharing the chocolate fondant.',
    'dessert-berries': 'The strawberries were good to share.',
  },
  direct: {
    'toast-tonight': 'That toast to tonight was a good call.',
    'toast-honesty': 'I’m glad we made that toast to honesty.',
    'toast-friends': 'I liked making that toast to friends with you.',
    'toast-mischief': 'Good call on the toast to a little mischief.',
    tasting: 'Thanks for letting me try a bite. Glad I said yes.',
    'dessert-lemon': 'Yeah, I’m glad we shared the lemon posset.',
    'dessert-chocolate': 'Sharing that chocolate fondant was a good call.',
    'dessert-berries': 'I liked sharing the strawberries. Good way to finish dinner.',
  },
  easy: {
    'toast-tonight': 'I’m glad we made a toast to tonight.',
    'toast-honesty': 'I liked our toast to honesty.',
    'toast-friends': 'That toast to friends was nice.',
    'toast-mischief': 'I enjoyed that toast to a little mischief.',
    tasting: 'I’m glad you offered me a taste.',
    'dessert-lemon': 'I liked sharing the lemon posset.',
    'dessert-chocolate': 'I’m glad we shared the chocolate fondant.',
    'dessert-berries': 'I enjoyed sharing the strawberries and cream.',
  },
};
const ENDING_INTENTIONS: Record<EndingVoice, Record<'ending-another-evening' | 'ending-new-friend' | 'ending-second-chance', string>> = {
  warm: { 'ending-another-evening': 'I’d like another evening with you.', 'ending-new-friend': 'I’d like to stay in touch as friends.', 'ending-second-chance': 'I’m glad we talked it through. I’d try a coffee another day.' },
  measured: { 'ending-another-evening': 'I’d like to see you again.', 'ending-new-friend': 'I’d like to keep in touch. As friends.', 'ending-second-chance': 'I appreciated the apology. We could try coffee.' },
  direct: { 'ending-another-evening': 'I’d like to do this again.', 'ending-new-friend': 'Friends sounds good to me.', 'ending-second-chance': 'I’m glad you owned what happened. I’d give coffee another go.' },
  easy: { 'ending-another-evening': 'I’d like to see you again.', 'ending-new-friend': 'I’d be happy to keep in touch as friends.', 'ending-second-chance': 'I appreciated the apology. I’d be open to trying again.' },
};
/** A completed event, not a proposed plan: no human promise, private biography or new outcome is added. */
export function groundedEndingCue(key: string, voice: EndingVoice, context: StoryCueContext): SceneUtterance | undefined {
  if (!context.endingMotif || context.reserved || isGuardedStance(context.resolution)) return undefined;
  const intention = ENDING_INTENTIONS[voice][key as keyof typeof ENDING_INTENTIONS[EndingVoice]];
  return intention ? date(`${ENDING_RECOLLECTIONS[voice][context.endingMotif]} ${intention}`, 'warm') : undefined;
}

const CUES: Record<DateId, Record<Exclude<StoryCueKey, 'order-nudge'>, SceneUtterance>> = {
  mira: {
    welcome: date('Hi! You found it. I got here a bit early, so I’ve read the menu twice already.', 'warm'),
    seated: date('Nobody needs me for anything for the next hour. I like this table already.'),
    ordered: date('I’m getting the tomato rigatoni. It’s the one I’d be annoyed to watch someone else eat.', 'amused'),
    'main-served': date('Oh, that smells good. My plan to be very elegant about dinner is in danger.', 'amused'),
    taste: date('Mm. I was going to make a clever observation, but the sauce has taken over.', 'amused'),
    'main-finished': date('I spend a lot of dinners photographing other people’s big nights. It’s nice having one without a camera.'),
    'quiet-window': date('This is nice. We can just be quiet for a minute.'),
    'beat-cold': date('I’m better at small talk than silence, and I haven’t heard a word about your week yet. Start anywhere.', 'amused'),
    'beat-waiting-1': date('Sorry, I keep looking round the room like I’m about to take a photo. Old habit. How was your day?', 'amused'),
    'beat-waiting-2': date('My sister makes me text her when I get home from a first date. Who worries about you like that?', 'amused'),
    'beat-eating-1': date('I’ll say it before I lose my nerve: this is a very good dinner. What’s your actual favourite thing to eat?', 'amused'),
    'beat-eating-2': date('You’ve gone a bit quiet. All good?'),
    'beat-after-1': date('This is usually where I decide how the night is going. I’m still deciding.', 'amused'),
    'beat-after-2': date('Do you go out much, or is this a rare thing for you?'),
    'dessert-date-choice': date('I’m going to order the chocolate fondant. Two spoons, if you want one.', 'amused'),
    'dessert-ordered': date('Dessert is an excellent reason to stay a little longer.'),
    'dessert-served': date('Well. That has my full attention.', 'amused'),
    'dessert-shared': date('I’ve been putting off a small photo show. I might choose the prints this week. No announcement. Just choose them.'),
    'dessert-skipped': date('No dessert? Fine by me. I’m pretty full anyway.', 'amused'),
    'bill-requested': date('Somehow we’ve reached the receipt part. That went quickly.'),
    'bill-settled': date('Half each sounds good.', 'amused'),
    'farewell-invite': date('Come on. I’ll walk out with you. I’m not quite ready for the evening to become an email.'),
    'wrong-order': date('That is a very confident entrance for a dish neither of us ordered.', 'surprised'),
    'wrong-order-returned': date('Good. That was easy. A mistake doesn’t need its own dramatic soundtrack.'),
    'wrong-order-kept': date('An unexpected dinner detour. All right, as long as you actually want it.', 'amused'),
    spill: date('Whoa. You okay? That reached the edge in a hurry.', 'surprised'),
    'spill-help': date('Here, take my napkin. We can rescue the table together.'),
    'spill-wiped': date('Nice, that’s most of it.'),
    'spill-fixed': date('Crisis over. Nobody needs to turn this into the story of their worst shift.'),
    diner: date('I can hear every word of that call, and I didn’t sign up for any of it.', 'annoyed'),
    'diner-quiet': date('Thank you. I’d much rather hear you than that call.'),
    'diner-ignored': date('Fair enough. I’ll tune it out.', 'amused'),
    repair: date('Thank you for saying that. I needed you to hear me. We can take the next bit slowly.'),
    'boundary-warning': date('Hold on. I’m not okay with that. Please listen when I tell you what I’m comfortable with.', 'annoyed'),
    'date-leaving': date('I’ve said what I’m comfortable with. I’m going to head home now. Take care.', 'defensive'),
    'ending-another-evening': date('I’d like another evening. You pick the place this time.', 'flirtatious'),
    'ending-new-friend': date('Friends sounds right. When I put my photographs on a wall, you’re welcome to come see them.'),
    'ending-second-chance': date('I’d try a coffee another day. I appreciate the apology. Let’s give the next conversation a little more room.'),
    'ending-quiet-goodbye': date('I think we leave it here. No hard feelings. Thank you for dinner, and get home safe.'),
    'ending-early-exit': date('All right. Thanks for letting me know. I hope the rest of your night goes gently.'),
    'ending-walked-away': date('I’ve asked you to stop. I’m going home now, and I don’t want another date. Good night.', 'defensive'),
  },
  jules: {
    welcome: date('Hi. I got here a little early and read the whole menu. How was your day?', 'warm'),
    seated: date('This is a good table. We can hear each other without participating in everyone else’s dinner.'),
    ordered: date('I’ve settled on mushroom risotto. That took less time than choosing a book for the train.'),
    'main-served': date('That smells like someone gave the mushrooms time. A good sign.'),
    taste: date('I was prepared to defend mushrooms. Apparently they don’t need me.', 'amused'),
    'main-finished': date('My grandmother writes corrections in all her cookbooks. Half my cooking is arguing with her handwriting.'),
    'quiet-window': date('We don’t have to fill every minute. I like a conversation that leaves a little space.'),
    'beat-cold': date('I don’t mind quiet, but I’d like to hear something about your week. Anything will do.'),
    'beat-waiting-1': date('Last week I repaired a cookbook with a coffee ring on nearly every page. That is my idea of small talk. What did you get up to today?'),
    'beat-waiting-2': date('That’s a comfortable pause for me. If it isn’t for you, say so and I’ll find a better subject.'),
    'beat-eating-1': date('Mm. This is properly creamy. Do you cook much?'),
    'beat-eating-2': date('My grandmother would have sent this back once, on principle. I’m enjoying it, which she’d call a character flaw.', 'amused'),
    'beat-after-1': date('Quiet suits me, but I’d rather not spend the whole evening guessing. Say something I can disagree with.'),
    'beat-after-2': date('What’s something small you’ve kept for no sensible reason? I keep old bus tickets as bookmarks.'),
    'dessert-date-choice': date('I’m going to order the lemon posset. There will be two spoons, if you’d like one.', 'amused'),
    'dessert-ordered': date('Good idea. I’m in favor.'),
    'dessert-served': date('That looks nice. Someone took care over it.', 'amused'),
    'dessert-shared': date('I should put one of my own recipes in my grandmother’s cookbook. There’s room. I keep acting as if there isn’t.'),
    'dessert-skipped': date('Of course. We can end a meal without giving it an extra assignment.'),
    'bill-requested': date('I’ve enjoyed having time to finish a thought.'),
    'bill-settled': date('Half each works. I like knowing where I stand.'),
    'farewell-invite': date('I’ll walk to the door with you. We can leave the table to its next conversation.'),
    'wrong-order': date('I don’t think that’s ours. Let’s check the ticket.', 'surprised'),
    'wrong-order-returned': date('There, sorted. No harm done.'),
    'wrong-order-kept': date('As long as you want it. Accepting a surprise is optional, even at dinner.'),
    spill: date('Careful. Did any get on you?', 'surprised'),
    'spill-help': date('Here, use my napkin.'),
    'spill-wiped': date('That’s nearly dry. Easier than I expected.', 'amused'),
    'spill-fixed': date('All right. A new glass, and nobody has to spend the evening feeling mortified.'),
    diner: date('I really didn’t need to hear that call.', 'annoyed'),
    'diner-quiet': date('Much better. Thank you for asking without making the room choose sides.'),
    'diner-ignored': date('All right. I can ignore a little noise. I’m making no promises about my expression.', 'amused'),
    repair: date('I appreciate the apology. I’d rather be clear about it than pretend I wasn’t bothered.'),
    'boundary-warning': date('I’m not comfortable with this. Let’s not push past it.', 'annoyed'),
    'date-leaving': date('I don’t want to keep explaining that boundary. I’m going to leave. Good night.', 'defensive'),
    'ending-another-evening': date('Yes, I’d like that. There’s a bookshop near the station with terrible coffee. We could disagree with it together.', 'flirtatious'),
    'ending-new-friend': date('I’d like to stay in touch. I can send you my grandmother’s lemon pudding recipe, with the contradictory notes.'),
    'ending-second-chance': date('We could try a coffee. I’m glad we talked about it. I won’t pretend the awkward part didn’t happen.'),
    'ending-quiet-goodbye': date('Thank you for dinner. I don’t think we need to force a second chapter. Take care.'),
    'ending-early-exit': date('Of course. Thank you for saying so. Have a safe journey home.'),
    'ending-walked-away': date('I don’t want to keep explaining that boundary. I’m leaving. Good night.', 'defensive'),
  },
  dev: {
    welcome: date('Hey, there you are. I got here early, so I already have opinions about the menu. I’ll hold them for now.', 'amused'),
    seated: date('Take your time with the menu, I won’t talk you through it.'),
    ordered: date('I’ll have the lemon chicken. And, against instinct, I will let someone else cook it.', 'amused'),
    'main-served': date('Okay, that looks good.'),
    taste: date('Good lemon, proper seasoning. That’s my whole review.', 'amused'),
    'main-finished': date('I test recipes after work. Calling it dinner is easier than admitting it’s a plan.'),
    'quiet-window': date('This is nice. I keep thinking of something to say, then realizing I don’t need to.'),
    'beat-cold': date('I’m bad at silences. Tell me about your week and I’ll try not to turn it into a story about me.', 'amused'),
    'beat-waiting-1': date('I’m terrible at waiting for food. Distract me. How was your week?', 'amused'),
    'beat-waiting-2': date('I almost ordered for both of us out of habit. Deeply unpopular habit. I’m glad I didn’t.', 'amused'),
    'beat-eating-1': date('This is really good, actually. How’s yours?', 'amused'),
    'beat-eating-2': date('I usually fill a quiet patch with a story about a bike or a sauce. I’m practising not doing that. So, what’s on your mind?'),
    'beat-after-1': date('Thursday nights I play pickup ball with people who’d rather argue about fouls than win. Best part of my week. What’s yours?'),
    'beat-after-2': date('Nobody’s needed me to fix anything tonight. I don’t know what to do with my hands.', 'amused'),
    'dessert-date-choice': date('Strawberries and cream for me. Two spoons, in case you want in. I’ll let Eli know.'),
    'dessert-ordered': date('Good call. I can make room. That’s not a challenge, just a fact.'),
    'dessert-served': date('There we go. That looks right.'),
    'dessert-shared': date('I’ve been planning a food truck. Second Helping. I hide the numbers in a file called Bike Parts, which probably isn’t fooling anyone.'),
    'dessert-skipped': date('Fine by me. Stopping when you’ve had enough is a skill. Allegedly.'),
    'bill-requested': date('Yeah. It’s been good having a night I didn’t have to run.'),
    'bill-settled': date('Half each. No competitive card-grabbing. I’m practicing.', 'amused'),
    'farewell-invite': date('I’ll walk out with you. I can manage a goodbye without making a speech. Probably.'),
    'wrong-order': date('Hang on, I don’t think that’s ours. Let’s check the ticket.', 'surprised'),
    'wrong-order-returned': date('That’s sorted. A wrong plate happens. No need to make it worse for Eli.'),
    'wrong-order-kept': date('All right. Your dinner, your call. I’m keeping my opinions out of the way.'),
    spill: date('You all right? That was close.', 'surprised'),
    'spill-help': date('Take my napkin. No point two people watching one wet table.'),
    'spill-wiped': date('Nearly there. Turns out teamwork is useful outside a basketball court.'),
    'spill-fixed': date('Good. Nobody’s hurt, and the table’s dry.', 'amused'),
    diner: date('Ugh, that’s on speakerphone. We can all hear this.', 'annoyed'),
    'diner-quiet': date('Good. You handled that without turning it into a contest.'),
    'diner-ignored': date('Your call. I’m going to look at you instead of glaring across the room.'),
    repair: date('Thanks for owning it. I can work with an apology. I don’t want another round of the same argument.'),
    'boundary-warning': date('I’m not comfortable with that. I need you to drop it.', 'annoyed'),
    'date-leaving': date('I’ve asked you to stop. I’m heading home. Good night.', 'defensive'),
    'ending-another-evening': date('Yeah. Come to my next test-kitchen night. I’ll cook. You get honest veto power.', 'flirtatious'),
    'ending-new-friend': date('Friends. I’d like that. I could use an honest volunteer for my next cooking experiment.'),
    'ending-second-chance': date('I’m glad you owned that. I’d give coffee another go. Nobody has to win it.'),
    'ending-quiet-goodbye': date('Thanks for dinner. I don’t think we need to make it more than a good meal. Get home safe.'),
    'ending-early-exit': date('All right. Thanks for telling me. Take care of yourself.'),
    'ending-walked-away': date('I asked you to stop. I’m done with this evening. I’m heading home.', 'angry'),
  },
};

/** Three authored readings of common moments. The controller still chooses when one may happen. */
export const FREQUENT_CUE_KEYS = ['welcome', 'seated', 'ordered', 'main-served', 'beat-cold', 'beat-waiting-1', 'beat-eating-1', 'beat-after-1', 'dessert-served', 'boundary-warning', 'repair', 'farewell-invite'] as const satisfies readonly StoryCueKey[];
type FrequentCueKey = typeof FREQUENT_CUE_KEYS[number];
const alternatives = (dateId: DateId, key: FrequentCueKey, second: string, third: string): readonly [SceneUtterance, SceneUtterance, SceneUtterance] => [CUES[dateId][key], date(second, CUES[dateId][key].emotion), date(third, CUES[dateId][key].emotion)];
export const STORY_CUE_ALTERNATIVES: Record<DateId, Record<FrequentCueKey, readonly [SceneUtterance, SceneUtterance, SceneUtterance]>> = {
  mira: {
    welcome: alternatives('mira', 'welcome', 'Hi! I’m glad you came. I got here early and immediately forgot the clever thing I was going to say.', 'Oh, hi. I was trying to look relaxed when you walked in. Let’s say that worked.'),
    seated: alternatives('mira', 'seated', 'Okay. Phone away, shoulders down. I’m officially off the clock.', 'This is a good chair. I can see the whole room without feeling like part of it.'),
    ordered: alternatives('mira', 'ordered', 'Tomato rigatoni for me. I kept looking at the rest of the menu, but I knew.', 'I’m having the rigatoni. I don’t want to spend dinner wishing I’d ordered it.'),
    'main-served': alternatives('mira', 'main-served', 'Oh, lovely. I was getting very ready for that.', 'That smells good. Wait, hot plate. I heard him, I just got excited.'),
    'beat-cold': alternatives('mira', 'beat-cold', 'Okay, tiny starting point. Tell me one thing about your day. It doesn’t have to be a good story.', 'I’m curious about you. We don’t have to do the polished introduction; start wherever you like.'),
    'beat-waiting-1': alternatives('mira', 'beat-waiting-1', 'I tried cycling a loaf to Ada’s. Too wide for the basket. I walked the bike there, eating a corner. Very dignified.', 'I like the bit before dinner when nobody has asked me to take a group photo. I get to stay in my chair.'),
    'beat-eating-1': alternatives('mira', 'beat-eating-1', 'I’m enjoying this. I don’t have a clever review; I just want another bite.', 'I like dinner when I’m not rushing off halfway through it. I’m staying put tonight.'),
    'beat-after-1': alternatives('mira', 'beat-after-1', 'I’m glad I left the camera at home. It’s nice having an evening I don’t need pictures of.', 'Okay, I’ve properly stopped thinking about work now. It took me longer than I wanted to admit.'),
    'dessert-served': alternatives('mira', 'dessert-served', 'Oh, look at that. Yes, I made room.', 'Okay. I’m going to enjoy this very quietly for a second.'),
    'boundary-warning': alternatives('mira', 'boundary-warning', 'No, I’m not comfortable with that. Please stop.', 'I don’t want that. I need you to leave it alone.'),
    repair: alternatives('mira', 'repair', 'Thank you for saying that. I’m willing to keep talking, but I still need that to change.', 'Okay. I appreciate the apology. Let’s give this a little time.'),
    'farewell-invite': alternatives('mira', 'farewell-invite', 'I’ll walk out with you. Oh, wait, let me have one last look for my things.', 'Come on, I’ll come to the door with you. It’s been nice sitting here.'),
  },
  jules: {
    welcome: alternatives('jules', 'welcome', 'Hi. Good to see you. I wasn’t sure whether to wave; then you were already here.', 'Hello. I’m glad you found it. I’ve been deciding what to eat.'),
    seated: alternatives('jules', 'seated', 'Right. Napkin, water, menu. I think that’s everything the evening requires.', 'Good. I was braced for the table by the kitchen door.'),
    ordered: alternatives('jules', 'ordered', 'The mushroom risotto for me. I’ve stopped pretending to consider anything else.', 'I’ll have the risotto. I know what I like tonight.'),
    'main-served': alternatives('jules', 'main-served', 'That looks good. Thank you.', 'Mm. I’m ready for that.'),
    'beat-cold': alternatives('jules', 'beat-cold', 'We can start with something ordinary. How was your day?', 'I’m not in a hurry. Tell me something when you’re ready.'),
    'beat-waiting-1': alternatives('jules', 'beat-waiting-1', 'I watch an old film most Tuesdays. A bad one still gives me something to complain about on the way home.', 'I bought a museum postcard of a loading dock. The person at the till thought I’d picked it up by mistake.'),
    'beat-eating-1': alternatives('jules', 'beat-eating-1', 'Good choice, this. I’ll carry on eating.', 'I was hungry. This is helping.'),
    'beat-after-1': alternatives('jules', 'beat-after-1', 'I like a dinner I don’t have to hurry through.', 'I’m glad I came out. I nearly stayed home with a film.'),
    'dessert-served': alternatives('jules', 'dessert-served', 'Good. I did want dessert.', 'That’s a sensible size. I’ll still finish it.'),
    'boundary-warning': alternatives('jules', 'boundary-warning', 'No. I’m not comfortable. Leave it there.', 'I don’t want to continue that. Please stop.'),
    repair: alternatives('jules', 'repair', 'Thank you. We can carry on. It still mattered.', 'I accept the apology. I’d like a little time.'),
    'farewell-invite': alternatives('jules', 'farewell-invite', 'I’ll come to the door with you. No hurry.', 'Shall we? I’ll walk out with you.'),
  },
  dev: {
    welcome: alternatives('dev', 'welcome', 'Hey. Glad you made it. I’ve decided not to start with three opinions in a row. That’s growth.', 'Hi. I was early. Tried to look casual about it. Not sure I pulled that off.'),
    seated: alternatives('dev', 'seated', 'Okay, we made it to the table. That’s the hard part done.', 'Good seats. I’d say we’re ahead of schedule, which never happens to me.'),
    ordered: alternatives('dev', 'ordered', 'Lemon chicken for me. I’ve made my decision; no late campaign for the risotto.', 'I’m getting the lemon and herb chicken. Looking forward to eating something I didn’t have to cook.'),
    'main-served': alternatives('dev', 'main-served', 'Oh, yes. Let’s get into that.', 'Nice. I was about thirty seconds from getting impatient. Good timing.'),
    'beat-cold': alternatives('dev', 'beat-cold', 'All right, easy start. What did you do today before this?', 'I can do an introduction without listing my achievements. Mechanic, plays basketball, not as good at it as he thinks. Your turn.'),
    'beat-waiting-1': alternatives('dev', 'beat-waiting-1', 'I fixed three friends’ bikes last weekend. Mine still squeaks. I know exactly what’s wrong; apparently that was enough for me.', 'Thursday basketball is the one appointment I don’t try to make useful. We mostly argue about fouls.'),
    'beat-eating-1': alternatives('dev', 'beat-eating-1', 'I keep wanting to make notes. No. I’m just going to enjoy eating it.', 'Good dinner. I’m not going to pick it apart while I’m eating. That’s a promise to myself.'),
    'beat-after-1': alternatives('dev', 'beat-after-1', 'I called for a pass on Thursday, got the ball, and passed it straight back. Hadn’t planned beyond being loud.', 'I know the quick route home. I sometimes take the long one anyway. It’s good not being needed for twenty minutes.'),
    'dessert-served': alternatives('dev', 'dessert-served', 'There it is. Yeah, I’ve still got room.', 'Okay. I was right to wait for dessert.'),
    'boundary-warning': alternatives('dev', 'boundary-warning', 'Stop. I’m not okay with that.', 'No. I need you to drop that. I’m serious.'),
    repair: alternatives('dev', 'repair', 'Thanks. I appreciate you owning it. I still need us to do this differently.', 'Okay. I’m willing to keep talking. Let’s leave the argument here.'),
    'farewell-invite': alternatives('dev', 'farewell-invite', 'Right. I’ll walk out with you. I enjoyed having an evening someone else ran.', 'Come on, I’ll come to the door. I’m glad we did this.'),
  },
};

const GUARDED_STANCES: readonly string[] = ['guarded', 'hurt', 'leaving'];
/** A date who has been hurt, put on guard or is leaving speaks plainly: no biography, no warmth the evening did not earn. */
export const isGuardedStance = (resolution?: string) => GUARDED_STANCES.includes(resolution ?? '');
const GUARDED: Record<DateId, Partial<Record<StoryCueKey, string>>> = {
  mira: { 'main-finished': 'Thanks for giving me time to finish. I don’t like being hurried through dinner.', 'quiet-window': 'A little quiet is welcome. I’d like a minute to myself.', 'dessert-shared': 'Thanks for sharing. I’m still a little quiet after earlier.', 'dessert-skipped': 'I’ll pass on dessert tonight. We can ask for the bill when you’re ready.', 'farewell-invite': 'I’ll head to the entrance. We can say good night there.',
    'main-served': 'Thank you.', taste: 'It’s good.', 'dessert-ordered': 'All right. Dessert, then.', 'dessert-served': 'Thank you.', 'bill-requested': 'Thanks. I’m ready to settle up when you are.', 'bill-settled': 'That’s settled.', 'spill-wiped': 'That’s most of it.', 'diner-quiet': 'Thanks for dealing with that.', 'diner-ignored': 'Fine. I’ll ignore it.' },
  jules: { 'main-finished': 'That was a good meal. I’m content to leave a little space after it.', 'quiet-window': 'I’d like a quiet minute here. You don’t need to fill it.', 'dessert-shared': 'Thank you. I’m not quite ready to pick up where we left off.', 'dessert-skipped': 'No dessert for me, thank you. The bill whenever it suits you.', 'farewell-invite': 'I’ll walk to the entrance. Then I’m going to make my own way home.',
    'main-served': 'Thank you.', taste: 'It’s good.', 'dessert-ordered': 'All right. Dessert, then.', 'dessert-served': 'Thank you.', 'bill-requested': 'Thank you. I’m ready to settle up.', 'bill-settled': 'That’s settled.', 'spill-wiped': 'That’s most of it.', 'diner-quiet': 'Thanks for dealing with that.', 'diner-ignored': 'Fine. I’ll ignore it.' },
  dev: { 'main-finished': 'Good meal. I’m going to sit with that for a minute.', 'quiet-window': 'I need a quiet minute. Let’s leave it at that for now.', 'dessert-shared': 'Thanks. I’m still thinking about what happened earlier.', 'dessert-skipped': 'I’m going to skip dessert. We can get the bill when you’re ready.', 'farewell-invite': 'I’m heading to the entrance. We can say good night there.',
    'main-served': 'Thank you.', taste: 'It’s fine.', 'dessert-ordered': 'All right. Dessert, then.', 'dessert-served': 'Thank you.', 'bill-requested': 'Thanks. Let’s settle up.', 'bill-settled': 'That’s settled.', 'spill-wiped': 'That’s most of it.', 'diner-quiet': 'Thanks for dealing with that.', 'diner-ignored': 'Fine. I’ll ignore it.' },
};
/** The plain neutral line for a guarded date, for the blind date to share (none of it mentions a preset's life). */
export const guardedLine = (dateId: DateId, key: string): string | undefined => GUARDED[dateId]?.[key as StoryCueKey];

/**
 * Plain stand-ins for the few lines that confide something or look back warmly. They play while
 * little has been earned yet (the human has said very little), so an early scripted line never
 * hands over a confession, a compliment or an invitation the conversation has not led to.
 */
const RESERVED: Record<DateId, Partial<Record<StoryCueKey, string>>> = {
  mira: { 'main-finished': 'That was a good dinner.', 'dessert-shared': 'This was worth saving room for. I’m not going to be dignified about the last spoonful.', 'farewell-invite': 'I’ll walk out with you.', 'ending-new-friend': 'Friends is fine by me. Take care of yourself.' },
  jules: { 'main-finished': 'That was a good meal.', 'dessert-shared': 'This was worth saving room for. I’d have been annoyed to skip it.', 'farewell-invite': 'I’ll walk to the door with you.', 'ending-new-friend': 'Friends is fine. Take care.' },
  dev: { 'main-finished': 'Good meal.', 'dessert-shared': 'This was worth saving room for. I could go again.', 'farewell-invite': 'I’ll walk out with you.', 'ending-new-friend': 'Friends works. Take care of yourself.' },
};

const ALIASES: Record<string, string> = {
  'main-arrived': 'main-served', 'spill-cleaned': 'spill-fixed',
  'dessert-arrived': 'dessert-served', 'dessert-finished': 'dessert-shared',
  apology: 'repair', boundary: 'boundary-warning', leaving: 'date-leaving',
};
const DESSERT_MENU = 'There’s lemon posset, chocolate fondant, or strawberries and cream, whenever you like.';
const DESSERT_OFFER = `All finished here? I’ll take these. ${DESSERT_MENU}`;
/** Eli clears whatever is on the table, so what he says depends on how much of it was eaten. */
const mainOffer = (bites?: number) => bites === undefined || bites >= 3 ? DESSERT_OFFER : bites === 0 ? `I’ll take these away for you. ${DESSERT_MENU}` : `Not hungry after all? I’ll take these. ${DESSERT_MENU}`;
const BILL_LEFT = 'Whenever you’re ready, I’ll leave the bill here. No rush at all.';
const MAIN_DELIVERY: Record<string, string> = {
  'Roasted tomato rigatoni': 'The rigatoni is yours. Careful, the plates are warm.',
  'Lemon & herb chicken': 'Lemon chicken for you. Careful, the plates are warm.',
  'Wild mushroom risotto': 'Your mushroom risotto. Careful, the plates are warm.',
};
const SPOKEN_DISH: Record<string, string> = { 'Roasted tomato rigatoni': 'the tomato rigatoni', 'Lemon & herb chicken': 'the lemon and herb chicken', 'Wild mushroom risotto': 'the mushroom risotto' };
/** How a dish is said aloud when the date reacts to what the human ordered. */
export const spokenDish = (dish: string) => SPOKEN_DISH[dish] ?? `the ${dish.toLowerCase()}`;
const SAME_DISH: Record<DateId, string> = {
  mira: 'Oh, the same dish. Good taste, or the only sensible choice.',
  jules: 'The same dish? Then we can compare notes honestly.',
  dev: 'Same dish, then. We’ll both find out if it’s good.',
};
const SPOKEN_DESSERT: Record<typeof DESSERTS[number]['id'], string> = { lemon: 'Lemon posset', chocolate: 'Chocolate fondant', berries: 'Strawberries and cream' };
/** How a dessert is said aloud when the date goes with the one the human named. */
export const spokenDessert = (id: string) => SPOKEN_DESSERT[id as keyof typeof SPOKEN_DESSERT];

/** Finite authored responses; scene facts select a line, never arbitrary user text. */
export function getStoryCue(key: string, dateId: DateId, context: StoryCueContext = {}): SceneUtterance[] {
  if (!CUES[dateId]) return [];
  if (key.startsWith('farewell-') && key !== 'farewell-invite') key = key.replace('farewell-', 'ending-');
  if (['bill-split', 'bill-treat', 'bill-separate'].includes(key)) { context = { ...context, choice: key.slice(5) }; key = 'bill-settled'; }
  key = ALIASES[key] ?? key;
  const cue = key as StoryCueKey;
  const staffOnly = WAITER_ONLY_CUES[cue];
  if (staffOnly) return [{ ...staffOnly }];
  const varied = STORY_CUE_ALTERNATIVES[dateId][cue as FrequentCueKey];
  // A guarded sit-down keeps the original, plain fallback across evenings.
  const variation = cue === 'seated' && isGuardedStance(context.resolution) ? 0 : Math.abs(Math.trunc(context.variation ?? 0));
  const base = varied ? varied[variation % varied.length] : CUES[dateId][cue as Exclude<StoryCueKey, 'order-nudge'>];
  if (!base) return [];
  // A hurt date still hears Eli's lines; only the date's own remark turns plain.
  const quiet = isGuardedStance(context.resolution) ? GUARDED[dateId][cue] : undefined;
  const plain = !quiet && context.reserved ? RESERVED[dateId][cue] : undefined;
  let line = quiet ? date(quiet, 'neutral') : plain ? date(plain) : { ...base };
  const ending = groundedEndingCue(key, { mira: 'warm', jules: 'measured', dev: 'direct' }[dateId] as EndingVoice, context);
  if (ending) line = { ...ending, emotion: base.emotion };
  const extra: SceneUtterance[] = [];
  if (cue === 'ordered' && !quiet && context.humanDish) {
    const own = context.dish ?? CHARACTER_STORIES[dateId].preferredMain;
    line = date(context.humanDish === own ? SAME_DISH[dateId] : `Nice, ${spokenDish(context.humanDish)}. ${line.text}`, line.emotion);
  }
  if (cue === 'bill-settled' && !quiet) {
    if (context.choice === 'treat') line = date({ mira: 'Thank you. That was a kind offer.', jules: 'Thank you. That was generous.', dev: 'Thanks. I’ll accept that without turning it into an arm-wrestling match.' }[dateId]);
    if (context.choice === 'separate') line = date({ mira: 'Sure. I’ll cover mine. That’s easy.', jules: 'Our own orders, then. That works for me.', dev: 'Separate checks. Fair enough. No argument from me.' }[dateId]);
  }
  const dessert = DESSERTS.find(item => item.id === context.choice);
  if (dessert && !quiet && cue === 'dessert-ordered') {
    const reactions: Record<DateId, Record<typeof DESSERTS[number]['id'], string>> = {
      mira: { chocolate: 'Chocolate fondant. Yes. I’m prepared to be very undignified about the middle.', lemon: 'Lemon it is. I usually go for chocolate, but I’m curious about this.', berries: 'Strawberries and cream. Uncomplicated. That sounds good tonight.' },
      jules: { lemon: 'Lemon posset. Excellent. My grandmother would immediately have notes.', chocolate: 'Chocolate, then. I favor lemon, but a warm middle makes a reasonable argument.', berries: 'Berries and cream. I respect a dessert that gets to the point.' },
      dev: { berries: 'Strawberries and cream. Perfect after dinner. Sometimes the simple thing is the right thing.', lemon: 'Lemon posset. Good call. I like something sharp after a meal.', chocolate: 'Chocolate fondant. All right. I usually choose berries, but I’m willing to be persuaded by pudding.' },
    };
    line = date(reactions[dateId][dessert.id]);
  }
  // The human already said which one they wanted: the date goes with it instead of their own favourite.
  if (dessert && !quiet && cue === 'dessert-date-choice' && context.named) line = date(`${spokenDessert(dessert.id)} it is, then. I’ll let Eli know.`);
  // Eli leads the course changes; the date reacts after the plates move. Little earned yet means no remark at the check.
  if (cue === 'main-finished') return [waiter(mainOffer(context.bites)), line];
  if (cue === 'bill-requested') return context.reserved && !quiet ? [waiter(BILL_LEFT)] : [waiter(BILL_LEFT), line];
  if (cue === 'welcome') extra.push(waiter('Welcome in. Your table is ready whenever you are.'));
  if (cue === 'ordered') extra.push(waiter(context.humanDish ? 'Lovely. I’ll put both of those through.' : 'Lovely. I’ll put that through for you.'));
  if (cue === 'main-served') extra.push(waiter(MAIN_DELIVERY[context.dish ?? ''] ?? 'Here we are. Careful, the plates are warm.'));
  if (cue === 'dessert-served') extra.push(waiter(dessert ? { lemon: 'Lemon posset, with shortbread. Enjoy.', chocolate: 'Chocolate fondant. The plate is warm; mind the middle.', berries: 'Strawberries and cream. Two spoons, and I’ll leave you to it.' }[dessert.id] : 'Here’s dessert. Two spoons, and I’ll leave you to it.'));
  if (cue === 'wrong-order') extra.push(waiter('Oh, that’s for the next table. I’m sorry. Let me check the ticket.', 'embarrassed'));
  if (cue === 'wrong-order-returned') extra.push(waiter('Thank you for pointing that out. Your original order is on its way.'));
  if (cue === 'wrong-order-kept') extra.push(waiter('If you’re happy with it, that’s fine. I’ve checked the other table’s order too.'));
  if (cue === 'spill') extra.push(waiter('I’m so sorry. Fresh napkins and another glass, right away.', 'embarrassed'));
  if (cue === 'spill-fixed') extra.push(waiter('Thank you. I’ve replaced the water. Let me know if you need anything else.'));
  if (cue === 'diner') extra.push({ speaker: 'diner', text: 'I’m having a conversation. I didn’t realize the entire restaurant was listening.', emotion: 'defensive' });
  if (cue === 'diner-quiet') extra.push({ speaker: 'diner', text: 'All right. I’ll take it outside.', emotion: 'defensive' });
  if (cue === 'bill-settled') extra.push(waiter('All taken care of. Thank you both, and have a good evening.'));
  // A plain "Thank you." belongs after the plate is down, not before.
  return quiet && (cue === 'main-served' || cue === 'dessert-served') ? [...extra, line] : [line, ...extra];
}

/** Enumerated variants let the clip CLI pre-generate every fixed response. */
export const STORY_CUE_VARIANTS: { id: string; context: StoryCueContext }[] = [
  { id: 'default', context: {} },
  { id: 'variation-1', context: { variation: 1 } },
  { id: 'variation-2', context: { variation: 2 } },
  ...ENDING_MOTIFS.map(endingMotif => ({ id: `ending-${endingMotif}`, context: { endingMotif } })),
  ...DESSERTS.map(item => ({ id: item.id, context: { choice: item.id } })),
  ...DESSERTS.map(item => ({ id: `named-${item.id}`, context: { choice: item.id, named: true } })),
  ...['split', 'treat', 'separate'].map(choice => ({ id: choice, context: { choice } })),
  ...['guarded', 'hurt', 'leaving'].map(resolution => ({ id: resolution, context: { resolution } })),
  { id: 'reserved', context: { reserved: true } },
  ...Object.keys(MAIN_DELIVERY).map((dish, index) => ({ id: `main-${index}`, context: { dish } })),
  ...Object.keys(MAIN_DELIVERY).map((humanDish, index) => ({ id: `ordered-${index}`, context: { humanDish } })),
  { id: 'bites-0', context: { bites: 0 } },
  { id: 'bites-1', context: { bites: 1 } },
];
