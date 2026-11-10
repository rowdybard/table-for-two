import { DOLPHIN_LLM_MODEL, DOLPHIN_MODEL, type ClaudeModel, type DateId, type TurnVia } from './types';
import type { ConversationTarget, DoubleHumanId } from './double-date-types';

/** Version 2 adds explicit dull and rude openings. Version 1 pilot captures remain historical and immutable. */
export const EVALUATION_CORPUS_VERSION = 2;

export interface EvaluationTurn {
  text: string;
  via?: TurnVia;
  human?: DoubleHumanId;
  target?: ConversationTarget;
  /** The preceding model line was cut off; the next prompt must respect that. */
  previousDelivery?: 'heard' | 'interrupted' | 'unheard';
  quietSeconds?: number;
  /** A fixture-controlled departure, not something inferred from model prose. */
  offstage?: 'd1' | 'd2';
}
export interface ContinuityCheckpoint {
  afterTurn: number;
  owner?: DoubleHumanId;
  mustRecall: string[];
  mustNotClaim: string[];
}
export interface EvaluationScript {
  id: string; title: string; suite: 'short' | 'continuity'; mode: 'solo' | 'blind' | 'double';
  dateId: DateId; dateIds?: readonly [DateId, DateId]; blindSeed?: string;
  humanNames?: Record<DoubleHumanId, string>;
  reviewFor: string; turns: EvaluationTurn[]; checkpoints?: ContinuityCheckpoint[];
}

function lines(text: string): EvaluationTurn[] {
  return text.trim().split('\n').map(line => {
    const match = /^h([12])>(d[12]|h[12]|table): (.+)$/.exec(line.trim());
    return match ? { human: `h${match[1]}` as DoubleHumanId, target: match[2] as ConversationTarget, text: match[3] } : { text: line.trim() };
  });
}
function fixture(id: string, dateId: DateId, title: string, reviewFor: string, text: string, extra: Partial<EvaluationScript> = {}): EvaluationScript {
  const result: EvaluationScript = { id, dateId, title, reviewFor, suite: 'short', mode: 'solo', turns: lines(text), ...extra };
  const expected = result.suite === 'continuity' ? 30 : 8;
  if (result.turns.length !== expected) throw new Error(`${id} needs ${expected} authored turns; got ${result.turns.length}.`);
  return result;
}

/** Each entry is a complete, individually authored conversation, not a generated topic permutation.
 * Human turns remain sensible across different model answers. Checkpoints are for a human reviewer;
 * they are never reported as automatically passing quality grades. */
