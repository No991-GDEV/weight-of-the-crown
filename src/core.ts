import { QUEST_DEGREES, normalizeResultTexts } from "./quests.js";
import { validatePendingTasks, type PendingTask } from "./pending.js";
import { validateFeatState, type FeatUse, type FeatIncome } from "./feat-engine.js";
import { catalogFeats, CATALOG_VERSION } from "./feat-catalog.js";
import { kingdomRoles } from "./roles.js";
import { advancementAbility, effectiveRank, validateManagement, type Season, type KingdomFeat, type FeatureChoice, type CheckEffect, type QuestProgress } from "./management.js";
import { originAbility, validateRealmAdmin, type OriginProfile, type CompletionOutcome, type MilitaryUnit } from "./realm-admin.js";
/** Regras e estado independentes do DOM, Foundry e PF2e. Fase 5 / F5-001. */
export const MODULE_ID = "weight-of-the-crown";
export const SCHEMA_VERSION = "0.1.0";
export const RULES_VERSION = "0.42.0";
export const READABLE_RULES_VERSIONS = ["0.35.0", "0.36.0", "0.37.0", "0.38.0", "0.39.0", "0.40.0", "0.41.0", RULES_VERSION] as const;
export const ABILITIES = [
  { id: "ability_government", label: "Governo" },
  { id: "ability_economy", label: "Economia" },
  { id: "ability_knowledge", label: "Conhecimento" },
  { id: "ability_community", label: "Comunidade" },
  { id: "ability_defense", label: "Defesa" }
] as const;
export const SKILLS = [
  { id: "skill_intrigue", label: "Intriga", abilityId: "ability_government" },
  { id: "skill_politics", label: "Política", abilityId: "ability_government" },
  { id: "skill_statecraft", label: "Arte de governar", abilityId: "ability_government" },
  { id: "skill_boating", label: "Navegação", abilityId: "ability_economy" },
  { id: "skill_industry", label: "Indústria", abilityId: "ability_economy" },
  { id: "skill_trade", label: "Comércio", abilityId: "ability_economy" },
  { id: "skill_engineering", label: "Engenharia", abilityId: "ability_knowledge" },
  { id: "skill_magic", label: "Magia", abilityId: "ability_knowledge" },
  { id: "skill_scholarship", label: "Erudição", abilityId: "ability_knowledge" },
  { id: "skill_arts", label: "Artes", abilityId: "ability_community" },
  { id: "skill_agriculture", label: "Agricultura", abilityId: "ability_community" },
  { id: "skill_folklore", label: "Folclore", abilityId: "ability_community" },
  { id: "skill_wilderness", label: "Vida selvagem", abilityId: "ability_community" },
  { id: "skill_defense", label: "Defesa", abilityId: "ability_defense" },
  { id: "skill_warfare", label: "Guerra", abilityId: "ability_defense" },
  { id: "skill_exploration", label: "Exploração", abilityId: "ability_defense" }
] as const;
export const RESOURCES = [
  { id: "res_treasury", label: "Tesouro" }, { id: "res_wood", label: "Madeira" },
  { id: "res_stone", label: "Pedra" }, { id: "res_metal", label: "Metal" },
  { id: "res_food", label: "Comida" }
] as const;
export const RANKS = ["Destreinado", "Treinado", "Especialista", "Mestre", "Lendário"] as const;
export type AbilityId = typeof ABILITIES[number]["id"];
export type SkillId = typeof SKILLS[number]["id"];
export type ResourceId = typeof RESOURCES[number]["id"];
export type Rank = 0 | 1 | 2 | 3 | 4;
export interface Definition {
  id: string;
  name: string;
  description: string;
  skillId: SkillId | null;
  dc: number | null;
  suitability: number;
  stages: string;
  benefit: string;
  resultTexts?: Record<Degree,string>;
  actorUuid?: string | null;
  quest?: QuestProgress;
  requiresCheck?: boolean;
  outcome?: CompletionOutcome;
  completionEffectsActive?: boolean;
  featTags?: string[];
  repeatable?: boolean;
}
export interface AuditEntry {
  id: string; kind: "field" | "definition" | "roll"; at: string; userId: string;
  path?: string; before?: unknown; after?: unknown; detail?: string; category?: string;
}
export interface RealmState {
  exampleOnly: boolean;
  schemaVersion: string;
  rulesVersion: string;
  realmId: string;
  name: string;
  revision: number;
  progression: { level: number; xp: number | null; partyLevel: number | null };
  calendar: { ordinalWeek: number | null; phase: string | null; preparationWeeks: number; winterWeeks: number; season?: Season };
  resources: Record<ResourceId, number | null>;
  heroPoints?: number;
  foodStorage: { capacity: number };
  creation: {
    attributeAllocations: Record<AbilityId, number | null>;
    fixedAdjustments: { originId: string; abilityId: AbilityId; value: number; ruleId: string }[];
    trainedSkillChoices: SkillId[] | null;
    initialFeatId: string | null;
    origin?: OriginProfile;
    governmentFeatId?: string;
    wizardSeenAt?: string;
    wizardClaim?: string;
    setupCompletedAt?: string;
  };
  skills: Record<SkillId, { abilityId: AbilityId; rank: Rank | null }>;
  activityDefinitions: Record<string, Definition>;
  projects: Record<string, Definition>;
  roles?: Record<string, unknown>;
  feats?: Record<string, KingdomFeat>;
  featCatalogVersion?: string;
  featUses?: Record<string, FeatUse>;
  featIncome?: Record<string, FeatIncome>;
  featPull?: { nextDC: number; lastWeek: number };
  featRoleOverride?: string;
  advancement?: Record<string, FeatureChoice>;
  checkEffects?: Record<string, CheckEffect>;
  seasonEffects?: Partial<Record<Season, Record<string, CheckEffect>>>;
  crestImage?: string | null;
  demographics?: { population: number | null };
  militaryUnits?: Record<string, MilitaryUnit>;
  deletedMilitaryUnits?: Record<string, { name: string; at: string }>;
  definitionRuns?: Record<string, unknown>;
  operations: Record<string, AuditEntry>;
  pendingTasks?: Record<string, PendingTask>;
  [key: string]: unknown;
}

