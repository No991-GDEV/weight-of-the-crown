import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';
import {createTestState,MODULE_ID} from '../scripts/core.js';
import {catalogFeats,CATALOG_VERSION} from '../scripts/feat-catalog.js';
import {executeRealmCommand} from '../scripts/commands.js';
import {armyGateway,recoverTraining} from '../scripts/army.js';
import {realmView} from '../scripts/view.js';
import {checkContributions,bestBuilding,stackedContributionTotal} from '../scripts/management.js';
function collection(rows){rows.has=id=>rows.some(a=>a.id===id);rows.get=id=>rows.find(a=>a.id===id);return rows;}
const gm={id:'gm_review',isGM:true},owner={id:'owner_review',isGM:false};
const get=(o,path)=>path.split('.').reduce((v,k)=>v?.[k],o);
function patch(o,p){for(const[path,value]of Object.entries(p)){const keys=path.split('.');let at=o;for(const key of keys.slice(0,-1))at=at[key]??={};const key=keys.at(-1);if(key.startsWith('-='))delete at[key.slice(2)];else at[key]=structuredClone(value);}}
function flatten(o,prefix=''){return Object.fromEntries(Object.entries(o).flatMap(([k,v])=>{const key=prefix?`${prefix}.${k}`:k;return v&&typeof v==='object'&&!Array.isArray(v)?Object.entries(flatten(v,key)):[[key,v]];}));}
globalThis.foundry={utils:{getProperty:get,flattenObject:flatten}};
globalThis.game={settings:{get:()=>1},actors:[]};
function fixture(id='review_realm'){
 const state=createTestState(id);state.progression.level=10;state.resources={res_treasury:10,res_wood:0,res_stone:0,res_metal:0,res_food:10};state.feats=catalogFeats();state.featCatalogVersion=CATALOG_VERSION;
 const source={name:'Reino de memória',flags:{[MODULE_ID]:{state}}};
 const realm={id,uuid:`Actor.${id}`,name:source.name,type:'party',ownership:{default:0},getFlag:(scope,key)=>source.flags[scope]?.[key],testUserPermission:u=>u.isGM||u.id===owner.id,update:async p=>{patch(source,p);return realm;}};
 let counter=0;return{realm,source,state:()=>realm.getFlag(MODULE_ID,'state'),cmd:(data,deps={},user=gm,operationId=`review_op_${++counter}`)=>executeRealmCommand(realm,user,data,operationId,deps)};
}
function military(realm,{name='Nome antigo',food=3,managed=true}={}){
 const source={name,system:{consumption:food,ac:{value:17},traits:{type:'infantry'}},flags:{[MODULE_ID]:managed?{army:{realmId:realm.id,unitId:'unit_review'}}:{}}};
 const army={id:'army_review',uuid:'Actor.army_review',type:'army',_source:source,get name(){return source.name},get system(){return source.system},get items(){return[]},getFlag:(scope,key)=>source.flags[scope]?.[key],update:async p=>{patch(source,p);return army;},setFlag:async(scope,key,value)=>{patch(source,{[`flags.${scope}.${key}`]:value});return army;},delete:async()=>{game.actors.splice(game.actors.indexOf(army),1);},unsetFlag:async(scope,key)=>{delete source.flags[scope][key];}};
 game.actors=collection([realm,army]);globalThis.fromUuid=async uuid=>game.actors.find(a=>a.uuid===uuid)??null;
 const unit={id:'unit_review',name:'Nome antigo',headcount:12,readiness:'ready',task:'',location:'',condition:'',notes:'',armyType:'infantry',consumption:1,trainingCount:0,armyActorUuid:army.uuid};realm.getFlag(MODULE_ID,'state').militaryUnits.unit_review=unit;return{army,unit};
}

