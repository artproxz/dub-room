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
let recorder = null;
let recorderChunks = [];
let activeTake = null;
let mode = 'idle';
let pendingRender = false;
let startTimer = null;
let stopTimer = null;
let countdownTimer = null;
let previewTimer = null;
let previewAudios = [];
let previewTakeId = null;
const levelHistory = new Map();

const initialRoomCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  })[char]);
}

function formatTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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
  toast._timer = setTimeout(() => toast.remove(), 5500);
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
  analyser.smoothingTimeConstant = 0.72;
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
    const level = Math.min(1, Math.sqrt(sum / data.length) * 5.5);
    updateLevel(participantId, level);
    const now = performance.now();
    if (room && now - lastLevelSentAt > 90) {
      fetch(`/api/rooms/${room.id}/level`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participantId, level }),
        keepalive: true,
      }).catch(() => undefined);
      lastLevelSentAt = now;
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
        <h1>Озвучьте сцену вслепую.<br>Потом услышите весь хаос вместе.</h1>
        <p class="lead">До трёх участников. Во время записи никто не слышит остальных — только видит, кто сейчас говорит.</p>
        <form id="lobby-form" class="join-form">
          <label>Ваше имя
            <input id="name" maxlength="32" placeholder="Например, Дима" value="${escapeHtml(savedName)}" autocomplete="nickname" required>
          </label>
          ${initialRoomCode ? `<label>Код комнаты<input id="room-code" maxlength="8" value="${escapeHtml(initialRoomCode)}" required></label>` : ''}
          <button class="primary huge" type="submit">${initialRoomCode ? 'Войти в комнату' : 'Создать комнату'}</button>
          ${!initialRoomCode ? '<button class="secondary" type="button" id="join-by-code">У меня уже есть код</button>' : ''}
        </form>
        <div class="permission-note">🎙 При входе браузер попросит доступ к микрофону. Ваш живой голос другим участникам не передаётся.</div>
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
  try {
    await ensureMicrophone();
  } catch {
    return showToast('Без разрешения на микрофон озвучка не заработает. Разрешите доступ и попробуйте снова.', true);
  }
  localStorage.setItem('dubroom:name', name);
  try {
    const result = code
      ? await jsonRequest(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ participantId, name }) })
      : await jsonRequest('/api/rooms', { method: 'POST', body: JSON.stringify({ participantId, name }) });
    room = result.room;
    const url = new URL(location.href);
    url.searchParams.set('room', room.id);
    history.replaceState({}, '', url);
    connectEvents();
    renderStudio();
  } catch (error) {
    showToast(error.message, true);
  }
}

function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource(`/api/rooms/${room.id}/events?participantId=${encodeURIComponent(participantId)}`);

  eventSource.addEventListener('room-state', (event) => {
    room = JSON.parse(event.data);
    if (mode === 'idle') renderStudio();
    else pendingRender = true;
  });
  eventSource.addEventListener('participant-level', (event) => {
    const data = JSON.parse(event.data);
    updateLevel(data.participantId, data.level);
  });
  eventSource.addEventListener('player-state', (event) => applyPlayerState(JSON.parse(event.data)));
  eventSource.addEventListener('recording-countdown', (event) => beginLocalRecording(JSON.parse(event.data)));
  eventSource.addEventListener('recording-stop', (event) => scheduleLocalStop(JSON.parse(event.data)));
  eventSource.addEventListener('take-upload-progress', (event) => updateUploadProgress(JSON.parse(event.data)));
  eventSource.addEventListener('take-ready', (event) => {
    const take = JSON.parse(event.data);
    updateUploadProgress(null);
    showToast('Дубль готов — слушаем, что вы натворили 😄');
    beginPreview({ ...take, previewAt: Date.now() + 850 });
  });
  eventSource.addEventListener('preview-take', (event) => beginPreview(JSON.parse(event.data)));
}

