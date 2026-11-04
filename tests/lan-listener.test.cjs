'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {listenDirect}=require('../desktop/lan-listener.cjs');
test('reserved Windows port falls back without touching system exclusions',async()=>{
 const attempted=[],closed=[];
 const result=await listenDirect(port=>({port,listen:async()=>{attempted.push(port);if(port===8788)throw Object.assign(Error('reserved'),{code:'EACCES'});},close:async()=>{closed.push(port);}}));
 assert.deepEqual(attempted,[8788,28788]);assert.deepEqual(closed,[8788]);assert.equal(result.port,28788);
});
test('reuse a persisted port, recover from occupancy and preserve fatal errors',async()=>{
 const ports=[];await listenDirect(port=>({listen:async()=>{ports.push(port);if(port===28788)throw Object.assign(Error('occupied'),{code:'EADDRINUSE'});},close:async()=>{}}),28788);
 assert.deepEqual(ports,[28788,8788]);
 let closed=0;const failure=Object.assign(Error('other'),{code:'EIO'});
 await assert.rejects(listenDirect(()=>({listen:async()=>{throw failure;},close:async()=>{closed++;}})),error=>error===failure);assert.equal(closed,1);
});
test('let Windows allocate a free port when every fixed candidate is unavailable',async()=>{
 const ports=[];const service=await listenDirect(port=>({port,listen:async()=>{ports.push(port);if(port)throw Object.assign(Error('reserved'),{code:'EACCES'});},close:async()=>{}}));
 assert.deepEqual(ports,[8788,28788,38788,48788,0]);assert.equal(service.port,0);
 const ephemeral=[];await listenDirect(port=>({listen:async()=>{ephemeral.push(port);},close:async()=>{}}),0);assert.deepEqual(ephemeral,[0]);
});
