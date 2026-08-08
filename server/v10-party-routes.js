import { now, sendJson, broadcast, readJson, parseRoute, requireRoom, isHost, randomId, touch } from './lib.js';
import { ensureParty, partyPublic, participantPublic, broadcastSnapshot, allConnectedReady, stopParticipantRecording } from './v5-state.js';

function connectedIds(room) { return [...room.participants.values()].filter((p) => p.connected).map((p) => p.id); }
function clearPartyTimer(party, key) { if (party[key]) clearTimeout(party[key]); party[key] = null; }
function resetReady(room) { for (const p of room.participants.values()) { p.ready = false; p.armed = false; } }
function emitParty(room) { touch(room); broadcast(room, 'party-state', { party: partyPublic(room) }); broadcastSnapshot(room); }
function enterReview(room) {
  const party = ensureParty(room);
  if (party.phase !== 'recording') return;
  clearPartyTimer(party, 'phaseTimer');
  for (const id of [...room.recordings.keys()]) stopParticipantRecording(room, id, now(), room.range.end);
  party.phase = 'review';
  resetReady(room);
  emitParty(room);
}

export async function handleV10PartyRequest(req, res, url) {
  let params = parseRoute(url.pathname, '/api/rooms/:roomId/party/start');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return true;
    const body = await readJson(req); const actor = String(body.participantId || '');
    if (!isHost(room, actor)) { sendJson(res, 403, { error: 'Озвучку запускает ведущий.' }); return true; }
    if (!room.video) { sendJson(res, 409, { error: 'Сначала загрузите фильм.' }); return true; }
    if (room.recordings.size) { sendJson(res, 409, { error: 'Кто-то уже записывается.' }); return true; }
    if (!allConnectedReady(room)) { sendJson(res, 409, { error: 'Не все готовы к озвучке.' }); return true; }
    const party = ensureParty(room); clearPartyTimer(party, 'phaseTimer'); clearPartyTimer(party, 'finalTimer');
    const ids = connectedIds(room); const startAt = now() + 420; const startTime = room.range.start; const endTime = room.range.end;
    party.phase = 'recording'; party.round += 1; party.roundStartedAt = now(); party.expectedParticipantIds = ids;
    party.completedParticipantIds = []; party.successfulParticipantIds = []; party.savedCurrent = false; party.trackEpochs = {};
    const sessions = {};
    for (const id of ids) {
      const p = room.participants.get(id); p.ready = false; p.armed = false; party.trackEpochs[id] = party.roundStartedAt;
      const sessionId = randomId(12); sessions[id] = sessionId;
      const stopAt = startAt + Math.max(100, (endTime - startTime) * 1000) + 1500;
      const recording = { sessionId, participantId:id, startTime, endTime, startAt, stopAt };
      recording.timer = setTimeout(() => stopParticipantRecording(room, id, now(), endTime), Math.max(0, stopAt - now()));
      room.recordings.set(id, recording);
    }
    party.phaseTimer = setTimeout(() => enterReview(room), Math.max(1000, startAt - now() + (endTime - startTime) * 1000 + 2400));
    emitParty(room);
    const payload = { round:party.round, startAt, startTime, endTime, sessions };
    broadcast(room, 'party-record-start', payload);
    sendJson(res, 200, { ok:true, ...payload, party:partyPublic(room) }); return true;
  }

  params = parseRoute(url.pathname, '/api/rooms/:roomId/party/recorded');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return true;
    const body = await readJson(req); const id = String(body.participantId || ''); const party = ensureParty(room);
    if (!room.participants.has(id) || !party.expectedParticipantIds.includes(id)) { sendJson(res, 403, { error:'Не участник текущей озвучки.' }); return true; }
    if (!party.completedParticipantIds.includes(id)) party.completedParticipantIds.push(id);
    if (body.success && !party.successfulParticipantIds.includes(id)) party.successfulParticipantIds.push(id);
    if (party.expectedParticipantIds.every((x) => party.completedParticipantIds.includes(x))) enterReview(room); else emitParty(room);
    sendJson(res, 200, { ok:true, party:partyPublic(room) }); return true;
  }

  params = parseRoute(url.pathname, '/api/rooms/:roomId/party/track-epoch');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return true;
    const body = await readJson(req); const id = String(body.participantId || ''); const participant = room.participants.get(id); const party = ensureParty(room);
    if (!participant) { sendJson(res,403,{error:'Не участник комнаты.'}); return true; }
    party.trackEpochs[id] = Math.max(party.roundStartedAt || 0, Number(body.epoch) || now()); participant.ready = false; touch(room);
    broadcast(room,'participant-patch',{participant:participantPublic(participant)}); emitParty(room);
    sendJson(res,200,{ok:true,party:partyPublic(room)}); return true;
  }

  params = parseRoute(url.pathname, '/api/rooms/:roomId/party/final/start');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return true;
    const body = await readJson(req); const party = ensureParty(room);
    if (!isHost(room, String(body.participantId || ''))) { sendJson(res,403,{error:'Итог запускает ведущий.'}); return true; }
    if (party.phase !== 'review') { sendJson(res,409,{error:'Сначала закончите озвучку.'}); return true; }
    if (room.recordings.size) { sendJson(res,409,{error:'Кто-то ещё записывается.'}); return true; }
    if (!allConnectedReady(room)) { sendJson(res,409,{error:'Не все готовы смотреть итог.'}); return true; }
    clearPartyTimer(party,'finalTimer'); party.phase='preview'; emitParty(room);
    const previewAt=now()+260,payload={previewAt,startTime:room.range.start,endTime:room.range.end}; broadcast(room,'mix-preview',payload);
    party.finalTimer=setTimeout(()=>{party.phase='result';resetReady(room);emitParty(room);},Math.max(400,previewAt-now()+(room.range.end-room.range.start)*1000+260));
    sendJson(res,200,{ok:true,...payload,party:partyPublic(room)}); return true;
  }

  params = parseRoute(url.pathname, '/api/rooms/:roomId/party/action');
  if (req.method === 'POST' && params) {
    const room = requireRoom(params.roomId, res); if (!room) return true;
    const body = await readJson(req); const party = ensureParty(room); const actor=String(body.participantId||'');
    if (!isHost(room,actor)) { sendJson(res,403,{error:'Этим управляет ведущий.'}); return true; }
    const action=String(body.action||'');
    if (action==='save') {
      if (!party.savedRounds.some((x)=>x.round===party.round)) party.savedRounds.push({round:party.round,sceneIndex:party.sceneIndex,range:{...room.range},savedAt:now()});
      party.savedCurrent=true; emitParty(room); sendJson(res,200,{ok:true,party:partyPublic(room)}); return true;
    }
    if (!['retry','next'].includes(action)) { sendJson(res,400,{error:'Неизвестное действие.'}); return true; }
    clearPartyTimer(party,'finalTimer'); clearPartyTimer(party,'phaseTimer');
    party.phase='lobby'; if(action==='next') party.sceneIndex+=1; party.expectedParticipantIds=[]; party.completedParticipantIds=[]; party.successfulParticipantIds=[]; party.savedCurrent=false; resetReady(room); emitParty(room);
    sendJson(res,200,{ok:true,party:partyPublic(room)}); return true;
  }
  return false;
}
