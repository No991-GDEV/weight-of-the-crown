import {isRecord, type Definition, type Degree, type RealmState} from "./core.js";

export const QUEST_DEGREES = ["criticalSuccess", "success", "failure", "criticalFailure"] as const;
export const QUEST_RESULT_FIELDS = QUEST_DEGREES.map(degree => `${degree}Text`);
export const OPEN_QUEST_LIMIT = 2;

export function normalizeResultTexts(raw: unknown): Record<Degree, string> {
  if (!isRecord(raw) || Object.keys(raw).some(key => !QUEST_DEGREES.includes(key as Degree))) throw new Error("Textos de resultado inválidos.");
  return Object.fromEntries(QUEST_DEGREES.map(degree => {
    const text = raw[degree] ?? "";
    if (typeof text !== "string" || text.length > 12000) throw new Error("Cada resultado deve ter até 12.000 caracteres.");
    return [degree, text];
  })) as Record<Degree, string>;
}

export function resultNarrative(definition: Definition, result?: Degree | null): string {
  return (result ? definition.resultTexts?.[result] : "") || definition.benefit || "";
}

/** Pending and in-progress Quests both occupy a slot; projects and completed runs do not. */
export function openQuestCount(state: RealmState, uuid: string, excluding?: string): number {
  return Object.values(state.activityDefinitions).filter(d => d.id !== excluding && d.actorUuid === uuid && d.quest?.status !== "completed").length;
}

export function assertQuestCapacity(state: RealmState, uuid: string | null, excluding?: string): void {
  if (uuid && openQuestCount(state, uuid, excluding) >= OPEN_QUEST_LIMIT) throw new Error("Este personagem/NPC já possui duas Quests abertas. Conclua ou remova um vínculo antes de atribuir outra.");
}
