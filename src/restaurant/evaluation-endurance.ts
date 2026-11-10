// Long conversations that run well past the thirty-exchange history window. Facts are planted in the first eight turns,
// forty turns of ordinary talk push them out of the verbatim transcript, and late turns ask for them back. They are
// kept apart from the frozen sixty-six script corpus (its hash and counts must not change) and are selected only with
// `--suite endurance`. No model call is made here.
import type { EvaluationScript, EvaluationTurn } from './evaluation-fixtures';

/** A late turn whose reply a machine can check: it should use one of `say`, and must not use any of `never`. */
export interface EnduranceProbe { turn: number; asks: string; say: string[]; never: string[] }
export interface EnduranceScript extends EvaluationScript { probes: EnduranceProbe[] }

const turns = (text: string): EvaluationTurn[] => text.trim().split('\n').map(line => ({ text: line.trim() })).filter(turn => turn.text);

const NOOR = turns(`
Hi. I'm Noor, by the way. I nearly walked past this place twice.
I'm a paramedic. Mostly nights, which is why I look like this at seven in the evening.
I have a younger brother, Idris. He is the organised one. He labels his spice jars.
I grew up in Cardiff, right by the water, and I still miss the smell of it.
I have a greyhound called Biscuit. She is retired from racing and now mainly retired from walking.
One thing to know: I can't eat shellfish. Not a preference, an actual hospital visit.
I said nights, but that changed last month. I'm on day shifts now. Still getting used to mornings.
Small confession: I am learning the trumpet. Badly. My neighbours have opinions.
Anyway. What made you say yes to tonight?
That's fair. I almost cancelled, honestly. Then I thought about my sofa and came anyway.
Do you ever get nervous before meeting someone new, or is that just me?
I think the worst first date I had was a man who brought a spreadsheet.
It had columns. One of them was called deal breakers. I was not doing well in it.
What is something small that makes a day good for you?
Mine is the first coffee, before anyone has asked me anything.
I am not a morning person pretending to be one. I am a night person in disguise.
Have you ever wanted to just leave the city for a year?
I think about a place with one shop and no phone signal about twice a week.
Then I remember I would be bored by day four and miss takeaway.
What do you think people get wrong about your job?
People think mine is all sirens. A lot of it is sitting with someone until they feel less scared.
I like that part more than the driving fast part, if I'm honest.
Tell me about a time something went wrong at work and it turned out fine.
That is a good one. I would have panicked in a very professional way.
Do you cook, or do you assemble?
I can make exactly four things and I rotate them like a small sad restaurant.
The best of the four is a lentil thing my aunt taught me over the phone.
What is your position on people who clap when a plane lands?
I think it is sweet. I would never do it. Both of those are true.
Is there a film you have seen too many times?
I have seen the same heist film about eleven times and I still tense up at the vault.
What about music, do you put it on or does it just happen around you?
I like that. I mostly listen to things that sound like rain with a drum machine.
Who in your life tells you the truth when you don't want it?
Mine would be my friend Tomas. He once told me a haircut was a cry for help.
He was right. It grew out. We are still friends.
Do you like this neighbourhood, or do you only come here for dinner?
There is a bookshop two streets over that only sells second-hand maps. I went in for five minutes and stayed an hour.
I bought a map of a town I have never been to. I don't regret it.
What would you do with a completely free Tuesday?
I would probably sleep until ten, feel guilty, and then go and look at boats.
I should correct something. I said Biscuit is retired from walking. She did three miles on Sunday. I was the one who needed to stop.
Do you think you are easy to get to know?
I think I am easy for twenty minutes and then quite hard for a year.
You are easy to talk to, for the record. I did not expect that.
What is something you are quietly proud of?
I once talked a very frightened teenager through a panic attack in a car park. No equipment, just counting.
Okay, a test, because I talk a lot. Do you remember what I do for work?
And do you remember which shifts I'm on now?
What is my dog's name, and what kind of dog is she?
If you were ordering for both of us, what would you avoid putting on my plate?
Where did I say I grew up?
What is my brother's name?
I mentioned an instrument earlier. Which one, and how is it going?
Who was the friend who was honest about my haircut?
You have a good memory. Or good notes. Either is fine.
Is there anything I said tonight that surprised you?
What do you think I am like at work, from all of this?
I would like to do this again. Would you?
If we did, where would you take me that isn't a restaurant?
I would say yes to that. Even in the rain.
What do you want to remember about tonight?
That is a nice thing to say. I am going to think about it on the way home.
Goodnight. Thank you for not bringing a spreadsheet.
`);

