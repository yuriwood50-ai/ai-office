// B단계(검증): AI 검증 '대상'으로 표지된 공고만 모아서 배치로 모델에 보내고, 결과를 코드로 검사한 뒤 반영해요.
//  - 모델 클라이언트는 밖에서 받아요(Mock이면 가짜 응답). 도구·파일·웹을 모델에 열어 주지 않고, 필요한 본문만 잘라서 넣어요.
//  - 상한: 실행당·하루 호출 수(재시도 포함), 본문/입력/출력 글자 수. 한도 오류는 자동 재시도하지 않고 멈춰요.
'use strict';
const { 규칙적용, 검증키만들기 } = require('./differ');
const { 새ID } = require('./store');
const { createBudget, 한도오류 } = require('./budget');
const { 응답검사, 적용하기 } = require('./verifier');

const 공통문맥 = '역할: 공고 원문에서 항목을 뽑아요. 원문에 없는 값은 쓰지 마세요. 값마다 원문에서 그대로 베낀 근거 문장(120자 이내)을 붙여요. 항목: 대상, 장소, 시간대, 금액, 자격, 제출서류, 접수방법, 분야(A/B/C), 접수마감(근거 문장 포함), 적합도(판정/미충족/확인필요/근거, 각 최대 5개). 서술형 설명 금지.';

// 대상 공고를 배치로 나눠요. 한 배치 = 최대 배치 수 건, 입력 글자 합이 호출입력자 이하.
function 배치만들기(공고들, 한도) {
  const 항목당상한 = Math.max(200, Math.min(한도.본문자, 한도.호출입력자 - 공통문맥.length - 200));
  const 항목들 = 공고들.map((n) => {
    const 본문 = [n.원문?.본문 || '', ...(n.첨부 || []).filter(a => a.상태 === '확인').map(a => a.본문 || '')].join('\n');
    const 잘림 = 본문.length > 항목당상한;
    return { n, 잘림, 페이로드: { id: n.id, 공고명: n.공고명, 기관명: n.기관명, 본문: 본문.slice(0, 항목당상한), ...(n.원문?.mock ? { mock: n.원문.mock } : {}) } };
  });
  const 배치들 = []; let 현재 = [], 글자 = 공통문맥.length;
  for (const it of 항목들) {
    const 크기 = it.페이로드.본문.length + it.페이로드.공고명.length + it.페이로드.기관명.length + 40;
    if (현재.length && (현재.length >= 한도.배치 || 글자 + 크기 > 한도.호출입력자)) { 배치들.push(현재); 현재 = []; 글자 = 공통문맥.length; }
    현재.push(it); 글자 += 크기;
  }
  if (현재.length) 배치들.push(현재);
  return { 배치들, 입력글자: 배치들.reduce((a, b) => a + 공통문맥.length + b.reduce((x, it) => x + it.페이로드.본문.length + it.페이로드.공고명.length, 0), 0) };
}

const 대상인가 = (n) => n['제외·보존'].AI검증.상태 === '대상';

// 실행 전 계획 (추정): 화면의 '예상 호출 수' 확인에 써요. 아무것도 호출하지 않아요.
function 검증계획({ store, 설정값, 모드, ids, 지금 = new Date() }) {
  const 한도 = 설정값.AI한도;
  const 대상들 = store.공고목록().filter((n) => (!ids || ids.includes(n.id)) && 대상인가(n) && !store.캐시읽기(모드, n.검증키 || '_'));
  const { 배치들, 입력글자 } = 배치만들기(대상들, 한도);
  const 예산 = createBudget({ store, 한도, 모드, 지금: () => 지금 });
  const 가능 = Math.min(배치들.length, 예산.남은수());
  return {
    대상수: 대상들.length, 예상호출수: 배치들.length, 가능호출수: 가능, 처리가능건수: 배치들.slice(0, 가능).reduce((a, b) => a + b.length, 0),
    미처리예상: 배치들.slice(가능).reduce((a, b) => a + b.length, 0), 추정입력글자: 입력글자, 종류: '추정',
    남은실행한도: 예산.남은실행수(), 남은하루한도: 예산.남은하루수(), 모드,
  };
}

