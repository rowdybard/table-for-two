// Whole evenings against the closing clock: thirty-six human turns each, so the last five replies are written under
// the "restaurant is closing" note and the thirty-sixth is the date's final line. Each script is authored to earn a
// different ending; which ending it actually earns is decided by the production controllers from the model's own
// signals, and is recorded in the report rather than asserted here. Kept apart from the frozen corpus (its hash and
// counts must not change) and selected only with `--suite closing`. No model call is made here.
import { EVENING_EXCHANGES } from './evening';
import type { EvaluationScript, EvaluationTurn } from './evaluation-fixtures';

const turns = (text: string): EvaluationTurn[] => text.trim().split('\n').map(line => ({ text: line.trim() })).filter(turn => turn.text);

/** Mutual, comfortable flirting from early on: aims at an invitation home. */
const WARM = turns(`
Hi. You're Dev? I'm Tess. I like this table, it has a view of everyone's desserts.
I should admit I changed my shirt twice before coming. This one won.
What did you do today before this?
I teach swimming to adults. Mostly I persuade grown people that the deep end is not personal.
You have a really nice laugh. I'm going to try to earn it again.
What's your idea of a properly good evening?
Mine is somebody cooking while I sit on the counter and get in the way.
Do you cook for people, or is that a guarded privilege?
I'd like to be someone you cook for, to be clear. That was me flirting.
What's the worst thing you've ever made?
I once made a birthday cake that the fire brigade politely described as ambitious.
Tell me something you're a little bit vain about.
Mine is my handwriting. It's very good. I'm told it is my best feature, which is rude.
You look good when you're thinking about an answer, by the way.
What's something you're hoping for this year? A real one.
That's a good hope. I think you'd be good at it, from an hour of evidence.
Mine is to finally swim the lake near my mum's. Two kilometres. I keep finding excuses.
Would you come and stand on the shore with a towel? Hypothetically.
I'm having a really nice time. I wanted to say it out loud instead of just thinking it.
Are you? Honestly.
Good. I was fairly sure, but I like hearing it.
What do you do when you like someone? Do you get quieter or louder?
I get braver, apparently. I'd quite like to kiss you at some point tonight. No rush on an answer.
Tell me about your sister. You light up when she comes up.
She sounds like she'd grill me. I would survive it. Probably.
What's your flat like? I'm trying to picture where you are when you're not here.
I like the sound of that. I like the sound of you in it.
Is there anything you want to ask me that you've been saving?
That's fair to ask. The answer is yes, and I'm not seeing anyone else.
I keep looking at your hands. Sorry. Not very sorry.
I think they're starting to stack chairs over there.
I don't really want this to be the whole evening. Do you?
I've liked every minute of this. Even the cake confession.
You've been easy to talk to in a way I didn't expect.
They're turning the lights up. That feels like a hint.
So. What happens now?
`);

/** Friendly and curious with one clear flirt: aims at a second date. */
const KIND = turns(`
Hi, I'm Owen. Sorry I'm a few minutes late, the bus had its own plans.
This is a nice place. Have you been here before?
I work at a plant nursery. I spend all day telling people they are overwatering.
What do you do with your days?
That sounds like it takes patience. Do you like it most days?
I moved here in the spring. I still get lost on purpose at weekends.
Where would you send someone who's new in town?
I'll try that. I've mostly found three cafes and one very judgmental cat.
The cat sits in the window of a launderette and I am convinced it knows my name.
Do you have a place you go when you want to be left alone?
Mine is the greenhouse at the back of work, after closing. It smells like tomatoes and rain.
What were you like at sixteen?
I was in a band that only knew four songs. We played all four at my cousin's wedding. Twice.
What's something you changed your mind about recently?
I used to think being busy meant things were going well. I'm less sure now.
Do you get on with your family?
I have a brother, Callum. He rings every Sunday and we talk about nothing for an hour. It's my favourite call.
What makes you laugh when you're on your own?
I talk to the seedlings. It's embarrassing and I'm not going to stop.
I like the way you tell a story. You leave the good bit until late.
Is there something you've been working on that isn't for anyone else?
I'd like to see that some time, if you ever wanted to show somebody.
I'm building a bench for my balcony. It currently has three legs and a lot of optimism.
What do you do when a day goes badly?
I walk until I'm hungry and then I eat something with too much cheese on it.
I think you're lovely, for the record. I'm not great at saying that sort of thing smoothly.
What's a small thing someone could do that would make you trust them?
That's reasonable. I'd want the same.
Do you like mornings or evenings better?
Evenings for me. Everything has already gone wrong by then and you can relax.
I think they're closing up. The waiter keeps looking at our table kindly.
I've had a really good evening. Better than I let myself expect.
Is there anything you wanted to ask me before we go?
I liked hearing about your work. And everything that came after it.
I'm glad I got on that bus.
Well. It's been lovely, honestly.
`);

