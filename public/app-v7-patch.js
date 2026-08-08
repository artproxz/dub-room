/* DubRoom v0.7: instant transport, film gain, microphone cleanup and hardened UI bindings. */
S.noiseCleanup = localStorage.getItem('dubroom:noise-cleanup') !== 'off';
S.filmVolume = clamp(Number(S.filmVolume || .8), 0, 3);
S._recordServerPromise = null;
S._localStopEnd = null;
S._movieAudio = null;
S._recordingProcessor = null;

function v7SessionId(){return crypto.randomUUID().replace(/-/g,'').slice(0,16);}

async function ensureMic(){
  if(S.micStream?.active){await applyMicCleanupConstraint();return S.micStream;}
  const audio={echoCancellation:{ideal:S.noiseCleanup},noiseSuppression:{ideal:S.noiseCleanup},autoGainControl:{ideal:true},channelCount:{ideal:1},latency:{ideal:.01}};
  const raw=await navigator.mediaDevices.getUserMedia({audio,video:false});
  S.micRawStream=raw;S.micStream=raw;
  S.audioContext ||= new AudioContext({latencyHint:'interactive'});
  S.audioContext.resume().catch(()=>{});
  const source=S.audioContext.createMediaStreamSource(raw);
  S.analyser=S.audioContext.createAnalyser();S.analyser.fftSize=512;S.analyser.smoothingTimeConstant=.64;source.connect(S.analyser);
  const data=new Uint8Array(S.analyser.fftSize);
  const tick=()=>{
    if(!S.analyser)return;
    S.analyser.getByteTimeDomainData(data);let sum=0;for(const sample of data){const n=(sample-128)/128;sum+=n*n;}
    const level=Math.min(1,Math.sqrt(sum/data.length)*5.6);updateLevel(participantId,level);
    const t=performance.now();
    if(S.mode==='recording'&&S.localSession&&t-(S._lastPeakAt||0)>30){S.recordingPeaks.push(level);S._lastPeakAt=t;updateLiveClip(participantId);}
    if(S.room&&t-S.lastLevelSentAt>75){fetch(`/api/rooms/${S.room.id}/level`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({participantId,level}),keepalive:true}).catch(()=>{});S.lastLevelSentAt=t;}
    S.meterFrame=requestAnimationFrame(tick);
  };
  tick();
  return raw;
}
async function applyMicCleanupConstraint(){
  const track=(S.micRawStream||S.micStream)?.getAudioTracks?.()[0];if(!track)return;
  try{await track.applyConstraints({echoCancellation:S.noiseCleanup,noiseSuppression:S.noiseCleanup,autoGainControl:true});}catch{}
}
function recordingStream(){
  const raw=S.micRawStream||S.micStream;if(!raw||!S.noiseCleanup||!S.audioContext)return raw;
  const rawTrack=raw.getAudioTracks()[0];
  if(S._recordingProcessor?.rawTrack===rawTrack)return S._recordingProcessor.destination.stream;
  try{S._recordingProcessor?.source?.disconnect();S._recordingProcessor?.filter?.disconnect();S._recordingProcessor?.compressor?.disconnect();}catch{}
  const source=S.audioContext.createMediaStreamSource(raw);
  const filter=S.audioContext.createBiquadFilter();filter.type='highpass';filter.frequency.value=78;filter.Q.value=.7;
  const compressor=S.audioContext.createDynamicsCompressor();compressor.threshold.value=-24;compressor.knee.value=12;compressor.ratio.value=3;compressor.attack.value=.003;compressor.release.value=.16;
  const destination=S.audioContext.createMediaStreamDestination();source.connect(filter).connect(compressor).connect(destination);
  S._recordingProcessor={rawTrack,source,filter,compressor,destination};return destination.stream;
}
async function toggleNoiseCleanup(){
  S.noiseCleanup=!S.noiseCleanup;localStorage.setItem('dubroom:noise-cleanup',S.noiseCleanup?'on':'off');await applyMicCleanupConstraint();updateNoiseUi();
  toast(S.noiseCleanup?'Шумоподавление и эхоподавление включены.':'Очистка микрофона выключена.');
}
function updateNoiseUi(){const b=document.querySelector('#noise-toggle');if(b){b.classList.toggle('on',S.noiseCleanup);b.innerHTML=`<span>✨</span><b>ШУМ</b><em>${S.noiseCleanup?'ON':'OFF'}</em>`;}}

