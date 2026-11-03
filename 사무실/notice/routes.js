// 공고 센터 API (/api/notice/*). 서버가 요청 검사(Host·Origin·헤더)를 마친 뒤 handle()에 { method, pathname, query, body }를 넘겨요.
// 이 파일에도 '지원서 제출·메일 발송·기관 연락' 길은 없고, 공고를 지우는 길도 없어요.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createStore, 기관검사, 새ID, ID모양, 실패 } = require('./store');
const { createSettings } = require('./settings');
const { 다시계산 } = require('./differ');
const { 수집, 직접등록 } = require('./collector');
const { 검증실행, 검증계획 } = require('./extractor');
const { 클라이언트만들기 } = require('./clients');
const { createMockFetcher, 시험용기관 } = require('./mockboards');
const { 개요만들기, 요약, 지원상태목록 } = require('./metrics');

function 방식정하기(루트, 환경) {
  const 경고 = [];
  let 모드 = 'mock';
  const 지정폴더 = 환경.OFFICE_DATA_DIR ? path.resolve(환경.OFFICE_DATA_DIR) : null;
  const 운영폴더 = path.join(루트, '공고');
  if (환경.OFFICE_MODE === 'real') {
    if (환경.OFFICE_ALLOW_REAL !== '1') 경고.push('OFFICE_MODE=real 이지만 OFFICE_ALLOW_REAL=1 이 없어서 Mock으로 시작해요.');
    else {
      let 저장모드 = null;
      try { 저장모드 = JSON.parse(fs.readFileSync(path.join(지정폴더 || 운영폴더, 'settings.json'), 'utf8')).모드; } catch { /* 파일이 없으면 Mock */ }
      if (저장모드 === 'real') 모드 = 'real';
      else 경고.push('공고\\settings.json 의 모드가 "real"이 아니라서 Mock으로 시작해요. (실제 모드는 열쇠 3개가 모두 필요해요)');
    }
  }
  const dir = 지정폴더 || (모드 === 'real' ? 운영폴더 : path.join(운영폴더, 'mock'));
  return { 모드, dir, 구분: 지정폴더 ? '시험(지정 폴더)' : 모드 === 'real' ? '운영' : 'Mock 데이터', 경고 };
}

const 오류응답 = (e) => ({ status: e.status || 500, body: { 오류: e.status ? e.message : '요청을 처리하지 못했어요.' } });
const 문자 = (v, 최대) => String(v ?? '').trim().slice(0, 최대);

