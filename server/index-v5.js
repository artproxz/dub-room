import { http, fsp, PORT, ROOM_TTL_MS, rooms, now, roomDir, sendJson } from './lib.js';
import { handleRoomRequest } from './v5-room-routes.js';
import { handleMediaRequest } from './v5-media-routes.js';
import { handleV9PreviewRequest } from './v9-preview-routes.js';
import { handleV10PartyRequest } from './v10-party-routes.js';
import { handleV13StageSyncRequest } from './v13-stage-sync-routes.js';

const ROOM_ROUTE = /^\/api\/rooms\/[^/]+\/(join|state|events|participant|level|signal|range|video|video-meta)$/;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (await handleV13StageSyncRequest(req, res, url)) return;
    if (await handleV10PartyRequest(req, res, url)) return;
    const roomRoute = url.pathname === '/api/health' || url.pathname === '/api/rooms' || ROOM_ROUTE.test(url.pathname);
    if (roomRoute) return await handleRoomRequest(req, res, url);
    if (await handleV9PreviewRequest(req, res, url)) return;
    return await handleMediaRequest(req, res, url);
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
    for (const r of room.recordings.values()) if (r.timer) clearTimeout(r.timer);
    if (room.party?.phaseTimer) clearTimeout(room.party.phaseTimer);
    if (room.party?.finalTimer) clearTimeout(room.party.finalTimer);
    for (const connections of room.sse.values()) for (const res of connections) res.end();
    rooms.delete(id);
    fsp.rm(roomDir(id), { recursive: true, force: true }).catch(() => undefined);
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`DubRoom 1.2.1 staged party flow: http://localhost:${PORT}`));