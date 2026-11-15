import { SKILLS, isRecord, requireInteger, proficiency, degree, type RealmState, type SkillId, type Degree, type Definition } from "./core.js";
import { effectiveRank, currentWeek, resourceSummary, type FeatureChoice, type CheckContribution } from "./management.js";
import { kingdomRoles, safeId } from "./roles.js";
import { CATALOG_DATA, CATALOG_VERSION, CATALOG_TAGS, catalogKey, catalogFeats, type CatalogKey } from "./feat-catalog.js";
import type { UserContext } from "./adapter.js";

export interface FeatUse { key: string; week: number; token: string; userId: string; reserved: boolean; expiresAt: number; }
export interface FeatIncome { id: string; sourceQuestId: string; earnedWeek: number; dueWeek: number; amount: number; paidWeek: number | null; }
export interface CheckEvidence {
  id: string; actorId: string; userId: string; week: number; skillId: SkillId; outcome: Degree | null;
  activityId?: string | null; projectId?: string | null; crisisEffectId?: string | null; fortuneUsed?: boolean; resolved?: boolean; dc?: number;
  mode: string; private: boolean;
}
export interface FeatPublication {
  kind: "fixed" | "pull" | "crush" | "reroll"; title: string; userId: string; mode: string;
  sourceId?: string; total?: number; dc?: number; outcome?: Degree; skillId?: SkillId;
  activityId?: string; projectId?: string; week?: number; success?: boolean; rollJSON?: string;
}
export interface FeatDependencies {
  resolveCheck?: (id: string) => Promise<CheckEvidence | null>;
  rollD20?: () => Promise<number | {total:number;json:string}>;
  prepareFeat?: (actor: any, publication: FeatPublication, taskId: string) => Promise<string>;
  publishFeat?: (actor: any, receiptId: string, taskId: string) => Promise<void>;
  discardFeat?: (receiptId: string) => Promise<void>;
}
export function activeCatalogChoices(state: RealmState, atLevel = state.progression.level): { key: CatalogKey; choice: Partial<FeatureChoice>; id: string }[] {
  const selected: Partial<FeatureChoice>[] = Object.values(state.advancement ?? {}).filter(c => c.kind === "feat" && c.level <= atLevel);
  if (state.creation.governmentFeatId) selected.push({ featId: state.creation.governmentFeatId });
  return selected.flatMap(choice => { const key = catalogKey(choice.featId); return key && state.feats?.[choice.featId!] ? [{ key, choice, id: choice.featId! }] : []; });
}
export const ownsFeat = (state: RealmState, key: CatalogKey, atLevel = state.progression.level): boolean => activeCatalogChoices(state, atLevel).some(f => f.key === key);
export function featTrains(state: RealmState, skillId: SkillId, level: number): boolean { return activeCatalogChoices(state, level).some(f => f.key === "T10" && f.choice.featSkillId === skillId); }
export function protectedRole(state: RealmState): string | undefined {
  const f = activeCatalogChoices(state).find(f => f.key === "T01");
  return f ? state.featRoleOverride ?? f.choice.featRoleId : undefined;
}
export function normalizeFeatTags(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > CATALOG_TAGS.length || new Set(raw).size !== raw.length || !raw.every(t => CATALOG_TAGS.some(v => v.id === t))) throw new Error("Condições de talento inválidas.");
  return [...raw] as string[];
}
export function definitionTags(state: RealmState, context: { activityId?: string; projectId?: string }): string[] {
  return (context.activityId ? state.activityDefinitions[context.activityId] : context.projectId ? state.projects[context.projectId] : undefined)?.featTags ?? [];
}
export function catalogContributions(state: RealmState, context: { skillId: SkillId; activityId?: string; projectId?: string; suppressFreeFair?: boolean; includeConditional?:boolean }): CheckContribution[] {
  const tags = definitionTags(state, context), has = (...values: string[]) => values.some(t => tags.includes(t));
  const rules: [CatalogKey, boolean, number, "status" | "circumstance", string][] = [
    ["T01", has("leadership"), 2, "status", "Reorganização de liderança"], ["T03", has("internal_conflict"), 1, "status", "Conflito interno"],
    ["T04", has("fortification"), 2, "circumstance", "Fortificação"], ["T04", has("defense_event"), 1, "status", "Defesa do assentamento"],
    ["T05", has("work_site", "trade_agreement", "commodities"), 1, "status", "Atividade comercial"],
    ["T07", has("civil_maintenance"), 2, "circumstance", "Manutenção civil"],
    ["T12", context.skillId === "skill_arts" && has("cultural_relief"), 2, "status", "Entretenimento contra crise"],
    ["T14", has("end_harmful_event"), 4, "status", "Encerrar evento nocivo"],
    ["T15", !context.suppressFreeFair && has("leadership", "fealty"), 2, "circumstance", "Liderança e lealdade"],
    ["T16", context.skillId === "skill_trade" && has("civil_supplies"), 2, "status", "Abastecimento civil"]
  ];
  return rules.flatMap(([key, applies, value, type, label], i) => {
    const entry = CATALOG_DATA.find(f => f.key === key)!;
    return (applies || context.includeConditional) && (key!=="T12"||context.skillId==="skill_arts") && (key!=="T16"||context.skillId==="skill_trade") && ownsFeat(state, key) ? [{ originId: `feat:${entry.id}:catalog_${i}`, label: `${entry.name} · ${label}`, value, type, source: "feat" as const }] : [];
  });
}
export function featUseAvailable(state: RealmState, key: string, week = currentWeek(state)): boolean {
  const use = state.featUses?.[`${key}_w${week}`];
  return !use;
}
export function markFeatUse(state: RealmState, key: string, token: string, userId: string, reserved = false): void {
  safeId(key); safeId(token); const week = currentWeek(state);
  if (!featUseAvailable(state, key, week)) throw new Error("Este benefício já foi usado nesta semana ou está em resolução.");
  state.featUses ??= {}; state.featUses[`${key}_w${week}`] = { key, week, token, userId, reserved, expiresAt: 0 };
}
export function pullDC(state: RealmState): number {
  const previous = state.featPull;
  return previous ? Math.max(11, previous.nextDC - Math.max(0, currentWeek(state) - previous.lastWeek - 1)) : 11;
}
export function settleFeatIncome(state: RealmState): number {
  let paid = 0;
  for (const income of Object.values(state.featIncome ?? {}).sort((a, b) => a.dueWeek - b.dueWeek || a.id.localeCompare(b.id))) {
    if (income.paidWeek !== null || income.dueWeek > currentWeek(state)) continue;
    const summary = resourceSummary(state);
    if (!summary.complete || summary.excess || summary.knownTotal + income.amount > summary.capacity) continue;
    state.resources.res_treasury! += income.amount; income.paidWeek = currentWeek(state); paid += income.amount;
  }
  return paid;
}
export function applyQuestFeatRewards(state: RealmState, definition: Definition, outcome: Degree | undefined, runId: string, userId: string): number {
  if (outcome !== "success" && outcome !== "criticalSuccess") return 0;
  let added = 0;
  if (ownsFeat(state, "T05") && definition.featTags?.includes("commercial") && featUseAvailable(state, "insider")) {
    if (state.resources.res_treasury === null) throw new Error("Defina o Tesouro antes de receber Informações privilegiadas.");
    state.resources.res_treasury++; markFeatUse(state, "insider", runId, userId); added = 1;
  }
  if (outcome === "criticalSuccess" && ownsFeat(state, "T17") && featUseAvailable(state, "fame")) {
    const week = currentWeek(state); markFeatUse(state, "fame", runId, userId);
    state.featIncome ??= {}; state.featIncome[runId] = { id: runId, sourceQuestId: definition.id, earnedWeek: week, dueWeek: week + 1, amount: 2, paidWeek: null };
  }
  return added;
}
export function validateFeatState(state: RealmState): void {
  if (state.featCatalogVersion !== undefined && !["1.0",CATALOG_VERSION].includes(state.featCatalogVersion)) throw new Error("Versão do catálogo de talentos desconhecida.");
  if (state.featUses !== undefined) {
    if (!isRecord(state.featUses) || Object.keys(state.featUses).length > 20000) throw new Error("Usos de talentos inválidos.");
    for (const [id, u] of Object.entries(state.featUses)) { safeId(id); if (!isRecord(u)) throw new Error("Uso inválido."); safeId(u.key); safeId(u.token); requireInteger(u.week, "Semana do talento", 1); requireInteger(u.expiresAt, "Reserva do talento", 0); if (id !== `${u.key}_w${u.week}` || typeof u.userId !== "string" || typeof u.reserved !== "boolean") throw new Error("Uso de talento inconsistente."); }
  }
  if (state.featIncome !== undefined) {
    if (!isRecord(state.featIncome)) throw new Error("Recebimentos de talento inválidos.");
    for (const [id, r] of Object.entries(state.featIncome)) { safeId(id); if (!isRecord(r) || r.id !== id) throw new Error("Recebimento inválido."); safeId(r.sourceQuestId); requireInteger(r.earnedWeek, "Semana de origem", 1); requireInteger(r.dueWeek, "Semana de recebimento", r.earnedWeek + 1); requireInteger(r.amount, "Recebimento", 1, 100000); if (r.paidWeek !== null) requireInteger(r.paidWeek, "Semana paga", r.dueWeek); }
  }
  if (state.featPull !== undefined) { if (!isRecord(state.featPull)) throw new Error("União de esforços inválida."); requireInteger(state.featPull.nextDC, "CD", 11); requireInteger(state.featPull.lastWeek, "Semana", 1); }
  if (state.featRoleOverride !== undefined) safeId(state.featRoleOverride);
  for (const d of [...Object.values(state.activityDefinitions), ...Object.values(state.projects)]) {if (d.featTags !== undefined) normalizeFeatTags(d.featTags);if(d.repeatable!==undefined&&typeof d.repeatable!=="boolean")throw new Error("Repetição inválida.");}
}
export async function applyFeatCommand(state: RealmState, user: UserContext, c: Record<string, unknown>, token: string, actorId: string, deps: FeatDependencies): Promise<{ detail: string; publications: FeatPublication[] }> {
  const fields = (allowed: string[]) => { if (Object.keys(c).some(k => !["action", ...allowed].includes(k))) throw new Error("Campos de talento inválidos."); };
  const gm = () => { if (!user.isGM) throw new Error("Somente o Mestre administra este benefício."); };
  const own = (key: CatalogKey) => { if (!ownsFeat(state, key)) throw new Error("O reino não possui este talento ativo."); };
  const evidence = async (): Promise<CheckEvidence> => {
    safeId(c.messageId); const roll = await deps.resolveCheck?.(c.messageId);
    if (!roll || roll.actorId !== actorId || roll.week !== currentWeek(state) || !user.isGM && (roll.userId !== user.id || roll.mode === "blindroll")) throw new Error("Escolha um teste deste reino, da semana atual, ao qual você tenha acesso.");
    if (roll.resolved) throw new Error("Este resultado já foi resolvido por outro talento."); return roll;
  };
  switch (c.action) {
    case "talent.install": {
      gm(); fields([]);
      if (state.featCatalogVersion === CATALOG_VERSION) return { detail: "Catálogo já disponível", publications: [] };
      state.feats ??= {};
      for (const seed of Object.values(catalogFeats())) {
        const old = state.feats[seed.id];
        state.feats[seed.id] = { ...seed, ...(old ? { retired: old.retired, effects: { ...old.effects, ...seed.effects } } : {}) };
      }
      state.featCatalogVersion = CATALOG_VERSION; return { detail: "Catálogo de 17 talentos disponível", publications: [] };
    }
    case "talent.reserve": {
      fields(["key", "effectId", "token", "expectedWeek"]); own("T11");
      if (c.key !== "endure" || c.expectedWeek !== currentWeek(state)) throw new Error("Confira a semana do benefício.");
      safeId(c.effectId); safeId(c.token); const effect = state.checkEffects?.[c.effectId];
      if (!effect?.enabled || !effect.internalCrisis || effect.value >= 0) throw new Error("Escolha uma penalidade ativa de agitação interna.");
      markFeatUse(state, "endure", c.token, user.id, true); return { detail: "Resistir à anarquia preparado para este teste", publications: [] };
    }
    case "talent.finish": {
      fields(["token", "commit"]); safeId(c.token); if (typeof c.commit !== "boolean") throw new Error("Resolução inválida.");
      const entry = Object.entries(state.featUses ?? {}).find(([, u]) => u.reserved && u.token === c.token && (u.userId === user.id || user.isGM && c.commit === false));
      if (!entry) throw new Error("Esta opção não está mais em resolução.");
      if (c.commit) entry[1].reserved = false; else delete state.featUses![entry[0]];
      return { detail: c.commit ? "Resistir à anarquia utilizado" : "Teste cancelado; benefício preservado", publications: [] };
    }
    case "talent.assurance": {
      fields(["skillId", "dc", "mode", "activityId", "projectId"]); own("T06");
      const skillId = c.skillId as SkillId;
      if (!activeCatalogChoices(state).some(f => f.key === "T06" && f.choice.featSkillId === skillId)) throw new Error("Escolha uma perícia de Garantia do reino.");
      const rank = effectiveRank(state, skillId); if (rank === null || rank < 1) throw new Error("A perícia precisa estar treinada.");
      let dc = c.dc === null ? undefined : requireInteger(c.dc, "CD", 1);
      const ref = c.activityId ?? c.projectId; let definition: Definition | undefined;
      if (ref !== undefined) { safeId(ref); definition = c.activityId ? state.activityDefinitions[ref] : state.projects[ref]; if (!definition || definition.requiresCheck === false) throw new Error("Definição sem teste."); if (definition.skillId !== skillId && !(definition.skillId === "skill_engineering" && skillId === "skill_magic" && ownsFeat(state, "T08"))) throw new Error("A perícia não corresponde à definição."); if (!user.isGM && dc !== definition.dc) throw new Error("Use a CD da definição."); dc = definition.dc ?? undefined; }
      if (!["publicroll", "gmroll", "blindroll", "selfroll"].includes(String(c.mode))) throw new Error("Visibilidade inválida.");
      markFeatUse(state, `assurance_${skillId}`, token, user.id);
      const total = 10 + proficiency(state.progression.level, rank)!;
      return { detail: "Garantia do reino utilizada", publications: [{ kind: "fixed", title: definition?.name ?? "Garantia do reino", userId: user.id, mode: String(c.mode), total, dc, outcome: dc ? degree(total, dc, 10) : undefined, skillId, week: currentWeek(state), ...(c.activityId ? { activityId: String(c.activityId) } : c.projectId ? { projectId: String(c.projectId) } : {}) }] };
    }
    case "talent.pull": {
      fields(["messageId"]); own("T09"); const roll = await evidence();
      if (roll.outcome !== "criticalFailure") throw new Error("União de esforços exige uma falha crítica.");
      const dc = pullDC(state); markFeatUse(state, "pull", token, user.id);
      if (!deps.rollD20) throw new Error("O dado não está disponível."); const rolled = await deps.rollD20(); const die = requireInteger(typeof rolled === "number" ? rolled : rolled.total, "Dado", 1, 20), success = die === 20 || die !== 1 && die >= dc;
      state.featPull = { nextDC: dc + 5, lastWeek: currentWeek(state) };
      return { detail: "União de esforços utilizada", publications: [{ kind: "pull", title: "União de esforços", sourceId: roll.id, userId: user.id, mode: roll.mode, total: die, ...(typeof rolled === "number"?{}:{rollJSON:rolled.json}), dc, success, outcome: success ? "failure" : "criticalFailure" }] };
    }
    case "talent.crush": {
      gm(); fields(["messageId", "effectId"]); own("T03"); const roll = await evidence(); safeId(c.effectId);
      const effect = state.checkEffects?.[c.effectId];
      if (!effect?.internalCrisis || effect.crisisState !== "pending" || effect.value >= 0 || roll.skillId !== "skill_warfare" || roll.crisisEffectId !== c.effectId || !roll.dc || !roll.outcome) throw new Error("Use Guerra com CD definida contra uma nova penalidade de conflito interno.");
      markFeatUse(state, "crush", token, user.id);
      const cancelled = roll.outcome === "success" || roll.outcome === "criticalSuccess";
      effect.enabled = !cancelled; effect.crisisState = cancelled ? "contained" : "active";
      if (roll.outcome === "criticalFailure") effect.value *= 2;
      return { detail: "Nova consequência de conflito interno resolvida", publications: [{ kind: "crush", title: "Reprimir dissidência", sourceId: roll.id, userId: user.id, mode: roll.mode, outcome: roll.outcome }] };
    }
    case "talent.liquidate": {
      gm(); fields(["amount", "reason", "confirmed"]); own("T13");
      if (c.confirmed !== true || typeof c.reason !== "string" || !c.reason.trim() || c.reason.length > 500) throw new Error("Confirme e descreva a despesa extraordinária.");
      const amount = requireInteger(c.amount, "Despesa extraordinária", 1, 100000), treasury = state.resources.res_treasury;
      if (treasury === null || treasury < Math.max(0, amount - 1)) throw new Error("Tesouro insuficiente ou desconhecido para a despesa final.");
      markFeatUse(state, "liquidate", token, user.id); state.resources.res_treasury = treasury - Math.max(0, amount - 1);
      return { detail: `Despesa extraordinária paga com desconto: ${c.reason.trim()}`, publications: [] };
    }
    case "talent.reroll": {
      fields(["messageId"]); own("T15"); const roll = await evidence();
      if (roll.fortuneUsed || !["failure", "criticalFailure"].includes(String(roll.outcome)) || !definitionTags(state, { activityId: roll.activityId ?? undefined, projectId: roll.projectId ?? undefined }).some(t => t === "leadership" || t === "fealty")) throw new Error("Livre e justo exige uma falha elegível sem outra Fortuna aplicada.");
      if (state.resources.res_treasury === null || state.resources.res_treasury < 1) throw new Error("É necessário 1 Tesouro disponível.");
      markFeatUse(state, "free_fair", token, user.id); state.resources.res_treasury--;
      return { detail: "Livre e justo: 1 Tesouro pago para rerrolar", publications: [{ kind: "reroll", title: "Livre e justo", sourceId: roll.id, userId: user.id, mode: roll.mode }] };
    }
    case "talent.protect": {
      gm(); fields(["roleId", "leadershipId", "openingConfirmed"]); own("T01"); safeId(c.roleId); safeId(c.leadershipId);
      const quest = state.activityDefinitions[c.leadershipId];
      if (!kingdomRoles(state).some(r => r.id === c.roleId) || !quest?.featTags?.includes("leadership") || quest.quest?.status !== "completed" || quest.quest.completionWeek !== currentWeek(state) || c.openingConfirmed !== true) throw new Error("Confirme uma atividade de reorganização concluída na abertura desta semana.");
      state.featRoleOverride = c.roleId; return { detail: "Cargo protegido por Serviço público alterado", publications: [] };
    }
    case "talent.collect": fields([]); return { detail: `${settleFeatIncome(state)} Tesouro recebido de Fama e fortuna`, publications: [] };
    default: throw new Error("Operação de talento desconhecida.");
  }
}
