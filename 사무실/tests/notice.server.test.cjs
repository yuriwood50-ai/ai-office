// 공고 센터 서버 통합 시험: server.js를 '별도 포트(0) + 임시 데이터 폴더'로 자식 프로세스로 띄워서 HTTP로 확인해요.
// 안전 장치: 자식 서버에는 tripwire를 미리 불러와서 외부 프로세스·네트워크 시도가 있으면 기록하고, 마지막에 0건인지 확인해요.
// 운영 폴더(공고\, 상태\, 작업\, archive\, 그림)는 시험 전후 해시가 같은지 확인해요. 4173 서버에는 요청을 보내지 않아요.
// 실행: node 사무실/tests/notice.server.test.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const 사무실 = path.resolve(__dirname, '..');
const 루트 = path.resolve(사무실, '..');
const 서버파일 = path.join(사무실, 'server.js');
const 안전망 = path.join(__dirname, 'helpers', 'tripwire.cjs');
const 임시 = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-server-'));
const 안전망기록 = path.join(임시, 'tripwire.log');
const 서버들 = [];
const 결과들 = []; let 실패수 = 0;

const 해시폴더 = (dir) => {
  const 맵 = {};
  const 걷기 = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) 걷기(p); else 맵[path.relative(루트, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } };
  걷기(dir); return 맵;
};
const 지킬곳 = ['상태', '작업', 'archive', '직원', '규칙', '공고', path.join('사무실', '그림')].map((x) => path.join(루트, x));
const 공고폴더있었나 = fs.existsSync(path.join(루트, '공고'));
const 시작전 = Object.assign({}, ...지킬곳.map(해시폴더));

async function 시험(이름, fn) {
  try { await fn(); 결과들.push(`PASS  ${이름}`); }
  catch (e) { 실패수++; 결과들.push(`FAIL  ${이름}\n      ${String(e.message).split('\n').slice(0, 14).join('\n      ')}${e.stack ? '\n      ' + e.stack.split('\n').find((l) => /server\.test/.test(l)) : ''}`); }
}

function 요청(포트, 방법, 경로, { 본문, 헤더 = {} } = {}) {
  return new Promise((resolve, reject) => {
    const 데이터 = 본문 === undefined ? null : Buffer.from(JSON.stringify(본문));
    const 주소 = new URL(경로, 'http://127.0.0.1'); // 한글 주소를 알맞게 인코딩해요
    const req = http.request({ host: '127.0.0.1', port: 포트, method: 방법, path: 주소.pathname + 주소.search, headers: { ...(데이터 ? { 'content-type': 'application/json', 'content-length': 데이터.length } : {}), ...헤더 } }, (res) => {
      const 조각 = []; res.on('data', (c) => 조각.push(c));
      res.on('end', () => { const 글 = Buffer.concat(조각); let json = null; try { json = JSON.parse(글.toString('utf8')); } catch { /* json이 아닐 수 있어요 */ } resolve({ status: res.statusCode, json, 글, 헤더: res.headers }); });
    });
    req.on('error', reject); if (데이터) req.write(데이터); req.end();
  });
}
const 읽기 = (s, p) => 요청(s.포트, 'GET', p);
const 쓰기 = (s, p, 본문, 추가 = {}) => 요청(s.포트, 'POST', p, { 본문, 헤더: { origin: `http://127.0.0.1:${s.포트}`, 'x-office-request': '1', ...추가 } });

