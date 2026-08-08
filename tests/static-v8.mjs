import { readFile } from 'node:fs/promises';import assert from 'node:assert/strict';
const [html,js,css,boot]=await Promise.all(['public/index.html','public/app-v8-patch.js','public/app-v8.css','public/bootstrap-v8.js'].map(f=>readFile(f,'utf8')));
assert.match(html,/bootstrap-v8\.js\?v=0\.8\.0/);assert.match(html,/layout-v8\.js\?v=0\.8\.0/);assert.match(html,/app-v8-patch\.js\?v=0\.8\.0/);
assert.match(js,/track-tab-v8/);assert.match(js,/x-sync-comp-ms/);assert.match(js,/data-trim/);assert.match(js,/stopImmediatePropagation/);assert.match(css,/stack-scroll-v8/);assert.match(boot,/sessionStorage/);
console.log('✓ DubRoom v0.8 static wiring passed');
