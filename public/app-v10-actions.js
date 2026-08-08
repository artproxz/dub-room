/* DubRoom 1.0 — one delegated action layer so re-renders never leave dead buttons. */
document.addEventListener('click',async(e)=>{
  const b=e.target?.closest?.('#party-ready,#party-start,#party-final,#party-listen,#party-rerecord,#party-edit,#party-editor-close,#party-save,#party-retry,#party-next');
  if(!b)return;e.preventDefault();e.stopImmediatePropagation();
  try{
    if(b.id==='party-ready'){
      if(v10Phase()==='review'&&!v10HasAudio())return toast('Сначала запишите свою роль.',true);
      await saveParticipantPatch({ready:!me()?.ready,armed:false},true);S.localRecordArmed=false;S.voiceSuppressed=false;applyVoicePolicy();v10PatchParty();return;
    }
    if(b.id==='party-start')return await json(`/api/rooms/${S.room.id}/party/start`,{method:'POST',body:JSON.stringify({participantId})});
    if(b.id==='party-final')return await json(`/api/rooms/${S.room.id}/party/final/start`,{method:'POST',body:JSON.stringify({participantId})});
    if(b.id==='party-listen'){S.localRecordArmed=false;const p=me();if(p)p.armed=false;return v9TransportToggle();}
    if(b.id==='party-rerecord')return await v10StartRerecord();
    if(b.id==='party-edit'){S.partyEditorOpen=true;return renderStudio();}
    if(b.id==='party-editor-close'){S.partyEditorOpen=false;return renderStudio();}
    if(b.id==='party-save')return await v10PartyAction('save');
    if(b.id==='party-retry')return await v10PartyAction('retry');
    if(b.id==='party-next')return await v10PartyAction('next');
  }catch(err){toast(err.message||'Не удалось выполнить действие.',true);}
},true);

const v10ActionsPrevParticipantEvent=applyParticipantEvent;
applyParticipantEvent=function(d){v10ActionsPrevParticipantEvent(d);if(S.room?.party)v10PatchParty();};
const v10ActionsPrevClipCreated=applyClipCreated;
applyClipCreated=function(d){v10ActionsPrevClipCreated(d);if(S.room?.party)v10PatchParty();};
const v10ActionsPrevClipDelete=applyClipDelete;
applyClipDelete=function(d){v10ActionsPrevClipDelete(d);if(S.room?.party)v10PatchParty();};
