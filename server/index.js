import {
  http, fsp, path, DATA_DIR, PUBLIC_DIR, PORT, ROOM_TTL_MS, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, rooms,
  now, makeRoomCode, publicRoom, sendJson, sendSse, broadcast, broadcastRoom, readJson, safeFileName,
  extensionFrom, streamUpload, parseRoute, requireRoom, stopRecording, serveFile, touch, isHost, roomDir, randomId,
} from './lib.js';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, rooms: rooms.size });
    }

    if (req.method === 'POST' && pathname === '/api/rooms') {
      const body = await readJson(req);
      const participantId = String(body.participantId || '').slice(0, 64);
      const name = String(body.name || 'Участник').trim().slice(0, 32);
      if (!participantId) return sendJson(res, 400, { error: 'Нет participantId.' });
      const id = makeRoomCode();
      const participant = { id: participantId, name, connected: true };
      const room = {
        id,
        createdAt: now(),
        updatedAt: now(),
        hostParticipantId: participantId,
        participants: new Map([[participantId, participant]]),
        sse: new Map(),
        player: { currentTime: 0, playing: false },
        takes: [],
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
      room.participants.set(participantId, { id: participantId, name, connected: true });
      touch(room);
      broadcastRoom(room);
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
      list.add(res);
      room.sse.set(participantId, list);
      sendSse(res, 'room-state', publicRoom(room));
      broadcastRoom(room);
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(heartbeat);
        list.delete(res);
        if (!list.size) {
          room.sse.delete(participantId);
          setTimeout(() => {
            if (room.sse.has(participantId)) return;
            const p = room.participants.get(participantId);
            if (p) p.connected = false;
            broadcastRoom(room);
          }, 3000).unref();
        }
      });
      return;
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/level');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      const participantId = String(body.participantId || '');
      if (!room.participants.has(participantId)) return sendJson(res, 403, { error: 'Не участник комнаты.' });
      const level = Math.max(0, Math.min(1, Number(body.level) || 0));
      broadcast(room, 'participant-level', { participantId, level }, participantId);
      res.writeHead(204); res.end(); return;
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/player');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId) || room.recording) return sendJson(res, 403, { error: 'Недоступно.' });
      room.player = { currentTime: Math.max(0, Number(body.currentTime) || 0), playing: Boolean(body.playing) };
      touch(room);
      broadcast(room, 'player-state', room.player, body.participantId);
      return sendJson(res, 200, { ok: true });
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
      room.video = { url: `/media/${relative}`, originalName, size };
      room.player = { currentTime: 0, playing: false };
      touch(room);
      broadcastRoom(room);
      broadcast(room, 'video-ready', room.video);
      return sendJson(res, 200, room.video);
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/recording/start');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId)) return sendJson(res, 403, { error: 'Запись запускает только ведущий.' });
      if (!room.video) return sendJson(res, 409, { error: 'Сначала загрузите видео.' });
      if (room.recording || room.pendingTake) return sendJson(res, 409, { error: 'Предыдущий дубль ещё записывается или загружается.' });
      const connected = [...room.participants.values()].filter((p) => p.connected);
      if (!connected.length) return sendJson(res, 409, { error: 'Нет участников для записи.' });
      const startAt = now() + 3500;
      const takeId = randomId(10);
      const duration = Number(body.autoStopAfterMs);
      room.recording = {
        takeId,
        startTime: Math.max(0, Number(body.startTime) || 0),
        startAt,
        expectedParticipantIds: connected.map((p) => p.id),
        stopAt: Number.isFinite(duration) && duration > 200 ? startAt + duration : undefined,
      };
      if (room.recording.stopAt) {
        const stopAt = room.recording.stopAt;
        room.recording.timer = setTimeout(() => stopRecording(room, stopAt), Math.max(0, stopAt - now()));
      }
      touch(room);
      const payload = {
        takeId,
        startTime: room.recording.startTime,
        startAt,
        stopAt: room.recording.stopAt,
        participantIds: room.recording.expectedParticipantIds,
      };
      broadcastRoom(room);
      broadcast(room, 'recording-countdown', payload);
      return sendJson(res, 200, { ok: true, ...payload });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/recording/stop');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!room.recording) return sendJson(res, 409, { error: 'Активной записи нет.' });
      if (!isHost(room, body.participantId)) return sendJson(res, 403, { error: 'Остановить запись может только ведущий.' });
      const stopAt = now() + 400;
      stopRecording(room, stopAt);
      return sendJson(res, 200, { ok: true, stopAt });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/takes/:takeId/tracks/:participantId');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const pending = room.pendingTake;
      if (!pending || pending.id !== params.takeId) return sendJson(res, 409, { error: 'Дубль уже закрыт или неизвестен.' });
      if (!pending.expectedParticipantIds.includes(params.participantId)) return sendJson(res, 403, { error: 'Участник не входил в этот дубль.' });
      const contentType = String(req.headers['content-type'] || 'audio/webm');
      const ext = extensionFrom(contentType, 'track.webm');
      const target = path.join(roomDir(room.id), 'takes', params.takeId, `${safeFileName(params.participantId)}${ext}`);
      await streamUpload(req, target, MAX_AUDIO_BYTES);
      const relative = path.relative(DATA_DIR, target).split(path.sep).join('/');
      pending.tracks.set(params.participantId, { participantId: params.participantId, url: `/media/${relative}`, mimeType: contentType });
      touch(room);
      broadcast(room, 'take-upload-progress', { takeId: pending.id, uploaded: pending.tracks.size, expected: pending.expectedParticipantIds.length });
      if (pending.tracks.size >= pending.expectedParticipantIds.length) {
        const take = { id: pending.id, startTime: pending.startTime, endTime: pending.endTime, createdAt: now(), tracks: [...pending.tracks.values()] };
        room.takes.push(take);
        room.selectedTakeId = take.id;
        room.pendingTake = undefined;
        broadcastRoom(room);
        broadcast(room, 'take-ready', { ...take, previewAt: now() + 1000 });
      }
      return sendJson(res, 200, { ok: true });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/takes/:takeId/select');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId)) return sendJson(res, 403, { error: 'Только ведущий.' });
      if (!room.takes.some((take) => take.id === params.takeId)) return sendJson(res, 404, { error: 'Дубль не найден.' });
      room.selectedTakeId = params.takeId;
      touch(room);
      broadcastRoom(room);
      return sendJson(res, 200, { ok: true });
    }

    params = parseRoute(pathname, '/api/rooms/:roomId/takes/:takeId/preview');
    if (req.method === 'POST' && params) {
      const room = requireRoom(params.roomId, res); if (!room) return;
      const body = await readJson(req);
      if (!isHost(room, body.participantId)) return sendJson(res, 403, { error: 'Только ведущий.' });
      const take = room.takes.find((item) => item.id === params.takeId);
      if (!take) return sendJson(res, 404, { error: 'Дубль не найден.' });
      broadcast(room, 'preview-take', { ...take, previewAt: now() + 850 });
      return sendJson(res, 200, { ok: true });
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
        try {
          const stat = await fsp.stat(target);
          if (stat.isFile()) return serveFile(req, res, target);
        } catch { /* fall through */ }
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DubRoom запущен: http://localhost:${PORT}`);
});