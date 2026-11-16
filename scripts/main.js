import { resolveArmy, armyView } from "./army.js";
import { CATALOG_VERSION } from "./feat-catalog.js";
import { MODULE_ID, SKILLS, ABILITIES, createRealmState, escapeHTML, kingdomHeroPoints } from "./core.js";
import { getState } from "./adapter.js";
import { realmView } from "./view.js";
import { kingdomRoles } from "./roles.js";
import { submitRealmCommand } from "./authority.js";
import { managementAction } from "./management-ui.js";
import { rollKingdom } from "./native-roll.js";
import { DefinitionEditor, maybeCreationWizard, expansionAction } from "./realm-ui.js";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const HbsApplication = HandlebarsApplicationMixin(ApplicationV2);
const windows = new Map();
const launchers = new Set();
const id = () => foundry.utils.randomID();
const notifyError = (error) => { console.error(`${MODULE_ID}:`, error); ui.notifications.error(error instanceof Error ? error.message : String(error)); };
const realmActors = () => game.actors.filter((a) => a.type === "party" && a.getFlag(MODULE_ID, "state") && (game.user.isGM || a.testUserPermission(game.user, 2)));
export class RealmApplication extends HbsApplication {
    static DEFAULT_OPTIONS = {
        classes: ["twoc", "twoc-realm"],
        position: { width: 1120, height: 840 }, window: { title: "The Weight of the Crown", resizable: true },
        actions: {
            section: RealmApplication.section, retryOperation: RealmApplication.retryOperation, heroPoint: RealmApplication.heroPoint,
            exportRealm: RealmApplication.exportRealm,
            importRealm: RealmApplication.importRealm,
            ownership: RealmApplication.ownership,
            createActivity: RealmApplication.createActivity,
            createProject: RealmApplication.createProject,
            editDefinition: RealmApplication.editDefinition,
            rollActivity: RealmApplication.rollActivity,
            rollSkill: RealmApplication.rollSkill, manage: RealmApplication.manage,
            expansion: RealmApplication.expansion,
            exportPrivate: RealmApplication.exportPrivate,
            importPrivate: RealmApplication.importPrivate,
            openActor: RealmApplication.openActor, removeActor: RealmApplication.removeActor, chooseActor: RealmApplication.chooseActor,
            createRole: RealmApplication.createRole, editRole: RealmApplication.editRole, deleteRole: RealmApplication.deleteRole,
            addRoleEffect: RealmApplication.addRoleEffect, editRoleEffect: RealmApplication.editRoleEffect, deleteRoleEffect: RealmApplication.deleteRoleEffect
        }
    };
    static PARTS = { body: { template: "modules/weight-of-the-crown/templates/realm.hbs", scrollable: [".twoc-content"] } };
    actor;
    activeSection = "realm";
    pendingFields = new Map();
    pendingSaves = new Set();
    busyRolls = new Set();
    heroPointsPending = false;
    lastRoll = "";
    status = "";
    closing = false;
    privateDocument = null;
    privatePage = null;
    changeListener = null;
    dragOverListener = null;
    dragLeaveListener = null;
    dropListener = null;
    focusedField = null;
    expandedRoleDetails = new Set();
    expandedDefinitions = new Set();
    constructor(actor) { super({ id: `twoc-realm-${actor.id}` }); this.actor = actor; }
    static async retryOperation(_event, button) {
        button.disabled = true;
        try {
            await submitRealmCommand(this.actor, { action: "operation.retry", taskId: button.dataset.taskId });
            this.status = "Operação finalizada";
        }
        catch (e) {
            notifyError(e);
        }
        finally {
            if (!this.closing)
                await this.render();
        }
    }
    get title() { return `${this.actor.name} · The Weight of the Crown`; }
    get canAssignQuests() { return game.user.isGM || this.actor.testUserPermission(game.user, 2); }
    get canEdit() { return game.user.isGM || this.actor.testUserPermission(game.user, 3); }
    static async heroPoint(_event, button) {
        if (!game.user.isGM || this.heroPointsPending)
            return;
        const delta = Number(button.dataset.delta);
        if (delta !== 1 && delta !== -1)
            return;
        this.heroPointsPending = true;
        this.element.querySelectorAll('[data-action="heroPoint"]').forEach(b => b.disabled = true);
        const task = (async () => {
            await submitRealmCommand(this.actor, { action: "heroPoints.adjust", delta, expectedValue: kingdomHeroPoints(getState(this.actor)) });
            this.status = "Salvo";
        })();
        this.pendingSaves.add(task);
        try {
            await task;
        }
        catch (error) {
            notifyError(error);
        }
        finally {
            this.pendingSaves.delete(task);
            this.heroPointsPending = false;
            if (!this.closing)
                await this.render({ force: true });
        }
    }
    async _prepareContext() {
        try {
            if (!game.user.isGM && !this.actor.testUserPermission(game.user, 2))
                throw new Error("Você não tem acesso a este reino.");
            const state = getState(this.actor);
            const completedUuids = [...Object.values(state.activityDefinitions), ...Object.values(state.projects)].map(d => d.quest?.responsibleActorUuid).concat(Object.values(state.definitionRuns ?? {}).map((r) => r?.progress?.responsibleActorUuid)).filter((u) => typeof u === "string" && !!u);
            const historyUuids = Object.values(state.operations).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30).filter(o => o.path?.endsWith(".actorUuid") || o.path?.endsWith(".commanderUuid")).flatMap(o => [o.before, o.after]).filter((u) => typeof u === "string" && !!u);
            const uuids = [...new Set([...Object.values(state.activityDefinitions), ...Object.values(state.projects), ...kingdomRoles(state), ...Object.values(state.militaryUnits ?? {}).map(u => ({ actorUuid: u.commanderUuid }))].map(d => d.actorUuid).filter((u) => !!u).concat(historyUuids, completedUuids))];
            const actors = {};
            await Promise.all(uuids.map(async (uuid) => {
                try {
                    const actor = await this.resolveResponsible(uuid);
                    actors[uuid] = { actorUuid: uuid, actorName: actor.name, actorImg: actor.img || actor.prototypeToken?.texture?.src || "icons/svg/mystery-man.svg", actorMissing: false, canOpenActor: true };
                }
                catch {
                    actors[uuid] = { actorUuid: uuid, actorName: "Personagem indisponível", actorImg: "", actorMissing: true, canOpenActor: false };
                }
            }));
            const users = Object.fromEntries(game.users.map((u) => [u.id, u.name]));
            const availability = await this.roleAvailability(state);
            const armies = {};
            await Promise.all((this.activeSection === "military" ? Object.values(state.militaryUnits ?? {}) : []).map(async (u) => { try {
                armies[u.id] = armyView(await resolveArmy(this.actor, u));
            }
            catch {
                armies[u.id] = { armyMissing: true, armyActorUuid: u.armyActorUuid ?? null, ac: "—", hpCurrent: "—", hpMax: "—", routThreshold: "—", scouting: null, maneuver: null, morale: null, meleeAttack: null, rangedAttack: null, tactics: "" };
            } }));
            const context = realmView(state, this.canEdit, game.user.isGM, { actors, users, availability, armies, canAssignQuests: this.canAssignQuests, ownedActorUuids: game.actors.filter((a) => ["character", "npc"].includes(a.type) && a.testUserPermission(game.user, 3)).map((a) => a.uuid) });
            // Não resolver nem criar documentos ou diálogos durante _prepareContext.
            if (game.user.isGM && this.activeSection === "private") {
                this.privateDocument ??= this.findPrivateDocument();
                this.privatePage = this.privateDocument?.pages?.find((p) => p.getFlag(MODULE_ID, "notesPage")) ?? null;
            }
            return { ...context, heroPointsBusy: this.heroPointsPending, pendingTasks: Object.values(state.pendingTasks ?? {}).filter(t => game.user.isGM || t.userId === game.user.id).map(t => ({ id: t.id, label: t.kind === "publication" ? "Publicação de talento" : "Exclusão da ficha militar" })), name: this.actor.name, actorId: this.actor.id, status: this.status, lastRoll: this.lastRoll,
                sectionRealm: this.activeSection === "realm", sectionDefinitions: this.activeSection === "definitions",
                sectionHistory: this.activeSection === "history", sectionRoles: this.activeSection === "roles", sectionProgression: this.activeSection === "progression", sectionMilitary: this.activeSection === "military", sectionPrivate: game.user.isGM && this.activeSection === "private",
                gmNotes: game.user.isGM && this.activeSection === "private" ? this.notesText(this.privatePage?.text?.content ?? "") : ""
            };
        }
        catch (error) {
            return { invalid: true, error: error instanceof Error ? error.message : String(error), name: this.actor.name };
        }
    }
    async _preRender(context, options) {
        if (this.element?.querySelector("[data-definition-details]"))
            this.expandedDefinitions = new Set([...this.element.querySelectorAll("[data-definition-details][open]")].map((e) => e.dataset.definitionDetails));
        if (this.element?.querySelector(".twoc-roles-panel"))
            this.expandedRoleDetails = new Set([...this.element.querySelectorAll("[data-role-details][open]")].map((e) => e.dataset.roleDetails));
        const active = this.element?.ownerDocument.activeElement;
        this.focusedField = active?.dataset?.field && this.element.contains(active) ? { path: active.dataset.field, start: active.selectionStart, end: active.selectionEnd } : null;
        await super._preRender(context, options);
    }
    async _onRender() {
        for (const details of this.element.querySelectorAll("[data-definition-details]"))
            details.open = this.expandedDefinitions.has(details.dataset.definitionDetails);
        for (const details of this.element.querySelectorAll("[data-role-details]"))
            details.open = this.expandedRoleDetails.has(details.dataset.roleDetails);
        if (this.changeListener)
            this.element.removeEventListener("change", this.changeListener);
        this.changeListener = (event) => { void this.changeField(event); };
        this.element.addEventListener("change", this.changeListener);
        for (const input of this.element.querySelectorAll("[data-field]")) {
            const pending = this.pendingFields.get(input.dataset.field);
            if (pending !== undefined)
                input.value = pending;
            input.addEventListener("input", () => this.pendingFields.set(input.dataset.field, input.value));
            const focused = this.focusedField;
            if (focused && focused.path === input.dataset.field) {
                input.focus({ preventScroll: true });
                if (focused.start !== null && focused.end !== null && input instanceof HTMLTextAreaElement)
                    input.setSelectionRange(focused.start, focused.end);
            }
        }
        if (this.dragOverListener)
            this.element.removeEventListener("dragover", this.dragOverListener);
        if (this.dragLeaveListener)
            this.element.removeEventListener("dragleave", this.dragLeaveListener);
        if (this.dropListener)
            this.element.removeEventListener("drop", this.dropListener);
        this.dragOverListener = (event) => {
            const slot = event.target?.closest("[data-drop-definition], [data-drop-army]");
            if (!slot || !(slot.dataset.dropKind === "activity" ? this.canAssignQuests : this.canEdit) || (slot.dataset.dropKind === "military" || slot.hasAttribute("data-drop-army")) && !game.user.isGM)
                return;
            event.preventDefault();
            slot.classList.add("is-dragover");
            if (event.dataTransfer)
                event.dataTransfer.dropEffect = "link";
        };
        this.dragLeaveListener = (event) => event.target?.closest("[data-drop-definition], [data-drop-army]")?.classList.remove("is-dragover");
        this.dropListener = (event) => {
            const slot = event.target?.closest("[data-drop-definition], [data-drop-army]");
            if (!slot)
                return;
            event.preventDefault();
            event.stopPropagation();
            slot.classList.remove("is-dragover");
            if (!(slot.dataset.dropKind === "activity" ? this.canAssignQuests : this.canEdit))
                return;
            void this.dropActor(event, slot).catch(notifyError);
        };
        this.element.addEventListener("dragover", this.dragOverListener);
        this.element.addEventListener("dragleave", this.dragLeaveListener);
        this.element.addEventListener("drop", this.dropListener);
    }
    async resolveResponsible(uuid) {
        const document = await fromUuid(uuid);
        const actor = document?.documentName === "Actor" ? document : document?.actor;
        if (!actor || !["character", "npc"].includes(actor.type))
            throw new Error("Selecione um personagem ou NPC.");
        if (!game.user.isGM && !actor.testUserPermission(game.user, 2))
            throw new Error("Você não tem acesso a esse personagem.");
        return actor;
    }
    async bindResponsible(kind, definitionId, uuid) {
        if (!definitionId || (kind !== "activity" && kind !== "project" && kind !== "role" && kind !== "military"))
            throw new Error("Selecione uma Quest, construção, cargo ou unidade.");
        if (!(kind === "activity" ? this.canAssignQuests : this.canEdit))
            throw new Error("Você não tem permissão para editar este reino.");
        if (kind === "military" && !game.user.isGM)
            throw new Error("Somente o Mestre escolhe o capitão.");
        const state = getState(this.actor);
        let currentUuid;
        let label = "";
        if (kind === "role") {
            const role = kingdomRoles(state).find(r => r.id === definitionId);
            if (!role)
                throw new Error("Cargo não encontrado.");
            currentUuid = role.actorUuid;
            label = role.name;
        }
        else if (kind === "military") {
            const unit = state.militaryUnits?.[definitionId];
            if (!unit)
                throw new Error("Unidade não encontrada.");
            currentUuid = unit.commanderUuid;
            label = unit.name;
        }
        else {
            const def = (kind === "activity" ? state.activityDefinitions : state.projects)[definitionId];
            if (!def)
                throw new Error("Atividade não encontrada.");
            currentUuid = def.actorUuid;
            label = def.name;
        }
        if (uuid && currentUuid && currentUuid !== uuid) {
            const yes = await DialogV2.confirm({ window: { title: "Substituir responsável" }, content: `<p>Substituir o responsável por <strong>${escapeHTML(label)}</strong>?</p>`, rejectClose: false });
            if (!yes)
                return;
        }
        const task = (async () => {
            if (uuid)
                await this.resolveResponsible(uuid);
            if (kind === "role")
                await submitRealmCommand(this.actor, { action: "role.bind", roleId: definitionId, actorUuid: uuid });
            else if (kind === "military")
                await submitRealmCommand(this.actor, { action: "military.bind", unitId: definitionId, actorUuid: uuid });
            else
                await submitRealmCommand(this.actor, { action: "binding.save", kind, definitionId, actorUuid: uuid });
            this.status = "Salvo";
        })();
        this.pendingSaves.add(task);
        try {
            await task;
        }
        finally {
            this.pendingSaves.delete(task);
        }
        if (!this.closing)
            await this.render({ force: true });
    }
    async dropActor(event, slot) {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if (data.type !== "Actor")
            throw new Error("Arraste um personagem ou NPC da lista de Atores.");
        const actor = await Actor.fromDropData(data);
        if (!actor?.uuid)
            throw new Error("Personagem não encontrado.");
        if (slot.hasAttribute("data-drop-army")) {
            if (!game.user.isGM || actor.type !== "army")
                throw new Error("Arraste uma ficha militar existente.");
            if (await DialogV2.confirm({ window: { title: "Vincular tropa ao reino" }, content: `<p>Vincular <strong>${escapeHTML(actor.name)}</strong> a este reino? A ficha e sua pasta serão preservadas. Informe depois o número de Soldados.</p>`, rejectClose: false }))
                await submitRealmCommand(this.actor, { action: "military.attach", actorUuid: actor.uuid, confirmed: true });
            await this.render({ force: true });
            return;
        }
        await this.bindResponsible(slot.dataset.dropKind, slot.dataset.dropDefinition, actor.uuid);
    }
    static async chooseActor(_event, button) {
        if (!(button.dataset.kind === "activity" ? this.canAssignQuests : this.canEdit))
            return;
        try {
            const actors = game.actors.filter((a) => ["character", "npc"].includes(a.type) && (game.user.isGM || a.testUserPermission(game.user, button.dataset.kind === "activity" ? 3 : 2))).sort((a, b) => a.name.localeCompare(b.name));
            if (!actors.length) {
                ui.notifications.info("Nenhum personagem ou NPC disponível.");
                return;
            }
            const options = actors.map((a) => `<option value="${escapeHTML(a.uuid)}">${escapeHTML(a.name)}</option>`).join("");
            const answer = await DialogV2.input({ window: { title: "Escolher responsável" }, content: `<label>Personagem<select name="actorUuid">${options}</select></label>`, ok: { label: "Vincular" }, rejectClose: false });
            if (answer)
                await this.bindResponsible(button.dataset.kind, button.dataset.id, String(answer.actorUuid));
        }
        catch (error) {
            notifyError(error);
        }
    }
    static async openActor(_event, button) {
        try {
            const state = getState(this.actor), collection = button.dataset.kind === "military" ? Object.fromEntries(Object.values(state.militaryUnits ?? {}).map(u => [u.id, { actorUuid: u.commanderUuid }])) : button.dataset.kind === "role" ? Object.fromEntries(kingdomRoles(state).map(r => [r.id, r])) : button.dataset.kind === "project" ? state.projects : state.activityDefinitions;
            const uuid = button.dataset.actorUuid ?? collection[button.dataset.id ?? ""]?.actorUuid;
            if (uuid)
                (await this.resolveResponsible(uuid)).sheet.render(true);
        }
        catch (error) {
            notifyError(error);
        }
    }
    static async removeActor(_event, button) {
        try {
            await this.bindResponsible(button.dataset.kind, button.dataset.id, null);
        }
        catch (error) {
            notifyError(error);
        }
    }
    async changeField(event) {
        const input = event.target;
        if (input?.dataset?.command === "season") {
            try {
                await submitRealmCommand(this.actor, { action: "season", season: input.value });
                await this.render({ force: true });
            }
            catch (error) {
                notifyError(error);
                await this.render({ force: true });
            }
            return;
        }
        const path = input?.dataset?.field;
        if (!path || !this.canEdit)
            return;
        await this.persistField(path, input.value);
    }
    async persistField(path, raw, refresh = true) {
        if (!this.canEdit)
            return;
        const task = (async () => {
            try {
                if (path === "gmNotes") {
                    if (!game.user.isGM)
                        throw new Error("Notas privadas são do Mestre.");
                    const journal = await this.getPrivateDocument();
                    if (!journal || !journal.testUserPermission(game.user, 3))
                        throw new Error("Não foi possível acessar o diário privado.");
                    const page = await this.getPrivatePage(journal);
                    await page.update({ "text.content": `<p>${escapeHTML(raw).replace(/\n/g, "<br>")}</p>` });
                }
                else
                    await submitRealmCommand(this.actor, { action: "field", path, value: raw });
                this.pendingFields.delete(path);
                this.status = "Salvo";
            }
            catch (error) {
                this.status = "Não salvo — confira o campo";
                notifyError(error);
            }
        })();
        this.pendingSaves.add(task);
        try {
            await task;
        }
        finally {
            this.pendingSaves.delete(task);
        }
        if (refresh && !this.closing)
            await this.render({ force: true });
    }
    async _preClose() {
        this.closing = true;
        try {
            await Promise.all([...this.pendingSaves]);
            // O fechamento já detém o semáforo de renderização do Foundry: não renderizar aqui.
            for (const [path, raw] of [...this.pendingFields])
                await this.persistField(path, raw, false);
            if (this.pendingFields.size)
                throw new Error("Há campos não salvos. Corrija-os antes de fechar a ficha.");
        }
        catch (error) {
            this.closing = false;
            throw error;
        }
    }
    async _onClose() { windows.delete(this.actor.id); }
    static async section(_event, button) {
        const section = button.dataset.section;
        if (!section || !["realm", "definitions", "roles", "progression", "military", "history", "private"].includes(section) || (section === "private" && !game.user.isGM))
            return;
        this.activeSection = section;
        if (section === "private" && game.user.isGM) {
            this.privateDocument = await this.getPrivateDocument();
            this.privatePage = this.privateDocument ? await this.getPrivatePage(this.privateDocument) : null;
        }
        await this.render({ force: true });
    }
    closeMenu() { for (const menu of this.element.querySelectorAll("details.twoc-sheet-menu"))
        menu.removeAttribute("open"); }
    static exportRealm() { this.closeMenu(); this.actor.exportToJSON(); }
    static async importRealm() {
        if (!game.user.isGM)
            return;
        this.closeMenu();
        await this.actor.importFromJSONDialog();
        await this.render({ force: true });
    }
    static ownership() {
        if (!game.user.isGM)
            return;
        this.closeMenu();
        new foundry.applications.apps.DocumentOwnershipConfig({ document: this.actor }).render({ force: true });
    }
    static async createActivity() { await this.edit("activity"); }
    static async createProject() { await this.edit("project"); }
    static async editDefinition(_event, button) {
        if (button.dataset.kind === "activity" || button.dataset.kind === "project")
            await this.edit(button.dataset.kind, button.dataset.id);
    }
    async edit(kind, definitionId) {
        if (game.user.isGM)
            new DefinitionEditor(this, kind, definitionId).render({ force: true });
    }
    static async expansion(_event, button) { this.closeMenu(); await expansionAction(this, button); }
    static async rollActivity(_event, button) {
        const definitionId = button.dataset.id;
        const kind = button.dataset.kind === "project" ? "project" : "activity";
        const state = getState(this.actor), definition = (kind === "activity" ? state.activityDefinitions : state.projects)[definitionId ?? ""];
        if (definition?.skillId && definition.requiresCheck !== false)
            await rollKingdom(this, definition.skillId, definitionId, kind);
    }
    static async rollSkill(_event, button) { await rollKingdom(this, button.dataset.id ?? ""); }
    static async manage(_event, button) { this.closeMenu(); await managementAction(this, button.dataset.op, button); }
    async roleAvailability(state) {
        const refs = [...new Set(kingdomRoles(state).map(r => r.actorUuid).filter((u) => !!u))];
        const availability = {};
        await Promise.all(refs.map(async (ref) => {
            try {
                const doc = await fromUuid(ref);
                availability[ref] = doc?.documentName === "Actor" && ["character", "npc"].includes(doc.type);
            }
            catch {
                availability[ref] = false;
            }
        }));
        return availability;
    }
    targetOptions(target, includeCapacity = false) {
        const key = target.kind === "all" || target.kind === "reserveCapacity" ? target.kind : `${target.kind}:${target.id}`;
        const option = (value, label) => `<option value="${escapeHTML(value)}"${value === key ? " selected" : ""}>${escapeHTML(label)}</option>`;
        return (includeCapacity ? option("reserveCapacity", "Limite de reservas") : "") + option("all", "Todos os testes") + `<optgroup label="Família de perícias">${ABILITIES.map(a => option(`ability:${a.id}`, a.label)).join("")}</optgroup><optgroup label="Perícia específica">${SKILLS.map(s => option(`skill:${s.id}`, s.label)).join("")}</optgroup><optgroup label="Quest específica">${Object.values(getState(this.actor).activityDefinitions).map(a => option(`activity:${a.id}`, a.name)).join("")}</optgroup><optgroup label="Construção específica">${Object.values(getState(this.actor).projects).map(a => option(`project:${a.id}`, a.name)).join("")}</optgroup>`;
    }
    parseTarget(raw, includeCapacity = false) {
        const value = String(raw);
        if (includeCapacity && value === "reserveCapacity")
            return { kind: "reserveCapacity" };
        if (value === "all")
            return { kind: "all" };
        const [kind, targetId] = value.split(":");
        if (!["ability", "skill", "activity", "project"].includes(kind ?? "") || !targetId)
            throw new Error("Escolha um alvo válido.");
        return { kind: kind, id: targetId };
    }
    async commitRole(role) {
        const task = submitRealmCommand(this.actor, { action: "role.save", roleId: role.id, role });
        this.pendingSaves.add(task);
        try {
            await task;
            this.status = "Cargo salvo";
        }
        finally {
            this.pendingSaves.delete(task);
        }
        if (!this.closing)
            await this.render({ force: true });
    }
    static async createRole() { await this.editKingdomRole(); }
    static async editRole(_event, button) { await this.editKingdomRole(button.dataset.id); }
    async editKingdomRole(roleId) {
        if (!game.user.isGM)
            return;
        try {
            const role = roleId ? kingdomRoles(getState(this.actor)).find(r => r.id === roleId) : { id: `custom_${id()}`, name: "", description: "", standard: false, vacancy: { value: 0, target: { kind: "all" } }, effects: [] };
            if (!role)
                throw new Error("Cargo não encontrado.");
            const answer = await DialogV2.input({ classes: ["twoc", "twoc-role-dialog"], position: { width: 500 }, window: { title: roleId ? `Editar ${role.name}` : "Novo cargo" }, content: `<div class="twoc-definition-form"><label>Nome<input name="name" maxlength="120" value="${escapeHTML(role.name)}" required></label><label>Descrição<textarea name="description" maxlength="12000" rows="3">${escapeHTML(role.description)}</textarea></label><div class="form-group"><label>Bônus/penalidade por vacância<input name="vacancyValue" type="number" min="-100" max="100" step="1" value="${role.vacancy.value}" required></label></div><label>Testes afetados<select name="vacancyTarget">${this.targetOptions(role.vacancy.target)}</select></label></div>`, ok: { label: "Salvar cargo" }, rejectClose: false });
            if (!answer)
                return;
            const current = roleId ? kingdomRoles(getState(this.actor)).find(r => r.id === roleId) : role;
            if (!current)
                throw new Error("Este cargo foi excluído por outro usuário.");
            if (String(answer.vacancyValue).trim() === "")
                throw new Error("Informe o bônus ou penalidade; use 0 para nenhum modificador.");
            await this.commitRole({ ...current, name: String(answer.name ?? ""), description: String(answer.description ?? ""), vacancy: { value: Number(answer.vacancyValue), target: this.parseTarget(answer.vacancyTarget) } });
        }
        catch (error) {
            notifyError(error);
        }
    }
    static async deleteRole(_event, button) {
        if (!game.user.isGM || !button.dataset.id)
            return;
        try {
            const role = kingdomRoles(getState(this.actor)).find(r => r.id === button.dataset.id);
            if (!role || role.standard)
                throw new Error("Somente cargos personalizados podem ser excluídos.");
            if (!await DialogV2.confirm({ window: { title: "Excluir cargo" }, content: `<p>Excluir <strong>${escapeHTML(role.name)}</strong> e seus efeitos? O personagem será preservado.</p>`, rejectClose: false }))
                return;
            await submitRealmCommand(this.actor, { action: "role.delete", roleId: role.id });
            this.status = "Cargo excluído";
            await this.render({ force: true });
        }
        catch (error) {
            notifyError(error);
        }
    }
    static async addRoleEffect(_event, button) { await this.editEffect(button.dataset.id); }
    static async editRoleEffect(_event, button) { await this.editEffect(button.dataset.id, button.dataset.effectId); }
    async editEffect(roleId, effectId) {
        if (!game.user.isGM || !roleId)
            return;
        try {
            const role = kingdomRoles(getState(this.actor)).find(r => r.id === roleId);
            if (!role)
                throw new Error("Cargo não encontrado.");
            const effect = effectId ? role.effects.find(e => e.id === effectId) : { id: id(), name: "", description: "", type: "role", value: 1, target: { kind: "all" }, condition: "occupied" };
            if (!effect)
                throw new Error("Efeito não encontrado.");
            const answer = await DialogV2.input({ classes: ["twoc", "twoc-role-dialog"], position: { width: 500 }, window: { title: effectId ? "Editar efeito" : "Novo efeito" }, content: `<div class="twoc-definition-form"><label>Nome<input name="name" maxlength="120" value="${escapeHTML(effect.name)}" required></label><label>Descrição<textarea name="description" maxlength="12000" rows="2">${escapeHTML(effect.description)}</textarea></label><label>Tipo<input value="Modificador de cargo" disabled></label><label>Modificador<input name="value" type="number" min="-100" max="100" step="1" value="${effect.value}" required></label><label>Testes afetados<select name="target">${this.targetOptions(effect.target)}</select></label><label>Aplicar<select name="condition"><option value="occupied"${effect.condition === "occupied" ? " selected" : ""}>Enquanto o cargo estiver ocupado</option><option value="responsible"${effect.condition === "responsible" ? " selected" : ""}>Quando o ocupante conduzir a atividade</option></select></label></div>`, ok: { label: "Salvar efeito" }, rejectClose: false });
            if (!answer)
                return;
            if (String(answer.value).trim() === "")
                throw new Error("Informe o modificador do efeito.");
            const updated = { ...effect, name: String(answer.name ?? ""), description: String(answer.description ?? ""), value: Number(answer.value), target: this.parseTarget(answer.target), condition: String(answer.condition) };
            const current = kingdomRoles(getState(this.actor)).find(r => r.id === roleId);
            if (!current || effectId && !current.effects.some(e => e.id === effectId))
                throw new Error("O cargo ou efeito foi excluído por outro usuário.");
            await this.commitRole({ ...current, effects: effectId ? current.effects.map(e => e.id === effectId ? updated : e) : [...current.effects, updated] });
            const details = this.element.querySelector(`[data-role-details="${roleId}"]`);
            if (details)
                details.open = true;
        }
        catch (error) {
            notifyError(error);
        }
    }
    static async deleteRoleEffect(_event, button) {
        if (!game.user.isGM)
            return;
        try {
            const role = kingdomRoles(getState(this.actor)).find(r => r.id === button.dataset.id), effectId = button.dataset.effectId;
            const effect = role?.effects.find(e => e.id === effectId);
            if (!role || !effect)
                throw new Error("Efeito não encontrado.");
            if (!await DialogV2.confirm({ window: { title: "Remover efeito" }, content: `<p>Remover <strong>${escapeHTML(effect.name)}</strong> de ${escapeHTML(role.name)}?</p>`, rejectClose: false }))
                return;
            const current = kingdomRoles(getState(this.actor)).find(r => r.id === role.id);
            if (!current)
                throw new Error("Cargo não encontrado.");
            await this.commitRole({ ...current, effects: current.effects.filter(e => e.id !== effectId) });
        }
        catch (error) {
            notifyError(error);
        }
    }
    findPrivateDocument() {
        if (!game.user.isGM)
            return null;
        return game.journal.find((j) => j.getFlag(MODULE_ID, "publicActorId") === this.actor.id) ?? null;
    }
    async getPrivateDocument() {
        if (!game.user.isGM)
            throw new Error("Acesso privado reservado ao Mestre.");
        const state = getState(this.actor);
        let journal = game.journal.find((j) => j.getFlag(MODULE_ID, "publicActorId") === this.actor.id);
        if (journal)
            return journal;
        const imported = game.journal.filter((j) => j.getFlag(MODULE_ID, "privateState")?.realmId === state.realmId);
        if (imported.length) {
            const options = imported.map((j) => `<option value="${escapeHTML(j.id)}">${escapeHTML(j.name)}</option>`).join("");
            const answer = await DialogV2.input({ window: { title: "Vincular notas importadas" }, content: `<p>Há notas com o mesmo identificador de reino. Escolha o diário para este Actor.</p><select name="journalId">${options}</select>`, ok: { label: "Vincular diário" }, rejectClose: false });
            if (!answer)
                return null;
            journal = game.journal.get(String(answer.journalId));
            if (!journal || !journal.testUserPermission(game.user, 3))
                throw new Error("Diário indisponível.");
            await journal.update({ [`flags.${MODULE_ID}.publicActorId`]: this.actor.id });
            return journal;
        }
        return await JournalEntry.create({ name: `${this.actor.name} — Notas do Mestre`, ownership: { default: 0 }, flags: { [MODULE_ID]: { publicActorId: this.actor.id, privateState: { realmId: state.realmId } } } });
    }
    notesText(html) {
        return new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"), "text/html").body.textContent?.trimEnd() ?? "";
    }
    async getPrivatePage(journal) {
        if (!game.user.isGM || !journal.testUserPermission(game.user, 3))
            throw new Error("Acesso às notas reservado ao Mestre.");
        let page = journal.pages.find((p) => p.getFlag(MODULE_ID, "notesPage"));
        if (!page)
            [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{ name: "Notas do Mestre", type: "text", flags: { [MODULE_ID]: { notesPage: true } }, text: { format: 1, content: "<p></p>" } }]);
        return page;
    }
    static async exportPrivate() {
        if (!game.user.isGM)
            return;
        this.closeMenu();
        const journal = await this.getPrivateDocument();
        journal?.exportToJSON();
    }
    static async importPrivate() {
        if (!game.user.isGM)
            return;
        this.closeMenu();
        const journal = await this.getPrivateDocument();
        if (!journal)
            return;
        await journal.importFromJSONDialog();
        await this.render({ force: true });
    }
}
export async function openRealm(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor || !realmActors().some(a => a.id === actorId))
        throw new Error("Reino não encontrado ou sem permissão de leitura.");
    if (game.user.isGM && getState(actor).featCatalogVersion !== CATALOG_VERSION)
        await submitRealmCommand(actor, { action: "talent.install" });
    let app = windows.get(actorId);
    if (!app) {
        app = new RealmApplication(actor);
        windows.set(actorId, app);
    }
    await app.render({ force: true });
    void maybeCreationWizard(app).catch(notifyError);
    return app;
}
export async function deleteRealm(actorId) {
    if (!game.user.isGM)
        throw new Error("Somente o Mestre exclui reinos.");
    const actor = game.actors.get(actorId);
    if (!actor || actor.type !== "party" || !actor.getFlag(MODULE_ID, "state"))
        throw new Error("Reino não encontrado.");
    const yes = await DialogV2.confirm({ window: { title: "Excluir reino" }, content: `<p>Excluir <strong>${escapeHTML(actor.name)}</strong>?</p><p>A ficha será removida. Personagens vinculados e notas do Mestre serão preservados.</p>`, rejectClose: false });
    if (!yes)
        return;
    await windows.get(actorId)?.close();
    await actor.delete();
}
export async function createTestRealm() {
    if (!game.user.isGM)
        throw new Error("Somente o Mestre cria um reino.");
    const proceed = await DialogV2.confirm({ window: { title: "Novo reino" }, content: "<p>Criar uma ficha de reino?</p>", rejectClose: false });
    if (!proceed)
        return null;
    const state = createRealmState(id());
    const actor = await Actor.create({ name: state.name, type: "party", ownership: { default: 0 }, flags: { [MODULE_ID]: { state } } });
    if (!actor)
        throw new Error("Não foi possível criar o reino de teste.");
    await openRealm(actor.id);
    return actor;
}
export class Launcher extends HbsApplication {
    constructor() { super(); launchers.add(this); }
    async _onClose() { launchers.delete(this); }
    static DEFAULT_OPTIONS = { classes: ["twoc", "twoc-launcher"], position: { width: 480, height: "auto" }, window: { title: "The Weight of the Crown — Reinos" }, actions: {
            open: async function (_event, button) { try {
                await openRealm(button.dataset.id);
            }
            catch (error) {
                notifyError(error);
            } },
            create: async function () { try {
                await createTestRealm();
            }
            catch (error) {
                notifyError(error);
            } },
            delete: async function (_event, button) { try {
                await deleteRealm(button.dataset.id);
                await this.render({ force: true });
            }
            catch (error) {
                notifyError(error);
            } }
        } };
    static PARTS = { body: { template: "modules/weight-of-the-crown/templates/launcher.hbs" } };
    async _prepareContext() { return { isGM: game.user.isGM, realms: realmActors().map(a => ({ id: a.id, name: a.name })) }; }
}
Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "trainingFoodMultiplier", { name: "Comida por ponto de consumo no treino", hint: "Custo de cada treino = Consumo de Comida da tropa × este valor.", scope: "world", config: true, type: Number, default: 1, range: { min: 0, max: 10, step: 1 } });
    game.settings.registerMenu(MODULE_ID, "realms", { name: "The Weight of the Crown", label: "Abrir ficha de reino", hint: "Administração do reino e do conselho.", icon: "fa-solid fa-crown", type: Launcher, restricted: false });
});
Hooks.once("ready", () => {
    game.modules.get(MODULE_ID).api = { openRealm, createTestRealm, deleteRealm, open: () => new Launcher().render({ force: true }) };
});
Hooks.on("renderActorDirectory", (_app, html) => {
    if (!(html instanceof HTMLElement) || html.querySelector(".twoc-open-realms"))
        return;
    const footer = html.querySelector(".directory-footer") ?? html;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "twoc-open-realms";
    button.textContent = "Reinos · The Weight of the Crown";
    button.addEventListener("click", () => void new Launcher().render({ force: true }));
    footer.append(button);
});
Hooks.on("createActor", () => { for (const launcher of launchers)
    if (launcher.rendered)
        void launcher.render({ force: true }); });
