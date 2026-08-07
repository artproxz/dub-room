function renderStudio() {
  if (!room) return;
  pendingRender = false;
  const host = isHost();
  const duration = Math.max(videoDuration(), room.range?.end || 30, 30);
  if (!Number.isFinite(visibleSeconds) || visibleSeconds <= 0) visibleSeconds = Math.min(60, duration);
  visibleSeconds = Math.min(Math.max(5, visibleSeconds), Math.max(5, duration));
  viewStart = clampNumber(viewStart, 0, Math.max(0, duration - visibleSeconds));

  app.innerHTML = `
    <main class="app-shell daw-shell">
      <header class="topbar daw-topbar">
        <div class="brand"><span class="brand-dot"></span>DUBROOM <span class="studio-tag">STUDIO</span></div>
        <div class="room-code">Комната <strong>${escapeHtml(room.id)}</strong><button class="icon-button" id="copy-link" title="Скопировать приглашение">🔗</button></div>
        <div class="top-status">${room.participants.filter(p => p.connected).length}/3 online · автоудаление 48 ч</div>
      </header>

      <section class="cinema-section">
        <div class="cinema-frame">
          ${room.video ? `
            <div class="video-wrap cinema-video-wrap">
              <video id="movie" src="${escapeHtml(room.video.url)}" muted playsinline preload="metadata"></video>
              <div id="stage-overlay"></div>
            </div>
            <div class="transport-bar">
              <button class="transport-btn" id="transport-play" ${host ? '' : 'disabled'}>▶</button>
              <button class="transport-btn" id="transport-stop" ${host ? '' : 'disabled'}>■</button>
              <div class="timecode"><strong id="playhead-time">${formatTime(room.player?.currentTime || 0, true)}</strong><span>/ ${formatTime(duration)}</span></div>
              <div class="range-readout">IN <b>${formatTime(room.range.start, true)}</b> → OUT <b>${formatTime(room.range.end, true)}</b></div>
              ${host ? `<button class="transport-btn text" id="set-in">IN ← курсор</button><button class="transport-btn text" id="set-out">OUT ← курсор</button>` : ''}
              <div class="transport-spacer"></div>
              <span class="muted-badge">🔇 звук фильма выкл.</span>
              ${host ? '<button class="preview-button" id="preview-range">▶ Прослушать участок</button>' : ''}
              ${host ? '<button class="master-rec" id="master-rec"><span></span> REC</button><button class="master-stop hidden" id="master-stop">■ STOP</button>' : '<span class="viewer-note">Транспортом управляет ведущий</span>'}
            </div>
            <div class="video-meta-line"><strong>${escapeHtml(room.video.originalName)}</strong><span>${formatSize(room.video.size)}</span></div>` : `
            <div class="empty-video cinema-empty">
              <div class="film-icon">🎞️</div><h2>Загрузите фильм</h2><p>После загрузки появится общий монтажный таймлайн.</p>
              ${host ? '<label class="primary upload-button">Выбрать видео<input id="video-file" type="file" accept="video/*"></label>' : '<p class="muted">Ждём ведущего.</p>'}
            </div>`}
        </div>
      </section>

      ${room.video ? renderTimelineEditor(duration, host) : ''}
    </main>`;

  bindStudioEvents();
  if (room.video) {
    renderModeUi();
    updatePlayheadUi(room.player?.currentTime || 0);
    for (const p of room.participants) updateLevel(p.id, lastLevel(p.id));
  }
}

