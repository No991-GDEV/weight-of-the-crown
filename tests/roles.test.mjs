// Fixtures fictícias criadas para estes ensaios; a especificação não forneceu payloads JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';
import { createTestState, assertRealm, checkModifier, SKILLS } from '../scripts/core.js';
import { STANDARD_ROLES, kingdomRoles, normalizeRole, roleModifiers } from '../scripts/roles.js';
import { saveRole, deleteRole, saveRoleBinding, getState } from '../scripts/adapter.js';
import { realmView } from '../scripts/view.js';
const gm = {id:'gm',isGM:true}, owner={id:'owner',isGM:false}, observer={id:'observer',isGM:false};
const makeRole=(extra={})=>({id:'custom_harbor',name:'Mestre do porto',description:'Organiza os cais',standard:false,vacancy:{value:-1,target:{kind:'skill',id:'skill_boating'}},effects:[],...extra});
const makeEffect=(extra={})=>({id:'supplies',name:'Suprimentos',description:'',type:'role',value:2,target:{kind:'ability',id:'ability_economy'},condition:'occupied',...extra});
function fixture(){
 const store={state:createTestState('role-fixture')},calls=[];
 store.state.activityDefinitions.fishing={id:'fishing',name:'Pescar',description:'',skillId:'skill_boating',dc:15,suitability:1,stages:'',benefit:''};
 const doc={id:'realm',name:'Reino',type:'party',calls,getFlag:()=>store.state,testUserPermission:u=>u.isGM||u.id===owner.id,
 async update(patch){calls.push(structuredClone(patch));for(const [path,value]of Object.entries(patch)){const parts=path.replace('flags.weight-of-the-crown.state.','').split('.');let target=store.state;for(const key of parts.slice(0,-1))target=target[key]??={};target[parts.at(-1)]=structuredClone(value);}return this;}};
 return{store,doc};
}
const resolve=async uuid=>({uuid,documentName:'Actor',type:'npc',testUserPermission:()=>true});
const total=(s,a={},skillId='skill_boating',extra={})=>roleModifiers(s,a,{skillId,...extra}).reduce((n,m)=>n+m.value,0);

