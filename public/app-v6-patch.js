/* DubRoom v0.6: cursor-first DAW transport. Loaded after v0.5 modules. */
function spaceHint(){if(S.mode==='recording')return'SPACE — остановить запись';return me()?.armed?'SPACE — начать запись от курсора':'SPACE — прослушать свою дорожку от курсора';}
function cursorStart(){const m=document.querySelector('#movie');if(!m)return S.room.range.start;const t=Number(m.currentTime)||0;return t>=S.room.range.start&&t<S.room.range.end-.02?t:S.room.range.start;}

function renderVideo(duration){
  const span=Math.max(0,S.room.range.end-S.room.range.start);
  return `<div class="video-stage-v5"><video id="movie" src="${esc(S.room.video.url)}" playsinline preload="metadata"></video><div id="stage-overlay"></div></div><div class="transport-v5"><button id="play-button" class="icon-btn primary">▶</button><button id="stop-button" class="icon-btn">■</button><div class="time-v5"><b id="playhead-time">${fmt(S.room.range.start,true)}</b><span>/ ${fmt(duration,true)}</span></div><button id="set-in" class="range-btn in" ${isHost()?'':'disabled'}><small>IN</small><b id="range-start-label">${fmt(S.room.range.start,true)}</b></button><span>—</span><button id="set-out" class="range-btn out" ${isHost()?'':'disabled'}><small>OUT</small><b id="range-end-label">${fmt(S.room.range.end,true)}</b></button><div class="duration-v5"><small>Фрагмент</small><b>${span.toFixed(1)} сек</b></div><div class="transport-spacer"></div><label class="film-toggle-v5"><input id="film-sound" type="checkbox" ${S.filmSound?'checked':''}><span>🔊 Фильм</span></label><input id="film-volume" class="mini-slider" type="range" min="0" max="1" step=".01" value="${S.filmVolume}"><button id="rec-toggle" class="rec-toggle-v5 mic-mode-v6 ${me()?.armed?'on':''}" title="Режим записи"><span class="mic-icon-v6">🎙</span><span>${me()?.armed?'ВКЛ':'ВЫКЛ'}</span></button><button id="ready-button" class="ready-v5 ${me()?.ready?'on':''}">${me()?.ready?'✓ ГОТОВ':'Я ГОТОВ'}</button>${isHost()?`<button id="launch-final" class="launch-v5" ${allReady()?'':'disabled'}>▶ ЗАПУСТИТЬ ИТОГ</button>`:''}</div><div class="video-meta-v5"><span>${esc(S.room.video.originalName)} · ${sizeFmt(S.room.video.size)}</span><b id="space-hint">${spaceHint()}</b></div>`;
}

function renderTrack(p){
  const self=p.id===participantId,[key,label]=participantStatus(p),clips=S.room.clips.filter(c=>c.participantId===p.id).sort((a,b)=>a.start-b.start),lanes=assignLanes(clips);
  return `<div class="track-head-v5 status-${key}" data-track-head="${esc(p.id)}" style="--pc:${esc(p.color)}"><div class="track-id-v5"><div class="track-avatar-v5">${esc(p.name[0]?.toUpperCase()||'?')}</div><div><b>${self?'Вы':esc(p.name)}</b><span data-track-status>${label}</span></div></div><div class="track-actions-v5">${self?'<button id="solo-own">▶ Моя дорожка</button>':`<span>${esc(p.role||'')}</span>`}</div></div><div class="viewport-v5 track-v5" data-track="${esc(p.id)}" style="--pc:${esc(p.color)}">${rangeOverlay()}<div class="grid-lines-v5"></div>${lanes.map(({clip,lane})=>renderClip(clip,p,self,lane)).join('')}${recordingFor(p.id)?renderLive(p,self):''}<div class="playhead-v5" data-playhead></div></div>`;
}

function updateControls(){
  const p=me();if(!p)return;
  const rec=document.querySelector('#rec-toggle');if(rec){rec.classList.toggle('on',p.armed);const label=rec.querySelector('span:last-child');if(label)label.textContent=p.armed?'ВКЛ':'ВЫКЛ';rec.title=p.armed?'Микрофон включён: Space сразу начнёт запись от красного курсора':'Микрофон выключен: Space прослушает вашу дорожку от красного курсора';}
  const ready=document.querySelector('#ready-button');if(ready){ready.classList.toggle('on',p.ready);ready.textContent=p.ready?'✓ ГОТОВ':'Я ГОТОВ';}
  const launch=document.querySelector('#launch-final');if(launch)launch.disabled=!allReady();
  const hint=document.querySelector('#space-hint');if(hint)hint.textContent=spaceHint();
  const count=document.querySelector('#online-count');if(count)count.textContent=S.room.participants.filter(x=>x.connected).length;
}

function togglePlayback(){
  if(S.mode==='recording'||S.mode==='preview')return;
  const m=document.querySelector('#movie');if(!m)return;
  if(S.mode==='solo'||!m.paused){finishPlayback();return;}
  const start=cursorStart();S.mode='solo';m.currentTime=start;applyMovieSound();temporarilyMuteLobby(true);
  m.play().then(()=>{playVoiceClips(start,S.room.range.end,'own');clearTimeout(S.playbackTimer);S.playbackTimer=setTimeout(()=>finishPlayback(),Math.max(50,(S.room.range.end-start)*1000+70));updateControls();}).catch(()=>toast('Браузер не дал запустить воспроизведение.',true));
}
function stopEverything(){if(S.mode==='recording')stopOwnRecording();else finishPlayback();}

