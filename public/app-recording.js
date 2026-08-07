async function toggleTransport() {
  if (!isHost() || mode !== 'idle') return;
  const movie = document.querySelector('#movie'); if (!movie) return;
  if (movie.paused) {
    try {
      await movie.play();
      startProjectAudio(movie.currentTime);
      await syncPlayer(true);
    } catch { showToast('Браузер не дал запустить воспроизведение.', true); }
  } else {
    movie.pause(); stopProjectAudio(); await syncPlayer(false);
  }
  renderTransportButton();
}

async function stopTransport() {
  if (!isHost() || mode !== 'idle') return;
  const movie = document.querySelector('#movie'); if (!movie) return;
  movie.pause(); stopProjectAudio();
  await syncPlayer(false);
  renderTransportButton();
}

async function seekProject(time) {
  if (!isHost() || mode !== 'idle') return;
  const movie = document.querySelector('#movie'); if (!movie) return;
  movie.pause(); stopProjectAudio(); movie.currentTime = time;
  updatePlayheadUi(time);
  await syncPlayer(false);
}

async function syncPlayer(playing) {
  const movie = document.querySelector('#movie');
  if (!room || !isHost() || !movie || mode !== 'idle') return;
  try {
    await jsonRequest(`/api/rooms/${room.id}/player`, {
      method: 'POST', body: JSON.stringify({ participantId, currentTime: movie.currentTime, playing }),
    });
  } catch { /* transient sync error */ }
}

function applyPlayerState(state) {
  if (mode !== 'idle') return;
  const movie = document.querySelector('#movie'); if (!movie) return;
  stopProjectAudio();
  if (Math.abs(movie.currentTime - state.currentTime) > 0.25) movie.currentTime = state.currentTime;
  if (state.playing) {
    movie.play().then(() => startProjectAudio(state.currentTime)).catch(() => undefined);
  } else movie.pause();
  renderTransportButton();
}

function renderTransportButton() {
  const button = document.querySelector('#transport-play');
  const movie = document.querySelector('#movie');
  if (button && movie) button.textContent = movie.paused ? '▶' : '❚❚';
}

function startProjectAudio(fromTime, untilTime = null) {
  stopProjectAudio();
  if (!room || mode === 'recording' || mode === 'countdown') return;
  const start = Number(fromTime) || 0;
  const end = untilTime == null ? Infinity : Number(untilTime);

  for (const clip of room.clips) {
    const clipEnd = clip.start + clip.duration;
    if (clipEnd <= start || clip.start >= end) continue;
    const audio = new Audio(clip.url);
    audio.preload = 'auto';
    audio.volume = clampNumber(clip.volume, 0, 1);
    playbackAudios.push(audio);

    const delay = Math.max(0, (clip.start - start) * 1000);
    const offset = Math.max(0, start - clip.start);
    const play = () => {
      audio.currentTime = Math.min(offset, Math.max(0, clip.duration - 0.01));
      audio.play().catch(() => undefined);
      if (untilTime != null) {
        const remaining = Math.max(0, Math.min(clipEnd, end) - Math.max(start, clip.start));
        playbackTimers.push(setTimeout(() => audio.pause(), remaining * 1000 + 80));
      }
    };
    if (delay < 20) play(); else playbackTimers.push(setTimeout(play, delay));
  }
}

function stopProjectAudio() {
  for (const timer of playbackTimers) clearTimeout(timer);
  playbackTimers = [];
  for (const audio of playbackAudios) { try { audio.pause(); audio.currentTime = 0; } catch {} }
  playbackAudios = [];
}

async function previewRange() {
  if (!isHost() || mode !== 'idle') return;
  try {
    await jsonRequest(`/api/rooms/${room.id}/preview`, { method: 'POST', body: JSON.stringify({ participantId }) });
  } catch (error) { showToast(error.message, true); }
}

function beginMixPreview(payload) {
  clearTimeout(previewTimer);
  stopProjectAudio();
  const movie = document.querySelector('#movie'); if (!movie) return;
  movie.pause(); movie.muted = true; movie.currentTime = payload.startTime;
  mode = 'mix'; renderModeUi(); updatePlayheadUi(payload.startTime);
  const wait = Math.max(0, payload.previewAt - Date.now());
  previewTimer = setTimeout(async () => {
    movie.currentTime = payload.startTime;
    try {
      await movie.play();
      startProjectAudio(payload.startTime, payload.endTime);
      renderTransportButton();
    } catch {
      mode = 'idle'; renderModeUi(); showToast('Браузер заблокировал автопрослушивание. Нажмите «Прослушать участок».', true); return;
    }
    const durationMs = Math.max(50, (payload.endTime - payload.startTime) * 1000);
    previewTimer = setTimeout(() => {
      movie.pause(); stopProjectAudio(); movie.currentTime = payload.endTime;
      mode = 'idle'; renderModeUi(); renderTransportButton(); updatePlayheadUi(payload.endTime);
      if (pendingRender) renderStudio();
    }, durationMs + 80);
  }, wait);
}

async function startRecordingRange() {
  if (!isHost() || mode !== 'idle') return;
  stopProjectAudio();
  const movie = document.querySelector('#movie');
  if (movie) { movie.pause(); movie.currentTime = room.range.start; }
  try {
    await jsonRequest(`/api/rooms/${room.id}/recording/start`, { method: 'POST', body: JSON.stringify({ participantId }) });
  } catch (error) { showToast(error.message, true); }
}

