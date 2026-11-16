import { escapeHTML } from "./core.js";
import { resolveTrainingTactic } from "./army.js";
import { EFFECT_TYPES } from "./management.js";
/** Apenas apresenta o Item original. Nunca aprende táticas nem grava cópias de suas descrições. */
export function bindTacticPreview(root, actor, services = {
    load: resolveTrainingTactic,
    enrich: (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { secrets: game.user.isGM, rollData: actor.getRollData?.(), relativeTo: actor })
}) {
    const focus = root.querySelector('[name="focus"]');
    const choice = root.querySelector('[name="tactic"]');
    const preview = root.querySelector("[data-tactic-preview]");
    const confirm = root.querySelector('[data-action="ok"]');
    const readOnly = root.dataset?.trainingReadOnly === "true";
    let generation = 0;
    const refresh = async () => {
        const current = ++generation, uuid = choice.value;
        for (const row of root.querySelectorAll("[data-train-row]"))
            row.hidden = row.dataset.trainRow !== focus.value;
        preview.replaceChildren();
        preview.removeAttribute("aria-busy");
        if (focus.value !== "tactic") {
            confirm.disabled = false;
            return;
        }
        confirm.disabled = !readOnly;
        preview.setAttribute("aria-busy", "true");
        preview.textContent = "Carregando tática…";
        try {
            const item = await services.load(actor, uuid);
            const html = typeof item.system.description?.value === "string" ? item.system.description.value : "";
            const description = html.trim() ? await services.enrich(html) : "<p>Esta tática não possui descrição.</p>";
            if (!root.isConnected || current !== generation || choice.value !== uuid || focus.value !== "tactic")
                return;
            const modifiers = (Array.isArray(item.system.rules) ? item.system.rules : []).filter((r) => r.key === "FlatModifier" && (typeof r.value === "number" || typeof r.value === "string")).map((r) => {
                const value = typeof r.value === "number" && r.value >= 0 ? `+${r.value}` : String(r.value);
                const label = typeof r.label === "string" ? (game.i18n?.localize(r.label) ?? r.label) : "Modificador";
                return `<li>${escapeHTML(label)}: <strong>${escapeHTML(value)}</strong>${r.type ? ` · ${escapeHTML(EFFECT_TYPES.find(t => t.id === r.type)?.label ?? String(r.type))}` : ""}</li>`;
            });
            preview.innerHTML = `<h3>${escapeHTML(item.name)}</h3><div class="twoc-tactic-description">${description}</div>${modifiers.length ? `<h4>Efeitos e modificadores</h4><ul>${modifiers.join("")}</ul>` : ""}`;
            confirm.disabled = false;
        }
        catch (error) {
            if (!root.isConnected || current !== generation)
                return;
            preview.textContent = error instanceof Error ? error.message : "Não foi possível consultar esta tática.";
        }
        finally {
            if (current === generation)
                preview.removeAttribute("aria-busy");
        }
    };
    focus.addEventListener("change", () => void refresh());
    choice.addEventListener("change", () => void refresh());
    return { ready: refresh(), refresh };
}
//# sourceMappingURL=tactic-preview.js.map