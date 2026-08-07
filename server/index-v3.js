import {
  http, fsp, path, DATA_DIR, PUBLIC_DIR, PORT, ROOM_TTL_MS, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, DEFAULT_COLORS, rooms,
  now, makeRoomCode, sendJson, sendSse, broadcast, readJson, safeFileName,
  extensionFrom, streamUpload, parseRoute, requireRoom, serveFile, touch, isHost, roomDir, randomId,
  clamp, sanitizeColor, resetReady, parsePeaks,
} from './lib.js';

function participantPublic(p) {
  return { id:p.id, name:p.name, connected:p.connected, color:p.color, armed:Boolean(p.armed), ready:Boolean(p.ready) };
}
function clipPublic(c) {
  return { id:c.id, participantId:c.participantId, start:c.start, duration:c.duration, volume:c.volume, peaks:c.peaks, url:c.url, mimeType:c.mimeType, createdAt:c.createdAt };
}
function recordingPublic(r) {
  return { sessionId:r.sessionId, participantId:r.participantId, startTime:r.startTime, endTime:r.endTime, startAt:r.startAt, stopAt:r.stopAt };
}
function roomSnapshot(room) {
  return {
    id:room.id, createdAt:room.createdAt, hostParticipantId:room.hostParticipantId,
    participants:[...room.participants.values()].map(participantPublic), video:room.video,
    player:room.player, range:room.range, clips:room.clips.map(clipPublic),
    recordings:[...(room.recordings?.values?.() || [])].map(recordingPublic),
  };
}
function broadcastSnapshot(room) { broadcast(room, 'room-state', roomSnapshot(room)); }
function setNotReady(room, id) { const p=room.participants.get(id); if (p) p.ready=false; }

function scheduleMixPreview(room) {
  if (room.recordings?.size) return;
  const connected=[...room.participants.values()].filter(p=>p.connected);
  if (!connected.length || !connected.every(p=>p.ready)) return;
  const payload={ previewAt:now()+900, startTime:room.range.start, endTime:room.range.end };
  resetReady(room); broadcastSnapshot(room); broadcast(room,'mix-preview',payload);
}
function stopParticipantRecording(room, participantId, stopAt=now()+120) {
  const recording=room.recordings?.get(participantId); if (!recording) return null;
  if (recording.timer) clearTimeout(recording.timer);
  const elapsed=Math.max(0,stopAt-recording.startAt)/1000;
  const endTime=Math.min(recording.endTime, recording.startTime+elapsed);
  room.recordings.delete(participantId); setNotReady(room,participantId); touch(room);
  const payload={ participantId, sessionId:recording.sessionId, stopAt, startTime:recording.startTime, endTime };
  broadcastSnapshot(room); broadcast(room,'recording-stop',payload); return payload;
}

