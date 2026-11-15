import {armyGateway} from "./army.js";
import { resolveFeatCheck, prepareFeat, publishFeat, discardFeat } from "./feat-chat.js";
import { MODULE_ID, isRecord } from "./core.js";
import { requireEditor } from "./adapter.js";
import { executeRealmCommand, type RealmCommand } from "./commands.js";
import { safeId } from "./roles.js";

const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: number; authorityId: string }>();
const PROTOCOL = 16;
const REQUEST_TTL=20000;
const inFlight=new Set<string>();
let sessionStarted = Date.now(), sessionId = "", registration: Promise<unknown> | null = null;
function coordinator(): { userId: string; sessionId: string } | null {
  const now = Date.now();
  const users = game.users.filter((u: any) => u.active && u.isGM).sort((a: any, b: any) => b.role - a.role || a.id.localeCompare(b.id));
  for (const user of users) {
    const sessions = Object.entries(user.getFlag(MODULE_ID, "sessions") ?? {}).filter(([, value]) => isRecord(value) && value.protocol === PROTOCOL && typeof value.seen === "number" && typeof value.started === "number" && now - value.seen < 18000 && value.seen <= now + 10000).sort((a, b) => (a[1] as any).started - (b[1] as any).started || a[0].localeCompare(b[0]));
    if (sessions[0]) return { userId: user.id, sessionId: sessions[0][0] };
  }
  return null;
}
async function registerSession(): Promise<void> {
  if (!game.user.isGM || !game.socket.connected) return;
  if (sessionId !== game.socket.id) { sessionId = game.socket.id; sessionStarted = Date.now(); }
  const patch: Record<string, unknown> = { [`flags.${MODULE_ID}.sessions.${sessionId}`]: { started: sessionStarted, seen: Date.now(), protocol: PROTOCOL } };
  for (const [key, value] of Object.entries(game.user.getFlag(MODULE_ID, "sessions") ?? {})) if (key !== sessionId && isRecord(value) && typeof value.seen === "number" && Date.now() - value.seen > 30000) patch[`flags.${MODULE_ID}.sessions.-=${key}`] = null;
  await game.user.update(patch);
}
Hooks.once("ready", () => {
  if (game.user.isGM) { registration = registerSession(); void registration.catch(console.error); window.setInterval(() => { registration = registerSession(); void registration.then(cleanupRequests).catch(console.error); }, 5000); }
});
/** O ID do remetente vem do hook confirmado pelo servidor, não de um campo de socket controlado pelo cliente. */
export async function submitRealmCommand(actor: any, command: RealmCommand): Promise<void> {
  requireEditor(actor, game.user);
  if (game.user.isGM && registration) await registration;
  const gm = coordinator();
  if (!gm) throw new Error("Um Mestre precisa estar conectado com o módulo atualizado para salvar esta alteração.");
  const operationId = foundry.utils.randomID();
  if (gm.userId === game.user.id && gm.sessionId === game.socket.id) return executeRealmCommand(actor, game.user, command, operationId, { armies:armyGateway, resolveActor: async uuid => await fromUuid(uuid), resolveCheck:resolveFeatCheck, rollD20:async()=>{const roll=await new Roll("1d20").evaluate();return {total:roll.total,json:JSON.stringify(roll.toJSON())};}, prepareFeat, publishFeat, discardFeat });
  const promise = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(operationId);
      const saved=actor.getFlag(MODULE_ID,"state")?.operations?.[operationId];
      void actor.update({[`flags.${MODULE_ID}.requests.-=${operationId}`]:null}).catch(console.error);
      if(saved)resolve();else reject(new Error("Sem confirmação do Mestre. Confira a conexão e o histórico antes de repetir a alteração."));
    }, REQUEST_TTL);
    pending.set(operationId, { resolve, reject, timer, authorityId: gm.userId });
  });
  try { await actor.update({ [`flags.${MODULE_ID}.requests.${operationId}`]: { command, userId:game.user.id,createdAt:Date.now(),expiresAt:Date.now()+REQUEST_TTL,authorityId: gm.userId, sessionId: gm.sessionId, protocol: PROTOCOL } }); }
  catch (error) { const p = pending.get(operationId); if (p) { clearTimeout(p.timer); pending.delete(operationId); p.reject(error instanceof Error ? error : new Error(String(error))); } }
  return promise;
}
Hooks.on("updateActor", (actor: any, changed: any, _options: unknown, senderId: string) => {
  const data = changed.flags?.[MODULE_ID]; if (!data) return;
  for (const [operationId, response] of Object.entries(data.responses ?? {})) {
    const p = pending.get(operationId);
    if (!p || senderId !== p.authorityId || !isRecord(response)) continue;
    clearTimeout(p.timer); pending.delete(operationId);
    response.ok === true ? p.resolve() : p.reject(new Error(String(response.error ?? "Operação recusada.")));
  }
  const designated = coordinator();
  if (!designated || designated.userId !== game.user.id || designated.sessionId !== game.socket.id || !actor.getFlag(MODULE_ID, "state") || !isRecord(data.requests)) return;
  for (const [operationId, request] of Object.entries(data.requests)) {
    try { safeId(operationId); } catch { continue; }
    const flightKey=`${actor.id}:${operationId}`;
    if(inFlight.has(flightKey))continue;
    inFlight.add(flightKey);
    void (async () => {
    try {
    try {
      safeId(operationId);
      if (!isRecord(request) || request.protocol !== PROTOCOL || request.authorityId !== game.user.id || request.sessionId !== game.socket.id) return;
      if(request.userId!==senderId||typeof request.createdAt!=="number"||typeof request.expiresAt!=="number"||request.createdAt>Date.now()+1000||request.expiresAt<=Date.now()||request.expiresAt-request.createdAt>REQUEST_TTL)throw new Error("Pedido expirado ou sem identidade confirmada. Envie a alteração novamente.");
      const sender = game.users.get(senderId); if (!sender) throw new Error("Usuário não encontrado.");
      await executeRealmCommand(actor, sender, request.command, operationId, { armies:armyGateway, resolveActor: async uuid => await fromUuid(uuid), resolveCheck:resolveFeatCheck, rollD20:async()=>{const roll=await new Roll("1d20").evaluate();return {total:roll.total,json:JSON.stringify(roll.toJSON())};}, prepareFeat, publishFeat, discardFeat });
      const stale = Object.entries(actor.getFlag(MODULE_ID, "responses") ?? {}).filter(([k, v]) => k !== operationId && (!isRecord(v) || typeof v.at !== "number" || Date.now() - v.at > 15000)).map(([k]) => [`flags.${MODULE_ID}.responses.-=${k}`, null]);
      await actor.update({ [`flags.${MODULE_ID}.responses.${operationId}`]: { ok: true, at: Date.now() }, [`flags.${MODULE_ID}.requests.-=${operationId}`]: null, ...Object.fromEntries(stale) });
    } catch (error) {
      console.error(`${MODULE_ID}: operação recusada`, error);
      const stale = Object.entries(actor.getFlag(MODULE_ID, "responses") ?? {}).filter(([k, v]) => k !== operationId && (!isRecord(v) || typeof v.at !== "number" || Date.now() - v.at > 15000)).map(([k]) => [`flags.${MODULE_ID}.responses.-=${k}`, null]);
      await actor.update({ [`flags.${MODULE_ID}.responses.${operationId}`]: { ok: false, error: error instanceof Error ? error.message : String(error), at: Date.now() }, [`flags.${MODULE_ID}.requests.-=${operationId}`]: null, ...Object.fromEntries(stale) });
    }
    } finally { inFlight.delete(flightKey); }
    window.setTimeout(() => { if (game.actors?.get(actor.id)?.getFlag(MODULE_ID, "responses")?.[operationId]) void actor.update({ [`flags.${MODULE_ID}.responses.-=${operationId}`]: null }).catch(() => {}); }, 5000);
    })().catch(console.error);
  }
});

