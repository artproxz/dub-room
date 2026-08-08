const app = document.querySelector('#app');
const participantId = localStorage.getItem('dubroom:participant-id') || crypto.randomUUID().slice(0, 8);
localStorage.setItem('dubroom:participant-id', participantId);
const initialRoomCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';

const S = {
  room: null,
  eventSource: null,
  micStream: null,
  audioContext: null,
  analyser: null,
  meterFrame: 0,
  levelHistory: new Map(),
  lastLevelSentAt: 0,
  mode: 'idle', // idle | countdown | recording | solo | preview
  recorder: null,
  recorderChunks: [],
  localSession: null,
  recordingPeaks: [],
  startTimer: 0,
  stopTimer: 0,
  countdownTimer: 0,
  playbackTimer: 0,
  playbackAudios: [],
  playbackTimers: [],
  visibleSeconds: 60,
  viewStart: 0,
  timelineFrame: 0,
  filmSound: true,
  filmVolume: Number(localStorage.getItem('dubroom:film-volume') || 0.8),
  masterVolume: Number(localStorage.getItem('dubroom:master-volume') || 1),
  voiceTrack: null,
  voiceSuppressed: false,
  manualVoiceMute: false,
  peers: new Map(),
  remoteAudios: new Map(),
  patchSeq: new Map(),
  patchLastAt: new Map(),
  patchTimers: new Map(),
  patchPending: new Map(),
  roleTimer: 0,
  selectedClipId: null,
};

function esc(value) {
  return String(value ?? '').replace(/[&<>\'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;' }[c]));
}
function clamp(value, min, max) { const n = Number(value); return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min)); }
function fmt(value, precise = false) {
  const n = Math.max(0, Number(value) || 0), whole = Math.floor(n);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const base = h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return precise ? `${base}.${String(Math.floor((n % 1) * 1000)).padStart(3,'0')}` : base;
}
function sizeFmt(bytes) { if (bytes < 1048576) return `${Math.round(bytes/1024)} КБ`; if (bytes < 1073741824) return `${(bytes/1048576).toFixed(1)} МБ`; return `${(bytes/1073741824).toFixed(2)} ГБ`; }
function me() { return S.room?.participants?.find((p) => p.id === participantId); }
function isHost() { return S.room?.hostParticipantId === participantId; }
function videoDuration() { return Number(S.room?.video?.duration) || document.querySelector('#movie')?.duration || 0; }
function recordingFor(id) { return S.room?.recordings?.find((r) => r.participantId === id); }
function ownClips() { return S.room?.clips?.filter((c) => c.participantId === participantId) || []; }
function clipOverlapsRange(c) { return c.start < S.room.range.end && c.start + c.duration > S.room.range.start; }
function hasOwnRangeAudio() { return ownClips().some(clipOverlapsRange); }
function allReady() { const ps = S.room?.participants?.filter((p) => p.connected) || []; return ps.length > 0 && ps.every((p) => p.ready); }

function toast(message, error = false) {
  let el = document.querySelector('.toast-v5');
  if (!el) { el = document.createElement('div'); el.className = 'toast-v5'; document.body.appendChild(el); }
  el.className = `toast-v5${error ? ' error' : ''}`; el.textContent = message;
  clearTimeout(el._t); el._t = setTimeout(() => el.remove(), 4200); el.onclick = () => el.remove();
}
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type':'application/json', ...(options.headers || {}) } });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}
function normalizeRoom(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    participants: Array.isArray(value.participants) ? value.participants : [],
    clips: Array.isArray(value.clips) ? value.clips : [],
    recordings: Array.isArray(value.recordings) ? value.recordings : [],
    range: value.range || { start:0, end:30 },
  };
}

