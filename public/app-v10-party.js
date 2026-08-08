/* DubRoom 1.0 — simple three-person surprise dubbing flow. */
S.partyEditorOpen = false;
S.partyRecordContext = null;
S.partyReplaceOnSuccess = false;
S.partyStartTimer = 0;

const v10NormalizeRoom = normalizeRoom;
normalizeRoom = function(value) {
  const room = v10NormalizeRoom(value); if (!room) return room;
  room.party = {
    phase:'lobby', round:0, sceneIndex:1, roundStartedAt:0,
    expectedParticipantIds:[], completedParticipantIds:[], successfulParticipantIds:[], trackEpochs:{}, savedRounds:[], savedCurrent:false,
    ...(value?.party || room.party || {}),
  };
  room.party.trackEpochs ||= {}; room.party.savedRounds ||= [];
  return room;
};

function v10Party(){return S.room?.party || {phase:'lobby',round:0,sceneIndex:1,roundStartedAt:0,trackEpochs:{},savedRounds:[]};}
function v10Phase(){return v10Party().phase || 'lobby';}
function v10Epoch(id){const p=v10Party();return Math.max(Number(p.roundStartedAt)||0,Number(p.trackEpochs?.[id])||0);}
function v10CurrentClip(c){return Boolean(c && Number(c.createdAt)>=v10Epoch(c.participantId) && Number(c.createdAt)>=Number(v10Party().roundStartedAt||0));}
function v10CurrentClips(id){return (S.room?.clips||[]).filter(c=>(!id||c.participantId===id)&&v10CurrentClip(c));}
function v10HasAudio(id=participantId){return v10CurrentClips(id).some(clipOverlapsRange);}
function v10Connected(){return S.room?.participants?.filter(p=>p.connected)||[];}
function v10AllReady(){const ps=v10Connected();return ps.length>0&&ps.every(p=>p.ready);}
function v10Saved(){return Boolean(v10Party().savedCurrent);}

const v10OldOwnClips=ownClips;
ownClips=function(){return S.room?.party?v10CurrentClips(participantId):v10OldOwnClips();};
if(typeof v8LayoutFor==='function'){
  v8LayoutFor=function(id){return globalThis.DubRoomLayout.assignLanes(v10CurrentClips(id));};
}

const v10OldVoiceLabel=voiceLabel;
voiceLabel=function(){
  if(!S.room?.party)return v10OldVoiceLabel();
  if(S.manualVoiceMute)return'вы выключили голосовой чат';
  if(S._tempVoiceMute||S.mode==='solo')return'тихо, пока вы слушаете запись';
  if(v10Phase()==='recording'||S.mode==='recording')return'тихо — идёт озвучка';
  if(v10Phase()==='preview'||S.mode==='preview')return'тихо — смотрим итог';
  return'слышите друг друга';
};
const v10OldApplyVoicePolicy=applyVoicePolicy;
applyVoicePolicy=function(){
  if(!S.room?.party)return v10OldApplyVoicePolicy();
  const enabled=!S.manualVoiceMute&&!S._tempVoiceMute&&S.mode!=='recording'&&S.mode!=='solo'&&S.mode!=='preview'&&v10Phase()!=='recording'&&v10Phase()!=='preview';
  if(S.voiceTrack)S.voiceTrack.enabled=enabled;
  for(const a of S.remoteAudios.values())a.muted=!enabled;
  patchVoiceUi();
};

