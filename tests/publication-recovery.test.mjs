import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULE_ID} from '../scripts/core.js';
const hooks=new Map();globalThis.Hooks={on:(n,f)=>hooks.set(n,f)};
const {prepareFeat,publishFeat}=await import('../scripts/feat-chat.js');
const read=(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o);
function patch(o,p){for(const [path,value]of Object.entries(p)){const bits=path.split('.');let at=o;for(const k of bits.slice(0,-1))at=at[k]??={};at[bits.at(-1)]=value;}}
function fixture(){
 const rows=[];let sequence=0,rolls=0,failSource=true,loseAck=true;
 rows.get=id=>rows.find(m=>m.id===id);globalThis.game={messages:rows,users:[{id:'gm',isGM:true},{id:'owner',isGM:false}]};
 const doc=(data,id)=>({id,...structuredClone(data),getFlag(scope,key){return this.flags?.[scope]?.[key]},toObject(){return structuredClone(data)},async update(p){if(this.id==='source'&&failSource){failSource=false;throw Error('Source offline');}patch(this,p);if(this.id!=='source'&&loseAck&&!this.getFlag(MODULE_ID,'publicationPending')){loseAck=false;throw Error('Acknowledgment lost');}return this;}});
 const source=doc({author:{id:'owner',isGM:false},whisper:['gm'],blind:true,flags:{[MODULE_ID]:{rollData:{title:'Segredo',week:1,skillId:'skill_trade',modifiers:[{slug:'base',label:'Base',modifier:5,type:'untyped',ignored:false}]}}}},'source');rows.push(source);
 globalThis.ChatMessage={create:async data=>{const m=doc(data,`receipt_${++sequence}`);rows.push(m);return m;}};
 game.pf2e={Modifier:class{constructor(data){Object.assign(this,data)}},CheckModifier:class{constructor(_slug,{modifiers}){this.modifiers=modifiers}},Check:{roll:async(_check,context,_event,callback)=>{assert.equal(context.createMessage,false);rolls++;await callback({total:22},'success',{toObject:()=>({flavor:'PF2e native result',content:'22',rolls:['private die'],flags:{pf2e:{context:{isReroll:true}}}})});}}};
 const actor={id:'realm',name:'Reino',getFlag:()=>({realmId:'realm',activityDefinitions:{},projects:{}})};
 return {actor,source,rows,rolls:()=>rolls};
}
test('recibo preserva privacidade e mesma rolagem após falha na origem e perda de confirmação',async()=>{
 const f=fixture(),publication={kind:'reroll',title:'Livre e justo',userId:'owner',sourceId:'source',mode:'blindroll'};
 const id=await prepareFeat(f.actor,publication,'job_once');assert.equal(await prepareFeat(f.actor,publication,'job_once'),id);assert.equal(f.rolls(),1);
 const receipt=f.rows.get(id);assert.deepEqual(receipt.whisper,['gm']);assert.equal(receipt.blind,true);assert.equal(receipt.author,'owner');assert.equal(receipt.getFlag(MODULE_ID,'publicationPending'),true);
 await assert.rejects(publishFeat(f.actor,id,'job_once'),/Source offline/);assert.equal(receipt.getFlag(MODULE_ID,'publicationPending'),true);
 await assert.rejects(publishFeat(f.actor,id,'job_once'),/Acknowledgment lost/);
 await publishFeat(f.actor,id,'job_once');assert.equal(f.rows.length,2);assert.equal(f.rolls(),1);assert.equal(receipt.getFlag(MODULE_ID,'publicationPending'),false);assert.equal(f.source.getFlag(MODULE_ID,'superseded'),id);
 assert.deepEqual(receipt.flags.pf2e,{context:{isReroll:true}});
});

test('rerrolagem retira Livre e justo e reavalia a melhor construção do snapshot original',async()=>{
 const f=fixture();f.source.flags[MODULE_ID].rollData.modifiers.push(
  {slug:'feat',originId:'feat:kingdom_free_and_fair:catalog_leadership',label:'Livre e justo',modifier:2,type:'circumstance',ignored:false},
  {slug:'typed',originId:'building:typed:bonus',label:'Construção +3',modifier:3,type:'circumstance',ignored:true},
  {slug:'plain',originId:'building:plain:bonus',label:'Construção +2',modifier:2,type:'untyped',ignored:false});
 const native=game.pf2e.Check.roll;let selected;
 game.pf2e.Check.roll=async(check,...args)=>{selected=check.modifiers;return native(check,...args);};
 await prepareFeat(f.actor,{kind:'reroll',title:'Livre e justo',userId:'owner',sourceId:'source',mode:'blindroll'},'reroll_buildings');
 assert.equal(selected.find(m=>m.slug==='typed').ignored,false);assert.equal(selected.find(m=>m.slug==='plain').ignored,true);assert.equal(selected.some(m=>m.slug==='feat'),false);
 assert.equal(f.source.flags[MODULE_ID].rollData.modifiers.find(m=>m.slug==='typed').ignored,true);
});
