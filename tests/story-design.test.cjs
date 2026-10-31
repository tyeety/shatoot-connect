'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {design}=require('../desktop/ui/story-design.js');
test('story layouts bound geometry, styles and text without retaining foreign fields',()=>{
 const value=design({background:'#aa00ff',media:{scale:3,rotation:-90},layers:[{type:'sticker',text:'🐫',rotation:120,x:.9,shape:'bubble',url:'https://foreign.invalid'}]});
 assert.equal(value.layers[0].rotation,120);assert.equal(value.layers[0].url,undefined);assert.equal(value.media.x,.5);
 for(const invalid of [{media:{scale:Infinity},layers:[]},{layers:new Array(25).fill({type:'text',text:'x'})},{layers:[{type:'html',text:'<script>'}]},{layers:[{type:'text',text:'x',color:'url(x)'}]},{layers:[{type:'text',text:'x',rotation:1000}]}])assert.throws(()=>design(invalid));
});
test('all emoji have offline bilingual search metadata, including camel synonyms and skin-tone variants',()=>{
 const groups=require('../desktop/ui/assets/emoji-data.js').groups,keywords=require('../desktop/ui/assets/emoji-keywords.js');
 for(const [emoji]of groups.flatMap(g=>g.items))assert.ok(keywords[emoji]?.length>3,emoji);
 for(const emoji of ['🐪','🐫'])for(const term of ['شتر','کوهان','حیوان','camel','hump'])assert.ok(keywords[emoji].includes(term));
 assert.ok(keywords['👍🏽'].includes('thumb'));assert.ok(Object.values(keywords).filter(s=>/[\u0600-\u06ff]/.test(s)).length>3000);
});
