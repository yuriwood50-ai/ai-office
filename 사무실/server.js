// 로컬 사무실 서버: 상태 조회와 새 작업 등록을 제공해요. AI 실행은 아직 연결 전이에요.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { 입력읽기 } = require('./tasks');
const { createPlanner } = require('./planner');
const { createWriter } = require('./writer');
const { createNoticeApi } = require('./notice/routes');
const { createHash, randomUUID } = require('node:crypto');

const HOST = '127.0.0.1'; // 일부러 설정으로 뺐어요: 바꿀 수 없게 고정해 외부 노출을 막아요
const 사무실폴더 = __dirname;
const 루트폴더 = path.resolve(사무실폴더, '..'); // AI사무실
const 공개폴더 = path.join(사무실폴더, 'public');
const 그림폴더 = path.join(사무실폴더, '그림');
const 설정파일 = path.join(사무실폴더, 'office.config.json');
const 기본포트 = 4173;
const 최대파일크기 = 256 * 1024;

const 형식 = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// 브라우저에게 "이 서버 밖으로는 아무것도 요청하지 마"라고 알려요.
const 보안헤더 = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

function 글읽기(file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

function 설정읽기() {
  const 설정 = JSON.parse(글읽기(설정파일));
  if (!설정 || !Array.isArray(설정.방)) throw new Error('"방" 목록이 없어요');
  return 설정;
}

function 포트정하기() {
  try {
    const p = 설정읽기().서버?.포트;
    if (Number.isInteger(p) && p >= 1024 && p <= 65535) return p;
  } catch {
    // 설정이 깨져 있어도 서버는 열어서 화면에서 오류를 보여줘요
  }
  return 기본포트;
}

// 환경 변수 OFFICE_PORT(0이면 빈 포트를 OS가 정해줘요)는 시험용이에요. 없으면 office.config.json의 포트를 써요.
function 환경포트() {
  const v = process.env.OFFICE_PORT;
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && (n === 0 || (n >= 1024 && n <= 65535)) ? n : null;
}
let PORT = 환경포트() ?? 포트정하기(); // 시작한 뒤 실제 포트로 바뀔 수 있어요
let 기획자;
let 글쓰기;
let 공고;
// 이 서버가 누구인지(요청이 어느 서버에 도착했는지 확인용). 공고 API의 whoami가 알려줘요.
const 인스턴스 = {
  id: randomUUID(), pid: process.pid, 시작시각: new Date().toISOString(), 포트: () => PORT,
  코드버전: (() => {
    try {
      const h = createHash('sha256');
      for (const f of [path.join(사무실폴더, 'server.js'), ...fs.readdirSync(path.join(사무실폴더, 'notice')).filter((n) => n.endsWith('.js')).sort().map((n) => path.join(사무실폴더, 'notice', n))]) h.update(fs.readFileSync(f));
      return h.digest('hex').slice(0, 12);
    } catch { return '확인 못 함'; }
  })(),
};

async function 큰입력읽기(req, 최대 = 131072) { // 공고 본문은 길 수 있어서 기존(16KB)보다 크게 받아요
  let 크기 = 0; const 조각 = [];
  for await (const chunk of req) { 크기 += chunk.length; if (크기 > 최대) throw Object.assign(new Error('입력 내용이 너무 길어요.'), { status: 413 }); 조각.push(chunk); }
  try { return JSON.parse(Buffer.concat(조각).toString('utf8')); } catch { throw Object.assign(new Error('입력 내용을 읽지 못했어요.'), { status: 400 }); }
}

// 파일이 쓰이는 도중에 읽어 깨져 보이면, 직전의 정상 내용을 대신 보여줘요.
const 마지막정상 = new Map();

function 방상태읽기(방) {
  const 결과 = { 에피소드: [], 경고: [] };
  const 폴더 = path.resolve(사무실폴더, 방.상태폴더 || '../상태');
  const 상대 = path.relative(루트폴더, 폴더);
  if (상대.startsWith('..') || path.isAbsolute(상대)) {
    결과.경고.push(`상태폴더는 AI사무실 안이어야 해요: ${방.상태폴더}`);
    return 결과;
  }
  let 이름들;
  try {
    이름들 = fs.readdirSync(폴더);
  } catch {
    결과.경고.push(`상태 폴더를 열 수 없어요: ${방.상태폴더}`);
    return 결과;
  }
  for (const 이름 of 이름들.filter((n) => /^\d{1,3}\.json$/.test(n)).sort()) {
    const 파일 = path.join(폴더, 이름);
    try {
      const 정보 = fs.statSync(파일);
      if (정보.size > 최대파일크기) throw new Error('파일이 너무 커요');
      const 데이터 = JSON.parse(글읽기(파일));
      if (!데이터 || typeof 데이터 !== 'object' || Array.isArray(데이터)) throw new Error('{ } 모양이어야 해요');
      마지막정상.set(파일, 데이터);
      결과.에피소드.push({ 파일: 이름, 수정시각: 정보.mtimeMs, 데이터 });
    } catch (e) {
      const 이전 = 마지막정상.get(파일);
      if (이전) 결과.에피소드.push({ 파일: 이름, 수정시각: Date.now(), 데이터: 이전 });
      결과.경고.push(`${이름}: 읽지 못했어요 (${e.message})${이전 ? ' - 직전 정상 내용을 보여줘요' : ''}`);
    }
  }
  return 결과;
}

function 응답(res, 코드, 종류, 내용, 메서드) {
  res.writeHead(코드, { 'Content-Type': 종류, ...보안헤더 });
  res.end(메서드 === 'HEAD' ? undefined : 내용);
}

function 전체상태(res) {
  try {
    const 설정 = 설정읽기();
    const 방상태 = {};
    for (const 방 of 설정.방) {
      if (방.종류 === 'notice') { // 공고 정보센터 방: 상태 파일 대신 공고 저장소에서 캐릭터 상태를 만들어요
        try { 방상태[방.id] = 공고.방상태(); } catch (e) { 방상태[방.id] = { 에피소드: [], 경고: [`공고 센터 상태를 읽지 못했어요: ${e.message}`] }; }
      } else 방상태[방.id] = 방상태읽기(방);
    }
    응답(res, 200, 형식['.json'], JSON.stringify({ 설정, 방상태, 기획: 기획자?.list() ?? [], 글쓰기: 글쓰기?.list() ?? [], 서버시각: Date.now() }));
  } catch (e) {
    응답(res, 500, 형식['.json'], JSON.stringify({ 오류: `office.config.json을 읽지 못했어요: ${e.message}` }));
  }
}

function 정적파일(경로, res, 메서드) {
  let 상대 = decodeURIComponent(경로);
  if (상대.endsWith('/')) 상대 += 'index.html';
  // /그림/... 은 사무실\그림 폴더에서, 나머지는 public 폴더에서 가져와요
  const 그림주소 = '/그림/';
  const 기준 = 상대.startsWith(그림주소) ? 그림폴더 : 공개폴더;
  if (기준 === 그림폴더) 상대 = 상대.slice(그림주소.length);
  const 파일 = path.normalize(path.join(기준, 상대));
  if (!파일.startsWith(기준 + path.sep)) return 응답(res, 403, 'text/plain; charset=utf-8', '막힌 경로예요.', 메서드);
  fs.readFile(파일, (err, 내용) => {
    if (err) return 응답(res, 404, 'text/plain; charset=utf-8', '없는 파일이에요.', 메서드);
    응답(res, 200, 형식[path.extname(파일).toLowerCase()] || 'application/octet-stream', 내용, 메서드);
  });
}

const 서버 = http.createServer(async (req, res) => {
  try {
    // 다른 사이트가 내 컴퓨터 서버를 몰래 부르는 일을 막아요 (Host 확인)
    const 허용 = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
    if (!허용.includes(req.headers.host)) return 응답(res, 403, 'text/plain; charset=utf-8', '허용되지 않은 주소예요.', req.method);
    const { pathname, searchParams } = new URL(req.url, `http://${HOST}`);
    if (pathname === '/api/writing/file' && req.method === 'GET') {
      try {
        const file = 글쓰기.file(searchParams.get('id'), searchParams.get('name'));
        if (searchParams.get('download') === '1') res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
        return 응답(res, 200, 'text/plain; charset=utf-8', file.content);
      } catch (e) { return 응답(res, e.status || 500, 형식['.json'], JSON.stringify({ 오류: e.status ? e.message : '파일을 읽지 못했어요.' })); }
    }
    if (pathname.startsWith('/api/notice/')) { // 공고 정보센터 API
      if (!공고) return 응답(res, 503, 형식['.json'], JSON.stringify({ 오류: '공고 센터가 아직 준비되지 않았어요.' }), req.method);
      let 입력;
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-office-request'] !== '1') return 응답(res, 403, 형식['.json'], JSON.stringify({ 오류: '사무실 화면에서 작업을 요청해 주세요.' }));
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return 응답(res, 415, 형식['.json'], JSON.stringify({ 오류: '지원하지 않는 입력 형식이에요.' }));
        try { 입력 = await 큰입력읽기(req); } catch (e) { return 응답(res, e.status || 400, 형식['.json'], JSON.stringify({ 오류: e.message })); }
        if (!입력 || typeof 입력 !== 'object' || Array.isArray(입력)) return 응답(res, 400, 형식['.json'], JSON.stringify({ 오류: '입력 형식을 확인해 주세요.' }));
      } else if (req.method !== 'GET') return 응답(res, 405, 'text/plain; charset=utf-8', '지원하지 않는 요청이에요.', req.method);
      const r = await 공고.handle({ method: req.method, pathname, query: searchParams, body: 입력 });
      if (r.원문 !== undefined) return 응답(res, r.status, r.종류, r.원문, req.method);
      return 응답(res, r.status, 형식['.json'], JSON.stringify(r.body));
    }
    const 기획동작 = { '/api/planning/start': 'start', '/api/planning/retry': 'retry', '/api/planning/approve': 'approve', '/api/planning/reject': 'reject' }[pathname];
    const 쓰기동작 = { '/api/writing/start': 'start', '/api/writing/retry': 'retry', '/api/writing/approve': 'approve', '/api/writing/reject': 'reject' }[pathname];
    if ((기획동작 || 쓰기동작) && req.method === 'POST') {
      // 블로그팀은 2026-10-24에 보관(archive/blog-team) 처리했어요. 다시 켜려면 office.config.json의 "블로그팀활성"을 true로 바꿔요.
      if (!기획자 || !글쓰기) return 응답(res, 423, 형식['.json'], JSON.stringify({ 오류: '이 서버는 공고 센터 전용으로 켜져 있어서 블로그팀 기능이 꺼져 있어요.' }));
      if (설정읽기().서버?.블로그팀활성 === false) return 응답(res, 423, 형식['.json'], JSON.stringify({ 오류: '블로그팀은 지금 쉬고 있어요. 다시 켜려면 archive/blog-team/README.md를 봐 주세요.' }));
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-office-request'] !== '1') {
        return 응답(res, 403, 형식['.json'], JSON.stringify({ 오류: '사무실 화면에서 작업을 등록해 주세요.' }));
      }
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        return 응답(res, 415, 형식['.json'], JSON.stringify({ 오류: '지원하지 않는 입력 형식이에요.' }));
      }
      try {
        const 입력 = await 입력읽기(req);
        if (!입력 || typeof 입력 !== 'object' || Array.isArray(입력)) return 응답(res, 400, 형식['.json'], JSON.stringify({ 오류: '입력 형식을 확인해 주세요.' }));
        const 결과 = 쓰기동작 ? 글쓰기[쓰기동작](입력) : 기획자[기획동작](입력);
        return 응답(res, ['start', 'retry'].includes(쓰기동작 || 기획동작) ? 202 : 200, 형식['.json'], JSON.stringify(결과));
      } catch (e) {
        console.error('기획 요청 실패:', e.message);
        return 응답(res, e.status || 500, 형식['.json'], JSON.stringify({ 오류: e.status ? e.message : '기획 자료를 읽거나 저장하지 못했어요. 블로그 자료와 사무실 폴더를 확인해 주세요.' }));
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return 응답(res, 405, 'text/plain; charset=utf-8', '지원하지 않는 요청이에요.', req.method);
    if (pathname === '/api/all') return 전체상태(res);
    return 정적파일(pathname, res, req.method);
  } catch {
    응답(res, 400, 'text/plain; charset=utf-8', '잘못된 요청이에요.', req.method);
  }
});