// 서버를 띄우고, 그 서버가 '내가 띄운 그 서버'인지 whoami로 확인해요 (이전 사고 R-1 재발 방지).
function 서버켜기({ 데이터, 환경 = {}, 포트 = '0', 기다림 = 8000 }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, OFFICE_PORT: 포트, OFFICE_DATA_DIR: 데이터, OFFICE_NOTICE_ONLY: '1', OFFICE_MODE: 'mock', OFFICE_ALLOW_REAL: '', OFFICE_DISABLE_AI: '1', NODE_OPTIONS: `--require "${안전망.split(path.sep).join('/')}"`, TRIPWIRE_LOG: 안전망기록, ...환경 };
    delete env.OFFICE_ALLOW_REAL; if (환경.OFFICE_ALLOW_REAL) env.OFFICE_ALLOW_REAL = 환경.OFFICE_ALLOW_REAL;
    const child = spawn(process.execPath, [서버파일], { cwd: 사무실, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const s = { child, 출력: '', 오류: '', 포트: null };
    서버들.push(s);
    const 끝 = setTimeout(() => reject(new Error(`서버가 ${기다림}ms 안에 켜지지 않았어요\n${s.출력}${s.오류}`)), 기다림);
    child.stdout.on('data', async (d) => {
      s.출력 += d.toString();
      const m = /주소: http:\/\/127\.0\.0\.1:(\d+)/.exec(s.출력); const id = /인스턴스 ([0-9a-f-]{36})/.exec(s.출력); const pid = /PID (\d+)/.exec(s.출력);
      if (m && id && pid && !s.준비) {
        s.준비 = true; clearTimeout(끝); s.포트 = Number(m[1]); s.인스턴스ID = id[1];
        try {
          const w = await 읽기(s, '/api/notice/whoami');
          assert.equal(w.status, 200);
          assert.equal(w.json.인스턴스ID, s.인스턴스ID, '요청이 내가 띄운 서버가 아닌 곳으로 갔어요');
          assert.equal(w.json.pid, child.pid, 'PID가 달라요');
          s.whoami = w.json; resolve(s);
        } catch (e) { reject(e); }
      }
    });
    child.stderr.on('data', (d) => { s.오류 += d.toString(); });
    child.on('exit', (code) => { s.종료코드 = code; s.끝남 = true; clearTimeout(끝); if (!s.준비) reject(Object.assign(new Error(`서버가 시작하지 못하고 끝났어요 (코드 ${code})\n${s.오류}`), { 종료코드: code, 출력: s.출력, 오류: s.오류 })); });
  });
}
function 끄기(s) { return new Promise((resolve) => { if (s.끝남) return resolve(); s.child.once('exit', () => resolve()); s.child.kill(); setTimeout(resolve, 3000); }); }

