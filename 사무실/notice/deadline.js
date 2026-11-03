// 마감일 읽기와 판정: 확실하게 읽히는 날짜만 '확정'이에요. 모호하면 추정하지 않고 '불확실'로 둬요. (모두 일반 코드, AI 없음)
'use strict';

const 요일글자 = ['일', '월', '화', '수', '목', '금', '토'];
const 한국날짜 = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const 한국시각 = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 16);

function 진짜날짜(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null;
}
const iso = (t) => t.toISOString().slice(0, 10);

// 원문 표기를 읽어서 { 시작날짜, 날짜, 시각, 원문표기, 마감판정('확정'|'불확실'|'해당없음'), 판정근거 } 로 돌려줘요.
function 마감읽기(원문) {
  const 문자 = String(원문 ?? '').trim();
  const 기본 = { 시작날짜: null, 날짜: null, 시각: null, 원문표기: 문자 };
  if (!문자) return { ...기본, 마감판정: '불확실', 판정근거: '마감 정보가 없어요' };
  if (/상시|수시|연중|예산\s*소진/.test(문자)) return { ...기본, 마감판정: '해당없음', 판정근거: '상시·수시 모집' };

  const 날짜들 = [];
  const re = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*(?:일)?(?:\s*\(([월화수목금토일])\))?/g;
  let m;
  while ((m = re.exec(문자))) {
    const t = 진짜날짜(Number(m[1]), Number(m[2]), Number(m[3]));
    날짜들.push({ t, 요일: m[4] || null, 모양오류: !t });
  }
  if (!날짜들.length) {
    const 연도없음 = /\d{1,2}\s*[./월]\s*\d{1,2}/.test(문자);
    return { ...기본, 마감판정: '불확실', 판정근거: 연도없음 ? '연도가 없어서 날짜를 확정할 수 없어요' : '날짜를 읽을 수 없어요' };
  }
  if (날짜들.some((x) => x.모양오류)) return { ...기본, 마감판정: '불확실', 판정근거: '존재하지 않는 날짜예요' };

  const 끝 = 날짜들[날짜들.length - 1];
  const 결과 = { ...기본, 날짜: iso(끝.t), 시작날짜: 날짜들.length > 1 ? iso(날짜들[0].t) : null };
  // 시각: 마지막 날짜 뒤에 나오는 시각만 봐요
  const 뒤 = 문자.slice(문자.lastIndexOf(String(끝.t.getUTCFullYear())));
  const tm = /(\d{1,2})\s*:\s*(\d{2})|(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/.exec(뒤.replace(/\(([월화수목금토일])\)/g, ''));
  if (tm) {
    const h = Number(tm[1] ?? tm[3]); const mi = Number(tm[2] ?? tm[4] ?? 0);
    if (h === 24 && mi === 0) { 결과.날짜 = iso(new Date(끝.t.getTime() + 86400e3)); 결과.시각 = '00:00'; }
    else if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) 결과.시각 = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    else return { ...결과, 마감판정: '불확실', 판정근거: '마감 시각을 해석할 수 없어요' };
  }
  if (끝.요일 && 요일글자[끝.t.getUTCDay()] !== 끝.요일) {
    return { ...결과, 마감판정: '불확실', 판정근거: `요일이 달력과 달라요 (원문 ${끝.요일}요일, 달력 ${요일글자[끝.t.getUTCDay()]}요일)` };
  }
  return { ...결과, 마감판정: '확정', 판정근거: '원문에서 날짜가 확실히 읽혀요' };
}

// 마감이 '확정'이고 이미 지났을 때만 닫아요. 시각이 없으면 그날이 끝난 다음 날부터 마감이에요.
function 마감상태(마감, 지금 = new Date()) {
  const 결과 = { 마감지남: false, 남은일수: null, 당일: false };
  if (!마감 || 마감.마감판정 !== '확정' || !마감.날짜) return 결과;
  const 오늘 = 한국날짜(지금);
  const 차이 = Math.round((Date.parse(`${마감.날짜}T00:00:00Z`) - Date.parse(`${오늘}T00:00:00Z`)) / 86400e3);
  결과.남은일수 = 차이; 결과.당일 = 차이 === 0;
  if (차이 < 0) 결과.마감지남 = true;
  else if (차이 === 0 && 마감.시각 && 한국시각(지금) > 마감.시각) 결과.마감지남 = true;
  return 결과;
}

module.exports = { 마감읽기, 마감상태, 한국날짜, 한국시각, 요일글자 };
