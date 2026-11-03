// 호출 상한 관리: 실행당·하루 호출 수(재시도 포함)를 세고, 호출 '직전에' 기록해요. 기록이 안 되면 호출하지 않아요.
// 한도 값은 실행을 시작할 때의 설정을 복사해서 써요 (설정 변경은 다음 실행부터 적용).
'use strict';
const { 한국날짜 } = require('./deadline');

class 한도오류 extends Error { constructor(message, 이유) { super(message); this.kind = 'budget'; this.이유 = 이유; } }

function createBudget({ store, 한도, 모드, 지금 = () => new Date() }) {
  const 한도복사 = { ...한도 };
  let 쓴횟수 = 0;
  const 오늘호출수 = () => {
    const 오늘 = 한국날짜(지금());
    return store.사용량읽기().filter((e) => e.모드 === 모드 && e.이벤트 === '시작' && 한국날짜(new Date(e.시각)) === 오늘).length;
  };
  return {
    한도: 한도복사,
    쓴횟수: () => 쓴횟수,
    오늘호출수,
    남은수() { return Math.max(0, Math.min(한도복사.실행당 - 쓴횟수, 한도복사.하루 - 오늘호출수())); },
    남은실행수() { return Math.max(0, 한도복사.실행당 - 쓴횟수); },
    남은하루수() { return Math.max(0, 한도복사.하루 - 오늘호출수()); },
    시작(정보) { // 호출 직전에 불러요
      if (쓴횟수 >= 한도복사.실행당) throw new 한도오류(`이번 실행의 호출 상한(${한도복사.실행당}회)에 도달했어요`, '실행당');
      if (오늘호출수() >= 한도복사.하루) throw new 한도오류(`오늘 호출 상한(${한도복사.하루}회)에 도달했어요`, '하루');
      store.사용량추가({ 이벤트: '시작', 모드, ...정보 }); // 실패하면 던져서 호출하지 않아요
      쓴횟수++;
    },
    끝(정보) { try { store.사용량추가({ 이벤트: '끝', 모드, ...정보 }); } catch { /* 끝 기록 실패는 다음 시작에서 드러나요 */ } },
  };
}

module.exports = { createBudget, 한도오류 };
