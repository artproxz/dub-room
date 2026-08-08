/* DubRoom v0.8: per-participant tabbed multilanes, trim handles, robust local REC and latency compensation. */
S.activeTrackParticipantId = sessionStorage.getItem('dubroom:active-track') || participantId;
S.localRecordArmed = null;
S.syncAdjustMs = clamp(Number(localStorage.getItem('dubroom:sync-adjust-ms') || 40), -80, 220);

function v8RecordArmed(){
  if(typeof S.localRecordArmed!=='boolean')S.localRecordArmed=Boolean(me()?.armed);
  return S.localRecordArmed;
}
function v8ActiveTrackId(){
  const ids=S.room?.participants?.map(p=>p.id)||[];
  if(!ids.includes(S.activeTrackParticipantId))S.activeTrackParticipantId=ids.includes(participantId)?participantId:(ids[0]||participantId);
  return S.activeTrackParticipantId;
}
function v8ActiveParticipant(){return S.room?.participants?.find(p=>p.id===v8ActiveTrackId())||me()||S.room?.participants?.[0];}
function v8AutoLatencyMs(){
  const track=(S.micRawStream||S.micStream)?.getAudioTracks?.()[0];
  const reported=Number(track?.getSettings?.().latency);
  const trackMs=Number.isFinite(reported)&&reported>0?reported*1000:12;
  const quantumMs=S.audioContext?.sampleRate?128/S.audioContext.sampleRate*1000:3;
  const contextMs=clamp((Number(S.audioContext?.baseLatency)||0)*1000,0,25);
  const processingMs=S.noiseCleanup?20:8;
  return clamp(Math.round(trackMs+quantumMs+contextMs+processingMs),12,180);
}
function v8SyncCompMs(){return clamp(Math.round(v8AutoLatencyMs()+S.syncAdjustMs),0,300);}
function v8ClipOffset(c){return globalThis.DubRoomLayout.clipOffset(c);}
function v8SourceDuration(c){return globalThis.DubRoomLayout.sourceDuration(c);}
function v8LayoutFor(id){return globalThis.DubRoomLayout.assignLanes((S.room?.clips||[]).filter(c=>c.participantId===id));}
function v8LaneCount(id){const layout=v8LayoutFor(id);return Math.max(1,...layout.map(x=>x.lane+1));}
function v8StackHeight(id){return Math.max(74,v8LaneCount(id)*64+12);}
function v8LaneGuides(id){return Array.from({length:v8LaneCount(id)},(_,i)=>`<div class="lane-guide-v8" style="top:${i*64}px"><span>${i+1}</span></div>`).join('');}
function v8StatusDot(p){const [key,label]=participantStatus(p);return `<i class="tab-dot-v8 ${key}"></i><span>${esc(p.name)}</span><small>${label}</small>`;}

spaceHint=function(){if(S.mode==='recording')return'SPACE — стоп';return v8RecordArmed()?'SPACE — запись от курсора':'SPACE — прослушать свою дорожку';};

const v8PrevUpdateControls=updateControls;
updateControls=function(){
  v8PrevUpdateControls();const rec=document.querySelector('#rec-toggle'),armed=v8RecordArmed();
  if(rec){rec.classList.toggle('on',armed);const label=rec.querySelector('span:last-child');if(label)label.textContent=armed?'ВКЛ':'ВЫКЛ';rec.title=armed?'🎙 включён — Space пишет от курсора':'🎙 выключен — Space слушает свою дорожку';}
  const hint=document.querySelector('#space-hint');if(hint)hint.textContent=spaceHint();
  const sync=document.querySelector('#sync-label-v8');if(sync)sync.textContent=`SYNC −${v8SyncCompMs()} мс`;
};

toggleRecArm=function(){
  if(S.mode==='recording')return Promise.resolve(false);const next=!v8RecordArmed();S.localRecordArmed=next;const p=me();if(p)p.armed=next;updateControls();
  saveParticipantPatch({armed:next,ready:false},true).catch?.(()=>{});return Promise.resolve(next);
};

