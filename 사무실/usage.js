// 모델 호출 기록: 직원이 실행될 때마다 작업\사용량.jsonl에 한 줄씩 남겨요. (기록만 하고 동작은 바꾸지 않아요)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Codex 컴퓨터 설정(~/.codex/config.toml)의 맨 위 model·추론 강도만 읽어요. 키·토큰은 읽지 않아요.
function codex기본설정() {
  try {
    const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
    const top = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const out = {};
    for (const line of top) {
      if (/^\s*\[/.test(line)) break;
      const m = /^\s*(model|model_reasoning_effort)\s*=\s*"([^"]*)"/.exec(line);
      if (m) out[m[1]] = m[2];
    }
    return { 모델: out.model || '설정 없음(Codex 기본값)', 추론강도: out.model_reasoning_effort || '설정 없음' };
  } catch { return { 모델: '확인 못 함', 추론강도: '확인 못 함' }; }
}

// 직원 설정(모델·추론강도 칸)이 비어 있으면 각 도구의 기본값을 기록해요.
function 모델정보(설정) {
  if (설정.AI === 'Codex') {
    const d = codex기본설정();
    return { 모델: 설정.모델 || d.모델, 추론강도: 설정.추론강도 || d.추론강도 };
  }
  return { 모델: 설정.모델 || 'Claude 기본값', 추론강도: 설정.추론강도 || '기본값' };
}

// claude -p --output-format json 의 마지막 JSON 한 덩어리에서 토큰을 읽어요.
// 입력 = 캐시 안 된 입력 + 캐시 읽기 + 캐시 만들기. (Codex의 입력 토큰은 캐시를 포함해서, 같은 기준으로 맞췄어요.)
function claude계량기() {
  const parts = []; let size = 0;
  return {
    feed(chunk) { if (size < 5e6) { parts.push(chunk); size += chunk.length; } },
    끝() {
      try {
        const j = JSON.parse(Buffer.concat(parts).toString('utf8'));
        const u = j.usage; if (!u) return { 토큰: null, 웹검색: 0 };
        const 읽기 = u.cache_read_input_tokens || 0, 만들기 = u.cache_creation_input_tokens || 0;
        return {
          토큰: { 입력: (u.input_tokens || 0) + 읽기 + 만들기, 캐시: 읽기, 캐시생성: 만들기, 출력: u.output_tokens || 0, 추론출력: u.output_tokens_details?.thinking_tokens || 0 },
          웹검색: u.server_tool_use?.web_search_requests || 0, 웹열기: u.server_tool_use?.web_fetch_requests || 0,
          실제모델: Object.keys(j.modelUsage || {})[0], 환산비용USD: j.total_cost_usd,
        };
      } catch { return { 토큰: null, 웹검색: 0 }; }
    },
  };
}

// codex exec --json 출력을 한 줄씩 받아서 토큰과 웹 검색 횟수를 세요. (AI가 Claude면 claude계량기를 써요)
function 계량기(AI = 'Codex') {
  if (AI === 'Claude') return claude계량기();
  let buf = '', 턴 = 0, 웹 = 0;
  const t = { 입력: 0, 캐시: 0, 출력: 0, 추론출력: 0 };
  function line(text) {
    try {
      const e = JSON.parse(text);
      if (e.type === 'turn.completed' && e.usage) {
        턴++;
        t.입력 += e.usage.input_tokens || 0; t.캐시 += e.usage.cached_input_tokens || 0;
        t.출력 += e.usage.output_tokens || 0; t.추론출력 += e.usage.reasoning_output_tokens || 0;
      } else if (e.type === 'item.completed' && e.item?.type === 'web_search') 웹++;
    } catch { /* JSON이 아닌 줄은 무시해요 */ }
  }
  return {
    feed(chunk) { buf += chunk.toString(); const lines = buf.split('\n'); buf = lines.pop().slice(-100000); lines.forEach(line); },
    끝() { if (buf) line(buf); buf = ''; return { 토큰: 턴 ? { ...t } : null, 웹검색: 웹 }; },
  };
}

// 한 줄 기록. 기록이 실패해도 직원 실행에는 영향을 주지 않아요.
function 기록(root, 항목) {
  try {
    const { 토큰, ...나머지 } = 항목;
    const 줄 = {
      시각: new Date().toISOString(), ...나머지,
      토큰: 토큰 || null, 토큰기록: 토큰 ? '있음' : '없음',
    };
    fs.mkdirSync(path.join(root, '작업'), { recursive: true });
    fs.appendFileSync(path.join(root, '작업', '사용량.jsonl'), JSON.stringify(줄) + '\n');
  } catch (e) { console.error('사용량 기록 실패:', e.message); }
}

module.exports = { 기록, 계량기, 모델정보, codex기본설정 };
