function renderStudio() {
  if (!room) return;
  pendingRender = false;
  const host = room.hostParticipantId === participantId;
  const selected = room.takes.find((take) => take.id === room.selectedTakeId);

  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand"><span class="brand-dot"></span>DUBROOM</div>
        <div class="room-code">Комната <strong>${escapeHtml(room.id)}</strong><button class="icon-button" id="copy-link" title="Скопировать приглашение">🔗</button></div>
        <div class="ttl">Автоудаление через 48 ч</div>
      </header>

      <section class="studio-grid">
        <div class="stage-card">
          ${room.video ? `
            <div class="video-wrap">
              <video id="movie" src="${escapeHtml(room.video.url)}" ${host ? 'controls' : ''} muted playsinline preload="metadata"></video>
              <div id="stage-overlay"></div>
            </div>
            <div class="stage-controls">
              <div class="video-meta"><strong>${escapeHtml(room.video.originalName)}</strong><span>${formatSize(room.video.size)} · оригинальный звук выключен</span></div>
              ${host ? '<div class="record-actions"><button class="record-button" id="start-take"><span class="record-dot"></span>Начать дубль</button><button class="stop-button hidden" id="stop-take">■ Стоп</button></div>' : '<span class="viewer-note">Управляет ведущий</span>'}
            </div>` : `
            <div class="empty-video">
              <div class="film-icon">🎞️</div><h2>Добавьте видео</h2><p>Оригинальный звук во время дубля будет выключен.</p>
              ${host ? '<label class="primary upload-button">Выбрать видео<input id="video-file" type="file" accept="video/*"></label>' : '<p class="muted">Ждём, пока ведущий загрузит видео.</p>'}
            </div>`}
        </div>

        <aside class="participants-card">
          <div class="section-heading"><div><span class="eyebrow">В эфире без эфира</span><h2>Микрофоны</h2></div><span class="capacity">${room.participants.filter((p) => p.connected).length}/3</span></div>
          <div class="participant-list">
            ${room.participants.map((p, index) => participantCard(p, index)).join('')}
          </div>
          <div class="privacy-banner">🔇 Во время записи голоса друг друга не слышно</div>
        </aside>
      </section>

      <section class="takes-card">
        <div class="section-heading takes-heading"><div><span class="eyebrow">История комнаты</span><h2>Дубли</h2></div>${selected ? `<span class="selected-summary">Выбран: ${formatTime(selected.startTime)}–${formatTime(selected.endTime)}</span>` : ''}</div>
        <div id="processing-slot"></div>
        ${room.takes.length ? `<div class="take-list">${[...room.takes].reverse().map((take, i) => takeRow(take, room.takes.length - i, host)).join('')}</div>` : '<div class="empty-takes">Первый дубль появится здесь сразу после остановки записи.</div>'}
      </section>
    </main>`;

  document.querySelector('#copy-link')?.addEventListener('click', copyInvite);
  document.querySelector('#video-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) uploadVideo(file);
  });
  document.querySelector('#start-take')?.addEventListener('click', () => startTake());
  document.querySelector('#stop-take')?.addEventListener('click', stopTake);

  const movie = document.querySelector('#movie');
  if (movie) {
    movie.addEventListener('play', () => syncPlayer(true));
    movie.addEventListener('pause', () => syncPlayer(false));
    movie.addEventListener('seeked', () => syncPlayer(!movie.paused));
    movie.addEventListener('error', () => {
      const code = movie.error?.code;
      const messages = {
        1: 'Загрузка видео была прервана.',
        2: 'Не удалось получить видео с сервера. Обновите страницу после завершения деплоя.',
        3: 'Браузер не смог декодировать видео. Скорее всего, внутри MP4 используется неподдерживаемый кодек.',
        4: 'Формат или кодек видео не поддерживается браузером. Лучше использовать MP4 с H.264 (AVC) и AAC.',
      };
      showToast(messages[code] || 'Не удалось открыть видео в браузере.', true);
    });
    if (!host) movie.controls = false;
  }

  document.querySelectorAll('[data-action="preview"]').forEach((button) => button.addEventListener('click', () => previewTake(button.dataset.take)));
  document.querySelectorAll('[data-action="select"]').forEach((button) => button.addEventListener('click', () => selectTake(button.dataset.take)));
  document.querySelectorAll('[data-action="rerecord"]').forEach((button) => button.addEventListener('click', () => {
    const take = room.takes.find((item) => item.id === button.dataset.take);
    if (take) startTake(take.startTime, Math.max(300, (take.endTime - take.startTime) * 1000));
  }));

  for (const p of room.participants) updateLevel(p.id, lastLevel(p.id));
  renderModeUi();
}

function participantCard(participant, index) {
  const history = levelHistory.get(participant.id) || Array(28).fill(0.02);
  return `
    <article class="participant ${participant.connected ? '' : 'offline'}" data-participant-card="${escapeHtml(participant.id)}">
      <div class="participant-head">
        <div class="avatar avatar-${index + 1}">${escapeHtml(participant.name.slice(0, 1).toUpperCase())}</div>
        <div><strong>${escapeHtml(participant.name)}${participant.id === participantId ? ' · вы' : ''}</strong><span class="talk-status">${participant.connected ? 'готов' : 'не в сети'}</span></div>
        <div class="status-dot ${participant.connected ? 'online' : ''}"></div>
      </div>
      <div class="waveform" data-waveform="${escapeHtml(participant.id)}">${history.map((level) => `<i style="height:${Math.max(8, level * 100)}%"></i>`).join('')}</div>
    </article>`;
}

function takeRow(take, number, host) {
  const selected = room.selectedTakeId === take.id;
  return `
    <article class="take-row ${selected ? 'selected' : ''}">
      <div class="take-number">#${number}</div>
      <div class="take-time"><strong>${formatTime(take.startTime)} → ${formatTime(take.endTime)}</strong><span>${take.tracks.length} дорожки · ${(take.endTime - take.startTime).toFixed(1)} сек</span></div>
      <div class="track-dots">${take.tracks.map((track) => {
        const p = room.participants.find((item) => item.id === track.participantId);
        return `<span title="${escapeHtml(p?.name || '')}">${escapeHtml(p?.name?.slice(0, 1) || '•')}</span>`;
      }).join('')}</div>
      ${host ? `<div class="take-actions"><button class="secondary compact" data-action="preview" data-take="${take.id}">▶ Послушать</button><button class="secondary compact" data-action="rerecord" data-take="${take.id}">↻ Перезаписать</button><button class="${selected ? 'selected-button' : 'secondary compact'}" data-action="select" data-take="${take.id}">${selected ? '✓ Оставлен' : 'Оставить'}</button></div>` : ''}
    </article>`;
}

function lastLevel(id) {
  const history = levelHistory.get(id);
  return history?.[history.length - 1] || 0;
}

function updateLevel(id, value) {
  const history = levelHistory.get(id) || Array(28).fill(0.02);
  history.push(Math.max(0, Math.min(1, Number(value) || 0)));
  while (history.length > 28) history.shift();
  levelHistory.set(id, history);
  const waveform = document.querySelector(`[data-waveform="${CSS.escape(id)}"]`);
  if (waveform) [...waveform.children].forEach((bar, index) => { bar.style.height = `${Math.max(8, (history[index] || 0) * 100)}%`; });
  const card = document.querySelector(`[data-participant-card="${CSS.escape(id)}"]`);
  const status = card?.querySelector('.talk-status');
  if (status) status.textContent = value > 0.12 ? '🎙 говорит' : 'готов';
}

async function uploadVideo(file) {
  const label = document.querySelector('.upload-button');
  if (label) { label.classList.add('disabled'); label.firstChild.textContent = 'Загрузка…'; }
  try {
    const response = await fetch(`/api/rooms/${room.id}/video`, {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-participant-id': participantId,
        'x-file-name': encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось загрузить видео.');
    showToast('Видео загружено. Можно начинать озвучку.');
  } catch (error) {
    showToast(error.message, true);
    renderStudio();
  }
}

async function syncPlayer(playing) {
  if (!room || room.hostParticipantId !== participantId || mode !== 'idle') return;
  const movie = document.querySelector('#movie');
  if (!movie) return;
  try {
    await jsonRequest(`/api/rooms/${room.id}/player`, {
      method: 'POST',
      body: JSON.stringify({ participantId, currentTime: movie.currentTime, playing }),
    });
  } catch { /* ignore transient player sync errors */ }
}

function applyPlayerState(state) {
  if (mode !== 'idle') return;
  const movie = document.querySelector('#movie');
  if (!movie) return;
  if (Math.abs(movie.currentTime - state.currentTime) > 0.35) movie.currentTime = state.currentTime;
  if (state.playing) movie.play().catch(() => undefined);
  else movie.pause();
}

async function startTake(startTime = null, autoStopAfterMs = null) {
  if (!room || room.hostParticipantId !== participantId) return;
  stopPreview();
  const movie = document.querySelector('#movie');
  const position = startTime ?? movie?.currentTime ?? 0;
  if (movie) { movie.pause(); movie.currentTime = position; }
  try {
    await jsonRequest(`/api/rooms/${room.id}/recording/start`, {
      method: 'POST',
      body: JSON.stringify({ participantId, startTime: position, autoStopAfterMs }),
    });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function stopTake() {
  try {
    await jsonRequest(`/api/rooms/${room.id}/recording/stop`, { method: 'POST', body: JSON.stringify({ participantId }) });
  } catch (error) {
    showToast(error.message, true);
  }
}