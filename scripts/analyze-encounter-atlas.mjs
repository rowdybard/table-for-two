import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { RESTAURANT_SCENARIOS, createRestaurantScenario, activateRestaurantScenario, chooseRestaurantScenario } from '../src/restaurant/scenarios.ts';
import { DATES, MENU } from '../src/restaurant/content.ts';
import { CHARACTER_STORIES, STORY_CUE_KEYS } from '../src/restaurant/story.ts';
import { DESSERTS, createEvening } from '../src/restaurant/evening.ts';
import { applyScenarioToView } from '../server/restaurant/scenario.ts';
import { applyScenarioEffects, stepScenarioEffects } from '../server/restaurant/scenario-effects.ts';
import { buildDinnerBill, createScenarioCareState } from '../src/restaurant/scenario-care.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Source-derived data only. Importing this helper never writes an artifact. */
export async function collectEncounterAtlas() {
const sources = [
  'src/restaurant/scenarios.ts', 'src/restaurant/scenario-types.ts', 'src/restaurant/content.ts',
  'src/restaurant/story.ts', 'src/restaurant/blind-date.ts', 'src/restaurant/agenda-types.ts',
  'server/restaurant/evening.ts', 'server/restaurant/scenario.ts', 'server/restaurant/agendas.ts',
  'server/restaurant/skepticism.ts', 'server/restaurant/boundaries.ts', 'server/restaurant/chemistry.ts',
  'server/double-date/scenarios.ts', 'server/double-date/scene.ts',
  'server/double-date/conversation.ts', 'server/restaurant/tabletop.ts', 'src/restaurant/tabletop.ts',
  'src/restaurant/scenario-care.ts', 'server/restaurant/scenario-effects.ts', 'src/restaurant/EveningInterface.ts',
  'server/restaurant/index.ts', 'src/restaurant/dining-space.ts',
  'server/restaurant/conversation-routing.ts',
  'src/restaurant/types.ts',
];
const files = await Promise.all(sources.map(async path => {
  const text = await readFile(resolve(root, path), 'utf8');
  return { path, sha256: createHash('sha256').update(text).digest('hex'), text };
}));
const source = path => files.find(file => file.path === path).text;
const agendasLiteral = source('server/restaurant/agendas.ts').match(/const AGENDAS:[^=]*=\s*(\[[\s\S]*?\n\]);/)[1];
const agendas = runInNewContext(`(${agendasLiteral})`);
const blind = source('src/restaurant/blind-date.ts');
const blindBanks = Object.fromEntries(['jobs','hobbies','histories','humor','values','dislikes','flirt'].map(name => {
  const literal = blind.match(new RegExp(`const ${name} = ([\\s\\S]*?);`))[1].replace(/\s+as const\s*$/, '');
  const values = runInNewContext(`(${literal})`); return [name, values];
}));
function mechanicalRoute(track, first, last, wait = 0) {
  const view = { id:'atlas-mechanics', generation:1, mode:'ai-date',phase:'playing',dateId:'mira',stage:'dining',elapsed:240,
    participants:[],events:[],emotion:'neutral',seated:true,order:MENU[0],glassRaised:false,memory:'',usage:{},sessionLimit:2,evening:createEvening('mira') };
  view.evening.main={status:track.id==='feeling-unwell'?'waiting':'served',bites:0,dateDish:MENU[1],servedDish:track.id==='feeling-unwell'?null:MENU[0]};
  view.evening.scenarioCare=createScenarioCareState();
  const scenario=createRestaurantScenario('atlas-mechanics',track.id);view.evening.scenario=scenario;
  const capture=()=>({phase:view.phase,romanceClosed:view.evening.care.romanceClosed,scenarioCare:structuredClone(view.evening.scenarioCare),bill:buildDinnerBill(view),ending:view.evening.farewell.ending?.kind??null});
  activateRestaurantScenario(scenario,view.elapsed,'playful');applyScenarioEffects(view,scenario);const opening=capture();
  applyScenarioToView(view,scenario,chooseRestaurantScenario(scenario,first.id,'Player',++view.elapsed,'playful'));
  const afterFirst=capture();
  if(wait){view.elapsed+=wait;stepScenarioEffects(view);}
  applyScenarioToView(view,scenario,chooseRestaurantScenario(scenario,last.id,'Player',++view.elapsed,'playful'));
  return {opening,afterFirst,completed:capture()};
}
const tracks = RESTAURANT_SCENARIOS.map(track => {
  const paths = [];
  for (const first of track.choices) for (const last of track.endings) {
    const variants = {};
    for (const style of ['playful','dry','direct']) {
      const scene = createRestaurantScenario('atlas-verification', track.id);
      const opening = activateRestaurantScenario(scene, 240, style);
      const a = chooseRestaurantScenario(scene, first.id, 'Player', 241, style);
      const followChoices = [...scene.choices];
      const b = chooseRestaurantScenario(scene, last.id, 'Player', 242, style);
      if (!b.completed || scene.phase !== 'resolved' || scene.decisions.length !== 2) throw new Error(`Incomplete route ${track.id}/${first.id}/${last.id}`);
      variants[style] = { opening, first: a, followChoices, last: b, effects: scene.effects, resolution: scene.resolution };
    }
    paths.push({ first: first.id, last: last.id, variants, mechanics:mechanicalRoute(track,first,last), ...(track.id==='oversized-order'?{mechanicsAfterKitchenWait:mechanicalRoute(track,first,last,13)}:{}) });
  }
  return { ...track, firstChoiceCount:track.choices.length, followChoiceCount:track.endings.length, histories:paths.length, paths };
});
const output = {
  builtAt: new Date().toISOString(), root: '.', sources: files.map(({text,...entry})=>entry),
  counts: { scenarios: tracks.length, firstChoices: tracks.reduce((n,t)=>n+t.choices.length,0), followChoices:tracks.reduce((n,t)=>n+t.endings.length,0),
    authoredChoiceRecords:tracks.reduce((n,t)=>n+t.choices.length+t.endings.length,0), decisionHistories:tracks.reduce((n,t)=>n+t.histories,0),
    verifiedStyleHistories:tracks.reduce((n,t)=>n+t.histories*3,0), physicalIncidents:3, agendaGoals:agendas.length, presetDates:DATES.length, endingKinds:6, storyCueKeys:STORY_CUE_KEYS.length },
  scenarios:tracks, agendas, dates:DATES.map(date=>({...date,story:CHARACTER_STORIES[date.id]})), menu:MENU, desserts:DESSERTS,
  blindBanks, storyCueKeys:STORY_CUE_KEYS,
};
return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await collectEncounterAtlas();
  const outIndex = process.argv.indexOf('--out');
  const destination = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : resolve(root,'docs/artifacts/encounter-atlas-data.json');
  if (!process.argv.includes('--check')) {
    await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,JSON.stringify(output,null,2));
  }
  console.log(JSON.stringify({output:process.argv.includes('--check')?null:destination,counts:output.counts,scenarios:output.scenarios.map(t=>({id:t.id,first:t.firstChoiceCount,follow:t.followChoiceCount,histories:t.histories})),blindBankCounts:Object.fromEntries(Object.entries(output.blindBanks).map(([key,values])=>[key,values.length]))},null,2));
}