async function ensureMic() {
  if (S.micStream?.active) return S.micStream;
  S.micStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
  S.audioContext = new AudioContext();
  const source = S.audioContext.createMediaStreamSource(S.micStream);
  S.analyser = S.audioContext.createAnalyser(); S.analyser.fftSize = 512; S.analyser.smoothingTimeConstant = .68; source.connect(S.analyser);
  const data = new Uint8Array(S.analyser.fftSize);
  const tick = () => {
    if (!S.analyser) return;
    S.analyser.getByteTimeDomainData(data);
    let sum = 0; for (const sample of data) { const n = (sample - 128) / 128; sum += n*n; }
    const level = Math.min(1, Math.sqrt(sum / data.length) * 5.6);
    updateLevel(participantId, level);
    const t = performance.now();
    if (S.mode === 'recording' && S.localSession && t - (S._lastPeakAt || 0) > 38) { S.recordingPeaks.push(level); S._lastPeakAt = t; updateLiveClip(participantId); }
    if (S.room && t - S.lastLevelSentAt > 80) {
      fetch(`/api/rooms/${S.room.id}/level`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ participantId, level }), keepalive:true }).catch(()=>{});
      S.lastLevelSentAt = t;
    }
    S.meterFrame = requestAnimationFrame(tick);
  };
  tick();
  return S.micStream;
}
function pickMime() { return ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || ''; }

function renderLobby() {
  const name = localStorage.getItem('dubroom:name') || '';
  app.innerHTML = `<main class="lobby-v5"><section><div class="logo-v5"><span>DUB</span>ROOM <b>STUDIO</b></div><h1>Озвучьте один фрагмент.<br>Потом слушайте хаос вместе.</h1><p>До трёх человек. Сначала слышите друг друга в лобби, во время записи — нет. У каждого своя дорожка.</p><form id="lobby-form"><label>Ваше имя<input id="name" maxlength="32" value="${esc(name)}" placeholder="Например, Дима" required></label>${initialRoomCode?`<label>Код комнаты<input id="room-code" value="${esc(initialRoomCode)}" required></label>`:''}<button type="submit">${initialRoomCode?'Войти в комнату':'Создать комнату'}</button>${!initialRoomCode?'<button type="button" class="secondary" id="join-code">У меня есть код</button>':''}</form><small>🎙 Микрофон нужен для лобби и записи. Видео и голосовые дорожки хранятся временно.</small></section></main>`;
  document.querySelector('#lobby-form').onsubmit = async (e) => { e.preventDefault(); const n=document.querySelector('#name').value.trim(); const code=initialRoomCode?document.querySelector('#room-code').value.trim().toUpperCase():null; await enterRoom(n,code); };
  document.querySelector('#join-code')?.addEventListener('click', async () => { const n=document.querySelector('#name').value.trim(); const code=prompt('Код комнаты')?.trim().toUpperCase(); if(code) await enterRoom(n,code); });
}
async function enterRoom(name, code) {
  if (!name) return toast('Введите имя.', true);
  try { await ensureMic(); } catch { return toast('Разрешите доступ к микрофону.', true); }
  localStorage.setItem('dubroom:name', name);
  try {
    const result = code ? await json(`/api/rooms/${encodeURIComponent(code)}/join`, { method:'POST', body:JSON.stringify({participantId,name}) }) : await json('/api/rooms', { method:'POST', body:JSON.stringify({participantId,name}) });
    S.room = normalizeRoom(result.room); if (!S.room?.id) throw new Error('Некорректное состояние комнаты.');
    const u = new URL(location.href); u.searchParams.set('room',S.room.id); history.replaceState({},'',u);
    S.voiceSuppressed = false; connectEvents(); renderStudio(); await syncVoicePeers(); applyVoicePolicy();
  } catch (e) { toast(e.message,true); }
}

