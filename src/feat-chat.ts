import { MODULE_ID, SKILLS, DEGREE_LABELS, escapeHTML, isRecord, type Degree } from "./core.js";
import { bestBuilding, currentWeek } from "./management.js";
import type { CheckEvidence, FeatPublication } from "./feat-engine.js";

export const nativeMode = (mode: string): string => ({publicroll:"public",gmroll:"gm",blindroll:"blind",selfroll:"self"}[mode] ?? mode);
export const legacyMode = (mode: string): string => ({public:"publicroll",gm:"gmroll",blind:"blindroll",self:"selfroll"}[mode] ?? mode);
export async function resolveFeatCheck(messageId: string): Promise<CheckEvidence | null> {
  const message = game.messages.get(messageId), data = message?.getFlag(MODULE_ID, "rollData");
  if (!message || message.getFlag(MODULE_ID,"publicationPending") || !isRecord(data) || !SKILLS.some(s => s.id === data.skillId) || !Number.isSafeInteger(data.week)) return null;
  const realmActorId = message.getFlag(MODULE_ID, "actorId") ?? message.speaker.actor;
  const actor = game.actors.get(realmActorId), state = actor?.getFlag(MODULE_ID, "state");
  if (!state) return null;
  const definition = data.activityId ? state.activityDefinitions[data.activityId as string] : data.projectId ? state.projects[data.projectId as string] : null;
  const stale = !!(data.activityId || data.projectId) && (!definition || definition.quest?.status === "completed" || (definition.quest?.runId ?? null) !== (data.runId ?? null));
  const outcome = message.getFlag(MODULE_ID, "resolvedOutcome") ?? data.outcome;
  return { id:message.id, actorId:realmActorId, userId:message.author.isGM ? message.getFlag(MODULE_ID,"rollOwnerId") ?? message.author.id : message.author.id,
    week:data.week as number, skillId:data.skillId as CheckEvidence["skillId"], outcome:["success","failure","criticalSuccess","criticalFailure"].includes(outcome)?outcome:null,
    activityId:data.activityId as string|null, projectId:data.projectId as string|null, crisisEffectId:data.crisisEffectId as string|null,
    fortuneUsed:!!data.fortuneUsed, resolved:stale || !!message.getFlag(MODULE_ID,"superseded") || !!message.getFlag(MODULE_ID,"consequenceApplied"),
    ...(typeof data.dc === "number" ? {dc:data.dc}:{}), mode:legacyMode(String(data.mode ?? "public")), private:!!message.blind || !!message.whisper.length };
}
function visibleData(source: any, userId: string, mode: string): Record<string, unknown> {
  const whisper = source ? [...source.whisper] : mode === "self" ? [userId] : mode === "gm" || mode === "blind" ? game.users.filter((u:any)=>u.isGM).map((u:any)=>u.id) : [];
  return { author:userId,whisper,blind:source ? source.blind : mode==="blind" };
}
/** Prepare one hidden, audience-correct receipt before charging the kingdom. Publishing updates this same document. */
export async function prepareFeat(actor:any,publication:FeatPublication,taskId:string):Promise<string>{
  const existing=game.messages.find((m:any)=>m.getFlag(MODULE_ID,"publicationId")===taskId&&m.getFlag(MODULE_ID,"actorId")===actor.id);
  if(existing)return existing.id;
  const source=publication.sourceId?game.messages.get(publication.sourceId):null,mode=nativeMode(publication.mode);
  if(publication.sourceId&&!source)throw new Error("Mensagem de origem não encontrada; nenhuma cobrança foi feita.");
  let messageData:any;
  const flags:Record<string,unknown>={actorId:actor.id,realmId:actor.getFlag(MODULE_ID,"state").realmId,rollOwnerId:publication.userId,publicationId:taskId,publicationPending:true,publication};
  if(publication.kind==="reroll"){
    const data=source?.getFlag(MODULE_ID,"rollData");
    if(!Array.isArray(data?.modifiers))throw new Error("Este teste não tem dados suficientes para rerrolar.");
    const api=game.pf2e,kept=structuredClone(data.modifiers.filter((m:any)=>!String(m.originId??"").startsWith("feat:kingdom_free_and_fair:catalog_")));
    const buildings=kept.filter((m:any)=>String(m.originId??"").startsWith("building:")&&m.modifier>0).map((m:any)=>({originId:m.originId,label:m.label,value:m.modifier,type:m.type,source:"building" as const}));
    const other=kept.filter((m:any)=>!m.ignored&&!buildings.some((b:any)=>b.originId===m.originId)).map((m:any)=>({originId:m.originId??m.slug,label:m.label,value:m.modifier,type:m.type,source:"effect" as const}));
    const best=bestBuilding(buildings,other);
    for(const m of kept)if(buildings.some((b:any)=>b.originId===m.originId))m.ignored=m.originId!==best?.originId;
    const modifiers=kept.map((m:any)=>{if(!Number.isSafeInteger(m.modifier)||Math.abs(m.modifier)>100000)throw new Error("Modificador de rerrolagem inválido.");const mod=new api.Modifier({slug:m.slug,label:m.label,modifier:m.modifier,type:m.type});mod.ignored=!!m.ignored;return mod;});
    const context:any={actor,type:"skill-check",title:`${escapeHTML(data.title??actor.name)} · Livre e justo`,identifier:`twoc:${actor.id}:reroll`,skipDialog:true,createMessage:false,messageMode:mode,isReroll:true,rollTwice:false,options:new Set(["twoc:kingdom","fortune"]),...(data.dc?{dc:{value:data.dc,visible:true}}:{})};
    await api.Check.roll(new api.CheckModifier("twoc-free-fair-reroll",{modifiers}),context,null,async(_roll:any,outcome:Degree|null,draft:any)=>{
      messageData=draft.toObject();delete messageData._id;
      flags.rollData={...data,outcome,fortuneUsed:true,mode,modifiers:kept};flags.rerollOf=source.id;
    });
    if(!messageData)throw new Error("A rerrolagem não foi preparada.");
    messageData.flags={...messageData.flags,[MODULE_ID]:flags};
  }else{
    if(publication.kind==="fixed")flags.rollData={skillId:publication.skillId,outcome:publication.outcome??null,week:publication.week,dc:publication.dc??null,fortuneUsed:true,activityId:publication.activityId??null,projectId:publication.projectId??null,runId:(publication.activityId?actor.getFlag(MODULE_ID,"state").activityDefinitions[publication.activityId]:publication.projectId?actor.getFlag(MODULE_ID,"state").projects[publication.projectId]:null)?.quest?.runId??null,mode,title:publication.title};
    let flavor=`<strong>${escapeHTML(publication.title)}</strong>`;
    if(publication.dc)flavor+=` · CD ${publication.dc}`;
    if(publication.kind==="pull")flavor+=publication.success?" · Falha crítica tratada como falha":" · A falha crítica permanece";
    else if(publication.outcome)flavor+=` · ${DEGREE_LABELS[publication.outcome]}`;
    messageData={speaker:{actor:actor.id,alias:actor.name},flavor,flags:{[MODULE_ID]:flags},...visibleData(source,publication.userId,mode)};
    if(publication.total!==undefined){const roll=publication.rollJSON?Roll.fromJSON(publication.rollJSON):await new Roll(String(publication.total)).evaluate();messageData=await roll.toMessage(messageData,{messageMode:mode,create:false});}
    else messageData.content=flavor;
  }
  try{
    const receipt=await ChatMessage.create({...messageData,...visibleData(source,publication.userId,mode)});
    if(!receipt)throw new Error("Não foi possível preparar a publicação.");return receipt.id;
  }catch(error){const saved=game.messages.find((m:any)=>m.getFlag(MODULE_ID,"publicationId")===taskId&&m.getFlag(MODULE_ID,"actorId")===actor.id);if(saved)return saved.id;throw error;}
}
export async function discardFeat(receiptId:string):Promise<void>{const message=game.messages.get(receiptId);if(message?.getFlag(MODULE_ID,"publicationPending"))await message.delete();}
export async function publishFeat(actor:any,receiptId:string,taskId:string):Promise<void>{
  const message=game.messages.get(receiptId);
  if(!message||message.getFlag(MODULE_ID,"publicationId")!==taskId||message.getFlag(MODULE_ID,"actorId")!==actor.id)throw new Error("Recibo de publicação ausente ou inválido. O Mestre precisa revisar esta operação.");
  const publication=message.getFlag(MODULE_ID,"publication") as FeatPublication,source=publication.sourceId?game.messages.get(publication.sourceId):null;
  // A missing source never justifies charging again or evaluating another die.
  if(source&&publication.kind==="reroll")await source.update({[`flags.${MODULE_ID}.superseded`]:message.id,[`flags.${MODULE_ID}.resolvedOutcome`]:message.getFlag(MODULE_ID,"rollData").outcome});
  if(source&&publication.kind==="pull")await source.update({[`flags.${MODULE_ID}.resolvedOutcome`]:publication.outcome,[`flags.${MODULE_ID}.pullUsed`]:true});
  if(source&&publication.kind==="crush")await source.update({[`flags.${MODULE_ID}.consequenceApplied`]:true});
  if(message.getFlag(MODULE_ID,"publicationPending"))await message.update({[`flags.${MODULE_ID}.publicationPending`]:false});
}
Hooks.on("renderChatMessageHTML",(message:any,html:any)=>{
  const rootElement=html instanceof HTMLElement?html:html?.[0];
  if(message.getFlag(MODULE_ID,"publicationPending")){if(rootElement){rootElement.hidden=true;rootElement.style.display="none";}return;}
  const data=message.getFlag(MODULE_ID,"rollData");
  if(!data || !message.isContentVisible || message.blind && !game.user.isGM) return;
  const root=html instanceof HTMLElement?html:html?.[0]; if(!root||root.querySelector(".twoc-feat-resolution"))return;
  const superseded=message.getFlag(MODULE_ID,"superseded"), adjusted=message.getFlag(MODULE_ID,"resolvedOutcome");
  if(!superseded&&!adjusted)return;
  const badge=document.createElement("p");badge.className="twoc-feat-resolution";
  badge.textContent=superseded?"Livre e justo · resultado substituído pela rerrolagem":`União de esforços · resultado final: ${DEGREE_LABELS[adjusted as Degree]??adjusted}`;
  root.append(badge);
});
