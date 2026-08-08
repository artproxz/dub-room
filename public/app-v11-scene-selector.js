/* DubRoom 1.1 — full-film scene navigator for fast scene selection. */
S.sceneNav = S.sceneNav || { videoUrl:null, waveform:null, waveformState:'idle', thumbs:[], thumbState:'idle', drag:null, raf:0 };

function v11CanShow(){return Boolean(S.room?.video && v10Phase?.()==='lobby');}
function v11Duration(){return Math.max(.1, Number(S.room?.video?.duration)||videoDuration()||0);}
function v11Pct(t){return clamp((Number(t)||0)/v11Duration()*100,0,100);}
function v11TimeAt(clientX,el){const r=el.getBoundingClientRect();return clamp((clientX-r.left)/Math.max(1,r.width)*v11Duration(),0,v11Duration());}
function v11Range(){return S.sceneNav.drag?.range || S.room.range;}
function v11Seek(t){const m=document.querySelector('#movie');if(!m)return;const x=clamp(t,0,v11Duration());m.currentTime=x;updatePlayhead?.(x);v11PatchPlayhead(x);}
function v11PatchPlayhead(t){const el=document.querySelector('#scene-nav-playhead');if(el)el.style.left=`${v11Pct(t)}%`;const lab=document.querySelector('#scene-nav-cursor');if(lab)lab.textContent=fmt(t,true);}
function v11PatchRange(range=v11Range()){
  const sel=document.querySelector('#scene-nav-selection');if(sel){sel.style.left=`${v11Pct(range.start)}%`;sel.style.width=`${Math.max(.15,v11Pct(range.end)-v11Pct(range.start))}%`;}
  const a=document.querySelector('#scene-nav-start'),b=document.querySelector('#scene-nav-end'),d=document.querySelector('#scene-nav-duration');
  if(a)a.textContent=fmt(range.start,true);if(b)b.textContent=fmt(range.end,true);if(d)d.textContent=`${Math.max(0,range.end-range.start).toFixed(1)} сек`;
}
async function v11SaveRange(range){
  if(!isHost())return;let start=clamp(range.start,0,v11Duration()),end=clamp(range.end,0,v11Duration());if(end<start)[start,end]=[end,start];if(end-start<.25)end=Math.min(v11Duration(),start+.25);
  try{const r=await json(`/api/rooms/${S.room.id}/range`,{method:'POST',body:JSON.stringify({participantId,start,end})});S.room.range={...r.range};v11PatchRange(S.room.range);v10PatchParty?.();}catch(e){toast(e.message,true);v11PatchRange(S.room.range);}
}
function v11Ruler(){const d=v11Duration(),marks=[];for(let i=0;i<=10;i++){const t=d*i/10;marks.push(`<span style="left:${i*10}%">${fmt(t)}</span>`);}return marks.join('');}
function v11WaveBars(){
  const p=S.sceneNav.waveform;if(Array.isArray(p)&&p.length)return p.map((v,i)=>`<i style="height:${Math.max(5,Math.round(v*96))}%;left:${i/p.length*100}%;width:${Math.max(.12,100/p.length*.78)}%"></i>`).join('');
  return Array.from({length:96},(_,i)=>`<i class="placeholder" style="height:${18+((i*37)%58)}%;left:${i/96*100}%;width:.7%"></i>`).join('');
}
function v11Thumbs(){
  if(S.sceneNav.thumbs.length)return S.sceneNav.thumbs.map(x=>`<button class="scene-thumb" data-time="${x.time}" title="${fmt(x.time)}"><img src="${x.src}" alt=""><span>${fmt(x.time)}</span></button>`).join('');
  return Array.from({length:10},(_,i)=>`<div class="scene-thumb skeleton"><span>${fmt(v11Duration()*i/10)}</span></div>`).join('');
}
function v11SelectorHtml(){
  const r=S.room.range,wState=S.sceneNav.waveformState;
  return `<section class="scene-nav" id="scene-nav"><div class="scene-nav-head"><div><b>🎞 ВЫБОР СЦЕНЫ ПО ВСЕМУ ФИЛЬМУ</b><span>Клик — перейти к моменту · тяните красные края — выбрать фрагмент</span></div><div class="scene-nav-meta"><span>курсор <b id="scene-nav-cursor">${fmt(document.querySelector('#movie')?.currentTime||r.start,true)}</b></span><span>сцена <b id="scene-nav-start">${fmt(r.start,true)}</b> → <b id="scene-nav-end">${fmt(r.end,true)}</b></span><strong id="scene-nav-duration">${(r.end-r.start).toFixed(1)} сек</strong></div></div><div class="scene-filmstrip" id="scene-filmstrip">${v11Thumbs()}</div><div class="scene-wave-wrap"><div class="scene-ruler">${v11Ruler()}</div><div class="scene-wave" id="scene-wave">${v11WaveBars()}<div class="scene-selection" id="scene-nav-selection" style="left:${v11Pct(r.start)}%;width:${Math.max(.15,v11Pct(r.end)-v11Pct(r.start))}%"><button class="scene-handle left" data-handle="start" aria-label="Начало"></button><div class="scene-selection-grab" data-handle="move"><span>ОЗВУЧИВАЕМ</span></div><button class="scene-handle right" data-handle="end" aria-label="Конец"></button></div><div class="scene-playhead" id="scene-nav-playhead" style="left:${v11Pct(document.querySelector('#movie')?.currentTime||r.start)}%"></div></div></div><div class="scene-nav-tools"><span class="scene-wave-state ${wState}">${wState==='ready'?'〽 Звуковая форма готова':wState==='loading'?'〽 Анализируем звук…':wState==='failed'?'〽 Waveform недоступен для этого файла':wState==='skipped'?'〽 Waveform выключен для большого файла':'〽 Звуковая форма'}</span>${isHost()?`<button data-scene-jump="-10">← 10с</button><button data-scene-window="15">15 сек вокруг курсора</button><button data-scene-window="30">30 сек вокруг курсора</button><button data-scene-jump="10">10с →</button>${wState==='skipped'?'<button id="scene-wave-build">Построить waveform</button>':''}`:'<span>Фрагмент выбирает ведущий</span>'}</div></section>`;
}
function v11Install(){
  if(!v11CanShow())return;const action=document.querySelector('.party-action.lobby');if(!action||document.querySelector('#scene-nav'))return;action.insertAdjacentHTML('beforebegin',v11SelectorHtml());v11Bind();v11EnsureAssets();
}
function v11Bind(){
  const wave=document.querySelector('#scene-wave');if(wave){wave.addEventListener('pointerdown',e=>{
    if(!isHost())return;const h=e.target.closest?.('[data-handle]');if(h){e.preventDefault();const kind=h.dataset.handle,base={...S.room.range};S.sceneNav.drag={kind,range:{...base},origin:v11TimeAt(e.clientX,wave),base};wave.setPointerCapture?.(e.pointerId);return;}
    if(e.target.closest?.('.scene-selection'))return;v11Seek(v11TimeAt(e.clientX,wave));
  });wave.addEventListener('pointermove',e=>{const drag=S.sceneNav.drag;if(!drag||!isHost())return;const t=v11TimeAt(e.clientX,wave),min=.25;if(drag.kind==='start')drag.range.start=Math.min(t,drag.range.end-min);else if(drag.kind==='end')drag.range.end=Math.max(t,drag.range.start+min);else{const delta=t-drag.origin,len=drag.base.end-drag.base.start;let start=clamp(drag.base.start+delta,0,Math.max(0,v11Duration()-len));drag.range={start,end:start+len};}v11PatchRange(drag.range);});wave.addEventListener('pointerup',e=>{if(!S.sceneNav.drag)return;const range={...S.sceneNav.drag.range};S.sceneNav.drag=null;wave.releasePointerCapture?.(e.pointerId);v11SaveRange(range);});}
  document.querySelectorAll('.scene-thumb[data-time]').forEach(b=>b.addEventListener('click',()=>v11Seek(Number(b.dataset.time))));
  document.querySelectorAll('[data-scene-jump]').forEach(b=>b.addEventListener('click',()=>{const m=document.querySelector('#movie');v11Seek((m?.currentTime||0)+Number(b.dataset.sceneJump));}));
  document.querySelectorAll('[data-scene-window]').forEach(b=>b.addEventListener('click',()=>{const m=document.querySelector('#movie'),len=Number(b.dataset.sceneWindow)||20,mid=clamp(m?.currentTime||0,0,v11Duration());let start=clamp(mid-len*.25,0,Math.max(0,v11Duration()-len));v11SaveRange({start,end:Math.min(v11Duration(),start+len)});}));
  document.querySelector('#scene-wave-build')?.addEventListener('click',()=>v11BuildWaveform(true));
}
async function v11EnsureAssets(){
  const url=S.room?.video?.url;if(!url)return;if(S.sceneNav.videoUrl!==url){S.sceneNav={videoUrl:url,waveform:null,waveformState:'idle',thumbs:[],thumbState:'idle',drag:null,raf:0};}
  if(S.sceneNav.thumbState==='idle')v11BuildThumbs();
  if(S.sceneNav.waveformState==='idle'){const size=Number(S.room.video.size)||0;if(size&&size>180*1024*1024){S.sceneNav.waveformState='skipped';v11RefreshSelector();}else v11BuildWaveform(false);}
}
function v11RefreshSelector(){const old=document.querySelector('#scene-nav');if(!old||!v11CanShow())return;old.outerHTML=v11SelectorHtml();v11Bind();}
async function v11BuildThumbs(){
  if(S.sceneNav.thumbState==='loading'||S.sceneNav.thumbState==='ready')return;S.sceneNav.thumbState='loading';const src=S.room.video.url,d=v11Duration();
  try{const v=document.createElement('video');v.src=src;v.muted=true;v.playsInline=true;v.preload='auto';await new Promise((ok,fail)=>{if(v.readyState>=1)return ok();v.onloadedmetadata=()=>ok();v.onerror=()=>fail(new Error('video'));});const count=12,out=[];for(let i=0;i<count;i++){const t=clamp(d*(i+.5)/count,0,Math.max(0,d-.05));v.currentTime=t;await new Promise((ok)=>{let done=false;const f=()=>{if(done)return;done=true;ok();};v.onseeked=f;setTimeout(f,900);});const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');try{x.drawImage(v,0,0,160,90);out.push({time:t,src:c.toDataURL('image/jpeg',.58)});}catch{}}v.remove();S.sceneNav.thumbs=out;S.sceneNav.thumbState='ready';v11RefreshSelector();}catch{S.sceneNav.thumbState='failed';}
}
async function v11BuildWaveform(force=false){
  if(S.sceneNav.waveformState==='loading'||S.sceneNav.waveformState==='ready')return;const size=Number(S.room.video?.size)||0;if(!force&&size>180*1024*1024){S.sceneNav.waveformState='skipped';v11RefreshSelector();return;}S.sceneNav.waveformState='loading';v11RefreshSelector();
  try{const response=await fetch(S.room.video.url);if(!response.ok)throw new Error('media');const buf=await response.arrayBuffer();const Ctx=window.AudioContext||window.webkitAudioContext,ctx=new Ctx({latencyHint:'playback'});const audio=await ctx.decodeAudioData(buf.slice(0));const ch=audio.getChannelData(0),bins=420,step=Math.max(1,Math.floor(ch.length/bins)),peaks=[];for(let i=0;i<bins;i++){const a=i*step,b=Math.min(ch.length,a+step);let max=0,sum=0,n=0;for(let j=a;j<b;j+=Math.max(1,Math.floor(step/180))){const q=Math.abs(ch[j]);max=Math.max(max,q);sum+=q*q;n++;}peaks.push(Math.min(1,Math.max(max*.72,Math.sqrt(sum/Math.max(1,n)))*2.2));}await ctx.close().catch(()=>{});S.sceneNav.waveform=peaks;S.sceneNav.waveformState='ready';v11RefreshSelector();}catch(e){console.warn('DubRoom waveform unavailable',e);S.sceneNav.waveformState='failed';v11RefreshSelector();}
}

const v11RenderStudioBase=renderStudio;
renderStudio=function(){v11RenderStudioBase();v11Install();};
const v11ApplyRangeBase=applyRangeEvent;
applyRangeEvent=function(d){v11ApplyRangeBase(d);if(document.querySelector('#scene-nav'))v11PatchRange(S.room.range);};
document.addEventListener('timeupdate',e=>{if(e.target?.id==='movie'&&document.querySelector('#scene-nav'))v11PatchPlayhead(e.target.currentTime);},true);
setTimeout(v11Install,0);