function participantStatus(p) {
  if (!p.connected) return ['offline','Не в сети'];
  if (recordingFor(p.id)) return ['recording','Записывает'];
  if (p.ready) return ['ready','Готов'];
  if ((p.id === participantId && S.mode === 'solo') || document.querySelector(`[data-editing-user="${CSS.escape(p.id)}"]`)) return ['editing','Редактирует'];
  if (S.room.clips.some((c)=>c.participantId===p.id && clipOverlapsRange(c))) return ['recorded','Записал'];
  return ['waiting','Не готов'];
}
function renderStudio() {
  if (!S.room) return;
  const d = Math.max(videoDuration(), S.room.range.end || 30, 30);
  if (!Number.isFinite(S.visibleSeconds) || S.visibleSeconds <= 0) S.visibleSeconds = Math.min(60,d);
  S.visibleSeconds = Math.min(Math.max(5,S.visibleSeconds),Math.max(5,d));
  S.viewStart = clamp(S.viewStart,0,Math.max(0,d-S.visibleSeconds));
  app.innerHTML = `<main class="studio-v5">
    <header class="header-v5"><div class="logo-v5"><span>DUB</span>ROOM <b>STUDIO</b></div><button id="copy-link" class="room-code-v5">Комната <strong>${esc(S.room.id)}</strong> ⧉</button><div class="fragment-summary-v5"><b>Общий фрагмент</b><span id="fragment-summary">${fragmentSummary()}</span></div><div class="header-right-v5"><span><b id="online-count">${S.room.participants.filter(p=>p.connected).length}</b>/3</span><button id="leave-room">Выйти</button></div></header>
    <section class="main-v5"><div class="video-card-v5">${S.room.video ? renderVideo(d) : renderVideoEmpty()}</div><aside class="players-v5" id="players-panel">${renderPlayers()}</aside></section>
    <section class="timeline-v5" id="timeline-panel">${S.room.video ? renderTimeline(d) : '<div class="timeline-empty-v5">Загрузите фильм — монтажный стол появится здесь.</div>'}</section>
  </main><div id="voice-audio-bin" hidden></div>`;
  bindStudio(); updateAllUi();
}
function renderVideo(duration) {
  const span = Math.max(0,S.room.range.end-S.room.range.start);
  return `<div class="video-stage-v5"><video id="movie" src="${esc(S.room.video.url)}" playsinline preload="metadata"></video><div id="stage-overlay"></div></div><div class="transport-v5"><button id="play-button" class="icon-btn primary">▶</button><button id="stop-button" class="icon-btn">■</button><div class="time-v5"><b id="playhead-time">${fmt(S.room.range.start,true)}</b><span>/ ${fmt(duration,true)}</span></div><button id="set-in" class="range-btn in" ${isHost()?'':'disabled'}><small>IN</small><b id="range-start-label">${fmt(S.room.range.start,true)}</b></button><span>—</span><button id="set-out" class="range-btn out" ${isHost()?'':'disabled'}><small>OUT</small><b id="range-end-label">${fmt(S.room.range.end,true)}</b></button><div class="duration-v5"><small>Фрагмент</small><b>${span.toFixed(1)} сек</b></div><div class="transport-spacer"></div><label class="film-toggle-v5"><input id="film-sound" type="checkbox" ${S.filmSound?'checked':''}><span>🔊 Фильм</span></label><input id="film-volume" class="mini-slider" type="range" min="0" max="1" step=".01" value="${S.filmVolume}"><button id="rec-toggle" class="rec-toggle-v5 ${me()?.armed?'on':''}"><i></i><span>${me()?.armed?'REC ON':'REC OFF'}</span></button><button id="ready-button" class="ready-v5 ${me()?.ready?'on':''}">${me()?.ready?'✓ ГОТОВ':'Я ГОТОВ'}</button>${isHost()?`<button id="launch-final" class="launch-v5" ${allReady()?'':'disabled'}>▶ ЗАПУСТИТЬ ИТОГ</button>`:''}</div><div class="video-meta-v5"><span>${esc(S.room.video.originalName)} · ${sizeFmt(S.room.video.size)}</span><b id="space-hint">${spaceHint()}</b></div>`;
}
function renderVideoEmpty() { return `<div class="video-empty-v5"><div>🎞</div><h2>Сначала загрузите фильм</h2><p>После этого ведущий выберет общий IN–OUT.</p>${isHost()?'<label class="upload-v5">Выбрать видео<input id="video-file" type="file" accept="video/*"></label>':'<span>Ждём ведущего.</span>'}</div>`; }
function fragmentSummary(){ if(!S.room.video)return'Видео не загружено'; return `${fmt(S.room.range.start,true)} — ${fmt(S.room.range.end,true)} · ${(S.room.range.end-S.room.range.start).toFixed(1)} сек`; }
function spaceHint(){ if(S.mode==='recording'||S.mode==='countdown')return'SPACE — остановить запись'; return me()?.armed?'SPACE — записать этот фрагмент':'SPACE — просмотреть этот фрагмент'; }

