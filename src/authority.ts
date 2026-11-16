import {rpcNow,validateRequestTime} from "./rpc-time.js";
import {armyGateway} from "./army.js";
import {resolveFeatCheck,prepareFeat,publishFeat,discardFeat} from "./feat-chat.js";
import {MODULE_ID,isRecord} from "./core.js";
import {requireCommandAccess} from "./adapter.js";
import {executeRealmCommand,type RealmCommand} from "./commands.js";
import {safeId} from "./roles.js";

const PROTOCOL=20,REQUEST_TTL=20000;
const pending=new Map<string,{resolve:()=>void;reject:(e:Error)=>void;timer:number;authorityId:string;documentKey:string}>();
const inFlight=new Set<string>();
let sessionStarted=0,sessionId="",registration:Promise<unknown>|null=null;
const documentKey=(doc:any)=>`${doc.documentName}:${doc.id}`;
function coordinator():{userId:string;sessionId:string}|null{
  const now=rpcNow();
  const users=game.users.filter((u:any)=>u.active&&u.isGM).sort((a:any,b:any)=>b.role-a.role||a.id.localeCompare(b.id));
  for(const user of users){
    const sessions=Object.entries(user.getFlag(MODULE_ID,"sessions")??{}).filter(([,v])=>isRecord(v)&&v.protocol===PROTOCOL&&typeof v.seen==="number"&&typeof v.started==="number"&&now-v.seen<18000&&v.seen<=now+10000).sort((a,b)=>(a[1] as any).started-(b[1] as any).started||a[0].localeCompare(b[0]));
    if(sessions[0])return{userId:user.id,sessionId:sessions[0][0]};
  }
  return null;
}
async function registerSession():Promise<void>{
  if(!game.user.isGM||!game.socket.connected)return;
  if(sessionId!==game.socket.id){sessionId=game.socket.id;sessionStarted=rpcNow();}
  const patch:Record<string,unknown>={[`flags.${MODULE_ID}.sessions.${sessionId}`]:{started:sessionStarted,seen:rpcNow(),protocol:PROTOCOL}};
  for(const [key,v] of Object.entries(game.user.getFlag(MODULE_ID,"sessions")??{}))if(key!==sessionId&&isRecord(v)&&typeof v.seen==="number"&&(v.protocol!==PROTOCOL||rpcNow()-v.seen>30000||v.seen>rpcNow()+10000))patch[`flags.${MODULE_ID}.sessions.-=${key}`]=null;
  await game.user.update(patch);
}
const dependencies=()=>({armies:armyGateway,resolveActor:async(uuid:string)=>await fromUuid(uuid),resolveCheck:resolveFeatCheck,rollD20:async()=>{const roll=await new Roll("1d20").evaluate();return{total:roll.total,json:JSON.stringify(roll.toJSON())};},prepareFeat,publishFeat,discardFeat});
Hooks.once("ready",()=>{
  if(game.user.isGM){registration=registerSession();void registration.catch(console.error);window.setInterval(()=>{registration=registerSession();void registration.then(cleanupRequests).catch(console.error);},5000);}
});
/** An observer submits only self-assignment through their own User. They never gain Actor editing permission. */
export async function submitRealmCommand(actor:any,command:RealmCommand):Promise<void>{
  requireCommandAccess(actor,game.user,command);
  if(game.user.isGM&&registration)await registration;
  const gm=coordinator();if(!gm)throw new Error("Um Mestre precisa estar conectado com o módulo atualizado para salvar esta alteração.");
  const operationId=foundry.utils.randomID();
  if(gm.userId===game.user.id&&gm.sessionId===game.socket.id)return executeRealmCommand(actor,game.user,command,operationId,dependencies());
  const doc=!game.user.isGM&&!actor.testUserPermission(game.user,3)?game.user:actor;
  const createdAt=rpcNow();
  const promise=new Promise<void>((resolve,reject)=>{
    const timer=window.setTimeout(()=>{
      pending.delete(operationId);
      const saved=actor.getFlag(MODULE_ID,"state")?.operations?.[operationId];
      void doc.update({[`flags.${MODULE_ID}.requests.-=${operationId}`]:null}).catch(console.error);
      if(saved)resolve();else reject(new Error("Sem confirmação do Mestre. Confira a conexão e o histórico antes de repetir a alteração."));
    },REQUEST_TTL);
    pending.set(operationId,{resolve,reject,timer,authorityId:gm.userId,documentKey:documentKey(doc)});
  });
  try{await doc.update({[`flags.${MODULE_ID}.requests.${operationId}`]:{command,actorId:actor.id,userId:game.user.id,createdAt,expiresAt:createdAt+REQUEST_TTL,authorityId:gm.userId,sessionId:gm.sessionId,protocol:PROTOCOL}});}
  catch(e){const p=pending.get(operationId);if(p){clearTimeout(p.timer);pending.delete(operationId);p.reject(e instanceof Error?e:new Error(String(e)));}}
  return promise;
}
function isSelfAssignment(command:unknown):boolean{return isRecord(command)&&command.action==="binding.save"&&command.kind==="activity";}
function onRequestDocument(doc:any,changed:any,_options:unknown,senderId:string):void{
  if(!game.ready)return;
  const data=changed.flags?.[MODULE_ID];if(!data)return;
  for(const [id,response] of Object.entries(data.responses??{})){
    const p=pending.get(id);if(!p||p.documentKey!==documentKey(doc)||senderId!==p.authorityId||!isRecord(response))continue;
    clearTimeout(p.timer);pending.delete(id);response.ok===true?p.resolve():p.reject(new Error(String(response.error??"Operação recusada.")));
  }
  const designated=coordinator();
  if(!designated||designated.userId!==game.user.id||designated.sessionId!==game.socket.id||!isRecord(data.requests))return;
  for(const [id,request] of Object.entries(data.requests)){
    try{safeId(id);}catch{continue;}
    if(!isRecord(request)||request.protocol!==PROTOCOL||request.authorityId!==game.user.id||request.sessionId!==game.socket.id)continue;
    const key=`${documentKey(doc)}:${id}`;if(inFlight.has(key))continue;inFlight.add(key);
    void handleRequest(doc,id,request,senderId).catch(console.error).finally(()=>inFlight.delete(key));
  }
}
async function handleRequest(doc:any,id:string,request:Record<string,unknown>,senderId:string):Promise<void>{
  let response:Record<string,unknown>;
  try{
    validateRequestTime(request,senderId,rpcNow(),REQUEST_TTL);
    if(doc.documentName==="User"&&(doc.id!==senderId||!isSelfAssignment(request.command)))throw new Error("Este canal permite apenas vincular seu personagem a uma Quest.");
    const actor=doc.documentName==="User"?game.actors.get(request.actorId):doc;
    if(!actor?.getFlag(MODULE_ID,"state"))throw new Error("Reino não encontrado.");
    const sender=game.users.get(senderId);if(!sender)throw new Error("Usuário não encontrado.");
    await executeRealmCommand(actor,sender,request.command,id,dependencies());
    response={ok:true,at:rpcNow()};
  }catch(e){console.error(`${MODULE_ID}: operação recusada`,e);response={ok:false,error:e instanceof Error?e.message:String(e),at:rpcNow()};}
  const stale=Object.entries(doc.getFlag(MODULE_ID,"responses")??{}).filter(([k,v])=>k!==id&&(!isRecord(v)||typeof v.at!=="number"||rpcNow()-v.at>15000)).map(([k])=>[`flags.${MODULE_ID}.responses.-=${k}`,null]);
  await doc.update({[`flags.${MODULE_ID}.responses.${id}`]:response,[`flags.${MODULE_ID}.requests.-=${id}`]:null,...Object.fromEntries(stale)});
  window.setTimeout(()=>{if(doc.getFlag(MODULE_ID,"responses")?.[id])void doc.update({[`flags.${MODULE_ID}.responses.-=${id}`]:null}).catch(()=>{});},5000);
}
Hooks.on("updateActor",onRequestDocument);
Hooks.on("updateUser",onRequestDocument);
/** Expired stored commands are removed, never replayed without a fresh authenticated hook. */
async function cleanupRequests():Promise<void>{
  const gm=coordinator();if(!gm||gm.userId!==game.user.id||gm.sessionId!==game.socket.id)return;
  const now=rpcNow();let budget=50;
  for(const doc of [...game.actors,...game.users]){
    if(budget<=0)break;
    const patch:Record<string,unknown>={};
    for(const [id,request] of Object.entries(doc.getFlag(MODULE_ID,"requests")??{})){
      if(budget<=0)break;try{safeId(id);}catch{continue;}
      if(inFlight.has(`${documentKey(doc)}:${id}`))continue;
      const actor=doc.documentName==="User"&&isRecord(request)?game.actors.get(request.actorId):doc;
      const committed=actor?.getFlag(MODULE_ID,"state")?.operations?.[id];
      const expired=!isRecord(request)||request.protocol!==PROTOCOL||typeof request.expiresAt!=="number"||request.expiresAt<=now||typeof request.createdAt!=="number"||request.createdAt>now+1000;
      if(!committed&&!expired)continue;
      patch[`flags.${MODULE_ID}.requests.-=${id}`]=null;budget--;
      if(committed)patch[`flags.${MODULE_ID}.responses.${id}`]={ok:true,at:now};
    }
    for(const [id,response] of Object.entries(doc.getFlag(MODULE_ID,"responses")??{})){
      if(budget<=0)break;try{safeId(id);}catch{continue;}
      if(!isRecord(response)||typeof response.at!=="number"||now-response.at>30000){patch[`flags.${MODULE_ID}.responses.-=${id}`]=null;budget--;}
    }
    if(Object.keys(patch).length)await doc.update(patch);
  }
}
