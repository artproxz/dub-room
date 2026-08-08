import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const src=await readFile('public/app-v13-stage-sync.js','utf8');
const html=await readFile('public/index.html','utf8');
assert.match(src,/stage-player/);
assert.match(src,/v13PushStagePlayer/);
assert.match(src,/v13ApplyStagePlayer/);
assert.match(src,/v13MountRemoteAudio/);
assert.match(src,/syncVoicePeers/);
assert.match(src,/window\.addEventListener\('click'/);
assert.match(src,/\/participant/);
assert.match(src,/party\/start/);
assert.match(src,/v13IsSelect\(\)&&!isHost\(\)/);
assert.match(html,/app-v13-stage-sync\.js\?v=1\.2\.1/);
console.log('✓ DubRoom 1.2.1 client stage sync/voice/ready hotfix wired');
