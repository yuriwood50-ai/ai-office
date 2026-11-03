'use strict';
const path = require('node:path');
const fs = require('node:fs');
function 첨부읽기(bytes, hint, 환경 = process.env) {
  // Mock에서는 이 함수가 호출되지 않아요. 해석기는 실제 첨부 읽기 시에만 불러요.
  const { spawn } = require('node:child_process');
  const bundled = path.join(환경.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python = 환경.OFFICE_PYTHON || (fs.existsSync(bundled) ? bundled : 'python');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(__dirname, 'attachments.py'), String(hint).slice(0, 800)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...환경, PYTHONIOENCODING: 'utf-8' } });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('첨부 읽기 시간이 초과됐어요.')); }, 30000);
    child.stdout.on('data', b => { output += b.toString('utf8'); if (output.length > 1000000) child.kill(); });
    child.on('error', e => { clearTimeout(timer); reject(e); }); child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timer); try { const r = JSON.parse(output); if (code !== 0 || r.error) throw new Error(r.error || '첨부 해석 실패'); resolve(r.text); } catch(e) { reject(e); } });
    child.stdin.end(bytes);
  });
}
module.exports = { 첨부읽기 };
