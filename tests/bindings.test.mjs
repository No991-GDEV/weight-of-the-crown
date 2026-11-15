import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_ID, createTestState } from '../scripts/core.js';
import { getState, saveActorBinding, saveDefinition } from '../scripts/adapter.js';

const gm = { id: 'gm', isGM: true };
const editor = { id: 'editor', isGM: false };
const observer = { id: 'observer', isGM: false };
const definition = (id, extra = {}) => ({
  id, name: 'Pescar', description: 'Pesca no rio', skillId: 'skill_boating',
  dc: 17, suitability: 1, stages: '', benefit: 'Provisões', ...extra
});

function fixture() {
  const state = createTestState('binding-fixture');
  state.activityDefinitions.fishing = definition('fishing');
  state.activityDefinitions.lumber = definition('lumber', { name: 'Cortar madeira', skillId: 'skill_industry' });
  state.projects.storehouse = definition('storehouse', { name: 'Depósito', stages: 'Fundação\nEstrutura' });
  return { state };
}

function documentMock(store = fixture()) {
  const calls = [];
  return {
    id: 'realm-actor', name: 'Reino', type: 'party', calls,
    getFlag(scope, key) {
      assert.equal(scope, MODULE_ID); assert.equal(key, 'state');
      return store.state;
    },
    testUserPermission(user, permission) {
      return user.isGM || user.id === editor.id && permission <= 3 || user.id === observer.id && permission <= 2;
    },
    async update(patch) {
      calls.push(structuredClone(patch));
      const prefix = `flags.${MODULE_ID}.state.`;
      for (const [key, value] of Object.entries(patch)) {
        assert.ok(key.startsWith(prefix), 'a gravação deve permanecer no namespace do reino');
        const parts = key.slice(prefix.length).split('.');
        let target = store.state;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts.at(-1)] = structuredClone(value);
      }
      return this;
    }
  };
}

test('OWNER vincula responsável sem modificar CD, perícia, adequação ou recursos', async () => {
  const store = fixture(), actor = documentMock(store);
  const original = structuredClone(store.state.activityDefinitions.fishing);
  const resources = structuredClone(store.state.resources);
  await saveActorBinding(actor, editor, 'activity', 'fishing', 'Actor.fisher', 'bind1');
  assert.deepEqual(getState(actor).activityDefinitions.fishing, { ...original, actorUuid: 'Actor.fisher' });
  assert.deepEqual(store.state.resources, resources);
  assert.deepEqual(store.state.activityDefinitions.lumber, definition('lumber', { name: 'Cortar madeira', skillId: 'skill_industry' }));
});

test('vínculo continua disponível após serializar e reabrir o documento', async () => {
  const store = fixture();
  await saveActorBinding(documentMock(store), editor, 'activity', 'fishing', 'Actor.fisher', 'bind1');
  const reopenedStore = { state: JSON.parse(JSON.stringify(store.state)) };
  const reopened = getState(documentMock(reopenedStore));
  assert.equal(reopened.activityDefinitions.fishing.actorUuid, 'Actor.fisher');
  assert.equal(reopened.activityDefinitions.fishing.dc, 17);
  assert.equal(reopened.activityDefinitions.fishing.suitability, 1);
});

test('OBSERVADOR não pode vincular ou remover responsável', async () => {
  const store = fixture(), actor = documentMock(store);
  store.state.activityDefinitions.fishing.actorUuid = 'Actor.fisher';
  for (const uuid of ['Actor.other', null]) {
    await assert.rejects(saveActorBinding(actor, observer, 'activity', 'fishing', uuid, 'blocked'), /permissão/);
  }
  assert.equal(actor.calls.length, 0);
  assert.equal(store.state.activityDefinitions.fishing.actorUuid, 'Actor.fisher');
});

test('identificador com caminho injetado não consegue alterar outro registro', async () => {
  const store = fixture(), actor = documentMock(store);
  const before = JSON.stringify(store.state);
  for (const invalid of ['fishing.dc', '../projects/storehouse', '__proto__', 'constructor', 'prototype', 'fishing.actorUuid']) {
    await assert.rejects(saveActorBinding(actor, editor, 'activity', invalid, 'Actor.fisher', `reject-${invalid}`), /Identificador/);
  }
  assert.equal(actor.calls.length, 0);
  assert.equal(JSON.stringify(store.state), before);
});

test('tipo de alvo inválido e definição inexistente não geram gravação', async () => {
  const actor = documentMock();
  for (const kind of ['people', 'operations', '', null]) {
    await assert.rejects(saveActorBinding(actor, editor, kind, 'fishing', 'Actor.fisher', 'wrong-kind'), /Tipo de atividade/);
  }
  await assert.rejects(saveActorBinding(actor, editor, 'activity', 'missing', 'Actor.fisher', 'missing'), /não encontrada/);
  assert.equal(actor.calls.length, 0);
});

