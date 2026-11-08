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
    voiceHabits: 'Quick, playful, specific observations; a joke can give way to one plain honest sentence. Terrible puns in moderation. She can let silence stand. Do not put a question at the end of every reply or turn every object into a photography metaphor.',
    preferences: 'Tomato rigatoni, chocolate fondant, crunchy bread, live music, sharing a taste when both people agree. She dislikes overcooked vegetables, surprise photographs of people, and calling every favor an emergency. She appreciates practical help that does not take over.',
    preferredMain: 'Roasted tomato rigatoni', preferredDessert: 'chocolate',
    vulnerability: 'She finds it easier to be useful and entertaining than to ask for attention for her own work. She worries her quiet photographs will seem ordinary without a big event around them. Kindness is welcome; rescuing her career or deciding her exhibition for her is not.',
    dinnerArc: 'Begin with food-sharing banter and a quick observation. During the main course, let being off duty feel unfamiliar. The coaster game gives her permission to be ridiculous rather than impressive. A saved napkin drawing can prompt the first mention of her unbooked photo show. Dessert can bring a small decision to choose her own prints. A warm farewell offers another outing; a friendship farewell still leaves a real connection.',
    disclosureRules: 'Reveal the exhibition gradually when the conversation or a shared activity earns it. If guarded or hurt, keep details private and state what she needs. Do not claim the human drew a camera, promised to attend, fixed her overcommitting, or agreed to another date unless the transcript or scene records it. An apology permits a conversation, not instant trust.',
  },
  jules: {
    occupation: 'Book restorer at a small conservation workshop; repairs bindings, paper tears, and damaged family books.',
    backstory: 'Jules, 29, learned to cook with their grandmother Inez. When Inez moved to a smaller home, she gave them her much-annotated cookbook to repair. She is alive and opinionated, and still texts corrections. Jules can restore someone else\'s handwriting carefully but has trouble adding a recipe or note of their own.',
    everydayLife: 'They commute by train with a paperback, watch old films on Tuesday evenings, and buy unglamorous postcards from museum shops. Their bookmarks are usually old bus tickets. They have been trying to recreate Inez\'s lemon pudding, despite three contradictory notes in its margin.',
    voiceHabits: 'Measured, observant, dry wit; brief statements and the occasional well-aimed question. Warmth appears in remembering details, not constant praise. Comfortable pauses are allowed. One book comparison goes further than three, and trust is never a meter they discuss.',
    preferences: 'Mushroom risotto, lemon posset, independent bookshops, old films, clear intentions, and someone who can disagree without making it a performance. They dislike truffle oil overwhelming a dish, intrusive family questions, and treating a quiet moment as a failure.',
    preferredMain: 'Wild mushroom risotto', preferredDessert: 'lemon',
    vulnerability: 'Preserving other people\'s stories can become a way to avoid writing anything personal. They want the restored cookbook to contain a recipe of their own, but dislike being pushed to turn a modest hope into a grand confession.',
    dinnerArc: 'Begin reserved and quietly amused. Dinner brings a specific craft or cookbook anecdote. They become unexpectedly competitive at coasters, but recover from losing without an argument. Keeping the napkin drawing gives them something new to place in an old book. Lemon dessert connects memory with trying their own version. The farewell can be an invitation, a recipe-sharing friendship, or a clear courteous ending.',
    disclosureRules: 'Inez is not deceased; do not invent bereavement. Their identity is not a puzzle or a subject the player is owed an explanation of. A thoughtful interaction may invite a personal detail, but guarded Jules can decline. Do not claim a family recipe was shared or a drawing was kept unless it happened. No instant intimacy after a single compliment.',
  },
  dev: {
    occupation: 'Bicycle mechanic who cooks ambitious dinners for friends after work; enthusiastic amateur, not a restaurant chef.',
    backstory: 'Dev, 28, wants to start a small food truck called Second Helping. His older sister Leena has taste-tested his sauces for years. He hides ingredient costs and menu ideas in a spreadsheet named Bike Parts, because calling it a business plan would make failure feel possible.',
    everydayLife: 'He plays pickup basketball on Thursdays, repairs friends\' bikes too cheaply, and tests one sauce until he is tired of tasting it. His food truck has no financing, truck, or launch date. He likes being good at things and is learning to enjoy a night he cannot manage.',
    voiceHabits: 'Direct, energetic, lightly competitive; confident opinions with a willingness to revise them. Short teasing remarks, then an honest admission when needed. No macho nicknames, constant challenges, repeated culinary lectures, or an endless chain of follow-up questions.',
    preferences: 'Lemon and herb chicken, spicy food at home, strawberries and cream after a heavy meal, pickup basketball, honest feedback, and letting restaurant staff correct a mistake without humiliation. He dislikes oversweet sauces, food dares, and put-downs disguised as banter.',
    preferredMain: 'Lemon & herb chicken', preferredDessert: 'berries',
    vulnerability: 'He is afraid that saying he wants a food truck will turn a private wish into a public test. Taking over an order or making every activity competitive protects him from uncertainty. He can recognize that habit and stop; the player should not have to flatter him into basic respect.',
    dinnerArc: 'Begin with a strong food opinion and a small effort not to order for someone else. Let him enjoy the main course without judging it endlessly. Coasters can loosen his need to win. A shared drawing or a good conversation can get him to name the food truck idea. Dessert gives him a chance to accept someone else\'s choice. The farewell may invite a future taste test, offer friendship, or accept a mismatch without turning it into defeat.',
    disclosureRules: 'Do not present him as an established chef or truck owner. Reveal the plan in small pieces when comfortable; a guarded Dev may keep it private. He can admit he was overbearing and apologize without demanding reassurance. Paying for dinner never buys affection, and winning coasters never decides the relationship.',
  },
};

