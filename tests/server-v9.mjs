import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT=3299,base=`http://127.0.0.1:${PORT}`,dataDir=await mkdtemp(path.join(os.tmpdir(),'dubroom-v9-'));
const child=spawn(process.execPath,['server/index-v5.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(PORT),DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
async function wait(){for(let i=0;i<80;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,40));}throw new Error('server did not start');}
async function j(url,opt={}){const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});const b=await r.json().catch(()=>({}));return{r,b};}
async function openSse(url){const res=await fetch(url,{headers:{accept:'text/event-stream'}});assert.equal(res.status,200);const reader=res.body.getReader(),decoder=new TextDecoder();let buf='';const queue=[],waiters=[];(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});let i;while((i=buf.indexOf('\n\n'))>=0){const block=buf.slice(0,i);buf=buf.slice(i+2);let event='message',data='';for(const line of block.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data+=line.slice(5).trim();}if(!data)continue;const item={event,data:JSON.parse(data)};if(waiters.length)waiters.shift()(item);else queue.push(item);}}})();return{next:()=>queue.length?Promise.resolve(queue.shift()):new Promise(r=>waiters.push(r)),close:()=>reader.cancel()};}
async function waitEvent(sse,name,timeout=2500){const end=Date.now()+timeout;while(Date.now()<end){const item=await Promise.race([sse.next(),new Promise((_,rej)=>setTimeout(()=>rej(new Error(`timeout ${name}`)),end-Date.now()))]);if(item.event===name)return item;}throw new Error(`missing ${name}`);}

try{
  await wait();let q=await j(`${base}/api/rooms`,{method:'POST',body:JSON.stringify({participantId:'host',name:'Host'})});assert.equal(q.r.status,201);const id=q.b.room.id;
  q=await j(`${base}/api/rooms/${id}/join`,{method:'POST',body:JSON.stringify({participantId:'guest',name:'Guest'})});assert.equal(q.r.status,200);
  let r=await fetch(`${base}/api/rooms/${id}/video`,{method:'POST',headers:{'content-type':'video/mp4','x-participant-id':'host','x-file-name':'v.mp4'},body:Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')});assert.equal(r.status,200);
  q=await j(`${base}/api/rooms/${id}/video-meta`,{method:'POST',body:JSON.stringify({participantId:'host',duration:60})});assert.equal(q.r.status,200);
  q=await j(`${base}/api/rooms/${id}/range`,{method:'POST',body:JSON.stringify({participantId:'host',start:5,end:20})});assert.equal(q.r.status,200);
  for(const participantId of ['host','guest']){q=await j(`${base}/api/rooms/${id}/participant`,{method:'POST',body:JSON.stringify({participantId,ready:true})});assert.equal(q.r.status,200);}
  const sse=await openSse(`${base}/api/rooms/${id}/events?participantId=guest`);
  q=await j(`${base}/api/rooms/${id}/preview/control`,{method:'POST',body:JSON.stringify({participantId:'guest',action:'pause',currentTime:9})});assert.equal(q.r.status,403);
  q=await j(`${base}/api/rooms/${id}/preview/control`,{method:'POST',body:JSON.stringify({participantId:'host',action:'play',currentTime:8.5})});assert.equal(q.r.status,200);assert.equal(q.b.action,'play');assert.equal(q.b.currentTime,8.5);assert.ok(q.b.effectiveAt>Date.now());let ev=await waitEvent(sse,'mix-preview-control');assert.equal(ev.data.action,'play');assert.equal(ev.data.currentTime,8.5);
  q=await j(`${base}/api/rooms/${id}/preview/control`,{method:'POST',body:JSON.stringify({participantId:'host',action:'pause',currentTime:11.25})});assert.equal(q.r.status,200);assert.equal(q.b.action,'pause');assert.equal(q.b.currentTime,11.25);ev=await waitEvent(sse,'mix-preview-control');assert.equal(ev.data.action,'pause');assert.equal(ev.data.currentTime,11.25);
  q=await j(`${base}/api/rooms/${id}/participant`,{method:'POST',body:JSON.stringify({participantId:'guest',ready:false})});assert.equal(q.r.status,200);
  q=await j(`${base}/api/rooms/${id}/preview/control`,{method:'POST',body:JSON.stringify({participantId:'host',action:'play',currentTime:12})});assert.equal(q.r.status,409);
  sse.close();
  console.log('✓ DubRoom v0.9 synchronized preview transport server test passed');
} finally {child.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true});}
