'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const md=require('../desktop/ui/rich-message.js').parser(require('markdown-it'));
test('rich messages preserve nested formatting, tables, lists and local media without active HTML or remote image loads',()=>{
 const html=md.render('**Bold** ++underlined++ ||**hidden** ![private](attachment:0)|| [link](https://example.com)\n\n- first\n- second\n\n| a | b |\n|---|---|\n| 1 | 2 |');
 for(const value of ['<strong>Bold</strong>','<u>underlined</u>','class="spoiler"','data-media-index="0"','<table>','<ul>','href="https://example.com"'])assert.ok(html.includes(value),value);
 const unsafe=md.render('<script>alert(1)</script> [x](javascript:alert(1)) ![tracking](https://evil.invalid/x) ![data](data:image/svg+xml;base64,PHN2Zz4=)');
 assert.ok(!unsafe.includes('<script>'));assert.ok(!unsafe.includes('href="javascript'));assert.ok(!unsafe.includes('<img'));assert.ok(!unsafe.includes('<iframe'));assert.ok(md.render('||'.repeat(4000)).length<100000);
});
test('local media supports seeking and bounded streams, rejects unsupported files and invalid ranges',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'shatoot-inline-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'clip.mp4');await fs.writeFile(file,Buffer.from('0123456789'));
 const {response}=require('../desktop/attachment-protocol.cjs');const reply=await response(file,new Request('https://local.invalid',{headers:{Range:'bytes=3-6'}}));assert.equal(reply.status,206);assert.equal(reply.headers.get('content-type'),'video/mp4');assert.equal(reply.headers.get('content-range'),'bytes 3-6/10');assert.equal(await reply.text(),'3456');
 assert.equal((await response(file,new Request('https://local.invalid',{headers:{Range:'bytes=100-'}}))).status,416);
 const suffix=await response(file,new Request('https://local.invalid',{headers:{Range:'bytes=-3'}}));assert.equal(await suffix.text(),'789');
 const head=await response(file,new Request('https://local.invalid',{method:'HEAD'}));assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
 const exe=path.join(root,'unsafe.exe');await fs.writeFile(exe,'bad');assert.equal((await response(exe,new Request('https://local.invalid'))).status,404);
});
