// 공고 비교·분류 (모두 일반 코드, AI 없음).
//  - 새로 들어온 글이 신규/기존/수정/마감 연장/재공고/후보 중복 중 무엇인지 가려내요.
//  - 인천·마감 확정·변경 없음은 '표지'만 붙여요. 공고 기록을 지우거나 옮기지 않아요. (요구사항 13절)
'use strict';
const { createHash } = require('node:crypto');
const { 마감읽기, 마감상태 } = require('./deadline');
const { 새ID } = require('./store');

const sha = (s) => createHash('sha256').update(s).digest('hex');

function 링크정규화(url) {
  try {
    const u = new URL(String(url).trim());
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch { return String(url || '').trim().toLowerCase(); }
}

function 제목정규화(t) {
  return String(t || '').replace(/[\[【][^\]】]*[\]】]/g, '').replace(/[\s\p{P}\p{S}]+/g, '').toLowerCase();
}

function 유사도(a, b) { // 글자 두 개씩 묶어 비교하는 Dice 계수 (0~1)
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const g = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = g(a), B = g(b); let 겹침 = 0;
  for (const [k, v] of A) if (B.has(k)) 겹침 += Math.min(v, B.get(k));
  return (2 * 겹침) / (a.length - 1 + b.length - 1);
}

// 본문에서 매번 달라지는 부분(조회수, 공백)을 빼고 해시를 만들어요. (재검증 생략의 기준)
function 본문정규화(본문) {
  return String(본문 || '').split(/\r?\n/).filter((l) => !/^\s*(조회(수)?|hit|views?)\s*[:：]?\s*\d+\s*$/i.test(l)).join('\n').replace(/\s+/g, ' ').trim();
}
const 검증키만들기 = (본문, 프롬프트버전) => sha(JSON.stringify([본문정규화(본문), 프롬프트버전]));

function 기간겹침(a, b) { // 둘 다 알 때만 판단하고, 모르면 겹치는 것으로 봐요(자동으로 갈라 놓지 않기 위해)
  const as = a.시작 || null, ae = a.마감 || null, bs = b.시작 || null, be = b.마감 || null;
  if (!ae || !be) return true;
  const 시작a = as || ae, 시작b = bs || be;
  return !(ae < 시작b || be < 시작a);
}
const 기간 = (n) => ({ 시작: n.접수시작?.날짜 || null, 마감: n.접수마감?.날짜 || null });

const 비교항목 = [['공고명', (n) => n.공고명], ['접수 시작일', (n) => n.접수시작?.날짜 || '미확인'], ['접수 마감 표기', (n) => n.접수마감?.원문표기 || '미확인'], ['첨부', n => JSON.stringify((n.첨부 || []).map(a => typeof a === 'string' ? a : [a.이름, a.링크 || a.주소, a.상태, a.해시]))]];

// existing: 저장된 공고들. inc: 이번에 들어온 글(받은 그대로의 글자). 돌려주는 값: { 종류, 대상, 변경[] }
function 분류하기(existing, inc) {
  const 링크 = 링크정규화(inc.공식링크);
  const 같은링크 = existing.find((n) => 링크정규화(n.공식링크) === 링크);
  if (같은링크) {
    const 변경 = [];
    for (const [이름, get] of 비교항목) {
      const 이전 = get(같은링크), 이후 = get(inc);
      if (이전 !== 이후 && !(이름 === '접수 시작일' && 이후 === '미확인')) 변경.push({ 항목: 이름, 이전, 이후 });
    }
    if (inc.원문?.본문해시 && 같은링크.원문?.본문해시 !== inc.원문.본문해시) 변경.push({ 항목: '본문', 이전: `(해시 ${String(같은링크.원문?.본문해시 || '없음').slice(0, 8)})`, 이후: `(해시 ${inc.원문.본문해시.slice(0, 8)})` });
    const 연장 = 같은링크.접수마감?.날짜 && inc.접수마감?.날짜 && inc.접수마감.날짜 > 같은링크.접수마감.날짜;
    return { 종류: 연장 ? '마감 연장' : 변경.length ? '수정' : '기존', 대상: 같은링크, 변경 };
  }
  const 제목 = 제목정규화(inc.공고명);
  let 최고 = null;
  for (const n of existing) {
    if (n.기관ID !== inc.기관ID) continue;
    const s = 유사도(제목정규화(n.공고명), 제목);
    if (s >= 0.85 && (!최고 || s > 최고.s)) 최고 = { s, n };
  }
  if (최고) {
    const a = 기간(최고.n), b = 기간(inc);
    // 이전 마감이 끝난 뒤에 새 접수가 시작되면 재공고, 기간이 겹치거나 모르면 사람이 확인할 중복 후보
    if (a.마감 && b.시작 && b.시작 > a.마감) return { 종류: '재공고', 대상: 최고.n, 변경: [{ 항목: '재공고', 이전: `이전 마감 ${a.마감}`, 이후: `새 접수 ${b.시작}~${b.마감 || '미확인'}` }] };
    if (기간겹침(a, b)) return { 종류: '후보중복', 대상: 최고.n, 변경: [] };
  }
  return { 종류: '신규', 대상: null, 변경: [] };
}