function renderTimelineEditor(duration, host) {
  const ticks = buildTicks(viewStart, visibleSeconds);
  return `
    <section class="editor-card">
      <div class="editor-toolbar">
        <div><span class="eyebrow">Монтажный стол</span><h2>Аудиодорожки</h2></div>
        <div class="toolbar-center">
          <button class="secondary compact" id="zoom-out">−</button>
          <span class="zoom-label">${visibleSeconds < 60 ? `${visibleSeconds.toFixed(0)} сек` : `${(visibleSeconds/60).toFixed(1)} мин`}</span>
          <button class="secondary compact" id="zoom-in">+</button>
          <button class="secondary compact" id="fit-range">Вписать IN–OUT</button>
        </div>
        <div class="editor-hint">Ctrl + колесо — масштаб · средняя кнопка — панорама · ПКМ по клипу — меню</div>
      </div>

      <div class="timeline-grid">
        <div class="track-head ruler-head"><span>TRACKS</span></div>
        <div class="timeline-viewport ruler-viewport" id="timeline-ruler" data-duration="${duration}">
          ${renderRangeOverlay()}
          <div class="ruler-ticks">${ticks}</div>
          ${host ? renderRangeHandles() : ''}
          <div class="playhead-line ruler-playhead" data-playhead-line><i></i></div>
        </div>
        ${room.participants.map((participant, index) => renderTrack(participant, index, host)).join('')}
      </div>
    </section>`;
}

function renderTrack(participant, index, host) {
  const clips = room.clips.filter((clip) => clip.participantId === participant.id).sort((a,b) => a.start - b.start);
  const lanes = assignClipLanes(clips);
  const laneCount = Math.max(1, lanes.reduce((m, item) => Math.max(m, item.lane + 1), 1));
  const height = Math.max(82, laneCount * 54 + 18);
  const self = participant.id === participantId;
  const recClass = participant.armed ? 'armed' : '';
  const readyClass = participant.ready ? 'ready' : '';
  return `
    <div class="track-head participant-track-head" style="min-height:${height}px">
      <div class="track-person-row">
        <div class="track-avatar" style="--track-color:${escapeHtml(participant.color)}">${escapeHtml(participant.name.slice(0,1).toUpperCase())}</div>
        <div class="track-name"><strong>${escapeHtml(participant.name)}${self ? ' · вы' : ''}</strong><span>${participant.connected ? 'online' : 'offline'}</span></div>
      </div>
      <div class="track-actions">
        <button class="arm-button ${recClass}" ${self ? `data-arm="${participant.id}"` : 'disabled'}><span></span>${participant.armed ? 'REC ON' : 'REC'}</button>
        <button class="ready-button ${readyClass}" ${self ? `data-ready="${participant.id}"` : 'disabled'}>${participant.ready ? '✓ ГОТОВ' : 'ГОТОВ'}</button>
        ${self ? `<label class="color-picker" title="Цвет вашей дорожки"><input type="color" value="${escapeHtml(participant.color)}" data-color="${participant.id}"></label>` : ''}
      </div>
    </div>
    <div class="timeline-viewport track-viewport" data-track="${escapeHtml(participant.id)}" style="min-height:${height}px">
      ${renderRangeOverlay()}
      <div class="track-grid-lines"></div>
      ${lanes.map(({clip,lane}) => renderAudioClip(clip, lane, participant, self, host)).join('')}
      ${room.recording?.armedParticipantIds?.includes(participant.id) ? renderLiveClip(participant, self) : ''}
      <div class="playhead-line" data-playhead-line><i></i></div>
    </div>`;
}

function assignClipLanes(clips) {
  const ends = [];
  return clips.map((clip) => {
    let lane = ends.findIndex((end) => clip.start >= end - 0.01);
    if (lane < 0) lane = ends.length;
    ends[lane] = clip.start + clip.duration;
    return { clip, lane };
  });
}

