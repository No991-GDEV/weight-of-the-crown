import {resolveArmy,availableTactics,trainingCost} from "./army.js";
import { CATALOG_TAGS } from "./feat-catalog.js";
import { ABILITIES, SKILLS, RESOURCES, RANKS, escapeHTML, abilityTotal, requireInteger, type AbilityId, type SkillId } from "./core.js";
import { getState } from "./adapter.js";
import { submitRealmCommand } from "./authority.js";
import { ARMY_TYPES, CHARTERS, HEARTLANDS, GOVERNMENTS, createMilitaryUnitDraft, defaultArmyStats, normalizeMilitaryUnit, normalizeOrigin, originAdjustments, definitionOutcome, type ArmyTypeId } from "./realm-admin.js";
import { EFFECT_TYPES, currentWeek, questProgress, type CheckEffect } from "./management.js";
import type { RealmApplication } from "./main.js";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const Base = HandlebarsApplicationMixin(ApplicationV2), uid = () => foundry.utils.randomID();
const error = (e: unknown) => ui.notifications.error(e instanceof Error ? e.message : String(e));
const option = (id: string, label: string, selected: unknown) => `<option value="${escapeHTML(id)}"${id === selected ? " selected" : ""}>${escapeHTML(label)}</option>`;
const editors = new Set<any>();

