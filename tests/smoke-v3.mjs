import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = 3217;
const base = `http://127.0.0.1:${PORT}`;
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dubroom-ux-smoke-'));
const child = spawn(process.execPath, ['server/index-v3.js'], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try { const res = await fetch(`${base}/api/health`); if (res.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('Server did not start');
}
async function json(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({})); return { res, body };
}

try {
  await waitForHealth();
  let result = await json(`${base}/api/rooms`, { method:'POST', body:JSON.stringify({ participantId:'u1', name:'Dima' }) });
  assert.equal(result.res.status, 201); const roomId = result.body.room.id;
  for (const [id,name] of [['u2','Lena'],['u3','Max']]) {
    result = await json(`${base}/api/rooms/${roomId}/join`, { method:'POST', body:JSON.stringify({ participantId:id, name }) });
    assert.equal(result.res.status, 200);
  }
  result = await json(`${base}/api/rooms/${roomId}/join`, { method:'POST', body:JSON.stringify({ participantId:'u4', name:'Fourth' }) });
  assert.equal(result.res.status, 409);

  result = await json(`${base}/api/rooms/${roomId}/participant`, { method:'POST', body:JSON.stringify({ participantId:'u2', armed:false, color:'#123456' }) });
  assert.equal(result.res.status, 200);

  const fakeVideo = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  let res = await fetch(`${base}/api/rooms/${roomId}/video`, {
    method:'POST', headers:{'content-type':'video/mp4','x-participant-id':'u1','x-file-name':'demo.mp4'}, body:fakeVideo,
  });
  assert.equal(res.status, 200); const video = await res.json();
  result = await json(`${base}/api/rooms/${roomId}/video-meta`, { method:'POST', body:JSON.stringify({ participantId:'u1', duration:120 }) });
  assert.equal(result.res.status, 200);
  result = await json(`${base}/api/rooms/${roomId}/range`, { method:'POST', body:JSON.stringify({ participantId:'u1', start:10, end:18 }) });
  assert.deepEqual(result.body.range, { start:10, end:18 });

  res = await fetch(`${base}${video.url}`, { headers:{ range:'bytes=0-3' } });
  assert.equal(res.status,206); assert.equal(await res.text(),'0123');
  res = await fetch(`${base}${video.url}`, { headers:{ range:'bytes=-5' } });
  assert.equal(res.status,206); assert.equal(await res.text(),'VWXYZ');
  res = await fetch(`${base}${video.url}`, { method:'HEAD' });
  assert.equal(res.status,200); assert.equal(Number(res.headers.get('content-length')), fakeVideo.length);

  const one = await json(`${base}/api/rooms/${roomId}/recording/start`, { method:'POST', body:JSON.stringify({ participantId:'u1' }) });
  const two = await json(`${base}/api/rooms/${roomId}/recording/start`, { method:'POST', body:JSON.stringify({ participantId:'u2' }) });
  assert.equal(one.res.status,200); assert.equal(two.res.status,200);
  assert.equal(one.body.startTime,10); assert.equal(two.body.startTime,10);
  result = await json(`${base}/api/rooms/${roomId}/state`);
  assert.equal(result.body.recordings.length,2);
  assert.deepEqual(result.body.recordings.map(r=>r.participantId).sort(), ['u1','u2']);

  result = await json(`${base}/api/rooms/${roomId}/recording/stop`, { method:'POST', body:JSON.stringify({ participantId:'u1' }) });
  assert.equal(result.res.status,200);
  result = await json(`${base}/api/rooms/${roomId}/state`);
  assert.equal(result.body.recordings.length,1); assert.equal(result.body.recordings[0].participantId,'u2');
  result = await json(`${base}/api/rooms/${roomId}/recording/stop`, { method:'POST', body:JSON.stringify({ participantId:'u2' }) });
  assert.equal(result.res.status,200);

  res = await fetch(`${base}/api/rooms/${roomId}/sessions/${one.body.sessionId}/clips/u1`, {
    method:'POST', headers:{'content-type':'audio/webm','x-participant-id':'u1','x-clip-start':'10','x-clip-duration':'2.5','x-waveform':'10,20,90,30'}, body:Buffer.from('audio-u1'),
  });
  assert.equal(res.status,201); const clip = (await res.json()).clip;
  assert.equal(clip.start,10); assert.equal(clip.volume,1); assert.equal(clip.peaks[2],0.9);

  result = await json(`${base}/api/rooms/${roomId}/clips/${clip.id}`, { method:'PATCH', body:JSON.stringify({ participantId:'u1', start:11.25, volume:0.42 }) });
  assert.equal(result.res.status,200); assert.equal(result.body.clip.start,11.25); assert.equal(result.body.clip.volume,0.42);

  result = await json(`${base}/api/rooms/${roomId}/state`);
  assert.equal(result.body.clips.length,1); assert.equal(result.body.participants.find(p=>p.id==='u2').color,'#123456');

  result = await json(`${base}/api/rooms/${roomId}/participant`, { method:'POST', body:JSON.stringify({ participantId:'u2', ready:true }) });
  assert.equal(result.res.status,200);
  result = await json(`${base}/api/rooms/${roomId}/participant`, { method:'POST', body:JSON.stringify({ participantId:'u3', ready:true }) });
  assert.equal(result.res.status,200);

  result = await json(`${base}/api/rooms/${roomId}/clips/${clip.id}`, { method:'DELETE', body:JSON.stringify({ participantId:'u1' }) });
  assert.equal(result.res.status,200);
  result = await json(`${base}/api/rooms/${roomId}/state`); assert.equal(result.body.clips.length,0);

  console.log('✓ DubRoom independent-session UX smoke test passed');
} finally {
  child.kill('SIGTERM'); await rm(dataDir,{recursive:true,force:true});
}