function v10PhaseCopy(){
  const phase=v10Phase();
  if(phase==='recording')return['🎙 ОЗВУЧКА','Говорите свои реплики. Друг друга сейчас не слышно.'];
  if(phase==='review')return['✂️ ПРОВЕРКА','Слушайте только себя, при желании подправьте. Чужие голоса пока секрет.'];
  if(phase==='preview')return['😂 ИТОГ','Сейчас впервые услышите всех вместе. Управляет ведущий.'];
  if(phase==='result')return['🥳 СЦЕНА ГОТОВА','Вы снова слышите друг друга. Обсудите, что только что произошло.'];
  return['🎬 ПОДГОТОВКА',`Сцена ${v10Party().sceneIndex}. Выберите кусок, роли и нажмите «Готов».`];
}
function v10PlayerState(p){
  if(!p.connected)return['offline','Не в сети'];
  if(v10Phase()==='recording')return recordingFor(p.id)?['recording','Озвучивает']:['waiting','Запускается'];
  if(v10Phase()==='preview')return['preview','Смотрит итог'];
  if(v10Phase()==='result')return['ready','В голосовом лобби'];
  if(v10Phase()==='review'){
    if(recordingFor(p.id))return['recording','Перезаписывает'];
    if(p.ready)return['ready','Готов смотреть'];
    if(v10HasAudio(p.id))return['recorded','Записал · проверяет'];
    return['waiting','Нужно записаться'];
  }
  return p.ready?['ready','Готов к сцене']:['waiting','Готовится'];
}
function v10RenderPlayers(){
  return `<div class="party-side-title"><b>ВАША КОМПАНИЯ</b><span>${v10Connected().length}/3</span></div>
  <div class="party-players">${S.room.participants.map(p=>{const [key,label]=v10PlayerState(p),self=p.id===participantId;return `<article class="party-player ${key} ${self?'self':''}" style="--pc:${esc(p.color)}"><div class="party-avatar">${esc(p.name[0]?.toUpperCase()||'?')}</div><div class="party-person"><b>${esc(p.name)}${self?' · вы':''}</b>${self&&v10Phase()==='lobby'?`<input id="role-input" maxlength="40" value="${esc(p.role||'')}" placeholder="Ваша роль, например Марти">`:`<span>${esc(p.role||'Роль не выбрана')}</span>`}</div><em>${label}</em></article>`;}).join('')}</div>
  <div class="party-voice"><div><b>🎧 Голосовой чат</b><span id="lobby-state">${voiceLabel()}</span></div><button id="lobby-mute" title="Вкл/выкл голосовой чат">${S.manualVoiceMute?'🔇':'🎙'}</button></div>
  <p class="party-secret">🤫 До итогового просмотра каждый слышит только свою озвучку.</p>`;
}
function v10RenderTopAction(){
  const phase=v10Phase(),meP=me(),has=v10HasAudio();
  if(phase==='recording')return `<div class="party-action recording"><div><b>🎙 Озвучиваем сцену</b><span>Фильм идёт одинаково у всех. Говорите только свою роль.</span></div><strong>ДРУГ ДРУГА НЕ СЛЫШНО</strong></div>`;
  if(phase==='review')return `<div class="party-action review"><div><b>${has?'Ваша дорожка записана':'Запись не найдена'}</b><span>${has?'Прослушайте себя. Чужие дорожки откроются только в итоге.':'Перезапишите свою роль — остальные продолжат общаться.'}</span></div><div class="party-buttons"><button id="party-listen" ${has?'':'disabled'}>▶ Послушать себя</button><button id="party-rerecord">↻ Перезаписать</button><button id="party-edit" ${has?'':'disabled'}>✂ Подправить</button><button id="party-ready" class="good ${meP?.ready?'on':''}" ${has?'':'disabled'}>${meP?.ready?'✓ Я готов':'Готов смотреть'}</button>${isHost()?`<button id="party-final" class="surprise" ${v10AllReady()?'':'disabled'}>😂 ПОСМОТРЕТЬ ИТОГ</button>`:''}</div></div>`;
  if(phase==='preview')return `<div class="party-action preview"><div><b>😂 Вот он — момент истины</b><span>${isHost()?'Space — пауза / продолжить у всех':'Смотрите вместе. Пауза синхронизируется ведущим.'}</span></div></div>`;
  if(phase==='result')return `<div class="party-action result"><div><b>Ну как? 😄</b><span>Вы снова слышите друг друга. Можно обсудить сцену и решить, что дальше.</span></div>${isHost()?`<div class="party-buttons"><button id="party-save" class="good" ${v10Saved()?'disabled':''}>${v10Saved()?'⭐ Сохранено':'⭐ Оставить этот дубль'}</button><button id="party-retry">🔁 Ещё один дубль</button><button id="party-next" class="primary-action">➡ Следующая сцена</button></div>`:'<b class="party-wait-host">Ведущий выбирает, что делать дальше</b>'}</div>`;
  return `<div class="party-action lobby"><div class="party-scene"><b>Выбранная сцена</b><strong>${fmt(S.room.range.start,true)} → ${fmt(S.room.range.end,true)}</strong><span>${(S.room.range.end-S.room.range.start).toFixed(1)} сек</span></div>${isHost()?`<div class="party-buttons"><button id="set-in">Начало здесь</button><button id="set-out">Конец здесь</button></div>`:'<span class="party-host-note">Фрагмент выбирает ведущий</span>'}<div class="party-buttons party-ready-row"><button id="party-ready" class="good ${meP?.ready?'on':''}">${meP?.ready?'✓ Я готов':'Готов к озвучке'}</button>${isHost()?`<button id="party-start" class="primary-action" ${v10AllReady()?'':'disabled'}>🎬 НАЧАТЬ ОЗВУЧКУ</button>`:''}</div></div>`;
}
function v10RenderDock(){
  const cards=S.room.participants.map(p=>{const [key,label]=v10PlayerState(p);return `<div class="party-track-summary ${key}" style="--pc:${esc(p.color)}"><i></i><div><b>${esc(p.name)}</b><span>${label}</span></div><strong>${v10HasAudio(p.id)?'● запись есть':'—'}</strong></div>`;}).join('');
  let editor='';
  if(S.partyEditorOpen&&v10Phase()==='review'){
    S.activeTrackParticipantId=participantId;sessionStorage.setItem('dubroom:active-track',participantId);
    editor=`<div class="party-own-editor"><div class="party-editor-head"><div><b>✂ Точная правка своей дорожки</b><span>Двигайте клипы, тяните края, меняйте громкость. ПКМ — удалить.</span></div><button id="party-editor-close">Готово</button></div>${renderTimeline(Math.max(videoDuration(),S.room.range.end,30))}</div>`;
  }
  return `<div class="party-dock-head"><b>ДОРОЖКИ СЦЕНЫ</b><span>${v10Phase()==='review'?'Чужое содержимое скрыто до итога':'Статусы всех участников'}</span></div><div class="party-track-summaries">${cards}</div>${editor}`;
}
function v10RenderVideo(){
  if(!S.room.video)return `<div class="video-empty-v5"><div>🎞</div><h2>Загрузите фильм</h2><p>Потом выберете короткую сцену и распределите роли.</p>${isHost()?'<label class="upload-v5">Выбрать видео<input id="video-file" type="file" accept="video/*"></label>':'<span>Ждём ведущего.</span>'}</div>`;
  const d=Math.max(videoDuration(),S.room.range.end,30),[title,copy]=v10PhaseCopy();
  return `<div class="party-phase"><b>${title}</b><span>${copy}</span></div><div class="video-stage-v5 party-movie"><video id="movie" src="${esc(S.room.video.url)}" playsinline preload="metadata"></video><div id="stage-overlay"></div></div>
  <div class="party-transport"><button id="play-button" class="party-play">▶</button><button id="stop-button">■</button><div class="time-v5"><b id="playhead-time">${fmt(S.room.range.start,true)}</b><span>/ ${fmt(d,true)}</span></div><div class="party-transport-space"></div><label class="film-toggle-v5"><input id="film-sound" type="checkbox" ${S.filmSound?'checked':''}><span>🔊 Фильм</span></label><div class="film-gain-v7"><input id="film-volume" class="mini-slider" type="range" min="0" max="3" step=".05" value="${S.filmVolume}"><b id="film-volume-label">${Math.round(S.filmVolume*100)}%</b></div><button id="noise-toggle" class="noise-toggle-v7 ${S.noiseCleanup?'on':''}"><span>✨</span><b>ШУМ</b><em>${S.noiseCleanup?'ON':'OFF'}</em></button></div>
  <div class="party-space-hint" id="space-hint">${typeof v9TransportLabel==='function'?v9TransportLabel():'SPACE — play / stop'}</div>${v10RenderTopAction()}`;
}