async function startOwnRecording(){
  if(S.mode!=='idle'||S.localSession||!me()?.armed)return;
  stopPlaybackOnly();
  const m=document.querySelector('#movie'),startTime=cursorStart();
  if(m){m.pause();m.currentTime=startTime;updatePlayhead(startTime);}
  S.voiceSuppressed=true;applyVoicePolicy();
  try{const p=await json(`/api/rooms/${S.room.id}/recording/start`,{method:'POST',body:JSON.stringify({participantId,startTime})});await beginLocalRecording(p);}catch(e){S.voiceSuppressed=false;applyVoicePolicy();toast(e.message,true);}
}
async function stopOwnRecording(){
  if(!S.localSession||S._stopRequestPending)return;
  S._stopRequestPending=true;
  const m=document.querySelector('#movie');
  const endTime=clamp(Number(m?.currentTime)||S.localSession.startTime,S.localSession.startTime,S.localSession.endTime);
  try{const p=await json(`/api/rooms/${S.room.id}/recording/stop`,{method:'POST',body:JSON.stringify({participantId,endTime})});scheduleLocalStop(p);}catch(e){if(!String(e.message).includes('нет активной'))toast(e.message,true);S._stopRequestPending=false;}
}
async function beginLocalRecording(p){
  try{
    await ensureMic();S.mode='recording';S.localSession={...p};S.recorderChunks=[];S.recordingPeaks=[];S._lastPeakAt=0;S._stopRequestPending=false;S._stoppingSession=null;S.voiceSuppressed=true;applyVoicePolicy();clearOverlay();
    const mime=pickMime();S.recorder=new MediaRecorder(S.micStream,mime?{mimeType:mime}:undefined);S.recorder.ondataavailable=e=>{if(e.data.size)S.recorderChunks.push(e.data);};S.recorder.onstop=uploadRecordedClip;
    const m=document.querySelector('#movie');if(m){m.currentTime=p.startTime;applyMovieSound();m.play().catch(()=>{});}S.recorder.start(120);
    clearTimeout(S.stopTimer);S.stopTimer=setTimeout(()=>stopOwnRecording(),Math.max(80,(p.endTime-p.startTime)*1000+25));syncRecordingDom();updateControls();
  }catch(e){S.mode='idle';S.localSession=null;S.recorder=null;S._stopRequestPending=false;clearOverlay();S.voiceSuppressed=false;applyVoicePolicy();toast(e.message||'Не удалось начать запись.',true);}
}
function scheduleLocalStop(p){
  if(!S.localSession||S.localSession.sessionId!==p.sessionId||S._stoppingSession===p.sessionId)return;
  S._stoppingSession=p.sessionId;S._stopRequestPending=false;S.localSession.actualEndTime=p.endTime;clearTimeout(S.stopTimer);clearTimeout(S.startTimer);const m=document.querySelector('#movie');if(m)m.pause();
  if(S.recorder&&S.recorder.state!=='inactive')S.recorder.stop();else finishRecording(p.endTime,false,S.localSession.startTime);
}
async function uploadRecordedClip(){
  const session=S.localSession;if(!session)return;S.uploadedSessions??=new Set();if(S.uploadedSessions.has(session.sessionId))return;S.uploadedSessions.add(session.sessionId);
  const blob=new Blob(S.recorderChunks,{type:S.recorder?.mimeType||'audio/webm'});S.recorderChunks=[];const end=session.actualEndTime??session.endTime??session.startTime,dur=Math.max(0,end-session.startTime);
  if(dur<.08||blob.size<40)return finishRecording(end,false,session.startTime);
  const wave=resample(S.recordingPeaks,120).map(v=>Math.round(v*100)).join(',');
  try{const r=await fetch(`/api/rooms/${S.room.id}/sessions/${session.sessionId}/clips/${participantId}`,{method:'POST',headers:{'content-type':blob.type||'audio/webm','x-participant-id':participantId,'x-clip-start':String(session.startTime),'x-clip-duration':String(dur),'x-waveform':wave},body:blob});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Не удалось сохранить запись.');if(d.clip){S.room.clips=S.room.clips.filter(c=>c.id!==d.clip.id);S.room.clips.push(d.clip);renderTimelineOnly();}finishRecording(end,true,session.startTime);}catch(e){S.uploadedSessions.delete(session.sessionId);finishRecording(end,false,session.startTime);toast(e.message,true);}
}
function finishRecording(end,saved,startTime=end){
  S.recorder=null;S.localSession=null;S.recordingPeaks=[];S.mode='idle';S._stopRequestPending=false;S._stoppingSession=null;clearOverlay();const m=document.querySelector('#movie');if(m){m.pause();m.currentTime=saved?startTime:end;}S.voiceSuppressed=true;applyVoicePolicy();updatePlayhead(saved?startTime:end);updateControls();syncRecordingDom();if(saved)toast('Готово. Выключите 🎙 и нажмите Space — сразу услышите свою запись от этого курсора.');
}
