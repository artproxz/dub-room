import {
  fsp, path, DATA_DIR, PUBLIC_DIR, MAX_AUDIO_BYTES, now, sendJson, broadcast, readJson, extensionFrom, streamUpload,
  parseRoute, requireRoom, serveFile, touch, isHost, roomDir, randomId, clamp, parsePeaks,
} from './lib.js';
import { participantPublic, clipPublic, recordingPublic, setNotReady, allConnectedReady, stopParticipantRecording } from './v5-state.js';

export async function handleMediaRequest(req, res, url) {
  const { pathname } = url;
  let params = parseRoute(pathname, '/api/rooms/:roomId/recording/start');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    const participantId = String(body.participantId || '');
    const participant = room.participants.get(participantId);
    if (!participant) return sendJson(res, 403, { error: 'Не участник комнаты.' });
    if (!room.video) return sendJson(res, 409, { error: 'Сначала загрузите видео.' });
    if (room.recordings.has(participantId)) return sendJson(res, 409, { error: 'Ваша запись уже идёт.' });
    const requestedStart = Number(body.startTime);
    const startTime = Number.isFinite(requestedStart)
      ? clamp(requestedStart, room.range.start, Math.max(room.range.start, room.range.end - .05))
      : room.range.start;
    const endTime = room.range.end;
    const startAt = now();
    const stopAt = startAt + Math.max(100, (endTime - startTime) * 1000) + 1500;
    const requestedSessionId = String(body.sessionId || '');
    const sessionId = /^[A-Za-z0-9_-]{6,64}$/.test(requestedSessionId) ? requestedSessionId : randomId(10);
    const recording = { sessionId, participantId, startTime, endTime, startAt, stopAt };
    recording.timer = setTimeout(() => stopParticipantRecording(room, participantId, now(), endTime), Math.max(0, stopAt - now()));
    room.recordings.set(participantId, recording);
    participant.armed = true; participant.ready = false; touch(room);
    const payload = recordingPublic(recording);
    broadcast(room, 'recording-start', payload);
    broadcast(room, 'participant-patch', { participant: participantPublic(participant) });
    return sendJson(res, 200, { ok: true, ...payload });
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/recording/stop');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    const participantId = String(body.participantId || '');
    if (!room.participants.has(participantId)) return sendJson(res, 403, { error: 'Не участник комнаты.' });
    const requestedEnd = Number(body.endTime);
    const payload = stopParticipantRecording(room, participantId, now(), Number.isFinite(requestedEnd) ? requestedEnd : null);
    if (!payload) return sendJson(res, 409, { error: 'У вас нет активной записи.' });
    return sendJson(res, 200, { ok: true, ...payload });
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/sessions/:sessionId/clips/:participantId');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const participant = room.participants.get(params.participantId);
    if (!participant) return sendJson(res, 403, { error: 'Участник не найден.' });
    if (String(req.headers['x-participant-id'] || '') !== participant.id) return sendJson(res, 403, { error: 'Нельзя загрузить запись за другого участника.' });
    room.sessionClips ??= new Map();
    const sessionKey = `${participant.id}:${params.sessionId}`;
    const existingClipId = room.sessionClips.get(sessionKey);
    if (existingClipId) {
      const existing = room.clips.find((clip) => clip.id === existingClipId);
      if (existing) return sendJson(res, 200, { ok: true, clip: clipPublic(existing), duplicate: true });
      room.sessionClips.delete(sessionKey);
    }
    const rawStart = clamp(req.headers['x-clip-start'], 0, 24 * 60 * 60);
    const syncCompensationMs = clamp(req.headers['x-sync-comp-ms'], 0, 500);
    const start = Math.max(0, rawStart - syncCompensationMs / 1000);
    const duration = clamp(req.headers['x-clip-duration'], .05, 60 * 60);
    const contentType = String(req.headers['content-type'] || 'audio/webm');
    const ext = extensionFrom(contentType, 'clip.webm');
    const clipId = randomId(12);
    const target = path.join(roomDir(room.id), 'clips', `${clipId}${ext}`);
    await streamUpload(req, target, MAX_AUDIO_BYTES);
    const relative = path.relative(DATA_DIR, target).split(path.sep).join('/');
    const clip = {
      id: clipId, participantId: participant.id, start, duration, sourceDuration: duration, offset: 0, syncCompensationMs, volume: 1,
      peaks: parsePeaks(req.headers['x-waveform']), url: `/media/${relative}`, mimeType: contentType,
      createdAt: now(), filePath: target, editSeq: 0,
    };
    room.clips.push(clip); room.sessionClips.set(sessionKey, clip.id); setNotReady(room, participant.id); touch(room);
    broadcast(room, 'clip-created', { clip: clipPublic(clip), participant: participantPublic(participant) });
    return sendJson(res, 201, { ok: true, clip: clipPublic(clip) });
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/clips/:clipId');
  if (req.method === 'PATCH' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    const clip = room.clips.find((x) => x.id === params.clipId);
    if (!clip) return sendJson(res, 404, { error: 'Аудиоклип не найден.' });
    const actor = String(body.participantId || '');
    if (actor !== clip.participantId) return sendJson(res, 403, { error: 'Можно менять только свою запись.' });
    const seq = Number(body.seq);
    if (Number.isFinite(seq) && seq < (clip.editSeq || 0)) return sendJson(res, 200, { ok: true, clip: clipPublic(clip), stale: true });
    if (Number.isFinite(seq)) clip.editSeq = seq;
    const sourceDuration = Math.max(.05, Number(clip.sourceDuration) || Number(clip.duration) || .05);
    clip.sourceDuration = sourceDuration; clip.offset = clamp(clip.offset ?? 0, 0, Math.max(0, sourceDuration - .05));
    const max = Math.max(sourceDuration, Number(room.video?.duration) || 24 * 60 * 60);
    if ('start' in body) clip.start = clamp(body.start, 0, Math.max(0, max - .05));
    if ('offset' in body) clip.offset = clamp(body.offset, 0, Math.max(0, sourceDuration - .05));
    if ('duration' in body) clip.duration = clamp(body.duration, .05, Math.max(.05, sourceDuration - clip.offset));
    else clip.duration = clamp(clip.duration, .05, Math.max(.05, sourceDuration - clip.offset));
    if ('volume' in body) clip.volume = clamp(body.volume, 0, 1);
    setNotReady(room, actor); touch(room);
    const participant = room.participants.get(actor);
    broadcast(room, 'clip-patch', { clip: clipPublic(clip), participant: participantPublic(participant) }, actor);
    return sendJson(res, 200, { ok: true, clip: clipPublic(clip) });
  }
  if (req.method === 'DELETE' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    const index = room.clips.findIndex((x) => x.id === params.clipId);
    if (index < 0) return sendJson(res, 404, { error: 'Аудиоклип не найден.' });
    const clip = room.clips[index], actor = String(body.participantId || '');
    if (actor !== clip.participantId) return sendJson(res, 403, { error: 'Можно удалять только свою запись.' });
    room.clips.splice(index, 1);
    await fsp.rm(clip.filePath, { force: true }).catch(() => undefined);
    setNotReady(room, actor); touch(room);
    const participant = room.participants.get(actor);
    broadcast(room, 'clip-delete', { clipId: clip.id, participantId: actor, participant: participantPublic(participant) }, actor);
    return sendJson(res, 200, { ok: true });
  }

  params = parseRoute(pathname, '/api/rooms/:roomId/preview/start');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return;
    const body = await readJson(req);
    if (!isHost(room, String(body.participantId || ''))) return sendJson(res, 403, { error: 'Итог запускает ведущий.' });
    if (room.recordings.size) return sendJson(res, 409, { error: 'Кто-то ещё записывается.' });
    if (!allConnectedReady(room)) return sendJson(res, 409, { error: 'Не все участники готовы.' });
    const payload = { previewAt: now() + 350, startTime: room.range.start, endTime: room.range.end };
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
      try { const stat = await fsp.stat(target); if (stat.isFile()) return serveFile(req, res, target); } catch {}
    }
    return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
  }
  return sendJson(res, 404, { error: 'Не найдено.' });
}