test('referência que não representa Actor não é gravada', async () => {
  const actor = documentMock();
  for (const invalid of ['JournalEntry.secret', 'Item.weapon', '', 42, 'Actor.' + 'a'.repeat(513)]) {
    await assert.rejects(saveActorBinding(actor, editor, 'activity', 'fishing', invalid, 'bad-reference'), /Vínculo/);
  }
  assert.equal(actor.calls.length, 0);
});

test('remover vínculo com null preserva a definição e continua removido após recarga', async () => {
  const store = fixture();
  store.state.activityDefinitions.fishing.actorUuid = 'Actor.fisher';
  const before = structuredClone(store.state.activityDefinitions.fishing);
  await saveActorBinding(documentMock(store), editor, 'activity', 'fishing', null, 'remove');
  const reopened = getState(documentMock({ state: JSON.parse(JSON.stringify(store.state)) }));
  assert.deepEqual(reopened.activityDefinitions.fishing, { ...before, actorUuid: null });
  assert.equal(reopened.operations.remove.before, 'Actor.fisher');
  assert.equal(reopened.operations.remove.after, null);
});

test('editar ação como Mestre preserva responsável previamente escolhido pelo jogador', async () => {
  const store = fixture(), actor = documentMock(store);
  await saveActorBinding(actor, editor, 'activity', 'fishing', 'Actor.fisher', 'bind');
  await saveDefinition(actor, gm, 'activity', 'fishing', {
    name: 'Pesca organizada', description: 'Equipe nas margens', skillId: 'skill_boating',
    dc: '19', suitability: '2', benefit: 'Provisões conservadas', actorUuid: 'Actor.forged'
  }, 'edit');
  const reopened = getState(documentMock({ state: JSON.parse(JSON.stringify(store.state)) }));
  assert.equal(reopened.activityDefinitions.fishing.actorUuid, 'Actor.fisher');
  assert.equal(reopened.activityDefinitions.fishing.name, 'Pesca organizada');
  assert.equal(reopened.activityDefinitions.fishing.dc, 19);
  assert.equal(reopened.activityDefinitions.fishing.suitability, 2);
});

test('gravação autoral atrasada não restaura vínculo antigo trocado ou removido por outro cliente', async () => {
  for (const newBinding of ['Actor.new_fisher', null]) {
    const store = fixture();
    store.state.activityDefinitions.fishing.actorUuid = 'Actor.old_fisher';
    const masterDocument = documentMock(store), playerDocument = documentMock(store);
    const commit = masterDocument.update.bind(masterDocument);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let pendingPatch;
    masterDocument.update = async patch => {
      pendingPatch = structuredClone(patch);
      await gate;
      return commit(patch);
    };
    const authoringSave = saveDefinition(masterDocument, gm, 'activity', 'fishing', {
      name: 'Pesca revisada', description: 'Novo planejamento', skillId: 'skill_boating',
      dc: '20', suitability: '1', benefit: 'Provisões'
    }, 'slow-gm-save');
    assert.ok(pendingPatch, 'o Mestre já preparou uma gravação com o estado anterior');
    await saveActorBinding(playerDocument, editor, 'activity', 'fishing', newBinding, 'player-binding');
    release();
    await authoringSave;
    const state = getState(documentMock({ state: JSON.parse(JSON.stringify(store.state)) }));
    assert.equal(state.activityDefinitions.fishing.actorUuid, newBinding);
    assert.equal(state.activityDefinitions.fishing.name, 'Pesca revisada');
    assert.equal(state.activityDefinitions.fishing.dc, 20);
  }
});

test('edições em ações diferentes não apagam os vínculos de outro cliente', async () => {
  const store = fixture(), first = documentMock(store), second = documentMock(store);
  await Promise.all([
    saveActorBinding(first, editor, 'activity', 'fishing', 'Actor.fisher', 'first'),
    saveActorBinding(second, gm, 'activity', 'lumber', 'Actor.woodcutter', 'second')
  ]);
  const state = getState(documentMock({ state: JSON.parse(JSON.stringify(store.state)) }));
  assert.equal(state.activityDefinitions.fishing.actorUuid, 'Actor.fisher');
  assert.equal(state.activityDefinitions.lumber.actorUuid, 'Actor.woodcutter');
});

test('construção admite responsável e mantém etapas após editar ou remover o vínculo', async () => {
  const store = fixture(), actor = documentMock(store);
  await saveActorBinding(actor, editor, 'project', 'storehouse', 'Actor.builder', 'bind-project');
  await saveDefinition(actor, gm, 'project', 'storehouse', {
    name: 'Depósito ampliado', description: 'Projeto', skillId: 'skill_engineering',
    dc: '18', suitability: '1', stages: 'Fundação\nEstrutura\nCobertura', benefit: 'Armazenamento'
  }, 'edit-project');
  assert.equal(getState(actor).projects.storehouse.actorUuid, 'Actor.builder');
  await saveActorBinding(actor, editor, 'project', 'storehouse', null, 'remove-project');
  const state = getState(documentMock({ state: JSON.parse(JSON.stringify(store.state)) }));
  assert.equal(state.projects.storehouse.actorUuid, null);
  assert.equal(state.projects.storehouse.stages, 'Fundação\nEstrutura\nCobertura');
});
