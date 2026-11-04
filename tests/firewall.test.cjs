'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict');
const{evaluateFirewall,firewallStatus,repairFirewall}=require('../desktop/firewall.cjs');
test('firewall shortcut detects denied/missing access only for active enabled profiles',()=>{
 const profile={id:2,enabled:true,defaultAction:0},rule={enabled:true,direction:1,action:1,profiles:2,protocol:256,ports:'*'};
 const state=(rules,profiles=[profile])=>evaluateFirewall({profiles,rules}).needsRepair;
 assert.equal(state([rule]),false);assert.equal(state([]),true);assert.equal(state([],[{...profile,enabled:false}]),false);
 assert.equal(state([{...rule,profiles:4}]),true);assert.equal(state([{...rule,enabled:false}]),true);
 assert.equal(state([rule,{...rule,action:0}]),true);assert.equal(state([rule,{...rule,action:0,profiles:4}]),false);
 assert.equal(state([rule,{...rule,action:0,direction:2}]),false);assert.equal(state([rule],[{...profile,blockAll:true}]),true);
 assert.equal(state([{...rule,protocol:6,ports:'8787-8789'},{...rule,protocol:17}]),false);
 assert.equal(state([{...rule,protocol:6},{...rule,protocol:17,ports:'8789'}]),true);
 assert.equal(state([],[{...profile,defaultAction:1}]),false);
});
test('firewall checks are read-only, hidden, bounded and return unknown on failure',async()=>{
 const run=(_exe,args,options,done)=>{assert.equal(options.windowsHide,true);assert.equal(options.timeout,10000);const script=Buffer.from(args.at(-1),'base64').toString('utf16le');assert.ok(script.includes('HNetCfg.FwPolicy2'));assert.ok(!/New-NetFirewallRule|Remove-NetFirewallRule|RunAs/.test(script));done(null,JSON.stringify({profiles:[{id:2,enabled:true,defaultAction:0}],rules:[]}));};
 assert.deepEqual(await firewallStatus('C:\\App\\app.exe',{run}),{needsRepair:true});
 assert.deepEqual(await firewallStatus('C:\\App\\app.exe',{run:(_e,_a,_o,done)=>done(Error('denied'))}),{needsRepair:null});
 assert.deepEqual(await firewallStatus('C:\\App\\app.exe',{run:(_e,_a,_o,done)=>done(null,'invalid')}),{needsRepair:null});
});

test('firewall evaluation follows the actual fallback LAN port',async()=>{
 const profiles=[{id:2,enabled:true,defaultAction:0}],base={enabled:true,direction:1,action:1,profiles:2};
 const rules=[{...base,protocol:6,ports:'28788'},{...base,protocol:17,ports:'*'}];
 assert.equal(evaluateFirewall({profiles,rules,tcpPort:28788}).needsRepair,false);
 assert.equal(evaluateFirewall({profiles,rules,tcpPort:8788}).needsRepair,true);
 assert.deepEqual(await firewallStatus('app.exe',{tcpPort:28788,run:(_exe,_args,_options,done)=>done(null,JSON.stringify({profiles,rules}))}),{needsRepair:false});
 assert.throws(()=>repairFirewall('app.exe','28788;exit'),/Invalid LAN port/);
 assert.equal(evaluateFirewall({profiles,rules:[...rules,{...base,action:0,protocol:6,ports:'28788'}],tcpPort:28788}).needsRepair,true);
});
