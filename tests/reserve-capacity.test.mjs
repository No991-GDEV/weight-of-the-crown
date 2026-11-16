import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';
import {createTestState,assertRealm} from '../scripts/core.js';
import {executeRealmCommand} from '../scripts/commands.js';
import {resourceSummary,resourceCapacity,checkContributions,normalizeCheckEffect} from '../scripts/management.js';
import {normalizeRole,STANDARD_ROLES} from '../scripts/roles.js';
import {realmView} from '../scripts/view.js';
const gm={id:'gm',isGM:true},owner={id:'owner',isGM:false};
const effect=(extra={})=>({id:'storage',name:'Armazém',description:'Abrigo para reservas',type:'untyped',value:10,target:{kind:'reserveCapacity'},enabled:true,...extra});
function fixture(){
 const store={state:createTestState('capacity')};store.state.resources={res_treasury:8,res_wood:0,res_stone:0,res_metal:0,res_food:0};let n=0;
 const actor={id:'capacity',name:'Ensaio',type:'party',getFlag:()=>store.state,testUserPermission:u=>u.isGM||u.id===owner.id,async update(patch){for(const[path,value]of Object.entries(patch)){const parts=path.replace('flags.weight-of-the-crown.state.','').split('.');let at=store.state;for(const p of parts.slice(0,-1))at=at[p]??={};const key=parts.at(-1);if(key.startsWith('-='))delete at[key.slice(2)];else at[key]=structuredClone(value);}return this;}};
 const cmd=(c,user=gm)=>executeRealmCommand(actor,user,c,`capacity_${++n}`);
 const define=(id='warehouse',outcome={resources:{},effects:{storage:effect()}},kind='project')=>cmd({action:'definition.save',kind,definitionId:id,fields:{name:id,description:'',skillId:'',dc:'',suitability:'0',stages:'',benefit:'',requiresCheck:'false'},durationWeeks:1,repeatable:true,outcome});
 const complete=(id='warehouse',kind='project')=>cmd({action:kind==='project'?'project.complete':'quest.complete',[kind==='project'?'projectId':'questId']:id,advance:false,confirmed:true});
 return{store,cmd,define,complete};
}
test('sem novos efeitos preserva o teto, JSON antigo e campo legado',()=>{
 const f=fixture();f.store.state.rulesVersion='0.40.0';f.store.state.foodStorage.capacity=999;assertRealm(f.store.state);
 assert.equal(resourceSummary(f.store.state).capacity,10);assert.equal(resourceCapacity(f.store.state).base,10);
});
test('efeito ativo aumenta limite; desativado e alvo de teste não alteram capacidade',async()=>{
 const f=fixture();await f.cmd({action:'effect.save',scope:'realm',effect:effect()});assert.equal(resourceSummary(f.store.state).capacity,20);
 await f.cmd({action:'resourceDelta',resourceId:'res_wood',delta:12},owner);assert.equal(resourceSummary(f.store.state).total,20);
 await f.cmd({action:'effect.save',scope:'realm',effect:effect({enabled:false})});assert.equal(resourceSummary(f.store.state).capacity,10);assert.equal(f.store.state.resources.res_wood,12);
 await f.cmd({action:'effect.save',scope:'realm',effect:effect({target:{kind:'all'}})});assert.equal(resourceSummary(f.store.state).capacity,10);
});
test('reduzir capacidade mantém excesso, bloqueia entrada e permite consumo',async()=>{
 const f=fixture();await f.cmd({action:'effect.save',scope:'realm',effect:effect({value:-5})});assert.equal(resourceSummary(f.store.state).excess,3);
 await assert.rejects(f.cmd({action:'resourceDelta',resourceId:'res_food',delta:1}),/limite|capacidade/);
 await f.cmd({action:'resourceDelta',resourceId:'res_treasury',delta:-3});assert.equal(resourceSummary(f.store.state).total,5);
});
test('limite mínimo zero não gera NaN ou infinito no indicador',async()=>{
 const f=fixture();await f.cmd({action:'effect.save',scope:'realm',effect:effect({value:-100})});assert.equal(resourceSummary(f.store.state).capacity,0);assert.equal(realmView(f.store.state,true,true).resourcePercent,100);
 await f.cmd({action:'resources',values:{res_treasury:0}});assert.equal(realmView(f.store.state,true,true).resourcePercent,0);
});
test('capacidade sazonal segue somente a estação ativa',async()=>{
 const f=fixture();await f.cmd({action:'effect.save',scope:'season',ownerId:'winter',effect:effect()});assert.equal(resourceSummary(f.store.state).capacity,10);
 await f.cmd({action:'season',season:'winter'});assert.equal(resourceSummary(f.store.state).capacity,20);
 await f.cmd({action:'season',season:'summer'});assert.equal(resourceSummary(f.store.state).capacity,10);
});
test('armazéns distintos somam mesmo tipo, mesma obra nunca duplica',async()=>{
 const f=fixture();for(const id of ['a','b']){await f.define(id,{resources:{},effects:{storage:effect({type:'status'})}});assert.equal(resourceSummary(f.store.state).capacity,id==='a'?10:20);await f.complete(id);}
 assert.equal(resourceSummary(f.store.state).capacity,30);await f.complete('a');assert.equal(resourceSummary(f.store.state).capacity,30);
 await f.cmd({action:'project.status',projectId:'a',status:'pending'});assert.equal(resourceSummary(f.store.state).capacity,20);
 await f.cmd({action:'project.status',projectId:'a',status:'completed'});assert.equal(resourceSummary(f.store.state).capacity,30);
});
test('conclusão usa capacidade ampliada para recursos na mesma operação',async()=>{
 const f=fixture();await f.define('warehouse',{resources:{res_wood:12},effects:{storage:effect()}});await f.complete();assert.equal(resourceSummary(f.store.state).total,20);assert.equal(resourceSummary(f.store.state).capacity,20);
});
test('obra resolve excesso anterior e permite recompensa dentro do novo teto',async()=>{
 const f=fixture();f.store.state.resources.res_treasury=15;await f.define('warehouse',{resources:{res_wood:2},effects:{storage:effect()}});await f.complete();assert.equal(resourceSummary(f.store.state).total,17);
});
test('se recompensa ainda não couber, obra, recursos e calendário permanecem intactos',async()=>{
 const f=fixture();await f.define('warehouse',{resources:{res_wood:13},effects:{storage:effect()}});const before=JSON.stringify(f.store.state);await assert.rejects(f.complete(),/capacidade/);assert.equal(JSON.stringify(f.store.state),before);
});
test('Quest repetida não multiplica efeito e desativá-lo restaura o limite',async()=>{
 const f=fixture();await f.define('permit',{resources:{},effects:{storage:effect()}},'activity');await f.complete('permit','activity');await f.cmd({action:'quest.repeat',questId:'permit',confirmed:true});await f.complete('permit','activity');assert.equal(resourceSummary(f.store.state).capacity,20);
 await f.cmd({action:'effect.save',scope:'realm',effect:effect({id:'temporary',value:5})});assert.equal(resourceSummary(f.store.state).capacity,25);await f.cmd({action:'effect.delete',scope:'realm',effectId:'temporary'});assert.equal(resourceSummary(f.store.state).capacity,20);
});
test('talento só amplia quando escolhido e uma vez por origem',async()=>{
 const f=fixture();await f.cmd({action:'feat.save',feat:{id:'storage_feat',name:'Depósitos',description:'',minimumLevel:2,repeatable:true,retired:false,prerequisites:{feats:[],skills:[],abilities:[]},effects:{storage:effect()}}});assert.equal(resourceSummary(f.store.state).capacity,10);
 await f.cmd({action:'feature.choose',slotId:'level_2_feat',choice:{featId:'storage_feat'}},owner);assert.equal(resourceSummary(f.store.state).capacity,20);
 f.store.state.progression.level=4;await f.cmd({action:'feature.choose',slotId:'level_4_feat',choice:{featId:'storage_feat'}},owner);assert.equal(resourceSummary(f.store.state).capacity,30);assert.equal(resourceCapacity(f.store.state).modifiers.length,1);
 f.store.state.progression.level=1;assert.equal(resourceSummary(f.store.state).capacity,5);
});
test('armazenamento não entra em rolagens; alvos de cargo e crises continuam restritos',async()=>{
 const f=fixture();await f.cmd({action:'effect.save',scope:'realm',effect:effect()});await f.define();await f.complete();assert.equal(checkContributions(f.store.state,{}, {skillId:'skill_industry'}).some(m=>/Armazém/.test(m.label)),false);
 for(const bad of [effect({value:1.5}),effect({target:{kind:'reserveCapacity',id:'fake'}}),effect({internalCrisis:true})])assert.throws(()=>normalizeCheckEffect(bad,'storage',f.store.state));
 assert.throws(()=>normalizeRole({...STANDARD_ROLES[0],vacancy:{value:1,target:{kind:'reserveCapacity'}}},STANDARD_ROLES[0].id));
 await assert.rejects(f.cmd({action:'effect.save',scope:'realm',effect:effect()},owner),/Mestre/);
});
test('JSON, origem no contador e controles do Mestre preservam ajustes',async()=>{
 const f=fixture();await f.define();await f.complete();const copy=JSON.parse(JSON.stringify(f.store.state));assertRealm(copy);assert.equal(resourceSummary(copy).capacity,20);
 const t=Handlebars.compile(await fs.readFile(new URL('../templates/realm.hbs',import.meta.url),'utf8')),view=realmView(copy,true,true),html=t({...view,sectionOverview:true});assert.match(view.resourceCapacityTitle,/Base: 5 × 2 = 10/);assert.match(view.resourceCapacityTitle,/warehouse · Armazém: \+10/);assert.match(html,/aria-label="Editar efeitos do limite de reservas"/);assert.doesNotMatch(t({...realmView(copy,false,false),sectionOverview:true}),/aria-label="Editar efeitos do limite de reservas"/);
});
