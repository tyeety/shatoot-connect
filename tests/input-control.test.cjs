'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {InputControl}=require('../desktop/input-control.cjs');
test('only one guest controls the desktop; idle handoff never interrupts held drags/keys',()=>{
 let time=0;const released=[],a={},b={},control=new InputControl({now:()=>time,release:s=>released.push(s)});
 assert.equal(control.accept(a,{type:'layout'}),false);
 assert.equal(control.accept(a,{type:'button',button:0,down:true,x:0,y:0}),true);
 time=10000;assert.equal(control.accept(b,{type:'move',x:0,y:0}),false);
 assert.equal(control.accept(a,{type:'button',button:0,down:false,x:0,y:0}),true);
 time+=1999;assert.equal(control.accept(b,{type:'move',x:0,y:0}),false);
 time++;assert.equal(control.accept(b,{type:'key',code:'KeyA',down:true}),true);assert.deepEqual(released,[a]);
 time+=5000;assert.equal(control.accept(a,{type:'move',x:0,y:0}),false);
 control.drop(a);assert.equal(control.owner,b);
 control.drop(b);assert.deepEqual(released,[a,b]);assert.equal(control.accept(a,{type:'key',code:'KeyA',down:false}),false);
});
test('physical host activity releases the controller and pauses every viewer until quiet',()=>{
 let time=0;const a={},b={},released=[],control=new InputControl({now:()=>time,release:s=>released.push(s)});
 control.accept(a,{type:'button',button:0,down:true,x:0,y:0});control.activity();assert.deepEqual(released,[a]);
 assert.equal(control.reason(a),'host');assert.equal(control.accept(a,{type:'move',x:0,y:0}),false);assert.equal(control.accept(b,{type:'move',x:0,y:0}),false);
 time=1500;control.activity();time=3000;assert.equal(control.accept(b,{type:'move',x:0,y:0}),false);
 time=3500;assert.equal(control.accept(b,{type:'move',x:0,y:0}),true);assert.equal(control.reason(a),'busy');
 assert.equal(control.accept(a,{type:'release'}),false);assert.equal(control.owner,b);
 control.accept(b,{type:'release'});assert.equal(control.owner,null);
});
test('invalid packets cannot claim control and a held physical key keeps all guests paused',()=>{
 let time=0;const control=new InputControl({now:()=>time}),a={};
 for(const packet of [{type:'move',x:NaN,y:0},{type:'button',button:3,down:true,x:0,y:0},{type:'physical-key',scan:0,vk:65,down:true}])assert.equal(control.accept(a,packet),false);
 assert.equal(control.owner,null);control.host(true);time=100000;assert.equal(control.accept(a,{type:'move',x:0,y:0}),false);
 control.host(false);assert.equal(control.accept(a,{type:'move',x:0,y:0}),true);
});
