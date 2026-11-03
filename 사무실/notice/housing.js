'use strict';
function 주택분류(n) {
  const title = String(n.공고명 || '');
  const 그룹 = /플랫폼\s*시티/.test(title) ? '플랫폼시티' : /용인|수지|기흥|처인/.test(title + ' ' + n.지역) ? '용인 생활권' : '그 밖의 공고';
  const 정보유형 = n.정보유형 || (/사전\s*청약|사전\s*안내|사전\s*예고/.test(title) ? '사전안내' : /공급\s*계획/.test(title) ? '공급계획' : /모집|입주자|청약|공급공고/.test(title) ? '실제 모집공고' : /사업|개발|계획/.test(title) ? '사업계획·진행' : '유형 확인 필요');
  return { 그룹, 정보유형, 순서: { '플랫폼시티': 0, '용인 생활권': 1, '그 밖의 공고': 2 }[그룹] };
}
module.exports = { 주택분류 };
