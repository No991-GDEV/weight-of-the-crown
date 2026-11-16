import {MODULE_ID,requireInteger} from "./core.js";
import {defaultArmyStats,ARMY_LEVEL_TABLE,type MilitaryUnit} from "./realm-admin.js";
export interface ArmyMutation {uuid?:string;managed?:boolean;apply():Promise<void>;rollback():Promise<void>;finalize?():Promise<void>;}
export interface ArmyEdit { fields?: string[]; expected?: Record<string,unknown>; }
export interface ArmyGateway {
  attach?(realm:any,uuid:string,unitId:string):Promise<MilitaryUnit | {unit:MilitaryUnit;mutation:ArmyMutation}>;
  save(realm:any,unit:MilitaryUnit,previous?:MilitaryUnit,edit?:ArmyEdit):Promise<ArmyMutation>;
  train(realm:any,unit:MilitaryUnit,command:any,operationId:string):Promise<{mutation:ArmyMutation;cost:number}>;
  remove(realm:any,unit:MilitaryUnit):Promise<void>;
}
let folderCreation:Promise<any>|null=null;
async function armyFolder():Promise<any>{const found=game.folders.find((f:any)=>f.type==="Actor"&&f.getFlag(MODULE_ID,"armyFolder")===true);if(found)return found;folderCreation??=foundry.documents.Folder.create({name:"The Weight of the Crown · Tropas",type:"Actor",flags:{[MODULE_ID]:{armyFolder:true}}});try{return await folderCreation;}finally{folderCreation=null;}}
const owned=(a:any,realm:any,u:MilitaryUnit)=>a?.type==="army"&&a.getFlag(MODULE_ID,"army")?.realmId===realm.id&&a.getFlag(MODULE_ID,"army")?.unitId===u.id;
export async function resolveArmy(realm:any,unit:MilitaryUnit):Promise<any>{
  const actor=unit.armyActorUuid?await fromUuid(unit.armyActorUuid):null;
  const external=actor?.type==="army"&&!actor.getFlag(MODULE_ID,"army")&&realm.getFlag(MODULE_ID,"state")?.militaryUnits?.[unit.id]?.armyActorUuid===actor.uuid;
  if(!owned(actor,realm,unit)&&!external)throw new Error("Ficha militar ausente ou vínculo inválido. Repare o vínculo sem apagar os dados antigos.");return actor;
}
export function armyView(actor:any){
  return {armyActorUuid:actor.uuid,armyActorName:actor.name,armyMissing:false,level:actor.level,ac:actor.armorClass?.value??actor.system.ac.value,hpCurrent:actor.system.attributes.hp.value,hpMax:actor.system.attributes.hp.max,routThreshold:actor.system.attributes.hp.routThreshold,maneuver:actor.maneuver?.mod??actor.system.saves.maneuver,morale:actor.morale?.mod??actor.system.saves.morale,scouting:actor.scouting?.mod??actor.system.scouting,meleeAttack:actor.strikes?.melee?.variants?.[0]?.mod??null,rangedAttack:actor.strikes?.ranged?.variants?.[0]?.mod??null,consumption:actor.system.consumption,tactics:actor.items.filter((i:any)=>i.type==="campaignFeature"&&i.system.category==="army-tactic").map((i:any)=>i.name).join(" · ")};
}
export interface TacticOption { uuid: string; name: string; }
export async function availableTactics(actor:any):Promise<TacticOption[]>{
  const pack=game.packs.get("pf2e.kingmaker-features");if(!pack)throw new Error("Compêndio de táticas do PF2e não encontrado.");
  const index=await pack.getIndex({fields:["system.category","system.level.value","system.traits.value"]});
  return index.filter((i:any)=>i.type==="campaignFeature"&&i.system.category==="army-tactic"&&i.system.level.value<=actor.level&&!actor.items.some((t:any)=>t.sourceId===(i.uuid??`Compendium.pf2e.kingmaker-features.Item.${i._id}`))&&(!i.system.traits.value.some((t:string)=>["infantry","cavalry","skirmisher","siege"].includes(t))||i.system.traits.value.includes(actor.system.traits.type))).map((i:any)=>({uuid:i.uuid??`Compendium.pf2e.kingmaker-features.Item.${i._id}`,name:i.name}));
}
/** Consulta o registro original, sem criar Item, recibo ou alterar a ficha militar. */
export async function resolveTrainingTactic(actor:any,uuid:string):Promise<any>{
  if (!(await availableTactics(actor)).some(t=>t.uuid===uuid)) throw new Error("Escolha uma tática válida do compêndio, ainda não aprendida.");
  const item = await fromUuid(uuid);
  if (!item || item.uuid!==uuid || item.type!=="campaignFeature" || item.system.category!=="army-tactic" || item.system.level.value>actor.level || !actor.checkItemValidity(item.toObject())) throw new Error("Tática indisponível ou incompatível com esta tropa.");
  return item;
}
export async function recoverTraining(actor:any,realm:any):Promise<void>{
  const pending=actor.getFlag(MODULE_ID,"pendingTraining");if(!pending)return;
  if(pending.committed===true){await actor.unsetFlag(MODULE_ID,"pendingTraining");return;}
  let origin:any=null;
  if(pending.realmUuid)origin=await fromUuid(pending.realmUuid);
  else {
    const committed=game.actors.filter((a:any)=>a.type==="party"&&a.getFlag(MODULE_ID,"state")?.operations?.[pending.operationId]);
    if(committed.length>1)throw new Error("Recibo de treino legado com mais de uma origem. O Mestre precisa conferir o pagamento.");
    origin=committed[0]??null;
    const marker=actor.getFlag(MODULE_ID,"army");
    if(!origin&&marker?.unitId===pending.unitId)origin=game.actors.get(marker.realmId);
    if(!origin&&realm.getFlag(MODULE_ID,"state")?.militaryUnits?.[pending.unitId]?.armyActorUuid===actor.uuid)origin=realm;
  }
  if(!origin?.getFlag(MODULE_ID,"state"))throw new Error("Recibo de treino sem reino de origem verificável. O Mestre precisa conferir o pagamento antes de transferir ou treinar esta ficha.");
  const state=origin.getFlag(MODULE_ID,"state");
  if(state.operations?.[pending.operationId] || (pending.nextCount!==undefined && (state.militaryUnits?.[pending.unitId]?.trainingCount??0)>=pending.nextCount)){await actor.unsetFlag(MODULE_ID,"pendingTraining");return;}
  if(!state.militaryUnits?.[pending.unitId])throw new Error("O cadastro de origem deste treino foi removido. Confira o pagamento antes de reparar o recibo.");
  if(Date.now()-pending.at<30000)throw new Error("Há um treino em resolução. Aguarde antes de tentar novamente.");
  const patch:Record<string,number>={};for(const [path,old] of (Array.isArray(pending.before)?pending.before.map((r:any)=>[r.path,r.value]):Object.entries(foundry.utils.flattenObject(pending.before??{})))){const current=foundry.utils.getProperty(actor._source,path);if(current===(old as number)+1)patch[path]=old as number;else if(current!==old)throw new Error("Treino interrompido com atributo alterado depois. O Mestre precisa revisar a ficha militar.");}
  if(Object.keys(patch).length)await actor.update(patch);
  const items=actor.items.filter((i:any)=>i.getFlag(MODULE_ID,"training")===pending.operationId);if(items.length)await actor.deleteEmbeddedDocuments("Item",items.map((i:any)=>i.id));
  await actor.unsetFlag(MODULE_ID,"pendingTraining");
}
export function trainingCost(actor:any):number{return requireInteger(actor.system.consumption,"Consumo de Comida",0,100)*requireInteger(game.settings.get(MODULE_ID,"trainingFoodMultiplier"),"Multiplicador de treino",0,10);}
export const armyGateway:ArmyGateway={
  async attach(realm,uuid,unitId){
    const actor=await fromUuid(uuid);if(actor?.type!=="army"||!game.actors.has(actor.id)||!/^Actor\.[a-zA-Z0-9_-]+$/.test(uuid))throw new Error("Arraste uma ficha militar da lista de Atores.");
    const marker=actor.getFlag(MODULE_ID,"army");
    if(marker&&game.actors.get(marker.realmId)?.getFlag(MODULE_ID,"state")?.militaryUnits?.[marker.unitId])throw new Error("Esta ficha ainda pertence a um reino existente. Remova o vínculo de origem antes de reassociar.");
    if(game.actors.some((a:any)=>Object.values(a.getFlag(MODULE_ID,"state")?.militaryUnits??{}).some((u:any)=>u.armyActorUuid===uuid)))throw new Error("Esta ficha militar já está vinculada a um reino.");
    if(game.actors.some((a:any)=>Object.values(a.getFlag(MODULE_ID,"state")?.pendingTasks??{}).some((t:any)=>t.kind==="armyDelete"&&t.unit?.armyActorUuid===uuid)))throw new Error("Esta ficha aguarda uma exclusão já confirmada. Finalize a operação pendente no reino de origem.");
    await recoverTraining(actor,realm);
    const unit:MilitaryUnit={id:unitId,name:actor.name,headcount:null,readiness:null,task:"",location:"",condition:"",equipment:"",notes:"",armyType:actor.system.traits.type,consumption:requireInteger(actor.system.consumption,"Consumo de Comida",0,100),trainingCount:0,armyActorUuid:uuid};
    if(!marker)return unit;
    let applied=false;
    return {unit,mutation:{uuid,managed:true,async apply(){await actor.setFlag(MODULE_ID,"army",{realmId:realm.id,unitId,category:unit.armyType});applied=true;},async rollback(){if(applied&&owned(actor,realm,unit))await actor.setFlag(MODULE_ID,"army",marker);}}};
  },
  async save(realm,unit,previous,edit){
    let actor:any=null,created=false;let prior:any,applied:Record<string,unknown>={};
    if(unit.armyActorUuid)actor=await resolveArmy(realm,unit);
    else {const matches=game.actors.filter((a:any)=>owned(a,realm,unit));if(matches.length>1)throw new Error("Há fichas militares duplicadas para esta tropa. Repare o vínculo.");actor=matches[0]??null;}
    if(actor){prior={name:actor.name,"system.consumption":actor._source.system.consumption};}
    const mutation:ArmyMutation={uuid:actor?.uuid,managed:actor?owned(actor,realm,unit):true,async apply(){
      if(!actor){
        const folder=await armyFolder();
        const stats=defaultArmyStats(unit.armyType,unit.level),level=unit.level??1;
        const weapons={melee:unit.meleeAttack===null?null:{name:"Armas corpo a corpo",potency:0},ranged:unit.rangedAttack===null||unit.rangedAttack===undefined?null:{name:"Armas à distância",potency:0}};
        const ownership=Object.fromEntries(Object.entries(realm.ownership??{}).map(([id,value])=>[id,Number(value)>=2?2:0]));
        actor=await Actor.create({name:unit.name,type:"army",folder:folder.id,ownership,flags:{[MODULE_ID]:{army:{realmId:realm.id,unitId:unit.id,category:unit.armyType},legacy:previous??null}},system:{traits:{type:unit.armyType==="archery"?"infantry":unit.armyType??"infantry"},details:{level:{value:level}},ac:{value:unit.ac??stats.ac,potency:0},attributes:{hp:{value:unit.hpCurrent??stats.hpCurrent,max:unit.hpMax??stats.hpMax,routThreshold:unit.routThreshold??stats.routThreshold}},saves:{maneuver:unit.maneuver??stats.maneuver,morale:unit.morale??stats.morale},scouting:unit.scouting??stats.scouting,consumption:unit.consumption??stats.consumption,weapons}});
        if(!actor)throw new Error("Não foi possível criar a ficha militar.");created=true;mutation.uuid=actor.uuid;
        const legacyRules=[...[ ["melee",unit.meleeAttack],["ranged",unit.rangedAttack] ].flatMap(([kind,value])=>typeof value==="number"&&value!==ARMY_LEVEL_TABLE[level]!.attack?[{key:"FlatModifier",selector:`${kind}-attack-roll`,type:"untyped",value:value-ARMY_LEVEL_TABLE[level]!.attack}]:[])];
        if(legacyRules.length)await actor.createEmbeddedDocuments("Item",[{name:"Ajustes iniciais da tropa",type:"effect",system:{rules:legacyRules,duration:{value:-1,unit:"unlimited",expiry:null},start:{value:0,initiative:null}}}]);
        for(const name of (unit.tactics??"").split(/\n|·|,/).map(t=>t.trim()).filter(Boolean))await actor.createEmbeddedDocuments("Item",[{name,type:"campaignFeature",system:{category:"army-tactic",level:{value:1}}}]);
      }else if(previous){
        const fields=edit?.fields??[...(unit.name!==previous.name?["name"]:[]),...(unit.consumption!==previous.consumption?["consumption"]:[])];
        for(const field of fields.filter(f=>f==="name"||f==="consumption")){
          const path=field==="name"?"name":"system.consumption",current=foundry.utils.getProperty(actor._source,path),value=field==="name"?unit.name:unit.consumption;
          if(edit?.expected&&field in edit.expected&&edit.expected[field]!==current&&value!==current)throw new Error("A ficha militar mudou enquanto o formulário estava aberto. Reabra para conferir os valores atuais.");
          if(value!==current)applied[path]=value;
        }
        if(Object.keys(applied).length)await actor.update(applied);
      }
    },async rollback(){if(created&&actor)await actor.delete();else if(actor&&prior){const restore=Object.fromEntries(Object.keys(applied).filter(path=>foundry.utils.getProperty(actor._source,path)===applied[path]).map(path=>[path,prior[path]]));if(Object.keys(restore).length)await actor.update(restore);}}};return mutation;
  },
  async train(realm,unit,command,operationId){
    const actor=await resolveArmy(realm,unit);await recoverTraining(actor,realm);const cost=trainingCost(actor),beforeValues:Record<string,number>={};let apply:()=>Promise<void>,rollback:()=>Promise<void>;
    if(command.focus==="tactic"){
      if(command.stat)throw new Error("Aprender tática não aprimora atributo.");
      const template=await resolveTrainingTactic(actor,command.tactic);
      if(actor.items.filter((i:any)=>i.type==="campaignFeature"&&i.system.category==="army-tactic").length>=actor.maxTactics)throw new Error("A tropa atingiu seu limite de táticas.");
      let added:any;
      apply=async()=>{const data=template.toObject();delete data._id;data.flags??={};data.flags[MODULE_ID]={...(data.flags[MODULE_ID]??{}),training:operationId};data.flags.core={...(data.flags.core??{}),sourceId:template.uuid};[added]=await actor.createEmbeddedDocuments("Item",[data]);if(!added)throw new Error("A tática não foi salva.");};rollback=async()=>{if(added&&actor.items.has(added.id))await actor.deleteEmbeddedDocuments("Item",[added.id]);};
    }else if(command.focus==="stat"){
      const paths:Record<string,string>={ac:"system.ac.value",scouting:"system.scouting",maneuver:"system.saves.maneuver",morale:"system.saves.morale",hpMax:"system.attributes.hp.max"};
      const key=String(command.stat);if(paths[key]){const path=paths[key]!,before=foundry.utils.getProperty(actor._source,path);beforeValues[path]=before;apply=async()=>{await actor.update({[path]:before+1});};rollback=async()=>{if(foundry.utils.getProperty(actor._source,path)===before+1)await actor.update({[path]:before});};}
      else if(["meleeAttack","rangedAttack"].includes(key)){
        const kind=key==="meleeAttack"?"melee":"ranged";if(!actor.system.weapons[kind])throw new Error("A tropa não possui esse ataque.");let added:any;
        apply=async()=>{[added]=await actor.createEmbeddedDocuments("Item",[{name:"Treino militar · "+(kind==="melee"?"Melee":"Distância"),type:"effect",flags:{[MODULE_ID]:{training:operationId}},system:{rules:[{key:"FlatModifier",selector:`${kind}-attack-roll`,slug:`twoc-training-${operationId}`,type:"untyped",value:1}],duration:{value:-1,unit:"unlimited",expiry:null},start:{value:0,initiative:null}}}]);if(!added)throw new Error("Treino não salvo.");};rollback=async()=>{if(added&&actor.items.has(added.id))await actor.deleteEmbeddedDocuments("Item",[added.id]);};
      }else throw new Error("Atributo inválido.");
    }else throw new Error("Escolha Aprender tática ou Treinar atributo.");
    return {cost,mutation:{async apply(){await actor.setFlag(MODULE_ID,"pendingTraining",{operationId,realmUuid:realm.uuid??`Actor.${realm.id}`,unitId:unit.id,at:Date.now(),before:Object.entries(beforeValues).map(([path,value])=>({path,value})),nextCount:(unit.trainingCount??0)+1});await apply();},async rollback(){await rollback();const items=actor.items.filter((i:any)=>i.getFlag(MODULE_ID,"training")===operationId);if(items.length)await actor.deleteEmbeddedDocuments("Item",items.map((i:any)=>i.id));await actor.unsetFlag(MODULE_ID,"pendingTraining");},async finalize(){await actor.update({[`flags.${MODULE_ID}.pendingTraining.committed`]:true});await actor.unsetFlag(MODULE_ID,"pendingTraining");}}};
  },
  async remove(realm,unit){const actor=unit.armyActorUuid?await fromUuid(unit.armyActorUuid):null;if(!actor)return;if(!owned(actor,realm,unit))throw new Error("A ficha militar externa será preservada.");await actor.delete();}
};