function renderAudioClip(clip, lane, participant, self, host) {
  const left = timeToPercent(clip.start);
  const width = Math.max(0.45, clip.duration / visibleSeconds * 100);
  const canEdit = self || host;
  const peaks = clip.peaks?.length ? clip.peaks : Array.from({length:36}, (_,i) => 0.12 + ((i*17)%11)/30);
  const bars = peaks.map((peak) => `<i style="height:${Math.max(8, Math.min(100, peak * 100))}%"></i>`).join('');
  return `
    <div class="audio-clip ${self ? 'own-clip' : 'foreign-clip'} ${selectedClipId === clip.id ? 'selected' : ''}"
      data-clip-id="${clip.id}" data-owner="${clip.participantId}" data-start="${clip.start}" data-duration="${clip.duration}"
      style="left:${left}%;width:${width}%;top:${lane*54+8}px;--clip-color:${escapeHtml(participant.color)}" ${canEdit ? 'data-editable="1"' : ''}>
      <div class="clip-title"><span>${escapeHtml(participant.name)}</span><b>${formatTime(clip.start,true)}</b></div>
      <div class="clip-waveform">${bars}</div>
      <div class="clip-volume-wrap" title="Громкость клипа">
        <span>VOL</span><input class="clip-volume" data-volume="${clip.id}" type="range" min="0" max="1" step="0.01" value="${clip.volume}" ${canEdit ? '' : 'disabled'}><em>${Math.round(clip.volume*100)}%</em>
      </div>
    </div>`;
}

function renderLiveClip(participant, self) {
  const recording = room.recording;
  if (!recording) return '';
  const left = timeToPercent(recording.startTime);
  const elapsed = Math.max(0, (Date.now() - recording.startAt) / 1000);
  const duration = Math.min(recording.endTime - recording.startTime, elapsed);
  const width = Math.max(0.35, duration / visibleSeconds * 100);
  return `<div class="audio-clip live-clip ${self ? 'own-clip' : 'foreign-clip'}" data-live-participant="${participant.id}" style="left:${left}%;width:${width}%;top:8px;--clip-color:${escapeHtml(participant.color)}"><div class="clip-title"><span>● LIVE · ${escapeHtml(participant.name)}</span></div><div class="clip-waveform live-waveform"></div></div>`;
}

function renderRangeOverlay() {
  const left = timeToPercent(room.range.start);
  const width = Math.max(0, (room.range.end - room.range.start) / visibleSeconds * 100);
  return `<div class="work-range" style="left:${left}%;width:${width}%"></div>`;
}

function renderRangeHandles() {
  return `<button class="range-handle range-in" data-range-handle="start" style="left:${timeToPercent(room.range.start)}%"><span>IN</span></button><button class="range-handle range-out" data-range-handle="end" style="left:${timeToPercent(room.range.end)}%"><span>OUT</span></button>`;
}

function buildTicks(start, span) {
  const step = chooseTickStep(span);
  const first = Math.floor(start / step) * step;
  let html = '';
  for (let t = first; t <= start + span + step; t += step) {
    const left = (t - start) / span * 100;
    if (left < -2 || left > 102) continue;
    html += `<div class="ruler-tick" style="left:${left}%"><i></i><span>${formatTime(t, step < 1)}</span></div>`;
  }
  return html;
}

function chooseTickStep(span) {
  if (span <= 8) return 0.5;
  if (span <= 20) return 1;
  if (span <= 60) return 5;
  if (span <= 180) return 15;
  if (span <= 600) return 60;
  if (span <= 1800) return 300;
  return 600;
}

function timeToPercent(time) { return (Number(time) - viewStart) / visibleSeconds * 100; }
function percentToTime(percent) { return viewStart + percent / 100 * visibleSeconds; }