async function 검증실행({ store, 설정값, client, 모드, 지금 = new Date(), ids, 강제 = false, 중지 = () => false }) {
  const 한도 = 설정값.AI한도;
  const 예산 = createBudget({ store, 한도, 모드, 지금: () => 지금 });
  const 실행 = { id: 새ID('r'), 종류: '검증', 단계: 'B', 모드, 시작: 지금.toISOString(), 종료: null, 결과: [], 지표: {}, AI호출: { 횟수: 0, 재시도: 0, 재사용: 0, 토큰: client.mock ? '해당 없음 (Mock)' : '기록 없음' }, 중단이유: null };
  if (client.준비됨 === false) { // 연결되지 않은 클라이언트는 호출 기록도 남기지 않고 바로 끝내요
    실행.종료 = new Date().toISOString(); 실행.중단이유 = '실제 AI 연결이 아직 없어요 (이번 MVP 범위 밖)'; store.실행저장(실행); return 실행;
  }
  const 기관들 = new Map(store.기관목록().map((k) => [k.id, k]));
  const 전체 = store.공고목록();
  const 고르기 = (n) => !ids || ids.includes(n.id);
  if (강제 && ids) for (const n of 전체.filter(고르기)) { n['제외·보존'].AI검증 = { 상태: '대상', 사유: '', 미처리: false }; n.검증필요 = null; }
  let 대상들 = 전체.filter((n) => 고르기(n) && 대상인가(n));
  대상들.sort((a, b) => (b['제외·보존'].AI검증.미처리 ? 1 : 0) - (a['제외·보존'].AI검증.미처리 ? 1 : 0)); // 지난번 못 한 것부터
  const 기록 = (n, 결과, 비고 = '') => 실행.결과.push({ 공고ID: n.id, 공고명: n.공고명, 결과, 비고 });
  const 저장 = (n) => { 규칙적용(n, { 기관: 기관들.get(n.기관ID), 설정: 설정값, 지금 }); store.공고저장(n); };

  // 1) 저장된 AI 결과가 있으면 다시 부르지 않아요
  const 보낼것 = [];
  for (const n of 대상들) {
    const 키 = n.검증키 || 검증키만들기(n.원문?.본문, 설정값.버전.프롬프트);
    const 캐시 = 강제 ? null : store.캐시읽기(모드, 키);
    if (캐시?.결과) { 적용하기(n, 캐시.결과, { 출처: '재사용', 키, 모드, 설정: 설정값, 잘림: false, 지금 }); 저장(n); 실행.AI호출.재사용++; 기록(n, '재사용', '저장된 결과를 다시 썼어요'); }
    else 보낼것.push(n);
  }

  // 2) 배치로 보내기
  const { 배치들 } = 배치만들기(보낼것, 한도);
  const 미처리로 = (it, 이유) => { it.n['제외·보존'].AI검증 = { 상태: '대상', 사유: '', 미처리: true, 미처리사유: 이유 }; 저장(it.n); 기록(it.n, '미처리', 이유); };
  let 연속실패 = 0, 멈춤 = false;
  for (let i = 0; i < 배치들.length; i++) {
    const 배치 = 배치들[i];
    if (멈춤) { 배치.forEach((it) => 미처리로(it, 실행.중단이유 || '중단')); continue; }
    if (중지()) { 멈춤 = true; 실행.중단이유 = '작가님이 중지했어요'; 배치.forEach((it) => 미처리로(it, 실행.중단이유)); continue; }
    if (예산.남은수() <= 0) {
      멈춤 = true; 실행.중단이유 = 예산.남은실행수() <= 0 ? `실행당 호출 상한(${한도.실행당}회)에 도달했어요` : `하루 호출 상한(${한도.하루}회)에 도달했어요`;
      배치.forEach((it) => 미처리로(it, '한도')); continue;
    }
    let 시도 = 0, 응답 = null, 오류 = null;
    for (;;) {
      const t0 = Date.now();
      try {
        예산.시작({ 실행ID: 실행.id, 단계: 'B', 공고수: 배치.length, 재시도: 시도 > 0, 클라이언트: client.이름 });
      } catch (e) { // 기록을 못 하거나 상한이면 호출하지 않아요
        오류 = e; break;
      }
      실행.AI호출.횟수++; if (시도 > 0) 실행.AI호출.재시도++;
      try {
        응답 = await client.extract({ 공고들: 배치.map((it) => it.페이로드), 공통문맥, 내조건: 설정값.내조건, 판정규칙: 설정값.판정규칙, 검색종류: 설정값.검색종류 });
        예산.끝({ 실행ID: 실행.id, 결과: '성공', 소요ms: Date.now() - t0, 토큰: null, 토큰기록: client.mock ? '해당 없음(Mock)' : '없음' });
        오류 = null; break;
      } catch (e) {
        예산.끝({ 실행ID: 실행.id, 결과: '실패', 종류: e.kind || '오류', 소요ms: Date.now() - t0 });
        오류 = e;
        // 일시 오류만, 설정된 횟수까지만 다시 해요. 한도·인증·형식 오류는 다시 하지 않아요.
        if (e.kind === 'transient' && 시도 < 한도.재시도 && 예산.남은수() > 0) { 시도++; continue; }
        break;
      }
    }
    if (오류) {
      if (오류.kind === 'budget') { 멈춤 = true; 실행.중단이유 = 오류.message; 배치.forEach((it) => 미처리로(it, '한도')); continue; }
      if (오류.kind === 'limit' || 오류.kind === 'auth') { 멈춤 = true; 실행.중단이유 = `한도·인증 오류라서 자동으로 다시 하지 않고 멈췄어요 (${오류.message})`; 배치.forEach((it) => 미처리로(it, '한도 오류')); continue; }
      if (오류.kind === 'notimplemented') { 멈춤 = true; 실행.중단이유 = 오류.message; 배치.forEach((it) => 미처리로(it, '실제 AI 미연결')); continue; }
      연속실패++;
      for (const it of 배치) { it.n['제외·보존'].AI검증 = { 상태: '생략', 사유: '응답오류', 키: it.n.검증키 }; it.n.검증필요 = `AI 호출이 실패했어요 (${오류.kind || '오류'}) — 다시 검증을 눌러야 다시 보내요`; 저장(it.n); 기록(it.n, '응답오류', 오류.message); }
      if (연속실패 >= 한도.연속실패) { 멈춤 = true; 실행.중단이유 = `연속 ${연속실패}번 실패해서 멈췄어요`; }
      continue;
    }
    // 응답 검사
    let 검사;
    try { 검사 = 응답검사(응답, 배치.map((it) => it.페이로드), 한도); }
    catch (e) {
      연속실패++;
      for (const it of 배치) { it.n['제외·보존'].AI검증 = { 상태: '생략', 사유: '응답오류', 키: it.n.검증키 }; it.n.검증필요 = `AI 응답을 반영하지 않았어요: ${e.message} (같은 요청을 자동으로 반복하지 않아요)`; 저장(it.n); 기록(it.n, '응답오류', e.message); }
      if (연속실패 >= 한도.연속실패) { 멈춤 = true; 실행.중단이유 = `연속 ${연속실패}번 실패해서 멈췄어요`; }
      continue;
    }
    연속실패 = 0;
    for (const it of 배치) {
      const r = 검사.get(it.n.id);
      if (r.오류) { it.n['제외·보존'].AI검증 = { 상태: '생략', 사유: '응답오류', 키: it.n.검증키 }; it.n.검증필요 = `AI 응답을 반영하지 않았어요: ${r.오류}`; 저장(it.n); 기록(it.n, '응답오류', r.오류); continue; }
      const 키 = it.n.검증키 || 검증키만들기(it.n.원문?.본문, 설정값.버전.프롬프트);
      적용하기(it.n, r.결과, { 출처: 'AI', 키, 모드, 설정: 설정값, 잘림: it.잘림, 지금 });
      store.캐시쓰기(모드, 키, { 시각: 지금.toISOString(), 결과: r.결과 });
      저장(it.n);
      기록(it.n, it.n.검증상태, it.잘림 ? '본문이 길어서 앞부분만 보냈어요' : '');
    }
  }

  실행.종료 = new Date().toISOString();
  실행.지표 = {
    대상: 대상들.length, 호출: 실행.AI호출.횟수, 재사용: 실행.AI호출.재사용,
    검증됨: 실행.결과.filter((x) => x.결과 === '검증됨').length, 미처리: 실행.결과.filter((x) => x.결과 === '미처리').length, 응답오류: 실행.결과.filter((x) => x.결과 === '응답오류').length,
  };
  store.실행저장(실행);
  return 실행;
}

module.exports = { 검증실행, 검증계획, 배치만들기, 공통문맥, 한도오류 };
