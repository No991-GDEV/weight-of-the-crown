import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';
import {createTestState,MODULE_ID,DEGREE_LABELS,assertRealm} from '../scripts/core.js';
import {executeRealmCommand} from '../scripts/commands.js';
import {realmView} from '../scripts/view.js';
import {QUEST_DEGREES,openQuestCount} from '../scripts/quests.js';
const gm={id:'gm',isGM:true},owner={id:'owner',isGM:false},other={id:'other',isGM:false},stranger={id:'stranger',isGM:false};
function merge(target,value){for(const[k,v]of Object.entries(value)){if(k.startsWith('-='))delete target[k.slice(2)];else if(v&&typeof v==='object'&&!Array.isArray(v)){if(!target[k]||typeof target[k]!=='object')target[k]={};merge(target[k],v);}else target[k]=structuredClone(v);}return target;}
function fixture(){
 const box={state:createTestState('quest_results')};box.state.resources={res_treasury:5,res_wood:0,res_stone:0,res_metal:0,res_food:0};let op=0;
 const actor={id:'realm',type:'party',name:'Ensaio',getFlag:()=>box.state,testUserPermission:(u,p)=>u.isGM||(['owner','other'].includes(u.id)&&p<=2),async update(patch){for(const[path,value]of Object.entries(patch)){if(!path.startsWith(`flags.${MODULE_ID}.state.`))continue;const keys=path.slice(`flags.${MODULE_ID}.state.`.length).split('.');let at=box.state;for(const k of keys.slice(0,-1))at=at[k]??={};const key=keys.at(-1);if(key.startsWith('-='))delete at[key.slice(2)];else if(value&&typeof value==='object'&&!Array.isArray(value))at[key]=merge(at[key]??{},value);else at[key]=structuredClone(value);}return actor;}};
 const docs=new Map(['hero','npc','foreign'].map(id=>[`Actor.${id}`,{uuid:`Actor.${id}`,documentName:'Actor',type:id==='hero'?'character':'npc',testUserPermission:(u,p)=>u.isGM||(id==='foreign'?u.id==='other':u.id==='owner')&&p<=3}]));
 const cmd=(c,user=gm,id=`op_${++op}`)=>executeRealmCommand(actor,user,c,id,{resolveActor:async uuid=>docs.get(uuid)??null});
 const texts={criticalSuccess:'APENAS_CRITICO_POSITIVO',success:'APENAS_SUCESSO',failure:'APENAS_FALHA',criticalFailure:'APENAS_CRITICO_NEGATIVO'};
 const define=(id='quest',kind='activity',extra={})=>cmd({action:'definition.save',kind,definitionId:id,fields:{name:id,description:'Objetivo público',skillId:'skill_trade',dc:'15',suitability:'0',stages:'',benefit:'Texto geral antigo',requiresCheck:'true',...Object.fromEntries(QUEST_DEGREES.map(d=>[`${d}Text`,texts[d]])),...extra},durationWeeks:1,repeatable:true,outcome:{resources:{res_wood:1},effects:{}}});
 const bind=(id,uuid='Actor.hero',user=owner,kind='activity')=>cmd({action:'binding.save',kind,definitionId:id,actorUuid:uuid},user);
 const finish=(id,result='success')=>cmd({action:'quest.complete',questId:id,confirmed:true,advance:false,result});
 return{box,actor,cmd,define,bind,finish,texts};
}
const template=Handlebars.compile(await fs.readFile(new URL('../templates/realm.hbs',import.meta.url),'utf8'));

