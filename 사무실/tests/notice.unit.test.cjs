// 공고 센터 단위·시나리오 시험 (임시 폴더만 사용, 실제 AI·네트워크·외부 프로세스 호출 0).
// 실행: node 사무실/tests/notice.unit.test.cjs
'use strict';
const trip = require('./helpers/tripwire.cjs'); // 가장 먼저: 이후 외부 실행/네트워크는 모두 실패해요
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const N = path.join(__dirname, '..', 'notice');
const { createStore, 기관검사, 우선순위 } = require(path.join(N, 'store'));
const { createSettings } = require(path.join(N, 'settings'));
const { 마감읽기, 마감상태, 한국날짜 } = require(path.join(N, 'deadline'));
const D = require(path.join(N, 'differ'));
const { 수집, 직접등록 } = require(path.join(N, 'collector'));
const { 검증실행, 검증계획 } = require(path.join(N, 'extractor'));
const { MockClient, RealClient, 클라이언트만들기 } = require(path.join(N, 'clients'));

const 결과들 = []; let 실패수 = 0;
const 임시폴더들 = [];
async function 시험(이름, fn) {
  try { await fn(); 결과들.push(`PASS  ${이름}`); }
  catch (e) { 실패수++; 결과들.push(`FAIL  ${이름}\n      ${String(e.message).split('\n').slice(0, 16).join('\n      ') + (e.stack ? '\n      ' + e.stack.split('\n').find((l) => /notice\.unit\.test/.test(l)) : '')}`); }
}
function 새저장소() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-unit-')); 임시폴더들.push(dir);
  const store = createStore(dir); const settings = createSettings(store);
  return { dir, store, settings, 설정값: () => settings.읽기().값 };
}
const 기준 = new Date('2026-10-24T03:00:00Z'); // 한국 시각 2026-10-24(토) 12:00
const 날 = (n, h = 0) => new Date(기준.getTime() + n * 86400e3 + h * 3600e3);
const 날짜 = (n) => 한국날짜(날(n));
const 기관 = (id, 지역 = '용인시', 주소 = `https://${id}.example.invalid/board`) => ({ id, 이름: `[시험] ${id}`, 유형: '도서관', 지역, 게시판: [{ id: 'b1', 주소 }], 시험용: true });
function 기관들넣기(store, ...ids) { store.기관저장(ids.map((id) => 기관검사(typeof id === 'string' ? 기관(id) : id))); }
const 글 = (제목, 링크, 마감원문, 추가 = {}) => ({ 제목, 링크: `https://x.example.invalid/${링크}`, 게시일: null, 마감원문, 본문: `대상: 시민\n자격: 개인 누구나\n마감: ${마감원문}`, ...추가 });
// 회차별 응답을 정해 두는 가짜 게시판. 라운드마다 { items } | { 오류: {kind, http} } | { 추출실패: true }
function 가짜게시판(스크립트) {
  const 호출 = [];
  return {
    호출,
    async fetchBoard(기관, 판, { 회차 }) {
      호출.push(`${기관.id}#${회차}`);
      const 목록 = 스크립트[기관.id] || [];
      const r = 목록[Math.min(회차, 목록.length - 1)];
      if (!r) throw Object.assign(new Error('dns'), { kind: 'dns' });
      if (r.오류) throw Object.assign(new Error(r.오류.message || r.오류.kind), r.오류);
      if (r.추출실패) return { http: 200, items: null, 추출오류: '목록 구조를 알 수 없어요' };
      return { http: 200, items: r.items };
    },
  };
}
const 점검 = (s, 설정, f, 시각, 옵션 = {}) => 수집({ store: s.store, 설정, fetcher: f, 모드: 'mock', 지금: 시각, ...옵션 });

