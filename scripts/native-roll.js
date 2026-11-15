import { prepareFeatRoll } from "./feat-ui.js";
import { currentWeek } from "./management.js";
import { catalogContributions, featUseAvailable, ownsFeat } from "./feat-engine.js";
import { MODULE_ID, SKILLS, checkModifier, escapeHTML, requireInteger } from "./core.js";
import { getState } from "./adapter.js";
import { submitRealmCommand } from "./authority.js";
import { checkContributions, bestBuilding } from "./management.js";
const managedContexts = new WeakMap();
const slug = (origin) => `twoc-${[...origin].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}`;
export async function rollKingdom(app, skillId, activityId, kind = "activity", override = {}) {
    const key = activityId ? `${kind}:${activityId}` : skillId;
    if (!app.canEdit || app.busyRolls.has(key))
        return;
    app.busyRolls.add(key);
    let reservationToken;
    let madeRoll = false;
    try {
        await Promise.all([...app.pendingSaves]);
        if (app.pendingFields.size)
            throw new Error("Salve ou corrija os campos antes de rolar.");
        const state = getState(app.actor);
        let skill = SKILLS.find(s => s.id === skillId);
        if (!skill)
            throw new Error("Perícia desconhecida.");
        const definition = activityId ? (kind === "activity" ? state.activityDefinitions : state.projects)[activityId] : null;
        if (activityId && !definition)
            throw new Error("Quest não encontrada.");
        if (definition?.requiresCheck === false)
            throw new Error("Esta definição não exige teste.");
        if (override.crisisEffectId && (!game.user.isGM || !ownsFeat(state, "T03")))
            throw new Error("Somente o Mestre com Reprimir dissidência prepara esta tentativa.");
        if (override.crisisEffectId && !featUseAvailable(state, "crush"))
            throw new Error("Reprimir dissidência já foi usado nesta semana.");
        if (override.dc !== undefined)
            requireInteger(override.dc, "CD", 1);
        const prepared = await prepareFeatRoll(app, state, skill.id, activityId, kind);
        if (!prepared)
            return;
        reservationToken = prepared.reservationToken;
        skill = SKILLS.find(s => s.id === prepared.skillId);
        const base = checkModifier(state, skill.id, definition?.suitability ?? 0);
        const contributions = checkContributions(state, await app.roleAvailability(state), { allBuildings: true, skillId: skill.id, ...(activityId ? kind === "activity" ? { activityId } : { projectId: activityId } : {}), responsibleActorUuid: definition?.actorUuid, ignoreOrigin: prepared.ignoreOrigin, additional: [...prepared.aid, ...(override.crisisEffectId ? [{ originId: "feat:origin_crush_dissent:catalog_crush", label: "Reprimir dissidência · conflito interno", value: 1, type: "status", source: "feat" }] : [])] });
        const candidates = catalogContributions(state, { skillId: skill.id, includeConditional: true }).filter(m => !contributions.some(c => c.originId === m.originId));
        const optional = new Set(candidates.map(m => m.originId));
        contributions.push(...candidates);
        const buildings = contributions.filter(c => c.source === "building" && c.value > 0);
        const initialBest = bestBuilding(buildings, contributions.filter(c => c.source !== "building" && !optional.has(c.originId)));
        let responsible = null;
        if (definition?.actorUuid)
            responsible = await app.resolveResponsible(definition.actorUuid);
        const api = game.pf2e;
        if (!api?.Check?.roll || !api.CheckModifier || !api.Modifier)
            throw new Error("A API de testes do Pathfinder 2e não está disponível.");
        const data = [
            { slug: slug("base:ability"), label: `${skill.label} · atributo`, modifier: base.ability, type: "untyped" },
            { slug: slug("base:proficiency"), label: "Proficiência do reino", modifier: base.proficiency, type: "untyped" },
            ...(definition ? [{ slug: slug("base:suitability"), label: "Adequação do responsável", modifier: base.suitability, type: "untyped" }] : []),
            ...contributions.map(m => ({ slug: slug(m.originId), label: m.label, modifier: m.value, type: m.type, ignored: optional.has(m.originId) || (m.source === "building" && m.value > 0 && m.originId !== initialBest?.originId) }))
        ];
        const check = new api.CheckModifier(slug(`${state.realmId}:${key}`), { modifiers: data.map(d => new api.Modifier(d)) });
        const context = {
            actor: app.actor, type: "skill-check", identifier: `twoc:${app.actor.id}:${key}`,
            title: `${escapeHTML(definition?.name ?? skill.label)} · ${escapeHTML(app.actor.name)}${responsible ? ` · ${escapeHTML(responsible.name)}` : ""}`,
            skipDialog: false, createMessage: true, options: new Set(["twoc:kingdom", `twoc:skill:${skill.id}`]),
            ...(definition || override.dc !== undefined ? { dc: { value: override.dc ?? definition?.dc, visible: true, label: "CD" } } : {})
        };
        managedContexts.set(context, { buildings, slugs: new Set(data.filter(d => !contributions.some(c => slug(c.originId) === d.slug && (c.source === "feat" || buildings.some(b => b.originId === c.originId)))).map(d => d.slug)), labels: new Map(contributions.map(c => [slug(c.originId), c.type === "untyped" ? (c.source === "feat" ? "Feat" : c.source === "role" ? "Cargo" : "Outro") : ({ status: "Estado", circumstance: "Circunstância", item: "Item" }[c.type] ?? c.type)])), fixedDC: !!definition && !game.user.isGM });
        try {
            await api.Check.roll(check, context, null, async (roll, outcome, message) => {
                madeRoll = true;
                if (reservationToken)
                    await submitRealmCommand(app.actor, { action: "talent.finish", token: reservationToken, commit: true });
                const die = roll.dice[0]?.results.find((r) => r.active && !r.discarded)?.result;
                const publicRoll = context.messageMode === "public";
                const privateToGM = context.messageMode === "blind" && !game.user.isGM;
                app.lastRoll = privateToGM ? `${definition?.name ?? skill.label}: teste enviado ao Mestre` : `${definition?.name ?? skill.label}: ${roll.total}${context.dc ? ` · CD ${context.dc.value}` : ""}`;
                const detail = publicRoll ? `${definition?.name ?? skill.label} · ${app.actor.name}: d20 ${die}, total ${roll.total}${context.dc ? `, CD ${context.dc.value}` : ""}${outcome ? ` (${outcome})` : ""}` : `${definition?.name ?? skill.label} · rolagem reservada`;
                // A própria API PF2e cria uma única mensagem; apenas acrescentar referências do reino.
                await message.update({ [`flags.${MODULE_ID}`]: { actorId: app.actor.id, realmId: state.realmId, skillId: skill.id, activityId: kind === "activity" ? activityId ?? null : null, projectId: kind === "project" ? activityId ?? null : null, responsibleActorUuid: responsible?.uuid ?? null, contributions,
                        rollOwnerId: game.user.id, rollData: { skillId: skill.id, week: currentWeek(state), outcome, dc: context.dc?.value ?? null, mode: context.messageMode ?? "public", fortuneUsed: context.rollTwice === "keep-higher" || !!context.isReroll, activityId: kind === "activity" ? activityId ?? null : null, projectId: kind === "project" ? activityId ?? null : null, runId: definition?.quest?.runId ?? null, crisisEffectId: override.crisisEffectId ?? null, title: definition?.name ?? skill.label,
                            modifiers: check.modifiers.map((m) => ({ slug: m.slug, label: m.label, modifier: m.modifier, type: m.type, ignored: !!m.ignored, originId: contributions.find(v => slug(v.originId) === m.slug)?.originId ?? null })) }
                    } });
                if (override.crisisEffectId)
                    await submitRealmCommand(app.actor, { action: "talent.crush", messageId: message.id, effectId: override.crisisEffectId });
                await submitRealmCommand(app.actor, { action: "roll.record", detail });
                app.status = "Rolagem registrada";
            });
        }
        finally {
            managedContexts.delete(context);
        }
    }
    catch (error) {
        console.error(`${MODULE_ID}:`, error);
        ui.notifications.error(error instanceof Error ? error.message : String(error));
    }
    finally {
        if (reservationToken && !madeRoll)
            await submitRealmCommand(app.actor, { action: "talent.finish", token: reservationToken, commit: false }).catch((e) => console.error(e));
        app.busyRolls.delete(key);
        if (!app.closing)
            await app.render({ force: true });
    }
}
/** Extensão do diálogo nativo pelo hook público. Não substitui a classe nem seus cálculos. */
Hooks.on("renderCheckModifiersDialog", (dialog, html) => {
    const managed = managedContexts.get(dialog.context);
    if (!managed)
        return;
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root)
        return;
    const positives = new Set(managed.buildings.map(b => slug(b.originId)));
    const others = dialog.check.modifiers.filter((m) => !positives.has(m.slug) && !m.ignored).map((m) => ({ originId: m.slug, label: m.label, value: m.modifier, type: m.type, source: "effect" }));
    const chosen = bestBuilding(managed.buildings, others)?.originId;
    let changed = false;
    for (const m of dialog.check.modifiers)
        if (positives.has(m.slug)) {
            const ignored = m.slug !== slug(chosen ?? "");
            if (m.ignored !== ignored) {
                m.ignored = ignored;
                changed = true;
            }
        }
    if (changed) {
        dialog.check.calculateTotal();
        void dialog.render();
        return;
    }
    root.classList.add("twoc-pf2e-check");
    for (const checkbox of root.querySelectorAll("[data-modifier-index]")) {
        const modifier = dialog.check.modifiers[Number(checkbox.dataset.modifierIndex)];
        if (positives.has(modifier?.slug)) {
            checkbox.disabled = true;
            checkbox.title = "A melhor contribuição positiva de construção é recalculada conforme os modificadores ativos.";
        }
        const label = managed.labels.get(modifier?.slug), tag = checkbox.closest(".dialog-row")?.querySelector(".type .tag");
        if (label && tag)
            tag.textContent = label;
    }
    if (!game.user.isGM) {
        for (const checkbox of root.querySelectorAll("[data-modifier-index]"))
            if (managed.slugs.has(dialog.check.modifiers[Number(checkbox.dataset.modifierIndex)]?.slug)) {
                checkbox.disabled = true;
                checkbox.title = "Administrado pelo reino";
            }
        for (const option of root.querySelectorAll(".add-modifier-type option"))
            if (!["untyped", "circumstance", "status", "item"].includes(option.value))
                option.remove();
    }
    const form = root.matches("form") ? root : root.querySelector("form");
    if (!form)
        return;
    const row = document.createElement("label");
    row.className = "twoc-native-dc";
    row.textContent = "CD ";
    const input = document.createElement("input");
    input.type = "number";
    input.name = "twocDC";
    input.min = "1";
    input.step = "1";
    input.placeholder = "Opcional";
    input.value = String(dialog.context.dc?.value ?? "");
    input.readOnly = managed.fixedDC;
    input.setAttribute("aria-label", "CD do teste do reino");
    row.append(input);
    form.prepend(row);
    const updateDC = () => {
        if (!input.value.trim()) {
            if (managed.fixedDC)
                throw new Error("A CD desta Quest foi definida pelo Mestre.");
            delete dialog.context.dc;
            return;
        }
        const value = requireInteger(Number(input.value), "CD", 1);
        if (managed.fixedDC && value !== dialog.context.dc?.value)
            throw new Error("A CD desta Quest foi definida pelo Mestre.");
        dialog.context.dc = { value, visible: true, label: "CD" };
    };
    input.addEventListener("change", () => { try {
        updateDC();
        input.setCustomValidity("");
    }
    catch (e) {
        input.setCustomValidity(e instanceof Error ? e.message : "CD inválida");
    } });
    form.addEventListener("submit", event => {
        try {
            updateDC();
            for (const m of dialog.check.modifiers)
                requireInteger(m.modifier, "Modificador");
            if (!game.user.isGM && dialog.check.modifiers.some((m) => managed.slugs.has(m.slug) && m.ignored))
                throw new Error("Os modificadores administrados pelo reino devem permanecer ativos.");
        }
        catch (e) {
            event.preventDefault();
            event.stopImmediatePropagation();
            ui.notifications.error(e instanceof Error ? e.message : String(e));
        }
    }, { capture: true });
    root.querySelector(".add-modifier")?.addEventListener("click", event => {
        try {
            const value = root.querySelector(".add-modifier-value")?.value;
            requireInteger(value?.trim() ? Number(value) : 1, "Modificador situacional", -100, 100);
            const name = root.querySelector(".add-modifier-name")?.value ?? "";
            if (managed.slugs.has(new game.pf2e.Modifier(name || "Situacional", 1, "untyped").slug))
                throw new Error("Use outro nome para o modificador situacional.");
        }
        catch (e) {
            event.preventDefault();
            event.stopImmediatePropagation();
            ui.notifications.error(e instanceof Error ? e.message : String(e));
        }
    }, { capture: true });
    requestAnimationFrame(() => {
        if (!dialog.rendered || !form.isConnected)
            return;
        const height = Math.min(window.innerHeight - 50, form.scrollHeight + (root.querySelector(".window-header")?.offsetHeight ?? 30) + 32);
        dialog.setPosition({ height, top: Math.max(20, Math.min(dialog.position.top, window.innerHeight - height - 20)) });
    });
});
//# sourceMappingURL=native-roll.js.map