test('quatro textos são normalizados e limites/campos inválidos não alteram estado',async()=>{
 const f=fixture();await f.define();assert.deepEqual(f.box.state.activityDefinitions.quest.resultTexts,f.texts);assertRealm(f.box.state);
 const before=JSON.stringify(f.box.state);await assert.rejects(f.define('quest','activity',{successText:'x'.repeat(12001)}));assert.equal(JSON.stringify(f.box.state),before);
 f.box.state.activityDefinitions.quest.resultTexts.extra='injetado';assert.throws(()=>assertRealm(f.box.state));
});
test('cada grau mostra somente seu texto em Concluídas, sem HTML executável',async()=>{
 for(const degree of QUEST_DEGREES){const f=fixture();await f.define();await f.finish('quest',degree);const view=realmView(f.box.state,true,false),html=template({...view,sectionDefinitions:true});
  assert.equal(view.completedDefinitions[0].resultLabel,DEGREE_LABELS[degree]);assert.equal(view.completedDefinitions[0].resultNarrative,f.texts[degree]);
  for(const other of QUEST_DEGREES)assert.equal(html.includes(f.texts[other]),other===degree);assert.equal(html.includes('Texto geral antigo'),false);
 }
 const f=fixture();await f.define('xss','activity',{successText:'<img src=x onerror=alert(1)>'});await f.finish('xss');const html=template({...realmView(f.box.state,false,false),sectionDefinitions:true});assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);
});
test('edição posterior dos textos não reescreve narrativa já concluída',async()=>{
 const f=fixture();await f.define();await f.bind('quest');await f.finish('quest');await f.define('quest','activity',{successText:'Texto futuro'});
 assert.equal(f.box.state.activityDefinitions.quest.quest.resultText,f.texts.success);assert.equal(realmView(f.box.state,true,true).completedDefinitions[0].resultNarrative,f.texts.success);
});
test('Alterar resultado corrige grau/texto sem repetir recursos, tempo ou recompensas',async()=>{
 const f=fixture();await f.define();await f.finish('quest');const resources=structuredClone(f.box.state.resources),week=f.box.state.calendar.ordinalWeek;
 await f.cmd({action:'quest.result',kind:'activity',definitionId:'quest',result:'criticalFailure'});
 assert.equal(f.box.state.activityDefinitions.quest.quest.resultText,f.texts.criticalFailure);assert.deepEqual(f.box.state.resources,resources);assert.equal(f.box.state.calendar.ordinalWeek,week);
 await assert.rejects(f.cmd({action:'quest.result',kind:'activity',definitionId:'quest',result:'success'},owner));
 await f.cmd({action:'quest.result',kind:'activity',definitionId:'quest',result:null});assert.equal(realmView(f.box.state,true,true).completedDefinitions[0].resultLabel,'Resultado não informado');
});
test('conclusão antiga preserva texto geral e não inventa grau',async()=>{
 const f=fixture();await f.define();const d=f.box.state.activityDefinitions.quest;delete d.resultTexts;d.quest={durationWeeks:1,status:'completed',startWeek:1,completionWeek:1,timeCounted:false,benefitsApplied:true};
 const before=JSON.stringify(f.box.state),view=realmView(f.box.state,true,true);assert.equal(view.completedDefinitions[0].resultLabel,'Resultado não informado');assert.equal(view.completedDefinitions[0].resultNarrative,'Texto geral antigo');assert.equal(JSON.stringify(f.box.state),before);
 await f.define('quest','activity',{successText:'Novo sucesso'});assert.equal(d.quest.resultText,'Texto geral antigo');
});
test('repetição arquiva resultado/responsável e limpa dados da execução nova com merge Foundry',async()=>{
 const f=fixture();await f.define();await f.bind('quest');await f.finish('quest','failure');await f.cmd({action:'quest.repeat',questId:'quest',confirmed:true});
 const q=f.box.state.activityDefinitions.quest.quest;assert.equal(q.result,undefined);assert.equal(q.resultText,undefined);assert.equal(q.grantedResources,undefined);
 await f.define('quest','activity',{failureText:'Falha futura'});const archived=realmView(f.box.state,true,true).completedDefinitions[0];assert.equal(archived.archived,true);assert.equal(archived.resultNarrative,f.texts.failure);assert.equal(archived.actorUuid,'Actor.hero');
});
test('dois vínculos abertos por PJ: terceira Quest é recusada e conclusão libera vaga',async()=>{
 const f=fixture();for(const id of ['a','b','c'])await f.define(id);await f.bind('a');await f.bind('b');await assert.rejects(f.bind('c'),/duas Quests/);assert.equal(openQuestCount(f.box.state,'Actor.hero'),2);
 await f.finish('a');await f.bind('c');assert.equal(openQuestCount(f.box.state,'Actor.hero'),2);
});
test('limite também vale para NPC atribuído pelo Mestre e não conta construções/cargos',async()=>{
 const f=fixture();for(const id of ['a','b','c'])await f.define(id);await f.define('building','project');await f.bind('a','Actor.npc',gm);await f.bind('b','Actor.npc',gm);await f.bind('building','Actor.npc',gm,'project');await assert.rejects(f.bind('c','Actor.npc',gm),/duas Quests/);
});
test('vínculos concorrentes são serializados: duas aceitações e uma recusa',async()=>{
 const f=fixture();for(const id of ['a','b','c'])await f.define(id);const results=await Promise.allSettled(['a','b','c'].map(id=>f.bind(id)));assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(openQuestCount(f.box.state,'Actor.hero'),2);
});
test('observador do reino pode vincular próprio Actor, mas não editar recursos/definições',async()=>{
 const f=fixture();await f.define();await f.bind('quest');assert.equal(f.box.state.activityDefinitions.quest.actorUuid,'Actor.hero');
 await assert.rejects(f.cmd({action:'field',path:'resources.res_wood',value:'2'},owner),/permissão/);await assert.rejects(f.cmd({action:'definition.delete',kind:'activity',definitionId:'quest',confirmed:true},owner));
 await assert.rejects(f.cmd({action:'binding.save',kind:'activity',definitionId:'quest',actorUuid:'Actor.hero',resources:99},owner),/Campos/);
});
test('jogador não toma nem remove personagem de outro controlador',async()=>{
 const f=fixture();await f.define();await f.bind('quest','Actor.foreign',gm);await assert.rejects(f.bind('quest'),/controlador/);await assert.rejects(f.bind('quest',null),/controlador/);
 const g=fixture();await g.define();await assert.rejects(g.bind('quest','Actor.foreign'),/controla/);await assert.rejects(g.bind('quest','Actor.hero',stranger),/acesso/);
});
test('remover vínculo libera vaga; reentrega do mesmo vínculo não gasta outra',async()=>{
 const f=fixture();for(const id of ['a','b','c'])await f.define(id);await f.bind('a');await f.bind('a');await f.bind('b');assert.equal(openQuestCount(f.box.state,'Actor.hero'),2);await f.bind('a',null);await f.bind('c');assert.equal(openQuestCount(f.box.state,'Actor.hero'),2);
});
test('reabrir com responsável ocupado exige liberar vaga ou escolher execução sem responsável',async()=>{
 const f=fixture();for(const id of ['a','b','c'])await f.define(id);await f.bind('a');await f.finish('a');await f.bind('b');await f.bind('c');await assert.rejects(f.cmd({action:'quest.repeat',questId:'a',confirmed:true}),/duas Quests/);
 await f.cmd({action:'quest.repeat',questId:'a',confirmed:true,keepActor:false});assert.equal(f.box.state.activityDefinitions.a.actorUuid,null);assert.equal(openQuestCount(f.box.state,'Actor.hero'),2);
});
test('vínculos antigos acima do limite são preservados, mas não permitem nova atribuição',async()=>{
 const f=fixture();for(const id of ['a','b','c','d'])await f.define(id);for(const id of ['a','b','c'])f.box.state.activityDefinitions[id].actorUuid='Actor.hero';const before=JSON.stringify(f.box.state);realmView(f.box.state,true,true);assert.equal(JSON.stringify(f.box.state),before);await assert.rejects(f.bind('d'),/duas Quests/);
});
test('avatar/slot estão no resumo antes da CD e jogador vê somente controles do próprio vínculo',async()=>{
 const f=fixture();await f.define();await f.bind('quest');const view=realmView(f.box.state,false,false,{canAssignQuests:true,ownedActorUuids:['Actor.hero'],actors:{'Actor.hero':{actorUuid:'Actor.hero',actorName:'Herói',actorImg:'icons/svg/mystery-man.svg',canOpenActor:true}}});const html=template({...view,sectionDefinitions:true});
 const summary=html.slice(html.indexOf('<summary><span class="twoc-task-chevron"'),html.indexOf('</summary>',html.indexOf('<summary><span class="twoc-task-chevron"')));assert.ok(summary.indexOf('twoc-quest-assignee')<summary.indexOf('twoc-dc'));assert.match(summary,/data-drop-definition="quest"/);assert.match(summary,/1\/2/);assert.equal(html.includes('twoc-actor-slot'),false);
});
test('badges de concluída usam recursos registrados, não recompensa editada depois',async()=>{
 const f=fixture();await f.define();await f.finish('quest');f.box.state.activityDefinitions.quest.outcome.resources.res_wood=99;assert.equal(realmView(f.box.state,true,true).completedDefinitions[0].rewardLabels[0].value,1);
});