renderTimeline=function(duration){
  const p=v8ActiveParticipant();if(!p)return'';const self=p.id===participantId,layout=v8LayoutFor(p.id),height=v8StackHeight(p.id),[key,label]=participantStatus(p);
  const tabs=S.room.participants.map(x=>`<button class="track-tab-v8 ${x.id===p.id?'active':''} ${x.id===participantId?'self':''}" data-track-tab="${esc(x.id)}" style="--pc:${esc(x.color)}">${v8StatusDot(x)}</button>`).join('');
  return `<div class="timeline-toolbar-v5 timeline-toolbar-v8"><div class="track-tabs-v8">${tabs}</div><div class="zoom-v5"><button id="zoom-out">−</button><b id="zoom-label">${zoomLabel()}</b><button id="zoom-in">+</button><button id="fit-range">IN–OUT</button></div><div class="sync-box-v8" title="Компенсация задержки микрофона: клип автоматически сдвигается раньше"><button id="sync-less-v8">−</button><b id="sync-label-v8">SYNC −${v8SyncCompMs()} мс</b><button id="sync-more-v8">+</button></div><div class="master-v5"><span>MASTER</span><input id="master-volume" type="range" min="0" max="1" step=".01" value="${S.masterVolume}"><b id="master-label">${Math.round(S.masterVolume*100)}%</b></div></div>
  <div class="timeline-grid-v8"><div class="track-head-v5 ruler-head-v5">${self?'ВАШ МОНТАЖ':`МОНТАЖ · ${esc(p.name)}`}</div><div class="viewport-v5 ruler-v5" id="timeline-ruler">${rangeOverlay()}<div class="ticks-v5">${ticksHtml()}</div>${isHost()?rangeHandles():''}<div class="playhead-v5" data-playhead></div></div>
  <div class="track-head-v5 status-${key} active-head-v8" data-track-head="${esc(p.id)}" style="--pc:${esc(p.color)}"><div class="track-id-v5"><div class="track-avatar-v5">${esc(p.name[0]?.toUpperCase()||'?')}</div><div><b>${self?'Вы':esc(p.name)}</b><span data-track-status>${label}</span></div></div><div class="track-actions-v5">${self?'<button id="solo-own">▶ Моя дорожка</button>':`<span>${esc(p.role||'Только просмотр')}</span>`}</div></div>
  <div class="stack-scroll-v8"><div class="viewport-v5 track-v5 track-stack-v8" data-track="${esc(p.id)}" style="--pc:${esc(p.color)};height:${height}px">${rangeOverlay()}<div class="grid-lines-v5"></div><div class="lane-guides-v8">${v8LaneGuides(p.id)}</div>${layout.map(({clip,lane})=>renderClip(clip,p,self,lane)).join('')}${recordingFor(p.id)?renderLive(p,self):''}<div class="playhead-v5" data-playhead></div></div></div></div>`;
};

renderClip=function(c,p,self,lane){
  const peaks=c.peaks?.length?c.peaks:Array.from({length:30},(_,i)=>.12+((i*13)%9)/20);return `<div class="clip-v5 clip-v8 ${self?'own':'foreign'}" data-clip="${esc(c.id)}" data-owner="${esc(c.participantId)}" data-start="${c.start}" style="left:${timePct(c.start)}%;width:${Math.max(.5,c.duration/S.visibleSeconds*100)}%;top:${6+lane*64}px;--pc:${esc(p.color)}" ${self?'data-editable="1"':''}>${self?'<i class="trim-handle-v8 left" data-trim="left"></i><i class="trim-handle-v8 right" data-trim="right"></i>':''}<div class="clip-label"><span>${self?'Моя запись':esc(p.name)}</span><b>${fmt(c.start,true)}</b></div><div class="wave-v5">${peaks.map(v=>`<i style="height:${Math.max(10,Math.min(100,v*100))}%"></i>`).join('')}</div><div class="clip-vol-v5"><input data-clip-volume="${esc(c.id)}" type="range" min="0" max="1" step=".01" value="${c.volume}" ${self?'':'disabled'}><em>${Math.round(c.volume*100)}%</em></div></div>`;
};