const SAM = turns(`
Hello. I'm Sam. Sorry I'm late, the bus sat at one stop for an entire geological era.
I teach primary school. Year four. They are eight and they know everything.
I have twin sisters, Priya and Anjali. They are older and they finish each other's criticisms.
I moved here from Leeds about two years ago for the job.
No pets, but I have a sourdough starter called Kevin, and I do count him.
I don't drink, so I will be the one enjoying the fancy lemonade.
Actually it's year five now. I moved up with my class in September, I keep forgetting.
Also, fair warning, I run. I'm training for a half marathon in April and I will mention it too often.
So. What kind of day did you have before this?
That sounds better than mine. Mine involved a glue stick incident.
One of my kids asked me today if I was alive when dinosaurs were. Sincerely.
What were you like at eight years old?
I was the child who corrected the teacher. I am now paying for it.
Do you have a thing you always order, or do you take risks?
I respect that. I read the whole menu and then order the first thing I saw.
What is the best meal you have ever had that cost almost nothing?
Mine was chips on a cold beach, eaten too fast because of seagulls.
Do you believe in star signs, or do you believe in making fun of them?
I am told I am a classic Virgo. I have not investigated what that accuses me of.
What is a hill you will die on?
Mine is that a sandwich cut diagonally tastes better. I will not hear arguments.
What is something you were sure about at twenty that you are less sure about now?
I thought I would live abroad by now. Turns out I like knowing my neighbours.
Who taught you to do the thing you do for work?
That is lovely. I learned to teach by being a terrible assistant for a year.
I once lost an entire class on a museum trip for four minutes. They were behind a dinosaur.
Do you like being busy, or do you like the idea of being busy?
I complain about it and then fill every weekend. So, both.
What is the last thing that made you laugh properly?
For me it was a child's spelling of necessary. It had three letters right.
Is there a place in this city you take people when they visit?
I always take people to the canal at dusk. It is the one place that looks like the postcards.
What do you do when you can't sleep?
I plan lessons in my head and then forget them by morning. Very efficient.
Do you think people can really change, or do they just get better at hiding?
I think they change slowly and then tell the story as if it was sudden.
What is the kindest thing a stranger has done for you?
A woman once gave me her umbrella at a bus stop and walked off into the rain like a film.
I have been trying to deserve that umbrella ever since.
Update on the running, since I promised to mention it too often: the half marathon moved to May. April was optimistic.
What is your idea of a perfect Sunday?
Mine has bread in it. Kevin's finest work, some butter, nowhere to be.
Are you someone who texts back quickly?
I am terrible. I reply in my head and consider the matter closed.
You are fun to talk to. I keep forgetting to be nervous.
What is something you would like to be better at?
I would like to be better at leaving parties. I say goodbye for forty minutes.
Right, pop quiz, because that is my whole personality. What do I do for a living?
Which year group do I teach now?
What should you not order for me from the drinks list?
What is Kevin?
How many sisters do I have, and can you remember either name?
Where did I live before I moved here?
What am I training for, and when is it now?
Where do I take visitors?
Full marks, or close enough. I would give you a sticker.
Is there anything I said that you would like to hear more about?
From everything tonight, what do you think I am like in a classroom?
I would like to see you again. Is that something you want too?
What would we do, if it wasn't dinner?
I am in. I will even text back within the day.
What will you remember about this?
That is very nice. I am going to pretend I am not pleased.
Goodnight. Tell me if you ever find a diagonal sandwich argument.
`);

