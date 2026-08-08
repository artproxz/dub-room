import { broadcast, clamp, isHost, now, parseRoute, readJson, requireRoom, sendJson, touch } from './lib.js';
import { ensureParty } from './v5-state.js';

export async function handleV13StageSyncRequest(req, res, url) {
  const params = parseRoute(url.pathname, '/api/rooms/:roomId/stage/player');
  if (req.method !== 'POST' || !params) return false;

  const room = requireRoom(params.roomId, res);
  if (!room) return true;
  const body = await readJson(req);
  const participantId = String(body.participantId || '');
  if (!isHost(room, participantId)) {
    sendJson(res, 403, { error: 'Навигацией по фильму управляет ведущий.' });
    return true;
  }
  const party = ensureParty(room);
  if (party.phase !== 'lobby') {
    sendJson(res, 409, { error: 'Общая навигация доступна только на этапе выбора сцены.' });
    return true;
  }
  if (!room.video) {
    sendJson(res, 409, { error: 'Сначала загрузите фильм.' });
    return true;
  }

  const max = Math.max(.1, Number(room.video.duration) || 24 * 60 * 60);
  const currentTime = clamp(body.currentTime, 0, max);
  const seq = Math.max(0, Number(room.player?.seq) || 0) + 1;
  room.player = {
    currentTime,
    playing: Boolean(body.playing),
    updatedAt: now(),
    seq,
  };
  touch(room);
  const payload = { ...room.player };
  broadcast(room, 'stage-player', payload, participantId);
  sendJson(res, 200, { ok: true, player: payload });
  return true;
}
