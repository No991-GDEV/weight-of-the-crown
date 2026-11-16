import { MODULE_ID, RULES_VERSION, isRecord, assertRealm, normalizeField, normalizeDefinition, readPath, type RealmState, type AuditEntry, type Definition } from "./core.js";
import { kingdomRoles, normalizeRole, safeId, validateActorUuid, type KingdomRole } from "./roles.js";
import { validateResourceChange, validateAdvancement } from "./management.js";

export interface UserContext { id: string; isGM: boolean; }
export interface PublicDocument {
  id: string; name: string; type: string;
  getFlag(scope: string, key: string): unknown;
  testUserPermission(user: UserContext, permission: number): boolean;
  update(data: Record<string, unknown>): Promise<unknown>;
}
export function getState(actor: PublicDocument): RealmState {
  if (actor.type !== "party") throw new Error("O reino precisa de seu próprio Actor Party.");
  const state = actor.getFlag(MODULE_ID, "state");
  assertRealm(state);
  return structuredClone(state);
}
export function requireEditor(actor: PublicDocument, user: UserContext): void {
  if (!user.isGM && !actor.testUserPermission(user, 3)) throw new Error("Você não tem permissão para editar este reino.");
}
/** Self-assignment grants no other editing capability to a kingdom observer. */
export function requireCommandAccess(actor:PublicDocument,user:UserContext,command:unknown):void{
  if(isRecord(command)&&command.action==="binding.save"&&command.kind==="activity"){
    if(user.isGM||actor.testUserPermission(user,2))return;
    throw new Error("Você não tem acesso a este reino.");
  }
  requireEditor(actor,user);
}
export function requireGM(actor: PublicDocument, user: UserContext): void {
  if (!user.isGM) throw new Error("Somente o Mestre pode administrar definições do reino.");
  requireEditor(actor, user);
}
export function auditEntry(id: string, user: UserContext, kind: AuditEntry["kind"], fields: Partial<AuditEntry> = {}): AuditEntry {
  return { ...fields, id, userId: user.id, kind, at: new Date().toISOString() };
}
export async function saveField(actor: PublicDocument, user: UserContext, path: string, raw: string, operationId: string): Promise<boolean> {
  requireEditor(actor, user);
  const state = getState(actor);
  const value = normalizeField(path, raw, user.isGM, state);
  const previous = readPath(state, path);
  if (previous === value) return false;
  const trial = structuredClone(state);
  const parts = path.split("."); let target: any = trial;
  for (const key of parts.slice(0, -1)) target = target[key];
  target[parts.at(-1)!] = value;
  if (path.startsWith("resources.")) validateResourceChange(state, trial);
  validateAdvancement(trial);
  const result = await actor.update({
    [`flags.${MODULE_ID}.state.${path}`]: value,
    [`flags.${MODULE_ID}.state.operations.${operationId}`]: auditEntry(operationId, user, "field", { path, before: previous, after: value })
  });
  if (!result) throw new Error("O Foundry não confirmou o salvamento. Reabra a ficha e confira o valor.");
  return true;
}
export async function saveDefinition(actor: PublicDocument, user: UserContext, kind: "activity" | "project", id: string, raw: Record<string, string>, operationId: string): Promise<Definition> {
  requireGM(actor, user);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("Identificador inválido.");
  const state = getState(actor);
  const collection = kind === "activity" ? "activityDefinitions" : "projects";
  const existing = state[collection][id];
  const definition = { ...normalizeDefinition(raw, id, kind), ...(existing?.actorUuid ? { actorUuid: existing.actorUuid } : {}) };
  const authoredFields = normalizeDefinition(raw, id, kind);
  const result = await actor.update({
    ...Object.fromEntries(Object.entries(authoredFields).map(([key, value]) => [`flags.${MODULE_ID}.state.${collection}.${id}.${key}`, value])),
    [`flags.${MODULE_ID}.state.operations.${operationId}`]: auditEntry(operationId, user, "definition", { path: `${collection}.${id}`, before: state[collection][id] ?? null, after: definition })
  });
  if (!result) throw new Error("O Foundry não confirmou a gravação da definição.");
  return getState(actor)[collection][id] ?? definition;
}
/** Apenas o vínculo; não permite ao jogador alterar a CD, custos ou texto da definição. */
export async function saveActorBinding(actor: PublicDocument, user: UserContext, kind: "activity" | "project", definitionId: string, actorUuid: string | null, operationId: string): Promise<void> {
  requireEditor(actor, user);
  if (kind !== "activity" && kind !== "project") throw new Error("Tipo de atividade inválido.");
  if (!/^[a-zA-Z0-9_-]+$/.test(definitionId) || ["__proto__", "constructor", "prototype"].includes(definitionId)) throw new Error("Identificador inválido.");
  validateActorUuid(actorUuid);
  const collection = kind === "activity" ? "activityDefinitions" : "projects";
  const state = getState(actor), definition = state[collection][definitionId];
  if (!definition) throw new Error("Atividade não encontrada.");
  const path = `${collection}.${definitionId}.actorUuid`;
  const result = await actor.update({
    [`flags.${MODULE_ID}.state.${path}`]: actorUuid,
    [`flags.${MODULE_ID}.state.operations.${operationId}`]: auditEntry(operationId, user, "field", { path, before: definition.actorUuid ?? null, after: actorUuid })
  });
  if (!result) throw new Error("Não foi possível salvar o responsável.");
}
export async function saveRollRecord(actor: PublicDocument, user: UserContext, operationId: string, detail: string): Promise<void> {
  requireEditor(actor, user); getState(actor);
  const result = await actor.update({ [`flags.${MODULE_ID}.state.operations.${operationId}`]: auditEntry(operationId, user, "roll", { detail }) });
  if (!result) throw new Error("Não foi possível registrar a rolagem no histórico.");
}