const v10OldRenderStudio=renderStudio;
renderStudio=function(){
  if(!S.room)return;const [title]=v10PhaseCopy();
  app.innerHTML=`<main class="party-app"><header class="party-header"><div class="logo-v5"><span>DUB</span>ROOM <b>PARTY</b></div><button id="copy-link" class="room-code-v5">Комната <strong>${esc(S.room.id)}</strong> ⧉</button><div class="party-header-phase">${title}</div><div class="header-right-v5"><span><b>${v10Connected().length}</b>/3</span><button id="leave-room">Выйти</button></div></header><section class="party-main"><div class="party-video-card">${v10RenderVideo()}</div><aside class="party-sidebar" id="players-panel">${v10RenderPlayers()}</aside></section><section class="party-bottom" id="timeline-panel">${S.room.video?v10RenderDock():'<div class="timeline-empty-v5">Монтаж появится после записи первой сцены.</div>'}</section></main><div id="voice-audio-bin" hidden></div>`;
  v10BindStudio();updateAllUi();applyVoicePolicy();
};

const v10BaseBindStudio=bindStudio;
function v10BindStudio(){
  v10BaseBindStudio();
  document.querySelector('#party-ready')?.addEventListener('click',async()=>{if(v10Phase()==='review'&&!v10HasAudio())return toast('Сначала запишите свою роль.',true);await saveParticipantPatch({ready:!me()?.ready,armed:false},true);S.localRecordArmed=false;S.voiceSuppressed=false;applyVoicePolicy();renderStudio();});
  document.querySelector('#party-start')?.addEventListener('click',()=>json(`/api/rooms/${S.room.id}/party/start`,{method:'POST',body:JSON.stringify({participantId})}).catch(e=>toast(e.message,true)));
  document.querySelector('#party-final')?.addEventListener('click',()=>json(`/api/rooms/${S.room.id}/party/final/start`,{method:'POST',body:JSON.stringify({participantId})}).catch(e=>toast(e.message,true)));
  document.querySelector('#party-listen')?.addEventListener('click',()=>{S.localRecordArmed=false;const p=me();if(p)p.armed=false;v9TransportToggle();});
  document.querySelector('#party-rerecord')?.addEventListener('click',v10StartRerecord);
  document.querySelector('#party-edit')?.addEventListener('click',()=>{S.partyEditorOpen=true;renderStudio();});
  document.querySelector('#party-editor-close')?.addEventListener('click',()=>{S.partyEditorOpen=false;renderStudio();});
  document.querySelector('#party-save')?.addEventListener('click',()=>v10PartyAction('save'));
  document.querySelector('#party-retry')?.addEventListener('click',()=>v10PartyAction('retry'));
  document.querySelector('#party-next')?.addEventListener('click',()=>v10PartyAction('next'));
}
async function v10PartyAction(action){try{await json(`/api/rooms/${S.room.id}/party/action`,{method:'POST',body:JSON.stringify({participantId,action})});if(action==='next')toast('Новая сцена: найдите следующий момент фильма и задайте начало/конец.');if(action==='retry')toast('Ещё дубль: роли и сцена сохранены, всем нужно снова нажать «Готов».');if(action==='save')toast('⭐ Этот дубль отмечен как удачный в текущей комнате.');}catch(e){toast(e.message,true);}}
async function v10StartRerecord(){
  if(S.mode==='recording'||S.localSession)return;const p=me();if(!p)return;
  S.partyRecordContext={initial:false,replace:true,round:v10Party().round};S.partyReplaceOnSuccess=true;S.partyEditorOpen=false;S.localRecordArmed=true;p.armed=true;p.ready=false;S.voiceSuppressed=true;
  await saveParticipantPatch({armed:true,ready:false},true).catch(()=>{});const m=document.querySelector('#movie');if(m){m.currentTime=S.room.range.start;updatePlayhead(m.currentTime);}startOwnRecording();
}

