async function handleSpaceAction() {
  if (!room?.video) return;
  if (mode === 'mix') return;
  if ((mode === 'countdown' || mode === 'recording') && localSession) {
    await stopOwnRecording();
    return;
  }
  if (mode !== 'idle') return;
  if (me()?.armed) await startOwnRecording();
  else toggleLocalRangePlayback();
}

function toggleLocalRangePlayback() {
  if (mode !== 'idle') return;
  const movie = document.querySelector('#movie'); if (!movie) return;
  if (!movie.paused) {
    movie.pause();
    stopProjectAudio();
    clearTimeout(localPlaybackTimer);
    updateLocalControlUi();
    return;
  }
  let start = movie.currentTime;
  if (start < room.range.start - 0.05 || start >= room.range.end - 0.05) start = room.range.start;
  movie.currentTime = start;
  movie.muted = true;
  movie.play().then(() => {
    startProjectAudio(start, room.range.end);
    const remaining = Math.max(0.05, room.range.end - start);
    clearTimeout(localPlaybackTimer);
    localPlaybackTimer = setTimeout(() => {
      movie.pause();
      stopProjectAudio();
      movie.currentTime = room.range.end;
      updatePlayheadUi(room.range.end);
      updateLocalControlUi();
    }, remaining * 1000 + 50);
    updateLocalControlUi();
  }).catch(() => showToast('Браузер не дал запустить воспроизведение.', true));
}

async function seekProject(time) {
  if (mode === 'recording' || mode === 'countdown') return;
  const movie = document.querySelector('#movie'); if (!movie) return;
  movie.pause(); stopProjectAudio(); clearTimeout(localPlaybackTimer);
  movie.currentTime = time;
  updatePlayheadUi(time);
  updateLocalControlUi();
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

function beginMixPreview(payload) {
  clearTimeout(previewTimer);
  clearTimeout(localPlaybackTimer);
  stopProjectAudio();
  const movie = document.querySelector('#movie'); if (!movie) return;
  movie.pause(); movie.muted = true; movie.currentTime = payload.startTime;
  mode = 'mix'; renderModeUi(); updatePlayheadUi(payload.startTime); updateLocalControlUi();
  const wait = Math.max(0, payload.previewAt - Date.now());
  previewTimer = setTimeout(async () => {
    movie.currentTime = payload.startTime;
    try {
      await movie.play();
      startProjectAudio(payload.startTime, payload.endTime);
      updateLocalControlUi();
    } catch {
      mode = 'idle'; renderModeUi(); updateLocalControlUi();
      showToast('Браузер заблокировал общий просмотр. Нажмите REC ВЫКЛ и пробел.', true);
      return;
    }
    const durationMs = Math.max(50, (payload.endTime - payload.startTime) * 1000);
    previewTimer = setTimeout(() => {
      movie.pause(); stopProjectAudio(); movie.currentTime = payload.endTime;
      mode = 'idle'; renderModeUi(); updateLocalControlUi(); updatePlayheadUi(payload.endTime);
    }, durationMs + 80);
  }, wait);
}

async function startOwnRecording() {
  if (mode !== 'idle' || !me()?.armed || localSession) return;
  clearTimeout(localPlaybackTimer);
  stopProjectAudio();
  const movie = document.querySelector('#movie');
  if (movie) { movie.pause(); movie.currentTime = room.range.start; updatePlayheadUi(room.range.start); }
  try {
    const payload = await jsonRequest(`/api/rooms/${room.id}/recording/start`, {
      method: 'POST', body: JSON.stringify({ participantId }),
    });
    await beginLocalRecording(payload);
  } catch (error) { showToast(error.message, true); }
}

async function stopOwnRecording() {
  if (!localSession) return;
  try {
    const payload = await jsonRequest(`/api/rooms/${room.id}/recording/stop`, {
      method: 'POST', body: JSON.stringify({ participantId }),
    });
    scheduleLocalStop(payload);
  } catch (error) {
    if (!String(error.message).includes('нет активной')) showToast(error.message, true);
  }
}

async function beginLocalRecording(payload) {
  try {
    stopProjectAudio();
    await ensureMicrophone();
    mode = 'countdown';
    localSession = { ...payload };
    recorderChunks = [];
    recordingPeaks = [];
    lastPeakAt = 0;

    const mimeType = pickMimeType();
    recorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => { if (event.data.size) recorderChunks.push(event.data); };
    recorder.onstop = uploadRecordedClip;

    updateCountdown(payload.startAt);
    renderModeUi(); updateLocalControlUi();
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      if (!localSession || localSession.sessionId !== payload.sessionId) return;
      const movie = document.querySelector('#movie');
      if (movie) {
        movie.currentTime = payload.startTime;
        movie.muted = true;
        movie.play().catch(() => undefined);
      }
      if (recorder?.state === 'inactive') recorder.start(200);
      mode = 'recording';
      renderModeUi(); updateLocalControlUi(); updateLiveRecordingBlocks();
    }, Math.max(0, payload.startAt - Date.now()));
  } catch (error) {
    mode = 'idle'; recorder = null; localSession = null;
    renderModeUi(); updateLocalControlUi();
    showToast(error.message || 'Не удалось запустить запись.', true);
  }
}