test('estado antigo ganha oito cargos em leitura, sem migração nem alteração do documento',()=>{
 const{store}=fixture();store.state.rulesVersion='0.35.0';const before=JSON.stringify(store.state);assertRealm(store.state);
 assert.equal(kingdomRoles(store.state).length,8);assert.equal(store.state.roles,undefined);assert.equal(JSON.stringify(store.state),before);
 assert.deepEqual(kingdomRoles(store.state).map(r=>r.id),STANDARD_ROLES.map(r=>r.id));
});
test('matriz completa das vacâncias usa somente a família aprovada e soma origens distintas',()=>{
 const{store}=fixture();
 const expected={ability_government:-2,ability_economy:-3,ability_knowledge:-2,ability_community:-3,ability_defense:-3};
 for(const s of SKILLS)assert.equal(total(store.state,{},s.id),expected[s.abilityId],s.id);
 for(const r of STANDARD_ROLES){
  const occupied=Object.fromEntries(STANDARD_ROLES.map(x=>[x.id,{actorUuid:'Actor.occupied'}]));delete occupied[r.id];store.state.roles=occupied;
  for(const s of SKILLS)assert.equal(total(store.state,{'Actor.occupied':true},s.id),r.vacancy.target.kind==='all'||r.vacancy.target.id===s.abilityId?r.vacancy.value:0,`${r.id}/${s.id}`);
 }
});
test('preencher e remover cargo alterna vacância e efeitos sem alterar bases',async()=>{
 const{store,doc}=fixture();const base=checkModifier(store.state,'skill_boating',1),resources=structuredClone(store.state.resources);
 await saveRole(doc,gm,'custom_harbor',makeRole({effects:[makeEffect()]}),'create');
 assert.equal(total(store.state),-4);
 await saveRoleBinding(doc,owner,'custom_harbor','Actor.captain','bind',resolve);
 assert.equal(total(store.state,{'Actor.captain':true}),-1);
 await saveRoleBinding(doc,owner,'custom_harbor',null,'unbind',resolve);assert.equal(total(store.state),-4);
 assert.deepEqual(checkModifier(store.state,'skill_boating',1),base);assert.deepEqual(store.state.resources,resources);
});
test('referência apagada mantém dados e produz vacância; falta de retrato não determina ocupação',()=>{
 const{store}=fixture();store.state.roles={custom_harbor:makeRole({actorUuid:'Actor.deleted',effects:[makeEffect()]})};
 assert.equal(total(store.state,{'Actor.deleted':false}),-4);
 assert.equal(total(store.state,{'Actor.deleted':true}),-1);
 const v=realmView(store.state,true,false,{availability:{'Actor.deleted':true},actors:{}});
 assert.equal(v.roles.at(-1).occupied,true);assert.equal(store.state.roles.custom_harbor.actorUuid,'Actor.deleted');
});
test('efeitos múltiplos positivos e negativos somam uma vez e recálculos são puros',()=>{
 const{store}=fixture();store.state.roles={custom_harbor:makeRole({actorUuid:'Actor.captain',effects:[makeEffect(),makeEffect({id:'storm',value:-1})]})};
 const before=JSON.stringify(store.state);
 for(let i=0;i<20;i++){const list=roleModifiers(store.state,{'Actor.captain':true},{skillId:'skill_boating'});assert.equal(list.filter(m=>m.roleId==='custom_harbor').length,2);assert.equal(total(store.state,{'Actor.captain':true}),-2);}
 assert.equal(JSON.stringify(store.state),before);
});
test('alvo atividade e condição responsável afetam exclusivamente o contexto escolhido',()=>{
 const{store}=fixture();store.state.roles={custom_harbor:makeRole({actorUuid:'Actor.captain',effects:[makeEffect({target:{kind:'activity',id:'fishing'},condition:'responsible'})]})};
 const a={'Actor.captain':true};assert.equal(total(store.state,a),-3);
 assert.equal(total(store.state,a,'skill_boating',{activityId:'fishing',responsibleActorUuid:'Actor.other'}),-3);
 assert.equal(total(store.state,a,'skill_boating',{activityId:'other',responsibleActorUuid:'Actor.captain'}),-3);
 assert.equal(total(store.state,a,'skill_boating',{activityId:'fishing',responsibleActorUuid:'Actor.captain'}),-1);
});
test('mesmo Actor pode ocupar vários cargos sem duplicar referências nem conceder frentes',async()=>{
 const{store,doc}=fixture(),before=JSON.stringify(store.state.fronts);
 await saveRoleBinding(doc,owner,'role_ruler','Actor.captain','one',resolve);await saveRoleBinding(doc,owner,'role_treasurer','Actor.captain','two',resolve);
 assert.equal(kingdomRoles(store.state).filter(r=>r.actorUuid==='Actor.captain').length,2);assert.equal(total(store.state,{'Actor.captain':true}),-1);assert.equal(JSON.stringify(store.state.fronts),before);
});
test('Mestre cria edita e exclui customizado; padrão não pode ser excluído',async()=>{
 const{store,doc}=fixture();await saveRole(doc,gm,'custom_harbor',makeRole(),'create');
 await saveRole(doc,gm,'custom_harbor',makeRole({name:'Porto',effects:[makeEffect(),makeEffect({id:'second',value:-1})]}),'edit');
 assert.equal(kingdomRoles(getState(doc)).at(-1).effects.length,2);
 await assert.rejects(deleteRole(doc,gm,'role_ruler','deny'),/padrão/);
 await deleteRole(doc,gm,'custom_harbor','remove');assert.ok(!kingdomRoles(store.state).some(r=>r.id==='custom_harbor'));assert.ok(store.state.roles.custom_harbor.deleted);
 await assert.rejects(saveRole(doc,gm,'custom_harbor',makeRole(),'recreate'),/excluído/);
 await assert.rejects(saveRoleBinding(doc,owner,'custom_harbor','Actor.captain','restore',resolve),/não encontrado/);
});
test('OWNER e observador não administram estrutura; observador também não vincula',async()=>{
 const{store,doc}=fixture();for(const user of [owner,observer]){
  await assert.rejects(saveRole(doc,user,'custom_harbor',makeRole(),'invalid'),/Mestre/);
  await assert.rejects(deleteRole(doc,user,'role_ruler','invalid'),/Mestre/);
 }
 await assert.rejects(saveRoleBinding(doc,observer,'role_ruler','Actor.captain','deny',resolve),/permissão/);assert.equal(doc.calls.length,0);assert.equal(store.state.roles,undefined);
});
test('persistência recusa documentos não Actor, Party, referência falsa e Actor sem acesso',async()=>{
 const{store,doc}=fixture(),before=JSON.stringify(store.state);
 for(const resolver of [async()=>null,async uuid=>({...(await resolve(uuid)),documentName:'Item'}),async uuid=>({...(await resolve(uuid)),type:'party'}),async()=>resolve('Actor.other'),async uuid=>({...(await resolve(uuid)),testUserPermission:()=>false})]){
  await assert.rejects(saveRoleBinding(doc,owner,'role_ruler','Actor.captain','invalid',resolver));
 }
 for(const uuid of ['Item.sword','Actor.','Compendium.bad','Actor.a.actorUuid',42])await assert.rejects(saveRoleBinding(doc,gm,'role_ruler',uuid,'bad',resolve));
 assert.equal(doc.calls.length,0);assert.equal(JSON.stringify(store.state),before);
});
test('caminhos injetados e cargos inexistentes são recusados sem nenhuma escrita',async()=>{
 const{doc}=fixture();for(const id of ['__proto__','constructor','role_ruler.actorUuid','../role_ruler'])await assert.rejects(saveRoleBinding(doc,gm,id,'Actor.captain','deny',resolve),/Identificador/);
 await assert.rejects(saveRoleBinding(doc,gm,'missing','Actor.captain','deny',resolve),/não encontrado/);
 await assert.rejects(saveRoleBinding(doc,gm,'role_ruler','Actor.captain','operations.inject',resolve),/Identificador/);assert.equal(doc.calls.length,0);
});
test('valores, alvos, tipos, condições e origens duplicadas inválidos não persistem',async()=>{
 const{store,doc}=fixture(),before=JSON.stringify(store.state);
 const invalid=[makeRole({vacancy:{value:101,target:{kind:'all'}}}),makeRole({vacancy:{value:'-1',target:{kind:'all'}}}),makeRole({vacancy:{value:NaN,target:{kind:'all'}}}),makeRole({effects:[makeEffect({value:1.5})]}),makeRole({effects:[makeEffect({value:Infinity})]}),makeRole({effects:[makeEffect({type:'script'})]}),makeRole({effects:[makeEffect({condition:'eval'})]}),makeRole({effects:[makeEffect({target:{kind:'skill',id:'skill_fake'}})]}),makeRole({effects:[makeEffect({target:{kind:'activity',id:'absent'}})]}),makeRole({effects:[makeEffect(),makeEffect()]}),makeRole({name:''}),makeRole({effects:[{...makeEffect(),script:'globalThis.pwned=true'}]})];
 for(const raw of invalid)await assert.rejects(saveRole(doc,gm,'custom_harbor',raw,'invalid'));assert.equal(doc.calls.length,0);assert.equal(JSON.stringify(store.state),before);
});
test('dados desconhecidos nas flags e vínculos persistem após JSON e reabertura',async()=>{
 const{store,doc}=fixture();store.state.unrelated={future:'preservar'};await saveRole(doc,gm,'custom_harbor',makeRole({effects:[makeEffect()]}),'create');await saveRoleBinding(doc,owner,'custom_harbor','Actor.captain','bind',resolve);
 const reopened=JSON.parse(JSON.stringify(store.state));assertRealm(reopened);assert.deepEqual(reopened.unrelated,{future:'preservar'});assert.equal(kingdomRoles(reopened).at(-1).actorUuid,'Actor.captain');assert.equal(total(reopened,{'Actor.captain':true}),-1);
});
test('edição autoral atrasada preserva troca ou remoção simultânea de responsável',async()=>{
 for(const next of ['Actor.new',null]){
  const{store,doc}=fixture();await saveRole(doc,gm,'custom_harbor',makeRole(),'create');await saveRoleBinding(doc,gm,'custom_harbor','Actor.old','initial',resolve);
  let release;const gate=new Promise(r=>release=r),originalUpdate=doc.update.bind(doc);
  const slow={...doc,update:async patch=>{await gate;return originalUpdate(patch);}};
  const save=saveRole(slow,gm,'custom_harbor',makeRole({name:'Novo nome',actorUuid:'Actor.old'}),'slow');
  await saveRoleBinding(doc,owner,'custom_harbor',next,'fast',resolve);release();await save;
  assert.equal(kingdomRoles(store.state).at(-1).actorUuid,next);assert.equal(kingdomRoles(store.state).at(-1).name,'Novo nome');
 }
});
test('exclusão durante resolução assíncrona não é desfeita pelo vínculo',async()=>{
 const{store,doc}=fixture();await saveRole(doc,gm,'custom_harbor',makeRole(),'create');let release;const gate=new Promise(r=>release=r);
 const pending=saveRoleBinding(doc,owner,'custom_harbor','Actor.captain','late',async uuid=>{await gate;return resolve(uuid);});await deleteRole(doc,gm,'custom_harbor','delete');release();await assert.rejects(pending,/excluído/);assert.equal(store.state.roles.custom_harbor.actorUuid,undefined);
});
test('mesmo vínculo é idempotente e não duplica histórico',async()=>{
 const{doc}=fixture();await saveRoleBinding(doc,owner,'role_ruler','Actor.captain','first',resolve);const n=doc.calls.length;await saveRoleBinding(doc,owner,'role_ruler','Actor.captain','repeat',resolve);assert.equal(doc.calls.length,n);
});
test('importação com cargo ou efeitos malformados bloqueia edição e preserva dados',()=>{
 const{store}=fixture();store.state.roles={custom_harbor:makeRole({effects:[makeEffect({value:'bad'})]})};const before=JSON.stringify(store.state);assert.throws(()=>assertRealm(store.state));assert.equal(JSON.stringify(store.state),before);
});
test('template Cargos escapa textos e limita controles por permissão',async()=>{
 const{store}=fixture();store.state.roles={custom_harbor:makeRole({name:'<script>pwn()</script>',effects:[makeEffect({name:'<img src=x onerror=pwn()>'})]})};
 const template=Handlebars.compile(await fs.readFile(new URL('../templates/realm.hbs',import.meta.url),'utf8'));
 const html=template({...realmView(store.state,true,false),sectionRoles:true});assert.match(html,/data-drop-kind="role"/);assert.doesNotMatch(html,/data-action="(?:createRole|editRole|deleteRole|addRoleEffect|editRoleEffect)"/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 const gmHtml=template({...realmView(store.state,true,true),sectionRoles:true});assert.match(gmHtml,/data-action="createRole"/);assert.match(gmHtml,/data-action="editRoleEffect"/);
 const readOnly=template({...realmView(store.state,false,false),sectionRoles:true});assert.doesNotMatch(readOnly,/data-action="(?:chooseActor|removeActor)"/);
});

test('vacância positiva beneficia apenas o cargo vazio e não muda os padrões',async()=>{const {store,doc}=fixture();await saveRole(doc,gm,'custom_harbor',makeRole({vacancy:{value:2,target:{kind:'all'}}}),'positive');assert.ok(roleModifiers(store.state,{},{skillId:"skill_boating"}).some(m=>m.roleId==='custom_harbor'&&m.value===2));await saveRoleBinding(doc,owner,'custom_harbor','Actor.captain','assign',resolve);assert.ok(!roleModifiers(store.state,{'Actor.captain':true},{skillId:'skill_boating'}).some(m=>m.roleId==='custom_harbor'&&m.source==='vacancy'));assert.equal(STANDARD_ROLES.find(r=>r.id==='role_general').vacancy.value,-2);});