const v10PrevFinishRecording=finishRecording;
finishRecording=function(end,saved,startTime=end){
  const ctx=S.partyRecordContext;v10PrevFinishRecording(end,saved,startTime);S.partyRecordContext=null;S.localRecordArmed=false;S.partyReplaceOnSuccess=false;S.voiceSuppressed=false;const p=me();if(p)p.armed=false;applyVoicePolicy();updateControls();
  if(ctx?.initial)json(`/api/rooms/${S.room.id}/party/recorded`,{method:'POST',body:JSON.stringify({participantId,success:Boolean(saved)})}).catch(()=>{});
  if(saved&&S.room?.party)toast(ctx?.initial?'Записано! Теперь снова слышите друзей.':'Новая версия записана. Вы снова в голосовом лобби.');
};

uploadRecordedClip=async function(){
  const session=S.localSession;if(!session)return;S.uploadedSessions??=new Set();if(S.uploadedSessions.has(session.sessionId))return;S.uploadedSessions.add(session.sessionId);
  const started=await Promise.resolve(S._recordServerPromise);if(!started){S.uploadedSessions.delete(session.sessionId);return finishRecording(session.actualEndTime??session.startTime,false,session.startTime);}
  const blob=new Blob(S.recorderChunks,{type:S.recorder?.mimeType||'audio/webm'});S.recorderChunks=[];const end=session.actualEndTime??session.endTime??session.startTime,dur=Math.max(0,end-session.startTime);if(dur<.06||blob.size<30)return finishRecording(end,false,session.startTime);
  const wave=resample(S.recordingPeaks,140).map(v=>Math.round(v*100)).join(','),syncMs=typeof v8SyncCompMs==='function'?v8SyncCompMs():0;
  try{
    const r=await fetch(`/api/rooms/${S.room.id}/sessions/${session.sessionId}/clips/${participantId}`,{method:'POST',headers:{'content-type':blob.type||'audio/webm','x-participant-id':participantId,'x-clip-start':String(session.startTime),'x-clip-duration':String(dur),'x-waveform':wave,'x-sync-comp-ms':String(syncMs)},body:blob});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Не удалось сохранить запись.');
    if(d.clip){S.room.clips=S.room.clips.filter(c=>c.id!==d.clip.id);S.room.clips.push(d.clip);if(S.partyReplaceOnSuccess){await json(`/api/rooms/${S.room.id}/party/track-epoch`,{method:'POST',body:JSON.stringify({participantId,epoch:Math.max(v10Party().roundStartedAt,d.clip.createdAt-1)})});}S.activeTrackParticipantId=participantId;}
    finishRecording(end,true,d.clip?.start??session.startTime);renderStudio();
  }catch(e){S.uploadedSessions.delete(session.sessionId);finishRecording(end,false,session.startTime);toast(e.message,true);}
};