export function requireInteger(value: unknown, label: string, min?: number, max?: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max))
    throw new Error(`${label}: informe um número inteiro válido${min !== undefined ? ` (mínimo ${min})` : ""}${max !== undefined ? ` (máximo ${max})` : ""}.`);
  return value;
}
export function numericInput(value: string, label: string, min?: number, max?: number): number | null {
  if (value.trim() === "") return null;
  return requireInteger(Number(value), label, min, max);
}
export function kingdomHeroPoints(state: RealmState): number {
  return requireInteger(state.heroPoints === undefined ? 0 : state.heroPoints, "Hero Points do reino", 0);
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function assertRealm(value: unknown): asserts value is RealmState {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !READABLE_RULES_VERSIONS.some(v => v === value.rulesVersion))
    throw new Error("Formato ou versão de regras desconhecidos. A ficha não vai gravar esses dados.");
  if (typeof value.realmId !== "string" || !value.realmId || typeof value.name !== "string") throw new Error("Identidade do reino inválida.");
  if (!isRecord(value.progression) || !isRecord(value.resources) || !isRecord(value.creation) || !isRecord(value.creation.attributeAllocations) || !isRecord(value.skills))
    throw new Error("Estado de reino incompleto; confira o JSON importado.");
  requireInteger(value.progression.level, "Nível", 1, 20);
  for (const key of ["xp", "partyLevel"]) if (value.progression[key] !== null) requireInteger(value.progression[key], key, 0);
  for (const { id } of RESOURCES) if (value.resources[id] !== null) requireInteger(value.resources[id], id, 0);
  kingdomHeroPoints(value as unknown as RealmState);
  for (const { id } of ABILITIES) if (value.creation.attributeAllocations[id] !== null) requireInteger(value.creation.attributeAllocations[id], id, 0);
  if (!Array.isArray(value.creation.fixedAdjustments)) throw new Error("Ajustes fixos inválidos.");
  for (const adjustment of value.creation.fixedAdjustments) {
    if (!isRecord(adjustment) || !ABILITIES.some(a => a.id === adjustment.abilityId) || typeof adjustment.originId !== "string") throw new Error("Ajuste fixo inválido.");
    requireInteger(adjustment.value, "Ajuste fixo");
  }
  if (!isRecord(value.foodStorage)) throw new Error("Armazenamento inválido.");
  requireInteger(value.foodStorage.capacity, "Capacidade", 0);
  for (const { id, abilityId } of SKILLS) {
    const skill = value.skills[id];
    if (!isRecord(skill) || skill.abilityId !== abilityId) throw new Error(`Perícia inválida: ${id}.`);
    if (skill.rank !== null) requireInteger(skill.rank, "Proficiência", 0, 4);
  }
  if (!isRecord(value.activityDefinitions) || !isRecord(value.projects) || !isRecord(value.operations)) throw new Error("Coleção inválida.");
  if (!isRecord(value.calendar)) throw new Error("Calendário inválido.");
  if (value.definitionRuns !== undefined && !isRecord(value.definitionRuns)) throw new Error("Histórico de execuções inválido.");
  for (const [key, op] of Object.entries(value.operations)) {
    if (!isRecord(op) || typeof op.id !== "string" || op.id !== key || typeof op.at !== "string" || !Number.isFinite(Date.parse(op.at)) || typeof op.userId !== "string" || !["field", "definition", "roll"].includes(String(op.kind))) {
      throw new Error("Registro de histórico inválido.");
    }
  }
  for (const collection of [value.activityDefinitions, value.projects]) {
    for (const [key, def] of Object.entries(collection)) {
      if (!isRecord(def) || typeof def.id !== "string" || def.id !== key || typeof def.name !== "string") throw new Error("Definição inválida.");
      if (def.skillId !== null && !SKILLS.some(s => s.id === def.skillId)) throw new Error("Perícia da definição inválida.");
      if (def.dc !== null) requireInteger(def.dc, "CD da definição", 1);
      requireInteger(def.suitability, "Adequação da definição", -2, 2);
      if(def.resultTexts!==undefined)normalizeResultTexts(def.resultTexts);
    }
  }
  kingdomRoles(value as unknown as RealmState);
  validateManagement(value as unknown as RealmState);
  validateRealmAdmin(value as unknown as RealmState);
  validateFeatState(value as unknown as RealmState);
  validatePendingTasks(value.pendingTasks);
}
export function abilityTotal(state: RealmState, id: AbilityId): number | null {
  const base = state.creation.attributeAllocations[id];
  if (base === null) return null;
  return base + state.creation.fixedAdjustments.filter(a => a.abilityId === id).reduce((sum, a) => sum + a.value, 0) + advancementAbility(state, id) + originAbility(state, id);
}
export function proficiency(level: number, rank: Rank | null): number | null {
  if (rank === null) return null;
  return rank === 0 ? 0 : level + rank * 2;
}
export function checkModifier(state: RealmState, skillId: SkillId, suitability: number): { total: number; ability: number; proficiency: number; suitability: number } {
  requireInteger(suitability, "Adequação", -2, 2);
  const skill = state.skills[skillId];
  if (!skill) throw new Error("Escolha uma perícia válida.");
  const ability = abilityTotal(state, skill.abilityId);
  const prof = proficiency(state.progression.level, effectiveRank(state, skillId));
  if (ability === null || prof === null) throw new Error("Defina o atributo e a proficiência antes de rolar. Campo vazio não é zero.");
  return { total: ability + prof + suitability, ability, proficiency: prof, suitability };
}
export type Degree = "criticalFailure" | "failure" | "success" | "criticalSuccess";
export const DEGREE_LABELS: Record<Degree, string> = { criticalFailure: "Falha crítica", failure: "Falha", success: "Sucesso", criticalSuccess: "Sucesso crítico" };
export function degree(total: number, dc: number, die: number): Degree {
  requireInteger(total, "Total"); requireInteger(dc, "CD", 1); requireInteger(die, "Dado", 1, 20);
  let index = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (die === 20) index = Math.min(3, index + 1);
  if (die === 1) index = Math.max(0, index - 1);
  return (["criticalFailure", "failure", "success", "criticalSuccess"] as const)[index]!;
}
export function readPath(state: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, state);
}
/** Lista positiva: não escrever definições/segredos a partir de um input de jogador. */
export function normalizeField(path: string, raw: string, isGM: boolean, state: RealmState): number | null {
  if (RESOURCES.some(r => path === `resources.${r.id}`)) return numericInput(raw, "Reserva", 0);
  if (ABILITIES.some(a => path === `creation.attributeAllocations.${a.id}`)) return numericInput(raw, "Aumento inicial", 0);
  if (SKILLS.some(s => path === `skills.${s.id}.rank`)) {
    const value = numericInput(raw, "Proficiência", 0, 4);
    const maximum = state.progression.level >= 15 ? 4 : state.progression.level >= 7 ? 3 : state.progression.level >= 3 ? 2 : 1;
    if (value !== null && value > maximum) throw new Error("Este grau ainda não está disponível no nível do reino.");
    return value;
  }
  if (path === "progression.xp") return numericInput(raw, "XP", 0);
  if (isGM && path === "progression.level") {
    const level = numericInput(raw, "Nível", 1, 20);
    if (level === null) throw new Error("Informe o nível.");
    return level;
  }
  if (path === "foodStorage.capacity") throw new Error("A capacidade agora é calculada pelo nível do reino.");
  const consumption=/^militaryUnits\.([a-zA-Z0-9_-]+)\.consumption$/.exec(path);if(consumption&&state.militaryUnits?.[consumption[1]!]){const value=numericInput(raw,"Consumo de Comida",0,100);if(value===null)throw new Error("Informe o Consumo de Comida.");return value;}
  const unitMatch = /^militaryUnits\.([a-zA-Z0-9_-]+)\.headcount$/.exec(path);
  if (unitMatch && state.militaryUnits?.[unitMatch[1]!]) return numericInput(raw, "Efetivo", 0, 100000);
  throw new Error("Este campo não é editável por este formulário.");
}
export function normalizeDefinition(raw: Record<string, string>, id: string, kind: "activity" | "project"): Definition {
  const name = (raw.name ?? "").trim();
  if (!name || name.length > 120) throw new Error("Informe um nome de até 120 caracteres.");
  const requiresCheck = raw.requiresCheck !== "false";
  const skillId = requiresCheck ? raw.skillId : null;
  if (requiresCheck && !SKILLS.some(s => s.id === skillId)) throw new Error("Escolha a perícia do teste.");
  const dc = requiresCheck ? numericInput(raw.dc ?? "", "CD", 1) : null;
  const suitability = numericInput(raw.suitability ?? "", "Adequação", -2, 2);
  if (requiresCheck && dc === null || suitability === null) throw new Error("Informe CD e adequação definidas pelo Mestre.");
  for (const key of ["description", "stages", "benefit"]) if ((raw[key] ?? "").length > 12000) throw new Error("Texto muito longo.");
  return { id, name, ...(QUEST_DEGREES.some(d=>raw[`${d}Text`]!==undefined)?{resultTexts:normalizeResultTexts(Object.fromEntries(QUEST_DEGREES.map(d=>[d,raw[`${d}Text`]??""])))}:{}), skillId: skillId as SkillId | null, dc, suitability, ...(raw.requiresCheck !== undefined ? { requiresCheck } : {}), description: raw.description ?? "", stages: kind === "project" ? raw.stages ?? "" : "", benefit: raw.benefit ?? "" };
}
export function escapeHTML(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function createTestState(realmId: string): RealmState {
  const allocations: Record<AbilityId, number> = { ability_government: 1, ability_economy: 1, ability_knowledge: 0, ability_community: 1, ability_defense: 1 };
  const trained: SkillId[] = ["skill_intrigue", "skill_politics", "skill_industry", "skill_trade", "skill_engineering", "skill_scholarship"];
  return {
    exampleOnly: true, schemaVersion: SCHEMA_VERSION, rulesVersion: RULES_VERSION, realmId, name: "Novo reino", revision: 0,
    progression: { level: 2, xp: 0, partyLevel: null },
    calendar: { ordinalWeek: 1, phase: null, preparationWeeks: 4, winterWeeks: 12 },
    resources: { res_treasury: 2, res_wood: 0, res_stone: null, res_metal: null, res_food: 0 },
    foodStorage: { capacity: 6 }, heroPoints: 0,
    creation: { attributeAllocations: allocations, fixedAdjustments: [{ originId: "imperial_affiliation", abilityId: "ability_economy", value: 1, ruleId: "TWOC-COMP-009" }], trainedSkillChoices: null, initialFeatId: null },
    skills: Object.fromEntries(SKILLS.map(s => [s.id, { abilityId: s.abilityId, rank: trained.includes(s.id) ? 1 : 0 }])) as RealmState["skills"],
    politicalGroups: {}, people: {}, fronts: {}, activityRuns: {}, militaryUnits: {}, agreements: {}, obligations: {}, effects: {}, turns: {}, operations: {},
    activityDefinitions: {}, projects: {}
  };
}
/** Ficha nova deixa as escolhas dos jogadores em aberto, em vez de aplicar a fixture de testes. */
export function createRealmState(realmId: string): RealmState {
  const state = createTestState(realmId);
  state.exampleOnly = false;
  state.feats = catalogFeats(); state.featCatalogVersion = CATALOG_VERSION;
  for (const { id } of ABILITIES) state.creation.attributeAllocations[id] = null;
  for (const { id } of SKILLS) state.skills[id].rank = null;
  return state;
}
