/* DubRoom 1.2.1 — host-led scene sync, reliable role readiness and persistent voice lobby. */
S.v13 ||= { lastStageSeq:0, pushTimer:0, lastPushAt:0, readyBusy:false, startBusy:false };

function v13IsSelect(){ return typeof v12Phase === 'function' && v12Phase() === 'select'; }
function v13IsRoles(){ return typeof v12Phase === 'function' && v12Phase() === 'roles'; }

function v13MountRemoteAudio(){
  const bin=document.querySelector('#voice-audio-bin');
  if(!bin)return;
  for(const a of S.remoteAudios.values()){
    if(a.parentNode!==bin)bin.appendChild(a);
    a.autoplay=true;a.playsInline=true;
  }
}
async function v13RestoreLobbyVoice(){
  if(!v13IsRoles() && v12Phase()!=='result')return;
  if(S.mode==='solo'||S.mode==='recording'||S.mode==='preview')return;
  S.voiceSuppressed=false;S._tempVoiceMute=false;
  v13MountRemoteAudio();
  try{await syncVoicePeers();}catch(e){console.warn('voice resync',e);}
  v13MountRemoteAudio();applyVoicePolicy();
  const enabled=!S.manualVoiceMute;
  for(const a of S.remoteAudios.values()){
    a.muted=!enabled;
    if(enabled)a.play().catch(()=>{});
  }
}

function v13LockGuestSceneControls(){
  if(!v13IsSelect()||isHost())return;
  document.querySelector('#play-button')?.setAttribute('disabled','');
  document.querySelector('#stop-button')?.setAttribute('disabled','');
  document.querySelectorAll('.v12-thumb').forEach(b=>{b.disabled=true;b.title='Навигацией управляет ведущий';});
  const wave=document.querySelector('#v12-wave');if(wave){wave.classList.add('v13-locked');wave.title='Навигацией управляет ведущий';}
  const hint=document.querySelector('.v12-key');if(hint)hint.textContent='СМОТРИТЕ ВМЕСТЕ · УПРАВЛЯЕТ ВЕДУЩИЙ';
}

function v13ApplyStagePlayer(d){
  if(!d||!v13IsSelect()||isHost())return;
  const seq=Number(d.seq)||0;if(seq&&seq<=S.v13.lastStageSeq)return;if(seq)S.v13.lastStageSeq=seq;
  S.room.player={...(S.room.player||{}),...d};
  const m=typeof v12Movie==='function'?v12Movie():document.querySelector('#movie');if(!m)return;
  const target=clamp(Number(d.currentTime)||0,0,typeof v12Duration==='function'?v12Duration():videoDuration());
  if(Math.abs((Number(m.currentTime)||0)-target)>.12)m.currentTime=target;
  v12PatchPlayhead?.(target);S.v12.focusTime=target;v12ScheduleThumbs?.(target);
  applyMovieSound();
  if(d.playing){
    if(m.paused)m.play().catch(()=>{m.muted=true;m.play().catch(()=>{});});
  }else if(!m.paused)m.pause();
}

function v13PushStagePlayer(force=false){
  if(!v13IsSelect()||!isHost()||!S.room?.video)return;
  const m=typeof v12Movie==='function'?v12Movie():document.querySelector('#movie');if(!m)return;
  const send=()=>{
    clearTimeout(S.v13.pushTimer);S.v13.pushTimer=0;S.v13.lastPushAt=performance.now();
    const body={participantId,currentTime:Number(m.currentTime)||0,playing:!m.paused&&!m.ended};
    S.room.player={...(S.room.player||{}),...body};
    fetch(`/api/rooms/${S.room.id}/stage/player`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});
  };
  const elapsed=performance.now()-S.v13.lastPushAt;
  if(force||elapsed>=90)return send();
  if(!S.v13.pushTimer)S.v13.pushTimer=setTimeout(send,Math.max(8,90-elapsed));
}

const v13OldSeek=v12Seek;
v12Seek=function(t){if(v13IsSelect()&&!isHost())return;v13OldSeek(t);if(v13IsSelect()&&isHost())v13PushStagePlayer(true);};

const v13OldTransportToggle=v9TransportToggle;
v9TransportToggle=async function(){
  if(v13IsSelect()&&!isHost())return;
  const result=await v13OldTransportToggle();
  if(v13IsSelect()&&isHost())v13PushStagePlayer(true);
  return result;
};
const v13OldTransportStop=v9TransportStop;
v9TransportStop=function(){
  if(v13IsSelect()&&!isHost())return;
  const result=v13OldTransportStop();
  if(v13IsSelect()&&isHost())v13PushStagePlayer(true);
  return result;
};

async function v13ToggleRoleReady(){
  if(S.v13.readyBusy)return;const p=me();if(!p)return;
  S.v13.readyBusy=true;const button=document.querySelector('#party-ready');if(button)button.disabled=true;
  try{
    const d=await json(`/api/rooms/${S.room.id}/participant`,{method:'POST',body:JSON.stringify({participantId,ready:!p.ready,armed:false})});
    if(d.participant)Object.assign(p,d.participant);
    S.localRecordArmed=false;S.voiceSuppressed=false;S._tempVoiceMute=false;
    v10PatchParty();await v13RestoreLobbyVoice();
  }catch(e){toast(e.message||'Не удалось изменить готовность.',true);}finally{S.v13.readyBusy=false;const b=document.querySelector('#party-ready');if(b)b.disabled=false;}
}
async function v13StartParty(){
  if(S.v13.startBusy||!isHost())return;if(!v10AllReady())return toast('Не все участники готовы.',true);
  S.v13.startBusy=true;const b=document.querySelector('#party-start');if(b)b.disabled=true;
  try{await json(`/api/rooms/${S.room.id}/party/start`,{method:'POST',body:JSON.stringify({participantId})});}
  catch(e){toast(e.message||'Не удалось начать озвучку.',true);S.v13.startBusy=false;v10PatchParty();}
}

/* Window capture runs before the legacy document-level party handler. */
window.addEventListener('click',e=>{
  if(!v13IsRoles())return;
  const ready=e.target?.closest?.('#party-ready'),start=e.target?.closest?.('#party-start');
  if(!ready&&!start)return;e.preventDefault();e.stopImmediatePropagation();
  if(ready)v13ToggleRoleReady();else v13StartParty();
},true);

const v13OldConnectEvents=connectEvents;
connectEvents=function(){
  v13OldConnectEvents();
  S.eventSource?.addEventListener('stage-player',e=>v13ApplyStagePlayer(JSON.parse(e.data)));
};

const v13OldRenderStudio=renderStudio;
renderStudio=function(){
  const result=v13OldRenderStudio();
  queueMicrotask(()=>{
    v13MountRemoteAudio();v13LockGuestSceneControls();
    if(v13IsSelect()&&!isHost()&&S.room?.player)v13ApplyStagePlayer(S.room.player);
    if(v13IsRoles()||v12Phase()==='result')v13RestoreLobbyVoice();
  });
  return result;
};

/* Host sends a light heartbeat while the film is moving so guests cannot drift away. */
document.addEventListener('timeupdate',e=>{
  if(e.target?.id!=='movie'||!v13IsSelect()||!isHost()||e.target.paused)return;
  if(performance.now()-S.v13.lastPushAt>550)v13PushStagePlayer(true);
},true);

document.addEventListener('play',e=>{if(e.target?.id==='movie'&&v13IsSelect()&&isHost())v13PushStagePlayer(true);},true);
document.addEventListener('pause',e=>{if(e.target?.id==='movie'&&v13IsSelect()&&isHost())v13PushStagePlayer(true);},true);