function ensureMovieAudioGraph(){
  const movie=document.querySelector('#movie');if(!movie||!S.audioContext)return null;
  if(S._movieAudio?.element===movie)return S._movieAudio;
  try{S._movieAudio?.source?.disconnect();S._movieAudio?.gain?.disconnect();S._movieAudio?.limiter?.disconnect();}catch{}
  try{
    const source=S.audioContext.createMediaElementSource(movie),gain=S.audioContext.createGain(),limiter=S.audioContext.createDynamicsCompressor();
    limiter.threshold.value=-2;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.002;limiter.release.value=.08;
    source.connect(gain).connect(limiter).connect(S.audioContext.destination);S._movieAudio={element:movie,source,gain,limiter};return S._movieAudio;
  }catch{return null;}
}
function applyMovieSound(){
  const m=document.querySelector('#movie');if(!m)return;
  S.audioContext?.resume?.().catch(()=>{});
  const graph=ensureMovieAudioGraph(),value=S.filmSound?clamp(S.filmVolume,0,3):0;
  if(graph){m.muted=false;m.volume=1;graph.gain.gain.cancelScheduledValues(S.audioContext.currentTime);graph.gain.gain.setTargetAtTime(value,S.audioContext.currentTime,.012);}else{m.muted=!S.filmSound;m.volume=clamp(S.filmVolume,0,1);}
  const label=document.querySelector('#film-volume-label');if(label)label.textContent=`${Math.round(S.filmVolume*100)}%`;
}

function renderVideo(duration){
  const span=Math.max(0,S.room.range.end-S.room.range.start);
  return `<div class="video-stage-v5"><video id="movie" src="${esc(S.room.video.url)}" playsinline preload="metadata"></video><div id="stage-overlay"></div></div><div class="transport-v5"><button id="play-button" class="icon-btn primary">▶</button><button id="stop-button" class="icon-btn">■</button><div class="time-v5"><b id="playhead-time">${fmt(S.room.range.start,true)}</b><span>/ ${fmt(duration,true)}</span></div><button id="set-in" class="range-btn in" ${isHost()?'':'disabled'}><small>IN</small><b id="range-start-label">${fmt(S.room.range.start,true)}</b></button><span>—</span><button id="set-out" class="range-btn out" ${isHost()?'':'disabled'}><small>OUT</small><b id="range-end-label">${fmt(S.room.range.end,true)}</b></button><div class="duration-v5"><small>Фрагмент</small><b>${span.toFixed(1)} сек</b></div><div class="transport-spacer"></div><label class="film-toggle-v5"><input id="film-sound" type="checkbox" ${S.filmSound?'checked':''}><span>🔊 Фильм</span></label><div class="film-gain-v7"><input id="film-volume" class="mini-slider" type="range" min="0" max="3" step=".05" value="${S.filmVolume}"><b id="film-volume-label">${Math.round(S.filmVolume*100)}%</b></div><button id="noise-toggle" class="noise-toggle-v7 ${S.noiseCleanup?'on':''}" title="Шумоподавление + эхоподавление"><span>✨</span><b>ШУМ</b><em>${S.noiseCleanup?'ON':'OFF'}</em></button><button id="rec-toggle" class="rec-toggle-v5 mic-mode-v6 ${me()?.armed?'on':''}" title="Режим записи"><span class="mic-icon-v6">🎙</span><span>${me()?.armed?'ВКЛ':'ВЫКЛ'}</span></button><button id="ready-button" class="ready-v5 ${me()?.ready?'on':''}">${me()?.ready?'✓ ГОТОВ':'Я ГОТОВ'}</button>${isHost()?`<button id="launch-final" class="launch-v5" ${allReady()?'':'disabled'}>▶ ЗАПУСТИТЬ ИТОГ</button>`:''}</div><div class="video-meta-v5"><span>${esc(S.room.video.originalName)} · ${sizeFmt(S.room.video.size)}</span><b id="space-hint">${spaceHint()}</b></div>`;
}

const v7BaseBindStudio=bindStudio;
bindStudio=function(){
  v7BaseBindStudio();
  document.querySelector('#noise-toggle')?.addEventListener('click',toggleNoiseCleanup);
  document.querySelector('#film-volume')?.addEventListener('input',e=>{S.filmVolume=clamp(Number(e.target.value),0,3);localStorage.setItem('dubroom:film-volume',String(S.filmVolume));applyMovieSound();});
  ensureMovieAudioGraph();applyMovieSound();updateNoiseUi();
};

function toggleRecArm(){
  if(S.mode==='recording'||S.mode==='countdown')return Promise.resolve();const p=me();if(!p)return Promise.resolve();
  S._armSyncPromise=saveParticipantPatch({armed:!p.armed,ready:false},true).then(()=>{applyVoicePolicy();updateControls();return true;});
  return S._armSyncPromise;
}

