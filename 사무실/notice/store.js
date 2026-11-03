// 공고 센터 저장소: JSON 파일을 읽고 써요. 폴더 위치는 밖에서 받아요(시험은 임시 폴더, 운영은 공고\).
// 쓰기는 임시 파일 -> 이름 바꾸기로 해서 중간에 멈춰도 기존 파일이 깨지지 않고, 공고 삭제 기능은 일부러 없어요.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const ID모양 = /^[A-Za-z0-9_-]{1,64}$/;
const 실패 = (status, message) => Object.assign(new Error(message), { status });

const 기관유형 = ['평생학습관', '도서관', '주민센터', '여성회관', '문화재단', '콘텐츠진흥기관', '학교', '청소년기관', '공공 교육기관', '창작 지원기관', '기타 공식 모집기관'];

// 지역 글자로 우선순위를 정해요 (1순위 용인·성남·수원 / 2순위 경기 나머지 / 3순위 서울 / 전국은 작가님이 정함).
function 우선순위(지역) {
  const t = String(지역 || '');
  if (/용인|성남|수원/.test(t)) return 1;
  if (/서울/.test(t)) return 3;
  if (/경기|안산|고양|화성|부천|안양|평택|시흥|파주|김포|의정부|광명|광주|하남|군포|오산|이천|양주|구리|안성|포천|의왕|여주|동두천|과천|양평|가평|연천/.test(t)) return 2;
  return null;
}

function 인천인가(기관) {
  const 주소들 = (기관.게시판 || []).map((b) => String(b.주소 || ''));
  return /인천/.test(String(기관.지역 || '')) || /인천/.test(String(기관.이름 || '')) || 주소들.some((a) => /incheon/i.test(a));
}

function 기관검사(기관) {
  if (!기관 || typeof 기관 !== 'object' || Array.isArray(기관)) throw 실패(400, '기관 정보를 확인해 주세요.');
  if (!ID모양.test(String(기관.id || ''))) throw 실패(400, '기관 id는 영문·숫자·-·_ 1~64자로 적어 주세요.');
  if (typeof 기관.이름 !== 'string' || !기관.이름.trim() || 기관.이름.length > 80) throw 실패(400, '기관 이름을 1~80자로 적어 주세요.');
  if (!기관유형.includes(기관.유형)) throw 실패(400, `기관 유형은 다음 중 하나여야 해요: ${기관유형.join(', ')}`);
  if (typeof 기관.지역 !== 'string' || !기관.지역.trim() || 기관.지역.length > 40) throw 실패(400, '지역을 적어 주세요. (예: 용인시, 경기도 화성시, 서울특별시)');
  if ((!기관.검색종류 || 기관.검색종류 === 'instructor') && 인천인가(기관)) throw 실패(400, '인천광역시 기관은 검색 대상으로 등록할 수 없어요.');
  if (!Array.isArray(기관.게시판) || !기관.게시판.length) throw 실패(400, '공식 게시판 주소가 하나 이상 있어야 해요.');
  const 게시판 = 기관.게시판.map((b, i) => {
    if (!b || typeof b.주소 !== 'string' || !/^https?:\/\/[^\s]+$/i.test(b.주소) || b.주소.length > 500) throw 실패(400, `게시판 ${i + 1}의 주소는 http(s)://로 시작해야 해요.`);
    return { id: ID모양.test(String(b.id || '')) ? b.id : `b${i + 1}`, 주소: b.주소, 종류: ['HTML 목록', 'RSS', '외부 포털', '사업 안내'].includes(b.종류) ? b.종류 : 'HTML 목록', 메모: String(b.메모 || '').slice(0, 300) };
  });
  return {
    id: 기관.id, 이름: 기관.이름.trim(), 유형: 기관.유형, 지역: 기관.지역.trim(), 검색종류: 기관.검색종류 || 'instructor',
    우선순위: [1, 2, 3].includes(기관.우선순위) ? 기관.우선순위 : 우선순위(기관.지역),
    게시판, 사용: 기관.사용 !== false, 점검주기: String(기관.점검주기 || '수동').slice(0, 20), 메모: String(기관.메모 || '').slice(0, 500),
    시험용: 기관.시험용 === true, 마지막점검: 기관.마지막점검 || null,
  };
}

function 새ID(접두 = 'n') {
  const d = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  return `${접두}${d}-${randomBytes(3).toString('hex')}`;
}

