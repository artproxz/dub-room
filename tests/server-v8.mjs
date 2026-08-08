import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const PORT=3298,base=`http://127.0.0.1:${PORT}`,dataDir=await mkdtemp(path.join(os.tmpdir(),'dubroom-v8-'));
const child=spawn(process.execPath,['server/index-v5.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(PORT),DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
async function wait(){for(let i=0;i<70;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw new Error('server did not start');}
async function j(url,opt={}){const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});const b=await r.json().catch(()=>({}));return{r,b};}
try{
 await wait();let q=await j(`${base}/api/rooms`,{method:'POST',body:JSON.stringify({participantId:'p1',name:'One'})});const id=q.b.room.id;
 q=await j(`${base}/api/rooms/${id}/join`,{method:'POST',body:JSON.stringify({participantId:'p2',name:'Two'})});assert.equal(q.r.status,200);
 const video=Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');let r=await fetch(`${base}/api/rooms/${id}/video`,{method:'POST',headers:{'content-type':'video/mp4','x-participant-id':'p1','x-file-name':'v.mp4'},body:video});assert.equal(r.status,200);
 q=await j(`${base}/api/rooms/${id}/video-meta`,{method:'POST',body:JSON.stringify({participantId:'p1',duration:60})});assert.equal(q.r.status,200);
 q=await j(`${base}/api/rooms/${id}/range`,{method:'POST',body:JSON.stringify({participantId:'p1',start:5,end:20})});assert.equal(q.r.status,200);
 const [a,b]=await Promise.all([
   j(`${base}/api/rooms/${id}/recording/start`,{method:'POST',body:JSON.stringify({participantId:'p1',startTime:8,sessionId:'session_one'})}),
   j(`${base}/api/rooms/${id}/recording/start`,{method:'POST',body:JSON.stringify({participantId:'p2',startTime:9,sessionId:'session_two'})}),
 ]);
 assert.equal(a.r.status,200);assert.equal(b.r.status,200);
 q=await j(`${base}/api/rooms/${id}/state`);assert.equal(q.b.recordings.length,2);
 for(const [pid,end] of [['p1',10],['p2',11]]){q=await j(`${base}/api/rooms/${id}/recording/stop`,{method:'POST',body:JSON.stringify({participantId:pid,endTime:end})});assert.equal(q.r.status,200);}
 r=await fetch(`${base}/api/rooms/${id}/sessions/session_one/clips/p1`,{method:'POST',headers:{'content-type':'audio/webm','x-participant-id':'p1','x-clip-start':'8','x-clip-duration':'2','x-sync-comp-ms':'80','x-waveform':'10,40,90'},body:Buffer.from('voice-one')});assert.equal(r.status,201);let clip=(await r.json()).clip;
 assert.equal(clip.start,7.92);assert.equal(clip.sourceDuration,2);assert.equal(clip.offset,0);assert.equal(clip.syncCompensationMs,80);
 q=await j(`${base}/api/rooms/${id}/clips/${clip.id}`,{method:'PATCH',body:JSON.stringify({participantId:'p1',seq:1,start:8.2,offset:.4,duration:1.2,volume:.7})});assert.equal(q.r.status,200);clip=q.b.clip;assert.equal(clip.start,8.2);assert.equal(clip.offset,.4);assert.equal(clip.duration,1.2);assert.equal(clip.volume,.7);
 console.log('✓ DubRoom v0.8 concurrent recording/latency/trim passed');
}finally{child.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true});}
