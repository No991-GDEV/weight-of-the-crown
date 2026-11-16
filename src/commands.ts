import {QUEST_RESULT_FIELDS,resultNarrative,assertQuestCapacity,completedQuestRun} from "./quests.js";
import type { PendingTask } from "./pending.js";
import type {ArmyGateway,ArmyMutation} from "./army.js";
import { applyFeatCommand, applyQuestFeatRewards, settleFeatIncome, normalizeFeatTags, type FeatDependencies, type FeatPublication } from "./feat-engine.js";
import { MODULE_ID, RULES_VERSION, ABILITIES, SKILLS, RESOURCES, isRecord, normalizeField, normalizeDefinition, readPath, requireInteger, kingdomHeroPoints, assertRealm, type RealmState, type ResourceId, type SkillId } from "./core.js";
import { auditEntry, getState, requireCommandAccess, requireEditor, requireGM, type PublicDocument, type UserContext } from "./adapter.js";
import { kingdomRoles, normalizeRole, safeId, validateActorUuid } from "./roles.js";
import { boundedText, currentWeek, makeFeatureChoice, normalizeCheckEffect, normalizeFeat, questProgress, SEASONS, validateClearFeatureChoice, validateImagePath, validateResourceChange, resourceSummary } from "./management.js";
import { ARMY_LEVEL_TABLE, defaultArmyStats, GOVERNMENTS, normalizeOrigin, initialGovernmentFeat, normalizeOutcome, definitionOutcome, normalizeMilitaryUnit, type MilitaryUnit } from "./realm-admin.js";
import type { ActorResolver } from "./adapter.js";