async function stopRecordingRange() {
  if (!isHost() || mode !== 'recording') return;
  try {
    await jsonRequest(`/api/rooms/${room.id}/recording/stop`, { method: 'POST', body: JSON.stringify({ participantId }) });
  } catch (error) { showToast(error.message, true); }
}

async function beginLocalRecording(payload) {
  try {
    stopProjectAudio();
    await ensureMicrophone();
    mode = 'countdown';
    recordingSession = { ...payload };
    recorderChunks = [];
    recordingPeaks = [];
    lastPeakAt = 0;
    const armedHere = payload.armedParticipantIds.includes(participantId);

    if (armedHere) {
      const mimeType = pickMimeType();
      recorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => { if (event.data.size) recorderChunks.push(event.data); };
      recorder.onstop = uploadRecordedClip;
    } else recorder = null;

    updateCountdown(payload.startAt);
    renderModeUi();
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      const movie = document.querySelector('#movie');
      if (movie) {
        movie.currentTime = payload.startTime;
        movie.muted = true;
        movie.play().catch(() => undefined);
      }
      if (recorder && recorder.state === 'inactive') recorder.start(250);
      mode = 'recording';
      renderModeUi();
      updateLiveRecordingBlocks();
    }, Math.max(0, payload.startAt - Date.now()));
  } catch (error) {
    mode = 'idle'; recorder = null; recordingSession = null;
    showToast(error.message || 'Не удалось запустить запись.', true);
  }
}

function updateCountdown(startAt) {
  clearTimeout(countdownTimer);
  const left = Math.ceil((startAt - Date.now()) / 1000);
  const overlay = document.querySelector('#stage-overlay');
  if (left <= 0) { if (overlay) overlay.innerHTML = ''; return; }
  if (overlay) overlay.innerHTML = `<div class="countdown-overlay"><div class="countdown-label">REC начинается</div><div class="countdown-number">${Math.min(3, left)}</div><div class="countdown-sub">Все существующие голосовые клипы замьючены</div></div>`;
  countdownTimer = setTimeout(() => updateCountdown(startAt), 100);
}

function scheduleLocalStop(payload) {
  if (!recordingSession || recordingSession.sessionId !== payload.sessionId) return;
  recordingSession.actualEndTime = payload.endTime;
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    const movie = document.querySelector('#movie'); movie?.pause();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else finishRecordingUi(payload.endTime);
  }, Math.max(0, payload.stopAt - Date.now()));
}

async function uploadRecordedClip() {
  const session = recordingSession;
  const blob = new Blob(recorderChunks, { type: recorder?.mimeType || 'audio/webm' });
  recorderChunks = [];
  const endTime = session?.actualEndTime ?? session?.endTime ?? session?.startTime ?? 0;
  const duration = Math.max(0.05, endTime - session.startTime);
  const waveform = resamplePeaks(recordingPeaks, 120).map((value) => Math.round(value * 100)).join(',');

  try {
    const response = await fetch(`/api/rooms/${room.id}/sessions/${session.sessionId}/clips/${participantId}`, {
      method: 'POST',
      headers: {
        'content-type': blob.type || 'audio/webm',
        'x-participant-id': participantId,
        'x-clip-start': String(session.startTime),
        'x-clip-duration': String(duration),
        'x-waveform': waveform,
      },
      body: blob,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось загрузить аудиоклип.');
  } catch (error) { showToast(error.message, true); }
  finishRecordingUi(endTime);
}

function resamplePeaks(values, target) {
  if (!values.length) return Array(target).fill(0.03);
  if (values.length <= target) return values;
  const result = [];
  const step = values.length / target;
  for (let i = 0; i < target; i += 1) {
    const from = Math.floor(i * step); const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let max = 0; for (let j = from; j < to && j < values.length; j += 1) max = Math.max(max, values[j]);
    result.push(max);
  }
  return result;
}

function finishRecordingUi(endTime) {
  recorder = null; recordingSession = null; recordingPeaks = [];
  mode = 'idle';
  const movie = document.querySelector('#movie');
  if (movie) { movie.pause(); movie.currentTime = endTime; }
  renderModeUi(); updatePlayheadUi(endTime);
  if (pendingRender) setTimeout(renderStudio, 80);
}

function renderModeUi() {
  const overlay = document.querySelector('#stage-overlay');
  const recButton = document.querySelector('#master-rec');
  const stopButton = document.querySelector('#master-stop');
  document.querySelectorAll('[data-arm],[data-ready],[data-color]').forEach((control) => { control.disabled = mode !== 'idle'; });

  if (mode === 'countdown') {
    recButton?.classList.add('hidden'); stopButton?.classList.remove('hidden');
  } else if (mode === 'recording') {
    if (overlay) overlay.innerHTML = '<div class="recording-pill"><span></span>REC · ГОЛОСА ЗАМЬЮЧЕНЫ</div>';
    recButton?.classList.add('hidden'); stopButton?.classList.remove('hidden');
  } else if (mode === 'mix') {
    if (overlay) overlay.innerHTML = '<div class="preview-pill">🎬 ВСЕ ГОТОВЫ · СЛУШАЕМ МИКС</div>';
    recButton?.classList.add('hidden'); stopButton?.classList.add('hidden');
  } else {
    if (overlay) overlay.innerHTML = '';
    recButton?.classList.remove('hidden'); stopButton?.classList.add('hidden');
  }
}

renderLobby();