export async function saveRole(actor: PublicDocument, user: UserContext, roleId: string, raw: unknown, operationId: string): Promise<KingdomRole> {
  requireGM(actor, user); safeId(roleId); safeId(operationId);
  const state = getState(actor), previous = kingdomRoles(state).find(r => r.id === roleId);
  if ((state.roles?.[roleId] as { deleted?: boolean } | undefined)?.deleted) throw new Error("Este cargo foi excluído. Crie um novo cargo.");
  const normalized = normalizeRole(raw, roleId, state);
  // Vínculo e exclusão têm operações próprias; edição autoral jamais restaura um vínculo antigo.
  if (normalized.deleted) throw new Error("Use a opção de excluir cargo.");
  const { actorUuid: _binding, deleted: _deleted, ...authored } = normalized;
  const result = await actor.update({
    [`flags.${MODULE_ID}.state.rulesVersion`]: RULES_VERSION,
    ...Object.fromEntries(Object.entries(authored).map(([key, value]) => [`flags.${MODULE_ID}.state.roles.${roleId}.${key}`, value])),
    [`flags.${MODULE_ID}.state.operations.${operationId}`]: auditEntry(operationId, user, "definition", { path: `roles.${roleId}`, detail: `${previous ? "Cargo atualizado" : "Cargo criado"}: ${authored.name}` })
  });
  if (!result) throw new Error("O Foundry não confirmou a gravação do cargo.");
  const saved = kingdomRoles(getState(actor)).find(r => r.id === roleId);
  if (!saved) throw new Error("O cargo foi excluído por outro usuário.");
  return saved;
}
export async function deleteRole(actor: PublicDocument, user: UserContext, roleId: string, operationId: string): Promise<void> {
  requireGM(actor, user); safeId(roleId); safeId(operationId);
  const role = kingdomRoles(getState(actor)).find(r => r.id === roleId);
  if (!role) throw new Error("Cargo não encontrado.");
  if (role.standard) throw new Error("Cargos padrão não podem ser excluídos.");
  const result = await actor.update({
    [`flags.${MODULE_ID}.state.rulesVersion`]: RULES_VERSION,
    [`flags.${MODULE_ID}.state.roles.${roleId}.deleted`]: true,
    [`flags.${MODULE_ID}.state.operations.${operationId}`]: auditEntry(operationId, user, "definition", { path: `roles.${roleId}`, detail: `Cargo excluído: ${role.name}` })
  });
  if (!result) throw new Error("Não foi possível excluir o cargo.");
}
export interface LinkedActor { documentName: string; type: string; uuid: string; testUserPermission(user: UserContext, permission: number): boolean; }
export type ActorResolver = (uuid: string) => Promise<LinkedActor | null>;
/** Validação do documento ocorre também aqui, antes da persistência, não apenas no drop. */
export async function saveRoleBinding(actor: PublicDocument, user: UserContext, roleId: string, actorUuid: string | null, operationId: string, resolveActor: ActorResolver): Promise<void> {
  requireEditor(actor, user); safeId(roleId); safeId(operationId); validateActorUuid(actorUuid);
  const initial = kingdomRoles(getState(actor)).find(r => r.id === roleId);
  if (!initial) throw new Error("Cargo não encontrado.");
  if (actorUuid) {
    const linked = await resolveActor(actorUuid);
    if (!linked || linked.documentName !== "Actor" || !["character", "npc"].includes(linked.type) || linked.uuid !== actorUuid) throw new Error("Selecione um personagem ou NPC existente.");
    if (!user.isGM && !linked.testUserPermission(user, 2)) throw new Error("Você não tem acesso a esse personagem.");
  }
  // Releitura após resolução assíncrona: não recriar cargo excluído nesse intervalo.
  const current = kingdomRoles(getState(actor)).find(r => r.id === roleId);
  if (!current) throw new Error("Este cargo foi excluído por outro usuário.");
  if ((current.actorUuid ?? null) === actorUuid) return;
  const path = `roles.${roleId}.actorUuid`;
  const result = await actor.update({
    [`flags.${MODULE_ID}.state.rulesVersion`]: RULES_VERSION,
    [`flags.${MODULE_ID}.state.${path}`]: actorUuid,
    [`flags.${MODULE_ID}.state.operations.${operationId}`]: auditEntry(operationId, user, "field", { path, before: current.actorUuid ?? null, after: actorUuid })
  });
  if (!result) throw new Error("Não foi possível salvar o responsável pelo cargo.");
}
