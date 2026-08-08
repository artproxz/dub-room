function bindStudio() {
  document.querySelector('#copy-link')?.addEventListener('click',copyInvite);
  document.querySelector('#leave-room')?.addEventListener('click',()=>{S.eventSource?.close();location.href=location.origin;});
  document.querySelector('#video-file')?.addEventListener('change',(e)=>{const f=e.target.files?.[0];if(f)uploadVideo(f);});
  document.querySelector('#play-button')?.addEventListener('click',()=>togglePlayback('all'));
  document.querySelector('#stop-button')?.addEventListener('click',stopEverything);
  document.querySelector('#set-in')?.addEventListener('click',()=>setRangeAtCursor('start'));
  document.querySelector('#set-out')?.addEventListener('click',()=>setRangeAtCursor('end'));
  document.querySelector('#rec-toggle')?.addEventListener('click',toggleRecArm);
  document.querySelectorAll('[data-own-rec]').forEach(b=>b.addEventListener('click',toggleRecArm));
  document.querySelector('#ready-button')?.addEventListener('click',toggleReady);
  document.querySelector('#launch-final')?.addEventListener('click',launchFinal);
  document.querySelector('#film-sound')?.addEventListener('change',(e)=>{S.filmSound=e.target.checked;applyMovieSound();});
  document.querySelector('#film-volume')?.addEventListener('input',(e)=>{S.filmVolume=Number(e.target.value);localStorage.setItem('dubroom:film-volume',S.filmVolume);applyMovieSound();});
  document.querySelector('#master-volume')?.addEventListener('input',(e)=>{S.masterVolume=Number(e.target.value);localStorage.setItem('dubroom:master-volume',S.masterVolume);document.querySelector('#master-label').textContent=`${Math.round(S.masterVolume*100)}%`;for(const a of S.playbackAudios)a.volume=clamp((Number(a.dataset.baseVolume)||1)*S.masterVolume,0,1);});
  document.querySelector('#solo-own')?.addEventListener('click',()=>togglePlayback('own'));
  document.querySelector('#lobby-mute')?.addEventListener('click',()=>{S.manualVoiceMute=!S.manualVoiceMute;applyVoicePolicy();patchVoiceUi();});
  document.querySelector('#color-input')?.addEventListener('input',(e)=>saveParticipantPatch({color:e.target.value,ready:false},true));
  document.querySelector('#role-input')?.addEventListener('input',(e)=>{clearTimeout(S.roleTimer);const role=e.target.value;const p=me();if(p)p.role=role;S.roleTimer=setTimeout(()=>saveParticipantPatch({role,ready:false},false),180);});
  document.querySelector('#zoom-in')?.addEventListener('click',()=>zoom(.72,.5));
  document.querySelector('#zoom-out')?.addEventListener('click',()=>zoom(1.38,.5));
  document.querySelector('#fit-range')?.addEventListener('click',fitRange);
  document.querySelectorAll('.viewport-v5').forEach(bindViewport);
  document.querySelectorAll('.clip-v5[data-clip]').forEach(bindClip);
  document.querySelectorAll('[data-clip-volume]').forEach(bindClipVolume);
  document.querySelectorAll('[data-range]').forEach(bindRangeHandle);
  const movie=document.querySelector('#movie');
  if(movie){applyMovieSound();movie.addEventListener('loadedmetadata',async()=>{applyMovieSound();if(isHost()&&Number.isFinite(movie.duration)&&movie.duration>0&&Math.abs((S.room.video?.duration||0)-movie.duration)>.2){try{await json(`/api/rooms/${S.room.id}/video-meta`,{method:'POST',body:JSON.stringify({participantId,duration:movie.duration})});}catch{}}updatePlayhead(movie.currentTime);});movie.addEventListener('timeupdate',()=>updatePlayhead(movie.currentTime));movie.addEventListener('error',()=>toast('Видео не декодируется браузером. Лучше MP4 H.264/AAC.',true));movie.addEventListener('ended',()=>finishPlayback());}
}

window.addEventListener('keydown',(e)=>{if(e.code!=='Space'||e.repeat||e.target?.closest?.('input,textarea,select,[contenteditable=true]')||!S.room?.video)return;e.preventDefault();if(S.mode==='recording'||S.mode==='countdown')stopOwnRecording();else if(me()?.armed)startOwnRecording();else togglePlayback('all');});

async function copyInvite(){const u=new URL(location.href);u.searchParams.set('room',S.room.id);try{await navigator.clipboard.writeText(u.toString());toast('Ссылка скопирована.');}catch{prompt('Ссылка комнаты',u.toString());}}
function applyMovieSound(){const m=document.querySelector('#movie');if(!m)return;m.muted=!S.filmSound;m.volume=clamp(S.filmVolume,0,1);}