export interface RealmCommand { action: string; [key: string]: unknown; }
const queues = new Map<string, Promise<unknown>>();
let externalRegistryQueue:Promise<unknown>=Promise.resolve();
/** Apenas comandos que precisam validar o estado conjunto. Edições ordinárias mantêm última gravação por campo. */
export async function executeRealmCommand(actor: PublicDocument, user: UserContext, raw: unknown, operationId: string, dependencies: { resolveActor?: ActorResolver; armies?:ArmyGateway } & FeatDependencies = {}): Promise<void> {
  requireCommandAccess(actor, user, raw); safeId(operationId);
  const queueKey=actor.id;
  const previous = queues.get(queueKey) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(() => {
    if(isRecord(raw)&&raw.action==="military.attach"){const t=externalRegistryQueue.catch(()=>{}).then(()=>apply(actor,user,raw,operationId,dependencies));externalRegistryQueue=t;return t;}
    return apply(actor,user,raw,operationId,dependencies);
  });
  queues.set(queueKey, task);
  let tasks: PendingTask[];
  try { tasks = await task; } finally { if (queues.get(queueKey) === task) queues.delete(queueKey); }
  for (const pending of tasks) await deliverTask(actor, user, pending, dependencies);
}
async function apply(actor: PublicDocument, user: UserContext, raw: unknown, operationId: string, dependencies: { resolveActor?: ActorResolver; armies?:ArmyGateway } & FeatDependencies): Promise<PendingTask[]> {
  requireCommandAccess(actor, user, raw);
  if (!isRecord(raw) || typeof raw.action !== "string") throw new Error("Operação de reino inválida.");
  const c = raw as RealmCommand;
  const state = getState(actor);
  const unfinished=Object.values(state.pendingTasks ?? {}).filter(t => t.operationId === operationId);
  if(unfinished.length)return unfinished;
  if (state.operations[operationId]) return []; // Reentrega do mesmo comando não repete seus efeitos.
  let publications: FeatPublication[] = [];
  const mutations:ArmyMutation[]=[],stages:(()=>Promise<void>)[]=[];
  const tasks:PendingTask[]=[];
  const gateway=()=>{if(!dependencies.armies)throw new Error("Adaptador militar indisponível.");return dependencies.armies;};
  const trial = structuredClone(state), changes: Record<string, unknown> = {};
  let detail = "Reino atualizado", path = "", before: unknown, after: unknown, category: string | undefined, kind: "field" | "definition" | "roll" = "definition";
  const keys = (allowed: string[]) => { if (Object.keys(c).some(k => !["action", ...allowed].includes(k))) throw new Error("Campos de operação inválidos."); };
  const gm = () => requireGM(actor, user);
  const set = (p: string, value: unknown) => {
    const parts = p.split("."); let cursor: any = trial;
    for (const key of parts.slice(0, -1)) cursor = cursor[key] ??= {};
    if (parts.at(-1)!.startsWith("-=")) delete cursor[parts.at(-1)!.slice(2)];
    else cursor[parts.at(-1)!] = value;
    changes[`flags.${MODULE_ID}.state.${p}`] = value;
  };
  switch (c.action) {
    case "heroPoints.adjust": {
      gm(); keys(["delta", "expectedValue"]);
      if (c.delta !== 1 && c.delta !== -1) throw new Error("Adicione ou gaste um Hero Point por vez.");
      const current = kingdomHeroPoints(state);
      if (requireInteger(c.expectedValue, "Quantidade anterior", 0) !== current) throw new Error("A reserva de Hero Points mudou. Confira a quantidade atual antes de tentar novamente.");
      if (c.delta < 0 && current === 0) throw new Error("O reino não possui Hero Points para gastar.");
      const next = requireInteger(current + c.delta, "Hero Points do reino", 0);
      set("heroPoints", next); kind = "field"; path = "heroPoints"; before = current; after = next;
      detail = c.delta > 0 ? "Hero Point adicionado ao reino" : "Hero Point gasto pelo reino"; category = "Hero Points"; break;
    }
    case "operation.retry": {
      keys(["taskId"]); safeId(c.taskId);
      const task=state.pendingTasks?.[c.taskId]; if (!task) return [];
      if (!user.isGM && task.userId !== user.id) throw new Error("Somente o responsável ou Mestre pode retomar esta operação.");
      return [task];
    }
    case "creation.claim": {
      gm(); keys(["claimId"]); safeId(c.claimId); if (state.creation.wizardSeenAt) return [];
      set("creation.wizardSeenAt", new Date().toISOString()); set("creation.wizardClaim", c.claimId); detail = "Assistente de criação apresentado"; category = "Criação"; break;
    }
    case "creation.configure": {
      gm(); keys(["origin", "allocations", "skills", "name", "population"]);
      const origin = normalizeOrigin(c.origin), gov = GOVERNMENTS.find(g => g.id === origin.governmentId)!;
      if (!isRecord(c.allocations) || Object.keys(c.allocations).length !== ABILITIES.length || Object.keys(c.allocations).some(id => !ABILITIES.some(a => a.id === id))) throw new Error("Distribua os quatro pontos nos cinco atributos.");
      let points = 0; for (const a of ABILITIES) { const value = requireInteger(c.allocations[a.id], "Aumento inicial", 0, 4); points += value; set(`creation.attributeAllocations.${a.id}`, value); }
      if (points !== 4) throw new Error("Distribua exatamente quatro pontos livres.");
      if (!Array.isArray(c.skills) || c.skills.length !== 6 || new Set(c.skills).size !== 6 || !c.skills.every(id => SKILLS.some(s => s.id === id)) || !gov.skills.every(id => (c.skills as unknown[]).includes(id))) throw new Error("Escolha seis perícias treinadas, incluindo as duas do Governo.");
      for (const s of SKILLS) {
        if (state.skills[s.id].rank !== null && state.skills[s.id].rank! > 1 && !c.skills.includes(s.id)) throw new Error(`Mantenha ${s.label} entre as escolhas para preservar seu grau avançado.`);
        set(`skills.${s.id}.rank`, c.skills.includes(s.id) ? Math.max(1, state.skills[s.id].rank ?? 0) : 0);
      }
      set("creation.trainedSkillChoices", c.skills as SkillId[]); set("creation.origin", origin);
      const feat = initialGovernmentFeat(gov.id);
      const oldGovFeatId = state.creation.governmentFeatId;
      if (oldGovFeatId && oldGovFeatId !== feat.id && state.feats?.[oldGovFeatId]) {
        const usedByAdvancement = Object.values(state.advancement ?? {}).some(ch => ch.featId === oldGovFeatId);
        const usedByPrereq = Object.values(state.feats ?? {}).some(f => f.id !== oldGovFeatId && f.prerequisites.feats.includes(oldGovFeatId));
        if (!state.featCatalogVersion && !usedByAdvancement && !usedByPrereq) set(`feats.-=${oldGovFeatId}`, null);
      }
      if (!state.feats?.[feat.id]) set(`feats.${feat.id}`, feat);
      set("creation.governmentFeatId", feat.id); set("creation.setupCompletedAt", new Date().toISOString());
      if (!state.creation.wizardSeenAt) set("creation.wizardSeenAt", new Date().toISOString());
      if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 120) throw new Error("Informe um nome de até 120 caracteres.");
      set("name", c.name.trim()); changes.name = c.name.trim();
      if (c.population !== undefined) set("demographics.population", c.population === null ? null : requireInteger(c.population, "População", 0, 1000000000));
      detail = "Criação do reino concluída"; category = "Criação"; break;
    }
    case "population": {
      gm(); keys(["value"]); set("demographics.population", c.value === null ? null : requireInteger(c.value, "População", 0, 1000000000)); detail = "População atualizada"; category = "População"; break;
    }
    case "military.save": {
      gm(); keys(["unit","changedFields","expectedActor"]); if (!isRecord(c.unit)) throw new Error("Unidade inválida."); safeId(c.unit.id);
      if (state.deletedMilitaryUnits?.[c.unit.id]) throw new Error("Esta unidade foi excluída. Crie uma nova unidade em vez de restaurar uma edição antiga.");
      const current = state.militaryUnits?.[c.unit.id];
      const editable=["name","headcount","readiness","task","location","condition","notes","consumption"];
      if(c.changedFields!==undefined&&(!current||!Array.isArray(c.changedFields)||!c.changedFields.every(k=>typeof k==="string"&&editable.includes(k))))throw new Error("Campos militares alterados inválidos.");
      const fields=c.changedFields as string[]|undefined;
      if(c.expectedActor!==undefined&&(!isRecord(c.expectedActor)||Object.keys(c.expectedActor).some(k=>!["name","consumption"].includes(k))))throw new Error("Snapshot militar inválido.");
      const input=fields?{...current,...Object.fromEntries(fields.map(k=>[k,(c.unit as Record<string,unknown>)[k]]))}:c.unit;
      const incoming = current ? { ...(c.unit.gear === undefined && current.gear !== undefined ? { gear: current.gear } : {}), ...(c.unit.trainingCount === undefined && current.trainingCount !== undefined ? { trainingCount: current.trainingCount } : {}), ...(c.unit.tactics === undefined && current.tactics !== undefined ? { tactics: current.tactics } : {}), ...input,trainingCount:current.trainingCount??0 } : input;
      if(c.unit.armyActorUuid!==undefined&&c.unit.armyActorUuid!==current?.armyActorUuid)throw new Error("O vínculo militar não pode ser substituído por edição.");
      if(current?.armyActorUuid)for(const k of ["armyType","level","scouting","ac","maneuver","morale","meleeAttack","rangedAttack","hpMax","hpCurrent","routThreshold","tactics","gear"] as const)if(c.unit[k]!==undefined&&JSON.stringify(c.unit[k])!==JSON.stringify(current[k]))throw new Error("Edite os atributos e táticas na ficha militar.");
      const normalized = normalizeMilitaryUnit({...incoming,...(current?.armyActorUuid?{armyActorUuid:current.armyActorUuid}:{})}, c.unit.id);
      stages.push(async()=>{const change=await gateway().save(actor,normalized,current,{fields,expected:c.expectedActor as Record<string,unknown>|undefined});mutations.push(change);await change.apply();if(!change.uuid)throw new Error("A ficha militar não foi vinculada.");set(`militaryUnits.${normalized.id}.armyActorUuid`,change.uuid);});
      for (const [field, value] of Object.entries(normalized)) if ((!fields||fields.includes(field))&&["id","name","headcount","readiness","task","location","notes","condition","armyType","consumption","trainingCount"].includes(field)) set(`militaryUnits.${normalized.id}.${field}`, value);
      if (!current) set(`militaryUnits.${normalized.id}.commanderUuid`, null);
      detail = `Unidade ${current ? "atualizada" : "criada"}: ${normalized.name}`; category = "Exército"; break;
    }
    case "military.attach": {
      gm();keys(["actorUuid","confirmed"]);if(c.confirmed!==true)throw new Error("Confirme o vínculo militar.");validateActorUuid(c.actorUuid);if(typeof c.actorUuid!=="string"||!gateway().attach)throw new Error("Vínculo indisponível.");
      const linked=await gateway().attach!(actor,c.actorUuid,`unit_${operationId}`);const unit="unit" in linked?linked.unit:linked;if("mutation" in linked)stages.push(async()=>{mutations.push(linked.mutation);await linked.mutation.apply();});set(`militaryUnits.${unit.id}`,unit);detail="Ficha militar externa vinculada";category="Exército";break;
    }
    case "military.link": {
      gm();keys(["unitId","repair"]);safeId(c.unitId);const u=state.militaryUnits?.[c.unitId];if(!u)throw new Error("Unidade não encontrada.");
      stages.push(async()=>{const migration=c.repair===true?{...u,armyActorUuid:undefined}:u;const change=await gateway().save(actor,migration,u);mutations.push(change);await change.apply();if(!change.uuid)throw new Error("Vínculo não salvo.");set(`militaryUnits.${u.id}.armyActorUuid`,change.uuid);});detail="Ficha militar vinculada";category="Exército";break;
    }
    case "military.delete": {
      gm(); keys(["unitId", "confirmed", "deleteActor"]); safeId(c.unitId); if (!state.militaryUnits?.[c.unitId]) throw new Error("Unidade não encontrada."); if (c.confirmed !== true) throw new Error("Confirme a exclusão da unidade.");
      if(c.deleteActor===true){const u=state.militaryUnits[c.unitId]!;const check=await gateway().save(actor,u,u);if(check.managed===false)throw new Error("Esta ficha externa será preservada. Desmarque a exclusão da ficha militar.");if(!u.armyActorUuid)throw new Error("A tropa não possui ficha vinculada.");const task:PendingTask={id:`${operationId}_delete`,operationId,userId:user.id,at:Date.now(),kind:"armyDelete",unit:structuredClone(u)};tasks.push(task);set(`pendingTasks.${task.id}`,task);}
      set(`deletedMilitaryUnits.${c.unitId}`, { name: state.militaryUnits[c.unitId]!.name, at: new Date().toISOString() }); set(`militaryUnits.-=${c.unitId}`, null); detail = "Unidade removida do cadastro"; category = "Exército"; break;
    }
    case "military.bind": {
      gm(); keys(["unitId", "actorUuid"]); safeId(c.unitId); if (!state.militaryUnits?.[c.unitId]) throw new Error("Unidade não encontrada."); validateActorUuid(c.actorUuid);
      if (c.actorUuid) { const linked = await dependencies.resolveActor?.(c.actorUuid); if (!linked || linked.documentName !== "Actor" || !["character", "npc"].includes(linked.type) || linked.uuid !== c.actorUuid) throw new Error("Selecione um personagem ou NPC existente."); }
      path = `militaryUnits.${c.unitId}.commanderUuid`; before = state.militaryUnits[c.unitId]!.commanderUuid ?? null; after = c.actorUuid; kind = "field";
      set(path, c.actorUuid); detail = "Capitão da unidade atualizado"; category = "Exército"; break;
    }
    case "military.train": {
      requireEditor(actor,user);keys(["unitId","focus","stat","tactic","advance","confirmed","expectedCost","expectedTrainingCount"]);safeId(c.unitId);
      const unit=state.militaryUnits?.[c.unitId];if(!unit)throw new Error("Unidade não encontrada.");
      if(c.confirmed!==true||typeof c.advance!=="boolean")throw new Error("Confirme o treinamento.");
      if(!["tactic","stat"].includes(String(c.focus)))throw new Error("Foco de treinamento inválido.");
      if(c.expectedTrainingCount!==(unit.trainingCount??0))throw new Error("Este treino já foi resolvido ou a tropa mudou. Abra um novo treino.");
      const prepared=await gateway().train(actor,unit,c,operationId);
      if(prepared.cost!==c.expectedCost)throw new Error("O custo de comida mudou. Confira antes de confirmar.");
      const food=state.resources.res_food;if(food===null)throw new Error("Defina a reserva de Comida.");if(food<prepared.cost)throw new Error("Comida insuficiente para o treinamento.");
      set("resources.res_food",food-prepared.cost);set(`militaryUnits.${c.unitId}.trainingCount`,(unit.trainingCount??0)+1);
      stages.push(async()=>{mutations.push(prepared.mutation);await prepared.mutation.apply();});
      if(c.advance)set("calendar.ordinalWeek",currentWeek(state)+1);
      detail=`Tropa treinada (1 semana): ${unit.name} · ${prepared.cost} Comida`;category="Exército";break;
    }
    case "definition.save": {
      gm(); keys(["kind", "definitionId", "fields", "outcome", "durationWeeks", "featTags", "repeatable"]); safeId(c.definitionId);
      if (c.kind !== "activity" && c.kind !== "project" || !isRecord(c.fields) || Object.entries(c.fields).some(([key, value]) => !["name", "description", "skillId", "dc", "suitability", "stages", "benefit", "requiresCheck",...QUEST_RESULT_FIELDS].includes(key) || typeof value !== "string")) throw new Error("Campos de definição inválidos.");
      const collection = c.kind === "activity" ? "activityDefinitions" : "projects";
      const previousDefinition=state[collection][c.definitionId];
      const previousProgress=previousDefinition?questProgress(state,c.definitionId,c.kind):null;
      if(previousProgress?.status==="completed"&&previousProgress.resultText===undefined){previousProgress.resultText=resultNarrative(previousDefinition!,previousProgress.result);set(`${collection}.${c.definitionId}.quest`,previousProgress);}
      const definition = normalizeDefinition(c.fields as Record<string, string>, c.definitionId, c.kind);
      for (const [field, value] of Object.entries(definition)) set(`${collection}.${c.definitionId}.${field}`, value);
      const progress = questProgress(trial, c.definitionId, c.kind); progress.durationWeeks = requireInteger(c.durationWeeks, "Duração", 1, 10000);
      set(`${collection}.${c.definitionId}.quest`, progress);
      set(`${collection}.${c.definitionId}.outcome`, normalizeOutcome(c.outcome, trial));
      if(c.repeatable !== undefined){if(typeof c.repeatable!=="boolean")throw new Error("Repetição inválida.");set(`${collection}.${c.definitionId}.repeatable`,c.repeatable);}
      if (c.featTags !== undefined) set(`${collection}.${c.definitionId}.featTags`, normalizeFeatTags(c.featTags));
      detail = `${c.kind === "activity" ? "Quest" : "Construção"} salva: ${definition.name}`; category = "Quests e obras"; break;
    }
    case "definition.delete": {
      gm(); keys(["kind", "definitionId", "confirmed"]); safeId(c.definitionId);
      if ((c.kind !== "activity" && c.kind !== "project") || c.confirmed !== true) throw new Error("Confirme a exclusão da definição.");
      const collection = c.kind === "activity" ? "activityDefinitions" : "projects";
      const existing = state[collection][c.definitionId];
      if (!existing) throw new Error("Definição não encontrada.");
      set(`${collection}.-=${c.definitionId}`, null);
      detail = `${c.kind === "activity" ? "Quest" : "Construção"} removida: ${existing.name}`; category = "Quests e obras"; break;
    }
    case "binding.save": {
      keys(["kind", "definitionId", "actorUuid", "runId"]); safeId(c.definitionId);
      if (c.kind !== "activity" && c.kind !== "project") throw new Error("Tipo de atividade inválido.");
      if (c.runId !== undefined && (c.kind !== "activity" || typeof c.runId !== "string")) throw new Error("Registro concluído inválido.");
      validateActorUuid(c.actorUuid);
      const collection=c.kind==="activity"?"activityDefinitions":"projects",def=state[collection][c.definitionId],run=typeof c.runId==="string"?completedQuestRun(state,c.definitionId,c.runId):null;
      if(!def&&!run)throw new Error("Atividade não encontrada.");
      const completed=!!run||questProgress(state,c.definitionId,c.kind).status==="completed";
      const currentUuid=run?run.progress.responsibleActorUuid??null:completed?def!.quest?.responsibleActorUuid??def!.actorUuid??null:def!.actorUuid??null;
      const resolve=async(uuid:string)=>{
        const linked=await dependencies.resolveActor?.(uuid);
        if(!linked||linked.documentName!=="Actor"||!["character","npc"].includes(linked.type)||linked.uuid!==uuid)throw new Error("Selecione um personagem ou NPC existente.");return linked;
      };
      if(c.kind==="activity"&&!user.isGM){
        if(currentUuid&&!(await resolve(currentUuid)).testUserPermission(user,3))throw new Error("Este responsável só pode ser trocado pelo Mestre ou por seu controlador.");
        if(c.actorUuid&&!(await resolve(c.actorUuid)).testUserPermission(user,3))throw new Error("Você só pode vincular personagens ou NPCs que controla.");
      }else if(c.actorUuid){const linked=await resolve(c.actorUuid);if(!user.isGM&&!linked.testUserPermission(user,2))throw new Error("Você não tem acesso a esse personagem.");}
      if(currentUuid===c.actorUuid)return [];
      if(c.kind==="activity"&&!completed)assertQuestCapacity(state,c.actorUuid,c.definitionId);
      path=run?`definitionRuns.${c.runId}.progress.responsibleActorUuid`:completed?`${collection}.${c.definitionId}.quest.responsibleActorUuid`:`${collection}.${c.definitionId}.actorUuid`;before=currentUuid;after=c.actorUuid;kind="field";
      if(!run)set(`${collection}.${c.definitionId}.actorUuid`,c.actorUuid);
      set(path,c.actorUuid);detail="Responsável atualizado";category="Responsável";break;
    }
    case "role.save": {
      gm(); keys(["roleId", "role"]); safeId(c.roleId);
      const previous = kingdomRoles(state).find(r => r.id === c.roleId);
      if ((state.roles?.[c.roleId] as { deleted?: boolean } | undefined)?.deleted) throw new Error("Este cargo foi excluído. Crie um novo cargo.");
      const normalized = normalizeRole(c.role, c.roleId, state);
      if (normalized.deleted) throw new Error("Use a opção de excluir cargo.");
      const { actorUuid: _binding, deleted: _deleted, ...authored } = normalized;
      for (const [key, value] of Object.entries(authored)) set(`roles.${c.roleId}.${key}`, value);
      path = `roles.${c.roleId}`; detail = `${previous ? "Cargo atualizado" : "Cargo criado"}: ${authored.name}`; category = "Cargos"; break;
    }
    case "role.delete": {
      gm(); keys(["roleId"]); safeId(c.roleId);
      const role = kingdomRoles(state).find(r => r.id === c.roleId);
      if (!role) throw new Error("Cargo não encontrado.");
      if (role.standard) throw new Error("Cargos padrão não podem ser excluídos.");
      set(`roles.${c.roleId}.deleted`, true);
      path = `roles.${c.roleId}`; detail = `Cargo excluído: ${role.name}`; category = "Cargos"; break;
    }
    case "role.bind": {
      keys(["roleId", "actorUuid"]); safeId(c.roleId); validateActorUuid(c.actorUuid);
      const current = kingdomRoles(state).find(r => r.id === c.roleId);
      if (!current) throw new Error("Cargo não encontrado.");
      if (c.actorUuid && dependencies.resolveActor) {
        const linked = await dependencies.resolveActor(c.actorUuid);
        if (!linked || linked.documentName !== "Actor" || !["character", "npc"].includes(linked.type) || linked.uuid !== c.actorUuid) throw new Error("Selecione um personagem ou NPC existente.");
        if (!user.isGM && !linked.testUserPermission(user, 2)) throw new Error("Você não tem acesso a esse personagem.");
      }
      if ((current.actorUuid ?? null) === c.actorUuid) return [];
      path = `roles.${c.roleId}.actorUuid`; before = current.actorUuid ?? null; after = c.actorUuid; kind = "field";
      set(path, c.actorUuid); detail = "Responsável pelo cargo atualizado"; category = "Cargos"; break;
    }
    case "roll.record": {
      keys(["detail"]);
      if (typeof c.detail !== "string" || !c.detail.trim() || c.detail.length > 500) throw new Error("Registro de rolagem inválido.");
      kind = "roll"; detail = c.detail; category = "Rolagem";
      changes[`flags.${MODULE_ID}.state.rulesVersion`] = RULES_VERSION;
      break;
    }
    case "field": {
      keys(["path", "value"]); if (typeof c.path !== "string" || typeof c.value !== "string") throw new Error("Campo inválido.");
      const value = normalizeField(c.path, c.value, user.isGM, state); before = readPath(state, c.path);
      const foodField=/^militaryUnits\.([a-zA-Z0-9_-]+)\.consumption$/.exec(String(c.path));
      if(foodField){const previous=state.militaryUnits![foodField[1]!]!;stages.push(async()=>{const change=await gateway().save(actor,{...previous,consumption:value!},previous,{fields:["consumption"]});mutations.push(change);await change.apply();});}

      if (before === value && !foodField) return [];
      path = c.path; after = value; kind = "field"; set(path, value); detail = "Ficha atualizada";
      if (path.startsWith("resources.")) { validateResourceChange(state, trial); category = "Reservas"; }
      if (path.startsWith("creation.attributeAllocations.") && Object.values(trial.creation.attributeAllocations).reduce<number>((sum, v) => sum + (v ?? 0), 0) > 4) throw new Error("Os aumentos iniciais têm quatro pontos livres. Reduza outro atributo antes de redistribuir.");
      if (path.startsWith("skills.")) {
        const gov = GOVERNMENTS.find(g => g.id === state.creation.origin?.governmentId);
        const trained = SKILLS.filter(s => (trial.skills[s.id].rank ?? 0) > 0 || gov?.skills.includes(s.id)).length;
        if (trained > 6) throw new Error("O treino inicial tem seis perícias. Use a Progressão para novos aumentos.");
        if (!user.isGM && typeof value === "number" && value > 1) throw new Error("Use a aba Progressão para aumentar o grau da perícia.");
        if (Array.isArray(state.creation.trainedSkillChoices)) set("creation.trainedSkillChoices", SKILLS.filter(s => (trial.skills[s.id].rank ?? 0) > 0).map(s => s.id));
      }
      break;
    }
    case "resources": {
      keys(["values"]); if (!isRecord(c.values) || Object.keys(c.values).some(id => !Object.hasOwn(state.resources, id))) throw new Error("Reservas inválidas.");
      for (const [id, value] of Object.entries(c.values)) set(`resources.${id}`, value === null ? null : requireInteger(value, "Reserva", 0));
      validateResourceChange(state, trial); detail = "Reservas conferidas"; category = "Reservas"; break;
    }
    case "resourceDelta": {
      keys(["resourceId", "delta"]); if (typeof c.resourceId !== "string" || !Object.hasOwn(state.resources, c.resourceId)) throw new Error("Recurso inválido.");
      const current = state.resources[c.resourceId as ResourceId]; if (current === null) throw new Error("Defina a reserva antes de movimentá-la.");
      const value = requireInteger(current + requireInteger(c.delta, "Movimentação"), "Reserva final", 0);
      set(`resources.${c.resourceId}`, value); validateResourceChange(state, trial); detail = "Recursos movimentados"; category = "Reservas"; break;
    }
    case "feat.save": {
      gm(); keys(["feat"]); if (!isRecord(c.feat)) throw new Error("Talento inválido."); safeId(c.feat.id);
      const existing = state.feats?.[c.feat.id];
      const feat = normalizeFeat({ ...c.feat, effects: existing?.effects ?? c.feat.effects, retired: existing?.retired ?? false }, c.feat.id, state);
      for (const [key, value] of Object.entries(feat)) if (key !== "effects" || !existing) set(`feats.${feat.id}.${key}`, value);
      detail = `Talento ${existing ? "atualizado" : "criado"}: ${feat.name}`; category = "Talentos"; break;
    }
    case "feat.delete": {
      gm(); keys(["featId", "confirmed"]); safeId(c.featId); const feat = state.feats?.[c.featId]; if (!feat) throw new Error("Talento não encontrado.");
      if (c.confirmed !== true) throw new Error("Confirme a exclusão do talento. Escolhas anteriores serão preservadas.");
      set(`feats.${feat.id}.retired`, true); detail = `Talento arquivado: ${feat.name}`; category = "Talentos"; break;
    }
    case "feature.choose": {
      keys(["slotId", "choice"]); safeId(c.slotId);
      const choice = makeFeatureChoice(state, c.slotId, c.choice, user.id, new Date().toISOString());
      set(`advancement.${c.slotId}`, choice); detail = `Progressão do nível ${choice.level}: ${choice.featName ?? choice.skillId ?? "atributos"}`; category = "Progressão"; break;
    }
    case "feature.clear": {
      keys(["slotId", "confirmed"]); safeId(c.slotId);
      if (c.confirmed !== true) throw new Error("Confirme para desfazer esta escolha de progressão.");
      validateClearFeatureChoice(state, c.slotId);
      const prev = state.advancement![c.slotId]!;
      set(`advancement.-=${c.slotId}`, null);
      if (prev.featId === "kingdom_civil_service" && state.featRoleOverride !== undefined) set("-=featRoleOverride", null);
      detail = `Progressão do nível ${prev.level} desfeita`; category = "Progressão"; break;
    }
    case "crest": { gm(); keys(["path"]); set("crestImage", validateImagePath(c.path)); detail = "Brasão atualizado"; category = "Brasão"; break; }
    case "week.advance": {
      gm(); keys(["weeks", "confirmed"]); if (c.confirmed !== true) throw new Error("Confirme o avanço do calendário.");
      const count = requireInteger(c.weeks, "Semanas", 1, 10000), next = requireInteger(currentWeek(state) + count, "Semana final", 1);
      set("calendar.ordinalWeek", next); detail = `Calendário: semana ${currentWeek(state)} → ${next}`; category = "Calendário"; break;
    }
    case "season": { gm(); keys(["season"]); if (!SEASONS.some(s => s.id === c.season)) throw new Error("Estação desconhecida."); set("calendar.season", c.season); detail = `Estação: ${SEASONS.find(s => s.id === c.season)!.label}`; category = "Calendário"; break; }
    case "quest.duration": {
      gm(); keys(["questId", "weeks"]); safeId(c.questId); const q = questProgress(state, c.questId);
      q.durationWeeks = requireInteger(c.weeks, "Duração da Quest", 1, 10000); set(`activityDefinitions.${c.questId}.quest`, q); detail = "Duração da Quest atualizada"; category = "Quests e obras"; break;
    }
    case "project.status": {
      gm();keys(["projectId","status"]);safeId(c.projectId);if(!["pending","inProgress","completed"].includes(String(c.status)))throw new Error("Estado inválido.");
      const q=questProgress(state,c.projectId,"project");if(q.status===c.status)return [];
      q.status=c.status as typeof q.status;q.completionWeek=q.status==="completed"?currentWeek(state):null;
      if(q.status!=="pending")q.startWeek??=currentWeek(state);
      if(q.status==="completed"){q.benefitsApplied=true;q.resultText??=resultNarrative(state.projects[c.projectId]!,q.result);if(q.responsibleActorUuid===undefined)q.responsibleActorUuid=state.projects[c.projectId]!.actorUuid??null;}
      set(`projects.${c.projectId}.quest`,q);set(`projects.${c.projectId}.completionEffectsActive`,q.status==="completed");detail="Estado da construção ajustado manualmente";category="Quests e obras";break;
    }
    case "quest.start": case "project.start": {
      const defKind = c.action === "project.start" ? "project" : "activity", collection = defKind === "activity" ? "activityDefinitions" : "projects", targetId = defKind === "activity" ? c.questId : c.projectId;
      gm(); keys([defKind === "activity" ? "questId" : "projectId"]); safeId(targetId); const q = questProgress(state, targetId, defKind);
      if (q.status !== "pending") throw new Error("Esta definição já foi iniciada ou concluída.");
      q.status = "inProgress"; q.startWeek = currentWeek(state); set(`${collection}.${targetId}.quest`, q); detail = `${defKind === "activity" ? "Quest" : "Construção"} iniciada: ${state[collection][targetId]!.name}`; category = "Quests e obras"; break;
    }
    case "quest.complete": case "project.complete": {
      const defKind = c.action === "quest.complete" ? "activity" : "project", collection = defKind === "activity" ? "activityDefinitions" : "projects", targetId = defKind === "activity" ? c.questId : c.projectId;
      gm(); keys([defKind === "activity" ? "questId" : "projectId", "advance", "confirmed", "expectedDuration", "result", "expectedRunId"]); safeId(targetId);
      if (typeof c.advance !== "boolean" || c.confirmed !== true) throw new Error("Confirme a conclusão e a opção de calendário.");
      const q = questProgress(state, targetId, defKind), week = currentWeek(state), first = q.status !== "completed" && !q.benefitsApplied, definition = state[collection][targetId]!;
      if(defKind==="activity"&&definition.repeatable===true&&c.expectedRunId!==(q.runId??null))throw new Error("Esta execução da Quest já foi concluída ou mudou. Confira a nova Quest antes de confirmar novamente.");
      if (q.status === "completed" && (!c.advance || q.timeCounted)) return [];
      if (c.advance && requireInteger(c.expectedDuration, "Duração confirmada", 1, 10000) !== q.durationWeeks) throw new Error("A duração da Quest mudou. Confira a duração antes de confirmar novamente.");
      if (c.result !== undefined && !["criticalFailure","failure","success","criticalSuccess"].includes(String(c.result))) throw new Error("Resultado da conclusão inválido.");
      if (c.result === "criticalSuccess" && definition.requiresCheck === false) throw new Error("Uma Quest sem teste não produz sucesso crítico.");
      if (first && c.result !== undefined) q.result = c.result as import("./core.js").Degree;
      if(q.resultText===undefined){q.resultText=resultNarrative(definition,q.result);q.responsibleActorUuid=definition.actorUuid??null;}
      q.startWeek ??= week;
      if (first) {
        const outcome = definitionOutcome(definition); q.runId ??= operationId; q.benefitsApplied = true; q.grantedResources = {};
        for(const [resourceId,amount] of Object.entries(outcome.costs??{}))if(amount){
          const current=trial.resources[resourceId as ResourceId];if(current===null)throw new Error("Defina a reserva antes de pagar o custo.");
          if(current<amount)throw new Error("Reservas insuficientes para pagar o custo.");set(`resources.${resourceId}`,current-amount);q.grantedResources[resourceId]=-amount;
        }
        for (const [resourceId, amount] of Object.entries(outcome.resources).sort((a,b)=>(a[1]??0)-(b[1]??0))) if (amount) {
          const current = trial.resources[resourceId as ResourceId]; if (current === null) throw new Error("Defina as reservas antes de receber a recompensa.");
          set(`resources.${resourceId}`, requireInteger(current + amount, "Reserva após a recompensa", 0)); q.grantedResources[resourceId] = (q.grantedResources[resourceId]??0)+amount;
        }
        set(`${collection}.${targetId}.completionEffectsActive`, true); validateResourceChange(state, trial);
      }
      if (c.advance && !q.timeCounted) { const next = requireInteger(week + q.durationWeeks, "Semana final", 1); set("calendar.ordinalWeek", next); q.timeCounted = true; q.countedWeeks = q.durationWeeks; }
      set(`${collection}.${targetId}.completionEffectsActive`,true);
      q.status = "completed"; q.completionWeek ??= c.advance ? currentWeek(trial) : week;
      if (first && defKind === "activity") { const extra = applyQuestFeatRewards(trial, definition, q.result??undefined, q.runId!, user.id); if (extra) q.grantedResources!.res_treasury = (q.grantedResources!.res_treasury ?? 0) + extra; }
      if(first&&defKind==="activity"&&definition.repeatable===true){
        set(`definitionRuns.${q.runId!}`,{definitionId:targetId,name:definition.name,description:definition.description,skillId:definition.skillId,dc:definition.dc,progress:structuredClone(q)});
        set(`${collection}.${targetId}.actorUuid`,null);
        set(`${collection}.${targetId}.quest`,{durationWeeks:q.durationWeeks,status:"pending",startWeek:null,completionWeek:null,timeCounted:false,benefitsApplied:false,runId:`${operationId}_next`});
        for(const field of ["result","resultText","responsibleActorUuid","grantedResources","countedWeeks"])set(`${collection}.${targetId}.quest.-=${field}`,null);
      }else set(`${collection}.${targetId}.quest`, q);
      detail = `${defKind === "activity" ? "Quest" : "Construção"} concluída: ${definition.name}${c.advance ? ` · ${q.durationWeeks} semana(s) contabilizada(s)` : " · sem avanço de calendário"}`; category = "Quests e obras"; break;
    }
    case "quest.repeat": {
      gm(); keys(["questId", "confirmed", "keepActor"]); safeId(c.questId); const q = questProgress(state, c.questId);
      if(c.keepActor!==undefined&&typeof c.keepActor!=="boolean")throw new Error("Escolha de responsável inválida.");
      if(state.activityDefinitions[c.questId]?.repeatable===false)throw new Error("Esta Quest não é repetível.");
      if (q.status !== "completed" || c.confirmed !== true) throw new Error("Confirme uma nova execução de Quest concluída.");
      const definition=state.activityDefinitions[c.questId]!;
      q.resultText??=resultNarrative(definition,q.result);if(q.responsibleActorUuid===undefined)q.responsibleActorUuid=definition.actorUuid??null;
      if(c.keepActor!==false)assertQuestCapacity(state,definition.actorUuid??null,definition.id);
      else set(`activityDefinitions.${definition.id}.actorUuid`,null);
      set(`definitionRuns.${q.runId ?? `${operationId}_previous`}`, { definitionId: c.questId, name: definition.name, description:definition.description,skillId:definition.skillId,dc:definition.dc,progress: q });
      set(`activityDefinitions.${c.questId}.quest`, { durationWeeks: q.durationWeeks, status: "pending", startWeek: null, completionWeek: null, timeCounted: false, benefitsApplied: false, runId: operationId }); for(const field of ["result","resultText","responsibleActorUuid","grantedResources","countedWeeks"])set(`activityDefinitions.${c.questId}.quest.-=${field}`,null); detail = "Nova execução de Quest preparada"; category = "Quests e obras"; break;
    }
    case "quest.result": {
      gm();keys(["kind","definitionId","result"]);safeId(c.definitionId);
      if(c.kind!=="activity"&&c.kind!=="project")throw new Error("Tipo de definição inválido.");
      if(c.result!==null&&!["criticalFailure","failure","success","criticalSuccess"].includes(String(c.result)))throw new Error("Resultado inválido.");
      const collection=c.kind==="activity"?"activityDefinitions":"projects",definition=state[collection][c.definitionId];
      if(!definition)throw new Error("Definição não encontrada.");
      const q=questProgress(state,definition.id,c.kind);if(q.status!=="completed")throw new Error("Conclua a atividade antes de alterar seu resultado.");
      if(c.result==="criticalSuccess"&&definition.requiresCheck===false)throw new Error("Uma Quest sem teste não produz sucesso crítico.");
      q.result=c.result as import("./core.js").Degree|null;q.resultText=resultNarrative(definition,q.result);
      if(q.responsibleActorUuid===undefined)q.responsibleActorUuid=definition.actorUuid??null;
      set(`${collection}.${definition.id}.quest`,q);detail="Resultado da conclusão atualizado";category="Quests e obras";break;
    }
    case "effect.save": case "effect.delete": {
      gm(); keys(["scope", "ownerId", "effect", "effectId"]);
      let collection: string;
      if (c.scope === "realm") collection = "checkEffects";
      else if (c.scope === "season" && SEASONS.some(s => s.id === c.ownerId)) collection = `seasonEffects.${c.ownerId}`;
      else if (c.scope === "feat" && typeof c.ownerId === "string" && state.feats?.[c.ownerId]) { safeId(c.ownerId); collection = `feats.${c.ownerId}.effects`; }
      else throw new Error("Origem do efeito inválida.");
      if (c.action === "effect.save") {
        if (!isRecord(c.effect)) throw new Error("Efeito inválido."); safeId(c.effect.id);
        const e = normalizeCheckEffect(c.effect, c.effect.id, state); set(`${collection}.${e.id}`, e); detail = `Efeito salvo: ${e.name}`;
      } else {
        safeId(c.effectId); if (!readPath(state, `${collection}.${c.effectId}`)) throw new Error("Efeito não encontrado.");
        set(`${collection}.-=${c.effectId}`, null); detail = "Efeito removido";
      }
      category = "Efeitos"; break;
    }
    default: {
      if (!c.action.startsWith("talent.")) throw new Error("Operação desconhecida.");
      const result = await applyFeatCommand(trial, user, c, operationId, actor.id, dependencies);
      detail = result.detail; publications = result.publications; category = "Talentos"; break;
    }
  }
  if (!resourceSummary(state).excess) { const income = settleFeatIncome(trial); if (income) detail += ` · +${income} Tesouro de Fama e fortuna`; }
  for (const name of ["feats", "featCatalogVersion", "featUses", "featIncome", "featPull", "featRoleOverride", "checkEffects", "resources"] as const) {
    if (JSON.stringify(state[name]) === JSON.stringify(trial[name])) continue;
    const oldValue = state[name], newValue = trial[name];
    if (newValue === undefined) { changes[`flags.${MODULE_ID}.state.-=${name}`] = null; continue; }
    if (isRecord(oldValue) && isRecord(newValue)) {
      for (const key of Object.keys(oldValue)) if (!(key in newValue)) changes[`flags.${MODULE_ID}.state.${name}.-=${key}`] = null;
      for (const [key,value] of Object.entries(newValue)) if (JSON.stringify(value)!==JSON.stringify((oldValue as Record<string, unknown>)[key])) changes[`flags.${MODULE_ID}.state.${name}.${key}`] = value;
    } else changes[`flags.${MODULE_ID}.state.${name}`] = newValue;
  }
  if (!Object.keys(changes).length && !stages.length) return [];
  validateResourceChange(state, trial);
  assertRealm(trial);
  for (const [index, publication] of publications.entries()) stages.push(async()=>{
    if (!dependencies.prepareFeat || !dependencies.publishFeat) throw new Error("Publicação de talentos indisponível.");
    const id=`${operationId}_pub_${index}`,receiptId=await dependencies.prepareFeat(actor,publication,id);
    mutations.push({apply:async()=>{},rollback:async()=>{await dependencies.discardFeat?.(receiptId);}});
    const task:PendingTask={id,operationId,userId:user.id,at:Date.now(),kind:"publication",receiptId};
    tasks.push(task);set(`pendingTasks.${id}`,task);
  });
  const audit = auditEntry(operationId, user, kind, { ...(path && kind === "field" ? { path, before, after } : path ? { path } : {}), detail, ...(category ? { category } : {}) });
  const staleOps = Object.values(state.operations).sort((a, b) => b.at.localeCompare(a.at)).slice(99).map(o => [`flags.${MODULE_ID}.state.operations.-=${o.id}`, null]);
  try {
  for(const stage of stages)await stage();
  assertRealm(trial);
  const result = await actor.update({ ...changes, ...Object.fromEntries(staleOps), [`flags.${MODULE_ID}.state.rulesVersion`]: RULES_VERSION, [`flags.${MODULE_ID}.state.operations.${operationId}`]: audit });
  if (!result) throw new Error("O Foundry não confirmou o salvamento.");
  }catch(error){if(actor.getFlag(MODULE_ID,"state") && (actor.getFlag(MODULE_ID,"state") as RealmState).operations?.[operationId])return tasks;for(const mutation of mutations.reverse())try{await mutation.rollback();}catch(rollbackError){console.error("Falha ao reverter alteração militar",rollbackError);}throw error;}
  for(const mutation of mutations)try{await mutation.finalize?.();}catch(e){console.error("Registro militar pendente de finalização",e);}
  return tasks;
}