서버.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`포트 ${PORT}번을 이미 쓰고 있어요. 사무실이 이미 켜져 있거나, office.config.json의 "포트"를 바꿔 보세요.`);
  } else {
    console.error('서버를 열지 못했어요:', e.message);
  }
  process.exit(1);
});

서버.listen(PORT, HOST, () => {
  PORT = 서버.address().port;
  try {
    // OFFICE_NOTICE_ONLY=1 은 시험용: 블로그팀(기획·글쓰기) 기록 폴더를 아예 건드리지 않고 공고 센터만 켜요.
    if (process.env.OFFICE_NOTICE_ONLY !== '1') { 기획자 = createPlanner(루트폴더, 설정읽기); 글쓰기 = createWriter(루트폴더, 설정읽기); }
  } catch (e) { console.error('기획 기록 초기화 실패:', e.message); 서버.close(); process.exitCode = 1; return; }
  try { 공고 = createNoticeApi({ 루트: 루트폴더, 환경: process.env, 인스턴스 }); }
  catch (e) { console.error('공고 센터 초기화 실패:', e.message); 서버.close(); process.exitCode = 1; return; }
  const 주소 = `http://${HOST}:${PORT}`;
  console.log('작가뀨 스튜디오 사무실이 열렸어요.');
  console.log(`  주소: ${주소}  (이 컴퓨터에서만 보여요)`);
  console.log(`  공고 센터: ${공고.방식.모드 === 'mock' ? 'Mock 모드 (실제 AI 호출 없음)' : '실제 모드'} · 데이터 ${공고.방식.구분} · 인스턴스 ${인스턴스.id} · PID ${인스턴스.pid}`);
  console.log('  끄려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.');
  if (process.argv.includes('--open')) exec(`start "" "${주소}"`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { 기획자?.shutdown(); 글쓰기?.shutdown(); 서버.close(() => process.exit(0)); });
// 서버 시작 시각·인스턴스는 whoami로 확인해요 (예전 서버가 켜져 있는지 구분하는 용도)
