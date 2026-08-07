async function beginLocalRecording(payload) {
  try {
    stopPreview();
    await ensureMicrophone();
    mode = 'countdown';
    activeTake = payload;
    recorderChunks = [];
    const mimeType = pickMimeType();
    recorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => { if (event.data.size) recorderChunks.push(event.data); };
    recorder.onstop = async () => {
      const take = activeTake;
      const blob = new Blob(recorderChunks, { type: recorder.mimeType || 'audio/webm' });
      recorderChunks = [];
      mode = 'idle';
      renderModeUi();
      if (pendingRender) renderStudio();
      try {
        const response = await fetch(`/api/rooms/${room.id}/takes/${take.takeId}/tracks/${participantId}`, {
          method: 'POST',
          headers: { 'content-type': blob.type || 'audio/webm' },
          body: blob,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить дорожку.');
      } catch (error) {
        showToast(error.message, true);
      }
    };

    updateCountdown(payload.startAt);
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      const movie = document.querySelector('#movie');
      if (movie) {
        movie.currentTime = payload.startTime;
        movie.muted = true;
        movie.play().catch(() => undefined);
      }
      recorder.start(500);
      mode = 'recording';
      renderModeUi();
    }, Math.max(0, payload.startAt - Date.now()));
  } catch (error) {
    mode = 'idle';
    showToast(error.message || 'Не удалось запустить запись.', true);
  }
}

function updateCountdown(startAt) {
  clearTimeout(countdownTimer);
  const left = Math.ceil((startAt - Date.now()) / 1000);
  const overlay = document.querySelector('#stage-overlay');
  if (left <= 0) { if (overlay) overlay.innerHTML = ''; return; }
  if (overlay) overlay.innerHTML = `<div class="countdown-overlay"><div class="countdown-label">Приготовились</div><div class="countdown-number">${Math.min(3, left)}</div></div>`;
  countdownTimer = setTimeout(() => updateCountdown(startAt), 120);
}

function scheduleLocalStop(payload) {
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    const movie = document.querySelector('#movie');
    movie?.pause();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, Math.max(0, payload.stopAt - Date.now()));
}

function renderModeUi() {
  const overlay = document.querySelector('#stage-overlay');
  const startButton = document.querySelector('#start-take');
  const stopButton = document.querySelector('#stop-take');
  const movie = document.querySelector('#movie');
  if (movie) movie.controls = room?.hostParticipantId === participantId && mode === 'idle';

  if (mode === 'recording') {
    if (overlay) overlay.innerHTML = '<div class="recording-pill"><span></span>ИДЁТ ОЗВУЧКА</div>';
    startButton?.classList.add('hidden');
    stopButton?.classList.remove('hidden');
  } else if (mode === 'preview') {
    if (overlay) overlay.innerHTML = '<div class="preview-pill">🎬 ПРОСМОТР ДУБЛЯ</div>';
    startButton?.classList.add('hidden');
    stopButton?.classList.add('hidden');
  } else if (mode === 'idle') {
    if (overlay) overlay.innerHTML = '';
    startButton?.classList.remove('hidden');
    stopButton?.classList.add('hidden');
  }
}

function updateUploadProgress(progress) {
  const slot = document.querySelector('#processing-slot');
  if (!slot) return;
  slot.innerHTML = progress ? `<div class="processing"><div class="spinner"></div>Собираем дорожки: ${progress.uploaded}/${progress.expected}</div>` : '';
}

function stopPreview() {
  clearTimeout(previewTimer);
  for (const audio of previewAudios) { audio.pause(); audio.currentTime = 0; }
  previewAudios = [];
  previewTakeId = null;
  if (mode === 'preview') {
    mode = 'idle';
    renderModeUi();
  }
}

function beginPreview(take) {
  stopPreview();
  const movie = document.querySelector('#movie');
  if (!movie) return;
  mode = 'preview';
  previewTakeId = take.id;
  renderModeUi();
  movie.pause();
  movie.muted = true;
  movie.currentTime = take.startTime;
  previewAudios = take.tracks.map((track) => {
    const audio = new Audio(track.url);
    audio.preload = 'auto';
    return audio;
  });
  const previewAt = take.previewAt || Date.now() + 850;
  setTimeout(async () => {
    movie.currentTime = take.startTime;
    previewAudios.forEach((audio) => { audio.currentTime = 0; });
    try {
      await Promise.all([movie.play(), ...previewAudios.map((audio) => audio.play())]);
    } catch {
      stopPreview();
      showToast('Браузер заблокировал автопрослушку. Ведущий может нажать «Послушать» ещё раз.', true);
    }
  }, Math.max(0, previewAt - Date.now()));
  previewTimer = setTimeout(() => {
    movie.pause();
    stopPreview();
  }, Math.max(0, previewAt - Date.now()) + Math.max(0, take.endTime - take.startTime) * 1000 + 700);
}

async function previewTake(takeId) {
  try {
    await jsonRequest(`/api/rooms/${room.id}/takes/${takeId}/preview`, { method: 'POST', body: JSON.stringify({ participantId }) });
  } catch (error) { showToast(error.message, true); }
}

async function selectTake(takeId) {
  try {
    await jsonRequest(`/api/rooms/${room.id}/takes/${takeId}/select`, { method: 'POST', body: JSON.stringify({ participantId }) });
  } catch (error) { showToast(error.message, true); }
}

async function copyInvite() {
  const url = new URL(location.href);
  url.searchParams.set('room', room.id);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('Ссылка-приглашение скопирована.');
  } catch {
    prompt('Скопируйте ссылку:', url.toString());
  }
}

window.addEventListener('beforeunload', () => {
  eventSource?.close();
  micStream?.getTracks().forEach((track) => track.stop());
  if (meterFrame) cancelAnimationFrame(meterFrame);
});

renderLobby();
