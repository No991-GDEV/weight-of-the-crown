import { isRecord } from "./core.js";
export const QUEST_DEGREES = ["criticalSuccess", "success", "failure", "criticalFailure"];
export const QUEST_RESULT_FIELDS = QUEST_DEGREES.map(degree => `${degree}Text`);
export const OPEN_QUEST_LIMIT = 2;
export function normalizeResultTexts(raw) {
    if (!isRecord(raw) || Object.keys(raw).some(key => !QUEST_DEGREES.includes(key)))
        throw new Error("Textos de resultado inválidos.");
    return Object.fromEntries(QUEST_DEGREES.map(degree => {
        const text = raw[degree] ?? "";
        if (typeof text !== "string" || text.length > 12000)
            throw new Error("Cada resultado deve ter até 12.000 caracteres.");
        return [degree, text];
    }));
}
export function resultNarrative(definition, result) {
    return (result ? definition.resultTexts?.[result] : "") || definition.benefit || "";
}
/** Pending and in-progress Quests both occupy a slot; projects and completed runs do not. */
export function openQuestCount(state, uuid, excluding) {
    return Object.values(state.activityDefinitions).filter(d => d.id !== excluding && d.actorUuid === uuid && d.quest?.status !== "completed").length;
}
export function assertQuestCapacity(state, uuid, excluding) {
    if (uuid && openQuestCount(state, uuid, excluding) >= OPEN_QUEST_LIMIT)
        throw new Error("Este personagem/NPC já possui duas Quests abertas. Conclua ou remova um vínculo antes de atribuir outra.");
}
//# sourceMappingURL=quests.js.map