import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const src = await readFile(new URL('../public/app-v9-transport.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

assert.match(index, /app-v9-transport\.js\?v=0\.9\.0/);
assert.match(src, /window\.addEventListener\('keydown',[\s\S]*?,true\);/);
assert.match(src, /stopImmediatePropagation\(\)/);
assert.match(src, /if\(S\.mode==='recording'\)\{stopOwnRecording\(\);return;\}/);
assert.match(src, /if\(S\.mode==='preview'\)\{await v9TogglePreview\(\);return;\}/);
const moving = src.indexOf("if(v9MoviePlaying()||S.mode==='solo')");
const armed = src.indexOf('if(v8RecordArmed()){startOwnRecording();return;}');
assert.ok(moving >= 0 && armed > moving, 'playing transport must stop before REC arm can start recording');
assert.match(src, /#play-button/);
assert.match(src, /#stop-button/);
assert.match(src, /mix-preview-control/);
assert.doesNotMatch(src.slice(0, src.indexOf('function v9Movie')), /button/);
console.log('✓ DubRoom v0.9 authoritative Space transport static test passed');