function renderPlayers() {
  return `<div class="players-title-v5"><b>УЧАСТНИКИ</b><span>${S.room.participants.filter(p=>p.connected).length}/3</span></div><div class="player-list-v5">${S.room.participants.map(renderPlayer).join('')}</div><div class="lobby-box-v5"><div><b>Голосовое лобби</b><span id="lobby-state">${voiceLabel()}</span></div><button id="lobby-mute">${S.manualVoiceMute?'🔇':'🎙'}</button></div><div class="rules-v5"><p>🎬 Один IN–OUT у всех</p><p>🎙 Во время записи голоса игроков глушатся</p><p>✅ Готовые снова слышат друг друга</p></div>`;
}
function renderPlayer(p) {
  const [key,label] = participantStatus(p), self=p.id===participantId;
  return `<article class="player-v5 status-${key}" data-player="${esc(p.id)}" style="--pc:${esc(p.color)}"><div class="avatar-v5">${esc(p.name[0]?.toUpperCase()||'?')}</div><div class="player-info-v5"><b>${self?'Вы · ':''}${esc(p.name)}</b><span data-player-status>${label}</span>${self?`<input class="role-input-v5" id="role-input" maxlength="40" placeholder="Роль / персонаж" value="${esc(p.role||'')}">`:`<small>${esc(p.role||'Роль не выбрана')}</small>`}</div><div class="meter-v5" data-meter="${esc(p.id)}">${Array.from({length:8},(_,i)=>`<i data-i="${i}"></i>`).join('')}</div>${self?`<label class="color-v5"><input id="color-input" type="color" value="${esc(p.color)}"></label>`:''}</article>`;
}