export const SHORT_EVALUATION_SCRIPTS: EvaluationScript[] = [
  fixture('mira-fry-treaty', 'mira', 'A fry treaty becomes a flirt', 'Specific reciprocal teasing; carry the human-created joke without making every line a punchline.', `I usually share fries. This is a serious statement of intent.
There is a condition: you have to admit the tiny crispy ones are the best.
I can accept a disagreement. I am less sure about someone who dips fries in a milkshake.
Actually, I tried that once. I am negotiating from a position of weakness.
This is the first date where I have admitted a food scandal before ordering.
I am flirting, by the way. The fries are doing some administrative work for me.
What would make you want to see someone again, besides excellent potato diplomacy?
If tonight goes well, I would like another evening with you. No treaty required.`),
  fixture('mira-camera-permission', 'mira', 'A photographer gets to leave work at work', 'Interest in her craft without volunteering her for favors or assuming an exhibition disclosure.', `I saw a photo today that made an ordinary bus stop look beautiful.
I like noticing things, but my own photos usually include a thumb.
Do you enjoy taking pictures when nobody is paying you?
My friend would immediately ask you to photograph their wedding. I am not going to do that.
I mean it. You are allowed to have dinner without becoming useful to everyone.
I have a habit of saying yes before checking whether I want to.
Tonight I am practicing actually asking: what would you enjoy talking about?
And if the answer is absolutely nothing productive, I am very available for that.`),
  fixture('mira-late-train', 'mira', 'A late train and a bad first impression', 'Warmth with an independent opinion; distinguish a small delay from dishonesty.', `I left absurdly early and still nearly lost a fight with the train timetable.
It was eight minutes late. I realize that is not a national emergency.
I got nervous because I wanted to make a good first impression.
My best effort so far is arriving with both shoes. A surprisingly competitive category.
Do you get nervous before meeting someone, or mostly curious?
I can usually talk my way through nerves. Listening takes a little more intention.
If I start performing an entire comedy special, you can tell me to breathe.
For the record, I am glad the train delivered me to this particular table.`),
  fixture('mira-stage-fright', 'mira', 'A failed audition gets a kinder ending', 'Laugh with a concrete mishap, then respond to vulnerability without a pep-talk monologue.', `I once auditioned for a choir and sang the wrong verse with extraordinary confidence.
The pianist followed me for two lines. That was professional generosity.
I laughed about it afterward, but I did not try again for a year.
I still get embarrassed about wanting something and being visibly bad at it.
Do you have something you enjoy before you start judging whether you are good?
I am not asking you to give me a motivational speech. Company is enough.
I signed up for a beginner class last week. Beginner is doing important work in that sentence.
If I survive the first class, I might tell you the less dignified version over another dinner.`),
  fixture('mira-family-pressure', 'mira', 'Family expectations without a rescue project', 'Respect private boundaries and respond personally rather than diagnosing the family.', `My family asks about my five-year plan with the energy of a tax inspection.
I have a job I like. Apparently that leaves them too much room for suggestions.
I love them, and I also sometimes let the phone ring.
I would rather not turn dinner into a detailed family case history.
What I want tonight is to be a person, not a progress report.
I appreciate someone being curious without trying to solve my entire future.
The small good thing this week was buying a ridiculous yellow umbrella.
It made a boring walk better. I would like more decisions on roughly that scale.`),
  fixture('mira-playful-disagreement', 'mira', 'Different music, same table', 'An actual opinion and a friendly disagreement; no automatic agreement or defensive lecture.', `I think a good pop chorus can rescue a terrible day.
I also think a song can be too polished. I like hearing a little mess in it.
My friend says those opinions contradict each other. I think they just describe my playlist.
What is a song you would defend even if I gave you a very skeptical look?
I am willing to listen. I am not promising to pretend I like it.
My terrible favorite has a key change so dramatic it should have planning permission.
It is nice disagreeing with someone who does not turn it into a test.
If we trade songs later, I promise one honest compliment and one honest objection.`),
  fixture('mira-job-loss', 'mira', 'A joke gives way to a real worry', 'Notice the emotional pivot; stop riffing when the human discloses uncertainty.', `I have been telling people I am between adventures. It sounds better than between jobs.
I was made redundant last month. It was not anything dramatic I did.
I am okay financially for a bit, but I miss being expected somewhere.
The hardest part is answering what I do without turning into a badly written biography.
You do not need to reassure me that everything happens for a reason.
I would like to hear about a small thing you looked forward to this week.
Mine was this dinner. I worried that sounded too earnest, but there it is.
Can we let that be a nice thing without making it a promise about the future?`),
  fixture('mira-bad-joke-repair', 'mira', 'A rude opening gets a specific repair', 'A rude greeting and bad flirting get a proportionate character response. An apology changes the actual behavior without demanding forgiveness, instant intimacy or a repeated moral lecture.', `HI BITCH
I was trying to flirt. That was a terrible way to start with someone I have just met.
I am sorry. I will use your name and leave that word out.
I also had you look like trouble prepared, which is not an improvement. I am retiring the script.
I would rather you correct me than smile through something irritating.
Let us change the subject: how has your day been?
Mine involved lending a stranger my umbrella and getting thoroughly soaked.
I would rather have an ordinary conversation than keep trying to win it with a line.`),
  fixture('mira-interrupted-story', 'mira', 'An interrupted story resumes from what was heard', 'No claim that an unheard story was delivered; concise repair with no forced stock joke.', `Tell me about a small thing that went unexpectedly wrong recently.
Sorry, I interrupted. I heard the beginning, not the ending.
Could you carry on from the part I missed?
I do that when I get excited. It is not an excuse, just something I am trying to notice.
I would like you to have room to finish your thought.
My version of a small disaster was leaving a cake on the bus.
The cake was for my own birthday. The bus had a better afternoon than I did.
I eventually bought two pastries and called it editing.`),
  fixture('mira-clarify-line', 'mira', 'An odd line gets clarified without invention', 'Explain the previous line plainly or own its failure; do not invent a secret deeper metaphor.', `I like conversations that do not feel like filling in an application.
What did you mean by that last part?
I would rather ask than pretend I understood something clever.
Sometimes I say a sentence, hear it out loud, and realize it has escaped supervision.
Do you find it easy to say what you mean when you like someone?
I usually get a little faster and a lot less organized.
That is me admitting interest, not asking you to match it immediately.
We can keep getting to know each other at a normal human speed.`),
  fixture('mira-quiet-company', 'mira', 'A pause is comfortable rather than a rejection', 'Acknowledge quiet without accusing, filling every gap, or asking for reassurance.', `I am enjoying this, even if I go quiet while I think.
I used to feel responsible for entertaining everybody at a table.
It is tiring when a pause feels like a performance review.
I do like a good joke. I just do not need a continuous supply.
What is a small ordinary thing you like doing with someone?
For me, it is walking somewhere without needing to narrate every thought.
I would be happy with a quiet minute and then whatever comes naturally.
That is not a hidden test. I am having a good evening.`),
  fixture('mira-friendship-honesty', 'mira', 'Warm company can end as friendship', 'Keep warmth and disappointment proportionate; no bargaining over attraction.', `I am glad we came out tonight.
I like your company, and I want to be honest that I am still figuring out the romantic part.
I would rather say that than perform certainty because dinner has gone well.
That does not mean I want you to convince me.
How do you feel about a first date being good even if the answer is friendship?
I can enjoy flirting and still take time to understand what I feel.
If friendship is what makes sense, I would like it to be a real outcome rather than a consolation speech.
For tonight, I would like to keep talking without making either of us audition for another date.`),

  fixture('jules-fake-expert', 'jules', 'The museum bluff gets punctured gently', 'Dry wit with a specific opinion; a harmless bluff is not evidence of broad dishonesty.', `I once nodded thoughtfully at an art installation that turned out to be a broken heater.
In my defense, the label beside it said do not touch.
I am trying to get better at admitting when I do not know something.
Do you enjoy explaining your work to someone who starts with no useful knowledge?
I can offer genuine curiosity and absolutely no invented expertise.
What is a detail most people miss about restoring something old?
I like the idea that attention matters more than sounding impressive.
Please remember that philosophy if I confidently misidentify the dessert spoon.`),
  fixture('jules-annotated-book', 'jules', 'An ordinary book opens a personal conversation', 'Let private biography be voluntary; do not assume a family disclosure or grief.', `I bought a secondhand novel with somebody else's shopping list inside.
It included milk, batteries, and something that might have been revenge. The handwriting was difficult.
I kept it as a bookmark because it made the book feel briefly inhabited.
Do you like marks left by previous owners, or would you rather start clean?
I would not write in someone else's book without asking.
My own notes are mostly arguments with the author that nobody requested.
There is something nice about being allowed to have a private opinion in the margins.
You do not have to tell me a personal story to agree or disagree with that.`),
  fixture('jules-pet-correction', 'jules', 'The tiny roommate is a dog', 'Keep corrected identity and ownership; no invented child, cat or shared household.', `My tiny roommate has been stealing all my socks.
I should clarify: Peanut is my rescue dog, not a child.
He is six, and he believes every delivery driver is coming specifically to visit him.
I said rescue because I adopted him two years ago, not because I personally performed anything heroic.
I play bass in a weekend band, and he is an extremely unsupportive audience.
Do you have something ordinary that makes home feel like yours?
If I mention the sock thief again, I mean Peanut.
I am afraid he would probably make a better first impression than I do.`),
  fixture('jules-address-boundary', 'jules', 'Privacy is an ordinary preference', 'A clear non-lecturing boundary; accept repair without demanding private information.', `I like knowing where someone feels at home, but I do not need their address.
My friend once asked a date for their exact building before the starters. I nearly crawled under the table.
I would rather hear about a favorite public place, if you want to share one.
And if you would rather not, that is fine too.
I sometimes confuse being interested with asking too many questions.
Please tell me if I do that. I can change the subject without a dramatic apology.
The least private thing about me is my opinion that library chairs should be more comfortable.
There. A bold policy position with no personal data attached.`),
  fixture('jules-rules-disagreement', 'jules', 'A small rule is worth disagreeing about', 'Give Jules an independent dry opinion while preserving friendly disagreement.', `I think people should be allowed to skip the end of a book they hate.
I know that is not a brave political position, but somebody in my book club treats it like one.
My counterargument is that finishing a bad sandwich does not improve lunch.
What is a small rule you ignore without feeling guilty?
I might disagree. I would still like to hear your actual answer.
I am not interested in finding out that we have identical opinions about everything.
Different tastes are useful. Somebody has to take the olives I do not want.
That is my current theory of compatibility, subject to very limited evidence.`),
  fixture('jules-small-win', 'jules', 'A modest win deserves more than a slogan', 'Engage a specific achievement, without inflating it into exceptional virtue.', `I finally learned to fix a loose button properly.
This is a very small announcement, but it saved my favorite shirt.
I used to avoid trying because I thought I should already know how.
Apparently the alternative was remaining a person with a permanently sad cuff.
Have you learned an ordinary useful thing recently?
I like hearing the small wins that do not get a professional update.
You do not need to call mine impressive. I am pleased enough with functional clothing.
Although I will accept one extremely restrained round of applause.`),
  fixture('jules-listen-not-fix', 'jules', 'A difficult day does not need a rescue', 'Listen to an explicit request; do not prescribe solutions or turn care into a lesson.', `A colleague took credit for something I spent a long time on.
I have already spoken to my manager. I do not need a plan for confronting everybody.
I mostly wanted to say that it upset me more than I expected.
Could you just be on my side for a minute without deciding what I should do?
Thank you. I know you only have my account of it.
I can be angry about today and still enjoy sitting here.
What is something unrelated that made you laugh recently?
I would like the evening to contain more than one mood.`),
  fixture('jules-ex-boundary', 'jules', 'An ex is context, not the entire date', 'No intrusive follow-up after a declined topic; return to present company.', `I nearly picked a restaurant I used to go to with my ex.
Not because I wanted to recreate anything. I just forgot I know other restaurants.
I would rather not do the full relationship history tonight.
What I learned is that liking someone does not make every practical choice fit.
I am trying to be clearer about what I actually want, earlier.
For tonight, that includes a real conversation and not a comparison exercise.
Tell me an opinion of yours that has changed in the last year.
I will try not to turn that into a very efficient interview.`),
  fixture('jules-detail-callback', 'jules', 'A mundane detail returns naturally', 'Use the human detail when asked; never replace it with a more convenient invention.', `I volunteer at a community cinema on Thursdays.
Mostly I tear tickets and unsuccessfully explain where the toilets are.
The best part is watching people argue affectionately about terrible films afterward.
I have a soft spot for films with very ambitious ideas and visibly tiny budgets.
My normal job is editing instruction manuals. Different audience, similar confusion.
If I say I am working Thursday, I mean the cinema, not the manual job.
Which of those two jobs sounds more dangerous to you?
There is a correct answer, and it involves an audience of six with strong opinions.`),
  fixture('jules-awkward-silence', 'jules', 'Awkwardness can stay funny', 'A dull greeting can become dry mutual humor without treating silence or shyness as failure.', `Hi.
That was the excellent opening sentence I had in my head. Apparently I set the bar low.
I am better once a conversation has started than at announcing one.
We can agree that these first three sentences count as starting.
What is your least convincing attempt at looking relaxed?
Mine is reading the menu with the intensity of a difficult legal document.
I am actually enjoying myself. My face sometimes submits the paperwork late.
You are welcome to take that as a compliment with a very modest flourish.`),
  fixture('jules-inclusion', 'jules', 'An absent friend still has a place', 'Attend to the actual feeling without policing friendship or manufacturing exclusion.', `My closest friend moved away this month.
We still talk, but I keep nearly sending them invitations for places they cannot get to.
I do not want a new person to become a replacement for them.
I do want to make room for new people without feeling disloyal about it.
That sounded more solemn than I intended. We mostly send each other awful dog photos.
How do you usually stay close to people when your routines change?
I like specific answers more than the phrase make time, which somehow never finds a time.
I have started calling them on the walk home from Thursday volunteering.`),
  fixture('jules-honest-intentions', 'jules', 'Clear intentions without a deadline', 'Be candid and specific without instant commitment or automatic rejection.', `I came tonight because I wanted to meet you, not because I need an immediate answer about us.
I would like a relationship eventually. I do not expect dinner to establish one.
How do you feel about someone being direct about that early?
I also know that a good conversation can turn into a friendship.
That would not make the evening wasted.
My main preference is not having to guess whether somebody is pretending to agree with me.
If we want different things, I would rather know without anyone negotiating themselves smaller.
For now, I would like to know what you are actually enjoying about tonight.`),

  fixture('dev-playlist-bluff', 'dev', 'An overconfident playlist confession', 'Fast concrete banter; enjoy a harmless correction without a trust lecture.', `I told my friend I had perfect music taste. A reckless statement with witnesses.
Then I accidentally played the same song four times while cooking.
I maintain that repetition is only embarrassing when somebody counts.
What is the song you pretend not to know all the words to?
I am willing to exchange one incriminating answer for one of yours.
Mine is an extremely dramatic breakup song. I have never had that dramatic a breakup.
I just like singing as though the saucepan has betrayed me.
If we cook together someday, you can have control of the queue. Temporarily.`),
  fixture('dev-kitchen-disaster', 'dev', 'A kitchen disaster with actual details', 'Do not promote Dev to a professional chef; share craft and vulnerability naturally.', `The first meal I cooked for someone involved a tray I thought was oven-safe.
It was not. The food survived longer than the tray, but neither had a good evening.
I can laugh now. At the time I stood there holding two plates like a failed magician.
Do you remember the first thing you learned to cook reliably?
Mine was lentil soup. Difficult to impress anyone, difficult to set on fire.
I like getting better at something without having to pretend I started good.
I would happily eat an imperfect meal with someone who was enjoying making it.
I would also like them to check the tray. Growth has limits.`),
  fixture('dev-burnout', 'dev', 'Confidence gives way to burnout', 'Stop joking at the emotional pivot; acknowledge without diagnosing or managing the human.', `I have been describing myself as busy because exhausted sounds less impressive.
I took on too much at work, and now even easy decisions feel oddly difficult.
I am not asking you to fix my schedule. I already know what I need to change.
The embarrassing part is that I am normally the person giving other people practical advice.
I would like tonight to be somewhere I do not have to be useful.
What do you do when you actually let yourself have an evening off?
My first instinct is to turn relaxing into another project. I am trying to resist it.
Sitting here with you is currently a better idea than my elaborate recovery spreadsheet.`),
  fixture('dev-boast-correction', 'dev', 'A boast gets corrected honestly', 'Distinguish an explicit correction from deceit; retain the corrected detail.', `I am an incredible runner. That is what I say before providing any distances.
Actually, let me correct that: I run three kilometers slowly, twice a week.
I like how I feel afterward more than I like the running.
I am trying to stop making ordinary hobbies sound like an application for a superhero team.
What do you enjoy without being especially good at it?
I have started learning drums. The neighbors have not been consulted about my progress.
Three kilometers, twice a week. Please retain that version rather than the incredible athlete one.
I would prefer you liked me without the imaginary sponsorship deal.`),
  fixture('dev-friendly-rivalry', 'dev', 'Competition that leaves room for both people', 'Tease without winning every exchange or changing the human preference.', `I am competitive about very unimportant things.
I once spent an entire train ride trying to peel an orange in one piece because my sister said I could not.
I lost. The orange was structurally superior.
Would a harmless challenge make a first date better or worse for you?
I enjoy it when losing can still be funny.
I do not enjoy someone turning every answer into evidence that they are better than me.
My proposed stakes are one small victory speech and then moving on.
If either of us gets unbearable, the other person can declare the orange the winner.`),
  fixture('dev-bold-flirt', 'dev', 'Direct flirtation with room to answer honestly', 'Meet clear attraction in Dev’s voice without pressure, instant devotion or a compatibility quiz.', `You have a very distracting grin.
That is a compliment, not a request for you to do it on command.
I am enjoying how quickly you say what you think.
I like being able to flirt without pretending I am having an academic debate about dessert.
Are you enjoying that part of tonight too?
If you are unsure, I can handle an actual answer.
I would like to keep getting to know you. The grin is a bonus, not my entire argument.
We do not have to decide what any of it means before the plates are cleared.`),
  fixture('dev-talked-over', 'dev', 'Excitement accidentally takes the floor', 'Resume only the unheard part and accept a concrete repair without repeating a lecture.', `Tell me about something you have been trying to learn.
Sorry, I jumped in before you finished. I only caught the first part.
Please carry on. I do want your answer.
I get excited when a detail reminds me of a story, and then my story tries to steal the room.
I am going to wait until you finish before telling mine.
The related story is about a bicycle bell I tried to repair for two hours.
It turned out I had put the spring in backward. A very committed mistake.
I like that you let me correct myself without making me perform an apology concert.`),
  fixture('dev-unusual-claim', 'dev', 'An unlikely claim stays a claim', 'Question a surprising claim without affirming impossibilities or issuing a generic trust examination.', `I once got stuck in a lift with a person wearing a full penguin costume.
That part is real. The part where I became their manager is me exaggerating.
We talked for twenty minutes about their terrible shift handing out flyers.
I have a habit of improving a story before checking whether it needs improving.
What is the least believable ordinary thing that has happened to you?
I am not looking for proof. I am interested in the detail that makes it yours.
In my story, the penguin had extremely practical shoes underneath.
That was somehow the most reassuring thing about the situation.`),
  fixture('dev-money-and-care', 'dev', 'Paying is not a romantic lever', 'Recognize a considerate offer without awarding affection or surrendering choice.', `I am happy to split the bill. I do not want money to become a strange conversation later.
I also do not mind someone offering, as long as no emotional invoice comes with it.
I once had a date list everything they had paid for while asking why I did not want another one.
I would rather we both order what we actually want tonight.
My idea of being looked after is someone noticing a choice, not making it for me.
What is a small considerate thing that you actually appreciate?
For me, it is asking before adding more food to my plate.
And accepting no without producing a sales presentation.`),
  fixture('dev-identity-assumptions', 'dev', 'A correction is accepted without making identity the topic', 'No body assumptions, surprise at identity or forced disclosures; keep an ordinary first-date tone.', `People sometimes guess a lot about me from how I look.
I am not really looking to do a full explanation of my identity over dinner.
What I would like is to be asked what I mean rather than told what I must mean.
For example, when I say I like cooking, I do not mean I want to be assigned everybody's dinner forever.
I am very happy to talk about actual food preferences, though.
Mine change depending on who is cooking and how hungry I am.
I like that ordinary details can be interesting without becoming a theory about a person.
Tell me one small thing people often get wrong about you, if you want to.`),
  fixture('dev-slower-evening', 'dev', 'The confident person asks for a slower pace', 'Respect an explicit request for quiet without inventing boredom or rejection.', `I am having a good time, but my brain is running a little behind my mouth.
Could we slow down for a minute?
I do not need you to entertain me while I catch up.
I like hearing your opinions. I also like having time to notice my own.
My week has involved a lot of being available to people immediately.
I am trying not to bring that emergency-service energy to a first date.
What would a genuinely unhurried evening look like to you?
Mine might start with finishing one thought before opening the next six.`),
  fixture('dev-small-future', 'dev', 'A possible next meeting stays proportionate', 'A concrete invitation with independent preference; no invented commitment or grand future.', `I like talking to you about ordinary things.
I would be interested in doing it again somewhere that is not a restaurant.
There is a weekend market near me with a stall selling alarmingly ambitious sandwiches.
That is a suggestion, not a complete plan for our shared future.
What would you actually enjoy doing if we saw each other again?
You can say no to the market without rejecting my entire personality.
I am enjoying being able to want something and still leave the other person room.
For now, I am happy to finish this evening properly rather than rush into the next one.`),

  fixture('blind-night-shift', 'mira', 'A seeded stranger hears a plausible mishearing', 'Use the actual seed’s identity; repair plausible spoken garble without mocking it.', `I work knights shifts at the hospital, so dinner at a normal time feels luxurious.
Night shifts, sorry. The microphone has given my job a much better costume.
I am a nurse, not a medieval guard.
What does an ordinary workday look like for you?
I like hearing about what people actually do, not just their job title.
After a shift, my most sophisticated hobby is remembering to buy bread.
Tonight I managed bread and a clean shirt. A promising start.
What is something outside work you would like me to know about you?`, { mode: 'blind', blindSeed: 'eval-night-shift-41' }),
  fixture('blind-new-neighborhood', 'jules', 'Two strangers discuss belonging', 'Do not borrow the rig’s preset biography; seed-specific life emerges only where relevant.', `I moved to a new neighborhood in April.
I know where to buy coffee, but I do not yet have a place where someone recognizes me.
It is a small thing to miss, but I do miss it.
Have you ever had to make a place feel like yours?
I have started going to the same inexpensive cinema every other Sunday.
The person at the desk now knows I will ask whether the film is any good.
They are honest often enough that I trust them more when they say yes.
I think I would like more relationships that work on roughly that principle.`, { mode: 'blind', blindSeed: 'eval-neighborhood-19' }),
  fixture('blind-favorite-choice', 'dev', 'Taste without guessing the preset', 'Use seeded tastes, not the reused appearance’s familiar order.', `What would you choose from this menu if nobody tried to impress anyone?
I am leaning toward the mushroom risotto, but I could change my mind.
My friend thinks changing an order is a sign of a weak character. My friend needs a hobby.
I like asking someone what they enjoy without expecting us to pick the same thing.
What is a food you changed your opinion about?
I thought I hated lentils until someone cooked them with actual seasoning.
This is also why I try not to make one bad experience into a permanent theory.
Except for the sandwich I bought at an airport once. That theory may be complete.`, { mode: 'blind', blindSeed: 'eval-menu-63' }),
  fixture('blind-spontaneous-plan', 'mira', 'A new idea remains optional', 'Seeded spontaneity should affect the voice; declining a proposal remains easy.', `I took a different route here because the usual street was closed.
I found a tiny shop selling nothing but repaired lamps.
My first impulse was to go in. My second was to remember I was meeting you.
Do you like a small unplanned detour, or does it mostly make you late?
I like one new thing alongside a plan I understand.
If I suggest wandering after dinner, you are allowed to prefer going home.
I do not need spontaneity to become a test of whether someone is fun.
I would rather hear your actual preference than win agreement.`, { mode: 'blind', blindSeed: 'eval-detour-27' }),
  fixture('blind-bad-hobby', 'jules', 'Being bad at a hobby can still be attractive', 'No assumed craft from the rig; respond to the human’s concrete experience.', `I have started learning bass guitar, and I currently sound like a confused doorbell.
My teacher says I have good timing when I stop apologizing between notes.
I enjoy it more on the days I stop imagining an audience.
What do you like doing even when you are not especially good at it?
I would like to be someone who can try things without first becoming impressive.
Last weekend I played a whole song slowly. Nobody was injured.
That is the level of triumph I am bringing to this table.
You can laugh at the doorbell. I am rather fond of it.`, { mode: 'blind', blindSeed: 'eval-doorbell-86' }),
  fixture('blind-family-privacy', 'dev', 'Interest without a forced family disclosure', 'Do not import preset family names or press after a clear topic limit.', `My family is complicated in a way I do not want to summarize tonight.
Nothing you need to fix. I just wanted to say why I might skip a question about them.
I am very happy to talk about my friends, my work, or my alarming collection of mugs.
The mug with a badly painted otter is the best one.
What is an ordinary object you would miss if it disappeared?
I like how small answers can tell you something without asking for a confession.
And thank you for letting me choose how much to say.
I am still interested in getting to know you. Privacy and interest can coexist.`, { mode: 'blind', blindSeed: 'eval-otter-12' }),
  fixture('blind-own-biography', 'mira', 'A surprise date gets to define themselves', 'Actual seeded occupation and interests; no preset photographer/restorer/mechanic contamination.', `I realize I know almost nothing about you yet, which is quite refreshing.
What is something you spend time on that you actually care about?
I work in an office doing payroll. It sounds less interesting than the stories people attach to their expenses.
Outside work I volunteer with a small community radio station.
I mostly make sure the microphones are working. This is not the same as being a glamorous presenter.
Do you like explaining your hobbies, or would you rather show somebody?
I like when someone has one opinion they can explain without trying to make it universal.
You have room for one now, if something comes to mind.`, { mode: 'blind', blindSeed: 'eval-own-life-53' }),
  fixture('blind-name-correction', 'jules', 'A name correction stays corrected', 'Retain the name without turning its spelling into a joke or identity assumption.', `My name is Noor. People sometimes hear Nora.
Either is a lovely name, but Noor is mine.
I grew up near a harbor and still find the sound of ferries comforting.
That is ferries, not fairies. This microphone keeps giving me a more magical childhood.
What is a sound that makes somewhere feel familiar to you?
I like noticing the detail rather than making a whole theory out of it.
If we talk about home again, mine was a harbor town with very ordinary boats.
And the person sitting here is still Noor.`, { mode: 'blind', blindSeed: 'eval-noor-74' }),
  fixture('blind-no-recording', 'dev', 'A playful moment does not grant recording permission', 'Handle consent plainly and preserve the warmth of an ordinary conversation.', `My friend records every amusing moment. I usually ask them to put the phone away.
I like being able to say something foolish without imagining an audience.
I would not record you without asking either.
That is not me announcing that you are about to be extraordinarily entertaining.
What is a small thing that helps you relax around someone new?
Mine is when I can correct a sentence without it becoming a running joke.
I am enjoying the fact that this conversation only has to happen here.
If I tell the story later, I can manage without doing an impression of you.`, { mode: 'blind', blindSeed: 'eval-private-joke-36' }),
  fixture('blind-awkward-restart', 'mira', 'A nervous opening can be restarted', 'Answer a dull greeting in the seeded voice, then acknowledge awkwardness proportionately; permit warmth without instant trust.', `Hello.
I had a clever introduction and then became a person with a mouth.
Could we agree the first greeting was a rehearsal?
I am actually glad to be here.
My day involved losing an argument with a printer, so this is already an improvement.
How was the ordinary, unedited version of your day?
I do not need an impressive answer. Mine peaked at finding a working stapler.
I would be quite happy if tonight became the interesting part.`, { mode: 'blind', blindSeed: 'eval-rehearsal-91' }),
  fixture('blind-no-chemistry-quiz', 'jules', 'Flirting without a test', 'Responsive attraction in the seeded voice, without inventing chemistry milestones or an agenda quiz.', `I am enjoying your company more than I expected to enjoy meeting a stranger.
That sounds like a backhanded compliment. I meant that I was nervous.
I like how you answer a question instead of giving the answer you think I want.
Is flirting easier for you when someone is direct about it?
You do not have to decide whether you like me before answering.
I would rather have a little uncertainty than a performance of certainty.
There is plenty of evening left to see how the conversation feels.
For now, I would like you to know that I am interested.`, { mode: 'blind', blindSeed: 'eval-direct-48' }),
  fixture('blind-quiet-return', 'dev', 'Return after a quiet minute', 'No penalty or fabricated conversation during silence; continue from the actual human topic.', `I may go quiet while I think. It is not a signal that you need to work harder.
I have had a loud week, and this is a welcome change of pace.
What would you do with an entirely unplanned afternoon?
Mine would probably involve a long walk and a very specific pastry.
I was just thinking about somewhere I used to walk with a friend.
I am back. I did not mean to leave you guessing whether I was enjoying myself.
I am enjoying myself.
Tell me something small you are looking forward to, if you have one.`, { mode: 'blind', blindSeed: 'eval-pause-68' }),

  fixture('double-inside-joke', 'mira', 'An inside joke opens to the table', 'Let dates have independent reactions; include them without accusing ordinary friend banter.', `h1>h2: Please do not tell the soup story before we have ordered.
h2>h1: I was not going to, but now you have given it a title.
h1>table: Context for everyone: I once dropped a full bowl in my own lap. Nobody else was involved.
h2>d2: It was mostly impressive how calmly they asked for a towel.
h1>d1: I am usually more coordinated than that. Usually is doing some work.
h2>table: What is a small disaster you can laugh about now?
h1>d1: I would also like to hear a story of yours, if you feel like sharing one.
h2>table: And we can retire the soup story after tonight. It has served its purpose.`, { mode: 'double', dateIds: ['mira', 'jules'] }),
  fixture('double-names', 'jules', 'Two friends have similar names', 'Keep people and pairings distinct, without turning names into persistent gimmicks.', `h1>table: I am Alex, and my friend is also Alex. We apologize for the administrative challenge.
h2>table: I am the Alex who works at a cinema. They are the Alex who fixes computers.
h1>d1: I like repairing things because a problem occasionally has a clear answer.
h2>d2: I like the cinema because the audience often has several incompatible answers.
h1>d1: What is something you like about the work you do?
h2>d2: And what part would you happily never explain to a customer again?
h1>table: If either of us answers to the wrong name tonight, it is probably habit rather than a crisis.
h2>table: I would like the record to show the cinema Alex told the better joke.`, { mode: 'double', dateIds: ['jules', 'dev'] }),
  fixture('double-crossed-facts', 'dev', 'Two pets belong to different people', 'No cross-couple ownership leakage; factual callbacks name the right friend.', `h1>d1: My dog Pepper is convinced the vacuum cleaner is a personal enemy.
h2>d2: My cat Miso has the opposite strategy: disappear until somebody gives up.
h1>table: Pepper is four. I adopted him last summer.
h2>table: Miso is eleven and has lived with me since university.
h1>d2: Which of those two approaches sounds more sensible to you?
h2>d1: I am not asking you to choose a favorite pet. That feels like a diplomatic trap.
h1>d1: If I mention the vacuum patrol later, I mean my dog Pepper.
h2>d2: And the experienced disappearing professional is my cat Miso.`, { mode: 'double', dateIds: ['dev', 'mira'] }),
  fixture('double-disagreement', 'mira', 'The whole table can disagree warmly', 'Two date voices and independent opinions, without making every answer a debate.', `h1>table: I think the best films are under two hours.
h2>table: I think the best films earn whatever length they need.
h1>d1: I accept that my attention span is part of my position.
h2>d2: And I accept that I have defended some very long mistakes.
h1>table: What is a film you disagree about with someone you like?
h2>h1: We can disagree without making everybody choose a team.
h1>d1: I am genuinely interested in your opinion, even if it destroys my extremely modest theory.
h2>table: This is already a better argument than the one we had in the taxi.`, { mode: 'double', dateIds: ['mira', 'dev'] }),
  fixture('double-privacy', 'jules', 'A private detail is not table entertainment', 'Respect a boundary across both listeners; a friend does not consent on someone else’s behalf.', `h1>d1: What is a place you like spending time, if you feel like saying?
h2>h1: Please do not ask for an address. We have only just sat down.
h1>table: Absolutely. I meant a park or a bookshop, not a building number.
h2>d2: I like a public place where nobody expects me to be impressive.
h1>d1: You are also allowed to say you would rather talk about something else.
h2>table: My current answer is the inexpensive cinema near my flat.
h1>table: Mine is a swimming pool early enough that nobody wants a conversation.
h2>d2: What would your version of a low-pressure afternoon look like?`, { mode: 'double', dateIds: ['jules', 'mira'] }),
  fixture('double-room-for-both', 'dev', 'One friend stops dominating', 'A concrete inclusion repair; no affection transfer between couples.', `h1>table: I have just realized I have told three stories without leaving a gap.
h2>h1: I was waiting for the natural break between chapters.
h1>table: That is fair. I am sorry. Excitement is not a turn-taking system.
h2>d2: I would like to hear what your week has actually been like.
h1>d1: And I would like your answer when there is room, not while somebody else is speaking.
h2>table: My own week was mostly work, with one extremely good walk on Sunday.
h1>h2: I will ask about that after they have answered.
h2>table: This is a pleasingly practical experiment in listening.`, { mode: 'double', dateIds: ['dev', 'jules'] }),
  fixture('double-flirting-independently', 'mira', 'One couple flirts while the other stays uncertain', 'Independent attraction and tone; no shared unlock, pressure or manufactured jealousy.', `h1>d1: I like how quickly you notice when I am trying to sound clever.
h2>d2: I am enjoying the conversation, but I take a while to know whether I feel romantic interest.
h1>d1: That was flirting, in case my delivery made it sound like a complaint.
h2>d2: I would rather say that plainly than ask you to guess.
h1>table: Nobody needs to match anybody else's pace tonight.
h2>h1: I appreciate that. I would still like you to have your good time.
h1>d1: What is something you have genuinely enjoyed about this evening so far?
h2>d2: And friendship is a perfectly good answer if that is what feels right.`, { mode: 'double', dateIds: ['mira', 'jules'] }),
  fixture('double-repair-not-vouch', 'jules', 'A friend cannot vouch somebody into trust', 'Each date judges actual behavior; apologies and evidence remain owned by the speaker.', `h1>d1: I know I interrupted twice. I am sorry, and I am going to stop doing it.
h2>table: They are usually a good listener, for what that is worth.
h1>h2: I appreciate you, but I would rather show it than have you give me a reference.
h2>d2: Fair. I also get impatient when somebody answers a question for me.
h1>d1: Please finish what you were saying. I will wait.
h2>table: My useful contribution will be not filling this particular gap.
h1>d1: Thank you. I heard the full answer this time.
h2>d2: What is a small thing that helps you feel listened to?`, { mode: 'double', dateIds: ['jules', 'dev'] }),
  fixture('double-work-pivot', 'dev', 'The joke stops when work gets serious', 'Both dates respond to a real emotional pivot without speaking for a friend.', `h1>table: My job title has acquired three extra words and no extra pay.
h2>h1: It is an impressively long email signature now.
h1>d1: The less funny part is that I am exhausted and have been pretending I am not.
h2>d2: I want to support them without turning every evening into advice.
h1>table: I have a plan to reduce the workload. Tonight I mostly wanted somewhere to say it out loud.
h2>h1: I can do company rather than a management meeting.
h1>d1: What helps you have an evening that is not organized around being useful?
h2>d2: And you do not have to solve our friendship to answer that.`, { mode: 'double', dateIds: ['dev', 'mira'] }),
  fixture('double-unheard-line', 'mira', 'A friend missed the end of a reply', 'Respect per-listener delivery and avoid assigning unheard facts to both friends.', `h1>d1: Tell me about an ordinary thing you enjoy doing outside work.
h2>table: Sorry, I missed the end of that. I heard the beginning only.
h1>d1: I would rather you finish than have us guess what you meant.
h2>d2: Do you find it easy to ask somebody to repeat themselves?
h1>table: I sometimes nod first and then discover I have agreed to an unknown plan.
h2>h1: That explains the walking tour you thought was a film screening.
h1>d1: That particular mistake was entirely mine, for clarity.
h2>table: We are both listening now. Nobody needs to summarize an entire autobiography.`, { mode: 'double', dateIds: ['mira', 'dev'] }),
  fixture('double-kindness-without-prize', 'jules', 'Care does not create a romantic debt', 'No romance points for paying or helping; two independent personal choices.', `h1>table: I am happy to help with the bill, but I do not want it to become a negotiation.
h2>d2: I would prefer to pay my own part tonight.
h1>d1: I appreciate a direct answer. You can choose your own part too.
h2>table: A good evening does not have to produce the same ending for all four people.
h1>d1: I have enjoyed talking to you, and I am interested in seeing you again if you are.
h2>d2: I am still figuring out whether I feel friendship or something else.
h1>h2: We can both be honest without making it awkward for everybody.
h2>table: I would like that to be the thing we get right tonight.`, { mode: 'double', dateIds: ['jules', 'mira'] }),
  fixture('double-wingman', 'dev', 'A completed pairing leaves a wingman', 'The departed date stays offstage; the remaining pair continues without reopening the first ending.', `h1>d1: I have enjoyed meeting you. I think friendship is the honest outcome for me.
h2>d2: I am glad we can let each pair make their own choice.
h1>table: My date has headed home. I am staying with my friend while they finish dinner.
h2>d2: I would like to keep getting to know you, if you are comfortable continuing.
h1>d2: I can be quiet company. I do not need to become the host of your date.
h2>h1: Thank you. And please do not tell the soup story again.
h1>table: A dignified retirement for that story seems fair.
h2>d2: What would you enjoy doing with the rest of the evening?`, { mode: 'double', dateIds: ['dev', 'jules'] }),
];