function bindPlayersOnlyV7(){
  document.querySelector('#lobby-mute')?.addEventListener('click',()=>{S.manualVoiceMute=!S.manualVoiceMute;applyVoicePolicy();patchVoiceUi();});
  document.querySelector('#color-input')?.addEventListener('input',e=>saveParticipantPatch({color:e.target.value,ready:false},true));
  document.querySelector('#role-input')?.addEventListener('input',e=>{clearTimeout(S.roleTimer);const role=e.target.value,p=me();if(p)p.role=role;S.roleTimer=setTimeout(()=>saveParticipantPatch({role,ready:false},false),180);});
}
function applySnapshot(next){
  if(!next)return;const prev=S.room;S.room=next;const videoChanged=prev?.video?.url!==next.video?.url;
  const participantIds=(prev?.participants||[]).map(p=>p.id).join('|')!==next.participants.map(p=>p.id).join('|');
  if(videoChanged||!document.querySelector('.studio-v5'))return renderStudio();
  if(participantIds){const pp=document.querySelector('#players-panel'),tp=document.querySelector('#timeline-panel');if(pp)pp.innerHTML=renderPlayers();if(tp&&S.room.video)tp.innerHTML=renderTimeline(Math.max(videoDuration(),S.room.range.end,30));bindPlayersOnlyV7();bindTimelineOnly();}
  else{updateAllUi();syncClipDom();syncRecordingDom();}
  syncVoicePeers();
}

