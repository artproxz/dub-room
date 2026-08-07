const app = document.querySelector('#app');
const participantId = localStorage.getItem('dubroom:participant-id') || crypto.randomUUID().slice(0, 8);
localStorage.setItem('dubroom:participant-id', participantId);

let room = null;
let eventSource = null;
let micStream = null;
let analyser = null;
let audioContext = null;
let meterFrame = null;
let lastLevelSentAt = 0;
let currentMicLevel = 0;
let mode = 'idle';
let recorder = null;
let recorderChunks = [];
let localSession = null;
let recordingPeaks = [];
let lastPeakAt = 0;
let startTimer = null;
let stopTimer = null;
let countdownTimer = null;
let previewTimer = null;
let localPlaybackTimer = null;
let playbackAudios = [];
let playbackTimers = [];
let selectedClipId = null;
let contextMenu = null;
let visibleSeconds = 60;
let viewStart = 0;
let middlePanning = false;
let colorSaveTimer = null;
const levelHistory = new Map();
const initialRoomCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  })[char]);
}

function clampNumber(value, min, max) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function formatTime(value, precise = false) {
  const n = Math.max(0, Number(value) || 0);
  const whole = Math.floor(n);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const base = hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return precise ? `${base}.${String(Math.floor((n % 1) * 1000)).padStart(3, '0')}` : base;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

function showToast(message, error = false) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = `toast${error ? ' toast-error' : ''}`;
  toast.textContent = message;
  toast.onclick = () => toast.remove();
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.remove(), 4500);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}

function normalizeRoomState(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    participants: Array.isArray(value.participants) ? value.participants : [],
    clips: Array.isArray(value.clips) ? value.clips : [],
    recordings: Array.isArray(value.recordings) ? value.recordings : [],
    player: value.player && typeof value.player === 'object' ? value.player : { currentTime: 0, playing: false },
    range: value.range && typeof value.range === 'object' ? value.range : { start: 0, end: 30 },
  };
}

function me() { return room?.participants?.find((p) => p.id === participantId); }
function isHost() { return room?.hostParticipantId === participantId; }
function recordingFor(id) { return room?.recordings?.find((item) => item.participantId === id); }
function videoDuration() { return Number(room?.video?.duration) || document.querySelector('#movie')?.duration || 0; }
function clipOverlapsRange(clip) { return clip.start < room.range.end && clip.start + clip.duration > room.range.start; }
function participantHasRangeAudio(id) { return room?.clips?.some((clip) => clip.participantId === id && clipOverlapsRange(clip)); }

async function ensureMicrophone() {
  if (micStream?.active) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(micStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  const tick = () => {
    if (!analyser) return;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const n = (sample - 128) / 128;
      sum += n * n;
    }
    const level = Math.min(1, Math.sqrt(sum / data.length) * 5.6);
    currentMicLevel = level;
    updateLevel(participantId, level);

    const t = performance.now();
    if (mode === 'recording' && localSession && t - lastPeakAt > 45) {
      recordingPeaks.push(level);
      lastPeakAt = t;
      updateLiveRecordingBlocks();
    }
    if (room && t - lastLevelSentAt > 100) {
      fetch(`/api/rooms/${room.id}/level`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participantId, level }),
        keepalive: true,
      }).catch(() => undefined);
      lastLevelSentAt = t;
    }
    meterFrame = requestAnimationFrame(tick);
  };
  tick();
  return micStream;
}

function pickMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function renderLobby() {
  const savedName = localStorage.getItem('dubroom:name') || '';
  app.innerHTML = `
    <main class="landing-shell">
      <section class="landing-card">
        <div class="brand brand-large"><span class="brand-dot"></span>DUBROOM</div>
        <h1>Фильм сверху.<br>Ваш хаос — на таймлайне.</h1>
        <p class="lead">Один общий фрагмент фильма. У каждого — своя независимая сессия озвучки и своя дорожка.</p>
        <form id="lobby-form" class="join-form">
          <label>Ваше имя<input id="name" maxlength="32" placeholder="Например, Дима" value="${escapeHtml(savedName)}" autocomplete="nickname" required></label>
          ${initialRoomCode ? `<label>Код комнаты<input id="room-code" maxlength="8" value="${escapeHtml(initialRoomCode)}" required></label>` : ''}
          <button class="primary huge" type="submit">${initialRoomCode ? 'Войти в студию' : 'Создать студию'}</button>
          ${!initialRoomCode ? '<button class="secondary" type="button" id="join-by-code">У меня уже есть код</button>' : ''}
        </form>
        <div class="permission-note">🎙 Во время вашей записи чужие дорожки не слышны. REC выключен — пробел просто воспроизводит общий фрагмент.</div>
      </section>
    </main>`;

  document.querySelector('#lobby-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.querySelector('#name').value.trim();
    const code = initialRoomCode ? document.querySelector('#room-code').value.trim().toUpperCase() : null;
    await enterRoom(name, code);
  });
  document.querySelector('#join-by-code')?.addEventListener('click', async () => {
    const name = document.querySelector('#name').value.trim();
    const code = prompt('Введите код комнаты')?.trim().toUpperCase();
    if (code) await enterRoom(name, code);
  });
}

async function enterRoom(name, code = null) {
  if (!name) return showToast('Введите имя участника.', true);
  try { await ensureMicrophone(); }
  catch { return showToast('Разрешите доступ к микрофону и попробуйте снова.', true); }
  localStorage.setItem('dubroom:name', name);
  try {
    const result = code
      ? await jsonRequest(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ participantId, name }) })
      : await jsonRequest('/api/rooms', { method: 'POST', body: JSON.stringify({ participantId, name }) });
    room = normalizeRoomState(result.room);
    if (!room?.id) throw new Error('Сервер вернул некорректное состояние комнаты. Обновите страницу.');
    const url = new URL(location.href);
    url.searchParams.set('room', room.id);
    history.replaceState({}, '', url);
    connectEvents();
    renderStudio();
  } catch (error) { showToast(error.message, true); }
}

function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource(`/api/rooms/${room.id}/events?participantId=${encodeURIComponent(participantId)}`);
  eventSource.addEventListener('room-state', (event) => {
    const next = normalizeRoomState(JSON.parse(event.data));
    if (next) applyRoomState(next);
  });
  eventSource.addEventListener('participant-level', (event) => {
    const data = JSON.parse(event.data);
    updateLevel(data.participantId, data.level);
  });
  eventSource.addEventListener('recording-stop', (event) => {
    const data = JSON.parse(event.data);
    if (data.participantId === participantId) scheduleLocalStop(data);
  });
  eventSource.addEventListener('mix-preview', (event) => beginMixPreview(JSON.parse(event.data)));
}

async function updateParticipant(patch, { optimistic = true } = {}) {
  const participant = me();
  if (!participant) return;
  const previous = { ...participant };
  if (optimistic) {
    Object.assign(participant, patch);
    updateParticipantStatusUi(participant.id);
    updateLocalControlUi();
  }
  try {
    await jsonRequest(`/api/rooms/${room.id}/participant`, {
      method: 'POST', body: JSON.stringify({ participantId, ...patch }),
    });
  } catch (error) {
    Object.assign(participant, previous);
    updateParticipantStatusUi(participant.id);
    updateLocalControlUi();
    showToast(error.message, true);
  }
}

function saveColorSoon(color) {
  const participant = me();
  if (!participant) return;
  participant.color = color;
  applyParticipantColor(participant.id, color);
  updateParticipantStatusUi(participant.id);
  clearTimeout(colorSaveTimer);
  colorSaveTimer = setTimeout(() => updateParticipant({ color, ready: false }, { optimistic: false }), 180);
}

async function copyInvite() {
  const url = new URL(location.href);
  url.searchParams.set('room', room.id);
  try { await navigator.clipboard.writeText(url.toString()); showToast('Ссылка-приглашение скопирована.'); }
  catch { prompt('Скопируйте ссылку:', url.toString()); }
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"]'));
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target) || !room?.video) return;
  event.preventDefault();
  handleSpaceAction();
});

window.addEventListener('beforeunload', () => {
  eventSource?.close();
  stopProjectAudio();
  clearTimeout(localPlaybackTimer);
  micStream?.getTracks().forEach((track) => track.stop());
  if (meterFrame) cancelAnimationFrame(meterFrame);
});
