let timelineRefreshFrame = 0;

function renderStudio() {
  if (!room) return;
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
        <div class="top-status"><span class="online-count">${room.participants.filter(p => p.connected).length}/3</span> в студии</div>
      </header>

      <section class="cinema-section">
        <div class="cinema-frame">
          ${room.video ? `
            <div class="video-wrap cinema-video-wrap">
              <video id="movie" src="${escapeHtml(room.video.url)}" muted playsinline preload="metadata"></video>
              <div id="stage-overlay"></div>
            </div>
            <div class="transport-bar unified-transport">
              <button class="transport-btn transport-primary" id="transport-play" title="Пробел">▶</button>
              <div class="timecode"><strong id="playhead-time">${formatTime(room.range.start, true)}</strong><span>/ ${formatTime(duration)}</span></div>
              <div class="common-range-block">
                <span>ОБЩИЙ ФРАГМЕНТ</span>
                <strong><b id="range-start-label">${formatTime(room.range.start, true)}</b> → <b id="range-end-label">${formatTime(room.range.end, true)}</b></strong>
              </div>
              ${host ? `<button class="transport-btn text" id="set-in">IN = курсор</button><button class="transport-btn text" id="set-out">OUT = курсор</button>` : '<span class="range-owner-note">Фрагмент выбирает ведущий</span>'}
              <div class="transport-spacer"></div>
              <button class="rec-mode-button ${me()?.armed ? 'armed' : ''}" id="self-rec-arm"><span></span><b>МОЙ REC</b><em>${me()?.armed ? 'ВКЛ' : 'ВЫКЛ'}</em></button>
              <button class="space-action" id="space-action"></button>
              <button class="self-ready-button ${me()?.ready ? 'ready' : ''}" id="self-ready"></button>
            </div>
            <div class="video-meta-line"><strong>${escapeHtml(room.video.originalName)}</strong><span>${formatSize(room.video.size)} · во время REC чужие голоса не слышны</span></div>` : `
            <div class="empty-video cinema-empty">
              <div class="film-icon">🎞️</div><h2>Загрузите фильм</h2><p>После загрузки появится общий фрагмент и отдельная сессия озвучки у каждого.</p>
              ${host ? '<label class="primary upload-button">Выбрать видео<input id="video-file" type="file" accept="video/*"></label>' : '<p class="muted">Ждём ведущего.</p>'}
            </div>`}
        </div>
      </section>

      <div id="editor-region">${room.video ? renderEditorRegion(duration, host) : ''}</div>
    </main>`;

  bindStudioEvents();
  if (room.video) {
    updateLocalControlUi();
    updateAllParticipantStatusUi();
    refreshTimelineView();
    renderModeUi();
    for (const p of room.participants) updateLevel(p.id, lastLevel(p.id));
  }
}

function renderEditorRegion(duration, host) {
  return `${renderSessionBoard()}${renderTimelineEditor(duration, host)}`;
}

function renderSessionBoard() {
  return `
    <section class="session-board">
      <div class="session-board-title"><div><span class="eyebrow">Статус команды</span><h2>Кто уже готов?</h2></div><span>Один фрагмент · независимые записи</span></div>
      <div class="session-status-grid">
        ${room.participants.map(renderSessionStatusCard).join('')}
      </div>
    </section>`;
}

function participantStatus(participant) {
  if (!participant.connected) return { key: 'offline', title: 'НЕ В СЕТИ', detail: 'участник отключён' };
  if (recordingFor(participant.id)) return { key: 'recording', title: '● ЗАПИСЫВАЕТ', detail: 'своя сессия REC' };
  if (participant.ready) return { key: 'ready', title: '✓ ГОТОВ', detail: 'ждёт остальных' };
  if (participantHasRangeAudio(participant.id)) return { key: 'recorded', title: 'НЕ ГОТОВ', detail: 'запись есть · редактирует' };
  return { key: 'waiting', title: 'НЕ ГОТОВ', detail: 'ещё не записал фрагмент' };
}

function renderSessionStatusCard(participant) {
  const status = participantStatus(participant);
  const self = participant.id === participantId;
  return `
    <article class="session-status-card status-${status.key} ${self ? 'is-self' : ''}" data-status-card="${escapeHtml(participant.id)}" style="--person-color:${escapeHtml(participant.color)}">
      <div class="session-avatar">${escapeHtml(participant.name.slice(0,1).toUpperCase())}</div>
      <div class="session-person"><strong>${escapeHtml(participant.name)}${self ? ' · вы' : ''}</strong><span data-status-detail>${status.detail}</span></div>
      <div class="session-state"><strong data-status-title>${status.title}</strong><i></i></div>
    </article>`;
}

function renderTimelineEditor(duration, host) {
  const ticks = buildTicks(viewStart, visibleSeconds);
  return `
    <section class="editor-card">
      <div class="editor-toolbar">
        <div><span class="eyebrow">Монтажный стол</span><h2>Аудиодорожки</h2></div>
        <div class="toolbar-center">
          <button class="secondary compact" id="zoom-out">−</button>
          <span class="zoom-label" id="zoom-label">${zoomLabel()}</span>
          <button class="secondary compact" id="zoom-in">+</button>
          <button class="secondary compact" id="fit-range">Показать общий фрагмент</button>
        </div>
        <div class="editor-hint"><b>Space</b> — запись/просмотр · Ctrl+колесо — масштаб · средняя кнопка — панорама</div>
      </div>

      <div class="timeline-grid">
        <div class="track-head ruler-head"><span>ДОРОЖКИ</span></div>
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
  const height = Math.max(92, laneCount * 58 + 24);
  const self = participant.id === participantId;
  const status = participantStatus(participant);
  return `
    <div class="track-head participant-track-head status-${status.key}" data-track-head="${escapeHtml(participant.id)}" style="min-height:${height}px;--track-color:${escapeHtml(participant.color)}">
      <div class="track-person-row">
        <div class="track-avatar">${escapeHtml(participant.name.slice(0,1).toUpperCase())}</div>
        <div class="track-name"><strong>${escapeHtml(participant.name)}${self ? ' · вы' : ''}</strong><span data-track-status>${status.title}</span></div>
      </div>
      <div class="track-actions">
        ${self ? `<button class="arm-button ${participant.armed ? 'armed' : ''}" data-arm="${participant.id}"><span></span>${participant.armed ? 'REC ВКЛ' : 'REC ВЫКЛ'}</button>` : `<span class="remote-status-pill status-${status.key}">${status.title}</span>`}
        ${self ? `<button class="ready-button ${participant.ready ? 'ready' : ''}" data-ready="${participant.id}">${participant.ready ? '✓ ГОТОВ' : 'НЕ ГОТОВ'}</button>` : ''}
        ${self ? `<label class="color-picker" title="Цвет вашей дорожки"><input type="color" value="${escapeHtml(participant.color)}" data-color="${participant.id}"></label>` : ''}
      </div>
    </div>
    <div class="timeline-viewport track-viewport" data-track="${escapeHtml(participant.id)}" style="min-height:${height}px;--track-color:${escapeHtml(participant.color)}">
      ${renderRangeOverlay()}
      <div class="track-grid-lines"></div>
      ${lanes.map(({clip,lane}) => renderAudioClip(clip, lane, participant, self)).join('')}
      ${recordingFor(participant.id) ? renderLiveClip(participant, self) : ''}
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

function renderAudioClip(clip, lane, participant, self) {
  const left = timeToPercent(clip.start);
  const width = Math.max(0.45, clip.duration / visibleSeconds * 100);
  const peaks = clip.peaks?.length ? clip.peaks : Array.from({length:36}, (_,i) => 0.12 + ((i*17)%11)/30);
  const bars = peaks.map((peak) => `<i style="height:${Math.max(8, Math.min(100, peak * 100))}%"></i>`).join('');
  return `
    <div class="audio-clip ${self ? 'own-clip' : 'foreign-clip'} ${selectedClipId === clip.id ? 'selected' : ''}"
      data-clip-id="${clip.id}" data-owner="${clip.participantId}" data-start="${clip.start}" data-duration="${clip.duration}"
      style="left:${left}%;width:${width}%;top:${lane*58+10}px;--clip-color:${escapeHtml(participant.color)}" ${self ? 'data-editable="1"' : ''}>
      <div class="clip-title"><span>${escapeHtml(participant.name)}</span><b>${formatTime(clip.start,true)}</b></div>
      <div class="clip-waveform">${bars}</div>
      <div class="clip-volume-wrap" title="Громкость клипа">
        <span>VOL</span><input class="clip-volume" data-volume="${clip.id}" type="range" min="0" max="1" step="0.01" value="${clip.volume}" ${self ? '' : 'disabled'}><em>${Math.round(clip.volume*100)}%</em>
      </div>
    </div>`;
}

function renderLiveClip(participant, self) {
  const recording = recordingFor(participant.id);
  if (!recording) return '';
  const left = timeToPercent(recording.startTime);
  const elapsed = Math.max(0, (Date.now() - recording.startAt) / 1000);
  const duration = Math.min(recording.endTime - recording.startTime, elapsed);
  const width = Math.max(0.35, duration / visibleSeconds * 100);
  return `<div class="audio-clip live-clip ${self ? 'own-clip' : 'foreign-clip'}" data-live-participant="${participant.id}" style="left:${left}%;width:${width}%;top:10px;--clip-color:${escapeHtml(participant.color)}"><div class="clip-title"><span>● REC · ${escapeHtml(participant.name)}</span></div><div class="clip-waveform live-waveform"></div></div>`;
}

function renderRangeOverlay() {
  return `<div class="work-range" style="left:${timeToPercent(room.range.start)}%;width:${Math.max(0, (room.range.end-room.range.start)/visibleSeconds*100)}%"></div>`;
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

function zoomLabel() { return visibleSeconds < 60 ? `${visibleSeconds.toFixed(0)} сек` : `${(visibleSeconds/60).toFixed(1)} мин`; }
function timeToPercent(time) { return (Number(time) - viewStart) / visibleSeconds * 100; }
function percentToTime(percent) { return viewStart + percent / 100 * visibleSeconds; }

function applyRoomState(next) {
  const previous = room;
  room = next;
  if (!document.querySelector('.daw-shell')) return renderStudio();
  const videoChanged = previous?.video?.url !== next.video?.url;
  if (videoChanged) return renderStudio();

  const oldParticipantIds = (previous?.participants || []).map(p => p.id).join('|');
  const newParticipantIds = next.participants.map(p => p.id).join('|');
  const oldClipIds = (previous?.clips || []).map(c => c.id).sort().join('|');
  const newClipIds = next.clips.map(c => c.id).sort().join('|');

  if (oldParticipantIds !== newParticipantIds || oldClipIds !== newClipIds) {
    renderEditorOnly();
  } else {
    updateAllParticipantStatusUi();
    updateClipElementsFromState();
    refreshTimelineView();
  }
  updateRangeUi();
  updateLocalControlUi();
  renderModeUi();
  const count = document.querySelector('.online-count');
  if (count) count.textContent = `${room.participants.filter(p => p.connected).length}/3`;
}

function renderEditorOnly() {
  const region = document.querySelector('#editor-region');
  if (!region || !room.video) return;
  const duration = Math.max(videoDuration(), room.range.end, 30);
  region.innerHTML = renderEditorRegion(duration, isHost());
  bindEditorEvents();
  updateAllParticipantStatusUi();
  refreshTimelineView();
}

function bindStudioEvents() {
  document.querySelector('#copy-link')?.addEventListener('click', copyInvite);
  document.querySelector('#video-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0]; if (file) uploadVideo(file);
  });
  document.querySelector('#transport-play')?.addEventListener('click', handleSpaceAction);
  document.querySelector('#space-action')?.addEventListener('click', handleSpaceAction);
  document.querySelector('#self-rec-arm')?.addEventListener('click', toggleOwnArm);
  document.querySelector('#self-ready')?.addEventListener('click', toggleOwnReady);
  document.querySelector('#set-in')?.addEventListener('click', () => setRangeEdge('start'));
  document.querySelector('#set-out')?.addEventListener('click', () => setRangeEdge('end'));
  bindEditorEvents();

  const movie = document.querySelector('#movie');
  if (movie) {
    movie.addEventListener('loadedmetadata', async () => {
      if (isHost() && Number.isFinite(movie.duration) && movie.duration > 0 && Math.abs((room.video?.duration || 0) - movie.duration) > 0.2) {
        try { await jsonRequest(`/api/rooms/${room.id}/video-meta`, { method: 'POST', body: JSON.stringify({ participantId, duration: movie.duration }) }); } catch {}
      }
      updatePlayheadUi(movie.currentTime);
    });
    movie.addEventListener('timeupdate', () => updatePlayheadUi(movie.currentTime));
    movie.addEventListener('error', () => showToast('Видео не декодируется браузером. Попробуйте MP4 с H.264/AAC.', true));
    movie.addEventListener('ended', () => { stopProjectAudio(); clearTimeout(localPlaybackTimer); updateLocalControlUi(); });
  }
}

function bindEditorEvents() {
  document.querySelector('#zoom-in')?.addEventListener('click', () => zoomTimeline(0.72, 0.5));
  document.querySelector('#zoom-out')?.addEventListener('click', () => zoomTimeline(1.38, 0.5));
  document.querySelector('#fit-range')?.addEventListener('click', fitRange);
  document.querySelectorAll('[data-arm]').forEach((button) => button.addEventListener('click', toggleOwnArm));
  document.querySelectorAll('[data-ready]').forEach((button) => button.addEventListener('click', toggleOwnReady));
  document.querySelectorAll('[data-color]').forEach((input) => {
    input.addEventListener('input', () => saveColorSoon(input.value));
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
  });
  document.querySelectorAll('.timeline-viewport').forEach(bindTimelineViewport);
  document.querySelectorAll('.audio-clip[data-clip-id]').forEach(bindClipInteractions);
  document.querySelectorAll('.clip-volume').forEach(bindVolumeSlider);
  document.querySelectorAll('[data-range-handle]').forEach(bindRangeHandle);
}

async function toggleOwnArm() {
  if (mode === 'recording' || mode === 'countdown') return;
  const participant = me(); if (!participant) return;
  await updateParticipant({ armed: !participant.armed, ready: false });
}

async function toggleOwnReady() {
  if (mode === 'recording' || mode === 'countdown') return;
  const participant = me(); if (!participant) return;
  await updateParticipant({ ready: !participant.ready });
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
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        viewStart = clampViewStart(startView - dx / width * visibleSeconds);
        requestTimelineRefresh();
      };
      const up = () => {
        middlePanning = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (event.button === 0 && event.target.closest('.audio-clip,.range-handle,input,button')) return;
    if (mode === 'recording' || mode === 'countdown') return;
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
      if (Math.abs(newStart - startTime) > 0.001) {
        clip.start = newStart;
        await updateClip(clip.id, { start: newStart });
        refreshTimelineView();
      }
    };
    clipEl.addEventListener('pointermove', move); clipEl.addEventListener('pointerup', up);
  });
}

function bindVolumeSlider(input) {
  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  input.addEventListener('input', () => {
    const clip = room.clips.find(item => item.id === input.dataset.volume);
    if (clip) clip.volume = Number(input.value);
    const em = input.parentElement.querySelector('em'); if (em) em.textContent = `${Math.round(Number(input.value)*100)}%`;
  });
  input.addEventListener('change', () => updateClip(input.dataset.volume, { volume: Number(input.value) }));
}

function bindRangeHandle(handle) {
  handle.addEventListener('pointerdown', (event) => {
    if (!isHost() || room.recordings.length || mode !== 'idle') return;
    event.preventDefault();
    const viewport = handle.closest('.timeline-viewport');
    handle.setPointerCapture(event.pointerId);
    let next = { ...room.range };
    const move = (moveEvent) => {
      const rect = viewport.getBoundingClientRect();
      const time = clampNumber(percentToTime((moveEvent.clientX - rect.left) / rect.width * 100), 0, videoDuration() || 86400);
      if (handle.dataset.rangeHandle === 'start') next.start = Math.min(time, next.end - 0.1);
      else next.end = Math.max(time, next.start + 0.1);
      room.range = next;
      updateRangeUi();
      refreshTimelineView();
    };
    const up = async () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
      await updateRange(next.start, next.end);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}

function updateLevel(id, value) {
  const history = levelHistory.get(id) || Array(32).fill(0.02);
  history.push(clampNumber(value, 0, 1)); while (history.length > 32) history.shift();
  levelHistory.set(id, history);
  const head = document.querySelector(`[data-track-head="${CSS.escape(id)}"]`);
  if (head) head.classList.toggle('speaking', value > 0.12);
  if (recordingFor(id)) updateLiveRecordingBlocks();
}

function lastLevel(id) { const h = levelHistory.get(id); return h?.[h.length-1] || 0; }

function syncLiveRecordingElements() {
  const activeIds = new Set((room?.recordings || []).map(item => item.participantId));
  document.querySelectorAll('[data-live-participant]').forEach((el) => {
    if (!activeIds.has(el.dataset.liveParticipant)) el.remove();
  });
  for (const recording of room?.recordings || []) {
    if (document.querySelector(`[data-live-participant="${CSS.escape(recording.participantId)}"]`)) continue;
    const participant = room.participants.find(p => p.id === recording.participantId);
    const viewport = document.querySelector(`[data-track="${CSS.escape(recording.participantId)}"]`);
    if (!participant || !viewport) continue;
    const template = document.createElement('template');
    template.innerHTML = renderLiveClip(participant, participant.id === participantId).trim();
    const node = template.content.firstElementChild;
    const playhead = viewport.querySelector('[data-playhead-line]');
    viewport.insertBefore(node, playhead || null);
  }
}

function updateLiveRecordingBlocks() {
  for (const recording of room?.recordings || []) {
    const el = document.querySelector(`[data-live-participant="${CSS.escape(recording.participantId)}"]`);
    if (!el) continue;
    const elapsed = Math.max(0, (Date.now() - recording.startAt) / 1000);
    const duration = Math.min(recording.endTime - recording.startTime, elapsed);
    el.style.left = `${timeToPercent(recording.startTime)}%`;
    el.style.width = `${Math.max(0.35, duration / visibleSeconds * 100)}%`;
    const h = levelHistory.get(recording.participantId) || [];
    el.querySelector('.live-waveform').innerHTML = h.slice(-28).map(v => `<i style="height:${Math.max(8,v*100)}%"></i>`).join('');
  }
}

function updatePlayheadUi(time) {
  const pct = timeToPercent(time);
  document.querySelectorAll('[data-playhead-line]').forEach((line) => { line.style.left = `${pct}%`; line.classList.toggle('offscreen', pct < 0 || pct > 100); });
  const label = document.querySelector('#playhead-time'); if (label) label.textContent = formatTime(time, true);
  if (mode === 'recording') updateLiveRecordingBlocks();
}

function updateRangeUi() {
  const start = document.querySelector('#range-start-label'); if (start) start.textContent = formatTime(room.range.start, true);
  const end = document.querySelector('#range-end-label'); if (end) end.textContent = formatTime(room.range.end, true);
  document.querySelectorAll('.work-range').forEach((el) => {
    el.style.left = `${timeToPercent(room.range.start)}%`;
    el.style.width = `${Math.max(0, (room.range.end-room.range.start)/visibleSeconds*100)}%`;
  });
  document.querySelector('[data-range-handle="start"]')?.style.setProperty('left', `${timeToPercent(room.range.start)}%`);
  document.querySelector('[data-range-handle="end"]')?.style.setProperty('left', `${timeToPercent(room.range.end)}%`);
}

function updateParticipantStatusUi(id) {
  const participant = room.participants.find(p => p.id === id); if (!participant) return;
  const status = participantStatus(participant);
  const card = document.querySelector(`[data-status-card="${CSS.escape(id)}"]`);
  if (card) {
    card.className = `session-status-card status-${status.key}${id === participantId ? ' is-self' : ''}`;
    card.style.setProperty('--person-color', participant.color);
    const title = card.querySelector('[data-status-title]'); if (title) title.textContent = status.title;
    const detail = card.querySelector('[data-status-detail]'); if (detail) detail.textContent = status.detail;
  }
  const head = document.querySelector(`[data-track-head="${CSS.escape(id)}"]`);
  if (head) {
    head.classList.remove('status-offline','status-recording','status-ready','status-recorded','status-waiting');
    head.classList.add(`status-${status.key}`);
    head.style.setProperty('--track-color', participant.color);
    const statusEl = head.querySelector('[data-track-status]'); if (statusEl) statusEl.textContent = status.title;
    const arm = head.querySelector('[data-arm]'); if (arm) { arm.classList.toggle('armed', participant.armed); arm.innerHTML = `<span></span>${participant.armed ? 'REC ВКЛ' : 'REC ВЫКЛ'}`; }
    const ready = head.querySelector('[data-ready]'); if (ready) { ready.classList.toggle('ready', participant.ready); ready.textContent = participant.ready ? '✓ ГОТОВ' : 'НЕ ГОТОВ'; }
    const remote = head.querySelector('.remote-status-pill'); if (remote) { remote.className = `remote-status-pill status-${status.key}`; remote.textContent = status.title; }
  }
  applyParticipantColor(id, participant.color);
}

function updateAllParticipantStatusUi() { for (const p of room.participants) updateParticipantStatusUi(p.id); }

function applyParticipantColor(id, color) {
  document.querySelectorAll(`[data-status-card="${CSS.escape(id)}"],[data-track-head="${CSS.escape(id)}"],[data-track="${CSS.escape(id)}"]`).forEach(el => {
    el.style.setProperty('--person-color', color); el.style.setProperty('--track-color', color);
  });
  document.querySelectorAll(`.audio-clip[data-owner="${CSS.escape(id)}"], [data-live-participant="${CSS.escape(id)}"]`).forEach(el => el.style.setProperty('--clip-color', color));
}

function updateLocalControlUi() {
  const participant = me(); if (!participant) return;
  const rec = document.querySelector('#self-rec-arm');
  if (rec) { rec.classList.toggle('armed', participant.armed); rec.innerHTML = `<span></span><b>МОЙ REC</b><em>${participant.armed ? 'ВКЛ' : 'ВЫКЛ'}</em>`; }
  const ready = document.querySelector('#self-ready');
  if (ready) { ready.classList.toggle('ready', participant.ready); ready.textContent = participant.ready ? '✓ Я ГОТОВ' : 'Я НЕ ГОТОВ'; }
  const space = document.querySelector('#space-action');
  if (space) {
    if (mode === 'countdown') space.innerHTML = '<kbd>SPACE</kbd><span>ОТМЕНИТЬ REC</span>';
    else if (mode === 'recording') space.innerHTML = '<kbd>SPACE</kbd><span>ОСТАНОВИТЬ REC</span>';
    else if (participant.armed) space.innerHTML = '<kbd>SPACE</kbd><span>ЗАПИСАТЬ ОБЩИЙ ФРАГМЕНТ</span>';
    else space.innerHTML = '<kbd>SPACE</kbd><span>PLAY / PAUSE ФРАГМЕНТА</span>';
    space.classList.toggle('record-action', participant.armed && mode === 'idle');
  }
  const play = document.querySelector('#transport-play');
  const movie = document.querySelector('#movie');
  if (play && movie) play.textContent = movie.paused ? '▶' : '❚❚';
}

function updateClipElementsFromState() {
  const laneMaps = new Map();
  for (const participant of room.participants) {
    const clips = room.clips.filter(c => c.participantId === participant.id).sort((a,b) => a.start-b.start);
    const lanes = assignClipLanes(clips);
    laneMaps.set(participant.id, new Map(lanes.map(({clip,lane}) => [clip.id,lane])));
    const laneCount = Math.max(1, lanes.reduce((m,item)=>Math.max(m,item.lane+1),1));
    const height = Math.max(92, laneCount*58+24);
    document.querySelector(`[data-track-head="${CSS.escape(participant.id)}"]`)?.style.setProperty('min-height', `${height}px`);
    document.querySelector(`[data-track="${CSS.escape(participant.id)}"]`)?.style.setProperty('min-height', `${height}px`);
  }
  for (const clip of room.clips) {
    const el = document.querySelector(`[data-clip-id="${CSS.escape(clip.id)}"]`); if (!el) continue;
    const owner = room.participants.find(p => p.id === clip.participantId);
    el.dataset.start = clip.start; el.dataset.duration = clip.duration;
    el.style.left = `${timeToPercent(clip.start)}%`; el.style.width = `${Math.max(.45, clip.duration/visibleSeconds*100)}%`;
    el.style.top = `${(laneMaps.get(clip.participantId)?.get(clip.id) || 0)*58+10}px`;
    if (owner) el.style.setProperty('--clip-color', owner.color);
    const title = el.querySelector('.clip-title b'); if (title) title.textContent = formatTime(clip.start,true);
    const volume = el.querySelector('.clip-volume'); if (volume && document.activeElement !== volume) volume.value = clip.volume;
    const em = el.querySelector('.clip-volume-wrap em'); if (em) em.textContent = `${Math.round(clip.volume*100)}%`;
  }
}

function requestTimelineRefresh() {
  if (timelineRefreshFrame) return;
  timelineRefreshFrame = requestAnimationFrame(() => { timelineRefreshFrame = 0; refreshTimelineView(); });
}

function refreshTimelineView() {
  const rulerTicks = document.querySelector('.ruler-ticks'); if (rulerTicks) rulerTicks.innerHTML = buildTicks(viewStart, visibleSeconds);
  const zoom = document.querySelector('#zoom-label'); if (zoom) zoom.textContent = zoomLabel();
  updateRangeUi();
  updateClipElementsFromState();
  syncLiveRecordingElements();
  updateLiveRecordingBlocks();
  const movie = document.querySelector('#movie'); updatePlayheadUi(movie?.currentTime ?? room.range.start);
}

function zoomTimeline(factor, anchor = 0.5) {
  const duration = Math.max(5, videoDuration() || 3600);
  const anchorTime = viewStart + visibleSeconds * anchor;
  visibleSeconds = clampNumber(visibleSeconds * factor, 5, duration);
  viewStart = clampViewStart(anchorTime - visibleSeconds * anchor);
  requestTimelineRefresh();
}

function panTimeline(deltaSeconds) { viewStart = clampViewStart(viewStart + deltaSeconds); requestTimelineRefresh(); }
function clampViewStart(value) { return clampNumber(value, 0, Math.max(0, (videoDuration() || 3600) - visibleSeconds)); }
function fitRange() {
  const span = Math.max(1, room.range.end - room.range.start);
  visibleSeconds = Math.min(Math.max(5, span * 1.25), Math.max(5, videoDuration() || span * 1.25));
  viewStart = clampViewStart(room.range.start - (visibleSeconds - span) / 2);
  requestTimelineRefresh();
}

async function updateRange(start, end) {
  const previous = { ...room.range };
  room.range = { start, end };
  updateRangeUi(); refreshTimelineView();
  try {
    await jsonRequest(`/api/rooms/${room.id}/range`, { method: 'POST', body: JSON.stringify({ participantId, start, end }) });
  } catch (error) {
    room.range = previous; updateRangeUi(); refreshTimelineView(); showToast(error.message, true);
  }
}

async function setRangeEdge(edge) {
  const movie = document.querySelector('#movie'); if (!movie || !isHost()) return;
  const time = movie.currentTime;
  const next = { ...room.range, [edge]: time };
  if (next.end - next.start < 0.1) {
    if (edge === 'start') next.end = Math.min(videoDuration() || 86400, next.start + 5);
    else next.start = Math.max(0, next.end - 5);
  }
  await updateRange(next.start, next.end);
}

async function updateClip(clipId, patch) {
  const clip = room.clips.find(c => c.id === clipId); if (!clip) return;
  try {
    await jsonRequest(`/api/rooms/${room.id}/clips/${clipId}`, { method: 'PATCH', body: JSON.stringify({ participantId, ...patch }) });
    const participant = me(); if (participant) { participant.ready = false; updateParticipantStatusUi(participant.id); updateLocalControlUi(); }
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
  const own = clip.participantId === participantId;
  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.left = `${x}px`; contextMenu.style.top = `${y}px`;
  contextMenu.innerHTML = `<button data-menu-preview>▶ Слушать с этого места</button>${isHost() ? '<button data-menu-range>⌗ Сделать клип общим фрагментом</button>' : ''}${own ? '<button class="danger" data-menu-delete>🗑 Удалить мою запись</button>' : ''}`;
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
    showToast('Фильм загружен. Выберите общий фрагмент IN–OUT.');
  } catch (error) { showToast(error.message, true); renderStudio(); }
}