test('consumo compara o Actor atual mesmo quando igual ao cadastro antigo, sem renomear',async()=>{
 const f=fixture(),{army}=military(f.realm,{name:'Nome nativo'});
 await f.cmd({action:'field',path:'militaryUnits.unit_review.consumption',value:'1'},{armies:armyGateway});
 assert.equal(army.system.consumption,1);assert.equal(army.name,'Nome nativo');
});
test('salvar só notas não restaura nome antigo nem sobrescreve campos concorrentes',async()=>{
 const f=fixture(),{army,unit}=military(f.realm,{name:'Nome nativo'}),snapshot=structuredClone(unit);
 unit.location='Local atualizado por outro usuário';
 await f.cmd({action:'military.save',unit:{...snapshot,notes:'Novas notas'},changedFields:['notes'],expectedActor:{name:'Nome nativo',consumption:3}},{armies:armyGateway});
 assert.equal(army.name,'Nome nativo');assert.equal(army.system.consumption,3);assert.equal(f.state().militaryUnits.unit_review.location,'Local atualizado por outro usuário');
});
test('formulário antigo recusa renomeação se o Actor foi renomeado depois de aberto',async()=>{
 const f=fixture(),{army,unit}=military(f.realm,{name:'Mais recente'});
 await assert.rejects(f.cmd({action:'military.save',unit:{...unit,name:'Minha edição'},changedFields:['name'],expectedActor:{name:'Ao abrir'}},{armies:armyGateway}),/mudou/);
 assert.equal(army.name,'Mais recente');
});
test('salvamento legado de observações também preserva nome alterado nativamente',async()=>{
 const f=fixture(),{army,unit}=military(f.realm,{name:'Nome nativo',food:1});
 await f.cmd({action:'military.save',unit:{...unit,notes:'Notas'}},{armies:armyGateway});assert.equal(army.name,'Nome nativo');
});
async function rerollFixture(){
 const f=fixture();await f.cmd({action:'feature.choose',slotId:'level_8_feat',choice:{featId:'kingdom_free_and_fair'}});
 await f.cmd({action:'definition.save',kind:'activity',definitionId:'leadership',fields:{name:'Liderança',description:'',skillId:'skill_trade',dc:'15',suitability:'0',stages:'',benefit:'',requiresCheck:'true'},durationWeeks:1,outcome:{resources:{},effects:{}},featTags:['leadership']});
 const evidence={id:'source_roll',actorId:f.realm.id,userId:owner.id,week:1,skillId:'skill_trade',activityId:'leadership',outcome:'failure',mode:'blindroll',private:true,fortuneUsed:false};
 return{...f,deps:{resolveCheck:async()=>evidence,prepareFeat:async()=> 'receipt_private',publishFeat:async()=>{}}};
}
test('chat falha após cobrança: tarefa durável e retry sem novo gasto, sem dados privados no reino',async()=>{
 const f=await rerollFixture();let attempts=0;f.deps.publishFeat=async()=>{if(++attempts===1)throw Error('Chat offline');};
 const command={action:'talent.reroll',messageId:'source_roll'};
 await assert.rejects(f.cmd(command,f.deps,gm,'reroll_once'),/finalização está pendente/);
 assert.equal(f.state().resources.res_treasury,9);
 const [task]=Object.values(f.state().pendingTasks);assert.equal(task.receiptId,'receipt_private');assert.equal('publication' in task,false);assert.equal('total' in task,false);
 delete f.state().operations.reroll_once; // The audit log is bounded, but unfinished deliveries must remain recoverable.
 await f.cmd(command,f.deps,gm,'reroll_once');assert.equal(attempts,2);assert.equal(f.state().resources.res_treasury,9);assert.equal(Object.keys(f.state().pendingTasks).length,0);
});
test('erro ao preparar recibo recusa a operação sem consumir Tesouro nem uso semanal',async()=>{
 const f=await rerollFixture();f.deps.prepareFeat=async()=>{throw Error('Sem recibo');};
 await assert.rejects(f.cmd({action:'talent.reroll',messageId:'source_roll'},f.deps,gm),/Sem recibo/);
 assert.equal(f.state().resources.res_treasury,10);assert.equal(f.state().featUses?.free_fair_w1,undefined);
});
test('exclusão parcial reaparece como tarefa; retry explícito remove Actor uma única vez',async()=>{
 const f=fixture(),{army}=military(f.realm);let attempts=0;
 const armies={...armyGateway,remove:async(...args)=>{if(++attempts===1)throw Error('Delete offline');await armyGateway.remove(...args);}};
 await assert.rejects(f.cmd({action:'military.delete',unitId:'unit_review',confirmed:true,deleteActor:true},{armies},gm,'delete_once'),/pendente/);
 assert.equal(f.state().militaryUnits.unit_review,undefined);assert.ok(game.actors.has(army.id));
 await f.cmd({action:'operation.retry',taskId:'delete_once_delete'},{armies});assert.equal(game.actors.has(army.id),false);assert.equal(attempts,2);
 await f.cmd({action:'operation.retry',taskId:'delete_once_delete'},{armies});assert.equal(attempts,2);
});
test('limpeza de Actor já excluído é idempotente',async()=>{const f=fixture(),{army,unit}=military(f.realm);await army.delete();await armyGateway.remove(f.realm,unit);});
test('recibo identifica o reino que pagou, mesmo ao recuperar em outro reino',async()=>{
 const old=fixture('old_realm'),f=fixture('new_realm'),{army}=military(f.realm,{managed:false,food:1});game.actors.push(old.realm);
 old.state().operations.paid={id:'paid',userId:gm.id,kind:'definition',at:new Date().toISOString()};
 army._source.flags[MODULE_ID].pendingTraining={realmUuid:old.realm.uuid,operationId:'paid',unitId:'old_unit',nextCount:1,at:Date.now()-40000,before:[{path:'system.ac.value',value:16}]};
 await recoverTraining(army,f.realm);assert.equal(army.system.ac.value,17);assert.equal(army.getFlag(MODULE_ID,'pendingTraining'),undefined);
});
test('recibo legado sem origem verificável não desfaz treino nem é descartado',async()=>{
 const f=fixture(),{army}=military(f.realm,{managed:false,food:1});army._source.flags[MODULE_ID].pendingTraining={operationId:'old_paid',unitId:'different_old_unit',at:Date.now()-40000,before:[{path:'system.ac.value',value:16}]};
 await assert.rejects(recoverTraining(army,f.realm),/origem verificável/);assert.equal(army.system.ac.value,17);assert.ok(army.getFlag(MODULE_ID,'pendingTraining'));
});
test('Actor preservado de reino excluído pode ser reassociado, conservando UUID e atributos',async()=>{
 const old=fixture('deleted_realm'),{army}=military(old.realm),f=fixture('new_realm');game.actors.splice(game.actors.indexOf(old.realm),1);game.actors.push(f.realm);
 await f.cmd({action:'military.attach',actorUuid:army.uuid,confirmed:true},{armies:armyGateway});
 const u=Object.values(f.state().militaryUnits)[0];assert.equal(u.armyActorUuid,army.uuid);assert.equal(army.system.ac.value,17);assert.equal(army.getFlag(MODULE_ID,'army').realmId,f.realm.id);
});
test('origem ainda existente não permite reassociação silenciosa',async()=>{const old=fixture('old'),{army}=military(old.realm),f=fixture('new');game.actors.push(f.realm);await assert.rejects(armyGateway.attach(f.realm,army.uuid,'u'),/reino existente/);});
test('jogador vê rank e botão de progressão, sem seletor que permite grau recusado',async()=>{
 const f=fixture(),view=realmView(f.state(),true,false),tpl=Handlebars.compile(await fs.readFile(new URL('../templates/realm.hbs',import.meta.url),'utf8'));
 const html=tpl({...view,sectionRealm:true});assert.doesNotMatch(html,/<select[^>]+data-field="skills\./);assert.match(html,/data-op="improveSkill"/);
});
test('todos candidatos de construção ficam disponíveis e melhor ganho muda com talento',()=>{
 const f=fixture(),project=(id,value,type)=>({id,name:id,description:'',skillId:'skill_trade',dc:15,suitability:0,stages:'',benefit:'',completionEffectsActive:true,outcome:{resources:{},effects:{boost:{id:'boost',name:'Bônus',description:'',type,value,target:{kind:'all'},enabled:true}}}});
 f.state().projects.typed=project('typed',3,'status');f.state().projects.plain=project('plain',2,'untyped');
 const all=checkContributions(f.state(),{},{skillId:'skill_trade',allBuildings:true}).filter(m=>m.source==='building'),feat={originId:'feat:optional',label:'Talento',source:'feat',type:'status',value:4};
 assert.equal(all.length,2);assert.equal(bestBuilding(all,[]).originId,'building:typed:boost');const best=bestBuilding(all,[feat]);assert.equal(best.originId,'building:plain:boost');assert.equal(stackedContributionTotal([best,feat]),6);
});

test('reassociação também funciona após remover cadastro, mantendo o reino de origem',async()=>{
 const old=fixture('old_detached'),{army}=military(old.realm),f=fixture('new_detached');delete old.state().militaryUnits.unit_review;game.actors.push(f.realm);
 await f.cmd({action:'military.attach',actorUuid:army.uuid,confirmed:true},{armies:armyGateway});assert.equal(army.getFlag(MODULE_ID,'army').realmId,f.realm.id);
});
test('recibo confirmado sobrevive à exclusão posterior do reino que pagou',async()=>{
 const f=fixture(),{army}=military(f.realm,{managed:false});army._source.flags[MODULE_ID].pendingTraining={committed:true,realmUuid:'Actor.deleted',operationId:'paid',unitId:'gone',at:Date.now()-40000,before:[{path:'system.ac.value',value:16}]};
 await recoverTraining(army,f.realm);assert.equal(army.system.ac.value,17);assert.equal(army.getFlag(MODULE_ID,'pendingTraining'),undefined);
});

test('reassociação não permite capturar uma ficha com exclusão já confirmada e pendente',async()=>{
 const old=fixture('old_delete_pending'),{army,unit}=military(old.realm),f=fixture('new_delete_pending');delete old.state().militaryUnits.unit_review;game.actors.push(f.realm);
 old.state().pendingTasks={pending_delete:{id:'pending_delete',operationId:'delete',userId:gm.id,at:Date.now(),kind:'armyDelete',unit}};
 await assert.rejects(armyGateway.attach(f.realm,army.uuid,'new_unit'),/exclusão já confirmada/);assert.equal(army.getFlag(MODULE_ID,'army').realmId,old.realm.id);
});

test('recibo legado identifica pagamento único no reino antigo após transferência externa',async()=>{
 const old=fixture('legacy_origin'),f=fixture('legacy_destination'),{army}=military(f.realm,{managed:false});game.actors.push(old.realm);
 old.state().operations.legacy_paid={id:'legacy_paid',userId:gm.id,kind:'definition',at:new Date().toISOString()};
 army._source.flags[MODULE_ID].pendingTraining={operationId:'legacy_paid',unitId:'old_unit',at:Date.now()-40000,before:[{path:'system.ac.value',value:16}]};
 await recoverTraining(army,f.realm);assert.equal(army.system.ac.value,17);assert.equal(army.getFlag(MODULE_ID,'pendingTraining'),undefined);
});
