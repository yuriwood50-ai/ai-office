// 시험용 가짜 게시판: mock\boards.json의 시나리오를 회차(몇 번째 점검인지)에 따라 돌려줘요. 실제 네트워크는 쓰지 않아요.
// 모든 기관·공고는 [시험]/[시험용] 표지와 .invalid 주소를 달고 있어서 진짜 공고와 섞이지 않아요.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { 한국날짜 } = require('./deadline');

const 폴더 = path.join(__dirname, 'mock');

function 날짜치환(텍스트, 지금) {
  return 텍스트.replace(/\{D([+-]\d+)?\}/g, (_, n) => 한국날짜(new Date(지금.getTime() + Number(n || 0) * 86400e3)));
}

function 시험용기관() {
  return JSON.parse(fs.readFileSync(path.join(폴더, 'institutions.json'), 'utf8')).기관;
}

function createMockFetcher() {
  const 원본 = fs.readFileSync(path.join(폴더, 'boards.json'), 'utf8');
  return {
    async fetchBoard(기관, 판, { 회차, 지금 }) {
      const 게시판들 = JSON.parse(날짜치환(원본, 지금));
      const 항목 = 게시판들[판.주소];
      if (!항목) throw Object.assign(new Error('주소를 찾을 수 없어요 (시험 자료에 없는 게시판)'), { kind: 'dns' });
      const r = 항목.회차[Math.min(회차, 항목.회차.length - 1)];
      if (r.오류) throw Object.assign(new Error(r.오류.message || r.오류.kind), r.오류);
      if (r.추출실패) return { http: 200, items: null, 추출오류: r.추출실패 };
      return { http: 200, items: r.items };
    },
  };
}

module.exports = { createMockFetcher, 시험용기관, 날짜치환 };