function renderTimeline(duration) {
  return `<div class="timeline-toolbar-v5"><div><b>МОНТАЖНЫЙ СТОЛ</b><span>ПКМ по своей записи — удалить</span></div><div class="zoom-v5"><button id="zoom-out">−</button><b id="zoom-label">${zoomLabel()}</b><button id="zoom-in">+</button><button id="fit-range">Показать IN–OUT</button></div><div class="master-v5"><span>MASTER</span><input id="master-volume" type="range" min="0" max="1" step=".01" value="${S.masterVolume}"><b id="master-label">${Math.round(S.masterVolume*100)}%</b></div></div><div class="timeline-grid-v5"><div class="track-head-v5 ruler-head-v5">ДОРОЖКИ</div><div class="viewport-v5 ruler-v5" id="timeline-ruler">${rangeOverlay()}<div class="ticks-v5">${ticksHtml()}</div>${isHost()?rangeHandles():''}<div class="playhead-v5" data-playhead></div></div>${S.room.participants.map(renderTrack).join('')}</div>`;
}
function renderTrack(p) {
  const self=p.id===participantId,[key,label]=participantStatus(p),clips=S.room.clips.filter(c=>c.participantId===p.id).sort((a,b)=>a.start-b.start),lanes=assignLanes(clips);
  return `<div class="track-head-v5 status-${key}" data-track-head="${esc(p.id)}" style="--pc:${esc(p.color)}"><div class="track-id-v5"><div class="track-avatar-v5">${esc(p.name[0]?.toUpperCase()||'?')}</div><div><b>${self?'Вы':esc(p.name)}</b><span data-track-status>${label}</span></div></div><div class="track-actions-v5">${self?`<button data-own-rec class="tiny-rec ${p.armed?'on':''}">${p.armed?'● REC ON':'○ REC OFF'}</button><button id="solo-own">▶ Моя</button>`:`<span>${esc(p.role||'')}</span>`}</div></div><div class="viewport-v5 track-v5" data-track="${esc(p.id)}" style="--pc:${esc(p.color)}">${rangeOverlay()}<div class="grid-lines-v5"></div>${lanes.map(({clip,lane})=>renderClip(clip,p,self,lane)).join('')}${recordingFor(p.id)?renderLive(p,self):''}<div class="playhead-v5" data-playhead></div></div>`;
}
function assignLanes(clips){const ends=[];return clips.map(clip=>{let lane=ends.findIndex(end=>clip.start>=end-.01);if(lane<0)lane=Math.min(2,ends.length);ends[lane]=clip.start+clip.duration;return{clip,lane};});}
function renderClip(c,p,self,lane){const peaks=c.peaks?.length?c.peaks:Array.from({length:30},(_,i)=>.12+((i*13)%9)/20);return `<div class="clip-v5 ${self?'own':'foreign'}" data-clip="${esc(c.id)}" data-owner="${esc(c.participantId)}" data-start="${c.start}" style="left:${timePct(c.start)}%;width:${Math.max(.5,c.duration/S.visibleSeconds*100)}%;top:${6+lane*24}px;--pc:${esc(p.color)}" ${self?'data-editable="1"':''}><div class="clip-label"><span>${self?'Моя запись':esc(p.name)}</span><b>${fmt(c.start,true)}</b></div><div class="wave-v5">${peaks.map(v=>`<i style="height:${Math.max(10,Math.min(100,v*100))}%"></i>`).join('')}</div><div class="clip-vol-v5"><input data-clip-volume="${esc(c.id)}" type="range" min="0" max="1" step=".01" value="${c.volume}" ${self?'':'disabled'}><em>${Math.round(c.volume*100)}%</em></div></div>`;}
function renderLive(p,self){const r=recordingFor(p.id);if(!r)return'';const elapsed=Math.max(0,(Date.now()-r.startAt)/1000),dur=Math.min(r.endTime-r.startTime,elapsed);return `<div class="clip-v5 live ${self?'own':'foreign'}" data-live="${esc(p.id)}" style="left:${timePct(r.startTime)}%;width:${Math.max(.5,dur/S.visibleSeconds*100)}%;top:6px;--pc:${esc(p.color)}"><div class="clip-label"><span>● REC · ${self?'Вы':esc(p.name)}</span></div><div class="wave-v5 live-wave"></div></div>`;}
function rangeOverlay(){return `<div class="range-overlay-v5" style="left:${timePct(S.room.range.start)}%;width:${Math.max(0,(S.room.range.end-S.room.range.start)/S.visibleSeconds*100)}%"></div>`;}
function rangeHandles(){return `<button class="range-handle-v5 in" data-range="start" style="left:${timePct(S.room.range.start)}%">IN</button><button class="range-handle-v5 out" data-range="end" style="left:${timePct(S.room.range.end)}%">OUT</button>`;}
function tickStep(){const s=S.visibleSeconds;if(s<=8)return .5;if(s<=20)return 1;if(s<=60)return 5;if(s<=180)return 15;if(s<=600)return 60;if(s<=1800)return 300;return 600;}
function ticksHtml(){const step=tickStep(),first=Math.floor(S.viewStart/step)*step;let out='';for(let t=first;t<=S.viewStart+S.visibleSeconds+step;t+=step){const p=(t-S.viewStart)/S.visibleSeconds*100;if(p<-2||p>102)continue;out+=`<div class="tick-v5" style="left:${p}%"><i></i><span>${fmt(t,step<1)}</span></div>`;}return out;}
function zoomLabel(){return S.visibleSeconds<60?`${S.visibleSeconds.toFixed(0)} сек`:`${(S.visibleSeconds/60).toFixed(1)} мин`;}
function timePct(time){return(Number(time)-S.viewStart)/S.visibleSeconds*100;}
function pctTime(p){return S.viewStart+p/100*S.visibleSeconds;}