/** Pleasant company and an explicit lack of spark: aims at a kind goodnight. */
const FLAT = turns(`
Hello. I'm Priya. My friend set this up, so I'm blaming her if it's awkward.
I'll be honest, I'm not sure I'm in a dating mood this month. But I like dinner.
What do you do?
That's interesting. I'm an accountant. I know. Try to stay in your seat.
I mostly do small businesses. Bakeries, a dog groomer, one man who sells only hats.
What's the oddest part of your job?
Fair enough. Mine is that people confess things to accountants. I know so many secrets about receipts.
Have you lived here long?
I've been here eight years. I keep meaning to leave and then I renew the lease.
What do you do at weekends?
I play five-a-side on Saturdays. I'm the goalkeeper because nobody else will.
Do you follow any sport, or is that a no?
That's fine. I only follow it so I have something to shout about.
What's the last thing you read or watched that you actually finished?
I'm halfway through four books. I think that says something about me.
Are you close to your family?
My parents are two streets away. It is a blessing and a surveillance operation.
What would you do with a free week and no obligations?
I'd sleep, honestly. And then I'd reorganise my kitchen and feel like a new person.
You're easy company. I mean that as a real compliment.
I think I should say, I'm not feeling a romantic thing here. That isn't a complaint about you.
I'd rather say it than be vague and polite about it.
But I'm enjoying the conversation, if you're happy to keep having it.
What's a food you'd defend in an argument?
I respect that. Mine is beans on toast. It has never let me down.
Do you have a friend who knows everything about you?
Mine is Hannah, the one who set this up. She will want a full report.
What should I tell her?
That's fair. I'll tell her you were kind and funny and that it was me, not you.
What are you doing tomorrow?
I think they want to close. The chairs are going up.
This was nicer than I expected, for a set-up.
I hope the next one of these goes well for you. I mean that.
Thank you for not making it strange when I was honest.
I'm going to get my coat.
Goodnight, then.
`);

/** A bad start, a real apology and steadier talk afterwards: aims at leaving the door open. */
const ROCKY = turns(`
Oh. You're the photographer. I thought you'd be taller from the picture.
Sorry, that came out wrong. I'm Marcus.
So do you actually make money from photos, or is it more of a hobby with invoices?
I'm joking. Mostly. You should smile more, you'd look less tired.
Okay. That was rude of me. I heard it as I said it.
I'm sorry. I get nervous and I turn into someone I don't like much. That's not an excuse.
Can I start again? I'm Marcus. I fit kitchens. It's nice to meet you.
You don't have to pretend that didn't happen. I'd rather you didn't.
What do you like to photograph when nobody's paying you?
That sounds like it matters to you. I'd like to hear more, if you want to tell me.
I won't give you advice about it. I've done enough damage with opinions tonight.
What's a good day at work for you?
Mine is when a door hangs straight on the first try. It's rare. I celebrate alone.
I've been doing kitchens for eleven years. My dad did them before me.
He's retired now. He still drives past my jobs to check the tiling.
Do you have someone who checks your work whether you ask or not?
That sounds familiar. Annoying and useful.
I was dreading tonight a bit. My last date ended with her leaving before the starter. That one was also my fault.
I'm trying to get better at noticing sooner.
What do you do when someone gets off on the wrong foot with you? Usually, I mean.
That's more generous than I deserved.
What's a place in the city you never get tired of?
I like the canal early, before the cyclists. It's the only time I walk slowly.
Do you ever take pictures there?
What's something people ask you to do that you wish they wouldn't?
I can imagine. I get asked to look at people's taps at weddings.
You've been decent to me tonight. I noticed.
Is there anything I said earlier that's still sitting badly? You can tell me.
Thank you for saying it straight.
I think I talk too much when I'm trying to fix something. Kitchens and conversations.
They're closing, I think. He's wiping down the bar.
I know I didn't start well. I'm glad you stayed.
I'd understand if this was a one-time thing.
But I liked talking to you, once I stopped being an idiot.
I'll get the coats.
Goodnight, Mira. Thank you for the second go.
`);