export async function maybeCreationWizard(realm: RealmApplication): Promise<void> {
  if (!game.user.isGM || getState(realm.actor).creation.wizardSeenAt) return;
  const claimId = uid(); await submitRealmCommand(realm.actor, { action: "creation.claim", claimId });
  if (getState(realm.actor).creation.wizardClaim === claimId) new RealmCreationWizard(realm).render({ force: true });
}
export class RealmCreationWizard extends Base {
  static DEFAULT_OPTIONS = { classes: ["twoc", "twoc-wizard"], position: { width: 700, height: 730 }, window: { title: "Criar reino", resizable: true }, actions: { next: RealmCreationWizard.next, back: RealmCreationWizard.back, finish: RealmCreationWizard.finish } };
  static PARTS = { body: { template: "modules/weight-of-the-crown/templates/creation.hbs", scrollable: [".twoc-editor-body"] } };
  realm: RealmApplication; step = 0; busy = false; formError = ""; lastGovernmentId = ""; draft: any;
  constructor(realm: RealmApplication) {
    super(); this.realm = realm; editors.add(this);
    const s = getState(realm.actor);
    const prevGov = GOVERNMENTS.find(g => g.id === s.creation.origin?.governmentId);
    this.lastGovernmentId = s.creation.origin?.governmentId ?? "";
    this.draft = { name: realm.actor.name, charterId: s.creation.origin?.charterId ?? "", heartlandId: s.creation.origin?.heartlandId ?? "", governmentId: s.creation.origin?.governmentId ?? "", charterFree: s.creation.origin?.charterFree ?? "", governmentFree: s.creation.origin?.governmentFree ?? "", allocations: Object.fromEntries(ABILITIES.map(a => [a.id, s.creation.attributeAllocations[a.id] ?? 0])), skills: SKILLS.filter(k => (s.skills[k.id].rank ?? 0) > 0 && !prevGov?.skills.includes(k.id)).map(s => s.id), population: s.demographics?.population ?? "" };
  }
  collect(): void {
    const form = this.element?.querySelector("form") as HTMLFormElement | null; if (!form) return;
    for (const el of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-draft]")) {
      const key = el.dataset.draft!;
      if (key.startsWith("allocations.")) this.draft.allocations[key.split(".")[1]!] = el.value.trim() ? Number(el.value) : 0;
      else this.draft[key] = el.value;
    }
    if (this.step === 2) {
      const gov = GOVERNMENTS.find(g => g.id === this.draft.governmentId);
      this.draft.skills = [...form.querySelectorAll<HTMLInputElement>("input[name=trained]:checked")].map(el => el.value).filter(id => !gov?.skills.includes(id as SkillId));
    }
  }
  async _prepareContext(): Promise<Record<string, unknown>> {
    const s = getState(this.realm.actor), gov = GOVERNMENTS.find(g => g.id === this.draft.governmentId), charter = CHARTERS.find(c => c.id === this.draft.charterId);
    const abilityName = (id: AbilityId) => ABILITIES.find(a => a.id === id)?.label ?? "";
    const skillName = (id: SkillId) => SKILLS.find(k => k.id === id)?.label ?? "";
    const skills = [...new Set([...this.draft.skills, ...(gov?.skills ?? [])])];
    const p = { charterId: this.draft.charterId, heartlandId: this.draft.heartlandId, governmentId: this.draft.governmentId, charterFree: this.draft.charterFree, governmentFree: this.draft.governmentFree };
    const preview = structuredClone(s); preview.creation.attributeAllocations = this.draft.allocations;
    let bonuses: ReturnType<typeof originAdjustments> = [];
    try { preview.creation.origin = normalizeOrigin(p); bonuses = originAdjustments(preview); } catch { /* Opções ainda em preenchimento. */ }
    return { ...this.draft, isRevising: !!s.creation.setupCompletedAt, stepOrigin: this.step === 0, stepAbilities: this.step === 1, stepSkills: this.step === 2, stepReview: this.step === 3, isFirst: this.step === 0, isLast: this.step === 3, stepNumber: this.step + 1, busy: this.busy, formError: this.formError,
      steps: ["Origem", "Atributos", "Perícias", "Revisão"].map((label, i) => ({ label, active: this.step === i, complete: this.step > i })),
      charters: CHARTERS.map(c => ({ ...c, selected: c.id === this.draft.charterId, summary: c.boost && c.flaw ? `+${abilityName(c.boost)}, -${abilityName(c.flaw)}, +1 livre` : "+1 livre" })),
      heartlands: HEARTLANDS.map(h => ({ ...h, selected: h.id === this.draft.heartlandId, summary: `+${abilityName(h.boost)}` })),
      governments: GOVERNMENTS.map(g => ({ ...g, selected: g.id === this.draft.governmentId, summary: `+${g.boosts.map(abilityName).join(", +")}, +1 livre · ${g.skills.map(skillName).join(", ")}` })),
      charterFreeOptions: ABILITIES.filter(a => a.id !== charter?.boost && a.id !== charter?.flaw).map(a => ({ ...a, selected: a.id === this.draft.charterFree })), governmentFreeOptions: ABILITIES.filter(a => !gov?.boosts.includes(a.id)).map(a => ({ ...a, selected: a.id === this.draft.governmentFree })),
      points: Object.values(this.draft.allocations).reduce<number>((n, v) => n + Number(v), 0),
      attributes: ABILITIES.map(a => ({ ...a, value: this.draft.allocations[a.id], total: abilityTotal(preview, a.id), details: bonuses.filter(b => b.abilityId === a.id).map(b => `${b.label} ${b.value > 0 ? "+" : ""}${b.value}`).join(" · ") })),
      skills: SKILLS.map(k => ({ ...k, selected: skills.includes(k.id), required: gov?.skills.includes(k.id), abilityLabel: ABILITIES.find(a => a.id === k.abilityId)?.label })), skillCount: skills.length,
      originLabels: [CHARTERS.find(c => c.id === p.charterId)?.label, HEARTLANDS.find(h => h.id === p.heartlandId)?.label, gov?.label].filter(Boolean).join(" · "),
      govFeatName: gov?.featName, govFeatDescription: gov?.featDescription, trainedLabels: SKILLS.filter(k => skills.includes(k.id)).map(k => k.label).join(", ")
    };
  }
  async _onRender(): Promise<void> {
    this.element.querySelector("form")?.addEventListener("submit", (event: Event) => event.preventDefault());
    for (const select of this.element.querySelectorAll("[data-draft=charterId],[data-draft=governmentId],[data-draft=heartlandId]")) select.addEventListener("change", () => {
      this.collect();
      if (this.draft.governmentId !== this.lastGovernmentId) {
        const oldGov = GOVERNMENTS.find(g => g.id === this.lastGovernmentId);
        if (oldGov) this.draft.skills = this.draft.skills.filter((id: string) => !oldGov.skills.includes(id as SkillId));
        this.lastGovernmentId = this.draft.governmentId;
      }
      const charter = CHARTERS.find(c => c.id === this.draft.charterId), gov = GOVERNMENTS.find(g => g.id === this.draft.governmentId);
      if (this.draft.charterFree === charter?.boost || this.draft.charterFree === charter?.flaw) this.draft.charterFree = "";
      if (gov?.boosts.includes(this.draft.governmentFree)) this.draft.governmentFree = "";
      void this.render({ force: true });
    });
    for (const el of this.element.querySelectorAll("input[name=trained]")) el.addEventListener("change", () => { this.collect(); void this.render({ force: true }); });
    for (const el of this.element.querySelectorAll("[data-draft^='allocations.']")) el.addEventListener("input", () => { this.collect(); const counter = this.element.querySelector("[data-points-counter]"); if (counter) counter.textContent = `${Object.values(this.draft.allocations).reduce<number>((n, v) => n + Number(v), 0)} / 4 pontos`; });
  }
  validateStep(): void {
    if (this.step === 0) { normalizeOrigin({charterId:this.draft.charterId,heartlandId:this.draft.heartlandId,governmentId:this.draft.governmentId,charterFree:this.draft.charterFree,governmentFree:this.draft.governmentFree}); if (!this.draft.name.trim()) throw new Error("Informe o nome do reino."); }
    if (this.step === 1 && Object.values(this.draft.allocations).reduce<number>((n, v) => n + requireInteger(v, "Pontos livres", 0, 4), 0) !== 4) throw new Error("Distribua os quatro pontos livres.");
    if (this.step === 2 && new Set([...this.draft.skills, ...GOVERNMENTS.find(g => g.id === this.draft.governmentId)!.skills]).size !== 6) throw new Error("Escolha seis perícias, incluindo as duas do Governo.");
  }
  static async next(this: RealmCreationWizard): Promise<void> { this.collect(); try { this.validateStep(); this.formError = ""; this.step = Math.min(3, this.step + 1); } catch (e) { this.formError = e instanceof Error ? e.message : String(e); } await this.render({ force: true }); }
  static async back(this: RealmCreationWizard): Promise<void> { this.collect(); this.formError = ""; this.step = Math.max(0, this.step - 1); await this.render({ force: true }); }
  static async finish(this: RealmCreationWizard): Promise<void> {
    if (this.busy) return; this.collect(); this.busy = true;
    try {
      const gov = GOVERNMENTS.find(g => g.id === this.draft.governmentId)!;
      await submitRealmCommand(this.realm.actor, { action: "creation.configure", origin: { charterId: this.draft.charterId, heartlandId: this.draft.heartlandId, governmentId: this.draft.governmentId, charterFree: this.draft.charterFree, governmentFree: this.draft.governmentFree }, allocations: this.draft.allocations, skills: [...new Set([...this.draft.skills, ...gov.skills])], name: this.draft.name, population: String(this.draft.population).trim() ? Number(this.draft.population) : null });
      await this.realm.render({ force: true }); await this.close();
    } catch (e) { this.formError = e instanceof Error ? e.message : String(e); this.busy = false; await this.render({ force: true }); }
  }
  async _onClose(): Promise<void> { editors.delete(this); }
}

