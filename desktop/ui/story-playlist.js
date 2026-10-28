(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.StoryPlaylist=factory();})(typeof window==='undefined'?globalThis:window,()=>{
 'use strict';
 function groups(stories,seen={},now=Date.now()){
  const map=new Map();for(const story of stories||[]){if(story.expiresAt<=now)continue;if(!map.has(story.sender))map.set(story.sender,{sender:story.sender,stories:[]});map.get(story.sender).stories.push(story);}
  const result=[...map.values()];for(const group of result){group.stories.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));group.seen=group.stories.every(s=>!!seen[s.id]);group.latest=Math.max(...group.stories.map(s=>s.at));}return result.sort((a,b)=>Number(a.seen)-Number(b.seen)||b.latest-a.latest||a.sender.localeCompare(b.sender));
 }
 function start(groups,sender,seen={}){const items=groups.flatMap(g=>g.stories),group=groups.find(g=>g.sender===sender);if(!group)return {items,index:-1};const first=group.stories.find(s=>!seen[s.id])||group.stories[0];return {items,index:items.findIndex(s=>s.id===first.id)};}
 return {groups,start};
});