function v8LiveLane(id,r){
  const pseudo={id:'__live__',start:r.startTime,duration:Math.max(.05,Math.min(r.endTime-r.startTime,(Date.now()-r.startAt)/1000))};
  const layout=globalThis.DubRoomLayout.assignLanes([...(S.room.clips||[]).filter(c=>c.participantId===id),pseudo]);return layout.find(x=>x.clip.id==='__live__')?.lane||0;
}
renderLive=function(p,self){const r=recordingFor(p.id);if(!r)return'';const elapsed=Math.max(0,(Date.now()-r.startAt)/1000),dur=Math.min(r.endTime-r.startTime,elapsed),lane=v8LiveLane(p.id,r);return `<div class="clip-v5 clip-v8 live ${self?'own':'foreign'}" data-live="${esc(p.id)}" style="left:${timePct(r.startTime)}%;width:${Math.max(.5,dur/S.visibleSeconds*100)}%;top:${6+lane*64}px;--pc:${esc(p.color)}"><div class="clip-label"><span>● ЗАПИСЬ · ${self?'Вы':esc(p.name)}</span></div><div class="wave-v5 live-wave"></div></div>`;};

function v8RelayoutActive(){
  const id=v8ActiveTrackId(),vp=document.querySelector(`[data-track="${CSS.escape(id)}"]`);if(!vp)return;const layout=v8LayoutFor(id);for(const {clip,lane} of layout){const el=vp.querySelector(`[data-clip="${CSS.escape(clip.id)}"]`);if(el)el.style.top=`${6+lane*64}px`;}
  const h=v8StackHeight(id);vp.style.height=`${h}px`;const guides=vp.querySelector('.lane-guides-v8');if(guides)guides.innerHTML=v8LaneGuides(id);const r=recordingFor(id),live=vp.querySelector(`[data-live="${CSS.escape(id)}"]`);if(r&&live)live.style.top=`${6+v8LiveLane(id,r)*64}px`;
}
function v8UpdateTabs(){for(const p of S.room?.participants||[]){const b=document.querySelector(`[data-track-tab="${CSS.escape(p.id)}"]`);if(!b)continue;b.classList.toggle('active',p.id===v8ActiveTrackId());b.innerHTML=v8StatusDot(p);}}

const v8PrevBindTimelineOnly=bindTimelineOnly;
bindTimelineOnly=function(){
  v8PrevBindTimelineOnly();
  document.querySelectorAll('[data-track-tab]').forEach(b=>b.addEventListener('click',()=>{S.activeTrackParticipantId=b.dataset.trackTab;sessionStorage.setItem('dubroom:active-track',S.activeTrackParticipantId);renderTimelineOnly();}));
  document.querySelector('#sync-less-v8')?.addEventListener('click',()=>{S.syncAdjustMs=clamp(S.syncAdjustMs-10,-80,220);localStorage.setItem('dubroom:sync-adjust-ms',S.syncAdjustMs);updateControls();});
  document.querySelector('#sync-more-v8')?.addEventListener('click',()=>{S.syncAdjustMs=clamp(S.syncAdjustMs+10,-80,220);localStorage.setItem('dubroom:sync-adjust-ms',S.syncAdjustMs);updateControls();});
  v8RelayoutActive();
};

const v8PrevPatchClipDom=patchClipDom;
patchClipDom=function(c){v8PrevPatchClipDom(c);if(c.participantId===v8ActiveTrackId())v8RelayoutActive();};
const v8PrevPatchParticipant=patchParticipant;
patchParticipant=function(p){v8PrevPatchParticipant(p);v8UpdateTabs();};

