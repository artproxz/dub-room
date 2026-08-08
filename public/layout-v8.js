(function(g){
  function sourceDuration(clip){return Math.max(0.05,Number(clip?.sourceDuration)||Number(clip?.duration)||0.05);}
  function clipOffset(clip){return Math.max(0,Number(clip?.offset)||0);}
  function assignLanes(clips){
    const sorted=[...(clips||[])].sort((a,b)=>(Number(a.start)||0)-(Number(b.start)||0)||String(a.id||'').localeCompare(String(b.id||'')));
    const ends=[];
    return sorted.map(clip=>{
      const start=Number(clip.start)||0,end=start+Math.max(.01,Number(clip.duration)||0);
      let lane=ends.findIndex(v=>start>=v-.002);
      if(lane<0){lane=ends.length;ends.push(end);}else ends[lane]=end;
      return{clip,lane};
    });
  }
  function trimLeft(clip,delta){
    const src=sourceDuration(clip),offset=clipOffset(clip),start=Math.max(0,Number(clip.start)||0),duration=Math.max(.05,Number(clip.duration)||.05);
    const minDelta=Math.max(-offset,-start),maxDelta=Math.max(minDelta,duration-.05),d=Math.max(minDelta,Math.min(maxDelta,Number(delta)||0));
    return{start:start+d,offset:offset+d,duration:duration-d,sourceDuration:src};
  }
  function trimRight(clip,delta){
    const src=sourceDuration(clip),offset=clipOffset(clip),duration=Math.max(.05,Number(clip.duration)||.05);
    const next=Math.max(.05,Math.min(src-offset,duration+(Number(delta)||0)));
    return{duration:next,sourceDuration:src};
  }
  g.DubRoomLayout={assignLanes,sourceDuration,clipOffset,trimLeft,trimRight};
})(globalThis);
