import { now, sendJson, broadcast, readJson, parseRoute, requireRoom, isHost, clamp } from './lib.js';
import { allConnectedReady } from './v5-state.js';

export async function handleV9PreviewRequest(req, res, url) {
  const params = parseRoute(url.pathname, '/api/rooms/:roomId/preview/control');
  if (req.method !== 'POST' || !params) return false;
  const room = requireRoom(params.roomId, res); if (!room) return true;
  const body = await readJson(req);
  if (!isHost(room, String(body.participantId || ''))) { sendJson(res, 403, { error: 'Итоговым просмотром управляет ведущий.' }); return true; }
  const action = String(body.action || '');
  if (!['play','pause'].includes(action)) { sendJson(res, 400, { error: 'Неизвестная команда транспорта.' }); return true; }
  if (action === 'play') {
    if (room.recordings.size) { sendJson(res, 409, { error: 'Кто-то ещё записывается.' }); return true; }
    if (!allConnectedReady(room)) { sendJson(res, 409, { error: 'Не все участники готовы.' }); return true; }
  }
  const maxTime = Math.max(room.range.start, room.range.end - .02);
  const currentTime = clamp(body.currentTime, room.range.start, maxTime);
  const payload = { action, currentTime, effectiveAt: now() + 90, startTime: room.range.start, endTime: room.range.end };
  broadcast(room, 'mix-preview-control', payload);
  sendJson(res, 200, { ok: true, ...payload });
  return true;
}