const 본문자르기 = 12000; // 저장용 상한 (AI에 보낼 상한은 설정의 본문자)

// 받은 글(inc 항목)과 기관 정보로 공고 기록을 만들어요. 모르는 값은 '미확인'이에요.
function 공고만들기(항목, 기관, 문맥) {
  const 마감 = 마감읽기(항목.마감원문);
  const 본문 = String(항목.본문 || '').slice(0, 본문자르기);
  const 첫날짜 = 마감.시작날짜 ? { 날짜: 마감.시작날짜, 원문표기: 마감.원문표기 } : { 날짜: null, 원문표기: '미확인' };
  return {
    id: 문맥.id || 새ID('n'),
    기관ID: 기관.id, 기관명: 기관.이름, 공고명: String(항목.제목 || '').trim(), 검색종류: 기관.검색종류 || 'instructor', 정보유형: 항목.정보유형 || null,
    분야: ['A', 'B', 'C'].includes(항목.분야) ? 항목.분야 : '미확인',
    대상: '미확인', 지역: 항목.지역 || 기관.지역, 우선순위: 기관.우선순위 ?? null,
    접수시작: 첫날짜,
    접수마감: { 날짜: 마감.날짜, 시각: 마감.시각, 원문표기: 마감.원문표기 || '미확인', 마감판정: 마감.마감판정, 판정근거: 마감.판정근거 },
    장소: '미확인', 시간대: '미확인', 금액: '미확인', 자격: { 원문: '미확인', 조건: [] }, 제출서류: '미확인', 접수방법: '미확인',
    공식링크: String(항목.링크 || '').trim(), 첨부: Array.isArray(항목.첨부) ? 항목.첨부.slice(0, 10) : [],
    게시일: 항목.게시일 || null,
    최초발견: { 시각: 문맥.시각, 실행ID: 문맥.실행ID },
    마지막검증: null, 검증상태: 본문 && (기관.시험용 || 항목.공식확인) ? '원문확인됨' : '후보', 검증필요: 항목.원문오류 || null,
    적합도: { 판정: '확인 필요', 미충족: [], 확인필요: [], 근거: [], 출처: '코드' },
    AI적합도: null, 수동판정: null,
    공고상태: '신규', 지원상태: '', 지원이력: [], 메모: '', 연결: {}, 중복후보: null, 변경이력: [],
    원천: 문맥.원천 || '공식게시판', 시험용: !!(기관.시험용 || 문맥.시험용),
    원문: { 본문, 공식확인: 항목.공식확인 === true, 확인시각: 항목.확인시각 || null, 본문잘림: String(항목.본문 || '').length > 본문자르기, 첨부확인: 항목.첨부확인 || '미확인', 본문해시: 본문 ? sha(본문정규화(본문)) : null, ...(항목._mock ? { mock: 항목._mock } : {}) },
    출처필드: {}, 필드상태: {},
    '제외·보존': { AI검증: { 상태: '대상', 사유: '' }, 추천노출: { 노출: true, 사유: '' }, 보존: true },
    검증기록: null,
  };
}

function 인천판별(n, 기관) {
  const 본문 = n.원문?.본문 || '';
  if (/인천/.test(기관?.지역 || '') || /인천/.test(n.지역 || '')) return '확실';
  if (/인천[^\n]{0,12}(한정|거주자?\s*(만|한))/.test(본문) || /^\s*지역\s*[:：]\s*인천/m.test(본문)) return '확실';
  if (/인천/.test(n.공고명) || /인천/.test(본문)) return '불확실';
  return '아님';
}