function createSingleApi({ 루트, 환경 = {}, 인스턴스, 프로필 = require('./profiles').프로필(), 공통사용량, 상위모드 }) {
  const 방식 = 방식정하기(루트, 환경);
  if (상위모드 === 'real') { 방식.모드 = 'real'; 방식.dir = path.resolve(환경.OFFICE_DATA_DIR); 방식.경고 = []; }
  const store = createStore(방식.dir);
  if (공통사용량) { store.사용량읽기 = 공통사용량.사용량읽기; store.사용량추가 = 공통사용량.사용량추가; }
  const settings = createSettings(store, 프로필.id);
  const mock수집기 = createMockFetcher();
  let 실행중 = null; let 중지요청 = false; let 진행 = null;

  const 설정값 = () => ({ ...settings.읽기().값, 모드: 방식.모드 });
  const 클라이언트 = () => 클라이언트만들기({ 모드: 방식.모드, 환경, 루트, 데이터폴더: store.root, 프로필 });
  const 새로고침 = (지금 = new Date()) => 다시계산({ store, 설정: 설정값(), 지금 });
  const 바쁨확인 = () => { if (실행중) throw 실패(409, `지금 ${실행중} 실행 중이에요. 끝난 뒤에 다시 눌러 주세요.`); };

  function 공고찾기(id) { const n = store.공고읽기(id); if (!n) throw 실패(404, '공고를 찾을 수 없어요.'); return n; }
  function 재계산저장(n) {
    const 기관 = store.기관목록().find((k) => k.id === n.기관ID);
    require('./differ').규칙적용(n, { 기관, 설정: 설정값(), 지금: new Date() });
    store.공고저장(n);
    return n;
  }
  function 상세(n) {
    const 지금 = new Date();
    return { ...n, 요약: 요약(n, 지금), 원문: { ...n.원문, 본문: String(n.원문?.본문 || '').slice(0, 3000), 본문길이: (n.원문?.본문 || '').length } };
  }

  function 방상태() {
    const 지금 = new Date(); const 설정 = 설정값();
    const 목록 = store.공고목록(); const 기관들 = store.기관목록(); const 실행들 = store.실행목록();
    const 요약들 = 목록.map((n) => 요약(n, 지금));
    const 최근 = 실행들[실행들.length - 1];
    const 방금 = (종류) => 최근 && 최근.종류 === 종류 && 최근.종료 && 지금 - new Date(최근.종료) < 6000;
    const 실패기관 = 기관들.filter((k) => k.사용 && k.마지막점검 && ['접속 실패', '자료 추출 실패', '검증 필요'].includes(k.마지막점검.결과)).length;
    const 확인필요 = 요약들.filter((x) => x.노출 && x.판정 === '확인 필요').length;
    const 결정대기 = 요약들.filter((x) => x.노출 && x.판정 === '적합' && x.검증상태 === '검증됨' && !x.지원상태 && x.공고상태 !== '접수 마감').length;
    const 직원 = {
      leader: { 상태: '쉼', 메시지: '작가님이 정하는 자리예요' },
      searcher: 실행중 === '수집' || 방금('수집') || 방금('재확인') ? { 상태: '일함', 메시지: 진행 ? `${진행.기관} · ${진행.페이지}페이지 · ${진행.공고수}건` : '게시판을 점검하고 있어요' } : 실패기관 ? { 상태: '대표님대기', 메시지: `다시 확인할 기관이 ${실패기관}곳 있어요` } : { 상태: '쉼', 메시지: '점검할 일이 없어요' },
      verifier: 실행중 === '검증' || 방금('검증') ? { 상태: '일함', 메시지: '공고를 검증하고 있어요' } : 확인필요 ? { 상태: '대표님대기', 메시지: `확인이 필요한 공고가 ${확인필요}건 있어요` } : { 상태: '쉼', 메시지: '검증할 일이 없어요' },
      operator: 결정대기 ? { 상태: '결재대기', 메시지: `지원 여부를 정할 공고가 ${결정대기}건 있어요` } : { 상태: '쉼', 메시지: '정리할 일이 없어요' },
      spare1: { 상태: '쉼', 메시지: '이번 MVP에서는 쉬는 자리예요' }, spare2: { 상태: '쉼', 메시지: '이번 MVP에서는 쉬는 자리예요' },
    };
    const 이름 = { 수집: 'searcher', 재확인: 'searcher', 검증: 'verifier', 등록: 'operator' };
    const 기록 = 실행들.slice(-12).map((r) => {
      const 지 = r.지표 || {};
      const 내용 = r.단계 === 'B' ? `[검증] 대상 ${지.대상 ?? 0}건, AI 호출 ${r.AI호출?.횟수 ?? 0}회, 재사용 ${지.재사용 ?? 0}건${r.중단이유 ? ` — ${r.중단이유}` : ''}`
        : r.종류 === '등록' ? `[등록] ${지.종류 || ''}` : `[${r.종류}] 기관 ${지.대상기관 ?? 0}곳: 완료 ${지.완료 ?? 0}, 접속 실패 ${지.접속실패 ?? 0}, 추출 실패 ${지.추출실패 ?? 0}, 신규 ${지.신규 ?? 0}`;
      return { 시각: r.시작, 직원: 이름[r.종류] || 'operator', 내용: `${방식.모드 === 'mock' ? '(Mock) ' : ''}${내용}` };
    });
    const 데이터 = {
      편: 1, 주제: 프로필.이름, 단계: `${방식.모드 === 'mock' ? 'Mock 모드' : '실제 모드'} · 공고 ${목록.length}건`,
      직원, 마지막메시지: 기록.length ? 기록[기록.length - 1].내용 : '아직 점검한 적이 없어요. 공고 정보센터에서 게시판 점검을 눌러 주세요.',
      기록, 갱신시각: 지금.toISOString(),
    };
    return { 에피소드: [{ 파일: 'notice.json', 수정시각: Date.now(), 데이터 }], 경고: [...store.경고, ...방식.경고, ...settings.읽기().경고] };
  }

  function 목록조회(q) {
    const 지금 = new Date(); const 설정 = 설정값();
    const { 목록 } = 새로고침(지금);
    let 행 = 목록.map((n) => 요약(n, 지금));
    const 보기 = q.get('보기') || '추천';
    if (보기 === '추천') 행 = 행.filter((x) => x.노출); else if (보기 === '보관') 행 = 행.filter((x) => !x.노출);
    for (const [키, 칸] of [['분야', 'x.분야'], ['판정', 'x.판정'], ['검증상태', 'x.검증상태'], ['지원상태', 'x.지원상태'], ['공고상태', 'x.공고상태']]) {
      const v = q.get(키); if (v) 행 = 행.filter((x) => String(칸.split('.').reduce((o, k) => o[k], { x })) === (v === '미지정' ? '' : v));
    }
    if (q.get('우선순위')) 행 = 행.filter((x) => String(x.우선순위 ?? '') === q.get('우선순위'));
    if (q.get('임박') === '1') 행 = 행.filter((x) => x.마감판정 === '확정' && x.공고상태 !== '접수 마감' && x.남은일수 !== null && x.남은일수 <= 설정.마감임박일);
    const 정렬 = q.get('정렬') || '마감';
    행.sort(정렬 === '발견' ? (a, b) => String(b.최초발견).localeCompare(String(a.최초발견)) : (a, b) => (a.마감날짜 || '9999') .localeCompare(b.마감날짜 || '9999'));
    if (프로필.id === 'housing') {
      if (q.get('주택그룹')) 행 = 행.filter(x => x.주택?.그룹 === q.get('주택그룹'));
      행.sort((a,b) => (a.주택?.순서 ?? 2) - (b.주택?.순서 ?? 2));
    }
    return { 목록: 행.slice(0, 500), 합계: 행.length, 보기 };
  }

  async function handle({ method, pathname, query, body }) {
    try {
      const 경로 = pathname.replace(/^\/api\/notice\//, '').replace(/\/+$/, '');
      const 조각 = 경로.split('/');
      const 지금 = new Date();

      if (method === 'GET') {
        if (경로 === 'whoami') return { status: 200, body: { 인스턴스ID: 인스턴스.id, pid: 인스턴스.pid, 시작시각: 인스턴스.시작시각, 포트: 인스턴스.포트(), 코드버전: 인스턴스.코드버전, 모드: 방식.모드, 데이터구분: 방식.구분, 데이터폴더: store.root, 경고: 방식.경고, 열쇠: { 환경모드: 환경.OFFICE_MODE || '(없음)', 실제허용: 환경.OFFICE_ALLOW_REAL === '1', 설정모드: 설정값().모드 }, 실행중 } };
        if (경로 === 'overview') {
          const { 목록 } = 새로고침(지금);
          const 계획 = 검증계획({ store, 설정값: 설정값(), 모드: 방식.모드, 지금 });
          const 개요 = 개요만들기({ 목록, 기관들: store.기관목록(), 실행들: store.실행목록(), 누락: store.누락목록(), 사용량: store.사용량읽기(), 설정값: 설정값(), 모드: 방식.모드, 지금, 계획 });
          if (프로필.id === 'housing') 개요.지원가능 = [];
          return { status: 200, body: { ...개요, 프로필, 진행, 실행중, 모드: 방식.모드, 데이터구분: 방식.구분, 계획, 기관수: store.기관목록().length } };
        }
        if (경로 === 'list') return { status: 200, body: 목록조회(query) };
        if (경로 === 'report') return { status: 200, body: require('./report').보고서({ store, 프로필, 지금 }) };
        if (경로 === 'instructions') return { status: 200, body: { 프로필, 원문: require('./profiles').원문(루트, 프로필.id) } };
        if (조각[0] === 'notices' && 조각[1] && 조각.length === 2) { 새로고침(지금); return { status: 200, body: 상세(공고찾기(조각[1])) }; }
        if (경로 === 'institutions') return { status: 200, body: { 기관: store.기관목록() } };
        if (경로 === 'verify/plan') { 새로고침(지금); return { status: 200, body: 검증계획({ store, 설정값: 설정값(), 모드: 방식.모드, ids: query.get('ids') ? query.get('ids').split(',') : undefined, 지금 }) }; }
        if (경로 === 'runs') return { status: 200, body: { 실행: store.실행목록().slice(-30).reverse() } };
        if (조각[0] === 'runs' && 조각[1]) { const r = store.실행읽기(조각[1]); if (!r) throw 실패(404, '실행 기록을 찾을 수 없어요.'); return { status: 200, body: r }; }
        if (경로 === 'misses') return { status: 200, body: { 누락: store.누락목록().slice().reverse() } };
        if (경로 === 'settings') { const s = settings.읽기(); return { status: 200, body: { 설정: s.값, 경고: s.경고, 이력: settings.이력읽기().slice(-20).reverse() } }; }
        if (경로 === 'export') {
          const 목록 = 새로고침(지금).목록.map((n) => 요약(n, 지금));
          if (query.get('형식') === 'csv') {
            const 칸 = ['id', '기관명', '공고명', '지역', '분야', '마감날짜', '마감표기', '판정', '검증상태', '공고상태', '지원상태', '노출', '시험용'];
            const 셀 = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            return { status: 200, 종류: 'text/csv; charset=utf-8', 원문: '﻿' + [칸.join(','), ...목록.map((x) => 칸.map((k) => 셀(x[k])).join(','))].join('\n') };
          }
          return { status: 200, body: { 공고: 목록 } };
        }
        throw 실패(404, '없는 주소예요.');
      }

      if (method !== 'POST') throw 실패(405, '지원하지 않는 요청이에요.');
      body = body || {};

      if (경로 === 'sources/seed') {
        바쁨확인();
        if (방식.모드 !== 'real') throw 실패(403, '공식 사이트 연결은 실제 모드에서 사용해 주세요. 시험 자료와 섞지 않아요.');
        const 목록 = store.기관목록(); let 추가 = 0;
        for (const source of require('./sources').기본기관(프로필.id)) if (!목록.some(k => k.id === source.id)) { 목록.push(기관검사(source)); 추가++; }
        store.기관저장(목록);
        return { status: 200, body: { 추가, 안내: '공식 사이트 목록을 연결했어요. 게시판 점검을 누르면 실제 확인을 시작해요.' } };
      }

      if (경로 === 'collect' || 경로 === 'recheck') {
        바쁨확인();
        if (방식.모드 === 'real' && !프로필.준비) throw 실패(409, 프로필.안내);
        실행중 = '수집'; 중지요청 = false;
        try {
          const fetcher = 방식.모드 === 'mock' ? mock수집기 : require('./webfetcher').createWebFetcher({ 중지: () => 중지요청, 진행: p => { 진행 = p; }, 첨부읽기: require('./attachments').첨부읽기 });
          const run = await 수집({ store, 설정: 설정값(), fetcher, 모드: 방식.모드, 지금, 기관ID목록: Array.isArray(body.기관ID목록) ? body.기관ID목록.filter((x) => ID모양.test(String(x))) : undefined, 재확인: 경로 === 'recheck', 중지: () => 중지요청 });
          return { status: 200, body: run };
        } finally { 실행중 = null; 진행 = null; }
      }
      if (경로 === 'verify') {
        바쁨확인();
        const ids = Array.isArray(body.ids) ? body.ids.filter((x) => ID모양.test(String(x))) : undefined;
        새로고침(지금);
        const 계획 = 검증계획({ store, 설정값: 설정값(), 모드: 방식.모드, ids, 지금 });
        if (방식.모드 === 'real' && body.확인호출수 !== 계획.예상호출수) throw 실패(409, `실제 모드에서는 예상 호출 수(${계획.예상호출수}회)를 확인해야 시작해요.`);
        실행중 = '검증'; 중지요청 = false;
        try {
          const run = await 검증실행({ store, 설정값: 설정값(), client: 클라이언트(), 모드: 방식.모드, 지금, ids, 강제: body.강제 === true, 중지: () => 중지요청 });
          return { status: 200, body: run };
        } finally { 실행중 = null; }
      }
      if (경로 === 'run/stop') { 중지요청 = true; return { status: 200, body: { 중지요청: true, 실행중 } }; }

      if (경로 === 'notices') { // 직접 등록
        바쁨확인();
        const 제목 = 문자(body.공고명, 200), 링크 = 문자(body.공식링크, 500);
        if (!제목) throw 실패(400, '공고명을 적어 주세요.');
        if (!/^https?:\/\/[^\s]+$/i.test(링크)) throw 실패(400, '공식 공고 링크(http:// 또는 https://)가 꼭 필요해요. 공식 출처가 없는 공고는 등록하지 않아요.');
        let 기관 = body.기관ID ? store.기관목록().find((k) => k.id === body.기관ID) : null;
        if (!기관) {
          const 이름 = 문자(body.기관명, 80), 지역 = 문자(body.지역, 40);
          if (!이름 || !지역) throw 실패(400, '등록된 기관을 고르거나, 기관명과 지역을 적어 주세요.');
          기관 = { id: 'manual', 이름, 검색종류: 프로필.id, 유형: '기타 공식 모집기관', 지역, 우선순위: require('./store').우선순위(지역), 게시판: [], 사용: false };
        }
        const r = 직접등록({ store, 설정: 설정값(), 항목: { 제목, 링크, 게시일: 문자(body.게시일, 10) || null, 마감원문: 문자(body.마감원문, 100), 본문: 문자(body.본문, 12000), 분야: body.분야, 지역: 문자(body.지역, 40) || undefined }, 기관, 지금, 모드: 방식.모드 });
        return { status: 200, body: { 종류: r.종류, 공고: r.공고 ? 요약(r.공고, 지금) : null, 이유: r.이유 } };
      }
      if (조각[0] === 'notices' && 조각[1] && 조각.length === 3) {
        const n = 공고찾기(조각[1]);
        if (조각[2] === 'status') { // 지원 상태·메모: 작가님이 직접 바꿔요 (자동으로 '지원 완료'가 되는 길은 없어요)
          if (body.지원상태 !== undefined) {
            if (body.지원상태 !== '' && !지원상태목록.includes(body.지원상태)) throw 실패(400, `지원 상태는 ${지원상태목록.join(' / ')} 중 하나예요.`);
            if (body.지원상태 !== n.지원상태) { n.지원이력.push({ 시각: 지금.toISOString(), 이전: n.지원상태, 이후: body.지원상태 }); n.지원상태 = body.지원상태; }
          }
          if (body.메모 !== undefined) { if (typeof body.메모 !== 'string' || body.메모.length > 2000) throw 실패(400, '메모는 2,000자 이내로 적어 주세요.'); n.메모 = body.메모; }
          store.공고저장(n);
          return { status: 200, body: 상세(n) };
        }
        if (조각[2] === 'judgment') {
          if (프로필.id === 'housing') throw 실패(400, '주택 공고는 개인 자격 판단과 추천을 하지 않아요.');
          if (!['적합', '확인 필요', '부적합'].includes(body.판정)) throw 실패(400, '판정은 적합 / 확인 필요 / 부적합 중 하나예요.');
          if (typeof body.이유 !== 'string' || !body.이유.trim() || body.이유.length > 500) throw 실패(400, '판정을 바꾸는 이유를 적어 주세요.');
          n.수동판정 = { 판정: body.판정, 이유: body.이유.trim(), 시각: 지금.toISOString(), 누가: '작가님' };
          n.변경이력.push({ 시각: 지금.toISOString(), 항목: '판정(작가님)', 이전: n.적합도.판정, 이후: body.판정 });
          return { status: 200, body: 상세(재계산저장(n)) };
        }
        if (조각[2] === 'judgment-clear') { n.수동판정 = null; return { status: 200, body: 상세(재계산저장(n)) }; }
        if (조각[2] === 'hold') { // AI 검증 보류/해제
          n['제외·보존'].AI검증 = body.보류 ? { 상태: '생략', 사유: '작가님보류' } : { 상태: '대상', 사유: '' };
          return { status: 200, body: 상세(재계산저장(n)) };
        }
        throw 실패(404, '없는 주소예요.');
      }
      if (경로 === 'institutions') {
        바쁨확인();
        const 목록 = store.기관목록(); const 동작 = body.동작;
        if (동작 === '추가') {
          const 새 = 기관검사({ ...body.기관, 검색종류: 프로필.id });
          if (목록.some((k) => k.id === 새.id)) throw 실패(409, '같은 id의 기관이 이미 있어요.');
          if (목록.some((k) => k.게시판.some((b) => 새.게시판.some((c) => c.주소 === b.주소)))) throw 실패(409, '이미 등록된 게시판 주소가 있어요.');
          목록.push(새); store.기관저장(목록);
          return { status: 200, body: { 기관: 새 } };
        }
        const 기관 = 목록.find((k) => k.id === body.id);
        if (!기관) throw 실패(404, '기관을 찾을 수 없어요.');
        if (동작 === '중지' || 동작 === '재개') { 기관.사용 = 동작 === '재개'; store.기관저장(목록); return { status: 200, body: { 기관 } }; } // 중지해도 이 기관의 공고 기록은 그대로 남아요
        if (동작 === '수정') {
          const 합침 = 기관검사({ ...기관, ...body.기관, id: 기관.id, 검색종류: 프로필.id });
          Object.assign(기관, 합침); store.기관저장(목록);
          return { status: 200, body: { 기관 } };
        }
        throw 실패(400, '동작은 추가 / 수정 / 중지 / 재개 중 하나예요.');
      }
      if (경로 === 'settings') {
        바쁨확인();
        const r = settings.바꾸기(body);
        return { status: 200, body: { 설정: r.값, 변경: r.이력.length } };
      }
      if (경로 === 'mock/seed') {
        if (방식.모드 !== 'mock') throw 실패(403, '시험 자료는 Mock 모드에서만 채울 수 있어요. 실제 모드에는 가짜 자료를 넣지 않아요.');
        바쁨확인();
        const 목록 = store.기관목록(); let 추가 = 0;
        for (const k of 시험용기관()) if (!목록.some((x) => x.id === k.id)) { 목록.push(기관검사({ ...k, 시험용: true })); 추가++; }
        store.기관저장(목록);
        return { status: 200, body: { 추가한기관: 추가, 안내: '시험용 가짜 기관만 채웠어요. 게시판 점검을 눌러 보세요.' } };
      }
      throw 실패(404, '없는 주소예요.');
    } catch (e) { return 오류응답(e); }
  }

  return { handle, 방상태, 방식, store, settings, 종료() {} };
}

function createNoticeApi(options) { return require('./scoped').createScopedApi(options, createSingleApi); }
module.exports = { createNoticeApi, 방식정하기, createSingleApi };