bindClip=function(el){
  const own=el.dataset.editable==='1';el.addEventListener('contextmenu',e=>{e.preventDefault();if(own)deleteClipFast(el.dataset.clip,el);});el.addEventListener('dblclick',e=>{if(!e.target.closest('[data-trim],input'))playSingleClip(el.dataset.clip);});if(!own)return;
  el.addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('input'))return;const c=S.room.clips.find(x=>x.id===el.dataset.clip);if(!c)return;const vp=el.closest('.viewport-v5'),w=vp.getBoundingClientRect().width||1,x0=e.clientX;
    const trim=e.target.closest('[data-trim]')?.dataset.trim;if(trim){e.preventDefault();e.stopPropagation();const base={...c,sourceDuration:v8SourceDuration(c),offset:v8ClipOffset(c)};el.setPointerCapture(e.pointerId);el.classList.add('trimming');const move=ev=>{const delta=(ev.clientX-x0)/w*S.visibleSeconds,next=trim==='left'?globalThis.DubRoomLayout.trimLeft(base,delta):globalThis.DubRoomLayout.trimRight(base,delta);if(trim==='left'){c.start=next.start;c.offset=next.offset;c.duration=next.duration;}else c.duration=next.duration;patchClipDom(c);sendClipPatch(c.id,{start:c.start,offset:v8ClipOffset(c),duration:c.duration});};const up=()=>{el.classList.remove('trimming');el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);sendClipPatch(c.id,{start:c.start,offset:v8ClipOffset(c),duration:c.duration},true);v8RelayoutActive();};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);return;}
    e.preventDefault();const t0=c.start;el.setPointerCapture(e.pointerId);el.classList.add('dragging');const move=ev=>{const n=clamp(t0+(ev.clientX-x0)/w*S.visibleSeconds,0,Math.max(0,(videoDuration()||86400)-.05));c.start=n;el.style.left=`${timePct(n)}%`;const b=el.querySelector('.clip-label b');if(b)b.textContent=fmt(n,true);sendClipPatch(c.id,{start:n});};const up=()=>{el.classList.remove('dragging');el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);sendClipPatch(c.id,{start:c.start},true);v8RelayoutActive();};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);
  });
};

const v8PrevUpdateLiveClip=updateLiveClip;
updateLiveClip=function(id){v8PrevUpdateLiveClip(id);if(id===v8ActiveTrackId())v8RelayoutActive();};

const v8PrevApplyClipPatch=applyClipPatch;
applyClipPatch=function(d){v8PrevApplyClipPatch(d);if(d.clip?.participantId===v8ActiveTrackId())v8RelayoutActive();v8UpdateTabs();};
const v8PrevApplyClipDelete=applyClipDelete;
applyClipDelete=function(d){v8PrevApplyClipDelete(d);if(d.participantId===v8ActiveTrackId())v8RelayoutActive();v8UpdateTabs();};

playVoiceClips=function(from,to,filter='all'){
  clearPlaybackAudio();for(const c of S.room.clips){if(filter==='own'&&c.participantId!==participantId)continue;const end=c.start+c.duration;if(end<=from||c.start>=to)continue;const a=new Audio(c.url);a.preload='auto';a.dataset.baseVolume=String(c.volume);a.volume=clamp(c.volume*S.masterVolume,0,1);S.playbackAudios.push(a);const delay=Math.max(0,(c.start-from)*1000),skip=Math.max(0,from-c.start),sourceOffset=v8ClipOffset(c);const start=()=>{a.currentTime=Math.max(0,sourceOffset+skip);a.play().catch(()=>{});const remain=Math.max(0,Math.min(end,to)-Math.max(from,c.start));S.playbackTimers.push(setTimeout(()=>a.pause(),remain*1000+35));};if(delay<12)start();else S.playbackTimers.push(setTimeout(start,delay));}
};
playSingleClip=function(id){const c=S.room.clips.find(x=>x.id===id);if(!c)return;const m=document.querySelector('#movie');if(!m)return;stopPlaybackOnly();S.mode='solo';m.currentTime=c.start;applyMovieSound();temporarilyMuteLobby(true);m.play().catch(()=>{});const a=new Audio(c.url);a.volume=clamp(c.volume*S.masterVolume,0,1);S.playbackAudios=[a];a.currentTime=v8ClipOffset(c);a.play().catch(()=>{});S.playbackTimer=setTimeout(()=>finishPlayback(),c.duration*1000+35);};