(async () => {
  // ---------------------------------------------------------------- A. 저장·검증 함수
  await 시험('A1 기관 검사: 인천 거부, 게시판 필수, 우선순위', () => {
    assert.throws(() => 기관검사({ ...기관('i1', '인천광역시 남동구') }), /인천/);
    assert.throws(() => 기관검사({ ...기관('i2'), 이름: '인천 도서관' }), /인천/);
    assert.throws(() => 기관검사({ ...기관('i3', '용인시', 'https://lib.incheon.go.kr/x') }), /인천/);
    assert.throws(() => 기관검사({ ...기관('b1'), 게시판: [] }), /게시판/);
    assert.throws(() => 기관검사({ ...기관('b2'), 게시판: [{ 주소: 'javascript:alert(1)' }] }), /http/);
    assert.throws(() => 기관검사({ ...기관('..x') }), /id/);
    assert.equal(우선순위('용인시'), 1); assert.equal(우선순위('성남시'), 1); assert.equal(우선순위('수원시'), 1);
    assert.equal(우선순위('경기도 화성시'), 2); assert.equal(우선순위('서울특별시'), 3); assert.equal(우선순위('전국'), null);
  });
  await 시험('A2 저장소: 덮어쓰기 금지, 폴더 밖 쓰기 거부, 임시 파일 안 남김, 잘못된 id 거부', () => {
    const s = 새저장소();
    const n = D.공고만들기(글('가', 'a1', `${날짜(10)}`), 기관검사(기관('k1')), { 시각: 기준.toISOString(), 실행ID: 'r1' });
    s.store.공고새로(n);
    assert.throws(() => s.store.공고새로(n), /이미 있어요/);
    assert.throws(() => s.store.쓰기(path.join(s.dir, '..', 'evil.json'), {}), /밖/);
    assert.throws(() => s.store.공고읽기('../x'), /잘못된 id/);
    s.store.공고저장({ ...n, 메모: '고침' });
    assert.equal(s.store.공고읽기(n.id).메모, '고침');
    assert.deepEqual(fs.readdirSync(path.join(s.dir, 'notices')).filter((f) => f.endsWith('.tmp')), []);
    fs.writeFileSync(path.join(s.dir, 'notices', 'broken.json'), '{ 깨진');
    assert.equal(s.store.공고목록().length, 1); assert.match(s.store.경고[0], /broken/); // 깨진 파일 하나가 전체를 막지 않아요
  });
  await 시험('A3 설정: 기본 5/15/1, 상한 올리기는 확인 필요, 이상한 값은 기본값 복귀, 이력 기록', () => {
    const s = 새저장소();
    const 기본 = s.설정값().AI한도; assert.equal(기본.실행당, 5); assert.equal(기본.하루, 15); assert.equal(기본.재시도, 1);
    assert.throws(() => s.settings.바꾸기({ AI한도: { 실행당: 8 } }), /확인/);
    assert.throws(() => s.settings.바꾸기({ AI한도: { 실행당: -1 } }), /정수/);
    assert.throws(() => s.settings.바꾸기({ AI한도: { 하루: 'abc' } }), /정수/);
    assert.throws(() => s.settings.바꾸기({ AI한도: { 이상한: 1 } }), /알 수 없는/);
    s.settings.바꾸기({ AI한도: { 실행당: 3 } });
    assert.equal(s.설정값().AI한도.실행당, 3);
    s.settings.바꾸기({ AI한도: { 실행당: 8 }, 확인: true }); assert.equal(s.설정값().AI한도.실행당, 8);
    const 이력 = s.settings.이력읽기(); assert.equal(이력.length, 2); assert.equal(이력[0].이전, 5); assert.equal(이력[0].이후, 3);
    fs.writeFileSync(path.join(s.dir, 'settings.json'), JSON.stringify({ AI한도: { 실행당: -1, 하루: 'abc', 재시도: 99 } }));
    const 읽음 = s.settings.읽기(); assert.equal(읽음.값.AI한도.실행당, 5); assert.equal(읽음.값.AI한도.하루, 15); assert.equal(읽음.값.AI한도.재시도, 1); assert.equal(읽음.경고.length, 3);
    const v1 = s.settings.읽기().값.버전.내조건; s.settings.바꾸기({ 내조건: { 사업자: '없음' } });
    assert.equal(s.설정값().버전.내조건, v1 + 1);
  });
  await 시험('A4 마감 읽기: 확정/불확실/상시, 요일·연도·시각, 마감 지남은 확정일 때만', () => {
    assert.equal(마감읽기('2026.10.31(토) 18시').마감판정, '확정');
    assert.equal(마감읽기('2026.10.31(토) 18시').시각, '18:00');
    assert.equal(마감읽기('2026-10-31까지').시각, null);
    assert.match(마감읽기('2026.10.31(월)').판정근거, /요일/); assert.equal(마감읽기('2026.10.31(월)').마감판정, '불확실');
    assert.match(마감읽기('10.31(금) 18시').판정근거, /연도/); assert.equal(마감읽기('10.31(금) 18시').날짜, null);
    assert.equal(마감읽기('~11월 말').마감판정, '불확실');
    assert.equal(마감읽기('').마감판정, '불확실');
    assert.equal(마감읽기('2026.02.30').마감판정, '불확실');
    assert.equal(마감읽기('상시 모집').마감판정, '해당없음');
    const 기간 = 마감읽기('2026.10.20 ~ 2026.10.31'); assert.equal(기간.날짜, '2026-10-31'); assert.equal(기간.시작날짜, '2026-10-20');
    const 상태 = (t, 지금) => 마감상태(마감읽기(t), 지금);
    assert.equal(상태('2026-10-23', 기준).마감지남, true);
    assert.equal(상태('2026-10-24', 기준).마감지남, false); assert.equal(상태('2026-10-24', 기준).당일, true); // 시각 없으면 그날 끝까지
    assert.equal(상태('2026-10-24 10:00', 기준).마감지남, true); // 한국시각 12:00 > 10:00
    assert.equal(상태('2026-10-25', 기준).남은일수, 1);
    assert.equal(상태('11월 말', 기준).마감지남, false); // 불확실한 마감은 닫지 않아요
  });

  // ---------------------------------------------------------------- B. 공고 판별·상태
  await 시험('B1 비교: 같은 링크=기존, 제목 바뀜=수정, 마감 뒤로=마감 연장, 새 기간=재공고, 비슷한 제목=후보 중복, 다른 글=신규', () => {
    const k = 기관검사(기관('k1')); const 만들기 = (제목, 링크, 마감) => D.공고만들기({ 제목, 링크: `https://x.example.invalid/${링크}`, 마감원문: 마감, 본문: '본문 ' + 제목 }, k, { 시각: 기준.toISOString(), 실행ID: 'r1' });
    const 원본 = 만들기('AI 드로잉 강사 모집', 'p1?utm_source=a', '2026.11.01 ~ 2026.11.20');
    const 목록 = [원본];
    assert.equal(D.분류하기(목록, 만들기('AI 드로잉 강사 모집', 'p1', '2026.11.01 ~ 2026.11.20')).종류, '기존'); // 추적 변수 무시
    const 수정 = D.분류하기(목록, 만들기('AI 드로잉 강사 모집 (정정)', 'p1', '2026.11.01 ~ 2026.11.20')); assert.equal(수정.종류, '수정'); assert.equal(수정.변경[0].항목, '공고명');
    const 연장 = D.분류하기(목록, 만들기('AI 드로잉 강사 모집', 'p1', '2026.11.01 ~ 2026.11.30')); assert.equal(연장.종류, '마감 연장');
    assert.ok(연장.변경.some((c) => c.항목 === '접수 마감 표기'));
    assert.equal(D.분류하기(목록, 만들기('AI 드로잉 강사 모집', 'p2', '2026.12.01 ~ 2026.12.20')).종류, '재공고');
    assert.equal(D.분류하기(목록, 만들기('[모집] AI 드로잉 강사 모집', 'p3', '2026.11.05 ~ 2026.11.25')).종류, '후보중복');
    assert.equal(D.분류하기(목록, 만들기('도서관 그림책 공모전 안내', 'p4', '2026.11.05 ~ 2026.11.25')).종류, '신규');
  });
  await 시험('B2 규칙: 인천(확실)·마감 확정은 AI 검증 생략+추천 비노출이지만 기록은 그대로', () => {
    const s = 새저장소(); const 설정 = s.설정값(); const k = 기관검사(기관('k1'));
    const 만들기 = (제목, 마감, 본문, 지역) => D.규칙적용(D.공고만들기({ 제목, 링크: `https://x.example.invalid/${제목}`, 마감원문: 마감, 본문, 지역 }, k, { 시각: 기준.toISOString(), 실행ID: 'r1' }), { 기관: k, 설정, 지금: 기준 });
    const 열림 = 만들기('열린 공고', `${날짜(10)} 18시`, '대상: 시민');
    assert.equal(열림['제외·보존'].AI검증.상태, '대상'); assert.equal(열림['제외·보존'].추천노출.노출, true); assert.equal(열림.적합도.판정, '확인 필요'); // AI 검증 전
    const 인천 = 만들기('인천 한정', `${날짜(10)}`, '지역: 인천 한정\n대상: 시민');
    assert.equal(인천['제외·보존'].AI검증.사유, '코드판정-지역'); assert.equal(인천['제외·보존'].추천노출.노출, false); assert.equal(인천['제외·보존'].추천노출.사유, '인천'); assert.equal(인천.적합도.판정, '부적합');
    const 인천불확실 = 만들기('인천 연계 사업', `${날짜(10)}`, '대상: 시민');
    assert.equal(인천불확실['제외·보존'].추천노출.노출, true); assert.ok(인천불확실.적합도.확인필요.some((x) => /지역 불확실/.test(x))); assert.equal(인천불확실['제외·보존'].AI검증.상태, '대상');
    const 마감 = 만들기('지난 공고', `${날짜(-3)}`, '대상: 시민');
    assert.equal(마감.공고상태, '접수 마감'); assert.equal(마감['제외·보존'].AI검증.사유, '코드판정-마감확정'); assert.equal(마감['제외·보존'].추천노출.사유, '마감'); assert.equal(마감['제외·보존'].보존, true);
    const 불확실 = 만들기('애매한 공고', '11월 말', '대상: 시민');
    assert.equal(불확실.공고상태, '신규'); assert.equal(불확실['제외·보존'].추천노출.노출, true); assert.equal(불확실.적합도.판정, '확인 필요'); assert.ok(불확실.적합도.확인필요.some((x) => /마감일 불확실/.test(x)));
    assert.equal(불확실['제외·보존'].AI검증.상태, '대상'); // 불확실하다고 마감 처리하거나 버리지 않아요
    const 오늘 = 만들기('오늘 마감', `${날짜(0)}`, '대상: 시민'); assert.equal(오늘.공고상태, '신규'); assert.ok(오늘.적합도.확인필요.some((x) => /오늘 마감/.test(x)));
    const 둘다 = 만들기('인천 마감', `${날짜(-3)}`, '지역: 인천 한정'); assert.ok(둘다.적합도.미충족.length === 2); // 두 사유가 모두 남아요
  });

  // ---------------------------------------------------------------- C. 수집(A단계) 시나리오
  await 시험('S4 접속 실패 4종은 모두 "접속 실패"이고 "신규 없음"으로 보이지 않아요', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a', 'b', 'c', 'd');
    const f = 가짜게시판({ a: [{ 오류: { kind: 'timeout', message: '시간 초과' } }], b: [{ 오류: { kind: 'http', http: 500 } }], c: [{ 오류: { kind: 'http', http: 403 } }], d: [{ 오류: { kind: 'dns' } }] });
    const run = await 점검(s, s.설정값(), f, 기준);
    assert.deepEqual(run.결과.map((x) => x.결과), ['접속 실패', '접속 실패', '접속 실패', '접속 실패']);
    assert.equal(run.결과[1].HTTP상태, 500); assert.equal(run.결과[2].HTTP상태, 403);
    assert.equal(run.지표.완료, 0); assert.equal(run.지표.접속실패, 4); assert.equal(run.AI호출.횟수, 0);
    assert.ok(!run.결과.some((x) => /신규 없음/.test(x.결과)));
    assert.ok(s.store.기관목록().every((k) => k.마지막점검.결과 === '접속 실패'));
    assert.equal(s.store.스냅샷목록('a').length, 0); // 실패한 점검은 목록 기록을 남기지 않아요
  });
  await 시험('S4b/S4c/S4d 추출 실패, 급격히 적은 결과=검증 필요, 실패 기관만 재점검', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a', 'b', 'c');
    const 열개 = Array.from({ length: 10 }, (_, i) => 글(`상시 모집 공고 ${i}`, `a${i}`, `${날짜(20)}`));
    const f = 가짜게시판({ a: [{ items: 열개 }, { items: [] }], b: [{ 추출실패: true }, { items: [글('복구된 공고', 'b1', `${날짜(20)}`)] }], c: [{ items: [글('정상 공고', 'c1', `${날짜(20)}`)] }, { items: [글('정상 공고', 'c1', `${날짜(20)}`)] }] });
    const r1 = await 점검(s, s.설정값(), f, 날(0));
    assert.deepEqual(r1.결과.map((x) => x.결과), ['정상 완료·신규 발견', '자료 추출 실패', '정상 완료·신규 발견']);
    const r2 = await 점검(s, s.설정값(), f, 날(1));
    assert.equal(r2.결과.find((x) => x.기관ID === 'a').결과, '검증 필요'); // 평소 10건인데 0건
    assert.equal(r2.결과.find((x) => x.기관ID === 'c').결과, '정상 완료·신규 없음');
    assert.equal(s.store.스냅샷목록('a').length, 1); // 의심스러운 결과는 기준으로 남기지 않아요
    // 재점검: 실패·의심 기관만
    assert.equal(r2.결과.find((x) => x.기관ID === 'b').결과, '정상 완료·신규 발견'); // b는 2회차에 복구됐어요
    const 다시확인 = s.store.기관목록().filter((k) => ['검증 필요', '자료 추출 실패', '접속 실패'].includes(k.마지막점검.결과)).map((k) => k.id);
    assert.deepEqual(다시확인, ['a']);
    f.호출.length = 0;
    const r3 = await 점검(s, s.설정값(), f, 날(2), { 기관ID목록: 다시확인 });
    assert.deepEqual(f.호출.map((x) => x.split('#')[0]), ['a']); // 정상이던 b·c는 다시 부르지 않아요
    assert.equal(r3.결과.length, 1);
  });
  await 시험('S1 과거 누락 공고: 실패했던 실행이 근거일 때만 원인을 적고, 근거가 없으면 원인 확인 불가', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'b');
    const 놓친 = 글('놓친 공고', 'p', `${날짜(30)}`, { 게시일: 날짜(-1) });
    const f = 가짜게시판({ b: [{ 오류: { kind: 'http', http: 500 } }, { items: [놓친] }] });
    const r1 = await 점검(s, s.설정값(), f, 날(0));
    const r2 = await 점검(s, s.설정값(), f, 날(3));
    assert.equal(r2.지표.신규, 1); assert.equal(r2.누락기록수, 1);
    const m = s.store.누락목록()[0];
    assert.equal(m.추정원인, '해당 기관 점검 실패'); assert.equal(m.원래게시일, 날짜(-1)); assert.equal(m.최초발견일, 날짜(3));
    assert.equal(m.누락된실행[0].실행ID, r1.id); assert.match(m.누락된실행[0].기관결과, /접속 실패/);
    // S1b: 이전 점검이 정상이었는데 안 보이던 글 -> 원인을 지어내지 않아요
    const s2 = 새저장소(); 기관들넣기(s2.store, 'b');
    const f2 = 가짜게시판({ b: [{ items: [글('기존 공고', 'e', `${날짜(30)}`)] }, { items: [글('기존 공고', 'e', `${날짜(30)}`), 글('뒤늦게 보인 공고', 'q', `${날짜(30)}`, { 게시일: 날짜(-1) })] }] });
    await 점검(s2, s2.설정값(), f2, 날(0)); await 점검(s2, s2.설정값(), f2, 날(3));
    const m2 = s2.store.누락목록()[0]; assert.equal(m2.추정원인, '원인 확인 불가'); assert.equal(m2.재발방지조치, '없음 (원인 확인 불가)');
    // 첫 점검은 기준선이라 누락으로 세지 않아요
    const s3 = 새저장소(); 기관들넣기(s3.store, 'b');
    await 점검(s3, s3.설정값(), 가짜게시판({ b: [{ items: [글('처음 본 공고', 'z', `${날짜(30)}`, { 게시일: 날짜(-5) })] }] }), 날(0));
    assert.equal(s3.store.누락목록().length, 0);
  });
  await 시험('S12/S12b 마감 공고는 지우지 않고 보존, 마감 후 발견도 등록+누락 기록', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    const f = 가짜게시판({ a: [{ items: [글('곧 마감 공고', 'o1', `${날짜(1)} 18시`)] }, { items: [글('곧 마감 공고', 'o1', `${날짜(1)} 18시`), 글('이미 끝난 공고', 'c1', `${날짜(-5)}`, { 게시일: 날짜(-20) })] }] });
    await 점검(s, s.설정값(), f, 날(0));
    const 전 = fs.readdirSync(path.join(s.dir, 'notices')).sort();
    // 시간이 흘러 마감이 지남 -> 표지만 바뀌고 파일은 그대로
    const { 목록 } = D.다시계산({ store: s.store, 설정: s.설정값(), 지금: 날(3) });
    assert.deepEqual(fs.readdirSync(path.join(s.dir, 'notices')).sort(), 전);
    const 마감 = s.store.공고읽기(목록[0].id);
    assert.equal(마감.공고상태, '접수 마감'); assert.equal(마감['제외·보존'].추천노출.노출, false); assert.equal(마감['제외·보존'].보존, true); assert.equal(마감['제외·보존'].AI검증.사유, '코드판정-마감확정');
    // 마감 후 발견
    const r2 = await 점검(s, s.설정값(), f, 날(4));
    const 늦은 = s.store.공고목록().find((n) => n.공고명 === '이미 끝난 공고');
    assert.ok(늦은); assert.equal(늦은.공고상태, '접수 마감'); assert.equal(늦은['제외·보존'].AI검증.사유, '코드판정-마감확정');
    assert.equal(r2.누락기록수, 1); assert.equal(s.store.누락목록()[0].마감후발견, true); assert.equal(r2.AI호출.횟수, 0);
  });
  await 시험('S13/S14 인천 사후 발견: 추천 안 함·기록 보존·AI 안 보냄, 기관을 중지해도 기존 기록 유지', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'seoul');
    const f = 가짜게시판({ seoul: [{ items: [글('전국 게시판의 인천 공고', 'i1', `${날짜(10)}`, { 본문: '지역: 인천 한정\n대상: 시민' }), 글('서울 공고', 'k1', `${날짜(10)}`)] }] });
    const r = await 점검(s, s.설정값(), f, 기준);
    const 인천 = s.store.공고목록().find((n) => n.공고명.includes('인천'));
    assert.equal(인천['제외·보존'].추천노출.노출, false); assert.equal(인천['제외·보존'].AI검증.상태, '생략'); assert.equal(인천.적합도.판정, '부적합');
    assert.equal(r.지표.신규, 2); // 발견은 기록에 셈
    const 서울 = s.store.공고목록().find((n) => n.공고명 === '서울 공고'); assert.equal(서울['제외·보존'].추천노출.노출, true);
    const 계획 = 검증계획({ store: s.store, 설정값: s.설정값(), 모드: 'mock', 지금: 기준 }); assert.equal(계획.대상수, 1); // 인천은 AI 대상에서 빠져요
    const 기관목록 = s.store.기관목록(); 기관목록[0].사용 = false; s.store.기관저장(기관목록);
    assert.equal(s.store.공고목록().length, 2); // 기관 중지가 기록을 지우지 않아요
    const r2 = await 점검(s, s.설정값(), f, 날(1), { 기관ID목록: ['seoul'] });
    assert.equal(r2.결과[0].결과, '검색 미실행'); assert.equal(r2.지표.미실행, 1);
  });
  await 시험('S2/S2b/S2c 재공고·마감 연장·후보 중복이 수집에서 구분돼요', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    const 원 = (extra) => 글('그림책 강사 양성과정', 'g1', '2026.10.01 ~ 2026.10.20', extra);
    const f = 가짜게시판({ a: [
      { items: [원()] },
      { items: [글('그림책 강사 양성과정', 'g1', '2026.10.01 ~ 2026.11.05'), 글('그림책 강사 양성과정', 'g2', '2026.12.01 ~ 2026.12.20'), 글('[모집] 그림책 강사 양성과정', 'g3', '2026.10.10 ~ 2026.11.01')] },
    ] });
    await 점검(s, s.설정값(), f, 날(0));
    const r2 = await 점검(s, s.설정값(), f, 날(1));
    const 목록 = s.store.공고목록(); const 원본 = 목록.find((n) => n.공식링크.endsWith('/g1')); const 재 = 목록.find((n) => n.공식링크.endsWith('/g2')); const 중복 = 목록.find((n) => n.공식링크.endsWith('/g3'));
    assert.equal(원본.공고상태, '마감 연장'); assert.ok(원본.변경이력.some((c) => c.항목 === '접수 마감 표기'));
    assert.equal(재.공고상태, '재공고'); assert.equal(재.연결.재공고원본ID, 원본.id); assert.equal(원본.연결.다음공고ID, 재.id);
    assert.equal(중복.중복후보, 원본.id); assert.equal(중복.공고상태, '신규'); // 자동 병합하지 않아요
    assert.equal(r2.지표.변경, 1); assert.equal(r2.지표.중복후보, 1); assert.equal(목록.length, 3);
    const r3 = await 점검(s, s.설정값(), f, 날(2)); assert.equal(r3.지표.신규, 0); assert.equal(r3.결과[0].결과, '정상 완료·신규 없음'); // 같은 글을 또 만들지 않아요
    assert.equal(s.store.공고목록().length, 3);
  });
  await 시험('S1c 30일 재확인: 새로 보이는 글은 누락 기록, 내려간 글은 복구 불가 안내', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    const f = 가짜게시판({ a: [{ items: [글('기존', 'e1', `${날짜(30)}`)] }, { items: [글('기존', 'e1', `${날짜(30)}`), 글('놓친1', 'm1', `${날짜(30)}`, { 게시일: 날짜(-3) }), 글('놓친2', 'm2', `${날짜(30)}`, { 게시일: 날짜(-8) })] }] });
    await 점검(s, s.설정값(), f, 날(0));
    const r = await 점검(s, s.설정값(), f, 날(2), { 재확인: true });
    assert.equal(r.종류, '재확인'); assert.equal(r.누락기록수, 2); assert.match(r.안내, /내려간 글은 다시 찾을 수 없어요/);
    assert.equal(s.store.누락목록().filter((m) => m.재확인).length, 2);
  });
  await 시험('직접 등록·가져오기도 같은 중복 판별을 거쳐요 (원천 표시)', () => {
    const s = 새저장소(); const k = 기관검사(기관('man'));
    const a = 직접등록({ store: s.store, 설정: s.설정값(), 항목: { 제목: '직접 넣은 공고', 링크: 'https://x.example.invalid/m1', 마감원문: `${날짜(9)}` }, 기관: k, 지금: 기준, 모드: 'mock' });
    assert.equal(a.종류, '신규'); assert.equal(a.공고.원천, '직접등록'); assert.equal(a.공고.검증상태, '후보'); // 본문이 없으면 후보
    const b = 직접등록({ store: s.store, 설정: s.설정값(), 항목: { 제목: '직접 넣은 공고', 링크: 'https://x.example.invalid/m1#top', 마감원문: `${날짜(9)}` }, 기관: k, 지금: 기준, 모드: 'mock' });
    assert.equal(b.종류, '기존'); assert.equal(s.store.공고목록().length, 1);
    assert.equal(a.공고['제외·보존'].AI검증.사유, '본문없음');
  });

  // ---------------------------------------------------------------- D. 검증(B단계) 시나리오
  // 본문이 서로 달라야 AI 결과 재사용(캐시)에 걸리지 않아요
  const 많은글 = (개수, 접두 = 'v') => Array.from({ length: 개수 }, (_, i) => 글(`${접두} 공고 ${i}`, `${접두}${i}`, `${날짜(20)}`, { 본문: `대상: 시민 ${i}번 모집\n마감: ${날짜(20)}` }));
  await 시험('S7 한도: 40건 → 5회에서 멈추고 25건 처리·15건 미처리, 이어서 하면 나머지 처리, 하루 합산', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    await 점검(s, s.설정값(), 가짜게시판({ a: [{ items: 많은글(40) }] }), 기준);
    const 계획 = 검증계획({ store: s.store, 설정값: s.설정값(), 모드: 'mock', 지금: 기준 });
    assert.equal(계획.대상수, 40); assert.equal(계획.예상호출수, 8); assert.equal(계획.가능호출수, 5); assert.equal(계획.미처리예상, 15); assert.equal(계획.종류, '추정');
    const client = new MockClient();
    const r1 = await 검증실행({ store: s.store, 설정값: s.설정값(), client, 모드: 'mock', 지금: 기준 });
    assert.equal(client.호출수, 5); assert.equal(r1.AI호출.횟수, 5); assert.match(r1.중단이유, /실행당 호출 상한\(5회\)/);
    assert.equal(r1.결과.filter((x) => x.결과 === '미처리').length, 15);
    const 미처리 = s.store.공고목록().filter((n) => n['제외·보존'].AI검증.미처리);
    assert.equal(미처리.length, 15); assert.equal(client.호출수, 5); // 6번째 호출 없음
    const r2 = await 검증실행({ store: s.store, 설정값: s.설정값(), client, 모드: 'mock', 지금: 기준 });
    assert.equal(r2.AI호출.횟수, 3); assert.equal(s.store.공고목록().filter((n) => n['제외·보존'].AI검증.상태 === '대상').length, 0);
    assert.equal(s.store.사용량읽기().filter((e) => e.이벤트 === '시작').length, 8);
    // 하루 상한: 하루=10으로 낮춘 새 저장소
    const t = 새저장소(); 기관들넣기(t.store, 'a'); t.settings.바꾸기({ AI한도: { 하루: 6 } });
    await 점검(t, t.설정값(), 가짜게시판({ a: [{ items: 많은글(40) }] }), 기준);
    const c2 = new MockClient(); await 검증실행({ store: t.store, 설정값: t.설정값(), client: c2, 모드: 'mock', 지금: 기준 });
    const r4 = await 검증실행({ store: t.store, 설정값: t.설정값(), client: c2, 모드: 'mock', 지금: 기준 });
    assert.equal(c2.호출수, 6); assert.match(r4.중단이유, /하루 호출 상한\(6회\)/); // 5 + 1
    const r5 = await 검증실행({ store: t.store, 설정값: t.설정값(), client: c2, 모드: 'mock', 지금: 날(1) }); // 다음 날 0으로
    assert.ok(r5.AI호출.횟수 > 0);
    // mock 호출은 real 하루 합계에 섞이지 않아요
    assert.equal(t.store.사용량읽기().every((e) => e.모드 === 'mock'), true);
  });
  await 시험('S7b 설정 변경은 다음 실행부터: 실행당 3회로 낮추면 3회에서 멈춰요', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a'); await 점검(s, s.설정값(), 가짜게시판({ a: [{ items: 많은글(20) }] }), 기준);
    s.settings.바꾸기({ AI한도: { 실행당: 3 } });
    const c = new MockClient(); const r = await 검증실행({ store: s.store, 설정값: s.설정값(), client: c, 모드: 'mock', 지금: 기준 });
    assert.equal(c.호출수, 3); assert.match(r.중단이유, /3회/);
  });
  await 시험('한도 오류는 자동 재시도 없이 멈추고 남은 공고는 미처리, 일시 오류는 1번만 재시도', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a'); await 점검(s, s.설정값(), 가짜게시판({ a: [{ items: 많은글(12) }] }), 기준);
    let 호출 = 0; const 한도클라 = { mock: true, 이름: 'Script', async extract() { 호출++; throw Object.assign(new Error('사용 한도'), { kind: 'limit' }); } };
    const r = await 검증실행({ store: s.store, 설정값: s.설정값(), client: 한도클라, 모드: 'mock', 지금: 기준 });
    assert.equal(호출, 1); assert.match(r.중단이유, /자동으로 다시 하지 않고/); assert.equal(r.결과.filter((x) => x.결과 === '미처리').length, 12);
    assert.equal(s.store.공고목록().every((n) => n['제외·보존'].AI검증.상태 === '대상' && n['제외·보존'].AI검증.미처리), true); // 잃어버린 건 없어요
    // 일시 오류 1번 → 재시도 1번 성공
    const s2 = 새저장소(); 기관들넣기(s2.store, 'a'); await 점검(s2, s2.설정값(), 가짜게시판({ a: [{ items: 많은글(3) }] }), 기준);
    const 진짜 = new MockClient(); let 시도 = 0;
    const 흔들 = { mock: true, 이름: 'Flaky', async extract(x) { 시도++; if (시도 === 1) throw Object.assign(new Error('끊김'), { kind: 'transient' }); return 진짜.extract(x); } };
    const r2 = await 검증실행({ store: s2.store, 설정값: s2.설정값(), client: 흔들, 모드: 'mock', 지금: 기준 });
    assert.equal(시도, 2); assert.equal(r2.AI호출.재시도, 1); assert.equal(s2.store.사용량읽기().filter((e) => e.이벤트 === '시작').length, 2); // 재시도도 호출 수에 포함
    // 계속 실패해도 재시도는 1번뿐
    const s3 = 새저장소(); 기관들넣기(s3.store, 'a'); await 점검(s3, s3.설정값(), 가짜게시판({ a: [{ items: 많은글(3) }] }), 기준);
    let 시도3 = 0; const 항상 = { mock: true, 이름: 'Down', async extract() { 시도3++; throw Object.assign(new Error('끊김'), { kind: 'transient' }); } };
    await 검증실행({ store: s3.store, 설정값: s3.설정값(), client: 항상, 모드: 'mock', 지금: 기준 });
    assert.equal(시도3, 2);
  });
  await 시험('검증 결과 반영: 근거 문장이 원문에 있을 때만 원문확인, 법인만=부적합·비노출, 확인 필요 항목', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    const items = [
      글('개인 강사 모집', 'ok', `${날짜(20)} 18시`, { 본문: `분야: A\n대상: 평생학습 강사\n자격: 개인 누구나\n마감: ${날짜(20)} 18시\n금액: 시간당 5만원` }),
      글('법인 전용 사업', 'corp', `${날짜(20)}`, { 본문: `대상: 법인\n자격: 법인사업자만 지원 가능\n마감: ${날짜(20)}` }),
      글('조건 확인 필요 사업', 'chk', `${날짜(20)}`, { 본문: `대상: 청소년기관 강사\n마감: ${날짜(20)}\n확인: 거주지 제한 여부; 제출서류 목록` }),
      글('마감일은 본문에서만 확정', 'dl', '11월 말', { 본문: `대상: 시민\n마감: 2026-11-30` }),
    ];
    await 점검(s, s.설정값(), 가짜게시판({ a: [{ items }] }), 기준);
    const 결과 = await 검증실행({ store: s.store, 설정값: s.설정값(), client: new MockClient(), 모드: 'mock', 지금: 기준 });
    const 찾기 = (t) => s.store.공고목록().find((n) => n.공고명 === t);
    const ok = 찾기('개인 강사 모집'); assert.equal(ok.검증상태, '검증됨'); assert.equal(ok.적합도.판정, '적합'); assert.equal(ok.필드상태.대상, '원문확인'); assert.equal(ok.금액, '시간당 5만원'); assert.equal(ok.분야, 'A');
    const corp = 찾기('법인 전용 사업'); assert.equal(corp.적합도.판정, '부적합'); assert.equal(corp['제외·보존'].추천노출.노출, false); assert.equal(corp['제외·보존'].추천노출.사유, '부적합'); assert.ok(corp.적합도.미충족.some((x) => /법인/.test(x)));
    const chk = 찾기('조건 확인 필요 사업'); assert.equal(chk.적합도.판정, '확인 필요'); assert.deepEqual(chk.적합도.확인필요.filter((x) => /거주지|제출서류/.test(x)).length, 2);
    const dl = 찾기('마감일은 본문에서만 확정'); assert.equal(dl.접수마감.마감판정, '확정'); assert.equal(dl.접수마감.날짜, '2026-11-30'); assert.equal(dl.필드상태.접수마감, '원문확인');
    assert.equal(결과.AI호출.횟수, 1); assert.equal(결과.AI호출.토큰, '해당 없음 (Mock)');
  });
  await 시험('S3b AI가 원문에 없는 마감일을 지어내면 AI추정으로 강등되고 검증됨이 될 수 없어요', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    await 점검(s, s.설정값(), 가짜게시판({ a: [{ items: [글('애매한 마감', 'h1', '11월 말', { 본문: '대상: 시민\n자격: 개인', _mock: { 마감환각: '2099-01-01' } })] }] }), 기준);
    await 검증실행({ store: s.store, 설정값: s.설정값(), client: new MockClient(), 모드: 'mock', 지금: 기준 });
    const n = s.store.공고목록()[0];
    assert.equal(n.필드상태.접수마감, 'AI추정'); assert.equal(n.접수마감.날짜, null); assert.notEqual(n.검증상태, '검증됨'); assert.equal(n.접수마감.마감판정, '불확실');
    assert.ok(n.적합도.확인필요.some((x) => /원문 근거와 맞지 않/.test(x)));
  });
  await 시험('S15 변경 없으면 AI 재검증 생략, 본문이 바뀌면 재검증, 내 조건이 바뀌면 호출 없이 표지만', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    const 본문v1 = `대상: 시민\n마감: ${날짜(20)}`;
    const f = 가짜게시판({ a: [{ items: [글('변경 시험', 'c1', `${날짜(20)}`, { 본문: 본문v1 })] }, { items: [글('변경 시험', 'c1', `${날짜(20)}`, { 본문: 본문v1 + '\n조회수 : 123' })] }, { items: [글('변경 시험', 'c1', `${날짜(20)}`, { 본문: 본문v1 + '\n자격: 새로 생긴 조건' })] }] });
    await 점검(s, s.설정값(), f, 날(0));
    const c = new MockClient(); await 검증실행({ store: s.store, 설정값: s.설정값(), client: c, 모드: 'mock', 지금: 날(0) }); assert.equal(c.호출수, 1);
    await 점검(s, s.설정값(), f, 날(1)); // 조회수만 달라진 같은 글
    assert.equal(s.store.공고목록()[0].변경이력.length, 0); // 조회수 줄은 정규화로 무시되므로 본문이 바뀐 것으로 치지 않아요
    const r2 = await 검증실행({ store: s.store, 설정값: s.설정값(), client: c, 모드: 'mock', 지금: 날(1) });
    assert.equal(c.호출수, 1); assert.equal(r2.AI호출.횟수, 0); assert.equal(s.store.공고목록()[0]['제외·보존'].AI검증.사유, '변경없음');
    s.settings.바꾸기({ 내조건: { 사업자: '없음' } });
    D.다시계산({ store: s.store, 설정: s.설정값(), 지금: 날(1) });
    const r3 = await 검증실행({ store: s.store, 설정값: s.설정값(), client: c, 모드: 'mock', 지금: 날(1) });
    assert.equal(c.호출수, 1); assert.equal(r3.AI호출.횟수, 0);
    assert.ok(s.store.공고목록()[0].적합도.확인필요.some((x) => /내 조건/.test(x))); // 전체를 다시 보내지 않고 표지만
    await 점검(s, s.설정값(), f, 날(2)); // 본문이 실제로 바뀜
    const 바뀐 = s.store.공고목록()[0]; assert.equal(바뀐['제외·보존'].AI검증.상태, '대상'); assert.equal(바뀐.공고상태, '수정');
    await 검증실행({ store: s.store, 설정값: s.설정값(), client: c, 모드: 'mock', 지금: 날(2) }); assert.equal(c.호출수, 2);
  });
  await 시험('같은 본문이어도 제목이 다른 공고는 따로 검증해요 (mock/real 캐시는 분리)', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    const 같은본문 = `대상: 시민\n마감: ${날짜(20)}`;
    await 점검(s, s.설정값(), 가짜게시판({ a: [{ items: [글('원조 공고', 'x1', `${날짜(20)}`, { 본문: 같은본문 }), 글('똑같은 내용 다른 공고', 'x2', `${날짜(20)}`, { 본문: 같은본문 })] }] }), 기준);
    const ids = s.store.공고목록().map((n) => n.id);
    const c = new MockClient();
    await 검증실행({ store: s.store, 설정값: s.설정값(), client: c, 모드: 'mock', 지금: 기준, ids: [ids[0]] });
    const r = await 검증실행({ store: s.store, 설정값: s.설정값(), client: c, 모드: 'mock', 지금: 기준, ids: [ids[1]] });
    assert.equal(c.호출수, 2); assert.equal(r.AI호출.재사용, 0);
    assert.equal(s.store.캐시읽기('real', s.store.공고목록()[0].검증키), null); // mock 결과를 real이 쓰지 못해요
  });
  await 시험('S16 길이 제한: 긴 본문은 잘라서 보내고 검증됨이 될 수 없고, 상한 넘는 응답은 반영·재시도하지 않아요', async () => {
    const s = 새저장소(); 기관들넣기(s.store, 'a');
    const 긴본문 = `대상: 시민\n마감: ${날짜(20)}\n` + '가나다라마바사 '.repeat(2000);
    await 점검(s, s.설정값(), 가짜게시판({ a: [{ items: [글('아주 긴 공고', 'l1', `${날짜(20)}`, { 본문: 긴본문 })] }] }), 기준);
    let 받은; const 관찰 = new MockClient(); const 래핑 = { mock: true, 이름: 'Spy', async extract(x) { 받은 = x; return 관찰.extract(x); } };
    await 검증실행({ store: s.store, 설정값: s.설정값(), client: 래핑, 모드: 'mock', 지금: 기준 });
    assert.ok(받은.공고들[0].본문.length <= 6000); assert.ok(받은.공통문맥.length <= 1500); assert.ok(긴본문.length > 6000);
    const n = s.store.공고목록()[0]; assert.equal(n.검증기록.본문잘림, true); assert.notEqual(n.검증상태, '검증됨'); assert.ok(n.적합도.확인필요.some((x) => /앞부분만/.test(x)));
    // 거대 응답
    const t = 새저장소(); 기관들넣기(t.store, 'a');
    await 점검(t, t.설정값(), 가짜게시판({ a: [{ items: [글('응답 폭주', 'r1', `${날짜(20)}`, { _mock: { 오류: '거대응답' } })] }] }), 기준);
    const c = new MockClient(); const r = await 검증실행({ store: t.store, 설정값: t.설정값(), client: c, 모드: 'mock', 지금: 기준 });
    const m = t.store.공고목록()[0]; assert.equal(c.호출수, 1); assert.equal(r.결과[0].결과, '응답오류'); assert.match(m.검증필요, /반영하지 않았어요/); assert.equal(m.AI적합도, null);
    await 검증실행({ store: t.store, 설정값: t.설정값(), client: c, 모드: 'mock', 지금: 기준 }); assert.equal(c.호출수, 1); // 자동 반복 없음
    await 검증실행({ store: t.store, 설정값: t.설정값(), client: c, 모드: 'mock', 지금: 기준, ids: [m.id], 강제: true }); assert.equal(c.호출수, 2); // 작가님이 다시 요청할 때만
  });
  await 시험('S8 Mock 안전: real 열쇠가 없으면 항상 Mock, 연결 안 된 Real은 호출 기록도 없이 끝남', async () => {
    assert.equal(클라이언트만들기({ 모드: 'real', 환경: {} }).mock, true);
    assert.equal(클라이언트만들기({ 모드: 'mock', 환경: { OFFICE_ALLOW_REAL: '1' } }).mock, true);
    assert.equal(클라이언트만들기({ 모드: 'real', 환경: { OFFICE_ALLOW_REAL: '1' } }) instanceof RealClient, true);
    const s = 새저장소(); 기관들넣기(s.store, 'a'); await 점검(s, s.설정값(), 가짜게시판({ a: [{ items: 많은글(2) }] }), 기준);
    const r = await 검증실행({ store: s.store, 설정값: s.설정값(), client: new RealClient(), 모드: 'real', 지금: 기준 });
    assert.match(r.중단이유, /연결이 아직 없어요/); assert.equal(s.store.사용량읽기().length, 0);
    assert.equal(s.store.공고목록().every((n) => n['제외·보존'].AI검증.상태 === '대상'), true); // 아무것도 잃지 않아요
  });
  await 시험('S8 외부 호출 0: 이 시험 전체에서 외부 프로세스·네트워크 시도 0건', () => {
    assert.deepEqual(trip.걸린기록, []);
  });

  for (const d of 임시폴더들) fs.rmSync(d, { recursive: true, force: true });
  console.log(결과들.join('\n'));
  console.log(`\n${결과들.length - 실패수}/${결과들.length} 통과${실패수 ? `, ${실패수}개 실패` : ''}`);
  process.exit(실패수 ? 1 : 0);
})();