const deliveries=new Map<string,Promise<void>>();
async function deliverTask(actor:PublicDocument,user:UserContext,task:PendingTask,deps:{armies?:ArmyGateway}&FeatDependencies):Promise<void>{
  const key=`${actor.id}:${task.id}`,existing=deliveries.get(key);if(existing)return existing;
  const work=(async()=>{
    const current=getState(actor).pendingTasks?.[task.id];if(!current)return;
    if(!user.isGM&&current.userId!==user.id)throw new Error("Operação de outro responsável.");
    try{
      if(current.kind==="publication"){
        if(!deps.publishFeat)throw new Error("Publicação indisponível.");
        await deps.publishFeat(actor,current.receiptId,current.id);
      }else{
        requireGM(actor,user);if(!deps.armies)throw new Error("Adaptador militar indisponível.");
        await deps.armies.remove(actor,current.unit);
      }
      await actor.update({[`flags.${MODULE_ID}.state.pendingTasks.-=${current.id}`]:null});
    }catch(error){console.error("Operação salva; entrega pendente",error);throw new Error("Alteração salva, mas a finalização está pendente. Use Tentar novamente nas operações pendentes da ficha; nenhum recurso será cobrado de novo.");}
  })();
  deliveries.set(key,work);try{await work;}finally{if(deliveries.get(key)===work)deliveries.delete(key);}
}