// 판정 규칙 적용: 표지(AI 검증/추천 노출/적합도/공고상태)를 다시 계산해요. 몇 번을 불러도 같은 결과예요. 기록은 지우지 않아요.
function 규칙적용(n, { 기관, 설정, 지금 = new Date() }) {
  const 마감 = 마감상태(n.접수마감, 지금);
  const 주택 = (n.검색종류 || 설정.검색종류) === 'housing';
  const 인천 = 주택 || 설정.검색종류 === 'startup' ? '아님' : 인천판별(n, 기관);
  const 키 = 검증키만들기(JSON.stringify([본문정규화(n.원문?.본문), n.첨부, n.기관ID, n.공고명, n.검색종류]), 설정.버전.프롬프트);
  n.검증키 = 키;
  const 이미검증 = n.검증기록 && n.검증기록.검증키 === 키;

  // 공고 상태
  if (마감.마감지남) n.공고상태 = '접수 마감';
  else if (n.공고상태 === '접수 마감') n.공고상태 = '기존';
  if (/취소\s*공고|모집\s*취소|공고\s*취소/.test(n.공고명)) n.공고상태 = '취소';

  // AI 검증 (대상 / 생략)
  const ai = n['제외·보존'].AI검증;
  const 미처리였나 = ai.상태 === '대상' && ai.미처리 === true;
  if (인천 === '확실') Object.assign(ai, { 상태: '생략', 사유: '코드판정-지역' });
  else if (마감.마감지남 || n.공고상태 === '취소') Object.assign(ai, { 상태: '생략', 사유: '코드판정-마감확정' });
  else if (!n.원문?.본문) Object.assign(ai, { 상태: '생략', 사유: '본문없음' });
  else if (이미검증) Object.assign(ai, { 상태: '생략', 사유: '변경없음' });
  else if (ai.사유 === '응답오류' && ai.키 === 키) { /* 같은 본문으로 응답 오류가 난 건 작가님이 다시 요청할 때까지 보내지 않아요 */ }
  else if (ai.사유 === '작가님보류') { /* 작가님이 보류한 건 그대로 */ }
  else { ai.상태 = '대상'; ai.사유 = ''; ai.미처리 = 미처리였나; }
  if (ai.상태 !== '대상') delete ai.미처리;

  // 적합도: 코드로 정해지는 것 + AI가 준 것을 합쳐요
  const 미충족 = [], 확인필요 = [], 근거 = [];
  if (인천 === '확실') { 미충족.push('지역 제외(인천)'); 근거.push('인천 공고는 추천하지 않아요'); }
  if (마감.마감지남) { 미충족.push('접수 마감(확정)'); 근거.push(`마감 ${n.접수마감.날짜}${n.접수마감.시각 ? ' ' + n.접수마감.시각 : ''} (${n.접수마감.판정근거})`); }
  if (인천 === '불확실') 확인필요.push('지역 불확실: 인천 여부를 확인해 주세요');
  if (n.접수마감.마감판정 === '불확실') 확인필요.push(`마감일 불확실: ${n.접수마감.판정근거}`);
  if (마감.당일 && !마감.마감지남) 확인필요.push(n.접수마감.시각 ? '오늘 마감이에요' : '오늘 마감이에요 (시각 미확인)');
  if (n.AI적합도) { 미충족.push(...n.AI적합도.미충족); 확인필요.push(...n.AI적합도.확인필요); 근거.push(...n.AI적합도.근거); }
  else if (ai.사유 === '본문없음') 확인필요.push('원문 본문이 없어서 AI 검증을 할 수 없어요');
  else if (!미충족.length) 확인필요.push('AI 검증 전이에요');
  if (n.검증필요) 확인필요.push(n.검증필요);
  if (n.검증기록 && (n.검증기록.판정버전?.판정규칙 !== 설정.버전.판정규칙 || n.검증기록.판정버전?.내조건 !== 설정.버전.내조건)) 확인필요.push('판정 규칙 또는 내 조건이 바뀌었어요 (필요하면 다시 검증)');
  let 판정 = 미충족.length ? '부적합' : 확인필요.length ? '확인 필요' : (n.AI적합도?.판정 || '확인 필요');
  let 출처 = n.AI적합도 ? 'AI+코드' : '코드';
  if (n.수동판정) { 판정 = n.수동판정.판정; 출처 = '작가님'; }
  n.적합도 = { 판정, 미충족: [...new Set(미충족)], 확인필요: [...new Set(확인필요)], 근거: [...new Set(근거)], 출처 };
  if (주택) n.적합도 = { 판정: '확인 필요', 미충족: [], 확인필요: ['주택 공고는 개인 자격 판단과 추천을 하지 않아요.'], 근거: [], 출처: '사실확인만' };

  // 추천 노출
  const 추천 = n['제외·보존'].추천노출;
  if (인천 === '확실') Object.assign(추천, { 노출: false, 사유: '인천' });
  else if (마감.마감지남 || n.공고상태 === '취소') Object.assign(추천, { 노출: false, 사유: n.공고상태 === '취소' ? '취소' : '마감' });
  else if (판정 === '부적합') Object.assign(추천, { 노출: false, 사유: '부적합' });
  else Object.assign(추천, { 노출: true, 사유: '' });
  n['제외·보존'].보존 = true;
  return n;
}

// 저장된 모든 공고에 규칙을 다시 적용해요 (시간이 지나 마감이 된 공고, 설정이 바뀐 공고를 반영). 바뀐 것만 저장하고, 지우지 않아요.
function 다시계산({ store, 설정, 지금 = new Date() }) {
  const 기관들 = new Map(store.기관목록().map((k) => [k.id, k]));
  let 바뀜 = 0;
  const 목록 = store.공고목록();
  for (const n of 목록) {
    const 전 = JSON.stringify(n);
    규칙적용(n, { 기관: 기관들.get(n.기관ID), 설정, 지금 });
    if (JSON.stringify(n) !== 전) { store.공고저장(n); 바뀜++; }
  }
  return { 목록, 바뀜 };
}

module.exports = { 다시계산, 링크정규화, 제목정규화, 유사도, 본문정규화, 검증키만들기, 분류하기, 공고만들기, 규칙적용, 인천판별, sha };
