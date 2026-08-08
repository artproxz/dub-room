import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT=3291, base=`http://127.0.0.1:${PORT}`;
const dataDir=await mkdtemp(path.join(os.tmpdir(),'dubroom-v5-'));
const child=spawn(process.execPath,['server/index-v5.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(PORT),DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
async function wait(){for(let i=0;i<60;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)return await r.json();}catch{}await new Promise(r=>setTimeout(r,60));}throw new Error('server did not start');}
async function j(url,opt={}){const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});const b=await r.json().catch(()=>({}));return{r,b};}

async function openSse(url){
  const res=await fetch(url,{headers:{accept:'text/event-stream'}});assert.equal(res.status,200);const reader=res.body.getReader();const decoder=new TextDecoder();let buffer='';const queue=[];const waiters=[];
  const pump=(async()=>{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let idx;while((idx=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,idx);buffer=buffer.slice(idx+2);let event='message',data='';for(const line of block.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data+=line.slice(5).trim();}if(!data)continue;const item={event,data:JSON.parse(data)};if(waiters.length)waiters.shift()(item);else queue.push(item);}}})();
  return { next:()=>queue.length?Promise.resolve(queue.shift()):new Promise(resolve=>waiters.push(resolve)), close:()=>reader.cancel(), pump };
}
async function waitEvent(sse,name,timeout=2000){const end=Date.now()+timeout;while(Date.now()<end){const left=end-Date.now();const item=await Promise.race([sse.next(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('event timeout')),left))]);if(item.event===name)return item;}throw new Error(`missing ${name}`);}
try{
  const health=await wait(); assert.equal(health.version,'0.5.0');
  let q=await j(`${base}/api/rooms`,{method:'POST',body:JSON.stringify({participantId:'u1',name:'Dima'})});assert.equal(q.r.status,201);const id=q.b.room.id;assert.equal(q.b.room.participants[0].armed,false);
  for(const [pid,name] of [['u2','Anna'],['u3','Max']]){q=await j(`${base}/api/rooms/${id}/join`,{method:'POST',body:JSON.stringify({participantId:pid,name})});assert.equal(q.r.status,200);}
  q=await j(`${base}/api/rooms/${id}/participant`,{method:'POST',body:JSON.stringify({participantId:'u1',role:'Лев Алекс',armed:true})});assert.equal(q.r.status,200);assert.equal(q.b.participant.role,'Лев Алекс');
  const fake=Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  let r=await fetch(`${base}/api/rooms/${id}/video`,{method:'POST',headers:{'content-type':'video/mp4','x-participant-id':'u1','x-file-name':'demo.mp4'},body:fake});assert.equal(r.status,200);const video=await r.json();
  q=await j(`${base}/api/rooms/${id}/video-meta`,{method:'POST',body:JSON.stringify({participantId:'u1',duration:100})});assert.equal(q.r.status,200);
  q=await j(`${base}/api/rooms/${id}/range`,{method:'POST',body:JSON.stringify({participantId:'u1',start:10,end:16})});assert.deepEqual(q.b.range,{start:10,end:16});
  r=await fetch(`${base}${video.url}`,{headers:{range:'bytes=-5'}});assert.equal(r.status,206);assert.equal(await r.text(),'VWXYZ');
  q=await j(`${base}/api/rooms/${id}/recording/start`,{method:'POST',body:JSON.stringify({participantId:'u1'})});assert.equal(q.r.status,200);const session=q.b.sessionId;
  q=await j(`${base}/api/rooms/${id}/recording/stop`,{method:'POST',body:JSON.stringify({participantId:'u1'})});assert.equal(q.r.status,200);
  r=await fetch(`${base}/api/rooms/${id}/sessions/${session}/clips/u1`,{method:'POST',headers:{'content-type':'audio/webm','x-participant-id':'u1','x-clip-start':'10','x-clip-duration':'2.2','x-waveform':'10,50,90,30'},body:Buffer.from('voice')});assert.equal(r.status,201);const clip=(await r.json()).clip;
  q=await j(`${base}/api/rooms/${id}/clips/${clip.id}`,{method:'PATCH',body:JSON.stringify({participantId:'u1',seq:2,start:11.5,volume:.4})});assert.equal(q.r.status,200);
  q=await j(`${base}/api/rooms/${id}/clips/${clip.id}`,{method:'PATCH',body:JSON.stringify({participantId:'u1',seq:1,start:12.5,volume:.9})});assert.equal(q.b.stale,true);
  q=await j(`${base}/api/rooms/${id}/state`);const stored=q.b.clips.find(c=>c.id===clip.id);assert.equal(stored.start,11.5);assert.equal(stored.volume,.4);
  q=await j(`${base}/api/rooms/${id}/signal`,{method:'POST',body:JSON.stringify({participantId:'u1',targetId:'u2',type:'ice',payload:{candidate:'test'}})});assert.equal(q.r.status,204);
  const sse=await openSse(`${base}/api/rooms/${id}/events?participantId=u2`);
  const rtc=await waitEvent(sse,'rtc-signal');assert.equal(rtc.data.from,'u1');assert.equal(rtc.data.type,'ice');
  q=await j(`${base}/api/rooms/${id}/clips/${clip.id}`,{method:'PATCH',body:JSON.stringify({participantId:'u1',seq:3,start:12.25})});assert.equal(q.r.status,200);
  const livePatch=await waitEvent(sse,'clip-patch');assert.equal(livePatch.data.clip.start,12.25);
  sse.close();
  for(const pid of ['u1','u2','u3']){q=await j(`${base}/api/rooms/${id}/participant`,{method:'POST',body:JSON.stringify({participantId:pid,ready:true})});assert.equal(q.r.status,200);}
  q=await j(`${base}/api/rooms/${id}/preview/start`,{method:'POST',body:JSON.stringify({participantId:'u2'})});assert.equal(q.r.status,403);
  q=await j(`${base}/api/rooms/${id}/preview/start`,{method:'POST',body:JSON.stringify({participantId:'u1'})});assert.equal(q.r.status,200);assert.equal(q.b.startTime,10);
  q=await j(`${base}/api/rooms/${id}/clips/${clip.id}`,{method:'DELETE',body:JSON.stringify({participantId:'u1'})});assert.equal(q.r.status,200);
  q=await j(`${base}/api/rooms/${id}/state`);assert.equal(q.b.clips.length,0);
  const index=await fetch(`${base}/`);const html=await index.text();assert.match(html,/app-v5-core\.js\?v=0\.5\.0/);assert.match(html,/app-v5-events\.js\?v=0\.5\.0/);assert.match(html,/app-v5-editor\.js\?v=0\.5\.0/);assert.match(html,/app-v5-playback\.js\?v=0\.5\.0/);assert.match(html,/app-v5-voice\.js\?v=0\.5\.0/);
  console.log('✓ DubRoom v0.5 server/realtime smoke test passed');
} finally {child.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true});}