const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`); const {pathname}=url;
  try {
    if (req.method==='GET' && pathname==='/api/health') return sendJson(res,200,{ok:true,rooms:rooms.size,version:'0.3.0'});

    if (req.method==='POST' && pathname==='/api/rooms') {
      const body=await readJson(req); const participantId=String(body.participantId||'').slice(0,64); const name=String(body.name||'Участник').trim().slice(0,32);
      if (!participantId) return sendJson(res,400,{error:'Нет participantId.'});
      const id=makeRoomCode(); const participant={id:participantId,name,connected:true,color:DEFAULT_COLORS[0],armed:true,ready:false};
      const room={id,createdAt:now(),updatedAt:now(),hostParticipantId:participantId,participants:new Map([[participantId,participant]]),sse:new Map(),player:{currentTime:0,playing:false},range:{start:0,end:30},clips:[],recordings:new Map()};
      rooms.set(id,room); return sendJson(res,201,{ok:true,room:roomSnapshot(room)});
    }

    let params=parseRoute(pathname,'/api/rooms/:roomId/join');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if (!room) return; const body=await readJson(req);
      const participantId=String(body.participantId||'').slice(0,64); const name=String(body.name||'Участник').trim().slice(0,32);
      if (!participantId) return sendJson(res,400,{error:'Нет participantId.'});
      const existing=room.participants.get(participantId); if (!existing && room.participants.size>=3) return sendJson(res,409,{error:'В комнате уже 3 участника.'});
      const index=existing?[...room.participants.keys()].indexOf(participantId):room.participants.size;
      room.participants.set(participantId,{id:participantId,name,connected:true,color:existing?.color||DEFAULT_COLORS[index]||DEFAULT_COLORS[0],armed:existing?.armed??true,ready:false});
      touch(room); resetReady(room); broadcastSnapshot(room); return sendJson(res,200,{ok:true,room:roomSnapshot(room)});
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/state');
    if (req.method==='GET' && params) { const room=requireRoom(params.roomId,res); if (!room) return; return sendJson(res,200,roomSnapshot(room)); }

    params=parseRoute(pathname,'/api/rooms/:roomId/events');
    if (req.method==='GET' && params) {
      const room=requireRoom(params.roomId,res); if (!room) return; const participantId=String(url.searchParams.get('participantId')||''); const participant=room.participants.get(participantId);
      if (!participant) return sendJson(res,403,{error:'Сначала войдите в комнату.'}); participant.connected=true;
      res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform',connection:'keep-alive','x-accel-buffering':'no'}); res.write('retry: 1500\n\n');
      const list=room.sse.get(participantId)??new Set(); list.add(res); room.sse.set(participantId,list); sendSse(res,'room-state',roomSnapshot(room)); broadcastSnapshot(room);
      const heartbeat=setInterval(()=>res.write(': ping\n\n'),15000);
      req.on('close',()=>{ clearInterval(heartbeat); list.delete(res); if (!list.size) { room.sse.delete(participantId); setTimeout(()=>{ if (room.sse.has(participantId)) return; const p=room.participants.get(participantId); if (p){p.connected=false;p.ready=false;} broadcastSnapshot(room); },3000).unref(); } });
      return;
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/participant');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if (!room) return; const body=await readJson(req); const participant=room.participants.get(String(body.participantId||''));
      if (!participant) return sendJson(res,403,{error:'Не участник комнаты.'});
      if ('armed' in body) participant.armed=Boolean(body.armed); if ('color' in body) participant.color=sanitizeColor(body.color,participant.color);
      if ('ready' in body) { if (room.recordings?.has(participant.id)) return sendJson(res,409,{error:'Сначала завершите свою запись.'}); participant.ready=Boolean(body.ready); }
      touch(room); broadcastSnapshot(room); if ('ready' in body && participant.ready) scheduleMixPreview(room); return sendJson(res,200,{ok:true,participant:participantPublic(participant)});
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/level');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if (!room) return; const body=await readJson(req); const participantId=String(body.participantId||'');
      if (!room.participants.has(participantId)) return sendJson(res,403,{error:'Не участник комнаты.'}); broadcast(room,'participant-level',{participantId,level:clamp(body.level,0,1)},participantId); res.writeHead(204); res.end(); return;
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/range');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if (!room) return; const body=await readJson(req);
      if (!isHost(room,body.participantId)||room.recordings?.size) return sendJson(res,403,{error:'Общий фрагмент меняет ведущий, когда никто не записывается.'});
      const max=Math.max(.1,Number(room.video?.duration)||24*60*60); let start=clamp(body.start,0,max); let end=clamp(body.end,0,max); if(end<start)[start,end]=[end,start]; if(end-start<.1)end=Math.min(max,start+.1);
      room.range={start,end}; resetReady(room); touch(room); broadcastSnapshot(room); return sendJson(res,200,{ok:true,range:room.range});
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/video');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if (!room) return; const participantId=String(req.headers['x-participant-id']||''); if(!isHost(room,participantId))return sendJson(res,403,{error:'Видео загружает ведущий.'});
      const originalName=safeFileName(decodeURIComponent(String(req.headers['x-file-name']||'video'))); const contentType=String(req.headers['content-type']||'application/octet-stream'); const ext=extensionFrom(contentType,originalName); const target=path.join(roomDir(room.id),`source${ext}`);
      const size=await streamUpload(req,target,MAX_VIDEO_BYTES); const relative=path.relative(DATA_DIR,target).split(path.sep).join('/'); room.video={url:`/media/${relative}`,originalName,size,duration:undefined}; room.range={start:0,end:30}; room.clips=[]; resetReady(room); touch(room); broadcastSnapshot(room); return sendJson(res,200,room.video);
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/video-meta');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if (!room) return; const body=await readJson(req); if(!isHost(room,body.participantId)||!room.video)return sendJson(res,403,{error:'Недоступно.'});
      const duration=clamp(body.duration,.1,24*60*60); room.video.duration=duration; room.range.end=Math.min(Math.max(room.range.start+.1,room.range.end),duration); touch(room); broadcastSnapshot(room); return sendJson(res,200,{ok:true,duration});
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/recording/start');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if(!room)return; const body=await readJson(req); const participantId=String(body.participantId||''); const participant=room.participants.get(participantId);
      if(!participant)return sendJson(res,403,{error:'Не участник комнаты.'}); if(!room.video)return sendJson(res,409,{error:'Сначала загрузите видео.'}); if(room.recordings?.has(participantId))return sendJson(res,409,{error:'Ваша запись уже идёт.'});
      const startTime=room.range.start,endTime=room.range.end,startAt=now()+1250,stopAt=startAt+Math.max(100,(endTime-startTime)*1000),sessionId=randomId(10); const recording={sessionId,participantId,startTime,endTime,startAt,stopAt}; recording.timer=setTimeout(()=>stopParticipantRecording(room,participantId,stopAt),Math.max(0,stopAt-now()));
      room.recordings.set(participantId,recording); participant.armed=true; participant.ready=false; touch(room); const payload=recordingPublic(recording); broadcastSnapshot(room); return sendJson(res,200,{ok:true,...payload});
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/recording/stop');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if(!room)return; const body=await readJson(req); const participantId=String(body.participantId||''); if(!room.participants.has(participantId))return sendJson(res,403,{error:'Не участник комнаты.'});
      const payload=stopParticipantRecording(room,participantId); if(!payload)return sendJson(res,409,{error:'У вас нет активной записи.'}); return sendJson(res,200,{ok:true,...payload});
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/sessions/:sessionId/clips/:participantId');
    if (req.method==='POST' && params) {
      const room=requireRoom(params.roomId,res); if(!room)return; const participant=room.participants.get(params.participantId); if(!participant)return sendJson(res,403,{error:'Участник не найден.'}); if(String(req.headers['x-participant-id']||'')!==participant.id)return sendJson(res,403,{error:'Нельзя загрузить запись за другого участника.'});
      const start=clamp(req.headers['x-clip-start'],0,24*60*60),duration=clamp(req.headers['x-clip-duration'],.05,60*60),contentType=String(req.headers['content-type']||'audio/webm'),ext=extensionFrom(contentType,'clip.webm'),clipId=randomId(12),target=path.join(roomDir(room.id),'clips',`${clipId}${ext}`);
      await streamUpload(req,target,MAX_AUDIO_BYTES); const relative=path.relative(DATA_DIR,target).split(path.sep).join('/'); const clip={id:clipId,participantId:participant.id,start,duration,volume:1,peaks:parsePeaks(req.headers['x-waveform']),url:`/media/${relative}`,mimeType:contentType,createdAt:now(),filePath:target}; room.clips.push(clip); setNotReady(room,participant.id); touch(room); broadcastSnapshot(room); return sendJson(res,201,{ok:true,clip:clipPublic(clip)});
    }

    params=parseRoute(pathname,'/api/rooms/:roomId/clips/:clipId');
    if (req.method==='PATCH' && params) {
      const room=requireRoom(params.roomId,res); if(!room)return; const body=await readJson(req),clip=room.clips.find(x=>x.id===params.clipId); if(!clip)return sendJson(res,404,{error:'Аудиоклип не найден.'}); const actor=String(body.participantId||''); if(actor!==clip.participantId)return sendJson(res,403,{error:'Можно менять только свою запись.'});
      const max=Math.max(clip.duration,Number(room.video?.duration)||24*60*60); if('start'in body)clip.start=clamp(body.start,0,Math.max(0,max-.05)); if('volume'in body)clip.volume=clamp(body.volume,0,1); setNotReady(room,actor); touch(room); broadcastSnapshot(room); return sendJson(res,200,{ok:true,clip:clipPublic(clip)});
    }
    if (req.method==='DELETE' && params) {
      const room=requireRoom(params.roomId,res); if(!room)return; const body=await readJson(req),index=room.clips.findIndex(x=>x.id===params.clipId); if(index<0)return sendJson(res,404,{error:'Аудиоклип не найден.'}); const clip=room.clips[index],actor=String(body.participantId||''); if(actor!==clip.participantId)return sendJson(res,403,{error:'Можно удалять только свою запись.'}); room.clips.splice(index,1); await fsp.rm(clip.filePath,{force:true}).catch(()=>undefined); setNotReady(room,actor); touch(room); broadcastSnapshot(room); return sendJson(res,200,{ok:true});
    }

    if ((req.method==='GET'||req.method==='HEAD')&&pathname.startsWith('/media/')) { const relative=decodeURIComponent(pathname.slice('/media/'.length)); const target=path.resolve(DATA_DIR,relative); if(!target.startsWith(DATA_DIR+path.sep))return sendJson(res,403,{error:'Недопустимый путь.'}); return serveFile(req,res,target); }
    if (req.method==='GET'||req.method==='HEAD') { const relative=pathname==='/'?'index.html':pathname.replace(/^\//,''); const target=path.resolve(PUBLIC_DIR,relative); if(target.startsWith(PUBLIC_DIR+path.sep)||target===path.join(PUBLIC_DIR,'index.html')){try{const stat=await fsp.stat(target);if(stat.isFile())return serveFile(req,res,target);}catch{}} return serveFile(req,res,path.join(PUBLIC_DIR,'index.html')); }
    return sendJson(res,404,{error:'Не найдено.'});
  } catch(error) { console.error(error); if(res.headersSent)return res.end(); if(error?.message==='PAYLOAD_TOO_LARGE')return sendJson(res,413,{error:'Файл слишком большой.'}); if(error instanceof SyntaxError)return sendJson(res,400,{error:'Некорректный JSON.'}); return sendJson(res,500,{error:'Внутренняя ошибка сервера.'}); }
});

setInterval(()=>{const cutoff=now()-ROOM_TTL_MS;for(const[id,room]of rooms){if(room.updatedAt>cutoff)continue;for(const r of room.recordings?.values?.()||[])if(r.timer)clearTimeout(r.timer);for(const connections of room.sse.values())for(const res of connections)res.end();rooms.delete(id);fsp.rm(roomDir(id),{recursive:true,force:true}).catch(()=>undefined);}},30*60*1000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`DubRoom v0.3.0: http://localhost:${PORT}`));