/** Reconcile only confirmed operation IDs. Never execute an old stored payload without a new authenticated update hook. */
async function cleanupRequests():Promise<void>{
  const gm=coordinator();if(!gm||gm.userId!==game.user.id||gm.sessionId!==game.socket.id)return;
  const now=Date.now();let budget=50;
  for(const actor of game.actors){
    if(!actor.getFlag(MODULE_ID,"state")||budget<=0)continue;
    const patch:Record<string,unknown>={};
    for(const [id,request] of Object.entries(actor.getFlag(MODULE_ID,"requests")??{})){
      if(budget<=0)break;
      try{safeId(id);}catch{continue;}
      if(inFlight.has(`${actor.id}:${id}`))continue;
      const committed=actor.getFlag(MODULE_ID,"state").operations?.[id];
      const expired=!isRecord(request)||typeof request.expiresAt!=="number"||request.expiresAt<=now;
      if(!committed&&!expired)continue;
      patch[`flags.${MODULE_ID}.requests.-=${id}`]=null;budget--;
      if(committed)patch[`flags.${MODULE_ID}.responses.${id}`]={ok:true,at:now};
    }
    for(const [id,response] of Object.entries(actor.getFlag(MODULE_ID,"responses")??{})){
      if(budget<=0)break;
      try{safeId(id);}catch{continue;}
      if(!isRecord(response)||typeof response.at!=="number"||now-response.at>30000){patch[`flags.${MODULE_ID}.responses.-=${id}`]=null;budget--;}
    }
    if(Object.keys(patch).length)await actor.update(patch);
  }
}
