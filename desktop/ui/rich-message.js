'use strict';
(function(root){
 function parser(MarkdownIt){
  const md=new MarkdownIt({html:false,breaks:true,linkify:true,maxNesting:20}).use(typeof module!=='undefined'?require('markdown-it-task-lists'):root.markdownit.taskLists);
  md.validateLink=url=>/^(https?:|mailto:|attachment:\d{1,2}$)/i.test(url);
  md.renderer.rules.image=(tokens,index)=>{const token=tokens[index],url=token.attrGet('src'),match=/^attachment:(\d{1,2})$/.exec(url||'');return match?`<span class="inline-media" data-media-index="${Number(match[1])}">${md.utils.escapeHtml(token.content||'Media')}</span>`:md.utils.escapeHtml(token.content||'');};
  const textRule=md.inline.ruler.__rules__.find(rule=>rule.name==='text').fn;
  md.inline.ruler.at('text',(state,silent)=>{const pipe=state.src.indexOf('||',state.pos),max=state.posMax;if(pipe===state.pos){if(!silent)state.pending+='|';state.pos++;return true;}if(pipe>state.pos)state.posMax=Math.min(max,pipe);try{return textRule(state,silent);}finally{state.posMax=max;}});
  md.inline.ruler.before('text','chat_style',(state,silent)=>{
   const marker=state.src.slice(state.pos,state.pos+2);if(!['||','++'].includes(marker)||(state.env.chatDepth||0)>12)return false;const end=state.src.indexOf(marker,state.pos+2);if(end<=state.pos+2)return false;if(!silent){const open=state.push(marker==='||'?'spoiler_open':'underline_open',marker==='||'?'span':'u',1);if(marker==='||'){open.attrSet('class','spoiler');open.attrSet('role','button');open.attrSet('tabindex','0');open.attrSet('aria-expanded','false');}const children=[];state.env.chatDepth=(state.env.chatDepth||0)+1;try{md.inline.parse(state.src.slice(state.pos+2,end),md,state.env,children);}finally{state.env.chatDepth--;}for(const child of children)state.tokens.push(child);state.push(marker==='||'?'spoiler_close':'underline_close',marker==='||'?'span':'u',-1);}state.pos=end+2;return true;
  });return md;
 }
 function prepareMedia(md,text,files){
  const tokens=md.parse(String(text),{}),used=new Set(),protectedRanges=[],starts=[0];for(const line of String(text).split('\n'))starts.push(starts.at(-1)+line.length+1);for(const token of tokens)if(['fence','code_block'].includes(token.type)&&token.map)protectedRanges.push([starts[token.map[0]],starts[token.map[1]]]);for(const match of String(text).matchAll(/(?<![\\`])(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g))protectedRanges.push([match.index,match.index+match[0].length]);const visit=tokens=>{for(const token of tokens){if(token.type==='image'){const match=/^attachment:(\d{1,2})$/.exec(token.attrGet('src')||'');if(match&&files[Number(match[1])])used.add(Number(match[1]));}if(token.children)visit(token.children);}};visit(tokens);
  const indices=[...used],mapping=new Map(indices.map((index,next)=>[index,next]));
  return {text:String(text).replace(/attachment:(\d{1,2})(?=\))/g,(original,index,offset)=>!protectedRanges.some(([start,end])=>offset>=start&&offset<end)&&mapping.has(Number(index))?'attachment:'+mapping.get(Number(index)):original),files:indices.map(index=>files[index])};
 }
 function render(element,text,{token,openLink,openFile}={}){
  element.innerHTML=browser.render(String(text));element.dataset.richSource=text;
  const hydrate=()=>{for(const node of element.querySelectorAll('[data-media-index]')){if(node.dataset.loaded||node.closest('.spoiler:not(.revealed)'))continue;const index=Number(node.dataset.mediaIndex);if(!token||!openFile)continue;node.dataset.loaded='true';openFile(index).then(file=>{if(!node.isConnected||!file)return;const media=document.createElement(file.mime.startsWith('image/')?'img':file.mime.startsWith('video/')?'video':'audio');media.src=`shatoot-media://${token}/${index}`;media.alt=file.name;media.loading='lazy';media.preload='none';if(media.tagName!=='IMG')media.controls=true;node.replaceChildren(media);}).catch(()=>{});}};
  for(const spoiler of element.querySelectorAll('.spoiler')){const reveal=e=>{if(spoiler.classList.contains('revealed'))return;e.preventDefault();e.stopPropagation();spoiler.classList.add('revealed');spoiler.setAttribute('aria-expanded','true');hydrate();};spoiler.onclick=reveal;spoiler.onkeydown=e=>{if(['Enter',' '].includes(e.key))reveal(e);};}
  for(const link of element.querySelectorAll('a'))link.onclick=e=>{e.preventDefault();e.stopPropagation();openLink?.(link.href);};hydrate();
 }
 let browser;if(typeof module!=='undefined')module.exports={parser,prepareMedia};else{browser=parser(root.markdownit);root.RichMessage={render,prepareMedia:(text,files)=>prepareMedia(browser,text,files)};}
})(globalThis);
