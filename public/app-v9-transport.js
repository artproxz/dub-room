/* DubRoom v0.9: one authoritative Space/transport controller across playback, recording and final preview. */
S.previewState = null;

function v9EditableTarget(target){
  return Boolean(target?.closest?.('input,textarea,select,button,[contenteditable="true"]'));
}
function v9Movie(){return document.querySelector('#movie');}
function v9MoviePlaying(){const m=v9Movie();return Boolean(m && !m.paused && !m.ended);}
function v9TransportLabel(){
  if(S.mode==='recording')return 'SPACE — остановить запись';
  if(S.mode==='preview')return isHost()?(v9MoviePlaying()?'SPACE — пауза итога':'SPACE — продолжить итог'):'Итогом управляет ведущий';
  if(v9MoviePlaying()||S.mode==='solo')return 'SPACE — остановить';
  return v8RecordArmed()?'SPACE — запись от курсора':'SPACE — воспроизвести от курсора';
}
const v9PrevUpdateControls=updateControls;
updateControls=function(){v9PrevUpdateControls();const h=document.querySelector('#space-hint');if(h)h.textContent=v9TransportLabel();const p=document.querySelector('#play-button');if(p)p.textContent=(v9MoviePlaying()||S.mode==='recording'||(S.mode==='preview'&&v9MoviePlaying()))?'⏸':'▶';};

function v9StopLocalPlayback(){
  clearTimeout(S.playbackTimer);clearPlaybackAudio();const m=v9Movie();if(m&&!m.paused)m.pause();
  if(S.mode==='solo')S.mode='idle';temporarilyMuteLobby(false);updateControls();
}
function v9StartNormalPlayback(){
  const m=v9Movie();if(!m)return;const start=cursorStart();
  S.mode='solo';m.currentTime=start;applyMovieSound();temporarilyMuteLobby(true);
  Promise.resolve(m.play()).then(()=>{if(S.mode!=='solo'||m.paused)return;playVoiceClips(start,S.room.range.end,'own');clearTimeout(S.playbackTimer);S.playbackTimer=setTimeout(()=>{if(S.mode==='solo')finishPlayback();},Math.max(50,(S.room.range.end-start)*1000+70));updateControls();}).catch(()=>{S.mode='idle';temporarilyMuteLobby(false);updateControls();toast('Браузер не дал запустить воспроизведение.',true);});
}
async function v9SendPreviewControl(action,time){
  if(!isHost())return toast('Итоговым просмотром управляет ведущий.',true);
  try{await json(`/api/rooms/${S.room.id}/preview/control`,{method:'POST',body:JSON.stringify({participantId,action,currentTime:time})});}catch(e){toast(e.message,true);}
}
async function v9TogglePreview(){
  const m=v9Movie();if(!m||!isHost())return;
  if(v9MoviePlaying())return v9SendPreviewControl('pause',m.currentTime);
  const start=clamp(Number(m.currentTime)||S.previewState?.currentTime||S.room.range.start,S.room.range.start,S.room.range.end-.02);
  return v9SendPreviewControl('play',start);
}
async function v9TransportToggle(){
  if(!S.room?.video)return;
  if(S.mode==='recording'){stopOwnRecording();return;}
  if(S.mode==='preview'){await v9TogglePreview();return;}
  const m=v9Movie();if(!m)return;
  /* Playback always wins over REC arm: Space while transport is moving means STOP. */
  if(v9MoviePlaying()||S.mode==='solo'){v9StopLocalPlayback();S.mode='idle';updateControls();return;}
  if(v8RecordArmed()){startOwnRecording();return;}
  v9StartNormalPlayback();
}
function v9TransportStop(){
  if(S.mode==='recording'){stopOwnRecording();return;}
  if(S.mode==='preview'){if(isHost())v9SendPreviewControl('pause',v9Movie()?.currentTime||S.room.range.start);return;}
  v9StopLocalPlayback();S.mode='idle';updateControls();
}

/* Capture phase makes this the only Space handler; the legacy bubble handler never receives Space. */
window.addEventListener('keydown',(e)=>{
  if(e.code!=='Space'||e.repeat||v9EditableTarget(e.target)||!S.room?.video)return;
  e.preventDefault();e.stopImmediatePropagation();v9TransportToggle();
},true);
/* Visible Play/Stop buttons use exactly the same controller as Space. */
document.addEventListener('click',(e)=>{
  const play=e.target?.closest?.('#play-button');const stop=e.target?.closest?.('#stop-button');
  if(!play&&!stop)return;e.preventDefault();e.stopImmediatePropagation();if(play)v9TransportToggle();else v9TransportStop();
},true);

function v9ApplyPreviewControl(d){
  if(!d||!S.room?.video)return;const m=v9Movie();if(!m)return;
  S.mode='preview';S.previewState={...(S.previewState||{}),...d,currentTime:Number(d.currentTime)||S.room.range.start};temporarilyMuteLobby(true);clearTimeout(S.playbackTimer);clearPlaybackAudio();
  const wait=Math.max(0,(Number(d.effectiveAt)||Date.now())-Date.now());
  S.playbackTimer=setTimeout(async()=>{
    if(d.action==='pause'){m.pause();clearPlaybackAudio();S.previewState.currentTime=m.currentTime;updateControls();return;}
    const start=clamp(Number(d.currentTime)||S.room.range.start,S.room.range.start,S.room.range.end-.02);m.pause();m.currentTime=start;applyMovieSound();
    try{await m.play();if(S.mode!=='preview')return;playVoiceClips(start,S.room.range.end,'all');clearTimeout(S.playbackTimer);S.playbackTimer=setTimeout(()=>{if(S.mode!=='preview')return;m.pause();clearPlaybackAudio();m.currentTime=S.room.range.end;S.previewState={...S.previewState,currentTime:S.room.range.end};updateControls();},Math.max(50,(S.room.range.end-start)*1000+70));updateControls();}catch{toast('Браузер заблокировал общий просмотр.',true);updateControls();}
  },wait);
}

/* Initial final start: no overlay; final remains a resumable preview transport. */
beginFinalPreview=function(p){
  const m=v9Movie();if(!m)return;clearTimeout(S.playbackTimer);clearPlaybackAudio();clearOverlay();S.mode='preview';S.previewState={action:'play',currentTime:p.startTime,effectiveAt:p.previewAt,startTime:p.startTime,endTime:p.endTime};temporarilyMuteLobby(true);m.pause();m.currentTime=p.startTime;applyMovieSound();toast('🎬 Итоговый просмотр');v9ApplyPreviewControl(S.previewState);
};

const v9PrevConnectEvents=connectEvents;
connectEvents=function(){
  v9PrevConnectEvents();
  S.eventSource?.addEventListener('mix-preview-control',(e)=>v9ApplyPreviewControl(JSON.parse(e.data)));
};

document.addEventListener('play',(e)=>{if(e.target?.id==='movie')updateControls();},true);
document.addEventListener('pause',(e)=>{if(e.target?.id==='movie')updateControls();},true);
