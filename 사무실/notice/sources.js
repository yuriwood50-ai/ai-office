'use strict';
// 공식 페이지를 직접 확인한 주소만 연결해요. 등록은 수집 성공을 뜻하지 않아요.
const gcon = ['gcon', '경기콘텐츠진흥원', '경기도', '콘텐츠진흥기관', 'https://www.gcon.or.kr/gcon/business/gconNotice/list.do?menuNo=200061'];
const yongin = ['yongin-news', '용인시 시정소식', '용인시', '기타 공식 모집기관', 'https://www.yongin.go.kr/user/bbs/BD_selectBbsList.do?q_bbsCode=1001&q_clCode=1'];
const seeds = {
  instructor: [yongin, ['yongin-lll', '용인시 평생학습관', '용인시', '평생학습관', 'https://lll.yongin.go.kr/yongin/userNotice/list.do'], ['suwon-lll', '수원시 평생학습관', '수원시', '평생학습관', 'https://learning.suwon.go.kr/lmth/05_com01.asp?Catagory=1'], gcon],
  startup: [['kstartup', 'K-Startup 모집중', '전국', '기타 공식 모집기관', 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do'], ['bizinfo', '기업마당 지원사업', '전국', '기타 공식 모집기관', 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200View.do'], gcon],
  housing: [['gh-platform', 'GH · 용인 플랫폼시티 공식 사업 안내', '용인시', '기타 공식 모집기관', 'https://www.gh.or.kr/gh/gyeonggi-yongin-platform-city.do', '사업 안내'], ['gh-housing', 'GH 주택 분양·임대 공고', '경기도', '기타 공식 모집기관', 'https://gh.or.kr/gh/announcement-of-salerental001.do?srCategoryId=12'], ['gh-plan', 'GH 주택 공급계획', '경기도', '기타 공식 모집기관', 'https://www.gh.or.kr/gh/housing-stability-in-gyeonggi-do001.do', '사업 안내'], yongin, ['lh', 'LH청약플러스 · 경기 임대', '경기도', '기타 공식 모집기관', 'https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do?cnpCd=41&mi=1026'], ['gh-apply', 'GH주택청약·임대센터', '경기도', '기타 공식 모집기관', 'https://apply.gh.or.kr/sb/sr/sr7150/selectPbancRentHouseList.do']],
};
function 기본기관(id) { return (seeds[id] || []).map(([key, 이름, 지역, 유형, 주소, 종류]) => ({ id: key, 이름, 지역, 유형, 검색종류: id, 사용: true, 점검주기: '수동', 메모: '2026-10-24 공식 주소 확인. 자동 수집 결과와 별개예요.', 게시판: [{ id: 'b1', 주소, 종류: 종류 || 'HTML 목록' }] })); }
module.exports = { 기본기관 };