function updateCountdown(startAt) {
  clearTimeout(countdownTimer);
  const ms = Math.max(0, startAt - Date.now());
  const left = Math.max(1, Math.ceil(ms / 420));
  const overlay = document.querySelector('#stage-overlay');
  if (ms <= 0) { if (overlay) overlay.innerHTML = ''; return; }
  if (overlay) overlay.innerHTML = `<div class="countdown-overlay"><div class="countdown-label">ВАША ЗАПИСЬ</div><div class="countdown-number">${Math.min(3, left)}</div><div class="countdown-sub">чужие дорожки замьючены · пробел — отмена</div></div>`;
  countdownTimer = setTimeout(() => updateCountdown(startAt), 70);
}

function scheduleLocalStop(payload) {
  if (!localSession || localSession.sessionId !== payload.sessionId) return;
  localSession.actualEndTime = payload.endTime;
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    clearTimeout(startTimer);
    const movie = document.querySelector('#movie'); movie?.pause();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else finishRecordingUi(payload.endTime, false);
  }, Math.max(0, payload.stopAt - Date.now()));
}

async function uploadRecordedClip() {
  const session = localSession;
  if (!session) return;
  const blob = new Blob(recorderChunks, { type: recorder?.mimeType || 'audio/webm' });
  recorderChunks = [];
  const endTime = session.actualEndTime ?? session.endTime ?? session.startTime;
  const duration = Math.max(0, endTime - session.startTime);
  if (duration < 0.08 || blob.size < 40) {
    finishRecordingUi(endTime, false);
    return;
  }
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
    finishRecordingUi(endTime, true);
  } catch (error) {
    finishRecordingUi(endTime, false);
    showToast(error.message, true);
  }
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

function finishRecordingUi(endTime, saved) {
  recorder = null; localSession = null; recordingPeaks = [];
  mode = 'idle';
  const movie = document.querySelector('#movie');
  if (movie) { movie.pause(); movie.currentTime = endTime; }
  renderModeUi(); updatePlayheadUi(endTime); updateLocalControlUi();
  if (saved) showToast('Запись добавлена на вашу дорожку. Отредактируйте её или нажмите «Я готов».');
}

function renderModeUi() {
  const overlay = document.querySelector('#stage-overlay');
  const selfRec = document.querySelector('#self-rec-arm');
  const selfReady = document.querySelector('#self-ready');
  document.querySelectorAll('[data-arm],[data-ready],[data-color]').forEach((control) => { control.disabled = mode === 'recording' || mode === 'countdown' || mode === 'mix'; });
  if (selfRec) selfRec.disabled = mode === 'recording' || mode === 'countdown' || mode === 'mix';
  if (selfReady) selfReady.disabled = mode === 'recording' || mode === 'countdown' || mode === 'mix';

  if (mode === 'recording') {
    if (overlay) overlay.innerHTML = '<div class="recording-pill"><span></span>ВЫ ЗАПИСЫВАЕТЕСЬ · SPACE = STOP</div>';
  } else if (mode === 'mix') {
    if (overlay) overlay.innerHTML = '<div class="preview-pill">🎬 ВСЕ ГОТОВЫ · СЛУШАЕМ ИТОГ</div>';
  } else if (mode === 'idle') {
    if (overlay) overlay.innerHTML = '';
  }
  updateLocalControlUi();
}

renderLobby();
