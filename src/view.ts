import {openQuestCount,resultNarrative} from "./quests.js";
import { activeCatalogChoices, featTrains, protectedRole } from "./feat-engine.js";
import { ABILITIES, SKILLS, RESOURCES, RANKS, DEGREE_LABELS, abilityTotal, proficiency, isRecord, type RealmState, type Definition } from "./core.js";
import { kingdomRoles, roleModifiers, targetLabel, type ActorAvailability } from "./roles.js";
import { advancementAbility, effectiveRank, checkContributions, stackedContributionTotal, resourceSummary, resourceCapacity, currentWeek, questProgress, SEASONS, featureSlots } from "./management.js";
import { ARMY_TYPES, CHARTERS, HEARTLANDS, GOVERNMENTS, originAdjustments, governmentSkills, militarySummary, normalizeMilitaryUnit, definitionOutcome } from "./realm-admin.js";

const signed = (n: number | null): string => n === null ? "—" : n >= 0 ? `+${n}` : `${n}`;
export interface ActorPresentation { actorUuid: string; actorName: string; actorImg: string; actorMissing: boolean; canOpenActor: boolean; }
export function realmView(state: RealmState, canEdit: boolean, isGM: boolean, extra: { actors?: Record<string, ActorPresentation>; availability?: ActorAvailability; users?: Record<string, string>; armies?:Record<string,any>;ownedActorUuids?:string[];canAssignQuests?:boolean } = {}) {
  const attributes = ABILITIES.map(a => ({
    ...a, base: state.creation.attributeAllocations[a.id] ?? "", total: signed(abilityTotal(state, a.id)),
    path: `creation.attributeAllocations.${a.id}`,
    adjustment: state.creation.fixedAdjustments.filter(f => f.abilityId === a.id).reduce((sum, f) => sum + f.value, 0), advancement: advancementAbility(state, a.id), originTotal: signed(originAdjustments(state).filter(f => f.abilityId === a.id).reduce((sum, a) => sum + a.value, 0)), hasOriginBonus: originAdjustments(state).some(f => f.abilityId === a.id), originDescription: originAdjustments(state).filter(f => f.abilityId === a.id).map(f => `${f.label}: ${signed(f.value)}`).join("; ")
  }));
  const skills = SKILLS.map(s => {
    const skill = state.skills[s.id];
    const ability = abilityTotal(state, skill.abilityId);
    const rank = effectiveRank(state, s.id), prof = proficiency(state.progression.level, rank);
    const abilityLabel = ABILITIES.find(a => a.id === s.abilityId)!.label;
    const rankLabel = rank === null ? "A definir" : RANKS[rank];
    const modifiers = checkContributions(state, extra.availability ?? {}, { skillId: s.id });
    const roleTotal = stackedContributionTotal(modifiers);
    const modifierParts = [
      `Atributo (${abilityLabel}): ${signed(ability)}`,
      `Proficiência (${rankLabel}): ${signed(prof)}`,
      ...modifiers.map(m => `${m.label}: ${signed(m.value)}`)
    ];
    return { ...s, abilityLabel,
      total: signed(ability === null || prof === null ? null : ability + prof + roleTotal),
      modifierSummary: modifierParts.join("; "),
      hasAdvancement: !isGM || featTrains(state,s.id,state.progression.level) || Object.values(state.advancement ?? {}).some(c => c.kind === "skill" && c.skillId === s.id && c.level <= state.progression.level), rankLabel, governmentTrained: governmentSkills(state).includes(s.id),
      path: `skills.${s.id}.rank`,
      ranks: [{ value: "", label: "A definir", selected: skill.rank === null }, ...RANKS.map((label, index) => ({ value: index, label, selected: skill.rank === index }))]
    };
  });
  const actorView = (uuid?: string | null) => uuid ? extra.actors?.[uuid] ?? { actorUuid: uuid, actorName: "Personagem indisponível", actorImg: "", actorMissing: true, canOpenActor: false } : { actorUuid: "", actorName: "", actorImg: "", actorMissing: false, canOpenActor: false };
  const runCounts=new Map<string,number>();
  for(const run of Object.values(state.definitionRuns??{}))if(isRecord(run)&&typeof run.definitionId==="string")runCounts.set(run.definitionId,(runCounts.get(run.definitionId)??0)+1);
  const definitionView = (d: Definition, kind: "activity" | "project", archived=false) => {
    const q = archived?questProgress({...state,activityDefinitions:{[d.id]:d}},d.id):questProgress(state,d.id,kind), configured=definitionOutcome(d);
    const outcome:ReturnType<typeof definitionOutcome>=q.status==="completed"?{resources:q.grantedResources??{},effects:{},costs:{}}:configured;
    const pastRunsCount = runCounts.get(d.id)??0;
    const responsible=q.status==="completed"&&q.responsibleActorUuid!==undefined?q.responsibleActorUuid:d.actorUuid;
    const canAssign=!archived&&q.status!=="completed"&&(kind==="activity"?(extra.canAssignQuests??canEdit)&&(isGM||!d.actorUuid||!!extra.ownedActorUuids?.includes(d.actorUuid)):canEdit);
    return { ...d, archived, canAssign, openQuestCount:responsible&&q.status!=="completed"?`${openQuestCount(state,responsible)}/2`:null,
      resultLabel:q.result?DEGREE_LABELS[q.result]:"Resultado não informado",resultClass:q.result??"unreported",resultNarrative:q.resultText!==undefined?q.resultText:resultNarrative(d,q.result),
      repeatable:d.repeatable!==false, ...actorView(responsible), ...q, kind, key: `${kind}:${d.id}`, isProject: kind === "project", requiresCheck: d.requiresCheck !== false && !!d.skillId && d.dc !== null,
      skillLabel: SKILLS.find(s => s.id === d.skillId)?.label ?? "Sem teste", durationLabel: `${q.durationWeeks} ${q.durationWeeks === 1 ? "semana" : "semanas"}`, questStatus: { pending: "Pendente", inProgress: "Em andamento", completed: "Concluída" }[q.status], questPending: q.status === "pending", questCompleted: q.status === "completed", canComplete: q.status !== "completed" || !q.timeCounted,
      pastRunsCount, pastRunsLabel: pastRunsCount ? `${pastRunsCount} ${pastRunsCount === 1 ? "execução anterior" : "execuções anteriores"}` : "",
      rewardLabels: RESOURCES.filter(r => (outcome.resources[r.id] ?? 0) > 0).map(r => ({ label: r.label, value: outcome.resources[r.id] })),
      costLabels:RESOURCES.filter(r=>((outcome.costs?.[r.id]??0)-(Math.min(0,outcome.resources[r.id]??0)))>0).map(r=>({label:r.label,value:(outcome.costs?.[r.id]??0)-Math.min(0,outcome.resources[r.id]??0)})),
      effectCount: Object.keys(outcome.effects).length, effectCountLabel: `${Object.keys(outcome.effects).length} ${Object.keys(outcome.effects).length === 1 ? "efeito" : "efeitos"}`, outcomeEffects: Object.values(outcome.effects).map(e => ({ ...e, signed: signed(e.value), targetLabel: targetLabel(e.target, state) }))
    };
  };
  const archivedDefinitions=Object.entries(state.definitionRuns??{}).flatMap(([runId,raw])=>{
    if(!isRecord(raw)||!isRecord(raw.progress)||raw.progress.status!=="completed"||typeof raw.definitionId!=="string"||typeof raw.name!=="string")return [];
    const d:Definition={id:raw.definitionId,name:raw.name,description:typeof raw.description==="string"?raw.description:"",skillId:null,dc:null,suitability:0,stages:"",benefit:"",quest:raw.progress as unknown as Definition["quest"]};
    try{return [{...definitionView(d,"activity",true),key:`run:${runId}`,repeatable:false,canComplete:false,canAssign:false,archived:true}];}catch{return [];}
  });
  const resourceInfo = resourceSummary(state);
  const capacityInfo = resourceCapacity(state);
  const army = militarySummary(state);
  const militaryUnits = Object.values(state.militaryUnits ?? {}).map(raw => {
    const base = normalizeMilitaryUnit(raw, raw.id), linked=extra.armies?.[raw.id];
    const u={...base,...(linked??{}),name:linked?.armyActorName??base.name,id:base.id};
    const gearBadges:string[]=[];
    return {
      ...u, ...actorView(u.commanderUuid), armyMissing:!linked||linked.armyMissing, consumptionPath:`militaryUnits.${u.id}.consumption`, key: `military:${u.id}`, headcountLabel: u.headcount ?? "—", headcountInput: u.headcount ?? "", headcountPath: `militaryUnits.${u.id}.headcount`,
      readinessKey: u.readiness ?? "unknown", readinessLabel: u.readiness === "ready" ? "Pronta" : u.readiness === "limited" ? "Limitada" : u.readiness === "unavailable" ? "Indisponível" : "A definir",
      armyTypeLabel: ARMY_TYPES.find(t => t.id === u.armyType)?.label ?? "Infantaria",
      scoutingSigned: signed(u.scouting ?? null), maneuverSigned: signed(u.maneuver ?? null), moraleSigned: signed(u.morale ?? null),
      meleeSigned: u.meleeAttack !== null && u.meleeAttack !== undefined ? signed(u.meleeAttack) : "—",
      rangedSigned: u.rangedAttack !== null && u.rangedAttack !== undefined ? signed(u.rangedAttack) : "—",
      trainingCount: u.trainingCount ?? 0,
      trainingLabel: (u.trainingCount ?? 0) > 0 ? `${u.trainingCount} sem. de treino` : "",
      gearBadges, slotLabel: "Capitão (10–15 soldados)", emptySlotLabel: "Arraste ou escolha o capitão"
    };
  });
  const origin = state.creation.origin;
  const progressionRows = Array.from({ length: 20 }, (_, index) => {
    const level = index + 1;
    return { level, current: level === state.progression.level, features: featureSlots(level).map(slot => {
      const selected = state.advancement?.[slot.id], locked = level > state.progression.level;
      const label = slot.kind === "feat" ? "Talento do reino" : slot.kind === "skill" ? "Aumento de perícia" : "+1 em dois atributos";
      const summary = selected?.featId ? state.feats?.[selected.featId]?.name ?? selected.featName : selected?.skillId ? SKILLS.find(s => s.id === selected.skillId)?.label : selected?.abilityIds?.map(id => ABILITIES.find(a => a.id === id)?.label).join(" + ");
      return { ...slot, label, summary, selected: !!selected, locked, available: !locked && !selected, status: selected ? locked ? "Escolhido · inativo" : "Escolhido" : locked ? "Futuro" : "Disponível" };
    }) };
  });
  const pendingFeatures = progressionRows.flatMap(r => r.features).filter(f => f.available).length;
  const roles = kingdomRoles(state).map(role => {
    const occupied = !!role.actorUuid && extra.availability?.[role.actorUuid] === true;
    const presentation = actorView(role.actorUuid);
    return { ...role, ...presentation, occupied, vacant: !occupied,
      hasDetails: !!role.description || role.effects.length > 0, effectCount: role.effects.length, effectsLabel: role.effects.length === 1 ? "1 efeito" : `${role.effects.length} efeitos`,
      actorName: role.actorUuid && !occupied ? "Responsável indisponível" : presentation.actorName,
      vacancyLabel: protectedRole(state)===role.id && role.vacancy.value<0 ? "Protegido por Serviço público" : role.vacancy.value ? `${signed(role.vacancy.value)} · ${targetLabel(role.vacancy.target, state)}` : "Sem modificador",
      effects: role.effects.map(e => ({ ...e, signed: signed(e.value), targetLabel: targetLabel(e.target, state), conditionLabel: e.condition === "responsible" ? "Quando conduz a atividade" : "Enquanto ocupado" }))
    };
  });
  const labels: Record<string, string> = { "progression.xp": "Experiência", "progression.level": "Nível", "foodStorage.capacity": "Capacidade de armazenamento" };
  for (const resource of RESOURCES) labels[`resources.${resource.id}`] = resource.label;
  for (const attribute of ABILITIES) labels[`creation.attributeAllocations.${attribute.id}`] = attribute.label;
  for (const skill of SKILLS) labels[`skills.${skill.id}.rank`] = `Treinamento · ${skill.label}`;
  const operations = Object.values(state.operations).sort((a,b) => b.at.localeCompare(a.at)).slice(0,30).map(o => {
    const binding = o.path?.endsWith(".actorUuid") || o.path?.endsWith(".commanderUuid");
    let summary = o.detail ?? "Definição atualizada";
    if (o.kind === "field") summary = binding ? `${typeof o.before === "string" ? actorView(o.before).actorName : "Sem responsável"} → ${typeof o.after === "string" ? actorView(o.after).actorName : "Sem responsável"}` : `${o.before ?? "—"} → ${o.after ?? "—"}`;
    const definitionLabel = o.category
      ?? (o.detail?.startsWith("Talento") ? "Talentos"
      : o.detail?.startsWith("Calendário") || o.detail?.startsWith("Estação") ? "Calendário"
      : o.detail?.startsWith("Efeito") ? "Efeitos"
      : o.detail?.startsWith("Assistente") || o.detail?.startsWith("Criação") ? "Criação"
      : o.detail?.startsWith("População") ? "População"
      : o.detail?.startsWith("Unidade") || o.detail?.startsWith("Comandante") || o.detail?.startsWith("Capitão") || o.detail?.startsWith("Tropa") ? "Exército"
      : o.detail?.startsWith("Reserva") || o.detail?.startsWith("Recursos") ? "Reservas"
      : o.detail?.startsWith("Progressão") ? "Progressão"
      : o.detail?.startsWith("Brasão") ? "Brasão"
      : o.detail?.startsWith("Cargo") ? "Cargos"
      : "Quests e obras");
    const label = o.path?.endsWith(".commanderUuid") ? (o.category ?? "Exército") : binding ? (o.category === "Cargos" ? "Cargos" : "Responsável") : o.path?.startsWith("roles.") ? "Cargos" : o.path?.startsWith("militaryUnits.") ? (o.category ?? "Exército") : o.kind === "field" ? labels[o.path ?? ""] ?? "Ficha atualizada" : o.kind === "definition" ? definitionLabel : "Rolagem";
    return { ...o, at: new Date(o.at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }), userId: extra.users?.[o.userId] ?? "Conselho", label, summary };
  });
  return {
    name: state.name, exampleOnly: state.exampleOnly, level: state.progression.level, xp: state.progression.xp ?? "", capacity: resourceInfo.capacity,
    resourceCapacity: resourceInfo.capacity, resourceTotal: resourceInfo.total ?? `${resourceInfo.knownTotal} + ?`, resourceExcess: resourceInfo.excess, resourceUnknown: !resourceInfo.complete,
    resourceCapacityTitle: [`Base: 5 × ${state.progression.level} = ${capacityInfo.base}`, ...capacityInfo.modifiers.map(e => `${e.label}: ${signed(e.value)}`), `Limite: ${capacityInfo.capacity}`].join("\n"),
    resourcePercent: resourceInfo.capacity ? Math.min(100, resourceInfo.knownTotal / resourceInfo.capacity * 100) : resourceInfo.knownTotal ? 100 : 0,
    crestImage: state.crestImage, week: currentWeek(state), seasons: SEASONS.map(s => ({ ...s, selected: s.id === state.calendar.season })), hasSeason: !!state.calendar.season,
    activeFeats:activeCatalogChoices(state).map(f=>({id:f.id,name:state.feats![f.id]!.name,skillLabel:f.choice.featSkillId?SKILLS.find(s=>s.id===f.choice.featSkillId)?.label:""})),
    population: state.demographics?.population ?? "—", armyLabel: army.label, armyUnitCount: army.count, armyUnitCountLabel: `${army.count} ${army.count === 1 ? "unidade" : "unidades"}`, militaryUnits,
    originLabels: origin ? [CHARTERS.find(c => c.id === origin.charterId)?.label, HEARTLANDS.find(h => h.id === origin.heartlandId)?.label, GOVERNMENTS.find(g => g.id === origin.governmentId)?.label].join(" · ") : "",
    originBonuses: originAdjustments(state).map(b => ({ ...b, abilityLabel: ABILITIES.find(a => a.id === b.abilityId)?.label, signed: signed(b.value) })), governmentFeatName: origin ? GOVERNMENTS.find(g => g.id === origin.governmentId)?.featName : "",
    progressionRows, pendingFeatures, pendingFeaturesLabel: `${pendingFeatures} ${pendingFeatures === 1 ? "pendência" : "pendências"}`,
    canEdit, isGM, attributes, skills, roles, occupiedRoles: roles.filter(r => r.occupied).length, roleCount: roles.length,
    resources: RESOURCES.map(r => ({ ...r, value: state.resources[r.id] ?? "", path: `resources.${r.id}` })),
    actions: Object.values(state.activityDefinitions).map(d => definitionView(d, "activity")).filter(d=>!d.questCompleted), projects: Object.values(state.projects).map(d => definitionView(d, "project")).filter(d=>!d.questCompleted),
    completedDefinitions:[...Object.values(state.activityDefinitions).map(d=>definitionView(d,"activity")),...Object.values(state.projects).map(d=>definitionView(d,"project"))].filter(d=>d.questCompleted).concat(archivedDefinitions),
    operations,
    skillGroups: ABILITIES.map(a => ({ ...a, skills: skills.filter(s => s.abilityId === a.id) })),
    allocationCount: Object.values(state.creation.attributeAllocations).reduce<number>((sum, n) => sum + (n ?? 0), 0),
    trainedCount: Object.values(state.skills).filter(s => s.rank !== null && s.rank > 0).length
  };
}