const v8PrevUploadRecordedClip=uploadRecordedClip;
uploadRecordedClip=async function(){
  const session=S.localSession;if(!session)return;S.uploadedSessions??=new Set();if(S.uploadedSessions.has(session.sessionId))return;S.uploadedSessions.add(session.sessionId);const started=await Promise.resolve(S._recordServerPromise);if(!started){S.uploadedSessions.delete(session.sessionId);return finishRecording(session.actualEndTime??session.startTime,false,session.startTime);}
  const blob=new Blob(S.recorderChunks,{type:S.recorder?.mimeType||'audio/webm'});S.recorderChunks=[];const end=session.actualEndTime??session.endTime??session.startTime,dur=Math.max(0,end-session.startTime);if(dur<.06||blob.size<30)return finishRecording(end,false,session.startTime);const wave=resample(S.recordingPeaks,140).map(v=>Math.round(v*100)).join(','),syncMs=v8SyncCompMs();
  try{const r=await fetch(`/api/rooms/${S.room.id}/sessions/${session.sessionId}/clips/${participantId}`,{method:'POST',headers:{'content-type':blob.type||'audio/webm','x-participant-id':participantId,'x-clip-start':String(session.startTime),'x-clip-duration':String(dur),'x-waveform':wave,'x-sync-comp-ms':String(syncMs)},body:blob});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Не удалось сохранить запись.');if(d.clip){S.room.clips=S.room.clips.filter(c=>c.id!==d.clip.id);S.room.clips.push(d.clip);S.activeTrackParticipantId=participantId;renderTimelineOnly();}finishRecording(end,true,d.clip?.start??session.startTime);}catch(e){S.uploadedSessions.delete(session.sessionId);finishRecording(end,false,session.startTime);toast(e.message,true);}
};

startOwnRecording=async function(){
  if(S.mode!=='idle'||S.localSession||!v8RecordArmed())return;stopPlaybackOnly();if(!S.micStream?.active)try{await ensureMic();}catch{return toast('Микрофон недоступен.',true);}S.audioContext?.resume?.().catch(()=>{});const m=document.querySelector('#movie'),startTime=cursorStart(),sessionId=v7SessionId();if(m){m.pause();m.currentTime=startTime;updatePlayhead(startTime);}const provisional={sessionId,participantId,startTime,endTime:S.room.range.end,startAt:Date.now(),stopAt:Date.now()+Math.max(100,(S.room.range.end-startTime)*1000)};S.room.recordings=S.room.recordings.filter(r=>r.participantId!==participantId);S.room.recordings.push(provisional);S._recordServerPromise=json(`/api/rooms/${S.room.id}/recording/start`,{method:'POST',body:JSON.stringify({participantId,startTime,sessionId})}).then(p=>{if(S.localSession?.sessionId===sessionId)Object.assign(S.localSession,p);return p;}).catch(e=>{if(S.localSession?.sessionId===sessionId)abortLocalRecordingV7(e.message);toast(e.message,true);return null;});beginLocalRecording(provisional);
};

window.addEventListener('keydown',e=>{
  if(e.code!=='Space'||e.repeat||e.target?.closest?.('input,textarea,select,[contenteditable=true]')||!S.room?.video)return;e.preventDefault();e.stopImmediatePropagation();if(S.mode==='recording')stopOwnRecording();else if(S.mode==='solo'||!document.querySelector('#movie')?.paused)finishPlayback();else if(v8RecordArmed())startOwnRecording();else togglePlayback();
},{capture:true});
