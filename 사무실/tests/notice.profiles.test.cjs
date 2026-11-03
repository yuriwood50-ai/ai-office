'use strict';
const trip = require('./helpers/tripwire.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createNoticeApi } = require('../notice/routes');
const { createWebFetcher, 목록읽기, 본문읽기, 글, robots허용 } = require('../notice/webfetcher');
const { 마감읽기, 마감상태 } = require('../notice/deadline');
const { 주택분류 } = require('../notice/housing');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(root, '시험/tmp/profiles-'));
const api = createNoticeApi({ 루트: root, 환경: { OFFICE_DATA_DIR: dir, OFFICE_MODE: 'mock' }, 인스턴스: { id: 'test', pid: 0, 포트: () => 0 } });
async function request(profile, route, body) { return api.handle({ method: body === undefined ? 'GET' : 'POST', pathname: '/api/notice/' + route, query: new URLSearchParams({ 종류: profile }), body }); }
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
  await test('검색 3종 지침·키워드가 연결되고 플랫폼시티가 주택 메인이에요', async () => {
    for (const id of ['instructor', 'startup', 'housing']) { const r = await request(id, 'instructions'); assert.equal(r.status, 200); assert.ok(r.body.원문.length > 500); assert.ok(r.body.프로필.키워드.length > 5); }
    assert.equal((await request('housing','overview')).body.프로필.메인, '용인 플랫폼시티');
  });
  await test('세 분야 기록이 분리되고 주택에 강사 인천 제외가 섞이지 않아요', async () => {
    const n = await request('housing', 'notices', { 기관명:'LH', 지역:'인천', 공고명:'플랫폼시티 공급계획', 공식링크:'https://lh.example.invalid/a', 본문:'대상: 무주택자', 마감원문:'상시' });
    assert.equal(n.status,200); assert.equal((await request('instructor','list')).body.합계,0); assert.equal((await request('startup','list')).body.합계,0);
    const h = (await request('housing','overview')).body; assert.equal(h.합계.전체,1); assert.equal(h.주택그룹[0].합계,1); assert.equal(h.지원가능.length,0);
    const detail = (await request('housing','notices/'+n.body.공고.id)).body; assert.equal(detail.적합도.출처, '사실확인만');
    assert.equal((await request('housing','notices/'+detail.id+'/judgment',{ 판정:'적합', 이유:'시험' })).status,400);
  });
  await test('낯선 검색 종류와 경로로 다른 폴더에 접근하지 못해요', async () => { assert.equal((await request('../', 'list')).status,400); });
  await test('플랫폼시티·용인·그 밖의 공고와 사전안내·모집을 구분해요', () => {
    assert.equal(주택분류({공고명:'플랫폼 시티 사전청약 안내'}).정보유형, '사전안내');
    assert.equal(주택분류({공고명:'플랫폼시티 공급계획'}).순서,0);
    assert.equal(주택분류({공고명:'용인 입주자 모집'}).순서,1);
    assert.equal(주택분류({공고명:'수원 입주자 모집'}).순서,2);
  });
  await test('24:00는 다음 날짜 00:00로 바뀌고 잘못된 시각은 확정하지 않아요', () => {
    const d = 마감읽기('2026.10.24 24:00'); assert.equal(d.날짜,'2026-10-25'); assert.equal(d.시각,'00:00');
    assert.equal(마감상태(d, new Date('2026-10-24T14:59:00Z')).마감지남,false);
    assert.equal(마감읽기('2026.10.24 26:00').마감판정,'불확실');
  });
  await test('목록의 수정일을 마감일로 잘못 쓰지 않아요', () => {
    const html='<table><tr><th>제목</th><th>게시일</th><th>수정일</th></tr><tr><td><a href="/view?id=1">공식 모집 공고</a></td><td>2026-10-20</td><td>2026-10-24</td></tr></table>';
    assert.equal(목록읽기(html,'https://official.example.invalid/list')[0].마감원문,'');
    assert.equal(목록읽기(html.replace('수정일','마감일'),'https://official.example.invalid/list')[0].마감원문,'2026-10-24');
  });
  await test('공식 페이지 주석 안의 오래된 자료를 본문으로 읽지 않아요', () => {
    const html='<nav>메뉴</nav><main>현재 정보<!-- 옛 다른 도시 계획 --> 여기까지</main>';
    assert.equal(글(본문읽기(html)),'현재 정보 여기까지');
  });
  await test('robots 수집 금지를 존중하고 빈 금지는 허용해요', () => {
    assert.equal(robots허용('User-agent: *\nDisallow: /','https://example.invalid/a'), false);
    assert.equal(robots허용('User-agent: *\nDisallow:','https://example.invalid/a'), true);
    assert.equal(robots허용('User-agent: *\nDisallow: /private\nAllow: /private/public','https://example.invalid/private/public'), true);
  });
  await test('실제 수집기 경로도 가짜 요청으로 시험하고 30일 미완료를 표시해요', async () => {
    const request = async url => ({http:200, text: url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow:' : url.endsWith('/list') ? '<table><tr><td><a href="/view">플랫폼시티 실제 모집</a></td><td>2026-10-24</td></tr></table>' : '<main><h1>플랫폼시티 실제 모집</h1>'+ '확인한 본문 정보 '.repeat(20) + '</main>'});
    const fetcher = createWebFetcher({request, delay:0}); const org={이름:'공식기관',게시판:[{주소:'https://official.example.invalid/list'}]};
    const r=await fetcher.fetchBoard(org,org.게시판[0],{지금:new Date('2026-10-24T03:00:00Z')});
    assert.equal(r.items.length,1); assert.equal(r.items[0].공식확인,true); assert.equal(r.부분확인,true); assert.equal(r.범위.최근30일,false);
  });
  await test('운영 모드를 상속한 주택도 mock 자료로 바뀌지 않아요', async () => {
    const realDir=path.join(dir,'real'); fs.mkdirSync(realDir); fs.writeFileSync(path.join(realDir,'settings.json'),JSON.stringify({모드:'real'}));
    const real=createNoticeApi({루트:root,환경:{OFFICE_DATA_DIR:realDir,OFFICE_MODE:'real',OFFICE_ALLOW_REAL:'1',OFFICE_DISABLE_AI:'1'},인스턴스:{id:'test',포트:()=>0}});
    const r=await real.handle({method:'GET',pathname:'/api/notice/overview',query:new URLSearchParams({종류:'housing'})}); assert.equal(r.body.모드,'real');
  });
  assert.equal(trip.걸린기록.length,0); console.log(`${passed}/${passed} 통과 · 외부 AI/네트워크 호출 0회`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{api.종료();});
