import {
  http, fsp, path, DATA_DIR, PUBLIC_DIR, PORT, ROOM_TTL_MS, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, DEFAULT_COLORS, rooms,
  now, makeRoomCode, publicRoom, sendJson, sendSse, broadcast, broadcastRoom, readJson, safeFileName,
  extensionFrom, streamUpload, parseRoute, requireRoom, serveFile, touch, isHost, roomDir, randomId,
  clamp, sanitizeColor, resetReady, parsePeaks,
} from './lib.js';

function scheduleMixPreview(room) {
  if (room.recording) return;
  const connected = [...room.participants.values()].filter((p) => p.connected);
  if (!connected.length || !connected.every((p) => p.ready)) return;
  const payload = {
    previewAt: now() + 1200,
    startTime: room.range.start,
    endTime: room.range.end,
  };
  resetReady(room);
  broadcastRoom(room);
  broadcast(room, 'mix-preview', payload);
}

function stopRecording(room, stopAt = now() + 300) {
  const recording = room.recording;
  if (!recording) return null;
  if (recording.timer) clearTimeout(recording.timer);
  const elapsed = Math.max(0, stopAt - recording.startAt) / 1000;
  const endTime = Math.min(recording.endTime, recording.startTime + elapsed);
  room.recording = undefined;
  room.player = { currentTime: endTime, playing: false };
  touch(room);
  resetReady(room);
  const payload = { sessionId: recording.sessionId, stopAt, startTime: recording.startTime, endTime };
  broadcastRoom(room);
  broadcast(room, 'recording-stop', payload);
  return payload;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { ok: true, rooms: rooms.size });

    if (req.method === 'POST' && pathname === '/api/rooms') {
      const body = await readJson(req);
      const participantId = String(body.participantId || '').slice(0, 64);
      const name = String(body.name || 'Участник').trim().slice(0, 32);
      if (!participantId) return sendJson(res, 400, { error: 'Нет participantId.' });
      const id = makeRoomCode();
      const participant = { id: participantId, name, connected: true, color: DEFAULT_COLORS[0], armed: true, ready: false };
      const room = {
        id,
        createdAt: now(),
        updatedAt: now(),
        hostParticipantId: participantId,
        participants: new Map([[participantId, participant]]),
        sse: new Map(),
        player: { currentTime: 0, playing: false },
        range: { start: 0, end: 30 },
        clips: [],
      };
      rooms.set(id, room);
      return sendJson(res, 201, { ok: true, room: publicRoom(room) });
    }

    let params = parseRoute(pathname, '/api/rooms/:roomId/join');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      const participantId = String(body.participantId || '').slice(0, 64);
      const name = String(body.name || 'Участник').trim().slice(0, 32);
      if (!participantId) return sendJson(res, 400, { error: 'Нет participantId.' });
      const existing = room.participants.get(participantId);
      if (!existing && room.participants.size >= 3) return sendJson(res, 409, { error: 'В комнате уже 3 участника.' });
      const index = existing ? [...room.participants.keys()].indexOf(participantId) : room.participants.size;
      room.participants.set(participantId, {
        id: participantId,
        name,
        connected: true,
        color: existing?.color || DEFAULT_COLORS[index] || DEFAULT_COLORS[0],
        armed: existing?.armed ?? true,
        ready: false,
      });
      touch(room); resetReady(room); broadcastRoom(room);
      return sendJson(res, 200, { ok: true, room: publicRoom(room) });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/state');
    if (req.method === 'GET' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      return sendJson(res, 200, publicRoom(room));
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/events');
    if (req.method === 'GET' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const participantId = String(url.searchParams.get('participantId') || '');
      const participant = room.participants.get(participantId);
      if (!participant) return sendJson(res, 403, { error: 'Сначала войдите в комнату.' });
      participant.connected = true;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 1500\n\n');
      const list = room.sse.get(participantId) ?? new Set();
      list.add(res); room.sse.set(participantId, list);
      sendSse(res, 'room-state', publicRoom(room)); broadcastRoom(room);
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(heartbeat); list.delete(res);
        if (!list.size) {
          room.sse.delete(participantId);
          setTimeout(() => {
            if (room.sse.has(participantId)) return;
            const p = room.participants.get(participantId);
            if (p) { p.connected = false; p.ready = false; }
            broadcastRoom(room);
          }, 3000).unref();
        }
      });
      return;
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/participant');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      const participant = room.participants.get(String(body.participantId || ''));
      if (!participant) return sendJson(res, 403, { error: 'Не участник комнаты.' });
      if ('armed' in body) participant.armed = Boolean(body.armed);
      if ('color' in body) participant.color = sanitizeColor(body.color, participant.color);
      if ('ready' in body) {
        if (room.recording) return sendJson(res, 409, { error: 'Сначала завершите запись.' });
        participant.ready = Boolean(body.ready);
      }
      touch(room); broadcastRoom(room);
      if ('ready' in body && participant.ready) scheduleMixPreview(room);
      return sendJson(res, 200, { ok: true, participant });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/level');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      const participantId = String(body.participantId || '');
      if (!room.participants.has(participantId)) return sendJson(res, 403, { error: 'Не участник комнаты.' });
      const level = clamp(body.level, 0, 1);
      broadcast(room, 'participant-level', { participantId, level }, participantId);
      res.writeHead(204); res.end(); return;
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/player');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId) || room.recording) return sendJson(res, 403, { error: 'Транспорт сейчас недоступен.' });
      room.player = { currentTime: Math.max(0, Number(body.currentTime) || 0), playing: Boolean(body.playing) };
      touch(room);
      broadcast(room, 'player-state', room.player, body.participantId);
      return sendJson(res, 200, { ok: true });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/range');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId) || room.recording) return sendJson(res, 403, { error: 'Диапазон меняет ведущий вне записи.' });
      const max = Math.max(0.1, Number(room.video?.duration) || 24 * 60 * 60);
      let start = clamp(body.start, 0, max);
      let end = clamp(body.end, 0, max);
      if (end < start) [start, end] = [end, start];
      if (end - start < 0.1) end = Math.min(max, start + 0.1);
      room.range = { start, end };
      resetReady(room); touch(room); broadcastRoom(room);
      return sendJson(res, 200, { ok: true, range: room.range });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/video');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const participantId = String(req.headers['x-participant-id'] || '');
      if (!isHost(room, participantId)) return sendJson(res, 403, { error: 'Видео загружает ведущий.' });
      const originalName = safeFileName(decodeURIComponent(String(req.headers['x-file-name'] || 'video')));
      const contentType = String(req.headers['content-type'] || 'application/octet-stream');
      const ext = extensionFrom(contentType, originalName);
      const target = path.join(roomDir(room.id), `source${ext}`);
      const size = await streamUpload(req, target, MAX_VIDEO_BYTES);
      const relative = path.relative(DATA_DIR, target).split(path.sep).join('/');
      room.video = { url: `/media/${relative}`, originalName, size, duration: undefined };
      room.player = { currentTime: 0, playing: false };
      room.range = { start: 0, end: 30 };
      room.clips = [];
      resetReady(room); touch(room); broadcastRoom(room); broadcast(room, 'video-ready', room.video);
      return sendJson(res, 200, room.video);
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/video-meta');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId) || !room.video) return sendJson(res, 403, { error: 'Недоступно.' });
      const duration = clamp(body.duration, 0.1, 24 * 60 * 60);
      room.video.duration = duration;
      room.range.end = Math.min(Math.max(room.range.start + 0.1, room.range.end), duration);
      touch(room); broadcastRoom(room);
      return sendJson(res, 200, { ok: true, duration });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/recording/start');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId)) return sendJson(res, 403, { error: 'Запись запускает ведущий.' });
      if (!room.video) return sendJson(res, 409, { error: 'Сначала загрузите видео.' });
      if (room.recording) return sendJson(res, 409, { error: 'Запись уже идёт.' });
      const armed = [...room.participants.values()].filter((p) => p.connected && p.armed).map((p) => p.id);
      if (!armed.length) return sendJson(res, 409, { error: 'Никто не включил REC на своей дорожке.' });
      const startTime = room.range.start;
      const endTime = room.range.end;
      const startAt = now() + 3500;
      const stopAt = startAt + Math.max(100, (endTime - startTime) * 1000);
      const sessionId = randomId(10);
      room.recording = { sessionId, startTime, endTime, startAt, stopAt, armedParticipantIds: armed };
      room.recording.timer = setTimeout(() => stopRecording(room, stopAt), Math.max(0, stopAt - now()));
      room.player = { currentTime: startTime, playing: false };
      resetReady(room); touch(room);
      const payload = { sessionId, startTime, endTime, startAt, stopAt, armedParticipantIds: armed };
      broadcastRoom(room); broadcast(room, 'recording-countdown', payload);
      return sendJson(res, 200, { ok: true, ...payload });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/recording/stop');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId)) return sendJson(res, 403, { error: 'Остановить запись может ведущий.' });
      if (!room.recording) return sendJson(res, 409, { error: 'Активной записи нет.' });
      return sendJson(res, 200, { ok: true, ...stopRecording(room) });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/sessions/:sessionId/clips/:participantId');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const participant = room.participants.get(params.participantId);
      if (!participant) return sendJson(res, 403, { error: 'Участник не найден.' });
      if (String(req.headers['x-participant-id'] || '') !== participant.id) return sendJson(res, 403, { error: 'Нельзя загрузить запись за другого участника.' });
      const sessionStart = clamp(req.headers['x-clip-start'], 0, 24 * 60 * 60);
      const duration = clamp(req.headers['x-clip-duration'], 0.05, 60 * 60);
      const contentType = String(req.headers['content-type'] || 'audio/webm');
      const ext = extensionFrom(contentType, 'clip.webm');
      const clipId = randomId(12);
      const target = path.join(roomDir(room.id), 'clips', `${clipId}${ext}`);
      await streamUpload(req, target, MAX_AUDIO_BYTES);
      const relative = path.relative(DATA_DIR, target).split(path.sep).join('/');
      const clip = {
        id: clipId,
        participantId: participant.id,
        start: sessionStart,
        duration,
        volume: 1,
        peaks: parsePeaks(req.headers['x-waveform']),
        url: `/media/${relative}`,
        mimeType: contentType,
        createdAt: now(),
        filePath: target,
      };
      room.clips.push(clip);
      resetReady(room); touch(room); broadcastRoom(room); broadcast(room, 'clip-created', clip);
      return sendJson(res, 201, { ok: true, clip });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/clips/:clipId');
    if (req.method === 'PATCH' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      const clip = room.clips.find((item) => item.id === params.clipId);
      if (!clip) return sendJson(res, 404, { error: 'Аудиоклип не найден.' });
      const actor = String(body.participantId || '');
      if (actor !== clip.participantId && !isHost(room, actor)) return sendJson(res, 403, { error: 'Можно менять только свою запись.' });
      const max = Math.max(clip.duration, Number(room.video?.duration) || 24 * 60 * 60);
      if ('start' in body) clip.start = clamp(body.start, 0, Math.max(0, max - 0.05));
      if ('volume' in body) clip.volume = clamp(body.volume, 0, 1);
      resetReady(room); touch(room); broadcastRoom(room);
      return sendJson(res, 200, { ok: true, clip });
    }

    if (req.method === 'DELETE' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      const index = room.clips.findIndex((item) => item.id === params.clipId);
      if (index < 0) return sendJson(res, 404, { error: 'Аудиоклип не найден.' });
      const clip = room.clips[index];
      const actor = String(body.participantId || '');
      if (actor !== clip.participantId && !isHost(room, actor)) return sendJson(res, 403, { error: 'Можно удалять только свою запись.' });
      room.clips.splice(index, 1);
      await fsp.rm(clip.filePath, { force: true }).catch(() => undefined);
      resetReady(room); touch(room); broadcastRoom(room);
      return sendJson(res, 200, { ok: true });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/preview');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId) || room.recording) return sendJson(res, 403, { error: 'Прослушку запускает ведущий вне записи.' });
      const payload = { previewAt: now() + 900, startTime: room.range.start, endTime: room.range.end };
      broadcast(room, 'mix-preview', payload);
      return sendJson(res, 200, { ok: true, ...payload });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/media/')) {
      const relative = decodeURIComponent(pathname.slice('/media/'.length));
      const target = path.resolve(DATA_DIR, relative);
      if (!target.startsWith(DATA_DIR + path.sep)) return sendJson(res, 403, { error: 'Недопустимый путь.' });
      return serveFile(req, res, target);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      const target = path.resolve(PUBLIC_DIR, relative);
      if (target.startsWith(PUBLIC_DIR + path.sep) || target === path.join(PUBLIC_DIR, 'index.html')) {
        try { const stat = await fsp.stat(target); if (stat.isFile()) return serveFile(req, res, target); } catch { /* fall through */ }
      }
      return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    }

    return sendJson(res, 404, { error: 'Не найдено.' });
  } catch (error) {
    console.error(error);
    if (res.headersSent) return res.end();
    if (error?.message === 'PAYLOAD_TOO_LARGE') return sendJson(res, 413, { error: 'Файл слишком большой.' });
    if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'Некорректный JSON.' });
    return sendJson(res, 500, { error: 'Внутренняя ошибка сервера.' });
  }
});

setInterval(() => {
  const cutoff = now() - ROOM_TTL_MS;
  for (const [id, room] of rooms) {
    if (room.updatedAt > cutoff) continue;
    if (room.recording?.timer) clearTimeout(room.recording.timer);
    for (const connections of room.sse.values()) for (const res of connections) res.end();
    rooms.delete(id);
    fsp.rm(roomDir(id), { recursive: true, force: true }).catch(() => undefined);
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`DubRoom запущен: http://localhost:${PORT}`));
