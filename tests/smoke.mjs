import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = 3217;
const base = `http://127.0.0.1:${PORT}`;
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dubroom-smoke-'));
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForHealth() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}

async function json(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

try {
  await waitForHealth();

  let result = await json(`${base}/api/rooms`, {
    method: 'POST',
    body: JSON.stringify({ participantId: 'u1', name: 'Dima' }),
  });
  assert.equal(result.res.status, 201);
  const roomId = result.body.room.id;

  for (const [id, name] of [['u2', 'Lena'], ['u3', 'Max']]) {
    result = await json(`${base}/api/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({ participantId: id, name }),
    });
    assert.equal(result.res.status, 200);
  }

  result = await json(`${base}/api/rooms/${roomId}/join`, {
    method: 'POST',
    body: JSON.stringify({ participantId: 'u4', name: 'Fourth' }),
  });
  assert.equal(result.res.status, 409);

  let res = await fetch(`${base}/api/rooms/${roomId}/video`, {
    method: 'POST',
    headers: {
      'content-type': 'video/mp4',
      'x-participant-id': 'u1',
      'x-file-name': 'demo.mp4',
    },
    body: Buffer.from('fake-video'),
  });
  assert.equal(res.status, 200);
  const uploadedVideo = await res.json();

  res = await fetch(`${base}${uploadedVideo.url}`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('content-length'), String(Buffer.byteLength('fake-video')));

  res = await fetch(`${base}${uploadedVideo.url}`, { headers: { range: 'bytes=0-3' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-3/${Buffer.byteLength('fake-video')}`);
  assert.equal(await res.text(), 'fake');

  res = await fetch(`${base}${uploadedVideo.url}`, { headers: { range: 'bytes=-5' } });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), 'video');

  result = await json(`${base}/api/rooms/${roomId}/recording/start`, {
    method: 'POST',
    body: JSON.stringify({ participantId: 'u1', startTime: 10.5 }),
  });
  assert.equal(result.res.status, 200);
  const takeId = result.body.takeId;

  result = await json(`${base}/api/rooms/${roomId}/recording/stop`, {
    method: 'POST',
    body: JSON.stringify({ participantId: 'u1' }),
  });
  assert.equal(result.res.status, 200);

  for (const id of ['u1', 'u2', 'u3']) {
    res = await fetch(`${base}/api/rooms/${roomId}/takes/${takeId}/tracks/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'audio/webm' },
      body: Buffer.from(`audio-${id}`),
    });
    assert.equal(res.status, 200);
  }

  result = await json(`${base}/api/rooms/${roomId}/state`);
  assert.equal(result.res.status, 200);
  assert.equal(result.body.takes.length, 1);
  assert.equal(result.body.takes[0].tracks.length, 3);
  assert.equal(result.body.selectedTakeId, takeId);

  console.log('✓ DubRoom smoke test passed');
} finally {
  child.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
}