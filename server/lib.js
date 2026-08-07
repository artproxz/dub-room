import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT ?? 3001);
const ROOM_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_AUDIO_BYTES = 250 * 1024 * 1024;

await fsp.mkdir(DATA_DIR, { recursive: true });

const rooms = new Map();

function now() { return Date.now(); }
function normalizeRoomId(value = '') { return String(value).trim().toUpperCase(); }
function roomDir(roomId) { return path.join(DATA_DIR, roomId); }
function touch(room) { room.updatedAt = now(); }
function isHost(room, participantId) { return room.hostParticipantId === participantId; }
function randomId(length = 10) { return crypto.randomBytes(Math.ceil(length * 0.75)).toString('base64url').slice(0, length); }
function makeRoomCode() {
  let code;
  do code = randomId(6).replace(/[-_]/g, 'A').toUpperCase(); while (rooms.has(code));
  return code;
}

function publicRoom(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    hostParticipantId: room.hostParticipantId,
    participants: [...room.participants.values()].map(({ id, name, connected }) => ({ id, name, connected })),
    video: room.video,
    player: room.player,
    recording: room.recording ? {
      takeId: room.recording.takeId,
      startTime: room.recording.startTime,
      startAt: room.recording.startAt,
      stopAt: room.recording.stopAt,
    } : undefined,
    takes: room.takes,
    selectedTakeId: room.selectedTakeId,
  };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room, event, data, exceptParticipantId = null) {
  for (const [participantId, connections] of room.sse.entries()) {
    if (participantId === exceptParticipantId) continue;
    for (const res of connections) {
      try { sendSse(res, event, data); } catch { /* connection is closing */ }
    }
  }
}

function broadcastRoom(room) {
  broadcast(room, 'room-state', publicRoom(room));
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeFileName(name = '') {
  return name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._ -]/g, '_').slice(0, 180) || 'video';
}

function extensionFrom(contentType = '', fileName = '') {
  if (contentType.includes('webm')) return '.webm';
  if (contentType.includes('ogg')) return '.ogg';
  if (contentType.includes('mp4')) return '.mp4';
  if (contentType.includes('quicktime')) return '.mov';
  return path.extname(fileName).slice(0, 8) || '.bin';
}

async function streamUpload(req, destination, maxBytes) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared && declared > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.uploading-${randomId(6)}`;
  const output = fs.createWriteStream(temp, { flags: 'wx' });
  let total = 0;
  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > maxBytes) req.destroy(new Error('PAYLOAD_TOO_LARGE'));
  });
  try {
    await pipeline(req, output);
    await fsp.rename(temp, destination);
    return total;
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function parseRoute(pathname, pattern) {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    const actual = decodeURIComponent(pathParts[i]);
    if (expected.startsWith(':')) params[expected.slice(1)] = actual;
    else if (expected !== actual) return null;
  }
  return params;
}

function requireRoom(roomId, res) {
  const room = rooms.get(normalizeRoomId(roomId));
  if (!room) sendJson(res, 404, { error: 'Комната не найдена или уже удалена.' });
  return room;
}

function stopRecording(room, stopAt) {
  const recording = room.recording;
  if (!recording) return;
  if (recording.timer) clearTimeout(recording.timer);
  const endTime = recording.startTime + Math.max(0, stopAt - recording.startAt) / 1000;
  room.pendingTake = {
    id: recording.takeId,
    startTime: recording.startTime,
    endTime,
    expectedParticipantIds: recording.expectedParticipantIds,
    tracks: new Map(),
  };
  room.recording = undefined;
  room.player = { currentTime: endTime, playing: false };
  touch(room);
  broadcastRoom(room);
  broadcast(room, 'recording-stop', {
    takeId: room.pendingTake.id,
    stopAt,
    startTime: room.pendingTake.startTime,
    endTime: room.pendingTake.endTime,
  });
}

async function serveFile(req, res, filePath, contentType = null) {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { sendJson(res, 404, { error: 'Файл не найден.' }); return; }
  if (!stat.isFile()) { sendJson(res, 404, { error: 'Файл не найден.' }); return; }

  const ext = path.extname(filePath).toLowerCase();
  const mime = contentType || ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.mp4': 'video/mp4',
    '.webm': filePath.includes(`${path.sep}takes${path.sep}`) ? 'audio/webm' : 'video/webm',
    '.ogg': 'audio/ogg',
    '.mov': 'video/quicktime',
  }[ext] || 'application/octet-stream');

  const baseHeaders = {
    'content-type': mime,
    'accept-ranges': 'bytes',
    'cache-control': ext === '.html' ? 'no-store' : 'private, max-age=3600',
    'last-modified': stat.mtime.toUTCString(),
  };

  const range = req.headers.range;
  if (range && stat.size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { ...baseHeaders, 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }

    let start;
    let end;
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        res.writeHead(416, { ...baseHeaders, 'content-range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      start = Math.max(0, stat.size - suffixLength);
      end = stat.size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
      res.writeHead(416, { ...baseHeaders, 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }

    const headers = {
      ...baseHeaders,
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'content-length': end - start + 1,
    };
    res.writeHead(206, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'content-length': stat.size });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(filePath).pipe(res);
}


export {
  http, fsp, path, DATA_DIR, PUBLIC_DIR, PORT, ROOM_TTL_MS, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, rooms,
  now, makeRoomCode, publicRoom, sendJson, sendSse, broadcast, broadcastRoom, readJson, safeFileName,
  extensionFrom, streamUpload, parseRoute, requireRoom, stopRecording, serveFile, touch, isHost, roomDir, randomId,
};