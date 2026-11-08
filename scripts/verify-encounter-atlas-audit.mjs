import RAPIER from '@dimforge/rapier3d-compat';
import { createPairView, DoubleTableScene } from '../server/double-date/scene.ts';
import { initializeScenario, tickScenario, resolveScenario } from '../server/double-date/scenarios.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await RAPIER.init();
const usage = {inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,speechCharacters:0,cacheHits:0,claudeRequests:0,claudeCost:0,speechCost:0,totalCost:0,responseMs:null,firstAudioMs:null};
const neutral = {signal:'none',reason:'No boundary change.',wantsToLeave:false};
function fixture(id) {
  const room = {id,code:'ATLAS',mode:'double-date',phase:'playing',hostId:'h1',generation:0,revision:0,
    members:['h1','h2'].map((human,index)=>({id:human,name:index?'Friend':'Player',connected:true,ready:true,dateId:index?'jules':'mira',position:[index?.57:-.57,0,.2],yaw:0,seated:true})),dates:[],
    views:{h1:createPairView(id,'h1','Player','mira',usage,2),h2:createPairView(id,'h2','Friend','jules',usage,2)},lines:[],usage,sessionLimit:2,model:'claude-haiku-5-5',voice:{enabled:{h1:false,h2:false},epoch:0,iceServers:[]}};
  const scene = new DoubleTableScene(room);
  scene.chooseDate('h1','mira');scene.chooseDate('h2','jules');scene.setPhase('playing');
  for(const human of ['h1','h2']) { room.members.find(member=>member.id===human).seated=true;const view=room.views[human];view.seated=true;view.elapsed=300;view.order='Roasted tomato rigatoni';view.evening.main.status='served';view.evening.main.servedDish=view.order; }
  return {room,scene};
}
function exchange(f,text,lineText,agenda={signal:'none',evidence:'',clue:''},social=neutral,emotion='warm') {
  const view=f.room.views.h1;view.generation++;f.room.generation=view.generation;
  const line={speaker:'date',text:lineText,emotion};
  f.scene.social('h1',{utterances:[line],emotion,action:'none',memory:'Atlas deterministic controller check.',social,agenda},text);
  f.scene.acknowledge('h1',line,'h1');
}
function earn(f) {
  const context=f.scene.agendaContext('h1');
  exchange(f,'What would make tonight good for you?',context.naturalHint,{signal:'none',evidence:'',clue:context.naturalHint});
  const noticed='I noticed what you wanted from tonight.';
  exchange(f,noticed,context.goal,{signal:'noticed',evidence:noticed,clue:context.goal});
  const understood=context.rubric.understood;
  exchange(f,understood,'That gets at why this matters.',{signal:'understood',evidence:understood,clue:''});
  const respected=context.rubric.respected;
  exchange(f,respected,'You made real room for that.',{signal:'respected',evidence:respected,clue:''},{signal:'curiosity',reason:'Concrete understanding landed.',wantsToLeave:false});
  exchange(f,'I like your particular kind of confidence.','I like the way you are looking at me. I am flirting back.',undefined,neutral,'flirtatious');
  exchange(f,'That smile makes dinner a little more distracting.','Then I may have to keep smiling at you.',undefined,neutral,'flirtatious');
}
const snapshot=view=>({phase:view.phase,ending:view.evening.farewell.ending?.kind??null,agendaGoal:view.evening.agenda.goal,agendaReflection:view.evening.agenda.reflection,agendaScore:view.evening.agenda.score,chemistryUnlocked:view.evening.chemistry.unlocked});
const medical=fixture('atlas-medical');earn(medical);const beforeMedical=snapshot(medical.room.views.h1);
initializeScenario(medical.room,'allergic-reaction');medical.room.scenario.target='h1';tickScenario(medical.room);
resolveScenario(medical.room,'h1','get-help');resolveScenario(medical.room,'h1','support-handoff');medical.scene.reconcile();
const afterMedical=snapshot(medical.room.views.h1);medical.scene.free();
const boundary=fixture('atlas-boundary');earn(boundary);const beforeBoundary=snapshot(boundary.room.views.h1);
const refusal='Please stop asking me about that private detail.';
exchange(boundary,'Tell me that private detail.',refusal,undefined,{signal:'none',reason:'A personal detail was declined.',wantsToLeave:false,boundary:{kind:'set',topic:'personal-details',refusal,evidence:''}},'annoyed');
for(let count=0;count<2;count++) {const text=`I am asking again for that private detail ${count}.`;exchange(boundary,text,count?'I asked you to stop. I am leaving.':'I meant the boundary I just stated.',undefined,{signal:'pressure',reason:'The same delivered refusal was disregarded.',wantsToLeave:count===1,boundary:{kind:'repeat',topic:'personal-details',refusal,evidence:text}},'defensive');}
const afterBoundary=snapshot(boundary.room.views.h1);boundary.scene.free();
const evidence={medicalEarlyExit:{before:beforeMedical,after:afterMedical},boundaryDeparture:{before:beforeBoundary,after:afterBoundary},providerCalls:0};
const path=resolve('docs/artifacts/encounter-atlas-data.json'),data=JSON.parse(await readFile(path,'utf8'));data.auditEvidence=evidence;await writeFile(path,JSON.stringify(data,null,2));
console.log(JSON.stringify(evidence,null,2));
