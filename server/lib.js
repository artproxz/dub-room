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
const DEFAULT_COLORS = ['#ff405f', '#ff405f', '#ff405f'];

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

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function sanitizeColor(value, fallback = DEFAULT_COLORS[0]) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function participantPublic(participant) {
  return {
    id: participant.id,
    name: participant.name,
    connected: participant.connected,
    color: participant.color,
    armed: Boolean(participant.armed),
    ready: Boolean(participant.ready),
  };
}

function clipPublic(clip) {
  return {
    id: clip.id,
    participantId: clip.participantId,
    start: clip.start,
    duration: clip.duration,
    volume: clip.volume,
    peaks: clip.peaks,
    url: clip.url,
    mimeType: clip.mimeType,
    createdAt: clip.createdAt,
  };
}

function publicRoom(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    hostParticipantId: room.hostParticipantId,
    participants: [...room.participants.values()].map(participantPublic),
    video: room.video,
    player: room.player,
    range: room.range,
    clips: room.clips.map(clipPublic),
    recording: room.recording ? {
      sessionId: room.recording.sessionId,
      startTime: room.recording.startTime,
      endTime: room.recording.endTime,
      startAt: room.recording.startAt,
      stopAt: room.recording.stopAt,
      armedParticipantIds: room.recording.armedParticipantIds,
    } : undefined,
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
      try { sendSse(res, event, data); } catch { /* connection closing */ }
    }
  }
}

function broadcastRoom(room) { broadcast(room, 'room-state', publicRoom(room)); }

async function readJson(req, limit = 96 * 1024) {
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
  return String(name).replace(/[^a-zA-Z0-9а-яА-ЯёЁ._ -]/g, '_').slice(0, 180) || 'file';
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

function resetReady(room) {
  for (const participant of room.participants.values()) participant.ready = false;
}

function parsePeaks(header) {
  if (!header) return [];
  const values = String(header).split(',').slice(0, 220);
  return values.map((value) => clamp(Number(value) / 100, 0, 1));
}

async function serveFile(req, res, filePath, contentType = null) {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { sendJson(res, 404, { error: 'Файл не найден.' }); return; }
  if (!stat.isFile()) return sendJson(res, 404, { error: 'Файл не найден.' });

  const ext = path.extname(filePath).toLowerCase();
  const mime = contentType || ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.mp4': 'video/mp4',
    '.webm': filePath.includes(`${path.sep}clips${path.sep}`) ? 'audio/webm' : 'video/webm',
    '.ogg': 'audio/ogg',
    '.mov': 'video/quicktime',
  }[ext] || 'application/octet-stream');

  const common = {
    'content-type': mime,
    'accept-ranges': 'bytes',
    'cache-control': ['.html', '.js', '.css'].includes(ext) ? 'no-store' : 'private, max-age=3600',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...common, 'content-length': stat.size });
    res.end();
    return;
  }

  const range = req.headers.range;
  if (range && stat.size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (match) {
      let start;
      let end;
      if (!match[1] && match[2]) {
        const suffix = Math.max(0, Number(match[2]) || 0);
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      } else {
        start = match[1] ? Number(match[1]) : 0;
        end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...common,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'content-length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, { ...common, 'content-length': stat.size });
  fs.createReadStream(filePath).pipe(res);
}

export {
  http, fsp, path, DATA_DIR, PUBLIC_DIR, PORT, ROOM_TTL_MS, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, DEFAULT_COLORS, rooms,
  now, makeRoomCode, publicRoom, sendJson, sendSse, broadcast, broadcastRoom, readJson, safeFileName,
  extensionFrom, streamUpload, parseRoute, requireRoom, serveFile, touch, isHost, roomDir, randomId,
  clamp, sanitizeColor, resetReady, parsePeaks,
};
