'use strict';
// 공고 정보센터 화면. office.js의 만들기()·시간표시()를 그대로 써요. 화면에 들어가는 글은 전부 textContent로 넣어요(공고 내용이 코드로 실행되지 않게).

const 공고 = {
  검색종류: 'instructor', 종류목록: null, 지침: null, 보고: null,
  활성: false, 화면: '메인', 선택: null, 요청중: false, 서명: '', 메시지: '', 오류: '', 불러오는중: false,
  개요: null, 목록: null, 상세: null, 기관: null, 설정: null, 실행: null,
  필터: { 보기: '추천', 분야: '', 판정: '', 검증상태: '', 지원상태: '', 임박: '', 정렬: '마감' },
  열린실행: null, 기관추가열림: false, 등록열림: false,
};
const 공고패널 = () => document.getElementById('공고패널');
const 지원상태들 = ['관심', '검토 중', '지원 준비', '지원 완료', '결과 대기', '선정', '미선정', '보류'];
const 기관유형들 = ['평생학습관', '도서관', '주민센터', '여성회관', '문화재단', '콘텐츠진흥기관', '학교', '청소년기관', '공공 교육기관', '창작 지원기관', '기타 공식 모집기관'];

async function 공고요청(경로, 본문) {
  const 옵션 = 본문 === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Request': '1' }, body: JSON.stringify(본문) };
  const url = new URL(`/api/notice/${경로}`, location.origin); url.searchParams.set('종류', 공고.검색종류);
  const r = await fetch(url, 옵션);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.오류 || `요청을 처리하지 못했어요 (${r.status})`);
  return j;
}

