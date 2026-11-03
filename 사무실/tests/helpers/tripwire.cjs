// 시험용 안전망: 외부 프로세스 실행과 네트워크 호출을 '호출되면 즉시 실패'로 바꿔요. (실제 Codex/Claude가 실행될 길을 막는 용도)
// 서버를 자식 프로세스로 띄울 때는 NODE_OPTIONS=--require 로 이 파일을 먼저 불러와요. 걸리면 TRIPWIRE_LOG 파일에 적어요.
'use strict';
const fs = require('node:fs');
const cp = require('node:child_process');

const 걸린기록 = [];
function 기록(이름, 인자) {
  const 줄 = `${new Date().toISOString()} ${이름} ${String(인자?.[0] ?? '').slice(0, 120)}`;
  걸린기록.push(줄);
  if (process.env.TRIPWIRE_LOG) { try { fs.appendFileSync(process.env.TRIPWIRE_LOG, 줄 + '\n'); } catch { /* 기록 실패는 무시 */ } }
}
const 원본 = {};
for (const 이름 of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  원본[이름] = cp[이름];
  cp[이름] = function (...인자) { 기록(`child_process.${이름}`, 인자); throw new Error(`시험 안전망: 외부 프로세스 실행 시도 (${이름})`); };
}
if (typeof globalThis.fetch === 'function' && process.env.TRIPWIRE_FETCH !== 'allow') {
  globalThis.fetch = function (...인자) { 기록('fetch', 인자); return Promise.reject(new Error('시험 안전망: 네트워크 호출 시도 (fetch)')); };
}

module.exports = { 걸린기록, 원본 };
