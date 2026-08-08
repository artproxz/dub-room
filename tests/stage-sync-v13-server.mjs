import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT=3313,base=`http://127.0.0.1:${PORT}`,data=await mkdtemp(path.join(os.tmpdir(),'dubroom-v13-'));
const child=spawn(process.execPath,['server/index-v5.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(PORT),DATA_DIR:data},stdio:['ignore','pipe','pipe']});
async function wait(){for(let i=0;i<80;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw new Error('server');}
async function j(url,opt={}){const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});const b=await r.json().catch(()=>({}));return{r,b};}

try{
  await wait();
  let q=await j(`${base}/api/rooms`,{method:'POST',body:JSON.stringify({participantId:'host',name:'Host'})});
  const id=q.b.room.id;
  await j(`${base}/api/rooms/${id}/join`,{method:'POST',body:JSON.stringify({participantId:'guest',name:'Guest'})});
  let r=await fetch(`${base}/api/rooms/${id}/video`,{method:'POST',headers:{'content-type':'video/mp4','x-participant-id':'host','x-file-name':'movie.mp4'},body:Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')});
  assert.equal(r.status,200);
  await j(`${base}/api/rooms/${id}/video-meta`,{method:'POST',body:JSON.stringify({participantId:'host',duration:120})});

  q=await j(`${base}/api/rooms/${id}/stage/player`,{method:'POST',body:JSON.stringify({participantId:'host',currentTime:37.25,playing:false})});
  assert.equal(q.r.status,200);assert.equal(q.b.player.currentTime,37.25);assert.equal(q.b.player.playing,false);
  q=await j(`${base}/api/rooms/${id}/state`);assert.equal(q.b.player.currentTime,37.25);assert.equal(q.b.player.playing,false);

  q=await j(`${base}/api/rooms/${id}/stage/player`,{method:'POST',body:JSON.stringify({participantId:'guest',currentTime:55,playing:true})});
  assert.equal(q.r.status,403);

  q=await j(`${base}/api/rooms/${id}/stage/player`,{method:'POST',body:JSON.stringify({participantId:'host',currentTime:38,playing:true})});
  assert.equal(q.r.status,200);assert.equal(q.b.player.playing,true);

  q=await j(`${base}/api/rooms/${id}/party/action`,{method:'POST',body:JSON.stringify({participantId:'host',action:'scene-ready'})});
  assert.equal(q.b.party.phase,'roles');
  for(const pid of ['host','guest']){
    q=await j(`${base}/api/rooms/${id}/participant`,{method:'POST',body:JSON.stringify({participantId:pid,ready:true,armed:false})});
    assert.equal(q.r.status,200);assert.equal(q.b.participant.ready,true);
  }
  q=await j(`${base}/api/rooms/${id}/party/start`,{method:'POST',body:JSON.stringify({participantId:'host'})});
  assert.equal(q.r.status,200);assert.equal(q.b.party.phase,'recording');

  q=await j(`${base}/api/rooms/${id}/stage/player`,{method:'POST',body:JSON.stringify({participantId:'host',currentTime:40,playing:false})});
  assert.equal(q.r.status,409);
  console.log('✓ DubRoom 1.2.1 host sync + role readiness server flow passed');
} finally {
  child.kill('SIGTERM');
  await rm(data,{recursive:true,force:true});
}