export class DefinitionEditor extends Base {
  static DEFAULT_OPTIONS = { classes: ["twoc", "twoc-definition-editor"], position: { width: 670, height: 735 }, window: { title: "Definição", resizable: true }, actions: { save: DefinitionEditor.save, addEffect: DefinitionEditor.addEffect, removeEffect: DefinitionEditor.removeEffect } };
  static PARTS = { body: { template: "modules/weight-of-the-crown/templates/definition-editor.hbs", scrollable: [".twoc-editor-body"] } };
  realm: RealmApplication; kind: "activity" | "project"; definitionId: string; fields: Record<string, string>; duration: string; rewards: Record<string, string>; costs: Record<string,string>; effects: CheckEffect[]; featTags: string[]; repeatable: boolean; formError = ""; busy = false;
  constructor(realm: RealmApplication, kind: "activity" | "project", definitionId?: string) {
    super(); this.realm = realm; this.kind = kind; this.definitionId = definitionId ?? `definition_${uid()}`; editors.add(this);
    const s = getState(realm.actor), d = (kind === "activity" ? s.activityDefinitions : s.projects)[this.definitionId], outcome = d ? definitionOutcome(d) : { resources: {}, effects: {}, costs:{} };
    this.repeatable=d?.repeatable??true; this.featTags = d?.featTags ? [...d.featTags] : [];
    this.fields = { name: d?.name ?? "", description: d?.description ?? "", skillId: d?.skillId ?? "", dc: String(d?.dc ?? ""), suitability: String(d?.suitability ?? 0), stages: d?.stages ?? "", benefit: d?.benefit ?? "", requiresCheck: String(d ? d.requiresCheck !== false : kind === "activity") };
    this.costs=Object.fromEntries(RESOURCES.map(r=>[r.id,String(outcome.costs?.[r.id]??0)])); this.duration = String(d?.quest?.durationWeeks ?? 1); this.rewards = Object.fromEntries(RESOURCES.map(r => [r.id, String((outcome.resources[r.id] ?? 0)-(outcome.costs?.[r.id]??0))])); this.effects = Object.values(outcome.effects).map(e => structuredClone(e));
  }
  get title(): string { return this.kind === "activity" ? "Configurar Quest" : "Configurar construção"; }
  collect(allowEmpty = false): void {
    const form = this.element?.querySelector("form") as HTMLFormElement | null; if (!form) return;
    for (const el of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-field-name]")) this.fields[el.dataset.fieldName!] = el.type === "checkbox" ? String((el as HTMLInputElement).checked) : el.value;
    this.repeatable=!!form.querySelector<HTMLInputElement>("[name=repeatable]")?.checked;
    this.featTags = [...form.querySelectorAll<HTMLInputElement>("[name=featTag]:checked")].map(e=>e.value);
    this.duration = (form.elements.namedItem("duration") as HTMLInputElement).value;
    for (const r of RESOURCES) this.rewards[r.id] = (form.elements.namedItem(r.id) as HTMLInputElement).value;
    
    for (const e of this.effects) {
      const read = (name: string) => (form.elements.namedItem(`${e.id}_${name}`) as HTMLInputElement | HTMLSelectElement).value;
      const rawVal = read("value").trim();
      if (!allowEmpty && !rawVal) throw new Error("Informe o modificador de todos os efeitos.");
      e.name = read("name"); e.value = rawVal ? Number(rawVal) : ("" as unknown as number); e.type = read("type") as CheckEffect["type"]; e.target = this.realm.parseTarget(read("target"));
    }
  }
  async _prepareContext(): Promise<Record<string, unknown>> {
    return { repeatable:this.repeatable, featTags:CATALOG_TAGS.map(t=>({...t,checked:this.featTags.includes(t.id)})), ...this.fields, isProject: this.kind === "project", requiresCheck: this.fields.requiresCheck === "true", duration: this.duration, formError: this.formError, busy: this.busy,
      skills: SKILLS.map(s => ({ ...s, selected: s.id === this.fields.skillId })), resources: RESOURCES.map(r => ({ ...r, amount: this.rewards[r.id],cost:this.costs[r.id] })),
      effects: this.effects.map(e => ({ ...e, types: EFFECT_TYPES.map(t => ({ ...t, selected: e.type === t.id })), targetOptions: this.realm.targetOptions(e.target) })) };
  }
  async _onRender(): Promise<void> {
    this.element.querySelector("form")?.addEventListener("submit", (event: Event) => event.preventDefault());
    this.element.querySelector("[data-field-name=requiresCheck]")?.addEventListener("change", () => { this.collect(true); void this.render({ force: true }); });
  }
  static async addEffect(this: DefinitionEditor): Promise<void> { this.collect(true); this.effects.push({ id: `effect_${uid()}`, name: "", description: "", type: "untyped", value: 1, target: { kind: "all" }, enabled: true }); await this.render({ force: true }); }
  static async removeEffect(this: DefinitionEditor, _event: Event, button: HTMLElement): Promise<void> { this.collect(true); this.effects = this.effects.filter(e => e.id !== button.dataset.id); await this.render({ force: true }); }
  static async save(this: DefinitionEditor): Promise<void> {
    if (this.busy) return;
    try { this.collect(false); this.busy = true;
      await submitRealmCommand(this.realm.actor, { action: "definition.save", kind: this.kind, definitionId: this.definitionId, fields: this.fields, repeatable:this.repeatable, featTags:this.featTags, durationWeeks: this.duration.trim() ? Number(this.duration) : null, outcome: { costs:{}, resources: Object.fromEntries(RESOURCES.map(r => [r.id, this.rewards[r.id]?.trim() ? Number(this.rewards[r.id]) : 0])), effects: Object.fromEntries(this.effects.map(e => [e.id, e])) } });
      await this.realm.render({ force: true }); await this.close();
    } catch (e) { this.busy = false; this.formError = e instanceof Error ? e.message : String(e); await this.render({ force: true }); }
  }
  async _onClose(): Promise<void> { editors.delete(this); }
}

