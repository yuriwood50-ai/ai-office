'use strict';
const { 한국날짜, 한국시각, 마감상태 } = require('./deadline');
function 보고서({ store, 프로필, 지금 = new Date() }) {
  const runs = store.실행목록().filter(r => r.단계 === 'A' && r.종류 !== '등록');
  const latest = runs.at(-1); const notices = store.공고목록();
  const rows = notices.filter(n => n.최초발견?.실행ID === latest?.id || n.변경이력?.some(h => h.실행ID === latest?.id) || (() => { const d = 마감상태(n.접수마감, 지금); return d.남은일수 !== null && d.남은일수 >= 0 && d.남은일수 <= 7 && !d.마감지남; })()).map(n => {
    const d = 마감상태(n.접수마감, 지금);
    const 놓침 = store.누락목록().some(m => m.공고ID === n.id);
    const 표지 = [...new Set([놓침 ? '놓침' : n.공고상태, ...(d.남은일수 !== null && d.남은일수 >= 0 && d.남은일수 <= 7 && !d.마감지남 ? ['마감 임박'] : [])])];
    return { id: n.id, 표지, 공고명: n.공고명, 기관: n.기관명, 게시일: n.게시일 || '미확인', 마감: n.접수마감.원문표기, 남은일수: d.남은일수, 지역: n.지역, 대상: n.대상, 내용: n.원문?.본문?.slice(0, 300) || '미확인', 신청방법: n.접수방법, 제출서류: n.제출서류, 링크: n.공식링크, 원문확인: n.원문?.공식확인 === true, 첨부확인: n.원문?.첨부확인 || '미확인' };
  });
  const institutions = store.기관목록().filter(k => k.사용);
  const failed = institutions.filter(k => !k.마지막점검 || !/^정상 완료/.test(k.마지막점검.결과)).map(k => k.이름);
  const prior = runs.filter(r => r.id !== latest?.id && 한국날짜(new Date(r.시작)) === 한국날짜(지금) && 한국시각(new Date(r.시작)) < '12:00').at(-1);
  if (프로필.id === 'housing') rows.sort((a,b) => require('./housing').주택분류({공고명:a.공고명,지역:a.지역}).순서 - require('./housing').주택분류({공고명:b.공고명,지역:b.지역}).순서);
  return { 확인시각: `${한국날짜(지금)} ${한국시각(지금)} KST`, 종류: 프로필.이름, 실행ID: latest?.id || null, 시험용: latest?.모드 === 'mock', 안내: [프로필.안내 || '', latest ? '' : '검색 실행 기록이 없어요.', 프로필.id === 'housing' && !prior ? '오늘 오전 비교 기록이 없어요. 오전 이후 변화로 단정하지 않아요.' : '', '등록한 게시판의 결과예요. 필수 출처군 전체 검색 완료를 뜻하지 않아요.'].filter(Boolean), 검증범위: { 등록기관: institutions.length, 정상완료: institutions.length - failed.length, 미확인기관: failed, 필수출처군: 프로필.필수출처 }, 공고: rows };
}
module.exports = { 보고서 };
