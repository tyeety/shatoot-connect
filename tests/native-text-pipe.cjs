'use strict';
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),path=require('node:path');
const text='سلام. علیرضا یک پیام فارسی با نیم‌فاصله 👋\r\nCopy / کپی';
const helper=process.env.SHATOOTCONNECT_KEYBOARD_HELPER||path.join(__dirname,'../native/publish/ShatootConnect.Input.exe');
const child=spawn(helper,['--text-pipe-self-test'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
const timer=setTimeout(()=>{child.kill();throw Error('Native UTF-8 pipe probe timed out');},10000);
child.once('error',error=>{clearTimeout(timer);throw error;});
child.once('exit',async code=>{clearTimeout(timer);assert.equal(stderr,'');assert.equal(code,0);const result=JSON.parse(stdout);assert.equal(result.ok,true);assert.equal(result.text,text);assert.equal(result.inputCodePage,65001);assert.equal(result.outputCodePage,65001);console.log('Native UTF-8 JSON pipe preserved Persian, ZWNJ, emoji and newlines; clipboard untouched.');if(process.env.GITHUB_ACTIONS==='true')await clipboardRoundTrip();});
// Deliberately split multibyte characters across writes, as real pipes can do.
const bytes=Buffer.from(JSON.stringify({text})+'\n','utf8');for(let at=0;at<bytes.length;at+=7)child.stdin.write(bytes.subarray(at,at+7));child.stdin.end();

async function clipboardRoundTrip(){
  // The production clipboard path runs only on the isolated CI desktop.
  // Never replace a developer's interactive clipboard during local testing.
  const worker=spawn(helper,['--clipboard'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const lines=require('node:readline').createInterface({input:worker.stdout});
  let next=0;const pending=new Map();let errors='';worker.stderr.setEncoding('utf8');worker.stderr.on('data',data=>errors+=data);
  worker.once('error',error=>{for(const task of pending.values())task.reject(error);});
  worker.once('exit',code=>{for(const task of pending.values())task.reject(Error('Unicode clipboard worker exited before replying: '+code));});
  lines.on('line',line=>{const value=JSON.parse(line),task=pending.get(value.id);if(task){pending.delete(value.id);value.error?task.reject(Error(value.error)):task.resolve(value);}});
  const request=value=>Promise.race([new Promise((resolve,reject)=>{value.id=++next;pending.set(value.id,{resolve,reject});worker.stdin.write(JSON.stringify(value)+'\n');}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Unicode clipboard round-trip timed out')),10000);timer.unref();})]);
  try{await request({op:'write',text});const result=await request({op:'read'});assert.equal(result.text,text);assert.equal(result.supported,true);assert.deepEqual(result.files,[]);assert.equal(errors,'');console.log('Production Windows CF_UNICODETEXT preserved Persian, ZWNJ, emoji and newlines.');}
  finally{worker.stdin.end();lines.close();const timer=setTimeout(()=>worker.kill(),1000);timer.unref();}
}