function bindStudioEvents() {
  document.querySelector('#copy-link')?.addEventListener('click', copyInvite);
  document.querySelector('#video-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0]; if (file) uploadVideo(file);
  });
  document.querySelector('#transport-play')?.addEventListener('click', toggleTransport);
  document.querySelector('#transport-stop')?.addEventListener('click', stopTransport);
  document.querySelector('#set-in')?.addEventListener('click', () => setRangeEdge('start'));
  document.querySelector('#set-out')?.addEventListener('click', () => setRangeEdge('end'));
  document.querySelector('#preview-range')?.addEventListener('click', previewRange);
  document.querySelector('#master-rec')?.addEventListener('click', startRecordingRange);
  document.querySelector('#master-stop')?.addEventListener('click', stopRecordingRange);
  document.querySelector('#zoom-in')?.addEventListener('click', () => zoomTimeline(0.72, 0.5));
  document.querySelector('#zoom-out')?.addEventListener('click', () => zoomTimeline(1.38, 0.5));
  document.querySelector('#fit-range')?.addEventListener('click', fitRange);

  document.querySelectorAll('[data-arm]').forEach((button) => button.addEventListener('click', () => updateParticipant({ armed: !me()?.armed, ready: false })));
  document.querySelectorAll('[data-ready]').forEach((button) => button.addEventListener('click', () => updateParticipant({ ready: !me()?.ready })));
  document.querySelectorAll('[data-color]').forEach((input) => input.addEventListener('input', () => updateParticipant({ color: input.value, ready: false })));

  document.querySelectorAll('.timeline-viewport').forEach(bindTimelineViewport);
  document.querySelectorAll('.audio-clip[data-clip-id]').forEach(bindClipInteractions);
  document.querySelectorAll('.clip-volume').forEach(bindVolumeSlider);
  document.querySelectorAll('[data-range-handle]').forEach(bindRangeHandle);

  const movie = document.querySelector('#movie');
  if (movie) {
    movie.addEventListener('loadedmetadata', async () => {
      if (isHost() && Number.isFinite(movie.duration) && movie.duration > 0 && Math.abs((room.video?.duration || 0) - movie.duration) > 0.2) {
        try {
          await jsonRequest(`/api/rooms/${room.id}/video-meta`, { method: 'POST', body: JSON.stringify({ participantId, duration: movie.duration }) });
        } catch {}
      }
      updatePlayheadUi(movie.currentTime);
    });
    movie.addEventListener('timeupdate', () => updatePlayheadUi(movie.currentTime));
    movie.addEventListener('error', () => showToast('Видео не декодируется браузером. Попробуйте MP4 с H.264/AAC.', true));
    movie.addEventListener('ended', () => { stopProjectAudio(); mode = 'idle'; renderModeUi(); });
  }
}

function bindTimelineViewport(viewport) {
  viewport.addEventListener('wheel', (event) => {
    if (event.ctrlKey) {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const anchor = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
      zoomTimeline(event.deltaY > 0 ? 1.18 : 0.84, anchor);
    } else if (event.shiftKey) {
      event.preventDefault();
      panTimeline(event.deltaY * visibleSeconds / 800);
    }
  }, { passive: false });

  viewport.addEventListener('pointerdown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      middlePanning = true;
      const startX = event.clientX;
      const startView = viewStart;
      const width = viewport.getBoundingClientRect().width || 1;
      let lastRender = 0;
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        viewStart = clampViewStart(startView - dx / width * visibleSeconds);
        const now = performance.now();
        if (now - lastRender > 32) { lastRender = now; renderStudio(); }
      };
      const up = () => { middlePanning = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); renderStudio(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      return;
    }
    if (event.button === 0 && event.target.closest('.audio-clip,.range-handle,input,button')) return;
    if (!isHost() || mode !== 'idle') return;
    const rect = viewport.getBoundingClientRect();
    const time = clampNumber(percentToTime((event.clientX - rect.left) / rect.width * 100), 0, videoDuration() || 86400);
    seekProject(time);
  });
}

