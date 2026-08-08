import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = await readFile('public/app-v7-patch.js', 'utf8');
let resolveServer;
let requestBody;
let localStarted = false;
const participantId = 'u1';
const movie = { currentTime: 12.25, pause(){}, play(){ return Promise.resolve(); } };
const S = {
  filmVolume: .8,
  room: { id:'ROOM1', range:{start:10,end:16}, recordings:[], participants:[{id:participantId,armed:true}], clips:[] },
  mode:'idle', localSession:null, micStream:{active:true}, audioContext:null, _armSyncPromise:Promise.resolve(true),
  playbackTimers:[], playbackAudios:[], levelHistory:new Map(), lastLevelSentAt:0,
};
const context = vm.createContext({
  S, participantId,
  localStorage:{getItem(){return null;},setItem(){}},
  crypto:globalThis.crypto,
  AudioContext:function(){},
  navigator:{mediaDevices:{}},
  performance,
  MediaRecorder:class { constructor(){this.state='inactive';this.mimeType='audio/webm';} start(){this.state='recording';localStarted=true;} stop(){this.state='inactive';this.onstop?.();} },
  window:{addEventListener(){}},
  document:{querySelector(sel){return sel==='#movie'?movie:null;},querySelectorAll(){return[];}},
  console,
  setTimeout,clearTimeout,
  clamp:(v,a,b)=>Math.max(a,Math.min(b,Number(v))),
  bindStudio(){},
  me:()=>S.room.participants[0],
  stopPlaybackOnly(){},
  cursorStart:()=>movie.currentTime,
  updatePlayhead(){},
  applyVoicePolicy(){},
  syncRecordingDom(){},
  patchParticipant(){},
  updateControls(){},
  clearOverlay(){},
  toast(){},
  saveParticipantPatch:()=>Promise.resolve(),
  pickMime:()=>'',
  json(_url,options){requestBody=JSON.parse(options.body);return new Promise(r=>{resolveServer=r;});},
  playVoiceClips(){},clearPlaybackAudio(){},temporarilyMuteLobby(){},
  renderPlayers(){return'';},renderTimeline(){return'';},videoDuration(){return 100;},bindTimelineOnly(){},updateAllUi(){},syncClipDom(){},syncVoicePeers(){},
  esc:String,fmt:String,sizeFmt:String,isHost:()=>true,allReady:()=>false,spaceHint:()=>'',
});
vm.runInContext(source, context);
const run = context.startOwnRecording();
assert.equal(localStarted, true, 'local recording must start before server response');
await new Promise(r=>setTimeout(r,0));
assert.equal(requestBody.startTime, 12.25);
assert.equal(typeof requestBody.sessionId, 'string');
assert.ok(requestBody.sessionId.length >= 6);
resolveServer({sessionId:requestBody.sessionId,startTime:12.25,endTime:16,startAt:Date.now(),stopAt:Date.now()+4000});
await run;
await Promise.resolve();
clearTimeout(S.stopTimer); if(S.recorder) S.recorder.onstop=null;
console.log('✓ DubRoom v0.7 instant-start test passed');