// ---- 작은 부품들 ------------------------------------------------------
const 칩 = (글, 종류 = '') => 만들기('span', `chip n-chip ${종류}`, 글);
const 판정색 = (v) => ({ '적합': 'good', '확인 필요': 'warn', '부적합': 'bad' }[v] || 'muted');
const 상태색 = (v) => ({ '접수 마감': 'muted', '신규': 'info', '수정': 'warn', '마감 연장': 'warn', '재공고': 'info' }[v] || '');
function 버튼(글, 눌림, 클래스 = '') { const b = 만들기('button', 클래스, 글); b.type = 'button'; b.onclick = 눌림; if (공고.요청중) b.disabled = true; return b; }
function 안전링크(url) { try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') && !/\.invalid$/i.test(u.hostname) ? u.href : null; } catch { return null; } }
function 마감글(x) {
  if (x.마감날짜) return `${x.마감날짜}${x.마감시각 ? ' ' + x.마감시각 : ' (시각 미확인)'}`;
  return `${x.마감표기 && x.마감표기 !== '미확인' ? x.마감표기 : '미확인'} (날짜 확인 필요)`;
}
function 남은칩(x) {
  if (x.공고상태 === '접수 마감') return 칩('마감', 'muted');
  if (x.남은일수 === null || x.남은일수 === undefined) return 칩('마감일 미확인', 'warn');
  return 칩(x.남은일수 === 0 ? '오늘 마감' : `D-${x.남은일수}`, x.남은일수 <= (공고.개요?.설정?.마감임박일 || 7) ? 'warn' : '');
}
function 표지칩들(x) {
  const 목록 = [];
  if (x.시험용) 목록.push(칩('시험용 (가짜)', 'fake'));
  if (!x.노출) 목록.push(칩(`추천 안 함: ${x.노출사유}`, 'muted'));
  if (x.미처리) 목록.push(칩('AI 검증 미처리', 'warn'));
  if (x.중복후보) 목록.push(칩('중복 후보', 'warn'));
  return 목록;
}
function 공고줄(x) {
  const 행 = 만들기('div', 'n-row');
  const 제목 = 만들기('button', 'n-link', x.공고명); 제목.type = 'button'; 제목.onclick = () => 상세열기(x.id);
  const 줄2 = 만들기('div', 'n-sub');
  줄2.append(만들기('span', '', `${x.기관명} · ${마감글(x)}`), 남은칩(x));
  if (공고.검색종류 !== 'housing') 줄2.append(칩(x.판정, 판정색(x.판정)));
  if (x.공고상태 !== '기존') 줄2.append(칩(x.공고상태, 상태색(x.공고상태)));
  if (x.지원상태) 줄2.append(칩(`지원: ${x.지원상태}`, 'info'));
  줄2.append(...표지칩들(x));
  행.append(제목, 줄2);
  return 행;
}
function 카드(제목, 개수, 자식들, 빈말) {
  const c = 만들기('section', 'n-card');
  const h = 만들기('h3', '', 제목); if (개수 !== null) h.append(만들기('span', 'n-count', ` ${개수}`));
  c.append(h);
  if (!자식들.length) c.append(만들기('p', 'hint', 빈말 || '없어요'));
  else c.append(...자식들);
  return c;
}
function 표(머리, 행들) {
  const 틀 = 만들기('div', 'n-table-wrap'); const t = 만들기('table', 'n-table');
  const th = 만들기('tr'); 머리.forEach((m) => th.append(만들기('th', '', m))); t.append(만들기('thead').appendChild(th).parentNode);
  const tb = 만들기('tbody'); 행들.forEach((r) => { const tr = 만들기('tr'); r.forEach((c) => { const td = 만들기('td'); if (c instanceof Node) td.append(c); else td.textContent = c ?? ''; tr.append(td); }); tb.append(tr); });
  t.append(tb); 틀.append(t); return 틀;
}

// ---- 데이터 가져오기 --------------------------------------------------
async function 공고새로고침(강제) {
  if (공고.불러오는중 || !공고.활성) return;
  공고.불러오는중 = true;
  try {
    if (!공고.종류목록) 공고.종류목록 = (await 공고요청('profiles')).종류;
    공고.개요 = await 공고요청('overview');
    if (공고.화면 === '지침') 공고.지침 = await 공고요청('instructions');
    if (공고.화면 === '보고') 공고.보고 = await 공고요청('report');
    if (공고.화면 === '목록') { const q = new URLSearchParams(Object.entries(공고.필터).filter(([, v]) => v)); 공고.목록 = await 공고요청(`list?${q}`); }
    if (공고.화면 === '상세' && 공고.선택) 공고.상세 = await 공고요청(`notices/${encodeURIComponent(공고.선택)}`);
    if (공고.화면 === '기관') 공고.기관 = (await 공고요청('institutions')).기관;
    if (공고.화면 === '설정') 공고.설정 = await 공고요청('settings');
    if (공고.화면 === '실행') 공고.실행 = (await 공고요청('runs')).실행;
    if (공고.오류출처 === '새로고침') { 공고.오류 = ''; 공고.오류출처 = ''; }
  } catch (e) { 공고.오류 = e.message; 공고.오류출처 = '새로고침'; }
  finally { 공고.불러오는중 = false; }
  공고그리기패널(강제);
}

function 공고화면전환(공고방) {
  for (const 선택자 of ['header .actions', '.optional-notes', '.info', '#글쓰기패널']) { const e = document.querySelector(선택자); if (e) e.hidden = 공고방; }
  if (공고방) for (const id of ['기획패널', '작업상세']) { const e = document.getElementById(id); if (e) e.hidden = true; }
  공고패널().hidden = !공고방;
  document.getElementById('모드표시').hidden = !공고방;
  공고.활성 = 공고방;
}

function 공고그리기(방) { // office.js의 그리기()가 4초마다 불러요
  if (!공고.활성) return;
  공고새로고침(false);
}

// ---- 동작 ------------------------------------------------------------
async function 동작(할일, 성공말) {
  if (공고.요청중) return;
  공고.요청중 = true; 공고.오류 = ''; 공고.메시지 = ''; 공고그리기패널(true);
  try { const r = await 할일(); if (성공말) 공고.메시지 = typeof 성공말 === 'function' ? 성공말(r) : 성공말; }
  catch (e) { 공고.오류 = e.message; 공고.오류출처 = '동작'; }
  finally { 공고.요청중 = false; }
  공고.서명 = ''; await 공고새로고침(true);
}
function 상세열기(id) { 공고.화면 = '상세'; 공고.선택 = id; 공고.상세 = null; 공고.서명 = ''; 공고새로고침(true); }
function 화면가기(이름) { 공고.화면 = 이름; 공고.서명 = ''; 공고.메시지 = ''; 공고.오류 = ''; 공고새로고침(true); }

const 점검요약 = (r) => `${r.종류} 끝: 기관 ${r.지표.대상기관}곳 중 완료 ${r.지표.완료}, 접속 실패 ${r.지표.접속실패}, 추출 실패 ${r.지표.추출실패}, 검증 필요 ${r.지표.검증필요}, 신규 ${r.지표.신규}, 변경 ${r.지표.변경}${r.누락기록수 ? `, 누락 기록 ${r.누락기록수}` : ''} (AI 호출 0회)`;
const 검증요약 = (r) => `검증 끝: AI 호출 ${r.AI호출.횟수}회, 재사용 ${r.AI호출.재사용}건, 검증됨 ${r.지표.검증됨}건, 미처리 ${r.지표.미처리}건${r.중단이유 ? ` — ${r.중단이유}` : ''}`;

function 작업줄() {
  const 줄 = 만들기('div', 'n-actions');
  const 계획 = 공고.개요?.계획; const mock = 공고.개요?.모드 === 'mock';
  줄.append(
    버튼('게시판 점검', () => 동작(() => 공고요청('collect', {}), 점검요약), 'primary'),
    버튼('30일 재확인', () => 동작(() => 공고요청('recheck', {}), 점검요약)),
    버튼(`검증 실행${계획 ? ` (예상 AI 호출 ${계획.예상호출수}회)` : ''}`, () => 동작(() => 공고요청('verify', { 확인호출수: 계획?.예상호출수 }), 검증요약), 'primary'),
    버튼('공고 직접 등록', () => { 공고.등록열림 = !공고.등록열림; 공고.서명 = ''; 공고그리기패널(true); }),
  );
  if (공고.개요?.실행중) 줄.append(버튼('중지', () => 동작(() => 공고요청('run/stop', {}), '중지를 요청했어요')));
  if (mock && 공고.개요 && 공고.개요.기관수 === 0) 줄.append(버튼('시험 자료 채우기', () => 동작(() => 공고요청('mock/seed', {}), (r) => `시험용 가짜 기관 ${r.추가한기관}곳을 채웠어요. 게시판 점검을 눌러 보세요.`)));
  if (!mock) 줄.append(버튼('공식 사이트 목록 연결', () => 동작(() => 공고요청('sources/seed', {}), r => r.안내)));
  return 줄;
}

function 검색종류선택() {
  const row = 만들기('div', 'n-actions');
  for (const p of 공고.종류목록 || []) row.append(버튼(p.이름, async () => {
    if (공고.불러오는중 || 공고.요청중) return;
    공고.검색종류 = p.id; 공고.선택 = null; 공고.개요 = null; 공고.목록 = null; 공고.상세 = null;
    공고.기관 = null; 공고.설정 = null; 공고.실행 = null; 공고.지침 = null; 공고.보고 = null; 공고.서명 = '';
    공고.메시지 = ''; 공고.오류 = ''; 공고.화면 = '메인'; 공고.필터.보기 = '추천';
    await 공고새로고침(true);
  }, 공고.검색종류 === p.id ? 'primary' : ''));
  return row;
}

function 지침화면() {
  const box = 만들기('div'); const p = 공고.지침;
  if (!p) { box.append(만들기('p', 'hint', '지침을 불러오고 있어요.')); return box; }
  box.append(만들기('h3', '', p.프로필.이름), 만들기('p', 'hint', p.프로필.안내 || '복구한 기존 지침을 기준으로 검색해요.'));
  box.append(카드('검색 키워드', p.프로필.키워드.length, [만들기('p', '', p.프로필.키워드.join(' · '))]));
  box.append(카드('확인할 출처군', p.프로필.필수출처.length, p.프로필.필수출처.map(x => 만들기('p', '', x))));
  const text = 만들기('pre', 'n-instructions', p.원문 || '연결된 지침이 없어요.'); text.style.whiteSpace = 'pre-wrap'; box.append(text); return box;
}

function 보고화면() {
  const box = 만들기('div'); const r = 공고.보고;
  if (!r) { box.append(만들기('p', 'hint', '보고를 불러오고 있어요.')); return box; }
  box.append(만들기('h3', '', `${r.종류} · ${r.확인시각}${r.시험용 ? ' · 시험 자료' : ''}`));
  r.안내.forEach(x => box.append(만들기('p', 'hint', x)));
  box.append(만들기('p', '', `등록 기관 ${r.검증범위.등록기관}곳 · 정상 완료 ${r.검증범위.정상완료}곳 · 미확인 ${r.검증범위.미확인기관.length}곳`));
  if (!r.공고.length) box.append(만들기('p', 'hint', '현재 보고할 변화가 없어요. 미확인 출처는 기관 목록에서 확인해 주세요.'));
  r.공고.forEach(n => {
    const title = 만들기('button', 'n-link', `[${n.표지.join(' · ')}] ${n.공고명}`); title.onclick = () => 상세열기(n.id);
    box.append(카드(n.기관, null, [title, 만들기('p', '', `게시 ${n.게시일} · 마감 ${n.마감 || '미확인'}`), 만들기('p', 'hint', `원문 ${n.원문확인 ? '확인' : '미확인'} · 첨부 ${n.첨부확인}`)]));
  }); return box;
}

// ---- 화면들 ----------------------------------------------------------
function 메인() {
  const o = 공고.개요; const 틀 = 만들기('div');
  if (!o) { 틀.append(만들기('p', 'hint', '불러오는 중이에요…')); return 틀; }
  틀.append(작업줄());
  if (공고.등록열림) 틀.append(등록폼());
  const 합 = o.합계;
  틀.append(만들기('p', 'hint', `공고 ${합.전체}건 (${공고.검색종류 === 'housing' ? '현재 정보' : '추천'} ${합.추천} · 제외·마감 보관 ${합.보관}) · AI 검증 대상 ${합.검증대상}건${합.미처리 ? ` (미처리 ${합.미처리})` : ''} · 중복 후보 ${합.중복후보}건`));
  const 격자 = 만들기('div', 'n-grid');
  if (o.주택그룹) {
    격자.append(카드('메인 · 용인 플랫폼시티', o.주택그룹[0].합계, o.주택그룹[0].목록.map(x => { const row = 공고줄(x); row.append(칩(x.주택.정보유형)); return row; }), '아직 저장된 플랫폼시티 정보가 없어요. 기관 목록의 공식 안내와 공고를 점검해 주세요.'));
    o.주택그룹.slice(1).forEach(g => 격자.append(카드(g.이름 === '용인 생활권' ? '보조 · 용인 생활권' : '별도 보기 · 그 밖의 공고', g.합계, g.목록.map(공고줄))));
  }
  격자.append(
    카드('오늘 처음 발견한 공고·정보', o.오늘신규.length, o.오늘신규.map(공고줄), '오늘 새로 저장한 공고·정보가 없어요'),
    카드('마감 임박', o.마감임박.length, o.마감임박.map(공고줄), `마감이 ${o.설정.마감임박일}일 안에 다가온 공고가 없어요`),
    카드('지원 가능 (적합 + 검증됨)', o.지원가능.length, o.지원가능.map(공고줄), '아직 없어요. 검증 실행을 해 보세요'),
    카드('확인이 필요한 공고', o.확인필요.length, o.확인필요.map(공고줄), '없어요'),
  );
  const 기관카드 = 카드('다시 확인할 기관 (검색 실패·미실행)', o.다시확인기관.length, o.다시확인기관.map((k) => {
    const 행 = 만들기('div', 'n-row'); const 제목 = 만들기('div', '', k.이름); 제목.style.fontWeight = '700';
    const 줄2 = 만들기('div', 'n-sub'); 줄2.append(칩(k.결과, k.결과 === '검색 미실행' ? 'muted' : 'bad'), 만들기('span', '', `${k.HTTP상태 ? `HTTP ${k.HTTP상태} · ` : ''}${k.오류 || ''}`));
    행.append(제목, 줄2, 버튼('이 기관만 다시 점검', () => 동작(() => 공고요청('collect', { 기관ID목록: [k.id] }), 점검요약)));
    return 행;
  }), o.기관수 ? '등록한 기관 중 다시 확인할 곳이 없어요. 필수 출처 전체 완료 여부는 별도로 확인해 주세요.' : '아직 등록한 기관이 없어요. 사이트 목록을 먼저 연결해 주세요.');
  격자.append(기관카드);
  const 진행 = Object.entries(o.지원진행).filter(([, v]) => v);
  격자.append(카드('지원 진행 현황', null, 진행.length ? [표(['상태', '건수'], 진행.map(([k, v]) => [k, String(v)]))] : [], '아직 지원 상태를 정한 공고가 없어요'));
  격자.append(카드('검색 품질 지표', null, [표(['항목', '값', '구분'], o.지표.map((m) => [m.이름, m.값, 칩(m.종류, m.종류 === '측정' ? 'good' : m.종류 === '추정' ? 'warn' : 'muted')]))]));
  격자.append(카드('최근 실행', o.최근실행.length, o.최근실행.map((r) => {
    const 행 = 만들기('div', 'n-row');
    행.append(만들기('div', '', `${r.종류} · ${시간표시(r.시작, true)} ${r.모드 === 'mock' ? '(Mock)' : ''}`), 만들기('div', 'n-sub', r.종류 === '검증' ? `AI 호출 ${r.AI호출}회 · 재사용 ${r.재사용}건${r.중단이유 ? ' · ' + r.중단이유 : ''}` : r.종류 === '등록' ? '직접 등록' : `완료 ${r.지표.완료} · 실패 ${r.지표.접속실패 + r.지표.추출실패} · 검증 필요 ${r.지표.검증필요} · 신규 ${r.지표.신규} · AI 호출 0회`));
    return 행;
  }), '아직 실행한 적이 없어요'));
  격자.append(카드('사후 발견한 누락 공고', o.누락.length, o.누락.map((m) => {
    const 행 = 만들기('div', 'n-row'); 행.append(만들기('div', '', `${m.공고명}`), 만들기('div', 'n-sub', `${m.기관명} · 게시 ${m.원래게시일} · 발견 ${m.최초발견일}${m.마감후발견 ? ' · 마감 후 발견' : ''}`), 만들기('div', 'n-sub', `추정 원인: ${m.추정원인} — ${m.근거}`));
    return 행;
  }), '기록된 누락이 없어요'));
  if (공고.검색종류 === 'housing') [...격자.children].find(el => el.querySelector('h3')?.textContent.startsWith('지원 가능'))?.remove();
  틀.append(격자);
  return 틀;
}

function 등록폼() {
  const f = 만들기('form', 'n-form'); f.onsubmit = (e) => e.preventDefault();
  const 입력 = {};
  const 칸 = (이름, 라벨, 종류 = 'input', 힌트) => { const l = 만들기('label', '', 라벨); const e = 만들기(종류); if (종류 === 'input') e.type = 'text'; if (종류 === 'textarea') e.rows = 3; e.placeholder = 힌트 || ''; 입력[이름] = e; l.append(e); return l; };
  f.append(만들기('h3', '', '공고 직접 등록'), 만들기('p', 'hint', '공식 공고 링크가 꼭 있어야 해요. 모르는 항목은 비워 두면 "미확인"으로 남아요.'),
    칸('기관명', '기관명', 'input', '예: 용인시 평생학습관'), 칸('지역', '지역', 'input', '예: 용인시'), 칸('공고명', '공고명'), 칸('공식링크', '공식 공고 링크', 'input', 'https://…'),
    칸('마감원문', '접수 마감 (원문 그대로)', 'input', '예: 2026.11.30(월) 18시'), 칸('본문', '공고 본문 (있으면 붙여넣기)', 'textarea'));
  f.append(버튼('등록', () => 동작(async () => { const b = Object.fromEntries(Object.entries(입력).map(([k, e]) => [k, e.value])); const r = await 공고요청('notices', b); 공고.등록열림 = false; return r; }, (r) => `등록 결과: ${r.종류}${r.공고 ? ' — ' + r.공고.공고명 : ''}`), 'primary'), 버튼('닫기', () => { 공고.등록열림 = false; 공고.서명 = ''; 공고그리기패널(true); }));
  return f;
}

function 목록화면() {
  const 틀 = 만들기('div'); const F = 공고.필터;
  const 선택 = (이름, 라벨, 값들) => { const l = 만들기('label', 'n-filter', `${라벨} `); const s = 만들기('select'); [['', '전체'], ...값들.map((v) => [v, v])].forEach(([v, t]) => { const o = 만들기('option', '', t); o.value = v; o.selected = F[이름] === v; s.append(o); }); s.onchange = () => { F[이름] = s.value; 공고.서명 = ''; 공고새로고침(true); }; l.append(s); return l; };
  const 보기 = 만들기('label', 'n-filter', '보기 '); const bs = 만들기('select'); [['추천', 공고.검색종류 === 'housing' ? '현재 공고·정보' : '추천 공고'], ['보관', '제외·마감 보관'], ['전체', '전체']].forEach(([v, t]) => { const o = 만들기('option', '', t); o.value = v; o.selected = F.보기 === v; bs.append(o); }); bs.onchange = () => { F.보기 = bs.value; 공고.서명 = ''; 공고새로고침(true); }; 보기.append(bs);
  const 임박 = 만들기('label', 'n-filter'); const cb = 만들기('input'); cb.type = 'checkbox'; cb.checked = F.임박 === '1'; cb.onchange = () => { F.임박 = cb.checked ? '1' : ''; 공고.서명 = ''; 공고새로고침(true); }; 임박.append(cb, ' 마감 임박만');
  틀.append(만들기('div', 'n-filters')); 틀.lastChild.append(보기, 선택('분야', '분야', ['A', 'B', 'C']), 선택('판정', '적합도', ['적합', '확인 필요', '부적합']), 선택('검증상태', '검증', ['후보', '원문확인됨', '검증됨', '검증실패']), 선택('지원상태', '지원', [...지원상태들, '미지정']), 선택('정렬', '정렬', ['마감', '발견']), 임박);
  if (공고.검색종류 === 'housing') [...틀.lastChild.children].filter(el => /^분야|^적합도/.test(el.textContent)).forEach(el => el.remove());
  if (!공고.목록) { 틀.append(만들기('p', 'hint', '불러오는 중이에요…')); return 틀; }
  틀.append(만들기('p', 'hint', `${공고.목록.합계}건`));
  if (!공고.목록.목록.length) { 틀.append(만들기('p', 'hint', '조건에 맞는 공고가 없어요')); return 틀; }
  틀.append(표(['공고', '기관', '마감', 공고.검색종류 === 'housing' ? '정보 유형' : '적합도', '검증', '상태', '지원'], 공고.목록.목록.map((x) => {
    const 제목 = 만들기('button', 'n-link', x.공고명); 제목.type = 'button'; 제목.onclick = () => 상세열기(x.id);
    const 칸 = 만들기('span'); 칸.append(제목, ...표지칩들(x));
    return [칸, x.기관명, 마감글(x), 공고.검색종류 === 'housing' ? x.주택?.정보유형 : 칩(x.판정, 판정색(x.판정)), x.검증상태, 칩(x.공고상태, 상태색(x.공고상태)), x.지원상태 || '—'];
  })));
  return 틀;
}

function 상세화면() {
  const 틀 = 만들기('div'); const n = 공고.상세;
  틀.append(버튼('← 목록으로', () => 화면가기('목록')));
  if (!n) { 틀.append(만들기('p', 'hint', '불러오는 중이에요…')); return 틀; }
  const s = n.요약;
  틀.append(만들기('h2', '', n.공고명));
  const 칩줄 = 만들기('div', 'n-sub'); 칩줄.append(칩(n.공고상태, 상태색(n.공고상태)), 공고.검색종류 === 'housing' ? 칩(s.주택?.정보유형 || '유형 확인 필요') : 칩(`적합도: ${n.적합도.판정}`, 판정색(n.적합도.판정)), 칩(`검증: ${n.검증상태}`, n.검증상태 === '검증됨' ? 'good' : ''), 남은칩(s), ...표지칩들(s));
  틀.append(칩줄);
  const 링크 = 안전링크(n.공식링크); const 링크줄 = 만들기('p');
  if (링크) { const a = 만들기('a', 'download-link', '공식 공고 원문 열기'); a.href = 링크; a.target = '_blank'; a.rel = 'noopener noreferrer'; 링크줄.append(a, 만들기('span', 'hint', `  ${링크}`)); }
  else 링크줄.append(칩('시험용 주소예요 — 열 수 없어요', 'fake'), 만들기('span', 'hint', `  ${n.공식링크}`));
  틀.append(링크줄);
  const 상태 = (칸) => n.필드상태?.[칸] === '원문확인' ? '원문확인' : n.필드상태?.[칸] === 'AI추정' ? 'AI추정' : '';
  const 필드 = (이름, 값, 칸) => [이름, 값 && 값 !== '미확인' ? String(값) : '미확인', 칸 && 상태(칸) ? 칩(상태(칸), 상태(칸) === '원문확인' ? 'good' : 'warn') : ''];
  틀.append(표(['항목', '내용', '출처'], [
    ['기관 / 지역', `${n.기관명} · ${n.지역}${n.우선순위 ? ` (우선순위 ${n.우선순위})` : ''}`, ''],
    필드('모집 분야', n.분야, '분야'), 필드('모집 대상', n.대상, '대상'),
    ['접수 시작', n.접수시작.날짜 || '미확인', ''],
    ['접수 마감', `${마감글(s)}${n.접수마감.원문표기 && n.접수마감.원문표기 !== '미확인' ? ` · 원문 표기: ${n.접수마감.원문표기}` : ''}`, 칩(`마감 ${n.접수마감.마감판정}`, n.접수마감.마감판정 === '확정' ? 'good' : n.접수마감.마감판정 === '불확실' ? 'warn' : '')],
    ['마감 판단 근거', n.접수마감.판정근거, ''],
    필드('교육·활동 장소', n.장소, '장소'), 필드('교육 시간대', n.시간대, '시간대'), 필드('강의료·지원금', n.금액, '금액'),
    필드('지원 자격', n.자격.원문, '자격'), 필드('제출서류', n.제출서류, '제출서류'), 필드('접수 방법', n.접수방법, '접수방법'),
    ['게시일', n.게시일 || '미확인', ''], ['최초 발견', `${시간표시(n.최초발견.시각, true)} (${n.원천})`, ''], ['마지막 검증', n.마지막검증 ? 시간표시(n.마지막검증, true) : '아직 안 했어요', ''],
  ]));
  if (n.첨부.length) { const p = 만들기('p', 'hint', '첨부파일: '); n.첨부.forEach((a) => { const u = 안전링크(a.링크 || a.주소 || a); if (u) { const l = 만들기('a', '', `${a.이름 || '첨부'} (${a.상태 || '미확인'})`); l.href = u; l.target = '_blank'; l.rel = 'noopener noreferrer'; p.append(l, ' '); } }); 틀.append(p); }

  const 적 = n.적합도;
  const 판정박스 = 만들기('section', 'n-card');
  판정박스.append(만들기('h3', '', `적합도와 판정 근거 (${적.출처})`));
  const 목록줄 = (제목, 항목들, 종류) => { if (!항목들.length) return; 판정박스.append(만들기('strong', '', 제목)); const ul = 만들기('ul'); 항목들.forEach((t) => ul.append(만들기('li', 종류, t))); 판정박스.append(ul); };
  목록줄('명시적으로 맞지 않는 조건', 적.미충족, 'bad'); 목록줄('추가로 확인해야 할 조건', 적.확인필요, 'warn'); 목록줄('근거', 적.근거, '');
  if (n.수동판정) 판정박스.append(만들기('p', 'hint', `작가님이 판정을 바꿨어요: ${n.수동판정.판정} (이유: ${n.수동판정.이유})`));
  const ai = n['제외·보존'].AI검증;
  판정박스.append(만들기('p', 'hint', `AI 검증: ${ai.상태}${ai.사유 ? ` (${ai.사유})` : ''}${ai.미처리 ? ' · 미처리' : ''} · 기록 보존: 예${n.검증기록 ? ` · 검증 출처: ${n.검증기록.결과출처}${n.검증기록.본문잘림 ? ' · 본문 앞부분만 검토' : ''}` : ''}`));
  const 판정선택 = 만들기('select'); ['적합', '확인 필요', '부적합'].forEach((v) => { const o = 만들기('option', '', v); o.value = v; o.selected = v === 적.판정; 판정선택.append(o); });
  const 이유 = 만들기('input'); 이유.type = 'text'; 이유.placeholder = '판정을 바꾸는 이유'; 이유.maxLength = 500;
  const 판정줄 = 만들기('div', 'n-actions'); 판정줄.append(만들기('span', 'hint', '판정 직접 바꾸기: '), 판정선택, 이유,
    버튼('판정 바꾸기', () => 동작(() => 공고요청(`notices/${encodeURIComponent(n.id)}/judgment`, { 판정: 판정선택.value, 이유: 이유.value }), '판정을 바꿨어요')),
    ...(n.수동판정 ? [버튼('직접 판정 해제', () => 동작(() => 공고요청(`notices/${encodeURIComponent(n.id)}/judgment-clear`, {}), '해제했어요'))] : []));
  if (공고.검색종류 !== 'housing') 판정박스.append(판정줄);
  else { 판정박스.replaceChildren(만들기('h3', '', '사실 확인 상태'), 만들기('p', 'hint', '개인 자격 판단과 추천을 하지 않아요.')); }
  const 검증줄 = 만들기('div', 'n-actions');
  검증줄.append(버튼('이 공고 다시 검증', () => 동작(() => 공고요청('verify', { ids: [n.id], 강제: true, 확인호출수: 1 }), 검증요약)),
    버튼(ai.사유 === '작가님보류' ? 'AI 검증 보류 해제' : 'AI 검증 보류', () => 동작(() => 공고요청(`notices/${encodeURIComponent(n.id)}/hold`, { 보류: ai.사유 !== '작가님보류' }), '바꿨어요')));
  판정박스.append(검증줄);
  틀.append(판정박스);

  const 지원 = 만들기('section', 'n-card'); 지원.append(만들기('h3', '', '지원 관리'), 만들기('p', 'hint', '공고를 찾았다고 자동으로 지원 상태가 바뀌지 않아요. 작가님이 직접 정해요. 지원서 제출이나 기관 연락은 이 화면에서 하지 않아요.'));
  const 지원선택 = 만들기('select'); [['', '미지정'], ...지원상태들.map((v) => [v, v])].forEach(([v, t]) => { const o = 만들기('option', '', t); o.value = v; o.selected = v === (n.지원상태 || ''); 지원선택.append(o); });
  const 메모 = 만들기('textarea'); 메모.rows = 3; 메모.maxLength = 2000; 메모.value = n.메모 || ''; 메모.placeholder = '개인 메모';
  지원.append(지원선택, 메모, 버튼('저장', () => 동작(() => 공고요청(`notices/${encodeURIComponent(n.id)}/status`, { 지원상태: 지원선택.value, 메모: 메모.value }), '저장했어요'), 'primary'));
  if (n.지원이력.length) { const ul = 만들기('ul'); n.지원이력.slice().reverse().forEach((h) => ul.append(만들기('li', '', `${시간표시(h.시각, true)} ${h.이전 || '미지정'} → ${h.이후 || '미지정'}`))); 지원.append(ul); }
  틀.append(지원);

  const 이력 = 만들기('section', 'n-card'); 이력.append(만들기('h3', '', `검색·수정 이력 (${n.변경이력.length})`));
  if (!n.변경이력.length) 이력.append(만들기('p', 'hint', '바뀐 적이 없어요'));
  else { const ul = 만들기('ul'); n.변경이력.slice().reverse().forEach((h) => ul.append(만들기('li', '', `${시간표시(h.시각, true)} · ${h.항목}: ${h.이전 || '-'} → ${h.이후 || '-'}`))); 이력.append(ul); }
  if (n.연결?.재공고원본ID) 이력.append(만들기('p', 'hint', `이 공고는 재공고예요 (원본: ${n.연결.재공고원본ID})`));
  if (n.중복후보) 이력.append(만들기('p', 'hint', `같은 공고일 수 있어요 (후보: ${n.중복후보}) — 자동으로 합치지 않았어요`));
  const 원문 = 만들기('details'); 원문.append(만들기('summary', '', `원문 본문 미리보기 (${n.원문.본문길이}자)`), 만들기('pre', 'document-preview', n.원문.본문 || '(본문이 없어요)'));
  이력.append(원문);
  틀.append(이력);
  return 틀;
}

function 기관화면() {
  const 틀 = 만들기('div');
  틀.append(버튼('기관 추가', () => { 공고.기관추가열림 = !공고.기관추가열림; 공고.서명 = ''; 공고그리기패널(true); }));
  if (공고.기관추가열림) {
    const f = 만들기('form', 'n-form'); f.onsubmit = (e) => e.preventDefault(); const 입력 = {};
    const 칸 = (이름, 라벨, 힌트) => { const l = 만들기('label', '', 라벨); const e = 만들기('input'); e.type = 'text'; e.placeholder = 힌트 || ''; 입력[이름] = e; l.append(e); return l; };
    const 유형 = 만들기('select'); 기관유형들.forEach((v) => { const o = 만들기('option', '', v); o.value = v; 유형.append(o); });
    f.append(만들기('p', 'hint', `${공고.검색종류 === 'instructor' ? '강사 검색은 인천광역시 기관을 제외해요. ' : ''}게시판 주소는 기관의 공식 모집 게시판이어야 해요.`), 칸('id', '기관 id (영문·숫자)', 'yongin-lib'), 칸('이름', '기관 이름'), 만들기('label', '', '유형 ').appendChild(유형).parentNode, 칸('지역', '지역', '용인시'), 칸('주소', '공식 게시판 주소', 'https://…'));
    f.append(버튼('추가', () => 동작(() => 공고요청('institutions', { 동작: '추가', 기관: { id: 입력.id.value, 이름: 입력.이름.value, 유형: 유형.value, 지역: 입력.지역.value, 게시판: [{ 주소: 입력.주소.value }] } }).then((r) => { 공고.기관추가열림 = false; return r; }), '기관을 추가했어요'), 'primary'));
    틀.append(f);
  }
  if (!공고.기관) { 틀.append(만들기('p', 'hint', '불러오는 중이에요…')); return 틀; }
  if (!공고.기관.length) { 틀.append(만들기('p', 'hint', '등록된 기관이 없어요. 기관을 추가하거나, Mock 모드에서는 메인 화면의 "시험 자료 채우기"를 눌러 보세요.')); return 틀; }
  틀.append(표(['기관', '유형 · 지역', '최근 확인', '결과', '관리'], 공고.기관.map((k) => {
    const 점 = k.마지막점검; const 관리 = 만들기('span');
    관리.append(버튼('점검', () => 동작(() => 공고요청('collect', { 기관ID목록: [k.id] }), 점검요약)), 버튼(k.사용 ? '중지' : '재개', () => 동작(() => 공고요청('institutions', { 동작: k.사용 ? '중지' : '재개', id: k.id }), k.사용 ? '중지했어요 (이 기관의 공고 기록은 그대로 남아요)' : '재개했어요')));
    const 이름 = 만들기('span'); const address = 안전링크(k.게시판[0]?.주소);
    if (address) { const a = 만들기('a', 'n-link', k.이름); a.href = address; a.target = '_blank'; a.rel = 'noopener noreferrer'; 이름.append(a); } else 이름.textContent = k.이름;
    return [이름, `${k.유형} · ${k.지역}`, 점?.시각 ? 시간표시(점.시각, true) : '아직 확인 전',
      점 ? 칩(`${점.결과}${점.HTTP상태 ? ' · HTTP ' + 점.HTTP상태 : ''}`, /실패|필요/.test(점.결과) ? 'bad' : /미실행/.test(점.결과) ? 'muted' : 'good') : 칩('점검 전', 'muted'), k.사용 ? 관리 : (() => { const s = 만들기('span'); s.append(칩('중지됨', 'muted'), 관리); return s; })()];
  })));
  return 틀;
}

function 설정화면() {
  const 틀 = 만들기('div');
  if (!공고.설정) { 틀.append(만들기('p', 'hint', '불러오는 중이에요…')); return 틀; }
  const s = 공고.설정.설정; const 입력 = {};
  const 카드1 = 만들기('section', 'n-card'); 카드1.append(만들기('h3', '', 'AI 호출 제한 (다음 실행부터 적용)'), 만들기('p', 'hint', '실행당·하루 호출 수에는 재시도도 포함돼요. 한도 초과 오류가 나면 자동으로 다시 하지 않고 멈춰요.'));
  const 칸들 = [['실행당', '실행당 최대 호출'], ['하루', '하루 최대 호출'], ['재시도', '재시도 (호출당)'], ['배치', '한 번에 보낼 공고 수'], ['본문자', '공고 1건 본문 글자 상한'], ['공통문맥자', '공통 문맥 글자 상한'], ['호출입력자', '호출당 입력 글자 상한'], ['호출출력자', '호출당 출력 글자 상한'], ['연속실패', '연속 실패하면 중지']];
  const 격자 = 만들기('div', 'n-form-grid');
  칸들.forEach(([k, 라벨]) => { const l = 만들기('label', '', 라벨); const e = 만들기('input'); e.type = 'number'; e.value = s.AI한도[k]; e.min = 0; 입력[k] = e; l.append(e); 격자.append(l); });
  const 임박 = 만들기('label', '', '마감 임박 기준 (일)'); const ie = 만들기('input'); ie.type = 'number'; ie.value = s.마감임박일; 임박.append(ie); 격자.append(임박);
  const 확인 = 만들기('label', 'n-filter'); const cb = 만들기('input'); cb.type = 'checkbox'; 확인.append(cb, ' 실행당·하루 상한을 올리는 것을 확인했어요');
  카드1.append(격자, 확인, 버튼('저장', () => 동작(() => { const AI한도 = {}; 칸들.forEach(([k]) => { if (Number(입력[k].value) !== s.AI한도[k]) AI한도[k] = Number(입력[k].value); }); const 패치 = { AI한도, 확인: cb.checked }; if (Number(ie.value) !== s.마감임박일) 패치.마감임박일 = Number(ie.value); return 공고요청('settings', 패치); }, '설정을 저장했어요'), 'primary'));
  틀.append(카드1);
  const 카드2 = 만들기('section', 'n-card'); 카드2.append(만들기('h3', '', '내 조건 (JSON)'), 만들기('p', 'hint', `지원 자격 판정에 쓰는 작가님의 조건이에요(사업자 여부, 거주지 등). 지금은 비어 있어요. 기존 판정 규칙(${Object.keys(s.판정규칙).length}개)은 알려 주시면 옮길게요. 바꾸면 이미 검증한 공고는 AI를 다시 부르지 않고 "다시 검증 필요" 표시만 나와요.`));
  const 조건 = 만들기('textarea'); 조건.rows = 4; 조건.value = JSON.stringify(s.내조건, null, 2);
  카드2.append(조건, 버튼('내 조건 저장', () => 동작(() => { let v; try { v = JSON.parse(조건.value || '{}'); } catch { throw new Error('JSON 모양이 올바르지 않아요.'); } return 공고요청('settings', { 내조건: v }); }, '저장했어요')));
  틀.append(카드2);
  if (공고.설정.경고.length) { const p = 만들기('p', 'form-error'); p.textContent = 공고.설정.경고.join('\n'); 틀.append(p); }
  const 카드3 = 만들기('section', 'n-card'); 카드3.append(만들기('h3', '', '설정 변경 이력'));
  if (!공고.설정.이력.length) 카드3.append(만들기('p', 'hint', '아직 바꾼 적이 없어요')); else 카드3.append(표(['시각', '항목', '이전', '이후'], 공고.설정.이력.map((h) => [시간표시(h.시각, true), h.항목, String(h.이전), String(h.이후)])));
  틀.append(카드3);
  return 틀;
}

function 실행화면() {
  const 틀 = 만들기('div');
  if (!공고.실행) { 틀.append(만들기('p', 'hint', '불러오는 중이에요…')); return 틀; }
  if (!공고.실행.length) { 틀.append(만들기('p', 'hint', '아직 실행한 적이 없어요')); return 틀; }
  공고.실행.forEach((r) => {
    const d = 만들기('details', 'n-card'); d.open = 공고.열린실행 === r.id; d.ontoggle = () => { if (d.open) 공고.열린실행 = r.id; };
    const 지 = r.지표 || {};
    d.append(만들기('summary', '', `${r.종류} · ${시간표시(r.시작, true)} · ${r.모드 === 'mock' ? 'Mock' : '실제'} · AI 호출 ${r.AI호출?.횟수 ?? 0}회${r.중단이유 ? ' · ' + r.중단이유 : ''}`));
    if (r.단계 === 'A') d.append(r.결과.length ? 표(['기관', '결과', 'HTTP', '글 수', '신규', '변경', '메모'], r.결과.map((x) => [x.기관명, 칩(x.결과, /실패|필요/.test(x.결과) ? 'bad' : /미실행/.test(x.결과) ? 'muted' : 'good'), x.HTTP상태 ?? '', String(x.가져온글수), String(x.신규수), String(x.변경수), x.오류 || ''])) : 만들기('p', 'hint', `직접 등록 · ${지.종류 || ''}`));
    else d.append(r.결과.length ? 표(['공고', '결과', '메모'], r.결과.map((x) => [x.공고명, x.결과, x.비고])) : 만들기('p', 'hint', '검증할 공고가 없었어요 (AI 호출 0회)'));
    if (r.안내) d.append(만들기('p', 'hint', r.안내));
    틀.append(d);
  });
  return 틀;
}

function 공고그리기패널(강제) {
  const 패널 = 공고패널();
  if (!패널 || !공고.활성) return;
  const 서명 = JSON.stringify([공고.화면, 공고.선택, 공고.개요, 공고.목록, 공고.상세, 공고.기관, 공고.설정, 공고.실행, 공고.메시지, 공고.오류, 공고.요청중, 공고.등록열림, 공고.기관추가열림, 공고.필터]);
  const 모드 = document.getElementById('모드표시');
  if (공고.개요) { 모드.textContent = `${공고.개요.모드 === 'mock' ? '[MOCK] AI 호출 없음' : '[REAL] 실제 모드'} · 데이터: ${공고.개요.데이터구분}`; 모드.className = `chip n-mode ${공고.개요.모드}`; }
  if (서명 === 공고.서명 && !강제) return;
  const 입력중 = 패널.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (입력중 && !강제) return; // 쓰는 중에는 화면을 다시 그리지 않아요
  공고.서명 = 서명;
  패널.replaceChildren();
  const 탭 = 만들기('nav', 'n-tabs');
  [['메인', '개요'], ['목록', '공고 목록'], ['기관', '기관 관리'], ['설정', '설정·사용량'], ['실행', '실행 이력']].forEach(([id, 이름]) => { const b = 만들기('button', 공고.화면 === id || (id === '목록' && 공고.화면 === '상세') ? 'on' : '', 이름); b.type = 'button'; b.onclick = () => 화면가기(id); 탭.append(b); });
  [['지침', '검색 지침·키워드'], ['보고', '직원 보고']].forEach(([id, name]) => 탭.append(버튼(name, () => 화면가기(id), 공고.화면 === id ? 'on' : '')));
  패널.append(만들기('h2', '', '공고 정보센터'), 검색종류선택(), 탭);
  if (공고.개요?.프로필?.안내) 패널.append(만들기('p', 'hint', 공고.개요.프로필.안내));
  if (공고.개요?.진행) 패널.append(만들기('p', 'task-result', `${공고.개요.진행.기관} · ${공고.개요.진행.페이지}페이지 · ${공고.개요.진행.공고수}건 확인 중이에요`));
  if (공고.개요?.모드 === 'mock') 패널.append(만들기('p', 'n-mockbanner', 'Mock 모드예요 — 실제 AI를 부르지 않고, [시험용] 표지가 붙은 공고·기관은 전부 가짜예요. 실제 공고가 아니에요.'));
  if (공고.메시지) 패널.append(만들기('p', 'task-result', 공고.메시지));
  if (공고.오류) 패널.append(만들기('p', 'form-error', 공고.오류));
  패널.append({ 메인, 목록: 목록화면, 상세: 상세화면, 기관: 기관화면, 설정: 설정화면, 실행: 실행화면, 지침: 지침화면, 보고: 보고화면 }[공고.화면]());
}
