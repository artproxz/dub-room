import { readFile } from 'node:fs/promises';import assert from 'node:assert/strict';
const js=await readFile('public/app-v11-scene-selector.js','utf8');const css=await readFile('public/app-v11.css','utf8');const html=await readFile('public/index.html','utf8').catch(()=> '');
for(const needle of ['ВЫБОР СЦЕНЫ ПО ВСЕМУ ФИЛЬМУ','scene-filmstrip','scene-wave','data-handle="start"','data-handle="end"','v11BuildThumbs','decodeAudioData','v11SaveRange','15 сек вокруг курсора','30 сек вокруг курсора'])assert.ok(js.includes(needle),`missing ${needle}`);
assert.ok(js.includes("/range`"),'selector must persist range through room range endpoint');
assert.ok(js.includes('180*1024*1024'),'large-file waveform guard missing');
for(const needle of ['.scene-selection','.scene-handle','.scene-playhead','.scene-filmstrip'])assert.ok(css.includes(needle),`missing css ${needle}`);
console.log('✓ DubRoom 1.1 full-film scene selector static checks passed');
