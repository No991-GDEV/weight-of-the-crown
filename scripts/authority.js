import { armyGateway } from "./army.js";
import { resolveFeatCheck, prepareFeat, publishFeat, discardFeat } from "./feat-chat.js";
import { MODULE_ID, isRecord } from "./core.js";
import { requireCommandAccess } from "./adapter.js";
import { executeRealmCommand } from "./commands.js";
import { safeId } from "./roles.js";
const PROTOCOL = 17, REQUEST_TTL = 20000;
const pending = new Map();
const inFlight = new Set();
let sessionStarted = Date.now(), sessionId = "", registration = null;
const documentKey = (doc) => `${doc.documentName}:${doc.id}`;
function coordinator() {
    const now = Date.now();
    const users = game.users.filter((u) => u.active && u.isGM).sort((a, b) => b.role - a.role || a.id.localeCompare(b.id));
    for (const user of users) {
        const sessions = Object.entries(user.getFlag(MODULE_ID, "sessions") ?? {}).filter(([, v]) => isRecord(v) && v.protocol === PROTOCOL && typeof v.seen === "number" && typeof v.started === "number" && now - v.seen < 18000 && v.seen <= now + 10000).sort((a, b) => a[1].started - b[1].started || a[0].localeCompare(b[0]));
        if (sessions[0])
            return { userId: user.id, sessionId: sessions[0][0] };
    }
    return null;
}
async function registerSession() {
    if (!game.user.isGM || !game.socket.connected)
        return;
    if (sessionId !== game.socket.id) {
        sessionId = game.socket.id;
        sessionStarted = Date.now();
    }
    const patch = { [`flags.${MODULE_ID}.sessions.${sessionId}`]: { started: sessionStarted, seen: Date.now(), protocol: PROTOCOL } };
    for (const [key, v] of Object.entries(game.user.getFlag(MODULE_ID, "sessions") ?? {}))
        if (key !== sessionId && isRecord(v) && typeof v.seen === "number" && Date.now() - v.seen > 30000)
            patch[`flags.${MODULE_ID}.sessions.-=${key}`] = null;
    await game.user.update(patch);
}
const dependencies = () => ({ armies: armyGateway, resolveActor: async (uuid) => await fromUuid(uuid), resolveCheck: resolveFeatCheck, rollD20: async () => { const roll = await new Roll("1d20").evaluate(); return { total: roll.total, json: JSON.stringify(roll.toJSON()) }; }, prepareFeat, publishFeat, discardFeat });
Hooks.once("ready", () => {
    if (game.user.isGM) {
        registration = registerSession();
        void registration.catch(console.error);
        window.setInterval(() => { registration = registerSession(); void registration.then(cleanupRequests).catch(console.error); }, 5000);
    }
});
/** An observer submits only self-assignment through their own User. They never gain Actor editing permission. */
export async function submitRealmCommand(actor, command) {
    requireCommandAccess(actor, game.user, command);
    if (game.user.isGM && registration)
        await registration;
    const gm = coordinator();
    if (!gm)
        throw new Error("Um Mestre precisa estar conectado com o módulo atualizado para salvar esta alteração.");
    const operationId = foundry.utils.randomID();
    if (gm.userId === game.user.id && gm.sessionId === game.socket.id)
        return executeRealmCommand(actor, game.user, command, operationId, dependencies());
    const doc = !game.user.isGM && !actor.testUserPermission(game.user, 3) ? game.user : actor;
    const promise = new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            pending.delete(operationId);
            const saved = actor.getFlag(MODULE_ID, "state")?.operations?.[operationId];
            void doc.update({ [`flags.${MODULE_ID}.requests.-=${operationId}`]: null }).catch(console.error);
            if (saved)
                resolve();
            else
                reject(new Error("Sem confirmação do Mestre. Confira a conexão e o histórico antes de repetir a alteração."));
        }, REQUEST_TTL);
        pending.set(operationId, { resolve, reject, timer, authorityId: gm.userId, documentKey: documentKey(doc) });
    });
    try {
        await doc.update({ [`flags.${MODULE_ID}.requests.${operationId}`]: { command, actorId: actor.id, userId: game.user.id, createdAt: Date.now(), expiresAt: Date.now() + REQUEST_TTL, authorityId: gm.userId, sessionId: gm.sessionId, protocol: PROTOCOL } });
    }
    catch (e) {
        const p = pending.get(operationId);
        if (p) {
            clearTimeout(p.timer);
            pending.delete(operationId);
            p.reject(e instanceof Error ? e : new Error(String(e)));
        }
    }
    return promise;
}
function isSelfAssignment(command) { return isRecord(command) && command.action === "binding.save" && command.kind === "activity"; }
function onRequestDocument(doc, changed, _options, senderId) {
    const data = changed.flags?.[MODULE_ID];
    if (!data)
        return;
    for (const [id, response] of Object.entries(data.responses ?? {})) {
        const p = pending.get(id);
        if (!p || p.documentKey !== documentKey(doc) || senderId !== p.authorityId || !isRecord(response))
            continue;
        clearTimeout(p.timer);
        pending.delete(id);
        response.ok === true ? p.resolve() : p.reject(new Error(String(response.error ?? "Operação recusada.")));
    }
    const designated = coordinator();
    if (!designated || designated.userId !== game.user.id || designated.sessionId !== game.socket.id || !isRecord(data.requests))
        return;
    for (const [id, request] of Object.entries(data.requests)) {
        try {
            safeId(id);
        }
        catch {
            continue;
        }
        if (!isRecord(request) || request.protocol !== PROTOCOL || request.authorityId !== game.user.id || request.sessionId !== game.socket.id)
            continue;
        const key = `${documentKey(doc)}:${id}`;
        if (inFlight.has(key))
            continue;
        inFlight.add(key);
        void handleRequest(doc, id, request, senderId).catch(console.error).finally(() => inFlight.delete(key));
    }
}
async function handleRequest(doc, id, request, senderId) {
    let response;
    try {
        if (request.userId !== senderId || !Number.isSafeInteger(request.createdAt) || !Number.isSafeInteger(request.expiresAt) || Number(request.createdAt) > Date.now() + 1000 || Number(request.expiresAt) <= Date.now() || Number(request.expiresAt) - Number(request.createdAt) > REQUEST_TTL)
            throw new Error("Pedido expirado ou sem identidade confirmada. Envie a alteração novamente.");
        if (doc.documentName === "User" && (doc.id !== senderId || !isSelfAssignment(request.command)))
            throw new Error("Este canal permite apenas vincular seu personagem a uma Quest.");
        const actor = doc.documentName === "User" ? game.actors.get(request.actorId) : doc;
        if (!actor?.getFlag(MODULE_ID, "state"))
            throw new Error("Reino não encontrado.");
        const sender = game.users.get(senderId);
        if (!sender)
            throw new Error("Usuário não encontrado.");
        await executeRealmCommand(actor, sender, request.command, id, dependencies());
        response = { ok: true, at: Date.now() };
    }
    catch (e) {
        console.error(`${MODULE_ID}: operação recusada`, e);
        response = { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() };
    }
    const stale = Object.entries(doc.getFlag(MODULE_ID, "responses") ?? {}).filter(([k, v]) => k !== id && (!isRecord(v) || typeof v.at !== "number" || Date.now() - v.at > 15000)).map(([k]) => [`flags.${MODULE_ID}.responses.-=${k}`, null]);
    await doc.update({ [`flags.${MODULE_ID}.responses.${id}`]: response, [`flags.${MODULE_ID}.requests.-=${id}`]: null, ...Object.fromEntries(stale) });
    window.setTimeout(() => { if (doc.getFlag(MODULE_ID, "responses")?.[id])
        void doc.update({ [`flags.${MODULE_ID}.responses.-=${id}`]: null }).catch(() => { }); }, 5000);
}
Hooks.on("updateActor", onRequestDocument);
Hooks.on("updateUser", onRequestDocument);
/** Expired stored commands are removed, never replayed without a fresh authenticated hook. */
async function cleanupRequests() {
    const gm = coordinator();
    if (!gm || gm.userId !== game.user.id || gm.sessionId !== game.socket.id)
        return;
    const now = Date.now();
    let budget = 50;
    for (const doc of [...game.actors, ...game.users]) {
        if (budget <= 0)
            break;
        const patch = {};
        for (const [id, request] of Object.entries(doc.getFlag(MODULE_ID, "requests") ?? {})) {
            if (budget <= 0)
                break;
            try {
                safeId(id);
            }
            catch {
                continue;
            }
            if (inFlight.has(`${documentKey(doc)}:${id}`))
                continue;
            const actor = doc.documentName === "User" && isRecord(request) ? game.actors.get(request.actorId) : doc;
            const committed = actor?.getFlag(MODULE_ID, "state")?.operations?.[id];
            const expired = !isRecord(request) || typeof request.expiresAt !== "number" || request.expiresAt <= now;
            if (!committed && !expired)
                continue;
            patch[`flags.${MODULE_ID}.requests.-=${id}`] = null;
            budget--;
            if (committed)
                patch[`flags.${MODULE_ID}.responses.${id}`] = { ok: true, at: now };
        }
        for (const [id, response] of Object.entries(doc.getFlag(MODULE_ID, "responses") ?? {})) {
            if (budget <= 0)
                break;
            try {
                safeId(id);
            }
            catch {
                continue;
            }
            if (!isRecord(response) || typeof response.at !== "number" || now - response.at > 30000) {
                patch[`flags.${MODULE_ID}.responses.-=${id}`] = null;
                budget--;
            }
        }
        if (Object.keys(patch).length)
            await doc.update(patch);
    }
}
//# sourceMappingURL=authority.js.map