async function uploadVideo(file){const l=document.querySelector('.upload-v5');if(l)l.classList.add('busy');try{const r=await fetch(`/api/rooms/${S.room.id}/video`,{method:'POST',headers:{'content-type':file.type||'application/octet-stream','x-participant-id':participantId,'x-file-name':encodeURIComponent(file.name)},body:file});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Не удалось загрузить фильм.');toast('Фильм загружен. Теперь выберите IN и OUT.');}catch(e){toast(e.message,true);if(l)l.classList.remove('busy');}}

async function saveParticipantPatch(patch, optimistic=true){const p=me();if(!p)return;const old={...p};if(optimistic){Object.assign(p,patch);patchParticipant(p);}try{const d=await json(`/api/rooms/${S.room.id}/participant`,{method:'POST',body:JSON.stringify({participantId,...patch})});if(d.participant){Object.assign(p,d.participant);patchParticipant(p);}}catch(e){Object.assign(p,old);patchParticipant(p);toast(e.message,true);}}
async function toggleRecArm(){if(S.mode==='recording'||S.mode==='countdown')return;const p=me();if(!p)return;await saveParticipantPatch({armed:!p.armed,ready:false},true);applyVoicePolicy();updateControls();}
async function toggleReady(){if(S.mode==='recording'||S.mode==='countdown')return;const p=me();if(!p)return;if(!p.ready&&!hasOwnRangeAudio())return toast('Сначала запишите хотя бы один клип этого фрагмента.',true);const next=!p.ready;await saveParticipantPatch({ready:next},true);S.voiceSuppressed=!next;applyVoicePolicy();updateControls();}
async function launchFinal(){if(!isHost())return;if(!allReady())return toast('Не все готовы.',true);try{await json(`/api/rooms/${S.room.id}/preview/start`,{method:'POST',body:JSON.stringify({participantId})});}catch(e){toast(e.message,true);}}

function connectEvents(){S.eventSource?.close();S.eventSource=new EventSource(`/api/rooms/${S.room.id}/events?participantId=${encodeURIComponent(participantId)}`);S.eventSource.addEventListener('room-state',(e)=>applySnapshot(normalizeRoom(JSON.parse(e.data))));S.eventSource.addEventListener('participant-patch',(e)=>applyParticipantEvent(JSON.parse(e.data)));S.eventSource.addEventListener('participant-level',(e)=>{const d=JSON.parse(e.data);updateLevel(d.participantId,d.level);});S.eventSource.addEventListener('recording-start',(e)=>applyRecordingStart(JSON.parse(e.data)));S.eventSource.addEventListener('recording-stop',(e)=>applyRecordingStop(JSON.parse(e.data)));S.eventSource.addEventListener('clip-created',(e)=>applyClipCreated(JSON.parse(e.data)));S.eventSource.addEventListener('clip-patch',(e)=>applyClipPatch(JSON.parse(e.data)));S.eventSource.addEventListener('clip-delete',(e)=>applyClipDelete(JSON.parse(e.data)));S.eventSource.addEventListener('range-patch',(e)=>{const d=JSON.parse(e.data);S.room.range=d.range;updateRangeUi();});S.eventSource.addEventListener('mix-preview',(e)=>beginFinalPreview(JSON.parse(e.data)));S.eventSource.addEventListener('rtc-signal',(e)=>handleRtcSignal(JSON.parse(e.data)));S.eventSource.onerror=()=>patchVoiceUi();}
function applySnapshot(next){if(!next)return;const prev=S.room;S.room=next;const videoChanged=prev?.video?.url!==next.video?.url;const participantIds=(prev?.participants||[]).map(p=>p.id).join('|')!==next.participants.map(p=>p.id).join('|');if(videoChanged||!document.querySelector('.studio-v5'))return renderStudio();if(participantIds){document.querySelector('#players-panel').innerHTML=renderPlayers();document.querySelector('#timeline-panel').innerHTML=renderTimeline(Math.max(videoDuration(),S.room.range.end,30));bindStudio();}else{updateAllUi();syncClipDom();syncRecordingDom();}syncVoicePeers();}
function applyParticipantEvent(d){const p=d.participant;if(!p)return;const i=S.room.participants.findIndex(x=>x.id===p.id);if(i>=0)S.room.participants[i]={...S.room.participants[i],...p};else S.room.participants.push(p);patchParticipant(p);syncVoicePeers();}
function applyRecordingStart(r){S.room.recordings=S.room.recordings.filter(x=>x.participantId!==r.participantId);S.room.recordings.push(r);patchParticipant(S.room.participants.find(p=>p.id===r.participantId));syncRecordingDom();}
function applyRecordingStop(r){S.room.recordings=S.room.recordings.filter(x=>x.participantId!==r.participantId);patchParticipant(S.room.participants.find(p=>p.id===r.participantId));syncRecordingDom();if(r.participantId===participantId)scheduleLocalStop(r);}
function applyClipCreated(d){if(!d.clip)return;S.room.clips=S.room.clips.filter(c=>c.id!==d.clip.id);S.room.clips.push(d.clip);if(d.participant){const p=S.room.participants.find(x=>x.id===d.participant.id);if(p)Object.assign(p,d.participant);}renderTimelineOnly();patchParticipant(d.participant);}
function applyClipPatch(d){if(!d.clip)return;const c=S.room.clips.find(x=>x.id===d.clip.id);if(c)Object.assign(c,d.clip);else S.room.clips.push(d.clip);if(d.participant){const p=S.room.participants.find(x=>x.id===d.participant.id);if(p)Object.assign(p,d.participant);}patchClipDom(d.clip);patchParticipant(d.participant);markRemoteEditing(d.clip.participantId);}
function applyClipDelete(d){S.room.clips=S.room.clips.filter(c=>c.id!==d.clipId);document.querySelector(`[data-clip="${CSS.escape(d.clipId)}"]`)?.remove();if(d.participant){const p=S.room.participants.find(x=>x.id===d.participant.id);if(p)Object.assign(p,d.participant);patchParticipant(p);}}
