import { SKILLS, escapeHTML } from "./core.js";
import { getState } from "./adapter.js";
import { submitRealmCommand } from "./authority.js";
import { activeCatalogChoices, featUseAvailable, ownsFeat, pullDC, protectedRole } from "./feat-engine.js";
import { checkContributions, currentWeek } from "./management.js";
import { kingdomRoles } from "./roles.js";
import { resolveFeatCheck } from "./feat-chat.js";
import { rollKingdom } from "./native-roll.js";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const Base = HandlebarsApplicationMixin(ApplicationV2), panels = new Set();
const opt = (v, t) => `<option value="${escapeHTML(v)}">${escapeHTML(t)}</option>`;
const ask = (title, content, label = "Confirmar") => DialogV2.input({ classes: ["twoc", "twoc-role-dialog"], window: { title }, position: { width: 560 }, content: `<div class="twoc-definition-form">${content}</div>`, ok: { label }, rejectClose: false });
export class FeatTools extends Base {
    static DEFAULT_OPTIONS = { classes: ["twoc", "twoc-management", "twoc-feat-tools"], position: { width: 740, height: 720 }, window: { title: "Talentos em uso", resizable: true }, actions: { use: FeatTools.use, collect: FeatTools.collect, cancel: FeatTools.cancel } };
    static PARTS = { body: { template: "modules/weight-of-the-crown/templates/feat-tools.hbs", scrollable: [".twoc-management-list"] } };
    realm;
    constructor(realm) { super(); this.realm = realm; panels.add(this); }
    async _onClose() { panels.delete(this); }
    async _prepareContext() {
        const state = getState(this.realm.actor), week = currentWeek(state);
        const actions = { T01: "Alterar cargo protegido", T03: "Conter nova crise", T06: "Usar resultado fixo", T09: "Conter falha crítica", T13: "Pagar despesa extraordinária", T15: "Rerrolar teste" };
        const keys = { T03: "crush", T09: "pull", T11: "endure", T13: "liquidate", T15: "free_fair", T05: "insider", T17: "fame" };
        return { reservations: Object.values(state.featUses ?? {}).filter(u => u.reserved && (u.userId === game.user.id || game.user.isGM)), week, canEdit: this.realm.canEdit, records: activeCatalogChoices(state).map(f => {
                const key = f.key === "T06" ? `assurance_${f.choice.featSkillId}` : keys[f.key], available = !key || featUseAvailable(state, key);
                return { ...state.feats[f.id], key: f.key, skillId: f.choice.featSkillId, skillLabel: SKILLS.find(s => s.id === f.choice.featSkillId)?.label,
                    status: key ? (available ? "Disponível nesta semana" : "Usado / em resolução") : "Nos testes elegíveis", actionLabel: actions[f.key], canUse: !!actions[f.key] && this.realm.canEdit && available && (!["T01", "T03", "T13"].includes(f.key) || game.user.isGM),
                    note: f.key === "T09" ? `Próximo teste simples: CD ${pullDC(state)}` : f.key === "T11" ? "Escolha a penalidade antes de rolar pela ficha." : f.key === "T02" ? "Aid continua sendo rolado na ficha pessoal; informe seu resultado nas opções do teste." : f.key === "T01" ? `Cargo protegido: ${kingdomRoles(state).find(r => r.id === protectedRole(state))?.name ?? "A definir"}` : "" };
            }), income: Object.values(state.featIncome ?? {}).filter(i => i.paidWeek === null).map(i => ({ ...i, due: i.dueWeek <= week, label: i.dueWeek <= week ? "Disponível para receber, conforme espaço nas reservas" : `A receber na semana ${i.dueWeek}` })) };
    }
    static async cancel(_event, button) { try {
        await submitRealmCommand(this.realm.actor, { action: "talent.finish", token: button.dataset.token, commit: false });
        await this.render({ force: true });
    }
    catch (e) {
        ui.notifications.error(e instanceof Error ? e.message : String(e));
    } }
    static async collect() { try {
        await submitRealmCommand(this.realm.actor, { action: "talent.collect" });
        await this.render({ force: true });
    }
    catch (e) {
        ui.notifications.error(e instanceof Error ? e.message : String(e));
    } }
    static async use(_event, button) {
        if (!this.realm.canEdit)
            return;
        try {
            await useFeat(this.realm, button.dataset.key, button.dataset.skillId);
            await this.render({ force: true });
        }
        catch (e) {
            ui.notifications.error(e instanceof Error ? e.message : String(e));
        }
    }
}
Hooks.on("updateActor", (actor, change) => { if (!change.flags?.["weight-of-the-crown"]?.state)
    return; for (const p of panels)
    if (p.rendered && p.realm.actor.id === actor.id)
        void p.render(); });
Hooks.on("deleteActor", (actor) => { for (const p of panels)
    if (p.realm.actor.id === actor.id)
        void p.close(); });