const ARMY_STAT_OPTIONS = [
  ["meleeAttack", "Bônus de Ataque Melee"], ["rangedAttack", "Ataque à Distância"], ["ac", "CA"],
  ["maneuver", "Manobra"], ["morale", "Moral"], ["scouting", "Explorador"], ["hpMax", "PV Máximo"]
] as const;
const intOrNull = (v: unknown) => String(v ?? "").trim() ? Number(v) : null;
const statSelect = (options: readonly (readonly [string, string])[], emptyLabel: string, selected = "") =>
  `${option("", emptyLabel, selected)}${options.map(([k, lbl]) => option(k, lbl, selected)).join("")}`;

export async function editMilitaryUnit(realm:RealmApplication,unitId?:string):Promise<void>{
  if(!game.user.isGM)return;
  const state=getState(realm.actor),unit=unitId?state.militaryUnits?.[unitId]:createMilitaryUnitDraft(`unit_${uid()}`);if(!unit)throw new Error("Unidade não encontrada.");
  const live=unit.armyActorUuid?await resolveArmy(realm.actor,unit):null;
  const initial={...unit,...(live?{name:live.name,consumption:live._source.system.consumption}:{})};
  const result=await DialogV2.input({classes:["twoc","twoc-role-dialog"],position:{width:580},window:{title:unitId?"Administrar tropa":"Nova tropa"},content:`<div class="twoc-definition-form"><label>Nome<input name="name" maxlength="120" required value="${unitId?escapeHTML(initial.name):""}"></label>${!unitId?`<div class="twoc-form-pair"><label>Tipo<select name="armyType">${ARMY_TYPES.map(t=>option(t.id,t.label,"infantry")).join("")}</select></label><label>Nível inicial<input name="level" type="number" min="1" max="20" value="1" required></label></div>`:""}<div class="twoc-form-pair"><label>Soldados<input name="headcount" type="number" min="0" max="100000" step="1" value="${unit.headcount??""}" placeholder="10–15"></label><label>Consumo de Comida<input name="consumption" type="number" min="0" max="100" step="1" required value="${initial.consumption??1}"></label></div><label>Prontidão<select name="readiness">${option("","A definir",unit.readiness??"")}${option("ready","Pronta",unit.readiness)}${option("limited","Limitada",unit.readiness)}${option("unavailable","Indisponível",unit.readiness)}</select></label><label>Tarefa<input name="task" value="${escapeHTML(unit.task)}"></label><label>Local<input name="location" value="${escapeHTML(unit.location)}"></label><label>Condição<textarea name="condition">${escapeHTML(unit.condition)}</textarea></label><label>Observações<textarea name="notes">${escapeHTML(unit.notes)}</textarea></label></div>`,ok:{label:"Salvar tropa"},rejectClose:false,render:(_e:any,d:any)=>{const el=d.element as HTMLElement;el.querySelector("[name=armyType]")?.addEventListener("change",()=>{const type=(el.querySelector("[name=armyType]") as HTMLSelectElement).value;const info=ARMY_TYPES.find(t=>t.id===type)!;(el.querySelector("[name=consumption]") as HTMLInputElement).value=String(info.consumption);});}});
  if(!result)return;
  const type=result.armyType??unit.armyType,level=result.level!==undefined?Number(result.level):unit.level;
  const {maxTactics:_max,standardDc:_dc,...stats}=defaultArmyStats(type,level);
  const edited={name:String(result.name),headcount:intOrNull(result.headcount),consumption:Number(result.consumption),readiness:result.readiness||null,task:String(result.task??""),location:String(result.location??""),condition:String(result.condition??""),notes:String(result.notes??"")};
  const changedFields=Object.keys(edited).filter(k=>edited[k as keyof typeof edited]!==initial[k as keyof typeof initial]);
  if(unitId&&!changedFields.length)return;
  await submitRealmCommand(realm.actor,{action:"military.save",unit:{...unit,...(!unitId?{...stats,armyType:type,level}:{}),...edited},...(unitId?{changedFields,expectedActor:{name:initial.name,consumption:initial.consumption}}:{})});
}
export async function trainMilitaryUnit(realm:RealmApplication,unitId?:string):Promise<void>{
  if(!game.user.isGM)return;
  const units=Object.values(getState(realm.actor).militaryUnits??{});if(!units.length){ui.notifications.info("Cadastre uma tropa primeiro.");return;}
  if(!unitId){const choice=await DialogV2.input({classes:["twoc","twoc-role-dialog"],window:{title:"Escolher tropa"},content:`<label>Tropa<select name="unit">${units.map(u=>option(u.id,u.name,units[0]!.id)).join("")}</select></label>`,ok:{label:"Preparar treino"},rejectClose:false});if(!choice)return;unitId=String(choice.unit);}
  const unit=units.find(u=>u.id===unitId)!;if(!unit)throw new Error("Unidade não encontrada.");
  const actor=await resolveArmy(realm.actor,unit),cost=trainingCost(actor),tactics=await availableTactics(actor),state=getState(realm.actor),initial=tactics.length?"tactic":"stat";
  const result=await DialogV2.input({classes:["twoc","twoc-role-dialog"],position:{width:560},window:{title:"Treinar tropa · 1 semana"},content:`<div class="twoc-definition-form"><p><strong>${escapeHTML(unit.name)}</strong> · Custo: <strong>${cost} Comida</strong> · Reserva: ${state.resources.res_food??"a definir"}</p><label>Modalidade<select name="focus">${tactics.length?option("tactic","Aprender tática",initial):""}${option("stat","Treinar atributo (+1)",initial)}</select></label><label data-train-row="tactic">Tática<select name="tactic">${tactics.map(t=>option(t.uuid,t.name,"")).join("")}</select></label><label data-train-row="stat">Atributo aprimorado<select name="stat">${ARMY_STAT_OPTIONS.map(([id,label])=>option(id,label,"ac")).join("")}</select></label><label>Calendário<select name="advance"><option value="yes">Avançar 1 semana</option><option value="no">Manter semana atual</option></select></label></div>`,ok:{label:`Confirmar treino · ${cost} Comida`},rejectClose:false,render:(_e:any,d:any)=>{const el=d.element as HTMLElement,select=el.querySelector<HTMLSelectElement>("[name=focus]")!;const sync=()=>{for(const row of el.querySelectorAll<HTMLElement>("[data-train-row]"))row.hidden=row.dataset.trainRow!==select.value;};sync();select.addEventListener("change",sync);}});
  if(!result)return;
  await submitRealmCommand(realm.actor,{action:"military.train",unitId:unit.id,focus:String(result.focus),tactic:result.focus==="tactic"?String(result.tactic):"",stat:result.focus==="stat"?String(result.stat):"",advance:result.advance==="yes",expectedCost:cost,expectedTrainingCount:unit.trainingCount??0,confirmed:true});
}

