'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function 실패(상태, 메시지) {
  return Object.assign(new Error(메시지), { status: 상태 });
}

function 작업만들기(루트, 설정, 입력) {
  if (!입력 || typeof 입력 !== 'object' || Array.isArray(입력)) throw 실패(400, '입력 내용을 확인해 주세요.');
  const { 편, 주제, 요청사항 = '', 방: 방id } = 입력;
  if (!Number.isInteger(편) || 편 < 15 || 편 > 999 || 편 === 99) {
    throw 실패(400, '편 번호는 15~999 사이로 입력해 주세요. 99편은 시험용이에요.');
  }
  if (typeof 주제 !== 'string' || !주제.trim() || 주제.trim().length > 120) throw 실패(400, '주제는 1~120자로 입력해 주세요.');
  if (typeof 요청사항 !== 'string' || 요청사항.length > 2000) throw 실패(400, '요청사항은 2,000자 이내로 입력해 주세요.');
  const 방 = 설정.방.find((r) => r.id === 방id);
  if (!방 || 방.id !== 'blog') throw 실패(400, '현재는 블로그팀 작업을 만들 수 있어요.');
  const 폴더 = path.resolve(루트, '사무실', 방.상태폴더 || '../상태');
  const 실제루트 = fs.realpathSync(루트);
  const 상대 = path.relative(실제루트, fs.realpathSync(폴더));
  if (!상대 || 상대.startsWith('..') || path.isAbsolute(상대)) throw 실패(400, '작업 저장 폴더 설정을 확인해 주세요.');
  for (const 이름 of fs.readdirSync(폴더).filter((n) => /^\d{1,3}\.json$/i.test(n))) {
    if (Number.parseInt(이름, 10) === 편) throw 실패(409, '이미 있는 편 번호예요. 다른 번호를 입력해 주세요.');
    let 기존;
    try { 기존 = JSON.parse(fs.readFileSync(path.join(폴더, 이름), 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw 실패(409, `${이름}의 내용을 확인할 수 없어 중복 검사를 멈췄어요. 파일을 확인해 주세요.`); }
    if (Number(기존?.편) === 편) throw 실패(409, '이미 있는 편 번호예요. 다른 번호를 입력해 주세요.');
  }
  const 시각 = new Date().toISOString();
  const 메시지 = '새 작업을 등록했어요. 주제기획 실행 전이에요.';
  const 데이터 = {
    편, 주제: 주제.trim(), 요청사항: 요청사항.trim(), 단계: '기획준비',
    직원: Object.fromEntries((방.직원 || []).map((s) => [s.id, { 상태: '쉼', 메시지: '작업 시작을 기다리고 있어요' }])),
    마지막메시지: 메시지,
    기록: [{ 시각, 직원: '작가님', 내용: 메시지 }], 갱신시각: 시각,
  };
  if (입력.기획승인) {
    데이터.단계 = '기획승인';
    데이터.기획승인 = 입력.기획승인;
    데이터.마지막메시지 = '작가님이 기획을 승인했어요. 글쓰기 실행 전이에요.';
    데이터.기록 = [{ 시각, 직원: '작가님', 내용: 데이터.마지막메시지 }];
  }
  const 파일 = `${String(편).padStart(2, '0')}.json`;
  const 임시 = path.join(폴더, `.new-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(임시, JSON.stringify(데이터, null, 2) + '\n', { flag: 'wx' });
    // 완성된 파일만 공개하고, 같은 이름의 기존 파일은 절대 덮어쓰지 않아요.
    fs.linkSync(임시, path.join(폴더, 파일));
  } catch (e) {
    if (e.code === 'EEXIST') throw 실패(409, '이미 있는 편 번호예요. 다른 번호를 입력해 주세요.');
    throw e;
  } finally { if (fs.existsSync(임시)) fs.unlinkSync(임시); }
  return { 파일, 데이터 };
}

async function 입력읽기(req) {
  let 크기 = 0;
  const 조각 = [];
  for await (const chunk of req) {
    크기 += chunk.length;
    if (크기 > 16384) throw 실패(413, '입력 내용이 너무 길어요.');
    조각.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(조각).toString('utf8')); }
  catch { throw 실패(400, '입력 내용을 읽지 못했어요. 다시 시도해 주세요.'); }
}

module.exports = { 작업만들기, 입력읽기 };
