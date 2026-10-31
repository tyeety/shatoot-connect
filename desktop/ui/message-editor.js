import {Editor,Mark,Node} from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from '@tiptap/markdown';
import {TableKit} from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

function style(name,marker,tag){return Mark.create({
 name,parseHTML:()=>[{tag:name==='spoiler'?'span.editor-spoiler':tag}],renderHTML:()=>[tag,name==='spoiler'?{class:'editor-spoiler'}:{},0],
 addCommands(){return {['toggle'+name[0].toUpperCase()+name.slice(1)]:()=>({commands})=>commands.toggleMark(name)};},
 markdownTokenizer:{name,level:'inline',start:src=>src.indexOf(marker),tokenize(src,tokens,lexer){if(!src.startsWith(marker))return;const end=src.indexOf(marker,marker.length);if(end<=marker.length)return;return {type:name,raw:src.slice(0,end+marker.length),tokens:lexer.inlineTokens(src.slice(marker.length,end))};}},
 parseMarkdown:(token,helpers)=>helpers.applyMark(name,helpers.parseInline(token.tokens||[])),
 renderMarkdown:(node,helpers)=>marker+helpers.renderChildren(node)+marker,
 });}

export function create({element,onUpdate,onSelection,resolveMedia,onPaste,onKey}){
 const Media=Node.create({
  name:'chatMedia',group:'inline',inline:true,atom:true,draggable:true,
  addAttributes:()=>({src:{default:''},alt:{default:''}}),
  parseHTML:()=>[{tag:'img',getAttrs:el=>({src:el.getAttribute('src'),alt:el.getAttribute('alt')||''})}],
  renderHTML:({node})=>['span',{'data-chat-media':node.attrs.src},node.attrs.alt||'Media'],
  markdownTokenName:'image',parseMarkdown:token=>({type:'chatMedia',attrs:{src:token.href,alt:token.text||''}}),
  renderMarkdown:node=>'!['+String(node.attrs.alt||'').replace(/[\[\]\\]/g,'\\$&')+']('+node.attrs.src+')',
  addNodeView(){return ({node})=>{
   const dom=document.createElement('span');dom.className='editor-media';dom.contentEditable='false';dom.textContent=node.attrs.alt||'Media';
   resolveMedia(node.attrs.src).then(file=>{if(!file)return;const media=document.createElement(file.mime.startsWith('image/')?'img':file.mime.startsWith('video/')?'video':'audio');media.src=file.url;media.alt=node.attrs.alt;media.preload='metadata';if(media.tagName!=='IMG')media.controls=true;dom.replaceChildren(media);}).catch(()=>{});
   return {dom,stopEvent:event=>event.target.closest('audio,video')!==null};
  };},
 });
 const editor=new Editor({element,injectCSS:false,extensions:[StarterKit.configure({paragraph:false,underline:false,heading:{HTMLAttributes:{dir:'auto'}},link:{openOnClick:false,protocols:['http','https','mailto']}}),Paragraph.extend({parseMarkdown:(token,helpers)=>helpers.createNode('paragraph',undefined,helpers.parseInline(token.tokens||[]))}).configure({HTMLAttributes:{dir:'auto'}}),TableKit.configure({table:{resizable:false}}),TaskList,TaskItem.configure({nested:true}),style('underline','++','u'),style('spoiler','||','span'),Media,Markdown.configure({markedOptions:{gfm:true,breaks:true}})],content:'',contentType:'markdown',
  editorProps:{attributes:{class:'markdown-editor message-body',role:'textbox','aria-multiline':'true',dir:'auto'},handlePaste:(_view,event)=>onPaste(event),handleKeyDown:(_view,event)=>onKey(event)},
  onUpdate:()=>onUpdate(editor.getMarkdown()),onSelectionUpdate:()=>onSelection?.(),
 });
 return editor;
}