async function recentChecks(app, critical) {
    const result = [];
    for (const message of [...game.messages.contents].reverse()) {
        const r = await resolveFeatCheck(message.id);
        if (!r || r.actorId !== app.actor.id || r.week !== currentWeek(getState(app.actor)) || r.resolved || !game.user.isGM && r.userId !== game.user.id || message.blind && !game.user.isGM)
            continue;
        if (critical ? r.outcome !== "criticalFailure" : !["failure", "criticalFailure"].includes(String(r.outcome)))
            continue;
        if (!critical && r.fortuneUsed)
            continue;
        const d = r.activityId ? getState(app.actor).activityDefinitions[r.activityId] : r.projectId ? getState(app.actor).projects[r.projectId] : null;
        if (!critical && !d?.featTags?.some(t => t === "leadership" || t === "fealty"))
            continue;
        result.push({ id: r.id, label: `${d?.name ?? SKILLS.find(s => s.id === r.skillId)?.label} · ${r.outcome === "criticalFailure" ? "falha crítica" : "falha"}` });
    }
    return result;
}
async function useFeat(app, key, skillId) {
    const state = getState(app.actor);
    if (key === "T06") {
        const targets = [...Object.values(state.activityDefinitions).map(d => ({ ...d, kind: "activity" })), ...Object.values(state.projects).map(d => ({ ...d, kind: "project" }))].filter(d => d.requiresCheck !== false && (d.skillId === skillId || d.skillId === "skill_engineering" && skillId === "skill_magic" && ownsFeat(state, "T08")) && d.quest?.status !== "completed");
        const answer = await ask("Garantia do reino", `<label>Teste<select name="target">${opt("", "Teste avulso")}${targets.map(d => opt(`${d.kind}:${d.id}`, d.name)).join("")}</select></label><label>CD do teste avulso (opcional)<input name="dc" type="number" min="1" step="1"></label><label>Visibilidade<select name="mode">${opt("publicroll", "Público")}${opt("gmroll", "Reservado ao Mestre")}${opt("blindroll", "Cego ao Mestre")}${opt("selfroll", "Só para mim")}</select></label>`, "Aplicar resultado fixo");
        if (!answer)
            return;
        const [kind, id] = String(answer.target ?? "").split(":"), target = targets.find(d => d.id === id && d.kind === kind);
        await submitRealmCommand(app.actor, { action: "talent.assurance", skillId, dc: target ? target.dc : String(answer.dc ?? "").trim() ? Number(answer.dc) : null, mode: String(answer.mode), ...(target ? { [kind === "activity" ? "activityId" : "projectId"]: id } : {}) });
    }
    else if (key === "T03") {
        if (!game.user.isGM)
            return;
        const pending = Object.values(state.checkEffects ?? {}).filter(e => e.internalCrisis && e.crisisState === "pending" && e.value < 0);
        if (!pending.length)
            throw new Error("Cadastre um efeito negativo de conflito interno aguardando resolução.");
        const answer = await ask("Reprimir dissidência", `<label>Nova consequência<select name="effect">${pending.map(e => opt(e.id, `${e.name} (${e.value})`)).join("")}</select></label><label>CD definida pelo Mestre<input name="dc" type="number" min="1" step="1" required></label>`, "Rolar Guerra");
        if (answer)
            await rollKingdom(app, "skill_warfare", undefined, "activity", { dc: Number(answer.dc), crisisEffectId: String(answer.effect) });
    }
    else if (key === "T09" || key === "T15") {
        const checks = await recentChecks(app, key === "T09");
        if (!checks.length)
            throw new Error("Não há teste elegível da semana atual aguardando resolução.");
        const answer = await ask(key === "T09" ? "União de esforços" : "Livre e justo", `<label>Teste<select name="message">${checks.map(c => opt(c.id, c.label)).join("")}</select></label>${key === "T09" ? `<p>Teste simples CD ${pullDC(state)}. O uso aumenta a CD para as próximas tentativas.</p>` : "<p>Pagar 1 Tesouro e aceitar a nova rolagem, mesmo que seja pior. O +2 deste talento será removido.</p>"}`, key === "T09" ? "Tentar conter desastre" : "Pagar e rerrolar");
        if (answer)
            await submitRealmCommand(app.actor, { action: key === "T09" ? "talent.pull" : "talent.reroll", messageId: String(answer.message) });
    }
    else if (key === "T13") {
        if (!game.user.isGM)
            return;
        const answer = await ask("Liquidar recursos", '<p>Somente a despesa extraordinária imposta por falha ou evento. O valor final terá desconto de 1 Tesouro, mínimo 0.</p><label>Despesa extraordinária<input name="amount" type="number" min="1" max="100000" step="1" required></label><label>Motivo<input name="reason" maxlength="500" required></label>', "Pagar com desconto");
        if (answer)
            await submitRealmCommand(app.actor, { action: "talent.liquidate", amount: Number(answer.amount), reason: String(answer.reason), confirmed: true });
    }
    else if (key === "T01") {
        if (!game.user.isGM)
            return;
        const quests = Object.values(state.activityDefinitions).filter(d => d.featTags?.includes("leadership") && d.quest?.status === "completed" && d.quest.completionWeek === currentWeek(state));
        if (!quests.length)
            throw new Error("Conclua uma atividade de reorganização de liderança na abertura desta semana.");
        const answer = await ask("Serviço público", `<label>Atividade concluída nesta abertura<select name="quest">${quests.map(d => opt(d.id, d.name)).join("")}</select></label><label>Novo cargo protegido<select name="role">${kingdomRoles(state).map(r => opt(r.id, r.name)).join("")}</select></label><label class="twoc-checkbox"><input name="opening" type="checkbox" required>Confirmo que esta reorganização pertence à abertura semanal.</label>`, "Alterar proteção");
        if (answer)
            await submitRealmCommand(app.actor, { action: "talent.protect", roleId: String(answer.role), leadershipId: String(answer.quest), openingConfirmed: !!answer.opening });
    }
}
export async function prepareFeatRoll(app, state, skillId, definitionId, kind = "activity") {
    const context = { skillId, ...(definitionId ? kind === "activity" ? { activityId: definitionId } : { projectId: definitionId } : {}) }, definition = definitionId ? (kind === "activity" ? state.activityDefinitions : state.projects)[definitionId] : undefined;
    const modifiers = checkContributions(state, await app.roleAvailability(state), context);
    const crises = ownsFeat(state, "T11") && featUseAvailable(state, "endure") ? modifiers.filter(m => m.source === "effect" && m.value < 0 && state.checkEffects?.[m.originId.slice(7)]?.internalCrisis) : [];
    const roles = kingdomRoles(state), availability = await app.roleAvailability(state), leaders = [...new Set(roles.map(r => r.actorUuid).filter((r) => !!r && availability[r] === true))];
    const helperIds = ownsFeat(state, "T02") && definition?.actorUuid && leaders.includes(definition.actorUuid) ? leaders.filter(r => r !== definition.actorUuid) : [];
    const helpers = await Promise.all(helperIds.map(async (uuid) => ({ uuid, name: (await app.resolveResponsible(uuid)).name })));
    const magic = skillId === "skill_engineering" && ownsFeat(state, "T08");
    if (!magic && !crises.length && !helpers.length)
        return { skillId, aid: [] };
    const answer = await ask("Opções do teste", `${magic ? '<label>Perícia<select name="magic"><option value="no">Engenharia</option><option value="yes">Magia — Magia prática</option></select></label>' : ""}${crises.length ? `<label>Resistir à anarquia<select name="crisis">${opt("", "Não usar nesta rolagem")}${crises.map(m => opt(m.originId, m.label)).join("")}</select></label>` : ""}${helpers.length ? `<fieldset><legend>Aid entre líderes</legend><p>Após rolar Aid na ficha pessoal, informe o bônus obtido. O talento ajusta apenas resultados positivos.</p>${helpers.map((h, i) => `<label>${escapeHTML(h.name)}<select name="aid_${i}">${opt("", "Não ajudou")}${[-1, 0, 1, 2, 3, 4].map(v => opt(String(v), v > 0 ? `+${v}` : String(v))).join("")}</select></label>`).join("")}</fieldset>` : ""}`, "Continuar para a rolagem");
    if (!answer)
        return null;
    const selectedSkill = answer.magic === "yes" ? "skill_magic" : skillId, aid = [];
    const aids = helpers.flatMap((_h, i) => String(answer[`aid_${i}`] ?? "") !== "" ? [Number(answer[`aid_${i}`])] : []).map(v => v > 0 ? v + 1 : v);
    if (aids.some(v => !Number.isSafeInteger(v) || v < -1 || v > 5))
        throw new Error("Bônus de Aid inválido.");
    const bonus = Math.max(0, ...aids), penalty = Math.min(0, ...aids);
    if (bonus)
        aid.push({ originId: "aid:leaders_bonus", label: "Aid entre líderes · Liderança cooperativa", value: bonus, type: "circumstance", source: "feat" });
    if (penalty)
        aid.push({ originId: "aid:leaders_penalty", label: "Aid · falha crítica", value: penalty, type: "circumstance", source: "feat" });
    let reservationToken;
    if (answer.crisis) {
        if (!checkContributions(state, availability, { ...context, skillId: selectedSkill }).some(m => m.originId === answer.crisis))
            throw new Error("Esta penalidade não afeta a perícia selecionada.");
        reservationToken = foundry.utils.randomID();
        await submitRealmCommand(app.actor, { action: "talent.reserve", key: "endure", effectId: String(answer.crisis).slice(7), token: reservationToken, expectedWeek: currentWeek(state) });
    }
    return { skillId: selectedSkill, aid, ...(answer.crisis ? { ignoreOrigin: String(answer.crisis) } : {}), ...(reservationToken ? { reservationToken } : {}) };
}
//# sourceMappingURL=feat-ui.js.map