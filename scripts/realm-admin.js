import { catalogFeats } from "./feat-catalog.js";
import { ABILITIES, RESOURCES, isRecord, requireInteger } from "./core.js";
import { boundedText, normalizeCheckEffect } from "./management.js";
import { safeId, validateActorUuid } from "./roles.js";
/** Correspondência aprovada: Culture=Conhecimento, Loyalty=Comunidade, Stability=Defesa. */
export const CHARTERS = [
    { id: "conquest", label: "Conquista", boost: "ability_community", flaw: "ability_knowledge" },
    { id: "expansion", label: "Expansão", boost: "ability_knowledge", flaw: "ability_defense" },
    { id: "exploration", label: "Exploração", boost: "ability_defense", flaw: "ability_economy" },
    { id: "grant", label: "Concessão", boost: "ability_economy", flaw: "ability_community" },
    { id: "open", label: "Aberta", boost: null, flaw: null }
];
export const HEARTLANDS = [
    { id: "forest_swamp", label: "Floresta ou pântano", boost: "ability_knowledge" },
    { id: "hill_plain", label: "Colina ou planície", boost: "ability_community" },
    { id: "lake_river", label: "Lago ou rio", boost: "ability_economy" },
    { id: "mountain_ruins", label: "Montanha ou ruínas", boost: "ability_defense" }
];
export const GOVERNMENTS = [
    { id: "despotism", label: "Despotismo", boosts: ["ability_defense", "ability_economy"], skills: ["skill_intrigue", "skill_warfare"], featId: "origin_crush_dissent", featName: "Reprimir dissidência", featDescription: "Crush Dissent: teste de Guerra para conter um aumento de inquietação, uma vez por turno. Sucesso cancela o aumento; falha crítica o dobra. +1 de estado para resolver eventos perigosos de conflito interno. O Mestre define os eventos e ajusta os efeitos aplicáveis.", source: "https://2e.aonprd.com/Feats.aspx?ID=3910" },
    { id: "feudalism", label: "Feudalismo", boosts: ["ability_defense", "ability_knowledge"], skills: ["skill_defense", "skill_trade"], featId: "origin_fortified_fiefs", featName: "Feudos fortificados", featDescription: "Fortified Fiefs: +2 de circunstância para fortificar hexágonos e construir ou reparar fortificações militares; +1 de estado em eventos perigosos que afetam as defesas dos assentamentos. O Mestre escolhe as Quests correspondentes nos efeitos.", source: "https://2e.aonprd.com/Feats.aspx?ID=3913" },
    { id: "oligarchy", label: "Oligarquia", boosts: ["ability_community", "ability_economy"], skills: ["skill_arts", "skill_industry"], featId: "origin_insider_trading", featName: "Informações privilegiadas", featDescription: "Insider Trading: +1 de estado ao estabelecer local de trabalho, acordo comercial ou negociar mercadorias; também concede um dado de recursos por turno no Kingmaker. O Mestre vincula os testes pertinentes e adapta a parte de dados de recursos ao orçamento da mesa.", source: "https://2e.aonprd.com/Feats.aspx?ID=3915" },
    { id: "republic", label: "República", boosts: ["ability_defense", "ability_community"], skills: ["skill_engineering", "skill_politics"], featId: "origin_pull_together", featName: "União de esforços", featDescription: "Pull Together: uma vez por turno, uma falha crítica do reino permite teste simples inicial CD 11 para tratá-la como falha. A CD aumenta em 5 a cada uso e diminui em 1 por turno sem uso, até 11. O Mestre acompanha o uso e resolve esse gatilho.", source: "https://2e.aonprd.com/Feats.aspx?ID=3921" },
    { id: "thaumocracy", label: "Taumocracia", boosts: ["ability_economy", "ability_knowledge"], skills: ["skill_folklore", "skill_magic"], featId: "origin_practical_magic", featName: "Magia prática", featDescription: "Practical Magic: +1 de estado em Magia e possibilidade de usá-la no lugar de Engenharia. No original, contratar aventureiros custa 1 RP; esse custo exige adaptação ao orçamento da mesa. O +1 em Magia é aplicado automaticamente; o Mestre escolhe as substituições e os custos de cada Quest.", source: "https://2e.aonprd.com/Feats.aspx?ID=3920" },
    { id: "yeomanry", label: "Governo comunitário", boosts: ["ability_community", "ability_knowledge"], skills: ["skill_agriculture", "skill_wilderness"], featId: "origin_muddle_through", featName: "Improvisação coletiva", featDescription: "Muddle Through: aumenta em 1 dois limiares de Ruína e em 2 um terceiro. Como o reino desta mesa não usa esses limiares, o Mestre define um benefício equivalente por efeitos, em vez de criar Ruína ou bônus de testes por inferência.", source: "https://2e.aonprd.com/Feats.aspx?ID=3919" }
];
export const ARMY_TYPES = [
    { id: "archery", label: "Arquearia", minLevel: 1, highSave: "morale", acOffset: 0, saveOffset: 0, hpBase: 4, routBase: 2, consumption: 1, primaryAttack: "melee", traitNote: "Valores iniciais de Infantaria; ficha militar independente." },
    { id: "infantry", label: "Infantaria", minLevel: 1, highSave: "morale", acOffset: 0, saveOffset: 0, hpBase: 4, routBase: 2, consumption: 1, primaryAttack: "melee", traitNote: "Infantaria padrão a pé com armas corpo a corpo." },
    { id: "cavalry", label: "Cavalaria", minLevel: 3, highSave: "maneuver", acOffset: 0, saveOffset: 0, hpBase: 4, routBase: 2, consumption: 2, primaryAttack: "melee", traitNote: "Atropelar: +1 de estado em ataques contra infantaria e escaramuçadores; -1 em Manobra e Moral contra área e mental." },
    { id: "skirmisher", label: "Escaramuçadores", minLevel: 5, highSave: "maneuver", acOffset: -2, saveOffset: 2, hpBase: 4, routBase: 2, consumption: 1, primaryAttack: "melee", traitNote: "Tropas móveis e leves (-2 CA, +2 Manobra e Moral)." },
    { id: "siege", label: "Cerco", minLevel: 7, highSave: "morale", acOffset: 0, saveOffset: 0, hpBase: 6, routBase: 3, consumption: 1, primaryAttack: "ranged", traitNote: "Máquinas de guerra: +2 PV base, ataca fortificações à distância." }
];
export const ARMY_LEVEL_TABLE = {
    1: { scouting: 7, standardDc: 15, ac: 16, highSave: 10, lowSave: 4, attack: 9, maxTactics: 1 },
    2: { scouting: 8, standardDc: 16, ac: 18, highSave: 11, lowSave: 5, attack: 11, maxTactics: 1 },
    3: { scouting: 9, standardDc: 18, ac: 19, highSave: 12, lowSave: 6, attack: 12, maxTactics: 1 },
    4: { scouting: 11, standardDc: 19, ac: 21, highSave: 14, lowSave: 8, attack: 14, maxTactics: 2 },
    5: { scouting: 12, standardDc: 20, ac: 22, highSave: 15, lowSave: 9, attack: 15, maxTactics: 2 },
    6: { scouting: 14, standardDc: 22, ac: 24, highSave: 17, lowSave: 11, attack: 17, maxTactics: 2 },
    7: { scouting: 15, standardDc: 23, ac: 25, highSave: 18, lowSave: 12, attack: 18, maxTactics: 2 },
    8: { scouting: 16, standardDc: 24, ac: 27, highSave: 19, lowSave: 13, attack: 20, maxTactics: 3 },
    9: { scouting: 18, standardDc: 26, ac: 28, highSave: 21, lowSave: 15, attack: 21, maxTactics: 3 },
    10: { scouting: 19, standardDc: 27, ac: 30, highSave: 22, lowSave: 16, attack: 23, maxTactics: 3 },
    11: { scouting: 21, standardDc: 28, ac: 31, highSave: 24, lowSave: 18, attack: 24, maxTactics: 3 },
    12: { scouting: 22, standardDc: 30, ac: 33, highSave: 25, lowSave: 19, attack: 26, maxTactics: 4 },
    13: { scouting: 23, standardDc: 31, ac: 34, highSave: 26, lowSave: 20, attack: 27, maxTactics: 4 },
    14: { scouting: 25, standardDc: 32, ac: 36, highSave: 28, lowSave: 22, attack: 29, maxTactics: 4 },
    15: { scouting: 26, standardDc: 34, ac: 37, highSave: 29, lowSave: 23, attack: 30, maxTactics: 4 },
    16: { scouting: 28, standardDc: 35, ac: 39, highSave: 30, lowSave: 25, attack: 32, maxTactics: 5 },
    17: { scouting: 29, standardDc: 36, ac: 40, highSave: 32, lowSave: 26, attack: 33, maxTactics: 5 },
    18: { scouting: 30, standardDc: 38, ac: 42, highSave: 33, lowSave: 27, attack: 35, maxTactics: 5 },
    19: { scouting: 32, standardDc: 39, ac: 43, highSave: 35, lowSave: 29, attack: 36, maxTactics: 5 },
    20: { scouting: 33, standardDc: 40, ac: 45, highSave: 36, lowSave: 30, attack: 38, maxTactics: 6 }
};
export function defaultArmyStats(armyType = "infantry", level = 1) {
    const type = ARMY_TYPES.find(t => t.id === armyType);
    if (!type)
        throw new Error("Tipo de unidade inválido.");
    const lvl = requireInteger(level, "Nível da unidade", 1, 20), row = ARMY_LEVEL_TABLE[lvl];
    return {
        scouting: row.scouting, ac: row.ac + type.acOffset,
        maneuver: (type.highSave === "maneuver" ? row.highSave : row.lowSave) + type.saveOffset,
        morale: (type.highSave === "morale" ? row.highSave : row.lowSave) + type.saveOffset,
        meleeAttack: type.primaryAttack === "melee" ? row.attack : null,
        rangedAttack: type.primaryAttack === "ranged" ? (armyType === "siege" ? row.attack - 3 : row.attack) : null,
        hpMax: type.hpBase, hpCurrent: type.hpBase, routThreshold: type.routBase, consumption: type.consumption,
        maxTactics: row.maxTactics, standardDc: row.standardDc
    };
}
export function defaultMilitaryGear() { return { meleeTier: 0, rangedTier: 0, armorTier: 0, secondaryWeapon: "none", potions: 0 }; }
export function normalizeMilitaryGear(raw) {
    if (raw === undefined)
        return defaultMilitaryGear();
    if (!isRecord(raw) || Object.keys(raw).some(k => !["meleeTier", "rangedTier", "armorTier", "secondaryWeapon", "potions"].includes(k)))
        throw new Error("Equipamento militar inválido.");
    if (!["none", "melee", "ranged"].includes(String(raw.secondaryWeapon ?? "none")))
        throw new Error("Arma adicional inválida.");
    return {
        meleeTier: requireInteger(raw.meleeTier ?? 0, "Armas corpo a corpo", 0, 3),
        rangedTier: requireInteger(raw.rangedTier ?? 0, "Armas à distância", 0, 3),
        armorTier: requireInteger(raw.armorTier ?? 0, "Armadura", 0, 3),
        secondaryWeapon: (raw.secondaryWeapon ?? "none"),
        potions: requireInteger(raw.potions ?? 0, "Poções de cura", 0, 3)
    };
}
export function normalizeOrigin(raw) {
    if (!isRecord(raw) || Object.keys(raw).some(k => !["charterId", "heartlandId", "governmentId", "charterFree", "governmentFree"].includes(k)))
        throw new Error("Origem do reino inválida.");
    const charter = CHARTERS.find(c => c.id === raw.charterId), heartland = HEARTLANDS.find(h => h.id === raw.heartlandId), government = GOVERNMENTS.find(g => g.id === raw.governmentId);
    if (!charter || !heartland || !government)
        throw new Error("Escolha Carta, Heartland e Governo.");
    if (!ABILITIES.some(a => a.id === raw.charterFree) || raw.charterFree === charter.boost || raw.charterFree === charter.flaw)
        throw new Error("O aumento livre da Carta deve usar outro atributo, diferente do benefício e da limitação.");
    if (!ABILITIES.some(a => a.id === raw.governmentFree) || government.boosts.includes(raw.governmentFree))
        throw new Error("O aumento livre do Governo deve usar um terceiro atributo.");
    return { charterId: charter.id, heartlandId: heartland.id, governmentId: government.id, charterFree: raw.charterFree, governmentFree: raw.governmentFree };
}
export function originAdjustments(state) {
    if (!state.creation.origin)
        return [];
    const p = normalizeOrigin(state.creation.origin), charter = CHARTERS.find(c => c.id === p.charterId), heartland = HEARTLANDS.find(h => h.id === p.heartlandId), gov = GOVERNMENTS.find(g => g.id === p.governmentId);
    return [
        ...(charter.boost ? [{ origin: "charter:fixed", label: `Carta · ${charter.label}`, abilityId: charter.boost, value: 1 }] : []),
        ...(charter.flaw ? [{ origin: "charter:flaw", label: `Carta · limitação`, abilityId: charter.flaw, value: -1 }] : []),
        { origin: "charter:free", label: "Carta · escolha livre", abilityId: p.charterFree, value: 1 },
        { origin: "heartland", label: `Heartland · ${heartland.label}`, abilityId: heartland.boost, value: 1 },
        ...gov.boosts.map((abilityId, i) => ({ origin: `government:fixed${i}`, label: `Governo · ${gov.label}`, abilityId, value: 1 })),
        { origin: "government:free", label: "Governo · escolha livre", abilityId: p.governmentFree, value: 1 }
    ];
}
export function originAbility(state, id) { return originAdjustments(state).filter(a => a.abilityId === id).reduce((sum, a) => sum + a.value, 0); }
export function governmentSkills(state) { return GOVERNMENTS.find(g => g.id === state.creation.origin?.governmentId)?.skills ?? []; }
export function governmentFeat(state) { const id = state.creation.governmentFeatId; return id ? state.feats?.[id] ?? null : null; }
export function initialGovernmentFeat(governmentId) {
    const g = GOVERNMENTS.find(v => v.id === governmentId);
    if (!g)
        throw new Error("Governo desconhecido.");
    return catalogFeats()[g.featId];
}
export function normalizeOutcome(raw, state) {
    if (!isRecord(raw) || Object.keys(raw).some(k => !["resources", "effects", "costs"].includes(k)) || !isRecord(raw.resources) || !isRecord(raw.effects))
        throw new Error("Benefícios de conclusão inválidos.");
    const resources = {};
    for (const [key, value] of Object.entries(raw.resources)) {
        if (!RESOURCES.some(r => r.id === key))
            throw new Error("Recurso de recompensa inválido.");
        resources[key] = requireInteger(value, "Alteração de recursos", -100000, 100000);
    }
    const costs = {};
    if (raw.costs !== undefined) {
        if (!isRecord(raw.costs))
            throw new Error("Custos inválidos.");
        for (const [key, value] of Object.entries(raw.costs)) {
            if (!RESOURCES.some(r => r.id === key))
                throw new Error("Recurso de custo inválido.");
            costs[key] = requireInteger(value, "Custo", 0, 100000);
        }
    }
    if (Object.keys(raw.effects).length > 30)
        throw new Error("Use até 30 efeitos de conclusão.");
    return { resources, ...(raw.costs !== undefined ? { costs } : {}), effects: Object.fromEntries(Object.entries(raw.effects).map(([id, e]) => [id, normalizeCheckEffect(e, id, state)])) };
}
export function definitionOutcome(definition) { return definition.outcome ?? { resources: {}, effects: {} }; }
const MILITARY_UNIT_KEYS = [
    "armyActorUuid", "id", "name", "headcount", "readiness", "task", "location", "equipment", "notes", "condition", "commanderUuid",
    "armyType", "level", "scouting", "ac", "maneuver", "morale", "meleeAttack", "rangedAttack", "hpMax", "hpCurrent",
    "routThreshold", "consumption", "tactics", "trainingCount", "gear"
];
export function normalizeMilitaryUnit(raw, unitId) {
    safeId(unitId);
    if (!isRecord(raw) || raw.id !== unitId || Object.keys(raw).some(k => !MILITARY_UNIT_KEYS.includes(k)))
        throw new Error("Dados da unidade inválidos.");
    if (raw.readiness !== null && !["ready", "limited", "unavailable"].includes(String(raw.readiness)))
        throw new Error("Prontidão inválida.");
    if (raw.commanderUuid !== undefined)
        validateActorUuid(raw.commanderUuid);
    if (raw.armyActorUuid !== undefined) {
        validateActorUuid(raw.armyActorUuid);
        if (typeof raw.armyActorUuid !== "string" || !/^Actor\.[a-zA-Z0-9_-]+$/.test(raw.armyActorUuid))
            throw new Error("Referência de ficha militar inválida.");
    }
    const armyType = (raw.armyType ?? "infantry");
    if (!ARMY_TYPES.some(t => t.id === armyType))
        throw new Error("Tipo de unidade inválido.");
    const level = raw.level !== undefined ? requireInteger(raw.level, "Nível da unidade", 1, 20) : 1;
    const defaults = defaultArmyStats(armyType, level);
    const hpMax = raw.hpMax !== undefined ? requireInteger(raw.hpMax, "PV máximos", 1, 1000) : defaults.hpMax;
    return {
        id: unitId, name: boundedText(raw.name, "Nome da unidade", 120, true),
        headcount: raw.headcount === null ? null : requireInteger(raw.headcount, "Efetivo", 0, 100000),
        readiness: raw.readiness,
        task: boundedText(raw.task, "Tarefa"), location: boundedText(raw.location, "Localização"),
        equipment: boundedText(raw.equipment ?? "", "Equipamento"), notes: boundedText(raw.notes, "Observações"), condition: boundedText(raw.condition, "Condição"),
        ...(raw.armyActorUuid !== undefined ? { armyActorUuid: String(raw.armyActorUuid) } : {}),
        ...(raw.commanderUuid !== undefined ? { commanderUuid: raw.commanderUuid } : {}),
        armyType, level,
        scouting: raw.scouting !== undefined ? requireInteger(raw.scouting, "Explorador", -20, 100) : defaults.scouting,
        ac: raw.ac !== undefined ? requireInteger(raw.ac, "CA", 1, 100) : defaults.ac,
        maneuver: raw.maneuver !== undefined ? requireInteger(raw.maneuver, "Manobra", -20, 100) : defaults.maneuver,
        morale: raw.morale !== undefined ? requireInteger(raw.morale, "Moral", -20, 100) : defaults.morale,
        meleeAttack: raw.meleeAttack === undefined ? defaults.meleeAttack : raw.meleeAttack === null ? null : requireInteger(raw.meleeAttack, "Ataque corpo a corpo", -20, 100),
        rangedAttack: raw.rangedAttack === undefined ? defaults.rangedAttack : raw.rangedAttack === null ? null : requireInteger(raw.rangedAttack, "Ataque à distância", -20, 100),
        hpMax,
        hpCurrent: raw.hpCurrent !== undefined ? requireInteger(raw.hpCurrent, "PV atuais", 0, hpMax) : hpMax,
        routThreshold: raw.routThreshold !== undefined ? requireInteger(raw.routThreshold, "Limiar de debandada", 0, hpMax) : Math.min(hpMax, defaults.routThreshold),
        consumption: raw.consumption !== undefined ? requireInteger(raw.consumption, "Consumo", 0, 100) : defaults.consumption,
        tactics: raw.tactics !== undefined ? boundedText(raw.tactics, "Táticas", 2000) : "",
        trainingCount: raw.trainingCount !== undefined ? requireInteger(raw.trainingCount, "Treinamentos", 0, 10000) : 0,
        gear: normalizeMilitaryGear(raw.gear)
    };
}
/** Rascunho válido para o editor; limites derivados da tabela não são campos persistidos. */
export function createMilitaryUnitDraft(unitId) {
    const { maxTactics: _maxTactics, standardDc: _standardDc, ...stats } = defaultArmyStats("infantry", 1);
    return normalizeMilitaryUnit({ id: unitId, name: "Nova unidade", headcount: 12, readiness: "ready", task: "", location: "", equipment: "", notes: "", condition: "", armyType: "infantry", level: 1, ...stats, tactics: "", trainingCount: 0 }, unitId);
}
export function militarySummary(state) {
    const links = Object.values(state.militaryUnits ?? {}).map(u => u.armyActorUuid).filter(Boolean);
    if (new Set(links).size !== links.length)
        throw new Error("Ficha militar vinculada a mais de uma unidade.");
    const units = Object.values(state.militaryUnits ?? {}), known = units.reduce((n, u) => n + (u.headcount ?? 0), 0);
    requireInteger(known, "Efetivo total", 0);
    return { count: units.length, known, complete: units.length > 0 && units.every(u => u.headcount !== null), label: !units.length ? "—" : units.some(u => u.headcount === null) ? `${known} + ?` : String(known) };
}
export function validateRealmAdmin(state) {
    if (state.creation.origin !== undefined)
        normalizeOrigin(state.creation.origin);
    if (state.creation.wizardSeenAt !== undefined && (typeof state.creation.wizardSeenAt !== "string" || !Number.isFinite(Date.parse(state.creation.wizardSeenAt))))
        throw new Error("Registro de criação inválido.");
    if (state.creation.governmentFeatId !== undefined && !state.feats?.[state.creation.governmentFeatId])
        throw new Error("Talento do Governo não encontrado.");
    if (state.demographics !== undefined) {
        if (!isRecord(state.demographics) || Object.keys(state.demographics).some(k => k !== "population"))
            throw new Error("Dados populacionais inválidos.");
        if (state.demographics.population !== null)
            requireInteger(state.demographics.population, "População", 0, 1000000000);
    }
    if (state.militaryUnits !== undefined) {
        if (!isRecord(state.militaryUnits) || Object.keys(state.militaryUnits).length > 500)
            throw new Error("Cadastro militar inválido.");
        for (const [id, unit] of Object.entries(state.militaryUnits))
            normalizeMilitaryUnit(unit, id);
    }
    if (state.deletedMilitaryUnits !== undefined) {
        if (!isRecord(state.deletedMilitaryUnits))
            throw new Error("Histórico de unidades inválido.");
        for (const [id, entry] of Object.entries(state.deletedMilitaryUnits)) {
            safeId(id);
            if (!isRecord(entry) || typeof entry.at !== "string" || !Number.isFinite(Date.parse(entry.at)))
                throw new Error("Registro de unidade excluída inválido.");
            boundedText(entry.name, "Nome da unidade", 120, true);
        }
    }
    const army = militarySummary(state), population = state.demographics?.population;
    if (typeof population === "number" && army.known > population)
        throw new Error("O efetivo cadastrado ultrapassa a população total, que inclui os soldados.");
    for (const d of [...Object.values(state.activityDefinitions), ...Object.values(state.projects)]) {
        if (d.outcome !== undefined)
            normalizeOutcome(d.outcome);
        if (d.completionEffectsActive !== undefined && typeof d.completionEffectsActive !== "boolean")
            throw new Error("Ativação dos benefícios inválida.");
    }
}
//# sourceMappingURL=realm-admin.js.map