function v10BeginPartyRecording(d){
  const sessionId=d?.sessions?.[participantId];if(!sessionId)return;clearTimeout(S.partyStartTimer);S.partyRecordContext={initial:true,replace:false,round:d.round};S.partyReplaceOnSuccess=false;S.localRecordArmed=false;const p=me();if(p){p.armed=false;p.ready=false;}S.voiceSuppressed=true;applyVoicePolicy();
  const provisional={sessionId,participantId,startTime:d.startTime,endTime:d.endTime,startAt:d.startAt,stopAt:d.startAt+(d.endTime-d.startTime)*1000+1500};
  S._recordServerPromise=Promise.resolve(provisional);
  S.partyStartTimer=setTimeout(()=>{if(v10Phase()!=='recording'||S.localSession)return;beginLocalRecording(provisional);},Math.max(0,d.startAt-Date.now()));
}

const v10PrevConnectEvents=connectEvents;
connectEvents=function(){
  v10PrevConnectEvents();
  S.eventSource?.addEventListener('party-state',e=>{const d=JSON.parse(e.data);if(!S.room||!d.party)return;const before=v10Phase();S.room.party=d.party;if(['lobby','review','result'].includes(d.party.phase)){S.voiceSuppressed=false;S.localRecordArmed=false;}applyVoicePolicy();if(before!==d.party.phase||d.party.phase==='result')renderStudio();else v10PatchParty();});
  S.eventSource?.addEventListener('party-record-start',e=>v10BeginPartyRecording(JSON.parse(e.data)));
};
function v10PatchParty(){const side=document.querySelector('#players-panel'),bottom=document.querySelector('#timeline-panel');if(side)side.innerHTML=v10RenderPlayers();if(bottom&&S.room.video)bottom.innerHTML=v10RenderDock();const action=document.querySelector('.party-action');if(action){const tmp=document.createElement('div');tmp.innerHTML=v10RenderTopAction();action.replaceWith(tmp.firstElementChild);}v10BindLight();applyVoicePolicy();}
function v10BindLight(){
  document.querySelector('#lobby-mute')?.addEventListener('click',()=>{S.manualVoiceMute=!S.manualVoiceMute;applyVoicePolicy();});
  document.querySelector('#role-input')?.addEventListener('input',e=>{clearTimeout(S.roleTimer);const role=e.target.value,p=me();if(p)p.role=role;S.roleTimer=setTimeout(()=>saveParticipantPatch({role,ready:false},false),180);});
}

