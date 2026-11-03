'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');
const { createHash } = require('node:crypto');
const { 한국날짜 } = require('./deadline');
const 실패 = (message, kind = 'extract') => Object.assign(new Error(message), { kind });
const 해제 = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '');
function 글(s) { return 해제(String(s).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim(); }
function 본문읽기(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  const cut = /\bid=["']cms-content["'][^>]*>/i.exec(html);
  const candidate = cut ? html.slice(cut.index + cut[0].length).split(/<!--\s*콘텐츠|<footer\b|<div[^>]+class=["'][^"']*sub-page-bottom/i)[0] : /<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i.exec(html)?.[1];
  if (!candidate) throw 실패('공고 본문 영역을 특정하지 못했어요. 전용 수집기 연결이 필요해요.');
  return candidate;
}
function 링크들(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a\s*>/gi)) {
    const a = /\bhref\s*=\s*(["'])([\s\S]*?)\1/i.exec(m[1]); if (!a) continue;
    try { const u = new URL(해제(a[2]), base); if (u.protocol !== 'https:' || u.username || u.password) continue; out.push({ 제목: 글(m[2]), 링크: u.href, 태그: m[0] }); } catch { /* 실행형 링크는 실행하지 않아요 */ }
  }
  return out;
}
function 목록읽기(html, base) {
  const items = [], seen = new Set(); let headers = [];
  for (const row of html.matchAll(/<(tr|item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const body = row[2], plain = 글(body);
    if (/<th\b/i.test(body)) { headers = [...body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => 글(m[1])); continue; }
    const cells = [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => 글(m[1]));
    const deadlineCell = headers.findIndex(x => /마감일|접수마감/.test(x));
    const dates = [...plain.matchAll(/(20\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/g)].map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
    const links = 링크들(body, base).filter(x => x.제목.length >= 5 && !/다운로드|첨부파일|바로가기|이전|다음/.test(x.제목));
    // 날짜가 없는 메뉴·서식 행은 공고로 만들지 않아요.
    if (!dates.length) continue;
    for (const x of links) {
      if (new URL(x.링크).hostname !== new URL(base).hostname || seen.has(x.링크)) continue;
      seen.add(x.링크); items.push({ 제목: x.제목, 링크: x.링크, 게시일: dates[0], 목록근거: plain, 마감원문: deadlineCell >= 0 ? cells[deadlineCell] || '' : '' });
    }
  }
  return items;
}
function publicIP(ip) {
  if (net.isIPv4(ip)) { const a = ip.split('.').map(Number); return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 || a[0] === 169 && a[1] === 254 || a[0] === 172 && a[1] >= 16 && a[1] <= 31 || a[0] === 192 && a[1] === 168 || a[0] === 100 && a[1] >= 64 && a[1] <= 127); }
  // IPv4로 내장된 주소와 로컬 IPv6를 포함해 글로벌 유니캐스트만 허용해요.
  return net.isIPv6(ip) && /^[23]/.test(ip) && !ip.includes('.');
}
async function 주소검사(url, hosts) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.port && u.port !== '443' || u.username || u.password || !hosts.has(u.hostname)) throw 실패('등록한 공식 HTTPS 호스트만 읽을 수 있어요.', 'blocked');
  const ips = await dns.lookup(u.hostname, { all: true });
  if (!ips.length || ips.some(x => !publicIP(x.address))) throw 실패('공개 기관 주소만 읽을 수 있어요.', 'blocked');
  return u;
}
async function 기본요청(url, hosts, 최대 = 4 * 1024 * 1024) {
  await 주소검사(url, hosts);
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'WriterKkyuNotice/1.0 (public notices; read-only)' } });
  if (r.status >= 300 && r.status < 400) { await r.body?.cancel(); throw 실패('다른 주소로 이동하는 페이지예요. 공식 게시판 주소를 갱신해 주세요.', 'redirect'); }
  if (!r.ok) { await r.body?.cancel(); throw Object.assign(실패(`HTTP ${r.status}`, 'http'), { http: r.status }); }
  const chunks = []; let size = 0;
  for await (const part of r.body) { size += part.length; if (size > 최대) { await r.body?.cancel().catch(() => {}); throw 실패('자료가 읽기 크기 상한을 넘었어요.', 'length'); } chunks.push(part); }
  const bytes = Buffer.concat(chunks), type = r.headers.get('content-type') || '';
  const encoding = /(?:euc-kr|ks_c_5601)/i.test(type + bytes.subarray(0, 1000).toString()) ? 'euc-kr' : 'utf-8';
  return { bytes, text: new TextDecoder(encoding).decode(bytes), http: r.status, type };
}
function robots허용(text, url) {
  let applicable = false; const rules = []; let grouped = false;
  for (let line of text.split(/\r?\n/)) {
    line = line.split('#')[0].trim(); const m = /^([^:]+):\s*(.*)$/.exec(line); if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') { if (grouped) { applicable = false; grouped = false; } applicable ||= val === '*' || /writerkkyunotice/i.test(val); }
    else if (['allow', 'disallow'].includes(key)) { grouped = true; if (applicable && val) rules.push({ allow: key === 'allow', path: val }); }
  }
  const target = new URL(url).pathname + new URL(url).search;
  const matched = rules.filter(r => { const pattern = r.path.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$'); return new RegExp('^' + pattern).test(target); }).sort((a,b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return !matched.length || matched[0].allow;
}
function createWebFetcher({ request = 기본요청, delay = 1000, 중지 = () => false, 진행 = () => {}, 첨부읽기 } = {}) {
  const robots = new Map(); let last = 0;
  async function read(url, hosts) {
    if (중지()) throw 실패('작가님이 중지했어요.', 'stopped');
    const wait = Math.max(0, delay - (Date.now() - last)); if (wait) await new Promise(r => setTimeout(r, wait)); last = Date.now();
    const origin = new URL(url).origin;
    if (!robots.has(origin)) {
      try { robots.set(origin, (await request(origin + '/robots.txt', hosts)).text); }
      catch(e) { if (e.http === 404) robots.set(origin, ''); else throw 실패('robots.txt를 확인하지 못해서 수집을 보류했어요.', 'robots'); }
    }
    if (!robots허용(robots.get(origin), url)) throw 실패('기관의 robots.txt에서 수집을 허용하지 않아요.', 'robots');
    return request(url, hosts);
  }
  return { async fetchBoard(기관, 판, { 지금 }) {
    const hosts = new Set(기관.게시판.map(b => new URL(b.주소).hostname));
    const items = [], seen = new Set(), pages = new Set(); let next = 판.주소; let complete = false; const errors = [];
    const cutoff = 한국날짜(new Date(지금.getTime() - 30 * 86400e3));
    while (next && !pages.has(next)) {
      pages.add(next); 진행({ 기관: 기관.이름, 주소: next, 페이지: pages.size, 공고수: items.length });
      const r = await read(next, hosts);
      if (/captcha|access denied|비정상적인 접근|자동입력 방지/i.test(r.text)) throw 실패('차단 또는 인증 페이지예요.', 'blocked');
      if (판.종류 === '사업 안내') {
        let main = 본문읽기(r.text);
        const frame = /<iframe\b[^>]*src=["']([^"']+)["']/i.exec(main);
        if (frame) {
          const frameUrl = new URL(frame[1], next).href;
          const embedded = await read(frameUrl, hosts);
          main = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(embedded.text)?.[1] || '';
          if (/iframe/i.test(main)) throw 실패('중첩된 안내 자료는 직접 확인이 필요해요.');
        }
        main = main.replace(/<!--[\s\S]*?-->/g, '');
        const body = 글(main);
        if (body.length < 50) throw 실패('사업 안내 본문을 읽지 못했어요.');
        return { http: r.http, items: [{ 제목: 기관.이름, 링크: next, 게시일: null, 본문: body, 공식확인: true, 확인시각: new Date().toISOString(), 정보유형: /공급계획/.test(기관.이름) ? '공급계획' : '사업계획·진행', 첨부확인: /첨부|다운로드|iframe/i.test(main) ? '미확인' : '없음' }], 범위: { 단일안내페이지: true }, 부분확인: /iframe/i.test(main), 추출오류: /iframe/i.test(main) ? '안내 본문은 확인했지만 별도 삽입 자료는 미확인이에요.' : null };
      }
      const found = 목록읽기(r.text, next);
      if (!found.length) return { http: r.http, items: items.length ? items : null, 부분확인: true, 추출오류: '날짜와 상세 링크가 있는 게시물을 읽지 못했어요. 동적 게시판 또는 전용 수집기 연결이 필요해요.' };
      for (const item of found) {
        if (seen.has(item.링크)) continue; seen.add(item.링크);
        // 30일보다 오래된 글도 목록 근거를 보존해요. 진행 중인 장기 공고를 날짜만으로 버리지 않아요.
        try {
          const detail = await read(item.링크, hosts);
          const main = 본문읽기(detail.text);
          const body = 글(main); if (body.length < 50 || !body.replace(/\s/g,'').includes(item.제목.replace(/\s/g,''))) throw 실패('공고 제목과 상세 본문이 일치하지 않아요.');
          item.본문 = body; item.공식확인 = true; item.확인시각 = new Date().toISOString();
          item.첨부 = [];
          for (const a of 링크들(main, item.링크).filter(a => /\.(pdf|hwpx?|docx?)(?:\?|$)|download|fileDown/i.test(a.링크 + ' ' + a.제목))) {
            const att = { 이름: a.제목, 링크: a.링크, 상태: '미확인' };
            try {
              if (!hosts.has(new URL(a.링크).hostname)) throw 실패('등록한 공식 호스트 밖의 첨부예요.');
              const data = await read(a.링크, hosts);
              if (!첨부읽기) throw 실패('첨부 해석기가 준비되지 않았어요.');
              att.본문 = await 첨부읽기(data.bytes, a.제목 + ' ' + a.링크); att.상태 = '확인';
              att.해시 = createHash('sha256').update(data.bytes).digest('hex');
            } catch(e) { att.오류 = e.message; }
            item.첨부.push(att);
          }
          item.첨부확인 = item.첨부.length ? item.첨부.every(a => a.상태 === '확인') ? '확인' : '미확인' : /첨부|붙임/.test(body) ? '미확인' : '없음';
        } catch(e) { item.본문 = ''; item.공식확인 = false; item.원문오류 = e.message; errors.push(item.제목); }
        items.push(item);
      }
      const pagination = 링크들(r.text, next).find(a => /^(다음|다음\s*페이지|Next|›|>)$/i.test(a.제목) && new URL(a.링크).hostname === new URL(판.주소).hostname && !pages.has(a.링크));
      if (found.every(x => x.게시일 < cutoff)) { complete = true; break; }
      if (!pagination) { complete = /(?:1\s*\/\s*1\s*페이지|총\s*1\s*페이지|마지막\s*페이지)/.test(글(r.text)); break; }
      next = pagination.링크;
    }
    return { http: 200, items, 부분확인: !complete || errors.length > 0, 범위: { 최근30일: complete, 페이지수: pages.size, 원문실패: errors.length }, 추출오류: !complete ? '최근 30일 전체 페이지 확인을 완료하지 못했어요.' : errors.length ? '일부 공고 원문을 확인하지 못했어요.' : null };
  } };
}
module.exports = { createWebFetcher, 목록읽기, 링크들, 글, 본문읽기, publicIP, robots허용, 기본요청 };