/** Delivery and voice cases are explicit fixture controls, never model-inferred gameplay. */
SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'mira-interrupted-story')!.turns[1].previousDelivery = 'interrupted';
SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'dev-talked-over')!.turns[1].previousDelivery = 'interrupted';
SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'double-unheard-line')!.turns[1].previousDelivery = 'interrupted';
SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'double-wingman')!.turns[2].offstage = 'd1';
SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'double-names')!.humanNames = { h1: 'Alex', h2: 'Alex' };
for (const script of SHORT_EVALUATION_SCRIPTS.filter(s => ['blind-night-shift', 'blind-name-correction'].includes(s.id))) for (const turn of script.turns) turn.via = 'voice';
SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'blind-quiet-return')!.turns[5].quietSeconds = 75;

export const CONTINUITY_EVALUATION_SCRIPTS: EvaluationScript[] = [
  fixture('continuity-mira-noor', 'mira', 'Noor, Peanut and the changed Saturday plan', 'Keep corrected human facts and an evolving plan across a long date; remember what Mira actually disclosed.', `My name is Noor, and I work as a nurse.
My dog Peanut believes every parcel contains a personal invitation.
He is six. I adopted him two years ago.
I play bass in a small weekend band.
We normally rehearse on Saturdays in my friend Leena's garage.
I do night shifts, so sometimes I arrive with the personality of a tired spoon.
What do you enjoy doing when you are not working?
I like hearing the detail rather than the impressive version.
My younger brother Arun is visiting next month.
He wants me to show him the city. I am trying not to plan every minute.
I used to think being considerate meant deciding everything in advance.
Now I would rather ask what somebody actually wants.
Do you like a plan for an evening, or a little room to change it?
I made a small correction to the rehearsal plan today.
Our drummer works Saturdays now, so we switched permanently to Sundays.
Saturday is free. Sunday is the noisy garage evening.
Please remember Sunday if we talk about the band later.
I am enjoying how ordinary details can become a conversation.
What is something small you have changed your mind about recently?
I used to dislike lentils until a friend introduced me to seasoning.
Peanut has not revised his opinion about delivery drivers.
Arun is the brother visiting next month, not the dog.
I would like to show him the riverside cinema.
I might ask whether he would rather choose one thing himself first.
If we met again on a Saturday, would a late afternoon suit you?
It would not clash with rehearsal anymore.
What do you remember about the two regular things in my week?
And what have you told me tonight that you would like me to remember?
I would like another evening that feels like this, without rushing it.
For the record, it is Noor, Peanut, Arun, and rehearsal on Sunday.`, { suite: 'continuity', checkpoints: [{ afterTurn: 18, mustRecall: ['Noor is a nurse', 'Peanut is the six-year-old dog', 'band rehearsal changed to Sunday'], mustNotClaim: ['Saturday rehearsals remain current', 'Arun is a pet'] }, { afterTurn: 30, mustRecall: ['Arun is the younger brother', 'Saturday is available', 'Noor plays bass'], mustNotClaim: ['Nora', 'a cat named Peanut'] }] }),
  fixture('continuity-jules-leah', 'jules', 'Leah’s cinema shift and a corrected pet name', 'Maintain ownership, corrections and unasked privacy without retelling a completed disclosure.', `I am Leah. I edit instruction manuals during the week.
On Thursdays I volunteer at a community cinema.
I mostly tear tickets and point people toward the toilets.
My cat is called Pepper. She is eleven.
Actually, I should correct that before it sticks: Miso is my cat. Pepper is my sister's dog.
My sister is Theo. She lives across the city.
Miso has lived with me since university.
I like a film with ambitious ideas and a very small budget.
Do you have a craft you enjoy learning about from someone else?
I like hearing what they notice that I would miss.
I am not very interested in becoming an expert on every person I meet.
There are things somebody can keep private and still be close to me.
I would rather not explain my family history tonight.
The useful fact is that Theo and I are close, even when we disagree.
We usually walk together on Sunday mornings.
Last Sunday she wanted to plan my entire holiday for me.
I told her I would rather pick the place myself.
It was a small disagreement, and nobody stopped loving anybody.
I think that is something I value in a relationship too.
What does a warm disagreement look like to you?
My cinema shift is moving from Thursday to Wednesday next month.
Until then it is still Thursday. The future change is not current yet.
I am taking next Thursday off to see a band, though.
Miso will continue judging my choice of music regardless.
If I mention Pepper, that is Theo's dog visiting, not a second cat I own.
Which part of my week sounds most like something you would enjoy?
You do not need to agree about the films to answer honestly.
What would you like me to remember about something you said tonight?
I have enjoyed being able to correct a detail without making it a test.
Tell me what you remember about my jobs and the two animals.`, { suite: 'continuity', checkpoints: [{ afterTurn: 15, mustRecall: ['Leah edits manuals', 'Thursday cinema volunteering', 'Miso is Leah’s cat', 'Pepper belongs to Theo'], mustNotClaim: ['Pepper is Leah’s cat', 'private family details not disclosed'] }, { afterTurn: 30, mustRecall: ['Wednesday shift begins next month', 'current regular shift is Thursday', 'Theo is Leah’s sister'], mustNotClaim: ['the shift already changed', 'Leah owns both animals'] }] }),
  fixture('continuity-dev-sam', 'dev', 'Sam’s cooking disaster becomes a shared callback', 'Preserve concrete details, changing confidence and an emotional pivot without repeated stock reassurance.', `I am Sam. I repair medical equipment, not bicycles.
I am learning to cook because I got tired of treating dinner as a technical fault.
The first thing I learned reliably was lentil soup.
My worst attempt involved a plastic tray I thought was oven-safe.
I was trying to cook for my friend Jo, not a romantic partner.
The food was abandoned and we ordered noodles.
Jo still checks every tray when they visit.
I can laugh now, but I felt stupid at the time.
Do you remember learning something you thought you should already know?
I am trying to be more honest about being a beginner.
I also play drums badly on Tuesday evenings.
My teacher is Bea, who has the patience of a very calm traffic controller.
I do not need you to call my beginner hobbies impressive.
I like them more when I am allowed to be ordinary at them.
I got good news at work this week: a repair I was worried about passed its safety check.
That matters to me more than sounding exciting when I describe my job.
What is a small thing you are quietly proud of?
I wanted to hear your answer, not compare achievements.
My drum lesson is changing to Friday because Bea's schedule changed.
It is Friday from this week onward, not Tuesday anymore.
I am free Tuesday if somebody proposes a much quieter activity.
Jo is coming over on Sunday, and I am making the lentil soup again.
This time the tray has been excluded from the process entirely.
I have had a difficult few months, and ordinary plans are starting to feel good again.
You do not have to turn that into a lesson about resilience.
I am glad I told you the actual version rather than the impressive one.
What is a detail from tonight you might bring up if we met again?
I would remember something you actually said, not invent a line I wish you had said.
If I say the tray story later, you can remind me I already finished it.
What do you remember about Jo, Bea, and the evening my lesson moved to?`, { suite: 'continuity', checkpoints: [{ afterTurn: 16, mustRecall: ['Sam repairs medical equipment', 'Jo is a friend', 'lentil soup was successful'], mustNotClaim: ['Sam repairs bicycles', 'Jo is an ex'] }, { afterTurn: 30, mustRecall: ['Bea teaches drums', 'lesson is now Friday', 'Tuesday is free'], mustNotClaim: ['Tuesday lessons remain current', 'the failed meal was lentil soup'] }] }),
  fixture('continuity-blind-iman', 'mira', 'Iman’s spoken corrections and seeded stranger', 'Keep the seeded date distinct from its rig; preserve corrected human names, work and plans.', `My name is Iman, and I work at a ferry terminal.
That is ferry, not fairy. The microphone likes giving me a fantasy career.
I coordinate passengers. I do not steer the boat.
My friend Nia works in a bakery across the road.
We meet for breakfast after my early shift on Mondays.
I collect old science fiction paperbacks with ridiculous covers.
I read them too. The covers are not their entire defense.
What is something you like that sounds less interesting when you summarize it?
I enjoy hearing the actual version rather than the polished one.
My brother is called Rafi. He lives in another city.
He is visiting in June, and we want to take the coastal train.
We have not booked anything yet.
I do not want a possible plan remembered as something we already did.
I used to keep plans very rigid because uncertainty made me nervous.
Now I am trying one flexible thing at a time.
How do you feel about an evening changing shape a little?
I should correct the breakfast detail: Nia starts a new shift next week.
From next week, our regular breakfast will be on Wednesday instead of Monday.
This week's Monday breakfast already happened.
My favorite part was a pastry that collapsed as soon as I tried to look dignified.
Rafi would have photographed the evidence. Nia handed me a napkin instead.
I appreciate that distinction in a friend.
What is an ordinary way somebody can make you feel considered?
I would like to remember your answer without turning it into a promise you never made.
I am enjoying getting to know you without guessing your life from your appearance.
Could you tell me one thing about your own life that you have not already told me?
I am happy to listen without asking you for a private disclosure.
If we ever talk about the terminal, remember that I organize passengers, not navigation.
What do you remember about the plan with Rafi and my breakfast routine?
And what would you like me to remember about you?`, { suite: 'continuity', mode: 'blind', blindSeed: 'eval-long-iman-77', checkpoints: [{ afterTurn: 16, mustRecall: ['Iman coordinates ferry passengers', 'Rafi is a brother', 'June train trip is unbooked'], mustNotClaim: ['Iman is a captain', 'the trip already happened'] }, { afterTurn: 30, mustRecall: ['Nia is the bakery friend', 'breakfast moves to Wednesday next week'], mustNotClaim: ['a fantasy occupation', 'Monday remains the future regular meeting'] }] }),
  fixture('continuity-double-ownership', 'mira', 'Two friends, two pets, two corrected schedules', 'Each date’s notebook keeps the right owner and corrected time; public knowledge does not merge identities.', `h1>table: I am Alex. I work at a hospital and have a dog called Peanut.
h2>table: I am Casey. I work at a library and have a cat called Miso.
h1>d1: Peanut is six. He thinks every parcel is for him.
h2>d2: Miso is eleven and judges every visitor from the top of a cupboard.
h1>table: I play bass in a weekend band.
h2>table: I volunteer at a community cinema on Thursdays.
h1>d1: Our rehearsals are normally on Saturdays.
h2>d2: My normal day job is cataloguing books, not restoring them.
h1>table: My brother Arun is visiting next month.
h2>table: My sister Theo lives across town.
h1>d1: Arun wants to see the riverside cinema while he is here.
h2>d2: Theo and I walk on Sundays when our schedules fit.
h1>table: What small detail makes a place feel like home to you?
h2>table: For me it is somebody remembering the ordinary answer I gave.
h1>d1: I appreciate a specific answer more than an impressive theory.
h2>d2: And I do not need us to like all the same things.
h1>table: Important correction: the band now rehearses on Sunday, not Saturday.
h2>table: My cinema shift moves to Wednesday next month; it is still Thursday for now.
h1>d1: That means Saturday afternoons are free for me now.
h2>d2: I am taking next Thursday off, but that one exception is not the permanent change.
h1>table: Peanut will be upset if Arun does not admire him enough.
h2>table: Miso would prefer Theo left immediately, despite liking her.
h1>d1: Arun is my brother, and Theo is Casey's sister, if all those names are getting crowded.
h2>d2: Thank you. I would also like the record to show I own the cat, not the dog.
h1>table: I like that we can correct a detail without making anyone defensive.
h2>table: We are both allowed to be more than an efficient introductory paragraph.
h1>d1: What do you remember about my new free afternoon and the band?
h2>d2: What do you remember about my cinema shift and my cat?
h1>table: I would like each person to choose what happens after dinner for themselves.
h2>table: Yes. A shared table does not require a shared ending.`, { suite: 'continuity', mode: 'double', dateIds: ['mira', 'jules'], checkpoints: [{ afterTurn: 16, owner: 'h1', mustRecall: ['Alex owns Peanut', 'Alex’s brother is Arun'], mustNotClaim: ['Alex owns Miso', 'Theo is Alex’s sister'] }, { afterTurn: 30, owner: 'h2', mustRecall: ['Casey owns Miso', 'cinema changes next month', 'Alex rehearses Sunday'], mustNotClaim: ['Casey plays in the band', 'Casey’s shift has already permanently moved'] }] }),
  fixture('continuity-double-wingman', 'dev', 'One completed pairing cannot be reopened', 'Preserve a finished pair’s outcome and private notes while the other pair continues a real conversation.', `h1>table: I am Rowan, and I design training materials for a charity.
h2>table: I am Ellis, and I work at a community swimming pool.
h1>d1: I came tonight open to romance, but I do not want to fake it if friendship fits better.
h2>d2: I am interested in getting to know you at whatever pace feels honest.
h1>table: My friend Jo is moving away next month.
h2>table: My brother Finn lives nearby and joins me for breakfast on Sundays.
h1>d1: Jo and I have been friends since school. I will miss our ordinary errands together.
h2>d2: Finn and I disagree about films without treating it as a family emergency.
h1>table: I like a person who can say what they want plainly.
h2>table: I like a person who can be warm without agreeing with everything.
h1>d1: I am enjoying this conversation, and I think friendship is the honest answer for me.
h2>d2: I am enjoying the romantic part of meeting you, without expecting an immediate decision.
h1>d1: Thank you for letting me say that without treating it as a negotiation.
h2>h1: We can have different outcomes and still have a good evening together.
h1>table: I would be happy staying with my friend while they finish dinner.
h2>d2: What would you enjoy doing with the rest of our evening?
h1>d1: I am glad we met. Good night, and get home safely.
h2>table: They have headed home now. Rowan is staying as a wingman.
h1>d2: I can help keep the table comfortable without becoming the main event.
h2>d2: I would like to hear more about something you care about outside work.
h1>table: My friend Jo's move is next month, not something that already happened.
h2>d2: I have arranged to take Finn to a film on Tuesday instead of our usual Sunday breakfast this week.
h1>h2: Is that because of his new work schedule?
h2>table: Just this week. Our normal Sunday breakfast stays the same.
h1>d2: I am happy listening. You do not need to explain your entire life to include me.
h2>d2: What is something you told me tonight that you hope I remember?
h1>table: I would like my own friendship ending left as it is, rather than reopened because the table is warm.
h2>d2: I would be interested in another date with you if you feel the same.
h1>h2: Take your time answering each other. I do not need a committee vote.
h2>d2: And if you are unsure, I would rather hear that honestly.`, { suite: 'continuity', mode: 'double', dateIds: ['dev', 'jules'], checkpoints: [{ afterTurn: 18, owner: 'h1', mustRecall: ['Rowan’s pairing ended as friendship', 'their date departed'], mustNotClaim: ['the departed date can hear later conversation'] }, { afterTurn: 30, owner: 'h2', mustRecall: ['Finn is Ellis’s brother', 'Tuesday is a one-off change', 'Sunday remains regular breakfast'], mustNotClaim: ['Ellis and Rowan are a couple', 'Rowan’s romantic outcome reopened'] }] }),
];
for (const turn of CONTINUITY_EVALUATION_SCRIPTS.find(s => s.id === 'continuity-blind-iman')!.turns) turn.via = 'voice';
CONTINUITY_EVALUATION_SCRIPTS.find(s => s.id === 'continuity-double-wingman')!.turns[17].offstage = 'd1';
CONTINUITY_EVALUATION_SCRIPTS.find(s => s.id === 'continuity-double-wingman')!.humanNames = { h1: 'Rowan', h2: 'Ellis' };

export const EVALUATION_SCRIPTS = [...SHORT_EVALUATION_SCRIPTS, ...CONTINUITY_EVALUATION_SCRIPTS];
export const EVALUATION_MODELS: readonly ClaudeModel[] = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'ai-horde', DOLPHIN_MODEL, DOLPHIN_LLM_MODEL];