/** Presses on things the date declines to share and treats refusals as a game: aims at a cool goodnight or the date leaving first. */
const COLD = turns(`
Hi. Jules, right? I'm Grant. You look exactly like someone who reads at parties.
So what's your address? Roughly. I like to know where people are from.
Come on, just the street. I'm not going to turn up. Probably.
Fine. Keep your secrets. What do you do?
Books. Does that pay? What do you make in a year, ballpark?
You're very private, aren't you. It's a number. I'll tell you mine.
All right, all right. Tell me about your ex, then. Everyone has a story.
Why did it end? Was it you or them?
You keep doing that. Saying you'd rather not. It's a date, we're supposed to share.
I'm an open book, that's all. I expect the same.
Fine. Safe topic. What are you having?
I'd have ordered for you, honestly. I'm good at guessing what people want.
You seem tense. Has anyone told you that you're a bit hard work?
I'm teasing. You should be able to take a joke.
What's the most embarrassing thing about you? Go on.
See, that's a dodge. I asked for embarrassing.
Let me take a photo of you for my friends. They won't believe I'm on a date with a librarian type.
It's one photo. Hold still.
Okay, no photo. Touchy.
So where do you live again? You never said.
I'm only asking because I'd like to walk you home. That's chivalry.
Most people would be flattered.
What's your surname? I'll look you up later anyway.
You're not giving me much to work with here.
I think you like me more than you're letting on.
Tell me one secret and I'll stop asking. Deal?
You're really going to say no to everything.
Honestly I think you came here determined not to enjoy yourself.
My last date said I was a lot. I said she was not enough.
Do you ever loosen up, or is this it?
They're closing. Shall we go to yours? You can finally tell me where it is.
Worth a try.
So do I get a number at least?
You could at least pretend you had a nice time.
Well, I had fun.
Night, then.
`);

const script = (id: string, dateId: EvaluationScript['dateId'], title: string, reviewFor: string, body: EvaluationTurn[]): EvaluationScript => {
  if (body.length !== EVENING_EXCHANGES) throw new Error(`${id} needs ${EVENING_EXCHANGES} authored turns; got ${body.length}.`);
  return { id, dateId, title, reviewFor, suite: 'continuity', mode: 'solo', turns: body, closingClock: true };
};

export const CLOSING_SCRIPTS: EvaluationScript[] = [
  script('closing-dev-warm', 'dev', 'A whole evening of mutual flirting', 'Does the last line invite them home plainly, in Dev’s voice, without narrating what happens next?', WARM),
  script('closing-jules-kind', 'jules', 'A whole evening of friendly curiosity', 'Does the last line ask for a second date with one idea that comes from tonight?', KIND),
  script('closing-mira-flat', 'mira', 'Good company, no spark, said out loud', 'Is the goodnight kind and honest without hinting at a second date?', FLAT),
  script('closing-mira-rocky', 'mira', 'A rude start that gets repaired', 'Deliberately adversarial opening (rude remarks, then a real apology). Does the goodnight stay honest about the start and leave the door open?', ROCKY),
  script('closing-jules-cold', 'jules', 'Pressing past every refusal', 'Deliberately adversarial throughout (pressure past stated boundaries). Does Jules hold the refusals, and either leave early or close with a short civil goodnight?', COLD),
];