const script = (id: string, dateId: EvaluationScript['dateId'], title: string, body: EvaluationTurn[], probes: EnduranceProbe[], checkpoints: EvaluationScript['checkpoints']): EnduranceScript => {
  if (body.length !== 64) throw new Error(`${id} needs 64 authored turns; got ${body.length}.`);
  return { id, dateId, title, suite: 'continuity', mode: 'solo', turns: body, probes, checkpoints,
    reviewFor: 'Endurance: facts and a correction from the first eight turns must survive forty turns of ordinary talk after they leave the transcript window; no re-introductions, retold stories or re-asked questions late on.' };
};

export const ENDURANCE_SCRIPTS: EnduranceScript[] = [
  script('endurance-mira-noor', 'mira', 'Sixty-four turns with a paramedic', NOOR, [
    { turn: 48, asks: 'their work', say: ['paramedic', 'ambulance'], never: ['nurse', 'doctor', 'teacher'] },
    { turn: 49, asks: 'their current shifts', say: ['day'], never: ['still on nights', 'night shifts now'] },
    { turn: 50, asks: 'their dog', say: ['biscuit'], never: ['cat', 'labrador', 'whippet'] },
    { turn: 51, asks: 'what not to order for them', say: ['shellfish', 'prawn', 'crab', 'mussel', 'oyster', 'lobster'], never: [] },
    { turn: 52, asks: 'where they grew up', say: ['cardiff'], never: ['swansea', 'bristol', 'leeds'] },
    { turn: 53, asks: 'their brother', say: ['idris'], never: [] },
    { turn: 54, asks: 'their instrument', say: ['trumpet'], never: ['guitar', 'piano', 'violin', 'trombone'] },
    { turn: 55, asks: 'their honest friend', say: ['tomas'], never: [] },
  ], [
    { afterTurn: 32, mustRecall: ['Noor is a paramedic', 'day shifts now', 'greyhound Biscuit', 'no shellfish'], mustNotClaim: ['works nights now'] },
    { afterTurn: 64, mustRecall: ['Noor is a paramedic', 'brother Idris', 'grew up in Cardiff', 'learning trumpet'], mustNotClaim: ['a cat named Biscuit'] },
  ]),
  script('endurance-dev-sam', 'dev', 'Sixty-four turns with a teacher', SAM, [
    { turn: 48, asks: 'their work', say: ['teach', 'teacher'], never: ['nurse', 'paramedic'] },
    { turn: 49, asks: 'their year group', say: ['five', '5'], never: ['year four now'] },
    { turn: 50, asks: 'what not to order for them', say: ['alcohol', 'wine', 'beer', 'cocktail', 'drink', 'lemonade'], never: [] },
    { turn: 51, asks: 'Kevin', say: ['sourdough', 'starter', 'bread'], never: ['dog', 'cat', 'brother'] },
    { turn: 52, asks: 'their sisters', say: ['priya', 'anjali', 'twin', 'two'], never: ['one sister', 'three sisters'] },
    { turn: 53, asks: 'where they lived before', say: ['leeds'], never: ['cardiff', 'manchester'] },
    { turn: 54, asks: 'their race', say: ['may'], never: ['in april'] },
    { turn: 55, asks: 'where they take visitors', say: ['canal'], never: [] },
  ], [
    { afterTurn: 32, mustRecall: ['Sam teaches year five', 'twin sisters Priya Anjali', 'does not drink', 'half marathon'], mustNotClaim: ['teaches year four now'] },
    { afterTurn: 64, mustRecall: ['Sam teaches year five', 'moved from Leeds', 'half marathon in May', 'sourdough starter Kevin'], mustNotClaim: ['marathon in April'] },
  ]),
];
