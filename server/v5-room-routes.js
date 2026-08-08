import {
  fsp, path, DATA_DIR, MAX_VIDEO_BYTES, rooms, now, makeRoomCode, sendJson, sendSse, broadcast, readJson, safeFileName,
  extensionFrom, streamUpload, parseRoute, requireRoom, touch, isHost, roomDir, clamp, sanitizeColor, resetReady,
} from './lib.js';
import { PARTICIPANT_COLORS, participantPublic, roomSnapshot, broadcastSnapshot, sendToParticipant } from './v5-state.js';

export async function handleRoomRequest(req, res, url) {
  const { pathname } = url;
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, rooms: rooms.size, version: '0.5.0' });
  }

  if (req.method === 'POST' && pathname === '/api/rooms') {
    const body = await readJson(req);
    const participantId = String(body.participantId || '').slice(0, 64);
    const name = String(body.name || 'Участник').trim().slice(0, 32);
    if (!participantId) return sendJson(res, 400, { error: 'Нет participantId.' });
    const id = makeRoomCode();
    const participant = {
      id: participantId, name, connected: true, color: PARTICIPANT_COLORS[0], armed: false, ready: false, role: '',
    };
    const room = {
      id, createdAt: now(), updatedAt: now(), hostParticipantId: participantId,
      participants: new Map([[participantId, participant]]),
      sse: new Map(), player: { currentTime: 0, playing: false }, range: { start: 0, end: 30 },
      clips: [], recordings: new Map(), pendingSignals: new Map(),
    };
    rooms.set(id, room);
    return sendJson(res, 201, { ok: true, room: roomSnapshot(room) });
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
      color: existing?.color || PARTICIPANT_COLORS[index] || PARTICIPANT_COLORS[0],
      armed: existing?.armed ?? false,
      ready: false,
      role: existing?.role || '',
    });
    touch(room);
    broadcastSnapshot(room);
    return sendJson(res, 200, { ok: true, room: roomSnapshot(room) });
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/state');
  if (req.method === 'GET' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    return sendJson(res, 200, roomSnapshot(room));
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
    res.write('retry: 900\n\n');
    const list = room.sse.get(participantId) ?? new Set();
    list.add(res); room.sse.set(participantId, list);
    sendSse(res, 'room-state', roomSnapshot(room));
    const queued = room.pendingSignals.get(participantId) || [];
    for (const item of queued) sendSse(res, item.event, item.data);
    room.pendingSignals.delete(participantId);
    broadcast(room, 'participant-patch', { participant: participantPublic(participant) }, participantId);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 12000);
    req.on('close', () => {
      clearInterval(heartbeat); list.delete(res);
      if (!list.size) {
        room.sse.delete(participantId);
        setTimeout(() => {
          if (room.sse.has(participantId)) return;
          const p = room.participants.get(participantId);
          if (p) { p.connected = false; p.ready = false; }
          broadcastSnapshot(room);
        }, 1800).unref();
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
    if ('role' in body) { participant.role = String(body.role || '').trim().slice(0, 40); participant.ready = false; }
    if ('ready' in body) {
      if (room.recordings.has(participant.id)) return sendJson(res, 409, { error: 'Сначала завершите свою запись.' });
      participant.ready = Boolean(body.ready);
    }
    touch(room);
    const payload = { participant: participantPublic(participant) };
    broadcast(room, 'participant-patch', payload);
    return sendJson(res, 200, { ok: true, ...payload });
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/level');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    const participantId = String(body.participantId || '');
    if (!room.participants.has(participantId)) return sendJson(res, 403, { error: 'Не участник комнаты.' });
    broadcast(room, 'participant-level', { participantId, level: clamp(body.level, 0, 1) }, participantId);
    res.writeHead(204); res.end(); return;
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/signal');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    const from = String(body.participantId || '');
    const targetId = String(body.targetId || '');
    if (!room.participants.has(from) || !room.participants.has(targetId) || from === targetId) {
      return sendJson(res, 403, { error: 'Некорректный WebRTC-сигнал.' });
    }
    const type = String(body.type || '');
    if (!['offer', 'answer', 'ice'].includes(type)) return sendJson(res, 400, { error: 'Неизвестный тип сигнала.' });
    sendToParticipant(room, targetId, 'rtc-signal', { from, type, payload: body.payload ?? null });
    res.writeHead(204); res.end(); return;
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/range');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    if (!isHost(room, body.participantId) || room.recordings.size) {
      return sendJson(res, 403, { error: 'Общий фрагмент меняет ведущий, когда никто не записывается.' });
    }
    const max = Math.max(.1, Number(room.video?.duration) || 24 * 60 * 60);
    let start = clamp(body.start, 0, max), end = clamp(body.end, 0, max);
    if (end < start) [start, end] = [end, start];
    if (end - start < .1) end = Math.min(max, start + .1);
    room.range = { start, end };
    resetReady(room); touch(room);
    broadcast(room, 'range-patch', { range: room.range });
    broadcastSnapshot(room);
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
    room.range = { start: 0, end: 30 }; room.clips = []; resetReady(room); touch(room);
    broadcastSnapshot(room);
    return sendJson(res, 200, room.video);
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/video-meta');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    if (!isHost(room, body.participantId) || !room.video) return sendJson(res, 403, { error: 'Недоступно.' });
    const duration = clamp(body.duration, .1, 24 * 60 * 60);
    room.video.duration = duration;
    room.range.end = Math.min(Math.max(room.range.start + .1, room.range.end), duration);
    touch(room); broadcastSnapshot(room);
    return sendJson(res, 200, { ok: true, duration });
  }
  return sendJson(res, 404, { error: 'Не найдено.' });
}
