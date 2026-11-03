// 직원 실행기: office.config.json의 직원별 담당 AI(Claude/Codex)에 맞춰 알맞은 명령으로 실행해요.
// planner.js, writer.js가 같은 방식으로 불러 쓰고, 결과는 두 AI 모두 `output` 파일(JSON)로 받아요.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const error = (status, message) => Object.assign(new Error(message), { status });

const 지원AI = ['Claude', 'Codex'];
const 클로드추론강도 = ['low', 'medium', 'high', 'xhigh', 'max']; // claude --help의 --effort 목록
const 이름모양 = /^[A-Za-z0-9._:\-[\]]{1,64}$/;

function 직원설정(설정, id, 방 = 'blog') {
  const 직원 = (설정.방 || []).find(r => r.id === 방)?.직원?.find(s => s.id === id);
  if (!직원) throw error(400, `office.config.json에 직원 "${id}"가 없어요.`);
  const AI = 직원.AI;
  if (!지원AI.includes(AI)) throw error(400, `직원 "${id}"의 담당 AI는 Claude 또는 Codex여야 해요 (지금: ${AI}).`);
  const 모델 = String(직원.모델 || '').trim(), 추론강도 = String(직원.추론강도 || '').trim();
  if (모델 && !이름모양.test(모델)) throw error(400, `직원 "${id}"의 모델 이름 모양이 올바르지 않아요.`);
  if (추론강도 && !(AI === 'Claude' ? 클로드추론강도.includes(추론강도) : /^[a-z]{3,10}$/.test(추론강도))) {
    throw error(400, `직원 "${id}"의 추론강도가 올바르지 않아요${AI === 'Claude' ? ` (${클로드추론강도.join('/')})` : ''}.`);
  }
  return { id, AI, 모델, 추론강도 };
}

function 실행파일찾기(이름들) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) for (const 이름 of 이름들) {
    const exe = path.join(dir, 이름); if (dir && fs.existsSync(exe)) return exe;
  }
  return null;
}

// Codex는 npm으로 설치된 codex.js를 node로 직접 실행해요 (PowerShell 스크립트·cmd 우회 문제를 피해요).
function codex찾기() {
  const js = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (fs.existsSync(js)) return { command: process.execPath, args: [js] };
  const exe = 실행파일찾기([process.platform === 'win32' ? 'codex.exe' : 'codex']);
  if (exe) return { command: exe, args: [] };
  throw error(503, 'Codex 실행 프로그램을 찾지 못했어요. Codex CLI 설치와 로그인을 확인해 주세요.');
}