async function startOwnRecording(){
  if(S.mode!=='idle'||S.localSession||!me()?.armed)return;
  stopPlaybackOnly();
  if(!S.micStream?.active)try{await ensureMic();}catch(e){return toast('Микрофон недоступен.',true);}
  S.audioContext?.resume?.().catch(()=>{});
  const m=document.querySelector('#movie'),startTime=cursorStart(),sessionId=v7SessionId();
  if(m){m.pause();m.currentTime=startTime;updatePlayhead(startTime);}
  const provisional={sessionId,participantId,startTime,endTime:S.room.range.end,startAt:Date.now(),stopAt:Date.now()+Math.max(100,(S.room.range.end-startTime)*1000)};
  S.room.recordings=S.room.recordings.filter(r=>r.participantId!==participantId);S.room.recordings.push(provisional);
  S._recordServerPromise=Promise.resolve(S._armSyncPromise).then(()=>json(`/api/rooms/${S.room.id}/recording/start`,{method:'POST',body:JSON.stringify({participantId,startTime,sessionId})})).then(p=>{if(S.localSession?.sessionId===sessionId)Object.assign(S.localSession,p);return p;}).catch(e=>{if(S.localSession?.sessionId===sessionId)abortLocalRecordingV7(e.message);toast(e.message,true);return null;});
  beginLocalRecording(provisional);
}
async function beginLocalRecording(p){
  try{
    const stream=recordingStream();if(!stream?.active)throw new Error('Микрофон не готов.');
    S.mode='recording';S.localSession={...p};S.recorderChunks=[];S.recordingPeaks=[];S._lastPeakAt=0;S._stopRequestPending=false;S._stoppingSession=null;S._localStopEnd=null;S.voiceSuppressed=true;applyVoicePolicy();clearOverlay();
    const mime=pickMime();S.recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);S.recorder.ondataavailable=e=>{if(e.data.size)S.recorderChunks.push(e.data);};S.recorder.onstop=uploadRecordedClip;
    S.recorder.start(50);
    const m=document.querySelector('#movie');if(m){m.currentTime=p.startTime;applyMovieSound();m.play().catch(()=>{});}
    clearTimeout(S.stopTimer);S.stopTimer=setTimeout(()=>stopOwnRecording(),Math.max(80,(p.endTime-p.startTime)*1000+20));syncRecordingDom();patchParticipant(me());updateControls();
  }catch(e){abortLocalRecordingV7(e.message);toast(e.message||'Не удалось начать запись.',true);}
}
function abortLocalRecordingV7(message=''){
  clearTimeout(S.stopTimer);const session=S.localSession;S.room.recordings=S.room.recordings.filter(r=>r.participantId!==participantId);if(S.recorder&&S.recorder.state!=='inactive'){S.recorder.onstop=null;try{S.recorder.stop();}catch{}}
  S.recorder=null;S.localSession=null;S.recorderChunks=[];S.recordingPeaks=[];S.mode='idle';S.voiceSuppressed=false;applyVoicePolicy();syncRecordingDom();patchParticipant(me());updateControls();if(message)console.warn('recording aborted',message,session?.sessionId);
}
function stopOwnRecording(){
  if(!S.localSession||S._stopRequestPending)return;
  S._stopRequestPending=true;const session=S.localSession,m=document.querySelector('#movie');
  const endTime=clamp(Number(m?.currentTime)||session.startTime,session.startTime,session.endTime);session.actualEndTime=endTime;S._localStopEnd=endTime;
  clearTimeout(S.stopTimer);if(m)m.pause();S.room.recordings=S.room.recordings.filter(r=>r.participantId!==participantId);syncRecordingDom();patchParticipant(me());
  if(S.recorder&&S.recorder.state!=='inactive')S.recorder.stop();
  Promise.resolve(S._recordServerPromise).then(started=>{if(!started)return null;return json(`/api/rooms/${S.room.id}/recording/stop`,{method:'POST',body:JSON.stringify({participantId,endTime})});}).catch(e=>{if(!String(e.message).includes('нет активной'))toast(e.message,true);});
}
function scheduleLocalStop(p){
  if(!S.localSession||S.localSession.sessionId!==p.sessionId)return;
  if(S._localStopEnd!=null){S.localSession.actualEndTime=S._localStopEnd;return;}
  S.localSession.actualEndTime=p.endTime;stopOwnRecording();
}
async function uploadRecordedClip(){
  const session=S.localSession;if(!session)return;S.uploadedSessions??=new Set();if(S.uploadedSessions.has(session.sessionId))return;S.uploadedSessions.add(session.sessionId);
  const started=await Promise.resolve(S._recordServerPromise);if(!started){S.uploadedSessions.delete(session.sessionId);return finishRecording(session.actualEndTime??session.startTime,false,session.startTime);}
  const blob=new Blob(S.recorderChunks,{type:S.recorder?.mimeType||'audio/webm'});S.recorderChunks=[];const end=session.actualEndTime??session.endTime??session.startTime,dur=Math.max(0,end-session.startTime);
  if(dur<.06||blob.size<30)return finishRecording(end,false,session.startTime);
  const wave=resample(S.recordingPeaks,140).map(v=>Math.round(v*100)).join(',');
  try{const r=await fetch(`/api/rooms/${S.room.id}/sessions/${session.sessionId}/clips/${participantId}`,{method:'POST',headers:{'content-type':blob.type||'audio/webm','x-participant-id':participantId,'x-clip-start':String(session.startTime),'x-clip-duration':String(dur),'x-waveform':wave},body:blob});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Не удалось сохранить запись.');if(d.clip){S.room.clips=S.room.clips.filter(c=>c.id!==d.clip.id);S.room.clips.push(d.clip);renderTimelineOnly();}finishRecording(end,true,session.startTime);}catch(e){S.uploadedSessions.delete(session.sessionId);finishRecording(end,false,session.startTime);toast(e.message,true);}
}
function finishRecording(end,saved,startTime=end){
  S.recorder=null;S.localSession=null;S.recordingPeaks=[];S.mode='idle';S._stopRequestPending=false;S._stoppingSession=null;S._localStopEnd=null;S._recordServerPromise=null;clearOverlay();const m=document.querySelector('#movie');if(m){m.pause();m.currentTime=saved?startTime:end;}S.voiceSuppressed=true;applyVoicePolicy();updatePlayhead(saved?startTime:end);updateControls();syncRecordingDom();patchParticipant(me());if(saved)toast('Запись готова. 🎙 ВЫКЛ + Space — мгновенная прослушка от курсора.');
}

function beginFinalPreview(p){
  clearTimeout(S.playbackTimer);clearPlaybackAudio();const m=document.querySelector('#movie');if(!m)return;S.mode='preview';temporarilyMuteLobby(true);clearOverlay();m.pause();m.currentTime=p.startTime;applyMovieSound();
  const wait=Math.max(0,p.previewAt-Date.now());toast('🎬 Итоговый просмотр');
  S.playbackTimer=setTimeout(async()=>{try{m.currentTime=p.startTime;await m.play();playVoiceClips(p.startTime,p.endTime,'all');S.playbackTimer=setTimeout(()=>{m.pause();clearPlaybackAudio();m.currentTime=p.endTime;S.mode='idle';temporarilyMuteLobby(false);updateControls();},Math.max(50,(p.endTime-p.startTime)*1000+70));}catch{S.mode='idle';temporarilyMuteLobby(false);toast('Браузер заблокировал общий просмотр. Нажмите Play.',true);}},wait);
}

window.addEventListener('beforeunload',()=>{S._recordingProcessor?.destination?.stream?.getTracks?.().forEach(t=>t.stop());try{S._movieAudio?.source?.disconnect();S._movieAudio?.gain?.disconnect();S._movieAudio?.limiter?.disconnect();}catch{}});