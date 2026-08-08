import { now, sendSse, broadcast, touch } from './lib.js';

export const PARTICIPANT_COLORS = ['#ff405f', '#8a5cff', '#f2ad3f'];

export function ensureParty(room) {
  room.party ??= {
    phase: 'lobby',
    round: 0,
    sceneIndex: 1,
    roundStartedAt: 0,
    expectedParticipantIds: [],
    completedParticipantIds: [],
    successfulParticipantIds: [],
    trackEpochs: {},
    savedRounds: [],
    savedCurrent: false,
  };
  room.party.expectedParticipantIds ??= [];
  room.party.completedParticipantIds ??= [];
  room.party.successfulParticipantIds ??= [];
  room.party.trackEpochs ??= {};
  room.party.savedRounds ??= [];
  return room.party;
}
export function partyPublic(room) {
  const p = ensureParty(room);
  return {
    phase: p.phase,
    round: p.round,
    sceneIndex: p.sceneIndex,
    roundStartedAt: p.roundStartedAt,
    expectedParticipantIds: [...p.expectedParticipantIds],
    completedParticipantIds: [...p.completedParticipantIds],
    successfulParticipantIds: [...p.successfulParticipantIds],
    trackEpochs: { ...p.trackEpochs },
    savedRounds: p.savedRounds.map((x) => ({ ...x, range: x.range ? { ...x.range } : undefined })),
    savedCurrent: Boolean(p.savedCurrent),
  };
}

export function participantPublic(p) {
  return {
    id: p.id,
    name: p.name,
    connected: p.connected,
    color: p.color,
    armed: Boolean(p.armed),
    ready: Boolean(p.ready),
    role: p.role || '',
  };
}
export function clipPublic(c) {
  return {
    id: c.id,
    participantId: c.participantId,
    start: c.start,
    duration: c.duration,
    sourceDuration: c.sourceDuration ?? c.duration,
    offset: c.offset ?? 0,
    syncCompensationMs: c.syncCompensationMs ?? 0,
    volume: c.volume,
    peaks: c.peaks,
    url: c.url,
    mimeType: c.mimeType,
    createdAt: c.createdAt,
  };
}
export function recordingPublic(r) {
  return {
    sessionId: r.sessionId,
    participantId: r.participantId,
    startTime: r.startTime,
    endTime: r.endTime,
    startAt: r.startAt,
    stopAt: r.stopAt,
  };
}
export function roomSnapshot(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    hostParticipantId: room.hostParticipantId,
    participants: [...room.participants.values()].map(participantPublic),
    video: room.video,
    player: room.player,
    range: room.range,
    clips: room.clips.map(clipPublic),
    recordings: [...room.recordings.values()].map(recordingPublic),
    party: partyPublic(room),
  };
}
export function broadcastSnapshot(room) { broadcast(room, 'room-state', roomSnapshot(room)); }
export function sendToParticipant(room, participantId, event, data) {
  const list = room.sse.get(participantId);
  if (!list?.size) {
    const queue = room.pendingSignals.get(participantId) || [];
    queue.push({ event, data });
    while (queue.length > 32) queue.shift();
    room.pendingSignals.set(participantId, queue);
    return false;
  }
  for (const res of list) { try { sendSse(res, event, data); } catch {} }
  return true;
}
export function setNotReady(room, id) {
  const p = room.participants.get(id);
  if (p) p.ready = false;
}
export function allConnectedReady(room) {
  const connected = [...room.participants.values()].filter((p) => p.connected);
  return connected.length > 0 && connected.every((p) => p.ready);
}
export function stopParticipantRecording(room, participantId, stopAt = now(), explicitEndTime = null) {
  const recording = room.recordings.get(participantId);
  if (!recording) return null;
  if (recording.timer) clearTimeout(recording.timer);
  const elapsed = Math.max(0, stopAt - recording.startAt) / 1000;
  const measuredEnd = recording.startTime + elapsed;
  const requestedEnd = Number(explicitEndTime);
  const endTime = Number.isFinite(requestedEnd)
    ? Math.max(recording.startTime, Math.min(recording.endTime, requestedEnd))
    : Math.min(recording.endTime, measuredEnd);
  room.recordings.delete(participantId);
  setNotReady(room, participantId);
  touch(room);
  const payload = { participantId, sessionId: recording.sessionId, stopAt, startTime: recording.startTime, endTime };
  broadcast(room, 'recording-stop', payload);
  broadcast(room, 'participant-patch', { participant: participantPublic(room.participants.get(participantId)) });
  return payload;
}
