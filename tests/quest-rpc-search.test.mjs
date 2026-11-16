import test from 'node:test';import assert from 'node:assert/strict';
import {rpcNow,validateRequestTime} from '../scripts/rpc-time.js';
import {taskNameMatches} from '../scripts/task-browser.js';
test('horário RPC usa o relógio sincronizado do Foundry, independente do relógio do computador',()=>{
 const original=Date.now;globalThis.game={time:{serverTime:120000.8}};
 try{for(const offset of [-300000,5000,300000]){Date.now=()=>1794790000000+offset;assert.equal(rpcNow(),120000);validateRequestTime({userId:'player',createdAt:120000,expiresAt:140000},'player',rpcNow(),20000);}}finally{Date.now=original;}
});
test('horário ainda não sincronizado, pedido vencido e identidade falsa continuam recusados',()=>{
 globalThis.game={time:{serverTime:NaN}};assert.throws(rpcNow,/sincronizando/);const req={userId:'player',createdAt:10000,expiresAt:30000};assert.throws(()=>validateRequestTime(req,'other',10000,20000),/identidade/);assert.throws(()=>validateRequestTime(req,'player',30000,20000),/expirou/);for(const bad of [{createdAt:12000},{expiresAt:30001},{expiresAt:9999},{createdAt:1.5}])assert.throws(()=>validateRequestTime({...req,...bad},'player',10000,20000));
});
test('pesquisa por nome ignora acentos, caixa e espaços externos e trata símbolos como texto',()=>{
 assert.equal(taskNameMatches('Construção do Armazém',' ARMAZEM '),true);assert.equal(taskNameMatches('Pescar nas margens de Arx','PESCAR'),true);assert.equal(taskNameMatches('Patrulha [Norte]','[Norte]'),true);assert.equal(taskNameMatches('Pescar','.*'),false);assert.equal(taskNameMatches('Cortar madeira',' '),true);assert.equal(taskNameMatches('Cortar madeira','pescar'),false);
});