function createStore(dir) {
  if (typeof dir !== 'string' || !dir.trim()) throw 실패(500, '데이터 폴더가 지정되지 않았어요.');
  const root = path.resolve(dir);
  for (const sub of ['notices', 'snapshots', 'runs', path.join('cache', 'mock'), path.join('cache', 'real')]) fs.mkdirSync(path.join(root, sub), { recursive: true });

  const 안인가 = (p) => { const rel = path.relative(root, path.resolve(p)); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
  const id확인 = (id) => { if (!ID모양.test(String(id || ''))) throw 실패(400, '잘못된 id예요.'); return String(id); };

  function 읽기(file, 기본) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
    catch (e) {
      if (e.code === 'ENOENT') return 기본;
      throw 실패(500, `${path.basename(file)}을 읽지 못했어요 (${e.message})`);
    }
  }
  function 쓰기(file, data) {
    if (!안인가(file)) throw 실패(400, '데이터 폴더 밖에는 쓸 수 없어요.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(tmp, file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }

  const P = (...x) => path.join(root, ...x);
  const 경고 = [];

  return {
    root, 경고, 읽기, 쓰기,
    // ---- 기관 ----
    기관목록() { return 읽기(P('institutions.json'), { 기관: [] }).기관 || []; },
    기관저장(목록) { 쓰기(P('institutions.json'), { 기관: 목록 }); },
    // ---- 공고 ----
    공고경로(id) { return P('notices', `${id확인(id)}.json`); },
    공고읽기(id) { return 읽기(this.공고경로(id), null); },
    공고목록() {
      const 결과 = []; 경고.length = 0;
      for (const 이름 of fs.readdirSync(P('notices')).filter((n) => n.endsWith('.json'))) {
        try { 결과.push(JSON.parse(fs.readFileSync(P('notices', 이름), 'utf8').replace(/^﻿/, ''))); }
        catch (e) { 경고.push(`${이름}: 읽지 못했어요 (${e.message})`); }
      }
      return 결과;
    },
    공고새로(n) { // 같은 id를 덮어쓰지 않아요
      const file = this.공고경로(n.id);
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      const lock = `${file}.lock`; let locked = false;
      try {
        fs.mkdirSync(lock); locked = true;
        if (fs.existsSync(file)) throw 실패(409, '같은 id의 공고가 이미 있어요.');
        fs.writeFileSync(tmp, JSON.stringify(n, null, 2) + '\n', { flag: 'wx' });
        fs.renameSync(tmp, file);
      } catch (e) { if (e.code === 'EEXIST') throw 실패(409, '같은 id의 공고가 이미 있어요.'); throw e; }
      finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); if (locked) fs.rmdirSync(lock); }
    },
    공고저장(n) { 쓰기(this.공고경로(n.id), n); },
    // ---- 스냅샷 (게시판 목록 기록: 누락 추적용) ----
    스냅샷저장(기관ID, 항목들, 시각, 게시판ID = 'b1') {
      const 이름 = `${new Date(시각).toISOString().replace(/[-:.]/g, '')}_${id확인(게시판ID)}`;
      쓰기(P('snapshots', id확인(기관ID), `${이름}.json`), { 기관ID, 게시판ID, 시각: new Date(시각).toISOString(), 항목: 항목들 });
    },
    스냅샷목록(기관ID) {
      const d = P('snapshots', id확인(기관ID));
      if (!fs.existsSync(d)) return [];
      return fs.readdirSync(d).filter((n) => n.endsWith('.json')).sort().map((n) => 읽기(path.join(d, n), null)).filter(Boolean);
    },
    // ---- 실행 기록 ----
    실행저장(run) { 쓰기(P('runs', `${id확인(run.id)}.json`), run); },
    실행읽기(id) { return 읽기(P('runs', `${id확인(id)}.json`), null); },
    실행목록() {
      return fs.readdirSync(P('runs')).filter((n) => n.endsWith('.json')).map((n) => 읽기(P('runs', n), null)).filter(Boolean)
        .sort((a, b) => String(a.시작).localeCompare(String(b.시작)));
    },
    // ---- 누락 기록 / 캐시 / 사용량 ----
    누락목록() { return 읽기(P('misses.json'), { 누락: [] }).누락 || []; },
    누락추가(m) { const 목록 = this.누락목록(); 목록.push(m); 쓰기(P('misses.json'), { 누락: 목록 }); },
    캐시읽기(모드, 키) { return 읽기(P('cache', 모드 === 'real' ? 'real' : 'mock', `${id확인(키)}.json`), null); },
    캐시쓰기(모드, 키, 값) { 쓰기(P('cache', 모드 === 'real' ? 'real' : 'mock', `${id확인(키)}.json`), 값); },
    사용량추가(항목) { // 호출 직전에 부르는 기록. 실패하면 던져서 실행을 멈추게 해요.
      fs.appendFileSync(P('usage.jsonl'), JSON.stringify({ 시각: new Date().toISOString(), ...항목 }) + '\n');
    },
    사용량읽기() {
      try { return fs.readFileSync(P('usage.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
      catch (e) { if (e.code === 'ENOENT') return []; throw 실패(500, '사용량 기록을 읽지 못했어요.'); }
    },
  };
}

module.exports = { createStore, 기관검사, 우선순위, 인천인가, 새ID, ID모양, 실패, 기관유형 };
