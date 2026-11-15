import { isRecord } from "./core.js";
import { safeId } from "./roles.js";
import type { MilitaryUnit } from "./realm-admin.js";

/** Only delivery metadata belongs on the public kingdom. Rolls remain in ChatMessages. */
export type PendingTask = {
  id: string; operationId: string; userId: string; at: number;
} & ({ kind: "publication"; receiptId: string } | { kind: "armyDelete"; unit: MilitaryUnit });

export function validatePendingTasks(value: unknown): asserts value is Record<string, PendingTask> | undefined {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error("Operações pendentes inválidas.");
  for (const [id, task] of Object.entries(value)) {
    safeId(id);
    if (!isRecord(task) || task.id !== id || typeof task.operationId !== "string" || typeof task.userId !== "string" || !Number.isSafeInteger(task.at)) throw new Error("Operação pendente inválida.");
    safeId(task.operationId);
    if (task.kind === "publication") { if (typeof task.receiptId !== "string") throw new Error("Recibo de publicação inválido."); safeId(task.receiptId); }
    else if (task.kind === "armyDelete") { if (!isRecord(task.unit) || typeof task.unit.id !== "string" || typeof task.unit.armyActorUuid !== "string") throw new Error("Exclusão pendente inválida."); safeId(task.unit.id); }
    else throw new Error("Tipo de operação pendente inválido.");
  }
}