export const STORY_CUE_KEYS = [
  'welcome', 'seated', 'ordered', 'main-served', 'taste', 'main-finished',
  'coasters-start', 'coasters-win', 'coasters-loss', 'coasters-draw', 'napkin-kept', 'quiet-window',
  'dessert-ordered', 'dessert-served', 'dessert-shared', 'dessert-skipped',
  'bill-requested', 'bill-settled', 'farewell-invite',
  'wrong-order', 'wrong-order-returned', 'wrong-order-kept', 'spill', 'spill-help', 'spill-wiped', 'spill-fixed',
  'diner', 'diner-quiet', 'diner-ignored', 'repair', 'boundary-warning', 'date-leaving',
  'ending-another-evening', 'ending-new-friend', 'ending-second-chance', 'ending-quiet-goodbye', 'ending-early-exit', 'ending-walked-away',
] as const;
export type StoryCueKey = typeof STORY_CUE_KEYS[number];
export interface StoryCueContext { choice?: string; dish?: string; resolution?: string }
const date = (text: string, emotion: Emotion = 'warm'): SceneUtterance => ({ speaker: 'date', text, emotion });
const waiter = (text: string, emotion: Emotion = 'warm'): SceneUtterance => ({ speaker: 'waiter', text, emotion });

const CUES: Record<DateId, Record<StoryCueKey, SceneUtterance>> = {
  mira: {
    welcome: date('There you are. I was pretending to be less curious about you than I am.', 'amused'),
    seated: date('Good. No camera, no seating chart, and nobody asking me to get their good side. I like this already.'),
    ordered: date('I’m getting the tomato rigatoni. A bold choice for someone who owns too many white shirts.', 'amused'),
    'main-served': date('Oh, that smells good. My plan to be very elegant about dinner is in danger.', 'amused'),
    taste: date('Mm. I was going to make a clever observation, but the sauce has taken over.', 'amused'),
    'main-finished': date('I spend a lot of dinners photographing other people’s big nights. It’s nice having one without a camera.'),
    'coasters-start': date('A tiny sport with no paperwork. Finally, my natural habitat.', 'amused'),
    'coasters-win': date('Fine, you win. I’ll put “gracious in defeat” on next week’s list.', 'amused'),
    'coasters-loss': date('I would like to thank the table, the coaster, and a frankly irresponsible amount of confidence.', 'amused'),
    'coasters-draw': date('A draw. Very diplomatic. We can both claim we were robbed.', 'amused'),
    'napkin-kept': date('I’d like to keep this. I have a folder for a photo show I keep putting off. It could use something made for fun.'),
    'quiet-window': date('That’s the light I keep trying to photograph. The little bit after everyone stops looking. We can just enjoy it, though.'),
    'dessert-ordered': date('Dessert is an excellent reason to stay a little longer.'),
    'dessert-served': date('Well. That has my full attention.', 'amused'),
    'dessert-shared': date('I’ve been putting off a small photo show. I might choose the prints this week. No announcement. Just choose them.'),
    'dessert-skipped': date('No pudding tribunal, then. A very respectable decision. I’ll try not to appeal.', 'amused'),
    'bill-requested': date('Somehow we’ve reached the receipt part. That went quickly.'),
    'bill-settled': date('Half each sounds good. I spent my mathematics ability on camera settings.', 'amused'),
    'farewell-invite': date('Come on. I’ll walk out with you. I’m not quite ready for the evening to become an email.'),
    'wrong-order': date('That is a very confident entrance for a dish neither of us ordered.', 'surprised'),
    'wrong-order-returned': date('Good. That was easy. A mistake doesn’t need its own dramatic soundtrack.'),
    'wrong-order-kept': date('An unexpected dinner detour. All right, as long as you actually want it.', 'amused'),
    spill: date('Whoa. You okay? That reached the edge in a hurry.', 'surprised'),
    'spill-help': date('Here, take my napkin. We can rescue the table together.'),
    'spill-wiped': date('Excellent technique. The table has never looked so briefly like a tiny lake.', 'amused'),
    'spill-fixed': date('Crisis over. Nobody needs to turn this into the story of their worst shift.'),
    diner: date('I now know that stranger’s entire travel itinerary. I didn’t even get a welcome packet.', 'annoyed'),
    'diner-quiet': date('Thank you. I’d rather hear you than somebody negotiating a hotel upgrade.'),
    'diner-ignored': date('Fair enough. I’m borrowing the part of my brain that edits out wedding speeches.', 'amused'),
    repair: date('Thank you for saying that. I needed you to hear me. We can take the next bit slowly.'),
    'boundary-warning': date('Hold on. I’m not okay with that. Please listen when I tell you what I’m comfortable with.', 'annoyed'),
    'date-leaving': date('I’ve said what I’m comfortable with. I’m going to head home now. Take care.', 'defensive'),
    'ending-another-evening': date('I’d like another evening. Maybe a gallery next time. I promise not to make you inspect every frame.', 'flirtatious'),
    'ending-new-friend': date('Friends sounds right. When I put my photographs on a wall, you’re welcome to come see them.'),
    'ending-second-chance': date('I’d try a coffee another day. I appreciate the apology. Let’s give the next conversation a little more room.'),
    'ending-quiet-goodbye': date('I think we leave it here. No hard feelings. Thank you for dinner, and get home safe.'),
    'ending-early-exit': date('All right. Thanks for letting me know. I hope the rest of your night goes gently.'),
    'ending-walked-away': date('I’ve asked you to stop. I’m going home now, and I don’t want another date. Good night.', 'defensive'),
  },
  jules: {
    welcome: date('Hello. I’ve established that the chair is comfortable and the music is an argument. A promising start.', 'amused'),
    seated: date('This is a good table. We can hear each other without participating in everyone else’s dinner.'),
    ordered: date('I’ve settled on mushroom risotto. That took less time than choosing a book for the train.'),
    'main-served': date('That smells like someone gave the mushrooms time. A good sign.'),
    taste: date('I was prepared to defend mushrooms. Apparently they don’t need me.', 'amused'),
    'main-finished': date('My grandmother writes corrections in all her cookbooks. Half my cooking is arguing with her handwriting.'),
    'coasters-start': date('I should warn you that I can become unreasonable about a very small game.', 'amused'),
    'coasters-win': date('A convincing win. I’ll be gracious as soon as I’ve finished examining the table.', 'amused'),
    'coasters-loss': date('A modest triumph. I’ll try not to bring it up before dessert.', 'amused'),
    'coasters-draw': date('A draw. Annoyingly balanced. I suppose we can live with that.', 'amused'),
    'napkin-kept': date('I’d keep this as a bookmark. My grandmother uses old bus tickets. Apparently the habit skipped a generation and came back.'),
    'quiet-window': date('We don’t have to fill every minute. I like a conversation that leaves a little space.'),
    'dessert-ordered': date('A small additional chapter. I’m in favor.'),
    'dessert-served': date('That looks carefully made. I appreciate a dessert that doesn’t require a structural survey.', 'amused'),
    'dessert-shared': date('I should put one of my own recipes in my grandmother’s cookbook. There’s room. I keep acting as if there isn’t.'),
    'dessert-skipped': date('Of course. We can end a meal without giving it an extra assignment.'),
    'bill-requested': date('Whenever you’re ready. I’ve enjoyed having time to finish a thought.'),
    'bill-settled': date('Half each works. I like knowing where I stand.'),
    'farewell-invite': date('I’ll walk to the door with you. We can leave the table to its next conversation.'),
    'wrong-order': date('That appears to belong to a different plot.', 'surprised'),
    'wrong-order-returned': date('There. A correction in the margin. No need to tear out the page.'),
    'wrong-order-kept': date('As long as you want it. Accepting a surprise is optional, even at dinner.'),
    spill: date('Careful. Did any get on you? Good thing the books are at home.', 'surprised'),
    'spill-help': date('Use my napkin. This is one kind of water damage we can fix.'),
    'spill-wiped': date('That’s nearly dry. I spend enough time repairing water damage; this is a pleasantly simple case.', 'amused'),
    'spill-fixed': date('All right. A new glass, and nobody has to spend the evening feeling mortified.'),
    diner: date('I had hoped to be an observer of that conversation, rather than its involuntary stenographer.', 'annoyed'),
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
    welcome: date('Hey. I managed not to inspect the kitchen on my way in. Personal growth, before we’ve even sat down.', 'amused'),
    seated: date('Good table. And I’m going to let you read the menu before offering twelve opinions.'),
    ordered: date('I’ll have the lemon chicken. And, against instinct, I will let someone else cook it.', 'amused'),
    'main-served': date('Okay, that looks good. I can stop doing the imaginary inspection now.'),
    taste: date('Good lemon, proper seasoning. That’s my entire restaurant review. I’m off duty now.', 'amused'),
    'main-finished': date('I test recipes after work. Calling it dinner is easier than admitting it’s a plan.'),
    'coasters-start': date('Three rounds? Good. Enough time for confidence to become a mistake.', 'amused'),
    'coasters-win': date('You earned that. I’m resisting a very elaborate explanation involving the grain of the table.', 'amused'),
    'coasters-loss': date('I won. I’m choosing to say that once, at a sensible volume.', 'amused'),
    'coasters-draw': date('A draw. Fine. A healthy outcome that I will enjoy in a minute.', 'amused'),
    'napkin-kept': date('That’s going in my recipe notebook. The notebook is real. The food truck on the cover is still imaginary.'),
    'quiet-window': date('This is nice. I keep thinking of something to say, then realizing I don’t need to.'),
    'dessert-ordered': date('Good call. I can make room. That’s not a challenge, just a fact.'),
    'dessert-served': date('There we go. I’m putting the food critic away before the first bite.'),
    'dessert-shared': date('I’ve been planning a food truck. Second Helping. I hide the numbers in a file called Bike Parts, which probably isn’t fooling anyone.'),
    'dessert-skipped': date('Fine by me. Stopping when you’ve had enough is a skill. Allegedly.'),
    'bill-requested': date('Yeah. It’s been good having a night I didn’t have to run.'),
    'bill-settled': date('Half each. No competitive card-grabbing. I’m practicing.', 'amused'),
    'farewell-invite': date('I’ll walk out with you. I can manage a goodbye without making a speech. Probably.'),
    'wrong-order': date('That’s not our order. Let’s check the ticket before anybody starts a courtroom drama.', 'surprised'),
    'wrong-order-returned': date('That’s sorted. I’ve sent out the wrong thing at a dinner before. It feels bad enough already.'),
    'wrong-order-kept': date('All right. Your dinner, your call. I’m keeping my opinions out of the way.'),
    spill: date('You all right? That was close.', 'surprised'),
    'spill-help': date('Take my napkin. No point two people watching one wet table.'),
    'spill-wiped': date('Nearly there. Turns out teamwork is useful outside a basketball court.'),
    'spill-fixed': date('Good. Nobody’s hurt. We can retire this incident from active service.', 'amused'),
    diner: date('That speakerphone is doing a lot of work for a conversation nobody asked to join.', 'annoyed'),
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

const GUARDED: Record<DateId, Partial<Record<StoryCueKey, string>>> = {
  mira: { 'main-finished': 'Thanks for giving me time to finish. I don’t like being hurried through dinner.', 'napkin-kept': 'Thanks for showing me. I’m going to leave the napkin here for now.', 'quiet-window': 'A little quiet is welcome. I’d like a minute to myself.', 'dessert-shared': 'Thanks for sharing. I’m still a little quiet after earlier.', 'farewell-invite': 'I’ll head to the entrance. We can say good night there.' },
  jules: { 'main-finished': 'That was a good meal. I’m content to leave a little space after it.', 'napkin-kept': 'I appreciate you showing me. I’d rather not keep it, but thank you.', 'quiet-window': 'I’d like a quiet minute here. You don’t need to fill it.', 'dessert-shared': 'Thank you. I’m not quite ready to pick up where we left off.', 'farewell-invite': 'I’ll walk to the entrance. Then I’m going to make my own way home.' },
  dev: { 'main-finished': 'Good meal. I’m going to sit with that for a minute.', 'napkin-kept': 'Thanks for showing me. I’ll leave it here, though.', 'quiet-window': 'I need a quiet minute. Let’s leave it at that for now.', 'dessert-shared': 'Thanks. I’m still thinking about what happened earlier.', 'farewell-invite': 'I’m heading to the entrance. We can say good night there.' },
};

const ALIASES: Record<string, string> = {
  'main-arrived': 'main-served', 'spill-cleaned': 'spill-fixed',
  'dessert-arrived': 'dessert-served', 'dessert-finished': 'dessert-shared', 'napkin-finished': 'napkin-kept',
  apology: 'repair', boundary: 'boundary-warning', leaving: 'date-leaving',
};
const MAIN_DELIVERY: Record<string, string> = {
  'Roasted tomato rigatoni': 'The rigatoni is yours. Careful, the plates are warm.',
  'Lemon & herb chicken': 'Lemon chicken for you. Careful, the plates are warm.',
  'Wild mushroom risotto': 'Your mushroom risotto. Careful, the plates are warm.',
};

/** Finite authored responses; scene facts select a line, never arbitrary user text. */
export function getStoryCue(key: string, dateId: DateId, context: StoryCueContext = {}): SceneUtterance[] {
  if (!CUES[dateId]) return [];
  if (key.startsWith('farewell-') && key !== 'farewell-invite') key = key.replace('farewell-', 'ending-');
  if (['bill-split', 'bill-treat', 'bill-separate'].includes(key)) { context = { ...context, choice: key.slice(5) }; key = 'bill-settled'; }
  if (key === 'coasters-end') key = context.choice === 'win' || context.resolution === 'win' ? 'coasters-win' : context.choice === 'loss' || context.resolution === 'loss' ? 'coasters-loss' : 'coasters-draw';
  key = ALIASES[key] ?? key;
  const cue = key as StoryCueKey, base = CUES[dateId][cue];
  if (!base) return [];
  const guarded = ['guarded', 'hurt', 'leaving'].includes(context.resolution ?? '');
  if (guarded && GUARDED[dateId][cue]) return [date(GUARDED[dateId][cue]!, 'neutral')];
  let line = { ...base };
  const extra: SceneUtterance[] = [];
  if (cue === 'bill-settled') {
    if (context.choice === 'treat') line = date({ mira: 'Thank you. That was a kind offer.', jules: 'Thank you. I promise not to annotate the receipt.', dev: 'Thanks. I’ll accept that without turning it into an arm-wrestling match.' }[dateId]);
    if (context.choice === 'separate') line = date({ mira: 'Sure. I’ll cover mine. That’s easy.', jules: 'Our own orders, then. That works for me.', dev: 'Separate checks. Fair enough. No argument from me.' }[dateId]);
  }
  const dessert = DESSERTS.find(item => item.id === context.choice);
  if (dessert && cue === 'dessert-ordered') {
    const reactions: Record<DateId, Record<typeof DESSERTS[number]['id'], string>> = {
      mira: { chocolate: 'Chocolate fondant. Yes. I’m prepared to be very undignified about the middle.', lemon: 'Lemon it is. I usually go for chocolate, but I’m curious about this.', berries: 'Strawberries and cream. Uncomplicated. That sounds good tonight.' },
      jules: { lemon: 'Lemon posset. Excellent. My grandmother would immediately have notes.', chocolate: 'Chocolate, then. I favor lemon, but a warm middle makes a reasonable argument.', berries: 'Berries and cream. I respect a dessert that gets to the point.' },
      dev: { berries: 'Strawberries and cream. Perfect after dinner. Sometimes the simple thing is the right thing.', lemon: 'Lemon posset. Good call. I like something sharp after a meal.', chocolate: 'Chocolate fondant. All right. I usually choose berries, but I’m willing to be persuaded by pudding.' },
    };
    line = date(reactions[dateId][dessert.id]);
  }
  if (cue === 'dessert-shared' && context.resolution === 'kept-all') line = date({ mira: 'You’ve kept the whole dessert. I was hoping for a little of the sharing part.', jules: 'I had understood “sharing” to include both of us. Could I have a little?', dev: 'You took the lot. I’d like a bite too. This isn’t another competition.' }[dateId], 'annoyed');
  if (cue === 'dessert-shared' && context.resolution === 'gave-all') line = date({ mira: 'That’s generous, but I don’t need all of it. Keep a little for yourself.', jules: 'Thank you, but I’d rather we both had some. That was the idea.', dev: 'I appreciate it. You’re allowed some too. I’m not training for a dessert event.' }[dateId]);
  if (cue === 'welcome') extra.push(waiter('Welcome in. Your table is ready whenever you are.'));
  if (cue === 'ordered') extra.push(waiter('Lovely. I’ll put that through for you.'));
  if (cue === 'main-served') extra.push(waiter(MAIN_DELIVERY[context.dish ?? ''] ?? 'Here we are. Careful, the plates are warm.'));
  if (cue === 'dessert-served') extra.push(waiter(dessert ? { lemon: 'Lemon posset, with shortbread. Enjoy.', chocolate: 'Chocolate fondant. The plate is warm; mind the middle.', berries: 'Strawberries and cream. Two spoons, and I’ll leave you to it.' }[dessert.id] : 'Here’s dessert. Two spoons, and I’ll leave you to it.'));
  if (cue === 'wrong-order') extra.push(waiter('Oh, that’s for the next table. I’m sorry. Let me check the ticket.', 'embarrassed'));
  if (cue === 'wrong-order-returned') extra.push(waiter('Thank you for pointing that out. Your original order is on its way.'));
  if (cue === 'wrong-order-kept') extra.push(waiter('If you’re happy with it, that’s fine. I’ve checked the other table’s order too.'));
  if (cue === 'spill') extra.push(waiter('I’m so sorry. Fresh napkins and another glass, right away.', 'embarrassed'));
  if (cue === 'spill-fixed') extra.push(waiter('Thank you. I’ve replaced the water. Let me know if you need anything else.'));
  if (cue === 'diner') extra.push({ speaker: 'diner', text: 'I’m having a conversation. I didn’t realize the entire restaurant was listening.', emotion: 'defensive' });
  if (cue === 'diner-quiet') extra.push({ speaker: 'diner', text: 'All right. I’ll take it outside.', emotion: 'defensive' });
  if (cue === 'bill-requested') extra.push(waiter('Of course. I’ll leave the bill here. There’s no rush.'));
  if (cue === 'bill-settled') extra.push(waiter('All taken care of. Thank you both, and have a good evening.'));
  return [line, ...extra];
}

/** Enumerated variants let the clip CLI pre-generate every fixed response. */
export const STORY_CUE_VARIANTS: { id: string; context: StoryCueContext }[] = [
  { id: 'default', context: {} },
  ...DESSERTS.map(item => ({ id: item.id, context: { choice: item.id } })),
  ...['split', 'treat', 'separate'].map(choice => ({ id: choice, context: { choice } })),
  ...['guarded', 'hurt', 'leaving', 'kept-all', 'gave-all'].map(resolution => ({ id: resolution, context: { resolution } })),
  ...Object.keys(MAIN_DELIVERY).map((dish, index) => ({ id: `main-${index}`, context: { dish } })),
];
