import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const PORT=3301,base=`http://127.0.0.1:${PORT}`,dataDir=await mkdtemp(path.join(os.tmpdir(),'dubroom-party-'));
const child=spawn(process.execPath,['server/index-v5.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(PORT),DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
async function wait(){for(let i=0;i<80;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw new Error('server did not start');}
async function j(url,opt={}){const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});const b=await r.json().catch(()=>({}));return{r,b};}
try{
 await wait();let q=await j(`${base}/api/rooms`,{method:'POST',body:JSON.stringify({participantId:'p1',name:'One'})});const id=q.b.room.id;
 for(const [pid,name] of [['p2','Two'],['p3','Three']]){q=await j(`${base}/api/rooms/${id}/join`,{method:'POST',body:JSON.stringify({participantId:pid,name})});assert.equal(q.r.status,200);}
 let r=await fetch(`${base}/api/rooms/${id}/video`,{method:'POST',headers:{'content-type':'video/mp4','x-participant-id':'p1','x-file-name':'movie.mp4'},body:Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')});assert.equal(r.status,200);
 q=await j(`${base}/api/rooms/${id}/video-meta`,{method:'POST',body:JSON.stringify({participantId:'p1',duration:10})});assert.equal(q.r.status,200);
 q=await j(`${base}/api/rooms/${id}/range`,{method:'POST',body:JSON.stringify({participantId:'p1',start:.2,end:.6})});assert.equal(q.r.status,200);
 for(const pid of ['p1','p2','p3']){q=await j(`${base}/api/rooms/${id}/participant`,{method:'POST',body:JSON.stringify({participantId:pid,ready:true})});assert.equal(q.r.status,200);}
 q=await j(`${base}/api/rooms/${id}/party/start`,{method:'POST',body:JSON.stringify({participantId:'p1'})});assert.equal(q.r.status,200);assert.equal(q.b.party.phase,'recording');assert.equal(Object.keys(q.b.sessions).length,3);
 q=await j(`${base}/api/rooms/${id}/state`);assert.equal(q.b.recordings.length,3);assert.equal(q.b.party.round,1);
 for(const pid of ['p1','p2','p3']){q=await j(`${base}/api/rooms/${id}/party/recorded`,{method:'POST',body:JSON.stringify({participantId:pid,success:true})});assert.equal(q.r.status,200);}
 q=await j(`${base}/api/rooms/${id}/state`);assert.equal(q.b.party.phase,'review');assert.equal(q.b.recordings.length,0);assert.equal(q.b.party.successfulParticipantIds.length,3);
 for(const pid of ['p1','p2','p3'])await j(`${base}/api/rooms/${id}/participant`,{method:'POST',body:JSON.stringify({participantId:pid,ready:true})});
 q=await j(`${base}/api/rooms/${id}/party/final/start`,{method:'POST',body:JSON.stringify({participantId:'p1'})});assert.equal(q.r.status,200);assert.equal(q.b.party.phase,'preview');
 await new Promise(r=>setTimeout(r,950));q=await j(`${base}/api/rooms/${id}/state`);assert.equal(q.b.party.phase,'result');
 q=await j(`${base}/api/rooms/${id}/party/action`,{method:'POST',body:JSON.stringify({participantId:'p1',action:'save'})});assert.equal(q.b.party.savedCurrent,true);assert.equal(q.b.party.savedRounds.length,1);
 q=await j(`${base}/api/rooms/${id}/party/action`,{method:'POST',body:JSON.stringify({participantId:'p1',action:'retry'})});assert.equal(q.b.party.phase,'lobby');
 console.log('✓ DubRoom 1.0 party round flow passed');
}finally{child.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true});}
