import { featTrains, catalogContributions, protectedRole } from "./feat-engine.js";
import { catalogKey } from "./feat-catalog.js";
import { ABILITIES, RESOURCES, SKILLS, RANKS, isRecord, requireInteger } from "./core.js";
import { safeId, validateTarget, targetMatches, roleModifiers, kingdomRoles } from "./roles.js";
import { governmentSkills, governmentFeat, originAbility } from "./realm-admin.js";
export const SEASONS = [
    { id: "spring", label: "Primavera", icon: "🌸" }, { id: "summer", label: "Verão", icon: "☀️" },
    { id: "autumn", label: "Outono", icon: "🍂" }, { id: "winter", label: "Inverno", icon: "❄️" }
];
export const EFFECT_TYPES = [{ id: "untyped", label: "Reino (sem tipo)" }, { id: "circumstance", label: "Circunstância" }, { id: "status", label: "Estado" }, { id: "item", label: "Item" }];
export const featureSlots = (level) => [
    ...(level >= 2 && level % 2 === 0 ? [{ id: `level_${level}_feat`, level, kind: "feat" }] : []),
    ...(level >= 3 && level % 2 === 1 ? [{ id: `level_${level}_skill`, level, kind: "skill" }] : []),
    ...([5, 10, 15, 20].includes(level) ? [{ id: `level_${level}_abilities`, level, kind: "abilities" }] : [])
];
export const ALL_FEATURE_SLOTS = Array.from({ length: 20 }, (_, i) => featureSlots(i + 1)).flat();
export function boundedText(value, label, max = 12000, required = false) {
    if (typeof value !== "string" || value.length > max || required && !value.trim())
        throw new Error(`${label}: informe um texto válido de até ${max} caracteres.`);
    return required ? value.trim() : value;
}
function exact(value, allowed, label) {
    if (!isRecord(value) || Object.keys(value).some(k => !allowed.includes(k)))
        throw new Error(`${label}: campos inválidos.`);
    return value;
}
export function normalizeCheckEffect(raw, effectId, state) {
    safeId(effectId);
    const r = exact(raw, ["id", "name", "description", "type", "value", "target", "enabled", "internalCrisis", "crisisState"], "Efeito");
    if (r.id !== effectId || !EFFECT_TYPES.some(t => t.id === r.type) || typeof r.enabled !== "boolean")
        throw new Error("Tipo ou identificação de efeito inválidos.");
    if (r.internalCrisis !== undefined && typeof r.internalCrisis !== "boolean" || r.crisisState !== undefined && !["pending", "active", "contained"].includes(String(r.crisisState)))
        throw new Error("Crise inválida.");
    if (r.crisisState === "pending" && (!r.internalCrisis || r.enabled || Number(r.value) >= 0))
        throw new Error("Uma crise pendente deve ser interna, negativa e ainda inativa.");
    const capacity = isRecord(r.target) && r.target.kind === "reserveCapacity";
    if (capacity && (Object.keys(r.target).length !== 1 || r.internalCrisis || r.crisisState === "pending"))
        throw new Error("O limite de reservas não é um alvo de crise em testes.");
    return { ...(r.internalCrisis !== undefined ? { internalCrisis: r.internalCrisis } : {}), ...(r.crisisState !== undefined ? { crisisState: r.crisisState } : {}), id: effectId, name: boundedText(r.name, "Nome do efeito", 120, true), description: boundedText(r.description, "Descrição"), type: r.type, value: requireInteger(r.value, "Modificador", r.internalCrisis && r.crisisState === "active" ? -200 : -100, 100), target: capacity ? { kind: "reserveCapacity" } : validateTarget(r.target, state), enabled: r.enabled };
}
function effectCollection(raw, state) {
    if (!isRecord(raw) || Object.keys(raw).length > 100)
        throw new Error("Coleção de efeitos inválida (máximo 100).");
    return Object.fromEntries(Object.entries(raw).map(([id, e]) => [id, normalizeCheckEffect(e, id, state)]));
}
export function normalizeFeat(raw, featId, state) {
    safeId(featId);
    const r = exact(raw, ["id", "name", "description", "minimumLevel", "repeatable", "retired", "prerequisites", "effects"], "Talento");
    if (r.id !== featId || typeof r.repeatable !== "boolean" || typeof r.retired !== "boolean")
        throw new Error("Talento inválido.");
    const p = exact(r.prerequisites, ["feats", "skills", "abilities"], "Requisitos");
    if (!Array.isArray(p.feats) || !Array.isArray(p.skills) || !Array.isArray(p.abilities) || Math.max(p.feats.length, p.skills.length, p.abilities.length) > 16)
        throw new Error("Requisitos inválidos.");
    const feats = p.feats.map(f => { safeId(f); if (f === featId || state && !state.feats?.[f])
        throw new Error("Talento exigido não existe ou depende de si mesmo."); return f; });
    if (new Set(feats).size !== feats.length)
        throw new Error("Requisito de talento repetido.");
    const skills = p.skills.map(s => {
        const a = exact(s, ["id", "rank"], "Requisito de perícia");
        if (!SKILLS.some(v => v.id === a.id))
            throw new Error("Perícia exigida inválida.");
        return { id: a.id, rank: requireInteger(a.rank, "Grau exigido", 1, 4) };
    });
    const abilities = p.abilities.map(a => {
        const b = exact(a, ["id", "minimum"], "Requisito de atributo");
        if (!ABILITIES.some(v => v.id === b.id))
            throw new Error("Atributo exigido inválido.");
        return { id: b.id, minimum: requireInteger(b.minimum, "Atributo mínimo", 0, 100) };
    });
    if (new Set(skills.map(s => s.id)).size !== skills.length || new Set(abilities.map(a => a.id)).size !== abilities.length)
        throw new Error("Requisito de perícia ou atributo repetido.");
    return { id: featId, name: boundedText(r.name, "Nome do talento", 120, true), description: boundedText(r.description, "Descrição"), minimumLevel: requireInteger(r.minimumLevel, "Nível mínimo", 1, 20), repeatable: r.repeatable, retired: r.retired, prerequisites: { feats, skills, abilities }, effects: effectCollection(r.effects, state) };
}
export const choices = (state) => Object.values(state.advancement ?? {}).sort((a, b) => a.level - b.level || a.slotId.localeCompare(b.slotId));
export function effectiveRank(state, id, atLevel = state.progression.level) {
    const base = state.skills[id].rank;
    const trained = governmentSkills(state).includes(id) || featTrains(state, id, atLevel);
    if (base === null && !trained)
        return null;
    return (Math.max(base ?? 0, trained ? 1 : 0) + choices(state).filter(c => c.kind === "skill" && c.skillId === id && c.level <= atLevel).length);
}
export function advancementAbility(state, id, atLevel = state.progression.level) {
    return choices(state).filter(c => c.kind === "abilities" && c.level <= atLevel && c.abilityIds?.includes(id)).length;
}
export function abilityAtLevel(state, id, level) {
    const base = state.creation.attributeAllocations[id];
    return base === null ? null : base + state.creation.fixedAdjustments.filter(a => a.abilityId === id).reduce((n, a) => n + a.value, 0) + advancementAbility(state, id, level) + originAbility(state, id);
}
export const rankLimit = (level) => level >= 15 ? 4 : level >= 7 ? 3 : level >= 3 ? 2 : 1;
export function eligibleSkills(state, level) {
    return SKILLS.filter(s => { const rank = effectiveRank(state, s.id, level); return rank !== null && rank < rankLimit(level); });
}
export function featIneligibility(state, feat, level) {
    if (catalogKey(feat.id) === "T06" && SKILLS.filter(s => (effectiveRank(state, s.id, level) ?? 0) >= 1).length < 3)
        return "Exige três perícias treinadas";
    if (feat.retired)
        return "Talento arquivado";
    if (level < feat.minimumLevel)
        return `Exige nível ${feat.minimumLevel}`;
    const selected = choices(state).filter(c => c.kind === "feat" && c.level <= level);
    const originFeat = governmentFeat(state);
    if (!feat.repeatable && (selected.some(c => c.featId === feat.id) || originFeat?.id === feat.id))
        return "Já escolhido";
    if (feat.prerequisites.feats.some(id => originFeat?.id !== id && !selected.some(c => c.featId === id)))
        return "Falta talento exigido";
    const missing = feat.prerequisites.skills.filter(s => (effectiveRank(state, s.id, level) ?? -1) < s.rank);
    if (missing.length)
        return `Falta proficiência: ${missing.map(s => `${SKILLS.find(k => k.id === s.id).label} (${RANKS[s.rank]})`).join(", ")}`;
    if (feat.prerequisites.abilities.some(a => (abilityAtLevel(state, a.id, level) ?? -1) < a.minimum))
        return "Falta atributo exigido";
    return null;
}
export function validateCatalogChoice(state, featId, level, raw, historical = false) {
    const key = catalogKey(featId);
    if (key === "T06" || key === "T10") {
        if (!SKILLS.some(s => s.id === raw.featSkillId) || raw.featRoleId !== undefined)
            throw new Error("Escolha uma perícia para o talento.");
        const rank = effectiveRank(state, raw.featSkillId, level);
        if (key === "T06" && (SKILLS.filter(s => (effectiveRank(state, s.id, level) ?? 0) >= 1).length < 3 || rank === null || rank < 1))
            throw new Error("Garantia exige três perícias treinadas e uma escolha treinada.");
        if (key === "T10" && rank !== 0)
            throw new Error("Treinamento exige uma perícia destreinada.");
        if (choices(state).some(c => c.kind === "feat" && c.level <= level && c.featId === featId && c.featSkillId === raw.featSkillId))
            throw new Error("Escolha uma perícia diferente para cada repetição.");
    }
    else if (key === "T01") {
        if (typeof raw.featRoleId === "string")
            safeId(raw.featRoleId);
        if (typeof raw.featRoleId !== "string" || (!historical && !kingdomRoles(state).some(r => r.id === raw.featRoleId)) || raw.featSkillId !== undefined)
            throw new Error("Escolha o cargo protegido por Serviço público.");
    }
    else if (raw.featSkillId !== undefined || raw.featRoleId !== undefined)
        throw new Error("Este talento não usa uma escolha adicional.");
}
export function makeFeatureChoice(state, slotId, raw, userId, at) {
    const slot = ALL_FEATURE_SLOTS.find(s => s.id === slotId);
    if (!slot || slot.level > state.progression.level)
        throw new Error("Esta escolha ainda não está disponível.");
    if (state.advancement?.[slotId])
        throw new Error("Esta escolha já foi realizada.");
    const r = exact(raw, ["featId", "skillId", "abilityIds", "featSkillId", "featRoleId"], "Escolha de progressão");
    const choice = { level: slot.level, kind: slot.kind, slotId: slot.id, at, userId };
    // Não permitir campos de outro tipo de escolha.
    if (slot.kind === "feat") {
        if (Object.keys(r).some(k => !["featId", "featSkillId", "featRoleId"].includes(k)) || typeof r.featId !== "string")
            throw new Error("Escolha um talento válido.");
        const feat = state.feats?.[r.featId];
        if (!feat)
            throw new Error("Talento não encontrado.");
        const reason = featIneligibility(state, feat, slot.level);
        if (reason)
            throw new Error(reason);
        validateCatalogChoice(state, feat.id, slot.level, r);
        choice.featId = feat.id;
        choice.featName = feat.name;
        if (typeof r.featSkillId === "string")
            choice.featSkillId = r.featSkillId;
        if (typeof r.featRoleId === "string")
            choice.featRoleId = r.featRoleId;
    }
    else if (slot.kind === "skill") {
        if (Object.keys(r).some(k => k !== "skillId") || !eligibleSkills(state, slot.level).some(s => s.id === r.skillId))
            throw new Error("Escolha uma perícia que possa aumentar nesse nível.");
        choice.skillId = r.skillId;
    }
    else {
        if (Object.keys(r).some(k => k !== "abilityIds") || !Array.isArray(r.abilityIds) || r.abilityIds.length !== 2 || new Set(r.abilityIds).size !== 2 || !r.abilityIds.every(id => ABILITIES.some(a => a.id === id)))
            throw new Error("Escolha dois atributos diferentes.");
        choice.abilityIds = r.abilityIds;
    }
    const trial = structuredClone(state);
    trial.advancement = { ...trial.advancement, [slotId]: choice };
    validateAdvancement(trial);
    return choice;
}
export function validateClearFeatureChoice(state, slotId) {
    if (!state.advancement?.[slotId])
        throw new Error("Esta escolha ainda não foi realizada.");
    const trial = structuredClone(state);
    delete trial.advancement[slotId];
    validateAdvancement(trial);
    for (const c of choices(trial)) {
        if (c.kind !== "feat" || !c.featId)
            continue;
        const feat = trial.feats?.[c.featId];
        if (!feat)
            continue;
        const withoutSelf = structuredClone(trial);
        delete withoutSelf.advancement[c.slotId];
        const reason = featIneligibility(withoutSelf, feat, c.level);
        if (reason)
            throw new Error(`Não é possível desfazer porque "${feat.name}" (nível ${c.level}) depende desta escolha: ${reason}.`);
    }
}
export function validateAdvancement(state) {
    if (state.advancement !== undefined && !isRecord(state.advancement))
        throw new Error("Progressão inválida.");
    const ranks = Object.fromEntries(SKILLS.map(s => [s.id, effectiveRank({ ...state, advancement: {} }, s.id)]));
    for (const c of choices(state)) {
        exact(c, ["slotId", "level", "kind", "featId", "featName", "featSkillId", "featRoleId", "skillId", "abilityIds", "at", "userId"], "Registro de progressão");
        const slot = ALL_FEATURE_SLOTS.find(s => s.id === c.slotId);
        if (!slot || slot.kind !== c.kind || slot.level !== c.level || state.advancement?.[c.slotId] !== c || typeof c.at !== "string" || !Number.isFinite(Date.parse(c.at)) || typeof c.userId !== "string" || !c.userId)
            throw new Error("Registro de progressão inválido.");
        if (c.kind === "skill") {
            if (!c.skillId || ranks[c.skillId] === null || ranks[c.skillId] === undefined)
                throw new Error("Defina a proficiência antes de aumentá-la.");
            ranks[c.skillId]++;
            if (ranks[c.skillId] > rankLimit(c.level))
                throw new Error("Um aumento de perícia ultrapassa o limite de seu nível. Reveja as escolhas anteriores.");
        }
        else if (c.kind === "abilities") {
            if (!Array.isArray(c.abilityIds) || c.abilityIds.length !== 2 || new Set(c.abilityIds).size !== 2 || !c.abilityIds.every(id => ABILITIES.some(a => a.id === id)))
                throw new Error("Aumento de atributos inválido.");
        }
        else {
            if (!c.featId || !state.feats?.[c.featId] || typeof c.featName !== "string")
                throw new Error("Talento selecionado sem definição preservada.");
            const previous = { ...state, advancement: Object.fromEntries(choices(state).filter(p => p.level <= c.level && p.slotId !== c.slotId).map(p => [p.slotId, p])) };
            validateCatalogChoice(previous, c.featId, c.level, c, true);
            if (catalogKey(c.featId) === "T10" && c.featSkillId)
                ranks[c.featSkillId] = Math.max(1, ranks[c.featSkillId] ?? 0);
        }
    }
}
/** Ajustes de capacidade são quantidades de armazenamento e somam por origem, sem tipos de bônus de testes. */
export function resourceCapacity(state) {
    const base = requireInteger(state.progression.level, "Nível", 1, 20) * 5;
    const sources = new Map();
    const add = (prefix, label, effects) => {
        for (const e of Object.values(effects))
            if (e.enabled && e.target.kind === "reserveCapacity" && e.value) {
                const originId = `${prefix}:${e.id}`;
                sources.set(originId, { originId, label: `${label} · ${e.name}`, value: requireInteger(e.value, "Ajuste do limite de reservas", -100, 100) });
            }
    };
    add("effect", "Efeito", state.checkEffects ?? {});
    const season = SEASONS.find(s => s.id === state.calendar.season);
    if (season)
        add(`season:${season.id}`, season.label, state.seasonEffects?.[season.id] ?? {});
    for (const c of [...choices(state).filter(c => c.kind === "feat" && c.level <= state.progression.level), ...(governmentFeat(state) ? [{ featId: governmentFeat(state).id }] : [])]) {
        const feat = state.feats?.[c.featId];
        if (feat)
            add(`feat:${feat.id}`, feat.name, feat.effects);
    }
    for (const [kind, definitions] of [["quest", state.activityDefinitions], ["building", state.projects]]) {
        for (const d of Object.values(definitions))
            if (d.completionEffectsActive)
                add(`${kind}:${d.id}`, d.name, d.outcome?.effects ?? {});
    }
    const modifiers = [...sources.values()], adjustment = modifiers.reduce((n, e) => n + e.value, 0);
    return { base, adjustment, capacity: Math.max(0, requireInteger(base + adjustment, "Limite de reservas")), modifiers };
}
export function resourceSummary(state) {
    const values = RESOURCES.map(r => state.resources[r.id]), knownTotal = values.reduce((sum, n) => sum + (n ?? 0), 0);
    requireInteger(knownTotal, "Total de reservas", 0);
    const { capacity } = resourceCapacity(state);
    return { knownTotal, complete: values.every(v => v !== null), total: values.every(v => v !== null) ? knownTotal : null, capacity, excess: Math.max(0, knownTotal - capacity) };
}
export function validateResourceChange(before, after) {
    const previous = resourceSummary(before), next = resourceSummary(after);
    const adds = RESOURCES.some(r => (after.resources[r.id] ?? 0) > (before.resources[r.id] ?? 0));
    if (adds && !next.complete)
        throw new Error("Defina todas as reservas antes de acrescentar recursos; o total ainda é desconhecido.");
    if (adds && previous.excess && next.capacity <= previous.capacity)
        throw new Error(`Reservas acima do limite: remova ${previous.excess} antes de acrescentar recursos.`);
    if (adds && next.knownTotal > next.capacity)
        throw new Error(`O total ultrapassaria a capacidade de ${next.capacity} recursos.`);
}
export const currentWeek = (state) => requireInteger(state.calendar.ordinalWeek ?? 1, "Semana", 1);
export function questProgress(state, questId, kind = "activity") {
    const definition = (kind === "activity" ? state.activityDefinitions : state.projects)[questId];
    if (!definition)
        throw new Error("Quest ou construção não encontrada.");
    const q = definition.quest ?? { durationWeeks: 1, status: "pending", startWeek: null, completionWeek: null, timeCounted: false };
    exact(q, ["durationWeeks", "status", "startWeek", "completionWeek", "timeCounted", "countedWeeks", "benefitsApplied", "grantedResources", "runId", "result", "resultText", "responsibleActorUuid"], "Quest");
    if (q.result !== undefined && q.result !== null && !["criticalFailure", "failure", "success", "criticalSuccess"].includes(q.result))
        throw new Error("Resultado da Quest inválido.");
    if (q.resultText !== undefined)
        boundedText(q.resultText, "Texto do resultado", 12000);
    if (q.responsibleActorUuid !== undefined && q.responsibleActorUuid !== null && typeof q.responsibleActorUuid !== "string")
        throw new Error("Responsável da conclusão inválido.");
    if (q.benefitsApplied !== undefined && typeof q.benefitsApplied !== "boolean")
        throw new Error("Benefício de conclusão inválido.");
    if (q.runId !== undefined)
        safeId(q.runId);
    if (q.grantedResources !== undefined) {
        if (!isRecord(q.grantedResources))
            throw new Error("Recursos recebidos inválidos.");
        for (const [id, amount] of Object.entries(q.grantedResources)) {
            if (!RESOURCES.some(r => r.id === id))
                throw new Error("Recurso recebido desconhecido.");
            requireInteger(amount, "Alteração aplicada", -100000, 100000);
        }
    }
    requireInteger(q.durationWeeks, "Duração", 1, 10000);
    if (!["pending", "inProgress", "completed"].includes(q.status) || typeof q.timeCounted !== "boolean")
        throw new Error("Estado da Quest inválido.");
    for (const value of [q.startWeek, q.completionWeek])
        if (value !== null)
            requireInteger(value, "Semana da Quest", 1);
    if (q.countedWeeks !== undefined)
        requireInteger(q.countedWeeks, "Semanas contabilizadas", 1, 10000);
    if (q.status === "completed" && q.completionWeek === null || q.status !== "completed" && (q.completionWeek !== null || q.timeCounted && kind !== "project"))
        throw new Error("Conclusão da Quest inconsistente.");
    return structuredClone(q);
}
export function validateImagePath(raw) {
    if (raw === null)
        return null;
    if (typeof raw !== "string" || !raw || raw.length > 2048 || /[<>\x00-\x1f\\]/.test(raw) || /^(?:data|javascript|file|vbscript):/i.test(raw))
        throw new Error("Escolha um arquivo de imagem válido.");
    const decoded = decodeURIComponent(raw.split(/[?#]/)[0]);
    if (decoded.split("/").includes("..") || !/\.(?:png|jpe?g|webp|gif|svg|avif)$/i.test(decoded))
        throw new Error("Use uma imagem PNG, JPEG, WebP, GIF, SVG ou AVIF sem caminhos relativos acima da pasta atual.");
    if (/^[a-z][a-z\d+.-]*:/i.test(raw)) {
        const url = new URL(raw);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
            throw new Error("Endereço de imagem inválido.");
    }
    return raw;
}
export function validateManagement(state) {
    resourceSummary(state);
    currentWeek(state);
    if (state.calendar.season !== undefined && !SEASONS.some(s => s.id === state.calendar.season))
        throw new Error("Estação desconhecida.");
    if (state.crestImage !== undefined)
        validateImagePath(state.crestImage);
    if (state.feats !== undefined) {
        if (!isRecord(state.feats) || Object.keys(state.feats).length > 200)
            throw new Error("Biblioteca de talentos inválida.");
        for (const [id, f] of Object.entries(state.feats))
            normalizeFeat(f, id);
        const visited = new Set();
        const visit = (id, path) => { if (path.has(id))
            throw new Error("Requisitos de talentos formam um ciclo."); if (visited.has(id))
            return; const feat = state.feats?.[id]; if (!feat)
            throw new Error("Talento exigido não encontrado."); for (const dependency of feat.prerequisites.feats)
            visit(dependency, new Set([...path, id])); visited.add(id); };
        for (const id of Object.keys(state.feats))
            visit(id, new Set());
    }
    validateAdvancement(state);
    if (state.checkEffects !== undefined)
        effectCollection(state.checkEffects);
    if (state.seasonEffects !== undefined) {
        if (!isRecord(state.seasonEffects) || Object.keys(state.seasonEffects).some(k => !SEASONS.some(s => s.id === k)))
            throw new Error("Efeitos sazonais inválidos.");
        for (const effects of Object.values(state.seasonEffects))
            effectCollection(effects);
    }
    for (const id of Object.keys(state.activityDefinitions))
        questProgress(state, id);
    for (const id of Object.keys(state.projects))
        questProgress(state, id, "project");
}
export function checkContributions(state, availability, context) {
    const result = new Map();
    for (const m of roleModifiers(state, availability, context).filter(m => !(m.source === "vacancy" && m.value < 0 && m.roleId === protectedRole(state))))
        result.set(m.originId, { ...m, type: "untyped", source: "role" });
    const add = (prefix, label, source, effects) => {
        for (const e of Object.values(effects))
            if (e.enabled && e.value && targetMatches(e.target, context)) {
                const originId = `${prefix}:${e.id}`;
                result.set(originId, { originId, label: `${label} · ${e.name}`, value: e.value, type: e.type, source });
            }
    };
    const seenFeats = new Set();
    for (const c of [...choices(state).filter(c => c.kind === "feat" && c.level <= state.progression.level), ...(governmentFeat(state) ? [{ featId: governmentFeat(state).id }] : [])]) {
        const feat = state.feats?.[c.featId];
        if (!feat || seenFeats.has(feat.id))
            continue;
        seenFeats.add(feat.id);
        add(`feat:${feat.id}`, feat.name, "feat", feat.effects);
    }
    for (const m of catalogContributions(state, context))
        result.set(m.originId, m);
    const season = SEASONS.find(s => s.id === state.calendar.season);
    if (season)
        add(`season:${season.id}`, season.label, "season", state.seasonEffects?.[season.id] ?? {});
    add("effect", "Efeito", "effect", state.checkEffects ?? {});
    for (const q of Object.values(state.activityDefinitions))
        if (q.completionEffectsActive)
            add(`quest:${q.id}`, q.name, "quest", q.outcome?.effects ?? {});
    for (const m of context.additional ?? [])
        result.set(m.originId, m);
    const buildings = [];
    for (const building of Object.values(state.projects))
        if (building.completionEffectsActive)
            for (const e of Object.values(building.outcome?.effects ?? {}))
                if (e.enabled && e.value && targetMatches(e.target, context))
                    buildings.push({ originId: `building:${building.id}:${e.id}`, label: `${building.name} · ${e.name}`, value: e.value, type: e.type, source: "building" });
    const best = bestBuilding(buildings, [...result.values()]);
    for (const m of buildings)
        if (context.allBuildings || m.value < 0 || m.originId === best?.originId)
            result.set(m.originId, m);
    return [...result.values()].filter(m => !context.suppressFreeFair || !m.originId.startsWith("feat:kingdom_free_and_fair:catalog_")).filter(m => m.originId !== context.ignoreOrigin);
}
/** The one positive building with the largest marginal gain against the currently selected modifiers. */
export function bestBuilding(buildings, other) {
    const gain = (m) => m.type === "untyped" ? m.value : Math.max(0, m.value - other.filter(o => o.type === m.type && o.value > 0).reduce((n, o) => Math.max(n, o.value), 0));
    return buildings.filter(m => m.value > 0).sort((a, b) => gain(b) - gain(a) || b.value - a.value || a.originId.localeCompare(b.originId))[0];
}
/** Bônus/penalidades do reino sem tipo somam por origem. Tipos explicitamente escolhidos usam PF2e. */
export function stackedContributionTotal(modifiers) {
    let total = 0;
    const typed = new Map();
    const seen = new Set();
    for (const m of modifiers) {
        if (seen.has(m.originId))
            continue;
        seen.add(m.originId);
        if (m.type === "untyped")
            total += m.value;
        else {
            const group = typed.get(m.type) ?? { bonus: 0, penalty: 0 };
            group.bonus = Math.max(group.bonus, m.value);
            group.penalty = Math.min(group.penalty, m.value);
            typed.set(m.type, group);
        }
    }
    for (const g of typed.values())
        total += g.bonus + g.penalty;
    return total;
}
//# sourceMappingURL=management.js.map