function bindClipInteractions(clipEl) {
  clipEl.addEventListener('click', (event) => {
    if (event.target.closest('input')) return;
    selectedClipId = clipEl.dataset.clipId;
    document.querySelectorAll('.audio-clip').forEach((el) => el.classList.toggle('selected', el === clipEl));
  });
  clipEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    selectedClipId = clipEl.dataset.clipId;
    showClipContextMenu(event.clientX, event.clientY, clipEl.dataset.clipId);
  });
  if (clipEl.dataset.editable !== '1') return;
  clipEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('input')) return;
    event.preventDefault();
    const clip = room.clips.find((item) => item.id === clipEl.dataset.clipId); if (!clip) return;
    const viewport = clipEl.closest('.timeline-viewport');
    const startX = event.clientX;
    const startTime = clip.start;
    clipEl.setPointerCapture(event.pointerId);
    clipEl.classList.add('dragging');
    const move = (moveEvent) => {
      const width = viewport.getBoundingClientRect().width || 1;
      const dt = (moveEvent.clientX - startX) / width * visibleSeconds;
      const newStart = clampNumber(startTime + dt, 0, Math.max(0, (videoDuration() || 86400) - 0.05));
      clipEl.dataset.previewStart = newStart;
      clipEl.style.left = `${timeToPercent(newStart)}%`;
      clipEl.querySelector('.clip-title b').textContent = formatTime(newStart, true);
    };
    const up = async () => {
      clipEl.classList.remove('dragging');
      clipEl.removeEventListener('pointermove', move); clipEl.removeEventListener('pointerup', up);
      const newStart = Number(clipEl.dataset.previewStart ?? startTime);
      if (Math.abs(newStart - startTime) > 0.001) await updateClip(clip.id, { start: newStart });
    };
    clipEl.addEventListener('pointermove', move); clipEl.addEventListener('pointerup', up);
  });
}

function bindVolumeSlider(input) {
  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  input.addEventListener('input', () => {
    const em = input.parentElement.querySelector('em'); if (em) em.textContent = `${Math.round(Number(input.value)*100)}%`;
  });
  input.addEventListener('change', () => updateClip(input.dataset.volume, { volume: Number(input.value) }));
}

