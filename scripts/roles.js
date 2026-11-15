import { ABILITIES, SKILLS, isRecord, requireInteger } from "./core.js";
const preset = (id, name, value, abilityId) => ({
    id: `role_${id}`, name, description: "", standard: true,
    vacancy: { value, target: abilityId ? { kind: "ability", id: abilityId } : { kind: "all" } }, effects: []
});
/** Mapeamento aprovado pelo usuário. Apoio político permanece independente. */
export const STANDARD_ROLES = [
    preset("ruler", "Regente", -1), preset("counselor", "Conselheiro", -1, "ability_community"),
    preset("general", "General", -2, "ability_defense"), preset("emissary", "Emissário", -1, "ability_government"),
    preset("magister", "Magister", -1, "ability_knowledge"), preset("treasurer", "Tesoureiro", -1, "ability_economy"),
    preset("viceroy", "Vice-regente", -1, "ability_economy"), preset("warden", "Guardião", -1, "ability_community")
];
export function safeId(value) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value))
        throw new Error("Identificador inválido.");
}
export function validateActorUuid(value) {
    if (value !== null && (typeof value !== "string" || value.length > 512 || !/^(Actor\.[^.\s]+|Compendium\.[^.\s]+\.[^.\s]+(?:\.Actor)?\.[^.\s]+|Scene\.[^.\s]+\.Token\.[^.\s]+(?:\.Actor\.[^.\s]+)?)$/.test(value)))
        throw new Error("Vínculo de personagem inválido.");
}
function text(value, label, max, required = false) {
    if (typeof value !== "string" || value.length > max || (required && !value.trim()))
        throw new Error(`${label}: informe um texto${required ? " não vazio" : ""} de até ${max} caracteres.`);
    return required ? value.trim() : value;
}
export function validateTarget(value, state) {
    if (!isRecord(value))
        throw new Error("Escolha o alvo do modificador.");
    if (value.kind === "all" && Object.keys(value).length === 1)
        return { kind: "all" };
    if (Object.keys(value).some(k => !["kind", "id"].includes(k)))
        throw new Error("Alvo inválido.");
    if (value.kind === "ability" && ABILITIES.some(a => a.id === value.id))
        return { kind: "ability", id: value.id };
    if (value.kind === "skill" && SKILLS.some(s => s.id === value.id))
        return { kind: "skill", id: value.id };
    if (value.kind === "activity" || value.kind === "project") {
        safeId(value.id);
        if (state && !(value.kind === "activity" ? state.activityDefinitions : state.projects)[value.id])
            throw new Error("A Quest ou construção escolhida não existe mais.");
        return { kind: value.kind, id: value.id };
    }
    throw new Error("Alvo de modificador inválido.");
}
export function normalizeRole(raw, id, state) {
    safeId(id);
    if (!isRecord(raw) || Object.keys(raw).some(k => !["id", "name", "description", "standard", "vacancy", "effects", "actorUuid", "deleted"].includes(k)))
        throw new Error("Dados do cargo inválidos.");
    if (raw.id !== id)
        throw new Error("Identificador do cargo inconsistente.");
    const standard = STANDARD_ROLES.some(r => r.id === id);
    if (raw.standard !== standard || (raw.deleted !== undefined && typeof raw.deleted !== "boolean") || (standard && raw.deleted))
        throw new Error("Tipo de cargo inválido.");
    if (!isRecord(raw.vacancy) || Object.keys(raw.vacancy).some(k => !["value", "target"].includes(k)))
        throw new Error("Bônus/penalidade por vacância inválida.");
    const vacancy = { value: requireInteger(raw.vacancy.value, "Bônus/penalidade por vacância", -100, 100), target: validateTarget(raw.vacancy.target, state) };
    if (!Array.isArray(raw.effects) || raw.effects.length > 30)
        throw new Error("Use até 30 efeitos por cargo.");
    const ids = new Set();
    const effects = raw.effects.map((e) => {
        if (!isRecord(e) || Object.keys(e).some(k => !["id", "name", "description", "type", "value", "target", "condition"].includes(k)))
            throw new Error("Efeito de cargo inválido.");
        safeId(e.id);
        if (ids.has(e.id))
            throw new Error("Um efeito não pode aparecer duas vezes no mesmo cargo.");
        ids.add(e.id);
        if (e.type !== "role" || !["occupied", "responsible"].includes(String(e.condition)))
            throw new Error("Tipo ou condição de efeito inválidos.");
        return { id: e.id, name: text(e.name, "Nome do efeito", 120, true), description: text(e.description, "Descrição do efeito", 12000), type: "role", value: requireInteger(e.value, "Modificador", -100, 100), target: validateTarget(e.target, state), condition: e.condition };
    });
    if (raw.actorUuid !== undefined)
        validateActorUuid(raw.actorUuid);
    return { id, name: text(raw.name, "Nome do cargo", 120, true), description: text(raw.description, "Descrição", 12000), standard, vacancy, effects,
        ...(raw.actorUuid !== undefined ? { actorUuid: raw.actorUuid } : {}), ...(raw.deleted !== undefined ? { deleted: raw.deleted } : {}) };
}
/** Cargos padrão ausentes usam defaults, sem escrever nem migrar o documento durante leitura. */
export function kingdomRoles(state) {
    const stored = state.roles ?? {};
    if (!isRecord(stored))
        throw new Error("Coleção de cargos inválida.");
    const roles = new Map(STANDARD_ROLES.map(r => [r.id, structuredClone(r)]));
    for (const [id, data] of Object.entries(stored)) {
        safeId(id);
        if (!isRecord(data))
            throw new Error("Cargo inválido.");
        const role = normalizeRole({ ...roles.get(id), ...data }, id);
        roles.set(id, role);
    }
    return [...roles.values()].filter(r => !r.deleted);
}
export function targetLabel(target, state) {
    if (target.kind === "all")
        return "Todos os testes";
    if (target.kind === "ability")
        return `${ABILITIES.find(a => a.id === target.id)?.label ?? "Família indisponível"} · todas as perícias`;
    if (target.kind === "skill")
        return SKILLS.find(s => s.id === target.id)?.label ?? "Perícia indisponível";
    return (target.kind === "project" ? state.projects : state.activityDefinitions)[target.id]?.name ?? "Definição indisponível";
}
export function targetMatches(target, context) {
    return target.kind === "all" || target.kind === "skill" && target.id === context.skillId || target.kind === "ability" && SKILLS.find(s => s.id === context.skillId)?.abilityId === target.id || target.kind === "activity" && target.id === context.activityId || target.kind === "project" && target.id === context.projectId;
}
/** Cada origem entra uma vez; origens distintas somam conforme as regras do reino. */
export function roleModifiers(state, availability, context) {
    if (!SKILLS.some(s => s.id === context.skillId))
        throw new Error("Escolha uma perícia válida.");
    const modifiers = new Map();
    for (const role of kingdomRoles(state)) {
        // Permissão para ver o retrato não determina ocupação: o chamador resolve existência separadamente.
        const occupied = !!role.actorUuid && availability[role.actorUuid] === true;
        if (!occupied && role.vacancy.value && targetMatches(role.vacancy.target, context)) {
            const originId = `${role.id}:vacancy`;
            modifiers.set(originId, { originId, roleId: role.id, label: `${role.name} · cargo vago`, value: role.vacancy.value, source: "vacancy" });
        }
        if (occupied)
            for (const e of role.effects) {
                if (!e.value || !targetMatches(e.target, context) || e.condition === "responsible" && role.actorUuid !== context.responsibleActorUuid)
                    continue;
                const originId = `${role.id}:effect:${e.id}`;
                modifiers.set(originId, { originId, roleId: role.id, label: `${role.name} · ${e.name}`, value: e.value, source: "effect" });
            }
    }
    return [...modifiers.values()];
}
//# sourceMappingURL=roles.js.map