const v10PrevApplySnapshot=applySnapshot;
applySnapshot=function(next){const before=S.room?.party?.phase,round=S.room?.party?.round;v10PrevApplySnapshot(next);if(next?.party&&(before!==next.party.phase||round!==next.party.round))renderStudio();};

const v10BasePlayVoiceClips=playVoiceClips;
playVoiceClips=function(from,to,filter='all'){
  if(!S.room?.party)return v10BasePlayVoiceClips(from,to,filter);
  clearPlaybackAudio();const phase=v10Phase();if(!['review','preview','result'].includes(phase))return;
  for(const c of v10CurrentClips()){
    if(filter==='own'&&c.participantId!==participantId)continue;const end=c.start+c.duration;if(end<=from||c.start>=to)continue;
    const a=new Audio(c.url);a.preload='auto';a.dataset.baseVolume=String(c.volume);a.volume=clamp(c.volume*S.masterVolume,0,1);S.playbackAudios.push(a);
    const delay=Math.max(0,(c.start-from)*1000),skip=Math.max(0,from-c.start),sourceOffset=typeof v8ClipOffset==='function'?v8ClipOffset(c):0;
    const start=()=>{a.currentTime=Math.max(0,sourceOffset+skip);a.play().catch(()=>{});const remain=Math.max(0,Math.min(end,to)-Math.max(from,c.start));S.playbackTimers.push(setTimeout(()=>a.pause(),remain*1000+35));};
    if(delay<12)start();else S.playbackTimers.push(setTimeout(start,delay));
  }
};

/* Keep surprise intact inside the advanced editor: only your tab/current take is available. */
const v10OldV8ActiveTrackId=typeof v8ActiveTrackId==='function'?v8ActiveTrackId:null;
if(v10OldV8ActiveTrackId)v8ActiveTrackId=function(){return participantId;};

/* Final preview finishing always returns to a live voice lobby. */
document.addEventListener('pause',e=>{if(e.target?.id==='movie'&&v10Phase()==='result'){S.voiceSuppressed=false;temporarilyMuteLobby(false);applyVoicePolicy();}},true);
