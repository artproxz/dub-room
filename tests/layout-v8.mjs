import assert from 'node:assert/strict';
await import('../public/layout-v8.js');
const {assignLanes,trimLeft,trimRight}=globalThis.DubRoomLayout;
const clips=[
  {id:'a',start:10,duration:4},
  {id:'b',start:11,duration:1},
  {id:'c',start:12,duration:3},
  {id:'d',start:15,duration:1},
];
const layout=assignLanes(clips);const lanes=Object.fromEntries(layout.map(x=>[x.clip.id,x.lane]));
assert.equal(lanes.a,0);assert.equal(lanes.b,1);assert.equal(lanes.c,1);assert.equal(lanes.d,0);
const base={start:10,duration:4,sourceDuration:5,offset:0.5};
assert.deepEqual(trimLeft(base,1),{start:11,offset:1.5,duration:3,sourceDuration:5});
assert.deepEqual(trimRight(base,-1),{duration:3,sourceDuration:5});
assert.equal(trimRight(base,9).duration,4.5);
console.log('✓ DubRoom v0.8 lane/trim layout passed');
