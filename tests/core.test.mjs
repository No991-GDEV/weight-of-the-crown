import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState as blankState, assertRealm, checkModifier, proficiency, degree, abilityTotal, normalizeField, normalizeDefinition, escapeHTML, MODULE_ID } from '../scripts/core.js';
import { saveField, saveDefinition, getState } from '../scripts/adapter.js';
import { realmView } from '../scripts/view.js';
import fs from 'node:fs';
import Handlebars from 'handlebars';

const gm = { id: 'gm', isGM: true }, player = { id: 'player', isGM: false }, observer = { id: 'observer', isGM: false };
function createTestState(id) {
  const state = blankState(id);
  state.activityDefinitions.example_activity = { id:'example_activity', name:'Inspecionar a oficina', description:'', skillId:'skill_industry', dc:15, suitability:1, stages:'', benefit:'' };
  state.projects.example_project = { id:'example_project', name:'Depósito de demonstração', description:'', skillId:'skill_engineering', dc:15, suitability:0, stages:'Preparar\nMontar', benefit:'' };
  return state;
}
function documentMock(shared = { state: createTestState('test') }) {
  const calls = [];
  return { id: 'actor-test', type: 'party', name: 'Teste', calls,
    getFlag(scope, key) { assert.equal(scope, MODULE_ID); assert.equal(key, 'state'); return shared.state; },
    testUserPermission(user, permission) { return user.id === 'gm' || user.id === 'player' && permission <= 3 || user.id === 'observer' && permission <= 2; },
    async update(patch) { calls.push(patch); for (const [path, value] of Object.entries(patch)) {
      const parts = path.split('.').slice(3); let object = shared.state;
      for (const part of parts.slice(0, -1)) object = object[part] ??= {};
      object[parts.at(-1)] = structuredClone(value);
    } return this; }
  };
}
test('estado fictício tem formato válido e mantém dados desconhecidos', () => {
  const state = createTestState('example'); assertRealm(state);
  const copy = JSON.parse(JSON.stringify(state)); assert.deepEqual(copy, state);
  assert.equal(copy.resources.res_stone, null); assert.equal(copy.progression.partyLevel, null);
  assert.equal(Object.values(copy.creation.attributeAllocations).reduce((a,b)=>a+b,0),4);
  assert.equal(Object.values(copy.skills).filter(s=>s.rank===1).length,6);
});
test('teste usa atributo do reino, proficiência e adequação sem somar filiação duas vezes', () => {
  const state = createTestState('test'); assert.equal(abilityTotal(state, 'ability_economy'), 2);
  assert.deepEqual(checkModifier(state, 'skill_industry', 1), { total: 7, ability: 2, proficiency: 4, suitability: 1 });
});
test('destreinado não recebe nível e graus avançados seguem fórmula', () => {
  assert.equal(proficiency(9, 0),0); assert.equal(proficiency(9, 1),11);
  assert.equal(proficiency(9, 2),13); assert.equal(proficiency(9, 3),15); assert.equal(proficiency(15, 4),23);
});
test('vazio não vira zero em atributo ou proficiência do teste', () => {
  const state=createTestState('test'); state.creation.attributeAllocations.ability_economy=null;
  assert.throws(()=>checkModifier(state,'skill_industry',1),/Campo vazio/);
  state.creation.attributeAllocations.ability_economy=0;state.skills.skill_industry.rank=null;
  assert.throws(()=>checkModifier(state,'skill_industry',1),/Campo vazio/);
});
test('limites de CD, adequação e dado são validados', () => {
  assert.throws(()=>checkModifier(createTestState('x'),'skill_industry',3));
  assert.throws(()=>degree(20,0,10)); assert.throws(()=>degree(20,15,0));
});
test('quatro graus usam CD e diferença de dez', () => {
  assert.equal(degree(25,15,18),'criticalSuccess');assert.equal(degree(15,15,8),'success');
  assert.equal(degree(14,15,7),'failure');assert.equal(degree(5,15,2),'criticalFailure');
});
test('naturais deslocam um grau sem sucesso ou falha automática', () => {
  assert.equal(degree(20,40,20),'failure');assert.equal(degree(31,15,1),'success');
  assert.equal(degree(14,15,20),'success');assert.equal(degree(15,15,1),'failure');
});
test('reserva vazia preserva null e zero continua zero', () => {
  const state=createTestState('x'); assert.equal(normalizeField('resources.res_wood','',false,state),null);
  assert.equal(normalizeField('resources.res_wood','0',false,state),0);
  assert.throws(()=>normalizeField('resources.res_wood','-1',false,state));
  assert.throws(()=>normalizeField('resources.res_wood','1.5',false,state));
});
test('formulário de jogador não aceita campos de definição, nível ou segredo', () => {
  const state=createTestState('x');
  for(const path of ['activityDefinitions.foo.dc','projects.foo.name','gmNotes','progression.level','__proto__.x'])
    assert.throws(()=>normalizeField(path,'1',false,state));
});
test('graus de proficiência respeitam os níveis aprovados', () => {
  const state=createTestState('x');assert.throws(()=>normalizeField('skills.skill_industry.rank','2',false,state));
  state.progression.level=7;assert.equal(normalizeField('skills.skill_industry.rank','3',false,state),3);
  assert.throws(()=>normalizeField('skills.skill_industry.rank','4',false,state));
});
test('versão desconhecida e atributo de perícia trocado não são reinterpretados', () => {
  const state=createTestState('x');state.schemaVersion='99.0.0';assert.throws(()=>assertRealm(state),/versão/);
  const other=createTestState('x');other.skills.skill_industry.abilityId='ability_defense';assert.throws(()=>assertRealm(other),/Perícia inválida/);
});
test('salvamento escreve somente caminho alterado e seu registro de histórico', async () => {
  const shared={state:createTestState('test')};shared.state.resources.res_stone=0;shared.state.resources.res_metal=0;
  const actor=documentMock(shared);await saveField(actor,player,'resources.res_wood','7','operation1');
  assert.deepEqual(Object.keys(actor.calls[0]).sort(),[`flags.${MODULE_ID}.state.operations.operation1`,`flags.${MODULE_ID}.state.resources.res_wood`]);
  assert.equal(getState(actor).resources.res_wood,7);
  assert.equal(actor.calls[0][`flags.${MODULE_ID}.state.operations.operation1`].before,0);
});
test('dois campos em documentos compartilhados se preservam; mesmo campo usa última gravação', async () => {
  const shared={state:createTestState('x')}, a=documentMock(shared), b=documentMock(shared);
  shared.state.progression.level=4;shared.state.resources.res_stone=0;shared.state.resources.res_metal=0;
  await Promise.all([saveField(a,player,'resources.res_wood','5','op1'),saveField(b,gm,'resources.res_treasury','8','op2')]);
  assert.equal(shared.state.resources.res_wood,5);assert.equal(shared.state.resources.res_treasury,8);
  await saveField(a,player,'resources.res_wood','9','op3');await saveField(b,gm,'resources.res_wood','2','op4');
  assert.equal(shared.state.resources.res_wood,2);
});
test('usuário sem edição não grava e valor sem mudança não cria evento', async () => {
  const actor=documentMock();await assert.rejects(saveField(actor,observer,'resources.res_wood','2','op'),/permissão/);
  assert.equal(await saveField(actor,player,'resources.res_wood','0','unchanged'),false);assert.equal(actor.calls.length,0);
});
test('só Mestre pode criar definições, inclusive em chamadas diretas do adaptador', async () => {
  const raw={name:'Ação',description:'Texto',skillId:'skill_industry',dc:'15',suitability:'1',benefit:'Resultado'};
  const actor=documentMock();await assert.rejects(saveDefinition(actor,player,'activity','new_action',raw,'op'),/Somente o Mestre/);
  await saveDefinition(actor,gm,'activity','new_action',raw,'op2');assert.equal(getState(actor).activityDefinitions.new_action.dc,15);
  await assert.rejects(saveDefinition(actor,gm,'activity','__proto__',raw,'op3'),/Identificador/);
});
test('texto e parâmetros de definição não executam código', () => {
  const raw={name:'<script>alert(1)</script>',skillId:'skill_magic',dc:'15',suitability:'0'};
  assert.equal(normalizeDefinition(raw,'x','project').name,raw.name);
  assert.equal(escapeHTML(raw.name),'&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.throws(()=>normalizeDefinition({...raw,dc:'abc'},'x','activity'));
});
const template=Handlebars.compile(fs.readFileSync(new URL('../templates/realm.hbs',import.meta.url),'utf8'));
test('template de jogador omite controles autorais e notas privadas', () => {
  const context={...realmView(createTestState('x'),true,false),sectionDefinitions:true,sectionRealm:false};
  const html=template(context);
  assert.doesNotMatch(html,/data-action="createActivity"|data-action="createProject"|data-action="editDefinition"|data-section="private"/);
  assert.match(html,/Inspecionar a oficina/);assert.match(html,/Depósito de demonstração/);
});
test('template do Mestre oferece autoria e HTML de dados permanece escapado', () => {
  const state=createTestState('x');state.activityDefinitions.example_activity.name='<script>bad()</script>';
  const html=template({...realmView(state,true,true),sectionDefinitions:true});
  assert.match(html,/data-action="createActivity"/);assert.match(html,/data-action="createProject"/);
  assert.doesNotMatch(html,/<script>bad/);assert.match(html,/&lt;script&gt;bad/);
});

test('ficha nova não preenche escolhas nem cria ações de exemplo', async () => {
 const {createRealmState}=await import('../scripts/core.js');const s=createRealmState('new');assertRealm(s);
 assert.ok(Object.values(s.creation.attributeAllocations).every(v=>v===null));assert.ok(Object.values(s.skills).every(v=>v.rank===null));
 assert.deepEqual(s.activityDefinitions,{});assert.deepEqual(s.projects,{});assert.equal(s.exampleOnly,false);
});
