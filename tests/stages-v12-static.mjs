import { readFile } from 'node:fs/promises';import assert from 'node:assert/strict';
const js=await readFile('public/app-v12-stages.js','utf8'),css=await readFile('public/app-v12.css','utf8'),html=await readFile('public/index.html','utf8');
for(const x of ['select:1','roles:2','recording:3','review:4','preview:5','result:6','СЦЕНА ВЫБРАНА','ГОТОВ К ОЗВУЧКЕ','ПОСМОТРЕТЬ ИТОГ','v12BuildLocalThumbs','v12BuildWaveform'])assert.ok(js.includes(x),`missing ${x}`);
assert.ok(css.includes('position:fixed;inset:0'),'desktop flow must stay on one screen');
assert.ok(css.includes('.v12-local-strip'),'local scene frames missing');
assert.ok(html.includes('/app-v12-stages.js?v=1.2.0')&&html.includes('/app-v12.css?v=1.2.0'));
assert.ok(!html.includes('app-v11-scene-selector.js'),'old stacked selector must not load');
console.log('✓ DubRoom 1.2 staged one-screen UI checks passed');
