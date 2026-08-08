import { readFile } from 'node:fs/promises';import assert from 'node:assert/strict';
const party=await readFile('public/app-v10-party.js','utf8');const actions=await readFile('public/app-v10-actions.js','utf8');const html=await readFile('public/index.html','utf8');const css=await readFile('public/app-v10.css','utf8');
for(const needle of ['Готов к озвучке','party-record-start','ПОСМОТРЕТЬ ИТОГ','Перезаписать','Подправить','Ещё один дубль','Следующая сцена','слышите друг друга'])assert.ok(party.includes(needle),`missing ${needle}`);
assert.ok(party.includes("v10Phase()!=='recording'&&v10Phase()!=='preview'"),'voice lobby policy missing');
assert.ok(css.includes('.party-own-editor .track-tab-v8:not(.self)'),'foreign editor tabs must stay hidden before reveal');
assert.ok(actions.includes('stopImmediatePropagation'),'delegated party actions must survive rerenders');
assert.ok(html.includes('/app-v10-party.js?v=1.0.0')&&html.includes('/app-v10-actions.js?v=1.0.0')&&html.includes('/app-v10.css?v=1.0.0'));
console.log('✓ DubRoom 1.0 surprise party UI static checks passed');
