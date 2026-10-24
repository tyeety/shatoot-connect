'use strict';
window.installVoiceMessages = ({api,conversation,available,send,error}) => {
  const tr=text=>window.i18n.translate(text), players=new Map();
  const actions=document.createElement('div');actions.className='voice-actions';
  const record=document.createElement('button');record.id='chat-record-voice';record.type='button';record.className='small-button';
  const icon=document.createElement('span');icon.className='mi mic';icon.setAttribute('aria-hidden','true');
  const caption=document.createElement('span'),clock=document.createElement('output');clock.className='voice-clock';clock.setAttribute('aria-live','off');
  record.append(icon,caption);
  const cancel=document.createElement('button');cancel.id='chat-cancel-voice';cancel.type='button';cancel.className='icon-button';cancel.innerHTML='<span class="mi close" aria-hidden="true"></span>';
  actions.append(record,clock,cancel);document.querySelector('#chat-send-files').after(actions);
  let recording=null,starting=false,generation=0,sending=false;
  function sync(){
    record.disabled=starting||sending||(!recording&&!available());record.classList.toggle('voice-recording',!!recording);
    icon.className=`mi ${recording?'stop':'mic'}`;caption.textContent=tr(recording?'Send voice':'Record voice');record.title=caption.textContent;
    cancel.hidden=!recording&&!starting;cancel.title=tr('Cancel recording');cancel.setAttribute('aria-label',cancel.title);
    clock.hidden=!recording;
  }
  function release(current){clearInterval(current.timer);for(const track of current.stream.getTracks())track.stop();}
  function stop(discard=false){
    generation++;starting=false;const current=recording;recording=null;
    if(current){current.discard=discard;if(!discard)sending=current;release(current);if(current.recorder.state!=='inactive')current.recorder.stop();}
    else api.voiceRecording(false).catch(()=>{});
    sync();
  }
  async function start(){
    if(starting||recording||sending||!available())return;
    const target=conversation(),revision=++generation;starting=true;sync();let stream;
    try{
      if(!window.MediaRecorder||!MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))throw new Error('Voice recording is not supported.');
      await api.voiceRecording(true);if(revision!==generation)return;
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(revision!==generation||target!==conversation()){for(const track of stream.getTracks())track.stop();return;}
      await api.voiceRecording(false);if(revision!==generation){for(const track of stream.getTracks())track.stop();return;}
      const recorder=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:64000});
      const current={stream,recorder,target,chunks:[],bytes:0,started:Date.now(),discard:false};recording=current;
      recorder.ondataavailable=event=>{if(event.data.size){current.bytes+=event.data.size;if(current.bytes>10*1024**2){current.discard=true;if(recording===current)stop(true);error(new Error('Invalid voice message.'));}else current.chunks.push(event.data);}};
      recorder.onerror=()=>{current.discard=true;release(current);if(recording===current)stop(true);error(new Error('Microphone unavailable. Check microphone access in Windows Settings.'));};
      recorder.onstop=async()=>{
        if(recording===current){recording=null;generation++;}release(current);if(current.discard||!current.chunks.length){if(sending===current)sending=false;sync();return;}
        sending=current;sync();
        try{
          const blob=new Blob(current.chunks,{type:'audio/webm'});
          const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Invalid voice message.'));reader.readAsDataURL(blob);});
          await send(current.target,data);
        }catch(e){error(e);}finally{if(sending===current)sending=false;sync();}
      };
      recorder.start(1000);current.timer=setInterval(()=>{const seconds=Math.floor((Date.now()-current.started)/1000);clock.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;if(seconds>=300)stop();},250);
      clock.textContent='00:00';
    }catch(e){stream?.getTracks().forEach(track=>track.stop());if(revision===generation)error(e.message==='Voice recording is not supported.'?e:new Error('Microphone unavailable. Check microphone access in Windows Settings.'));}
    finally{if(revision===generation){starting=false;await api.voiceRecording(false).catch(()=>{});}sync();}
  }
  record.onclick=()=>{if(recording)stop();else start();};cancel.onclick=()=>stop(true);
  function reset(){stop(true);for(const entry of players.values()){entry.audio.pause();URL.revokeObjectURL(entry.url);}players.clear();}
  function attachment(item,row){
    if(!row.attachment||!/^Voice-[a-f0-9-]{36}\.webm$/i.test(row.text))return;
    item.querySelector('p').textContent=tr('Voice message');
    const cached=players.get(row.attachment);if(cached){item.append(cached.audio);return;}
    const play=document.createElement('button');play.type='button';play.className='small-button voice-play';play.innerHTML='<span class="mi play_arrow" aria-hidden="true"></span>';const label=document.createElement('span');label.textContent=tr('Play voice');play.append(label);item.append(play);
    play.onclick=async()=>{
      play.disabled=true;const revision=generation;
      try{
        const data=await api.collaboration('voice-data',{token:row.attachment});
        if(!item.isConnected||revision!==generation||!document.getElementById('messenger-dialog').open)return;
        const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'audio/webm'})),audio=document.createElement('audio');
        audio.className='voice-player';audio.controls=true;audio.preload='metadata';audio.src=url;audio.setAttribute('aria-label',tr('Voice message'));
        audio.onplay=()=>{for(const entry of players.values())if(entry.audio!==audio)entry.audio.pause();};
        audio.onerror=()=>error(new Error('Invalid voice message.'));
        if(players.size>=20){const [key,entry]=players.entries().next().value;entry.audio.pause();URL.revokeObjectURL(entry.url);players.delete(key);}
        players.set(row.attachment,{audio,url});play.replaceWith(audio);await audio.play();
      }catch(e){error(e);}finally{play.disabled=false;}
    };
  }
  document.getElementById('messenger-dialog').addEventListener('close',reset);window.addEventListener('beforeunload',reset);window.addEventListener('shatoot-language-change',sync);
  sync();return {sync,reset,attachment};
};
