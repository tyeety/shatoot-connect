'use strict';
class MotionSequence{
 constructor(){this.reset();}
 reset(){this.epoch=0;this.sequence=0;this.receivedEpoch=0;this.receivedSequence=-1;}
 packet(data){if(['button','wheel','release'].includes(data.type))this.epoch++;return{...data,motionEpoch:this.epoch,motionSequence:++this.sequence};}
 accept(data,fast=false){
  if(fast&&data.type!=='move')return false;
  if(data.motionEpoch===undefined&&data.motionSequence===undefined)return !fast;
  if(!Number.isSafeInteger(data.motionEpoch)||data.motionEpoch<0||!Number.isSafeInteger(data.motionSequence)||data.motionSequence<1)return false;
  if(data.motionEpoch<this.receivedEpoch||data.motionSequence<=this.receivedSequence||fast&&data.motionEpoch!==this.receivedEpoch)return false;
  this.receivedEpoch=data.motionEpoch;this.receivedSequence=data.motionSequence;return true;
 }
}
if(typeof module!=='undefined')module.exports={MotionSequence};else window.MotionSequence=MotionSequence;