export async function expansionAction(realm: RealmApplication, button: HTMLElement): Promise<void> {
  try {
    if (button.dataset.op === "creation" && game.user.isGM) new RealmCreationWizard(realm).render({ force: true });
    else if (button.dataset.op === "militaryTab") { realm.activeSection = "military"; await realm.render({ force: true }); }
    else if (button.dataset.op === "population" && game.user.isGM) {
      const population = getState(realm.actor).demographics?.population;
      const result = await DialogV2.input({ classes: ["twoc", "twoc-role-dialog"], window: { title: "População do reino" }, content: `<div class="twoc-definition-form"><label>População total, incluindo soldados<input name="population" type="number" min="0" step="1" value="${population ?? ""}" placeholder="A definir"></label></div>`, ok: { label: "Salvar população" }, rejectClose: false });
      if (result) await submitRealmCommand(realm.actor, { action: "population", value: String(result.population ?? "").trim() ? Number(result.population) : null });
    } else if (button.dataset.op === "unitAdd" || button.dataset.op === "unitEdit") await editMilitaryUnit(realm, button.dataset.id);
    else if (button.dataset.op === "unitTrain") await trainMilitaryUnit(realm, button.dataset.id);
    else if(button.dataset.op==="unitSheet"&&button.dataset.id){const unit=getState(realm.actor).militaryUnits?.[button.dataset.id];if(unit)await (await resolveArmy(realm.actor,unit)).sheet.render(true);}
    else if(button.dataset.op==="unitLink"&&game.user.isGM&&button.dataset.id){if(await DialogV2.confirm({window:{title:"Vincular ficha militar"},content:"<p>Criar ou recuperar a ficha desta tropa a partir dos dados preservados?</p>",rejectClose:false}))await submitRealmCommand(realm.actor,{action:"military.link",unitId:button.dataset.id,repair:true});}
    else if (button.dataset.op === "unitDelete" && game.user.isGM && button.dataset.id) {
      const unit = getState(realm.actor).militaryUnits?.[button.dataset.id]; if (!unit) return;
      const result=await DialogV2.input({classes:["twoc","twoc-role-dialog"],window:{title:"Excluir tropa"},content:`<p>Remover ${escapeHTML(unit.name)} do reino?</p><label><input type="checkbox" name="deleteActor">Excluir também a ficha militar criada pelo módulo. O capitão será preservado.</label>`,ok:{label:"Excluir tropa"},rejectClose:false});if(result)await submitRealmCommand(realm.actor,{action:"military.delete",unitId:unit.id,confirmed:true,deleteActor:!!result.deleteActor});
    } else if (button.dataset.op === "questRepeat" && game.user.isGM) {
      if (await DialogV2.confirm({ window: { title: "Nova execução" }, content: "<p>Preparar uma nova execução? A conclusão anterior ficará no histórico e não receberá outra recompensa.</p>", rejectClose: false })) await submitRealmCommand(realm.actor, { action: "quest.repeat", questId: button.dataset.id, confirmed: true });
    } else if(button.dataset.op==="projectStatus"&&game.user.isGM&&button.dataset.id){
      const q=questProgress(getState(realm.actor),button.dataset.id,"project");
      const answer=await DialogV2.input({classes:["twoc","twoc-role-dialog"],window:{title:"Estado da construção"},content:`<div class="twoc-definition-form"><label>Estado<select name="status">${option("pending","Pendente",q.status)}${option("inProgress","Em andamento",q.status)}${option("completed","Concluída",q.status)}</select></label><p>Ajuste manual: não movimenta recursos nem calendário. Os efeitos da construção ficam ativos quando concluída.</p></div>`,ok:{label:"Alterar estado"},rejectClose:false});
      if(answer)await submitRealmCommand(realm.actor,{action:"project.status",projectId:button.dataset.id,status:answer.status});
    } else if (button.dataset.op === "projectStart" && game.user.isGM && button.dataset.id) {
      await submitRealmCommand(realm.actor, { action: "project.start", projectId: button.dataset.id });
    } else if (button.dataset.op === "definitionDelete" && game.user.isGM && button.dataset.id && (button.dataset.kind === "activity" || button.dataset.kind === "project")) {
      const state = getState(realm.actor);
      const def = (button.dataset.kind === "activity" ? state.activityDefinitions : state.projects)[button.dataset.id];
      if (!def) return;
      const label = button.dataset.kind === "activity" ? "Quest" : "construção";
      if (await DialogV2.confirm({ window: { title: `Excluir ${label}` }, content: `<p>Excluir <strong>${escapeHTML(def.name)}</strong>? O histórico de registros será preservado.</p>`, rejectClose: false })) {
        await submitRealmCommand(realm.actor, { action: "definition.delete", kind: button.dataset.kind, definitionId: button.dataset.id, confirmed: true });
      }
    } else if (button.dataset.op === "projectComplete" && game.user.isGM && button.dataset.id) {
      const d = getState(realm.actor).projects[button.dataset.id]; if (!d) return;
      const q = questProgress(getState(realm.actor), d.id, "project");
      if (q.timeCounted) return;
      const title = q.status === "completed" ? "Contabilizar duração da construção" : "Concluir construção";
      const okLabel = q.status === "completed" ? "Contabilizar semanas" : "Concluir e aplicar benefícios";
      const options = q.status === "completed"
        ? `<option value="yes">Avançar ${q.durationWeeks} semana(s)</option>`
        : `<option value="no">Manter semana atual</option><option value="yes">Avançar ${q.durationWeeks} semana(s)</option>`;
      const answer = await DialogV2.input({ classes: ["twoc", "twoc-role-dialog"], window: { title }, content: `<div class="twoc-definition-form"><p>${escapeHTML(d.name)}</p><label>Calendário<select name="advance">${options}</select></label></div>`, ok: { label: okLabel }, rejectClose: false });
      if (answer) await submitRealmCommand(realm.actor, { action: "project.complete", projectId: d.id, advance: answer.advance === "yes", expectedDuration: q.durationWeeks, confirmed: true });
    }
    await realm.render({ force: true });
  } catch (e) { error(e); }
}
Hooks.on("deleteActor", (actor: any) => { for (const editor of editors) if (editor.realm.actor.id === actor.id) void editor.close(); });
