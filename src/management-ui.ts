import { catalogKey } from "./feat-catalog.js";
import { kingdomRoles } from "./roles.js";
import { FeatTools } from "./feat-ui.js";
import { ABILITIES, SKILLS, RANKS, RESOURCES, escapeHTML, type AbilityId } from "./core.js";
import { getState } from "./adapter.js";
import { submitRealmCommand } from "./authority.js";
import { ALL_FEATURE_SLOTS, EFFECT_TYPES, SEASONS, choices, currentWeek, effectiveRank, eligibleSkills, featIneligibility, questProgress, type KingdomFeat, type CheckEffect } from "./management.js";
import { targetLabel } from "./roles.js";
import type { RealmApplication } from "./main.js";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const Base = HandlebarsApplicationMixin(ApplicationV2);
const id = () => foundry.utils.randomID();
const error = (e: unknown) => ui.notifications.error(e instanceof Error ? e.message : String(e));
const option = (value: string, label: string, selected: unknown) => `<option value="${escapeHTML(value)}"${value === selected ? " selected" : ""}>${escapeHTML(label)}</option>`;
const form = (content: string) => `<div class="twoc-definition-form">${content}</div>`;
const input = async (title: string, content: string, label = "Salvar") => DialogV2.input({ classes: ["twoc", "twoc-role-dialog"], position: { width: 520 }, window: { title }, content: form(content), ok: { label }, rejectClose: false });
const number = (raw: unknown, label: string) => { if (String(raw ?? "").trim() === "") throw new Error(`Informe ${label}.`); return Number(raw); };
const panels = new Set<ManagementPanel>();
export class ManagementPanel extends Base {
  static DEFAULT_OPTIONS = { classes: ["twoc", "twoc-management"], position: { width: 660, height: 620 }, window: { title: "Administração do reino", resizable: true }, actions: {
    add: ManagementPanel.add, edit: ManagementPanel.edit, remove: ManagementPanel.remove, effects: ManagementPanel.effects, toggle: ManagementPanel.toggle
  } };
  static PARTS = { body: { template: "modules/weight-of-the-crown/templates/management.hbs", scrollable: [".twoc-management-list"] } };
  realm: RealmApplication; mode: "feats" | "effects"; scope: string; ownerId: string;
  constructor(realm: RealmApplication, mode: "feats" | "effects", scope = "realm", ownerId = "") { super(); this.realm = realm; this.mode = mode; this.scope = scope; this.ownerId = ownerId; panels.add(this); }
  get title(): string { return this.mode === "feats" ? "Talentos do reino" : `Efeitos · ${this.scope === "season" ? SEASONS.find(s => s.id === this.ownerId)?.label : this.scope === "feat" ? getState(this.realm.actor).feats?.[this.ownerId]?.name : this.realm.actor.name}`; }
  async _prepareContext(): Promise<Record<string, unknown>> {
    const state = getState(this.realm.actor);
    const records = this.mode === "feats" ? Object.values(state.feats ?? {}).map(f => ({ ...f, badge: `Nível ${f.minimumLevel}${f.retired ? " · arquivado" : ""}`, requirements: [f.prerequisites.feats.map(id => state.feats?.[id]?.name).join(", "), f.prerequisites.skills.map(s => `${SKILLS.find(v => v.id === s.id)?.label} ${RANKS[s.rank]}`).join(", "), f.prerequisites.abilities.map(a => `${ABILITIES.find(v => v.id === a.id)?.label} ${a.minimum}`).join(", ")].filter(Boolean).join(" · "), effectCount: Object.keys(f.effects).length }))
      : Object.values(effectRecords(this.realm, this.scope, this.ownerId)).map(e => ({ ...e, badge: `${e.value >= 0 ? "+" : ""}${e.value} · ${(e.target.kind === "reserveCapacity" ? "Limite de reservas" : EFFECT_TYPES.find(t => t.id === e.type)?.label)}${e.enabled ? "" : " · inativo"}`, requirements: targetLabel(e.target, state) }));
    return { records, isGM: game.user.isGM, featMode: this.mode === "feats", heading: this.title, addLabel: this.mode === "feats" ? "Criar talento" : "Criar efeito" };
  }
  async _onClose(): Promise<void> { panels.delete(this); }
  static async add(this: ManagementPanel): Promise<void> { try { this.mode === "feats" ? await editFeat(this.realm) : await editManagedEffect(this.realm, this.scope, this.ownerId); await this.render({ force: true }); } catch (e) { error(e); } }
  static async edit(this: ManagementPanel, _event: Event, button: HTMLElement): Promise<void> { try { this.mode === "feats" ? await editFeat(this.realm, button.dataset.id) : await editManagedEffect(this.realm, this.scope, this.ownerId, button.dataset.id); await this.render({ force: true }); } catch (e) { error(e); } }
  static async effects(this: ManagementPanel, _event: Event, button: HTMLElement): Promise<void> { new ManagementPanel(this.realm, "effects", "feat", button.dataset.id).render({ force: true }); }
  static async toggle(this: ManagementPanel, _event: Event, button: HTMLElement): Promise<void> {
    try {
      if (!game.user.isGM || this.mode !== "effects" || !button.dataset.id) return;
      const effect = effectRecords(this.realm, this.scope, this.ownerId)[button.dataset.id];
      if (!effect) return;
      await submitRealmCommand(this.realm.actor, { action: "effect.save", scope: this.scope, ownerId: this.ownerId, effect: { ...effect, enabled: !effect.enabled } });
      await this.render({ force: true });
    } catch (e) { error(e); }
  }
  static async remove(this: ManagementPanel, _event: Event, button: HTMLElement): Promise<void> {
    try {
      if (!game.user.isGM) return;
      const feat = getState(this.realm.actor).feats?.[button.dataset.id ?? ""];
      const content = this.mode === "feats" ? `<p>Retirar <strong>${escapeHTML(feat?.name)}</strong> das novas escolhas? Escolhas anteriores, benefícios e histórico serão preservados.</p>` : "<p>Remover este efeito?</p>";
      if (!await DialogV2.confirm({ window: { title: this.mode === "feats" ? "Excluir talento" : "Remover efeito" }, content, rejectClose: false })) return;
      await submitRealmCommand(this.realm.actor, this.mode === "feats" ? { action: "feat.delete", featId: button.dataset.id, confirmed: true } : { action: "effect.delete", scope: this.scope, ownerId: this.ownerId, effectId: button.dataset.id });
      await this.render({ force: true });
    } catch (e) { error(e); }
  }
}
Hooks.on("updateActor", (actor: any, changed: any) => {
  const flagChange = changed?.flags?.["weight-of-the-crown"];
  if (flagChange && !("state" in flagChange)) return;
  for (const p of panels) if (p.rendered && p.realm.actor.id === actor.id) void p.render({ force: true });
});
function effectRecords(app: RealmApplication, scope: string, ownerId: string): Record<string, CheckEffect> {
  const state = getState(app.actor);
  return scope === "season" ? state.seasonEffects?.[ownerId as keyof typeof state.seasonEffects] ?? {} : scope === "feat" ? state.feats?.[ownerId]?.effects ?? {} : state.checkEffects ?? {};
}
async function editFeat(app: RealmApplication, featId?: string): Promise<void> {
  if (!game.user.isGM) return;
  const state = getState(app.actor), feat: KingdomFeat = featId ? state.feats?.[featId]! : { id: `feat_${id()}`, name: "", description: "", minimumLevel: 2, repeatable: false, retired: false, prerequisites: { feats: [], skills: [], abilities: [] }, effects: {} };
  if (!feat) throw new Error("Talento não encontrado.");
  const skill = feat.prerequisites.skills[0], ability = feat.prerequisites.abilities[0];
  const answer = await input(featId ? "Editar talento" : "Novo talento", `
    <label>Nome<input name="name" maxlength="120" required value="${escapeHTML(feat.name)}"></label>
    <label>Descrição<textarea name="description" maxlength="12000" rows="3">${escapeHTML(feat.description)}</textarea></label>
    <label>Nível mínimo<input name="minimumLevel" type="number" min="1" max="20" step="1" required value="${feat.minimumLevel}"></label>
    <label>Talento exigido<select name="requiredFeat">${option("", "Nenhum", feat.prerequisites.feats[0] ?? "")}${Object.values(state.feats ?? {}).filter(f => f.id !== feat.id).map(f => option(f.id, f.name, feat.prerequisites.feats[0])).join("")}</select></label>
    <div class="twoc-form-pair"><label>Perícia exigida<select name="requiredSkill">${option("", "Nenhuma", skill?.id ?? "")}${SKILLS.map(s => option(s.id, s.label, skill?.id)).join("")}</select></label><label>Grau mínimo<select name="requiredRank">${RANKS.slice(1).map((r, i) => option(String(i + 1), r, String(skill?.rank ?? 1))).join("")}</select></label></div>
    <div class="twoc-form-pair"><label>Atributo exigido<select name="requiredAbility">${option("", "Nenhum", ability?.id ?? "")}${ABILITIES.map(a => option(a.id, a.label, ability?.id)).join("")}</select></label><label>Valor mínimo<input name="requiredMinimum" type="number" min="0" max="100" step="1" value="${ability?.minimum ?? 1}"></label></div>
    <label class="twoc-checkbox"><input type="checkbox" name="repeatable"${feat.repeatable ? " checked" : ""}>Permitir escolher este talento mais de uma vez</label>`, "Salvar talento");
  if (!answer) return;
  const updated = { ...feat, name: String(answer.name ?? ""), description: String(answer.description ?? ""), minimumLevel: number(answer.minimumLevel, "o nível mínimo"), repeatable: !!answer.repeatable, prerequisites: {
    feats: answer.requiredFeat ? [String(answer.requiredFeat), ...feat.prerequisites.feats.slice(1)] : feat.prerequisites.feats.slice(1),
    skills: answer.requiredSkill ? [{ id: String(answer.requiredSkill), rank: number(answer.requiredRank, "o grau") }, ...feat.prerequisites.skills.slice(1)] : feat.prerequisites.skills.slice(1),
    abilities: answer.requiredAbility ? [{ id: String(answer.requiredAbility), minimum: number(answer.requiredMinimum, "o atributo mínimo") }, ...feat.prerequisites.abilities.slice(1)] : feat.prerequisites.abilities.slice(1)
  } };
  await submitRealmCommand(app.actor, { action: "feat.save", feat: updated });
}
async function editManagedEffect(app: RealmApplication, scope: string, ownerId: string, effectId?: string): Promise<void> {
  if (!game.user.isGM) return;
  const effect: CheckEffect = effectId ? effectRecords(app, scope, ownerId)[effectId]! : { id: `effect_${id()}`, name: "", description: "", type: "untyped", value: 1, target: { kind: "all" }, enabled: true };
  if (!effect) throw new Error("Efeito não encontrado.");
  const answer = await input(effectId ? "Editar efeito" : "Novo efeito", `<label>Nome<input name="name" maxlength="120" required value="${escapeHTML(effect.name)}"></label><label>Descrição<textarea name="description" maxlength="12000" rows="2">${escapeHTML(effect.description)}</textarea></label><div class="twoc-form-pair"><label>Tipo<select name="type">${EFFECT_TYPES.map(t => option(t.id, t.label, effect.type)).join("")}</select></label><label>Modificador<input name="value" type="number" min="${effect.internalCrisis && effect.crisisState === "active" ? -200 : -100}" max="100" step="1" required value="${effect.value}"></label></div><label>O que afeta<select name="target">${app.targetOptions(effect.target, true)}</select></label><small>Limite de reservas: soma o modificador à capacidade, independentemente do tipo de teste.</small>${scope==="realm"?`<label class="twoc-checkbox"><input type="checkbox" name="internalCrisis"${effect.internalCrisis?" checked":""}>Penalidade de agitação / conflito interno</label><label class="twoc-checkbox"><input type="checkbox" name="pendingCrisis"${effect.crisisState==="pending"?" checked":""}>Nova crise aguardando Reprimir dissidência</label>`:""}`, "Salvar efeito");
  if (!answer) return;
  await submitRealmCommand(app.actor, { action: "effect.save", scope, ownerId, effect: { ...effect, name: String(answer.name ?? ""), description: String(answer.description ?? ""), type: String(answer.type), value: number(answer.value, "o modificador"), target: app.parseTarget(answer.target, true), enabled: answer.pendingCrisis ? false : effect.enabled, ...(scope==="realm"?{internalCrisis:!!answer.internalCrisis,crisisState:answer.pendingCrisis?"pending":effect.crisisState==="contained"?"contained":"active"}:{}) } });
}
async function clearFeature(app: RealmApplication, slotId?: string): Promise<void> {
  if (!app.canEdit || !slotId) return;
  const state = getState(app.actor), choice = state.advancement?.[slotId];
  if (!choice) return;
  if (!await DialogV2.confirm({ window: { title: "Desfazer escolha de progressão" }, content: `<p>Desfazer a escolha do nível ${choice.level}? Você poderá realizar uma nova escolha em seguida.</p>`, rejectClose: false })) return;
  await submitRealmCommand(app.actor, { action: "feature.clear", slotId, confirmed: true });
  await app.render({ force: true });
}
async function chooseFeature(app: RealmApplication, slotId?: string): Promise<void> {
  if (!app.canEdit || !slotId) return;
  const state = getState(app.actor), slot = ALL_FEATURE_SLOTS.find(s => s.id === slotId);
  if (!slot || slot.level > state.progression.level) throw new Error("Escolha indisponível.");
  if (state.advancement?.[slotId]) { await clearFeature(app, slotId); return; }
  let content: string, label: string;
  if (slot.kind === "feat") {
    const feats = Object.values(state.feats ?? {}).filter(f => !f.retired);
    if (!feats.length) { ui.notifications.info("O Mestre ainda não cadastrou talentos."); return; }
    content = `<div class="twoc-feat-options">${feats.map(f => { const reason = featIneligibility(state, f, slot.level); return `<label class="twoc-choice-option"><span><input type="radio" name="featId" value="${f.id}"${reason ? " disabled" : ""} required><strong>${escapeHTML(f.name)}</strong><small>Nível ${f.minimumLevel}${reason ? ` · ${escapeHTML(reason)}` : ""}</small></span><p>${escapeHTML(f.description)}</p>${Object.values(f.effects).map(e => `<small>${escapeHTML(e.name)}: ${e.value >= 0 ? "+" : ""}${e.value} · ${escapeHTML(targetLabel(e.target, state))}</small>`).join("")}</label>`; }).join("")}</div>`; label = "Escolher talento";
  } else if (slot.kind === "skill") {
    const eligible = eligibleSkills(state, slot.level);
    if (!eligible.length) throw new Error("Não há perícia elegível; confira os graus iniciais e as escolhas anteriores.");
    content = `<label>Perícia<select name="skillId">${eligible.map(s => option(s.id, `${s.label} · ${RANKS[effectiveRank(state, s.id, slot.level)!]} → ${RANKS[effectiveRank(state, s.id, slot.level)! + 1]}`, "")).join("")}</select></label>`; label = "Aumentar perícia";
  } else {
    const options = ABILITIES.map(a => option(a.id, a.label, "")).join(""); content = `<label>Primeiro atributo<select name="first">${options}</select></label><label>Segundo atributo<select name="second">${options}</select></label>`; label = "Aumentar atributos";
  }
  const answer = await input(`Nível ${slot.level} · ${label}`, content, label); if (!answer) return;
  const choice: Record<string, unknown> = slot.kind === "feat" ? {featId:String(answer.featId ?? "")} : slot.kind === "skill" ? {skillId:String(answer.skillId ?? "")} : {abilityIds:[String(answer.first),String(answer.second)] as AbilityId[]};
  if (slot.kind === "feat") {
    const key=catalogKey(String(choice.featId));
    if (key==="T06" || key==="T10") {
      const skills=SKILLS.filter(s=>key==="T06"?(effectiveRank(state,s.id,slot.level)??0)>=1:effectiveRank(state,s.id,slot.level)===0);
      const param=await input(key==="T06"?"Perícia de Garantia do reino":"Nova perícia treinada",`<label>Perícia<select name="skill">${skills.map(s=>option(s.id,s.label,"")).join("")}</select></label>`,"Confirmar escolha");
      if(!param)return; choice.featSkillId=String(param.skill);
    } else if (key==="T01") {
      const param=await input("Cargo protegido",`<label>Serviço público<select name="role">${kingdomRoles(state).map(r=>option(r.id,r.name,"")).join("")}</select></label>`,"Confirmar escolha");
      if(!param)return; choice.featRoleId=String(param.role);
    }
  }
  await submitRealmCommand(app.actor, { action:"feature.choose",slotId,choice });
  await app.render({ force: true });
}
export async function managementAction(app: RealmApplication, op: string | undefined, button: HTMLElement): Promise<void> {
  try {
    const state = getState(app.actor);
    switch (op) {
      case "featTools": new FeatTools(app).render({force:true}); return;
      case "feats": new ManagementPanel(app, "feats").render({ force: true }); return;
      case "effects": {
        const scope = button.dataset.scope ?? "realm", ownerId = scope === "season" ? state.calendar.season : button.dataset.ownerId;
        if (scope === "season" && !ownerId) throw new Error("Escolha a estação antes de configurar seus efeitos.");
        new ManagementPanel(app, "effects", scope, ownerId).render({ force: true }); return;
      }
      case "improveSkill": {
        if (!app.canEdit) return;
        const skill = SKILLS.find(s=>s.id===button.dataset.id); if(!skill) throw new Error("Perícia desconhecida.");
        const slot=ALL_FEATURE_SLOTS.find(s=>s.kind==="skill"&&s.level<=state.progression.level&&!state.advancement?.[s.id]&&eligibleSkills(state,s.level).some(k=>k.id===skill.id));
        if(!slot) throw new Error("Não há aumento de perícia disponível para este grau. Confira as escolhas e o nível em Progressão.");
        if(await DialogV2.confirm({window:{title:`Melhorar ${skill.label}`},content:`<p>Usar o aumento de perícia do nível ${slot.level} para melhorar ${escapeHTML(skill.label)}?</p>`,rejectClose:false})) await submitRealmCommand(app.actor,{action:"feature.choose",slotId:slot.id,choice:{skillId:skill.id}});
        await app.render({force:true}); return;
      }
      case "chooseFeature": await chooseFeature(app, button.dataset.id); return;
      case "clearFeature": await clearFeature(app, button.dataset.id); return;
      case "crest": {
        if (!game.user.isGM) return;
        const Picker = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
        new Picker({ type: "image", current: state.crestImage ?? "", callback: (path: string) => void submitRealmCommand(app.actor, { action: "crest", path }).catch(error) }).browse(); return;
      }
      case "removeCrest": if (game.user.isGM) await submitRealmCommand(app.actor, { action: "crest", path: null }); break;
      case "advanceWeeks": {
        if (!game.user.isGM) return;
        const answer = await input("Avançar calendário", `<p>Semana atual: <strong>${currentWeek(state)}</strong></p><label>Semanas a avançar<input type="number" name="weeks" min="1" max="10000" step="1" value="1" required></label>`, "Revisar avanço"); if (!answer) return;
        const weeks = number(answer.weeks, "as semanas");
        if (!Number.isSafeInteger(weeks) || weeks < 1 || weeks > 10000) throw new Error("Informe de 1 a 10.000 semanas inteiras.");
        if (!await DialogV2.confirm({ window: { title: "Confirmar calendário" }, content: `<p>Avançar ${weeks} semana(s), da semana ${currentWeek(getState(app.actor))} para ${currentWeek(getState(app.actor)) + weeks}?</p>`, rejectClose: false })) return;
        await submitRealmCommand(app.actor, { action: "week.advance", weeks, confirmed: true }); break;
      }
      case "resources": {
        if (!app.canEdit) return;
        const answer = await input("Conferir reservas", RESOURCES.map(r => `<label>${r.label}<input type="number" name="${r.id}" min="0" step="1" value="${state.resources[r.id] ?? ""}" required></label>`).join(""), "Salvar reservas"); if (!answer) return;
        await submitRealmCommand(app.actor, { action: "resources", values: Object.fromEntries(RESOURCES.map(r => [r.id, number(answer[r.id], r.label)])) }); break;
      }
      case "questDuration": {
        if (!game.user.isGM || !button.dataset.id) return;
        const q = questProgress(state, button.dataset.id), answer = await input("Duração da Quest", `<label>Semanas<input name="weeks" type="number" min="1" max="10000" step="1" value="${q.durationWeeks}" required></label>`); if (!answer) return;
        await submitRealmCommand(app.actor, { action: "quest.duration", questId: button.dataset.id, weeks: number(answer.weeks, "a duração") }); break;
      }
      case "questStart": if (game.user.isGM) await submitRealmCommand(app.actor, { action: "quest.start", questId: button.dataset.id }); break;
      case "questComplete": {
        if (!game.user.isGM || !button.dataset.id) return;
        const q = questProgress(state, button.dataset.id);
        if (q.timeCounted) return;
        const answer = await input("Concluir Quest", `<label>Resultado da Quest<select name="result"><option value="">Apenas concluir / ainda não informado</option><option value="success">Sucesso</option>${state.activityDefinitions[button.dataset.id]?.requiresCheck!==false?'<option value="criticalSuccess">Sucesso crítico no teste decisivo</option>':""}<option value="failure">Falha</option><option value="criticalFailure">Falha crítica</option></select></label><p><strong>${escapeHTML(state.activityDefinitions[button.dataset.id]?.name)}</strong> · ${q.durationWeeks} semana(s)</p><label>Calendário<select name="advance"><option value="yes">Avançar ${q.durationWeeks} semana(s) ao confirmar</option><option value="no">Manter a semana atual</option></select></label><p>Semana atual: ${currentWeek(state)}</p>`, "Confirmar conclusão"); if (!answer) return;
        await submitRealmCommand(app.actor, { action: "quest.complete", questId: button.dataset.id, advance: answer.advance === "yes", confirmed: true, expectedDuration: q.durationWeeks, ...(answer.result ? {result:String(answer.result)} : {}) }); break;
      }
    }
    await app.render({ force: true });
  } catch (e) { error(e); }
}