Hooks.on("updateActor", (actor, changed) => {
    if (changed.name)
        for (const launcher of launchers)
            if (launcher.rendered)
                void launcher.render({ force: true });
    const flagChange = changed.flags?.[MODULE_ID];
    if (flagChange && !("state" in flagChange) && !changed.name)
        return;
    const app = windows.get(actor.id);
    if (app?.rendered && !app.closing && !app.pendingSaves.size)
        void app.render();
    refreshResponsible(actor.uuid);
});
function refreshPrivate(journalId) {
    if (!game.user.isGM)
        return;
    for (const app of windows.values())
        if (app.rendered && !app.closing && app.activeSection === "private" && app.privateDocument?.id === journalId && !app.pendingSaves.size)
            void app.render();
}
Hooks.on("updateJournalEntry", (journal) => refreshPrivate(journal.id));
Hooks.on("updateJournalEntryPage", (page) => refreshPrivate(page.parent.id));
function refreshResponsible(uuid) {
    for (const app of windows.values()) {
        if (!app.rendered || app.closing || app.pendingSaves.size)
            continue;
        try {
            const state = getState(app.actor);
            if ([...Object.values(state.activityDefinitions), ...Object.values(state.projects), ...kingdomRoles(state), ...Object.values(state.militaryUnits ?? {}).map(u => ({ actorUuid: u.commanderUuid, armyActorUuid: u.armyActorUuid }))].some(d => d.actorUuid === uuid || ("armyActorUuid" in d && d.armyActorUuid === uuid) || d.actorUuid?.startsWith(`${uuid}.Actor.`)))
                void app.render();
        }
        catch { /* O estado incompatível já tem sua própria apresentação de erro. */ }
    }
}
Hooks.on("deleteActor", (actor) => { void windows.get(actor.id)?.close(); refreshResponsible(actor.uuid); for (const launcher of launchers)
    if (launcher.rendered)
        void launcher.render({ force: true }); });
Hooks.on("createItem", (item) => { if (item.parent?.type === "army")
    refreshResponsible(item.parent.uuid); });
Hooks.on("updateItem", (item) => { if (item.parent?.type === "army")
    refreshResponsible(item.parent.uuid); });
Hooks.on("deleteItem", (item) => { if (item.parent?.type === "army")
    refreshResponsible(item.parent.uuid); });
Hooks.on("updateToken", (token) => refreshResponsible(token.uuid));
Hooks.on("deleteToken", (token) => refreshResponsible(token.uuid));
//# sourceMappingURL=main.js.map