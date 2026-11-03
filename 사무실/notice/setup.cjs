'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { createStore, 기관검사 } = require('./store');
const { 기본기관 } = require('./sources');
const root = path.resolve(__dirname, '../..');
for (const id of ['instructor', 'startup', 'housing']) {
  const dir = id === 'instructor' ? path.join(root, '공고') : path.join(root, '공고/분야', id);
  const store = createStore(dir); const list = store.기관목록();
  for (const source of 기본기관(id)) if (!list.some(x => x.id === source.id)) list.push(기관검사(source));
  store.기관저장(list);
}
// 담당 AI만 연결하고 모델 선택은 기존 사용자 설정을 유지해요.
const file = path.join(root, '사무실/office.config.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const verifier = config.방.find(r => r.id === 'notice')?.직원.find(s => s.id === 'verifier');
if (verifier && verifier.AI === 'AI(Mock)') { verifier.AI = 'Claude'; fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n'); }
console.log('공고 사이트 목록을 준비했어요. 검색은 화면에서 시작해요.');