(async () => {
  const 데이터 = path.join(임시, 'data');
  let S;
  await 시험('서버 시작: 별도 포트·임시 폴더, whoami의 인스턴스·PID가 내가 띄운 서버와 일치', async () => {
    S = await 서버켜기({ 데이터 });
    assert.notEqual(S.포트, 4173); assert.equal(S.whoami.모드, 'mock'); assert.equal(S.whoami.데이터구분, '시험(지정 폴더)');
    assert.equal(path.resolve(S.whoami.데이터폴더), path.resolve(데이터)); assert.match(S.출력, /Mock 모드 \(실제 AI 호출 없음\)/);
  });
  await 시험('요청 검사: 헤더 없는 쓰기 403, 다른 Origin 403, JSON 아님 415, 낯선 Host 403', async () => {
    assert.equal((await 요청(S.포트, 'POST', '/api/notice/mock/seed', { 본문: {} })).status, 403);
    assert.equal((await 요청(S.포트, 'POST', '/api/notice/mock/seed', { 본문: {}, 헤더: { origin: 'http://evil.example', 'x-office-request': '1' } })).status, 403);
    const 글 = await new Promise((res) => { const r = http.request({ host: '127.0.0.1', port: S.포트, method: 'POST', path: '/api/notice/mock/seed', headers: { origin: `http://127.0.0.1:${S.포트}`, 'x-office-request': '1', 'content-type': 'text/plain' } }, (x) => { x.resume(); res(x.statusCode); }); r.end('x'); });
    assert.equal(글, 415);
    const 호스트 = await new Promise((res) => { const r = http.request({ host: '127.0.0.1', port: S.포트, path: '/api/notice/whoami', headers: { host: 'evil.example' } }, (x) => { x.resume(); res(x.statusCode); }); r.end(); });
    assert.equal(호스트, 403);
    assert.equal((await 쓰기(S, '/api/planning/start', {})).status, 423); // 이 서버에서는 블로그팀 기능이 꺼져 있어요
  });
  await 시험('공고 센터 방: 설정에 notice 방(캐릭터 6명, 기존 그림), 블로그 방 그대로, 상태 API가 notice 방 캐릭터 상태를 줘요', async () => {
    const r = await 읽기(S, '/api/all'); assert.equal(r.status, 200);
    const 방들 = r.json.설정.방; assert.deepEqual(방들.map((b) => b.id), ['blog', 'notice']);
    const 공고방 = 방들.find((b) => b.id === 'notice'); const 블로그 = 방들.find((b) => b.id === 'blog');
    assert.equal(공고방.직원.length, 6); assert.equal(블로그.직원.length, 6);
    for (const s of 공고방.직원) assert.ok(블로그.직원.some((b) => b.이미지 === s.이미지), '새 이미지를 쓰면 안 돼요');
    assert.equal(공고방.배경, 블로그.배경);
    const ep = r.json.방상태.notice.에피소드[0].데이터; assert.deepEqual(Object.keys(ep.직원).sort(), ['leader', 'operator', 'searcher', 'spare1', 'spare2', 'verifier']);
    for (const 파일 of ['/', '/office.js', '/notice-ui.js', '/office.css', '/그림/02_artist_kyu.png']) assert.equal((await 읽기(S, encodeURI(파일))).status, 200, 파일);
  });

  let 개요;
  await 시험('시험 자료 채우기 → 게시판 점검 1회차: 정상·접속 실패·추출 실패가 구분돼 기록되고 "신규 없음"으로 보이지 않아요', async () => {
    const 시드 = await 쓰기(S, '/api/notice/mock/seed', {}); assert.equal(시드.json.추가한기관, 5);
    assert.equal((await 쓰기(S, '/api/notice/mock/seed', {})).json.추가한기관, 0); // 여러 번 눌러도 중복 없음
    const c = await 쓰기(S, '/api/notice/collect', {}); assert.equal(c.status, 200);
    const 결과 = Object.fromEntries(c.json.결과.map((x) => [x.기관ID, x]));
    assert.equal(결과['t-yongin'].결과, '정상 완료·신규 발견'); assert.equal(결과['t-seongnam'].결과, '접속 실패'); assert.equal(결과['t-seongnam'].HTTP상태, 500);
    assert.equal(결과['t-seoul'].결과, '자료 추출 실패'); assert.equal(c.json.AI호출.횟수, 0);
    개요 = (await 읽기(S, '/api/notice/overview')).json;
    assert.deepEqual(개요.다시확인기관.map((k) => k.id).sort(), ['t-seongnam', 't-seoul']);
    assert.ok(개요.다시확인기관.every((k) => !/신규 없음/.test(k.결과)));
    assert.equal(개요.합계.전체, 7);
    // 공고가 저장되고 다시 열려요
    const 목록 = (await 읽기(S, '/api/notice/list?보기=전체')).json.목록; assert.equal(목록.length, 7);
    const 상세 = (await 읽기(S, `/api/notice/notices/${목록[0].id}`)).json; assert.equal(상세.id, 목록[0].id); assert.ok(상세.공식링크.endsWith('.invalid') || /\.invalid\//.test(상세.공식링크));
    assert.ok(목록.every((x) => x.시험용 && x.공고명.startsWith('[시험용]')), '가짜 공고에는 모두 시험용 표지가 있어야 해요');
  });
  await 시험('2회차: 마감 연장·재공고·신규 판별, 실패했던 기관 복구와 누락 기록(근거 있는 원인만)', async () => {
    const c = await 쓰기(S, '/api/notice/collect', {}); assert.equal(c.status, 200);
    const 목록 = (await 읽기(S, '/api/notice/list?보기=전체')).json.목록; const 이름 = (t) => 목록.find((x) => x.공고명.includes(t));
    assert.equal(c.json.지표.변경, 1); assert.equal(이름('생성형 AI 활용').공고상태, '마감 연장');
    assert.ok(목록.some((x) => x.공고상태 === '재공고')); assert.ok(이름('웹툰 입문')); assert.equal(목록.length, 13, '신규 6건만 늘어야 해요 (7 + 용인 2 + 성남 2 + 서울 2)');
    const 누락 = (await 읽기(S, '/api/notice/misses')).json.누락;
    const 성남 = 누락.filter((m) => m.기관ID === 't-seongnam'); assert.equal(성남.length, 2);
    assert.ok(성남.every((m) => m.추정원인 === '해당 기관 점검 실패')); assert.ok(성남.some((m) => m.마감후발견));
    const 인천 = 이름('인천 지역 한정'); assert.equal(인천.노출, false); assert.equal(인천.노출사유, '인천'); assert.equal(인천.AI검증사유, '코드판정-지역');
    const 마감 = 이름('마감 지난 공고'); assert.ok(목록.filter((x) => x.공고명.includes('마감 지난 공고')).some((x) => x.공고상태 === '접수 마감' && x.노출 === false));
    assert.equal((await 읽기(S, '/api/notice/list?보기=추천')).json.목록.some((x) => x.공고명.includes('인천')), false); // 추천 목록에는 안 나와요
    assert.equal((await 읽기(S, '/api/notice/list?보기=보관')).json.목록.some((x) => x.공고명.includes('인천')), true); // 보관 보기에는 있어요
    개요 = (await 읽기(S, '/api/notice/overview')).json; assert.equal(개요.다시확인기관.length, 0);
  });
  let 계획;
  await 시험('검증(B): 예상 호출 수를 보여주고, 실행당 상한 안에서 Mock으로 검증, 결과 반영', async () => {
    계획 = (await 읽기(S, '/api/notice/verify/plan')).json; assert.equal(계획.종류, '추정'); assert.ok(계획.예상호출수 <= 5 && 계획.예상호출수 >= 1);
    const v = await 쓰기(S, '/api/notice/verify', {}); assert.equal(v.status, 200); assert.equal(v.json.AI호출.횟수, 계획.예상호출수); assert.equal(v.json.AI호출.토큰, '해당 없음 (Mock)');
    const 목록 = (await 읽기(S, '/api/notice/list?보기=전체')).json.목록; const 이름 = (t) => 목록.find((x) => x.공고명.includes(t));
    assert.equal(이름('생성형 AI 활용').검증상태, '검증됨'); assert.equal(이름('생성형 AI 활용').판정, '적합');
    assert.equal(이름('법인 대상').판정, '부적합'); assert.equal(이름('법인 대상').노출, false);
    assert.equal(이름('그림책 창작 강사 양성').판정, '확인 필요'); assert.equal(이름('청소년 그림 특강').판정, '확인 필요');
    const 상세 = (await 읽기(S, `/api/notice/notices/${이름('청소년 그림 특강').id}`)).json; assert.ok(상세.적합도.확인필요.some((x) => /마감일 불확실/.test(x))); assert.equal(상세.접수마감.날짜, null); // 추정하지 않아요
    assert.equal((await 쓰기(S, '/api/notice/verify', {})).json.AI호출.횟수, 0); // 변경 없으면 AI 안 불러요
    const 오늘호출 = (await 읽기(S, '/api/notice/overview')).json.지표.find((m) => m.이름 === 'AI 호출 횟수'); assert.match(오늘호출.값, /Mock/);
  });
  let 대상ID;
  await 시험('지원 상태·메모 저장, 잘못된 상태 거부, 판정 수동 변경(이유 필수), 자동으로 지원 완료가 되지 않음', async () => {
    const 목록 = (await 읽기(S, '/api/notice/list?보기=추천')).json.목록; assert.ok(목록.every((x) => x.지원상태 === '')); // 자동 지원 처리 없음
    대상ID = 목록.find((x) => x.공고명.includes('생성형 AI 활용')).id;
    assert.equal((await 쓰기(S, `/api/notice/notices/${대상ID}/status`, { 지원상태: '지원 완료!' })).status, 400);
    const ok = await 쓰기(S, `/api/notice/notices/${대상ID}/status`, { 지원상태: '관심', 메모: '이력서 준비하기' }); assert.equal(ok.status, 200);
    const 상세 = (await 읽기(S, `/api/notice/notices/${대상ID}`)).json; assert.equal(상세.지원상태, '관심'); assert.equal(상세.메모, '이력서 준비하기'); assert.equal(상세.지원이력.length, 1);
    assert.equal((await 쓰기(S, `/api/notice/notices/${대상ID}/judgment`, { 판정: '부적합' })).status, 400); // 이유 없으면 거부
    assert.equal((await 쓰기(S, `/api/notice/notices/${대상ID}/judgment`, { 판정: '부적합', 이유: '시간대가 안 맞아요' })).json.적합도.판정, '부적합');
    assert.equal((await 쓰기(S, `/api/notice/notices/${대상ID}/judgment-clear`, {})).json.적합도.판정, '적합');
    assert.equal((await 읽기(S, '/api/notice/overview')).json.지원진행['관심'], 1);
  });
  await 시험('직접 등록: 공식 링크 필수, 같은 링크는 기존, 시험용 표지 없는 실제 입력은 시험용으로 표시되지 않음', async () => {
    assert.equal((await 쓰기(S, '/api/notice/notices', { 공고명: '링크 없는 공고', 기관명: '직접', 지역: '용인시' })).status, 400);
    const a = await 쓰기(S, '/api/notice/notices', { 공고명: '직접 넣은 공고', 기관명: '직접 입력 기관', 지역: '수원시', 공식링크: 'https://example.com/a?utm_source=x', 마감원문: '2099.12.31(목) 18시' });
    assert.equal(a.json.종류, '신규'); assert.equal(a.json.공고.시험용, false); assert.equal(a.json.공고.우선순위, 1);
    assert.equal((await 쓰기(S, '/api/notice/notices', { 공고명: '직접 넣은 공고', 기관명: '직접 입력 기관', 지역: '수원시', 공식링크: 'https://example.com/a', 마감원문: '2099.12.31(목) 18시' })).json.종류, '기존');
  });
  await 시험('기관 관리: 인천 거부, 추가·중지·재개, 중지해도 기존 공고 기록 유지', async () => {
    const 기관 = (id, 지역, 주소) => ({ id, 이름: id, 유형: '도서관', 지역, 게시판: [{ 주소 }] });
    const 인천 = await 쓰기(S, '/api/notice/institutions', { 동작: '추가', 기관: 기관('inc1', '인천광역시 남동구', 'https://x.example.com/') }); assert.equal(인천.status, 400); assert.match(인천.json.오류, /인천/);
    assert.equal((await 쓰기(S, '/api/notice/institutions', { 동작: '추가', 기관: 기관('new1', '용인시', 'https://yongin-lifelong.test.invalid/notice') })).status, 409); // 이미 등록된 주소
    assert.equal((await 쓰기(S, '/api/notice/institutions', { 동작: '추가', 기관: 기관('new1', '용인시', 'https://new1.example.com/b') })).status, 200);
    const 전 = (await 읽기(S, '/api/notice/list?보기=전체')).json.합계;
    assert.equal((await 쓰기(S, '/api/notice/institutions', { 동작: '중지', id: 't-yongin' })).json.기관.사용, false);
    assert.equal((await 읽기(S, '/api/notice/list?보기=전체')).json.합계, 전);
    await 쓰기(S, '/api/notice/institutions', { 동작: '재개', id: 't-yongin' });
  });
  await 시험('설정: 상한 올리기는 확인 필요, 낮추기는 바로, 이상한 값 거부, 이력 기록', async () => {
    assert.equal((await 쓰기(S, '/api/notice/settings', { AI한도: { 실행당: 8 } })).status, 409);
    assert.equal((await 쓰기(S, '/api/notice/settings', { AI한도: { 실행당: -3 } })).status, 400);
    assert.equal((await 쓰기(S, '/api/notice/settings', { AI한도: { 실행당: 4 } })).status, 200);
    const s = (await 읽기(S, '/api/notice/settings')).json; assert.equal(s.설정.AI한도.실행당, 4); assert.equal(s.설정.AI한도.하루, 15); assert.equal(s.설정.AI한도.재시도, 1); assert.equal(s.이력.length, 1);
    await 쓰기(S, '/api/notice/settings', { AI한도: { 실행당: 5 }, 확인: true });
  });
  await 시험('서버를 껐다 켜도 데이터가 그대로 다시 열려요 (다른 인스턴스)', async () => {
    const 이전ID = S.인스턴스ID; const 전체 = (await 읽기(S, '/api/notice/list?보기=전체')).json.합계;
    await 끄기(S); S = await 서버켜기({ 데이터 });
    assert.notEqual(S.인스턴스ID, 이전ID);
    assert.equal((await 읽기(S, '/api/notice/list?보기=전체')).json.합계, 전체);
    assert.equal((await 읽기(S, `/api/notice/notices/${대상ID}`)).json.지원상태, '관심');
    assert.ok((await 읽기(S, '/api/notice/runs')).json.실행.length >= 4);
  });

  await 시험('R-1 재발 방지: 이미 다른 서버가 쓰는 포트로는 시작을 거부하고 요청을 한 건도 받지 않아요', async () => {
    const 점유 = http.createServer((req, res) => { 점유.요청수 = (점유.요청수 || 0) + 1; res.end('다른 서버'); });
    await new Promise((r) => 점유.listen(0, '127.0.0.1', r));
    const 포트 = 점유.address().port;
    await assert.rejects(서버켜기({ 데이터: path.join(임시, 'data-r1'), 포트: String(포트) }), (e) => e.종료코드 === 1 && /이미 쓰고 있어요/.test(e.오류));
    assert.equal(점유.요청수 || 0, 0); // 점유한 쪽으로 어떤 요청도 가지 않았어요
    await new Promise((r) => 점유.close(r));
  });
  await 시험('모드 열쇠: real 요청만으로는 Mock, 3중 열쇠가 모두 있어도 실제 AI 연결은 아직 없어서 호출 0·기록 0', async () => {
    const A = await 서버켜기({ 데이터: path.join(임시, 'data-real-a'), 환경: { OFFICE_MODE: 'real' } });
    assert.equal(A.whoami.모드, 'mock'); assert.ok(A.whoami.경고.length >= 1); await 끄기(A);
    const 폴더 = path.join(임시, 'data-real-b'); fs.mkdirSync(폴더, { recursive: true });
    const B1 = await 서버켜기({ 데이터: 폴더, 환경: { OFFICE_MODE: 'real', OFFICE_ALLOW_REAL: '1' } });
    assert.equal(B1.whoami.모드, 'mock'); assert.match(B1.whoami.경고.join(' '), /settings\.json/); await 끄기(B1); // 설정 모드 열쇠가 없으면 Mock
    fs.writeFileSync(path.join(폴더, 'settings.json'), JSON.stringify({ 모드: 'real' }));
    const B = await 서버켜기({ 데이터: 폴더, 환경: { OFFICE_MODE: 'real', OFFICE_ALLOW_REAL: '1' } });
    assert.equal(B.whoami.모드, 'real'); assert.equal(B.whoami.데이터구분, '시험(지정 폴더)');
    assert.equal((await 쓰기(B, '/api/notice/mock/seed', {})).status, 403); // 실제 모드에는 가짜 자료를 넣지 않아요
    assert.equal((await 쓰기(B, '/api/notice/collect', {})).status, 200); // 등록 기관이 없어 외부 접속 없이 완료
    await 쓰기(B, '/api/notice/notices', { 공고명: '실제 모드 직접 등록', 기관명: '직접', 지역: '용인시', 공식링크: 'https://example.com/real', 본문: '대상: 시민', 마감원문: '2099.12.31(목)' });
    assert.equal((await 쓰기(B, '/api/notice/verify', {})).status, 409); // 예상 호출 수 확인이 없으면 시작하지 않아요
    const 계획 = (await 읽기(B, '/api/notice/verify/plan')).json;
    const v = await 쓰기(B, '/api/notice/verify', { 확인호출수: 계획.예상호출수 });
    assert.match(v.json.중단이유, /연결이 아직 없어요/); assert.equal(v.json.AI호출.횟수, 0);
    assert.equal(fs.existsSync(path.join(폴더, 'usage.jsonl')), false); // 호출 기록조차 없어요
    await 끄기(B);
  });
  await 시험('자식 서버들에서 외부 프로세스·네트워크 시도 0건 (실제 Codex/Claude가 실행될 길 없음)', () => {
    assert.equal(fs.existsSync(안전망기록) ? fs.readFileSync(안전망기록, 'utf8') : '', '');
  });
  await 시험('기존 자산·운영 데이터 보존: 상태·작업·archive·직원·규칙·그림 해시 불변, 운영 공고\\ 폴더 미생성, 4173 서버 그대로', async () => {
    const 후 = Object.assign({}, ...지킬곳.map(해시폴더));
    assert.deepEqual(후, 시작전);
    assert.equal(fs.existsSync(path.join(루트, '공고')), 공고폴더있었나);
  });

  for (const s of 서버들) await 끄기(s);
  fs.rmSync(임시, { recursive: true, force: true });
  console.log(결과들.join('\n'));
  console.log(`\n${결과들.length - 실패수}/${결과들.length} 통과${실패수 ? `, ${실패수}개 실패` : ''}`);
  process.exit(실패수 ? 1 : 0);
})();