function claude찾기() {
  const exe = 실행파일찾기([process.platform === 'win32' ? 'claude.exe' : 'claude'])
    || [path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')].find(p => fs.existsSync(p));
  if (exe) return { command: exe, args: [] };
  throw error(503, 'Claude 실행 프로그램을 찾지 못했어요. Claude Code 설치와 로그인을 확인해 주세요.');
}

// 실행 전에 프로그램이 있는지 미리 확인해요 (없으면 바로 알려줘요).
function 확인(AI) { return AI === 'Claude' ? claude찾기() : codex찾기(); }

// 폴더/파일을 Claude 읽기 허용 규칙으로 바꿔요. 예: C:\a\b → Read(//c/a/b/**)
function 읽기규칙(경로) {
  const p = path.resolve(경로);
  const 드라이브 = /^([A-Za-z]):/.exec(p);
  let 상대 = (드라이브 ? p.slice(2) : p).replace(/\\/g, '/');
  if (/[(),]/.test(상대)) throw error(400, `읽기 경로에 쓸 수 없는 글자가 있어요: ${경로}`);
  let 폴더 = false; try { 폴더 = fs.statSync(p).isDirectory(); } catch { /* 글롭(*)이거나 아직 없는 경로 */ }
  return `Read(//${드라이브 ? 드라이브[1].toLowerCase() : ''}${상대.replace(/\/$/, '')}${폴더 ? '/**' : ''})`;
}

/**
 * 직원 한 명을 실행해요.
 * 설정: 직원설정() 결과 / 웹검색: true면 웹 검색 허용 / schemaPath: 결과 JSON 스키마 파일
 * output: 결과 JSON을 저장할 파일 / 읽기: 읽기만 열 경로들 / 쓰기: 쓰기까지 열 폴더들
 */
function 실행({ 설정, 웹검색 = false, prompt, schemaPath, output, cwd, 읽기 = [], 쓰기 = [], 도구없음 = false }) {
  if (도구없음 && 설정.AI !== 'Claude') throw error(400, '도구 없는 공고 검증은 현재 Claude로 연결돼요.');
  return 설정.AI === 'Claude'
    ? claude실행({ 설정, 웹검색, prompt, schemaPath, output, cwd, 읽기, 쓰기, 도구없음 })
    : codex실행({ 설정, 웹검색, prompt, schemaPath, output, cwd, 쓰기 });
}

function codex실행({ 설정, 웹검색, prompt, schemaPath, output, cwd, 쓰기 }) {
  const c = codex찾기();
  const args = [...c.args, 'exec', '--sandbox', 쓰기.length ? 'workspace-write' : 'read-only',
    '-c', 'approval_policy="never"', '-c', `web_search="${웹검색 ? 'live' : 'disabled'}"`,
    '--skip-git-repo-check', '--ephemeral', '--json', '--output-schema', schemaPath, '--output-last-message', output];
  if (설정.모델) args.push('-m', 설정.모델);
  if (설정.추론강도) args.push('-c', `model_reasoning_effort="${설정.추론강도}"`);
  for (const dir of 쓰기) args.push('--add-dir', dir);
  args.push('-');
  const child = spawn(c.command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return child;
}

function claude실행({ 설정, 웹검색, prompt, schemaPath, output, cwd, 읽기, 쓰기, 도구없음 }) {
  const c = claude찾기();
  const 도구 = 도구없음 ? [] : ['Read', 'Glob', 'Grep', ...(쓰기.length ? ['Write', 'Edit'] : []), ...(웹검색 ? ['WebSearch', 'WebFetch'] : [])];
  const 허용 = [...읽기.map(읽기규칙), ...(웹검색 ? ['WebSearch', 'WebFetch'] : [])];
  // --safe-mode: 이 컴퓨터의 CLAUDE.md·스킬·플러그인·MCP를 끄고 시작해요 (직원은 카드만 읽어요. 시작 문맥도 크게 줄어요).
  // --permission-prompts none: 허락을 물어볼 상황이면 묻지 않고 거부해요. 쓰기는 --add-dir 폴더(와 cwd)에서만 돼요.
  const args = [...c.args, '-p', '--safe-mode', '--strict-mcp-config', '--tools', 도구.join(','),
    '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--no-session-persistence',
    '--output-format', 'json', '--json-schema', JSON.stringify(JSON.parse(fs.readFileSync(schemaPath, 'utf8')))];
  if (허용.length) args.push('--allowedTools', 허용.join(','));
  for (const dir of 쓰기) args.push('--add-dir', dir);
  if (설정.모델) args.push('--model', 설정.모델);
  if (설정.추론강도) args.push('--effort', 설정.추론강도);
  const child = spawn(c.command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  // claude -p는 끝날 때 JSON 한 덩어리를 내보내요. 그 안의 structured_output을 결과 파일로 저장해요.
  // (planner/writer의 'close' 처리보다 먼저 실행되도록 여기서 먼저 등록해요.)
  const chunks = []; let size = 0;
  child.stdout.on('data', d => { if (size < 5e6) { chunks.push(d); size += d.length; } });
  child.on('close', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    try {
      const j = JSON.parse(text);
      if (j.structured_output && typeof j.structured_output === 'object') { fs.writeFileSync(output, JSON.stringify(j.structured_output, null, 2)); return; }
      child.stderr.emit('data', Buffer.from(`Claude 결과 없음: ${String(j.result ?? j.subtype ?? '').slice(0, 500)}`));
    } catch { child.stderr.emit('data', Buffer.from(`Claude 출력을 읽지 못했어요: ${text.slice(0, 500)}`)); }
  });
  return child;
}

module.exports = { 직원설정, 확인, 실행, codex찾기, claude찾기, 읽기규칙, 지원AI };
