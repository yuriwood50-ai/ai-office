// 공고 센터 설정: 호출 상한·글자 수 제한·내 조건. 값이 이상하면 기본값으로 되돌려 써요 (상한이 사라지는 쪽으로는 실패하지 않아요).
'use strict';
const { 실패 } = require('./store');

const 기본값 = Object.freeze({
  모드: 'mock',
  AI한도: { 실행당: 5, 하루: 15, 재시도: 1, 배치: 5, 공통문맥자: 1500, 본문자: 6000, 호출입력자: 20000, 호출출력자: 6000, 연속실패: 2 },
  마감임박일: 7,
  내조건: {},
  판정규칙: {}, // 기존 ChatGPT 자동화의 세부 규칙: 작가님이 알려주실 때까지 비워 둬요
  버전: { 내조건: 1, 판정규칙: 1, 프롬프트: 1 },
});

// [최소, 최대] — 호출 수 상한은 1~100, 글자 수는 넉넉한 범위
const 범위 = {
  실행당: [1, 100], 하루: [1, 100], 재시도: [0, 3], 배치: [1, 20],
  공통문맥자: [100, 20000], 본문자: [500, 100000], 호출입력자: [1000, 200000], 호출출력자: [500, 100000], 연속실패: [1, 10],
};
const 올림확인필요 = ['실행당', '하루']; // 올리면 확인을 한 번 더 받아요

const 정수 = (v) => typeof v === 'number' && Number.isInteger(v);

function 복사(o) { return JSON.parse(JSON.stringify(o)); }

function createSettings(store, 검색종류 = 'instructor') {
  const 파일 = () => `${store.root}/settings.json`;
  const 이력파일 = () => `${store.root}/settings.history.json`;

  function 읽기() {
    const 경고 = [];
    const 원본 = store.읽기(파일(), {});
    const 값 = 복사(기본값);
    값.검색종류 = 검색종류;
    if (원본.모드 === 'real') 값.모드 = 'real';
    for (const k of Object.keys(범위)) {
      const v = 원본.AI한도?.[k];
      if (v === undefined) continue;
      if (정수(v) && v >= 범위[k][0] && v <= 범위[k][1]) 값.AI한도[k] = v;
      else 경고.push(`설정 ${k}의 값(${JSON.stringify(v)})이 올바르지 않아서 기본값 ${기본값.AI한도[k]}을(를) 써요.`);
    }
    if (정수(원본.마감임박일) && 원본.마감임박일 >= 1 && 원본.마감임박일 <= 60) 값.마감임박일 = 원본.마감임박일;
    else if (원본.마감임박일 !== undefined) 경고.push(`마감임박일 값이 올바르지 않아서 기본값 ${기본값.마감임박일}을(를) 써요.`);
    if (원본.내조건 && typeof 원본.내조건 === 'object' && !Array.isArray(원본.내조건)) 값.내조건 = 원본.내조건;
    if (원본.판정규칙 && typeof 원본.판정규칙 === 'object' && !Array.isArray(원본.판정규칙)) 값.판정규칙 = 원본.판정규칙;
    for (const k of Object.keys(기본값.버전)) if (정수(원본.버전?.[k]) && 원본.버전[k] >= 1) 값.버전[k] = 원본.버전[k];
    return { 값, 경고 };
  }

  // 변경은 다음 실행부터 적용되고, 바뀐 항목마다 이력이 남아요.
  function 바꾸기(패치, 누가 = '작가님') {
    if (!패치 || typeof 패치 !== 'object' || Array.isArray(패치)) throw 실패(400, '설정 내용을 확인해 주세요.');
    const { 값: 이전 } = 읽기();
    const 새 = 복사(이전);
    const 이력 = [];
    const 시각 = new Date().toISOString();
    const 기록 = (항목, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) 이력.push({ 시각, 누가, 항목, 이전: a, 이후: b }); };
    for (const k of Object.keys(패치.AI한도 || {})) {
      if (!(k in 범위)) throw 실패(400, `알 수 없는 설정이에요: ${k}`);
      const v = 패치.AI한도[k];
      if (!정수(v) || v < 범위[k][0] || v > 범위[k][1]) throw 실패(400, `${k}은(는) ${범위[k][0]}~${범위[k][1]} 사이의 정수여야 해요.`);
      if (올림확인필요.includes(k) && v > 이전.AI한도[k] && 패치.확인 !== true) throw 실패(409, `${k} 상한을 ${이전.AI한도[k]}→${v}로 올리려면 확인이 필요해요. (확인 값을 함께 보내 주세요)`);
      새.AI한도[k] = v; 기록(`AI한도.${k}`, 이전.AI한도[k], v);
    }
    if (패치.마감임박일 !== undefined) {
      if (!정수(패치.마감임박일) || 패치.마감임박일 < 1 || 패치.마감임박일 > 60) throw 실패(400, '마감 임박 기준은 1~60일이에요.');
      새.마감임박일 = 패치.마감임박일; 기록('마감임박일', 이전.마감임박일, 새.마감임박일);
    }
    for (const [키, 버전키] of [['내조건', '내조건'], ['판정규칙', '판정규칙']]) {
      if (패치[키] === undefined) continue;
      if (!패치[키] || typeof 패치[키] !== 'object' || Array.isArray(패치[키]) || JSON.stringify(패치[키]).length > 20000) throw 실패(400, `${키}은(는) 20,000자 이내의 { } 모양이어야 해요.`);
      if (JSON.stringify(패치[키]) !== JSON.stringify(이전[키])) {
        새[키] = 패치[키]; 새.버전[버전키] = 이전.버전[버전키] + 1;
        기록(키, `(버전 ${이전.버전[버전키]})`, `(버전 ${새.버전[버전키]})`);
      }
    }
    if (이력.length) {
      store.쓰기(파일(), 새);
      store.쓰기(이력파일(), [...store.읽기(이력파일(), []), ...이력].slice(-500));
    }
    return { 값: 새, 이력 };
  }

  return { 읽기, 바꾸기, 이력읽기: () => store.읽기(이력파일(), []) };
}

module.exports = { createSettings, 기본값, 범위 };