function bindRangeHandle(handle) {
  handle.addEventListener('pointerdown', (event) => {
    if (!isHost() || mode !== 'idle') return;
    event.preventDefault();
    const viewport = handle.closest('.timeline-viewport');
    handle.setPointerCapture(event.pointerId);
    let next = { ...room.range };
    const move = (moveEvent) => {
      const rect = viewport.getBoundingClientRect();
      const time = clampNumber(percentToTime((moveEvent.clientX - rect.left) / rect.width * 100), 0, videoDuration() || 86400);
      if (handle.dataset.rangeHandle === 'start') next.start = Math.min(time, next.end - 0.1);
      else next.end = Math.max(time, next.start + 0.1);
      handle.style.left = `${timeToPercent(handle.dataset.rangeHandle === 'start' ? next.start : next.end)}%`;
    };
    const up = async () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); await updateRange(next.start, next.end); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}

function updateLevel(id, value) {
  const history = levelHistory.get(id) || Array(32).fill(0.02);
  history.push(clampNumber(value, 0, 1)); while (history.length > 32) history.shift();
  levelHistory.set(id, history);
  const head = document.querySelector(`.participant-track-head [data-arm="${CSS.escape(id)}"]`)?.closest('.participant-track-head');
  if (head) head.classList.toggle('speaking', value > 0.12);
  updateLiveRecordingBlocks();
}

function lastLevel(id) { const h = levelHistory.get(id); return h?.[h.length-1] || 0; }

function updateLiveRecordingBlocks() {
  if (!room?.recording) return;
  const movie = document.querySelector('#movie');
  const current = movie?.currentTime ?? room.recording.startTime;
  const width = Math.max(0.35, (Math.max(0, current - room.recording.startTime) / visibleSeconds) * 100);
  document.querySelectorAll('[data-live-participant]').forEach((el) => {
    el.style.width = `${width}%`;
    const id = el.dataset.liveParticipant;
    const h = levelHistory.get(id) || [];
    el.querySelector('.live-waveform').innerHTML = h.slice(-28).map(v => `<i style="height:${Math.max(8,v*100)}%"></i>`).join('');
  });
}

function updatePlayheadUi(time) {
  const pct = timeToPercent(time);
  document.querySelectorAll('[data-playhead-line]').forEach((line) => { line.style.left = `${pct}%`; line.classList.toggle('offscreen', pct < 0 || pct > 100); });
  const label = document.querySelector('#playhead-time'); if (label) label.textContent = formatTime(time, true);
  if (mode === 'recording') updateLiveRecordingBlocks();
}

function zoomTimeline(factor, anchor = 0.5) {
  const duration = Math.max(5, videoDuration() || 3600);
  const anchorTime = viewStart + visibleSeconds * anchor;
  visibleSeconds = clampNumber(visibleSeconds * factor, 5, duration);
  viewStart = clampViewStart(anchorTime - visibleSeconds * anchor);
  renderStudio();
}

function panTimeline(deltaSeconds) { viewStart = clampViewStart(viewStart + deltaSeconds); renderStudio(); }
function clampViewStart(value) { return clampNumber(value, 0, Math.max(0, (videoDuration() || 3600) - visibleSeconds)); }
function fitRange() {
  const span = Math.max(1, room.range.end - room.range.start);
  visibleSeconds = Math.min(Math.max(5, span * 1.25), Math.max(5, videoDuration() || span * 1.25));
  viewStart = clampViewStart(room.range.start - (visibleSeconds - span) / 2);
  renderStudio();
}

async function updateRange(start, end) {
  try {
    await jsonRequest(`/api/rooms/${room.id}/range`, { method: 'POST', body: JSON.stringify({ participantId, start, end }) });
  } catch (error) { showToast(error.message, true); }
}

async function setRangeEdge(edge) {
  const movie = document.querySelector('#movie'); if (!movie) return;
  const time = movie.currentTime;
  const next = { ...room.range, [edge]: time };
  if (next.end - next.start < 0.1) {
    if (edge === 'start') next.end = Math.min(videoDuration() || 86400, next.start + 5);
    else next.start = Math.max(0, next.end - 5);
  }
  await updateRange(next.start, next.end);
}

async function updateClip(clipId, patch) {
  try {
    await jsonRequest(`/api/rooms/${room.id}/clips/${clipId}`, { method: 'PATCH', body: JSON.stringify({ participantId, ...patch }) });
  } catch (error) { showToast(error.message, true); }
}

async function deleteClip(clipId) {
  try {
    await jsonRequest(`/api/rooms/${room.id}/clips/${clipId}`, { method: 'DELETE', body: JSON.stringify({ participantId }) });
    hideContextMenu();
  } catch (error) { showToast(error.message, true); }
}

function showClipContextMenu(x, y, clipId) {
  hideContextMenu();
  const clip = room.clips.find((item) => item.id === clipId); if (!clip) return;
  const canEdit = clip.participantId === participantId || isHost();
  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.left = `${x}px`; contextMenu.style.top = `${y}px`;
  contextMenu.innerHTML = `<button data-menu-preview>▶ Прослушать с этого места</button>${canEdit ? '<button data-menu-range>⌗ Выбрать этот клип как участок</button><button class="danger" data-menu-delete>🗑 Удалить аудиоклип</button>' : ''}`;
  document.body.appendChild(contextMenu);
  contextMenu.querySelector('[data-menu-preview]')?.addEventListener('click', () => { seekProject(clip.start); hideContextMenu(); });
  contextMenu.querySelector('[data-menu-range]')?.addEventListener('click', async () => { await updateRange(clip.start, clip.start + clip.duration); hideContextMenu(); fitRange(); });
  contextMenu.querySelector('[data-menu-delete]')?.addEventListener('click', () => deleteClip(clipId));
  setTimeout(() => document.addEventListener('pointerdown', hideContextMenu, { once: true }), 0);
}
function hideContextMenu() { contextMenu?.remove(); contextMenu = null; }

async function uploadVideo(file) {
  const label = document.querySelector('.upload-button');
  if (label) { label.classList.add('disabled'); label.childNodes[0].textContent = 'Загрузка…'; }
  try {
    const response = await fetch(`/api/rooms/${room.id}/video`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-participant-id': participantId, 'x-file-name': encodeURIComponent(file.name) },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось загрузить видео.');
    showToast('Фильм загружен. Выберите участок IN–OUT.');
  } catch (error) { showToast(error.message, true); renderStudio(); }
}
