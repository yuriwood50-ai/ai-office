'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { 작업만들기 } = require('./tasks');
const usage = require('./usage');
const runner = require('./runner');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const error = (status, message) => Object.assign(new Error(message), { status });
const stamp = () => new Date().toISOString();
function save(p, data) {
  const temp = `${p}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(temp, p); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
const string = { type: 'string' };
const strings = { type: 'array', items: string };
function object(properties) { return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }; }
const schema = object({
  status: { type: 'string', enum: ['ready', 'blocked'] },
  summary: string,
  recommendedIndex: { type: 'integer' },
  candidates: { type: 'array', items: object({ title: string, reason: string, audience: string, searchIntent: string, difference: string, outline: strings }) },
  sources: { type: 'array', items: object({ title: string, url: string, fact: string }) },
  documents: { type: 'array', items: object({ path: string, version: string }) },
  researchNotes: string, warnings: strings,
});

function validate(result) {
  if (!result || !['ready', 'blocked'].includes(result.status)) throw Error('기획 결과 형식이 올바르지 않아요.');
  for (const key of ['summary', 'researchNotes']) if (typeof result[key] !== 'string') throw Error('기획 설명이 빠졌어요.');
  for (const key of ['candidates', 'sources', 'documents', 'warnings']) if (!Array.isArray(result[key])) throw Error('기획 결과 목록이 빠졌어요.');
  if (result.status === 'ready') {
    if (result.candidates.length < 3 || result.candidates.length > 5) throw Error('주제 후보가 3~5개여야 해요.');
    if (!Number.isInteger(result.recommendedIndex) || !result.candidates[result.recommendedIndex]) throw Error('추천 후보를 확인하지 못했어요.');
    if (!result.sources.length || !result.documents.length) throw Error('조사 근거가 빠졌어요.');
  }
  for (const c of result.candidates) {
    for (const k of ['title', 'reason', 'audience', 'searchIntent', 'difference']) if (typeof c[k] !== 'string' || !c[k].trim()) throw Error('후보 설명이 빠졌어요.');
    if (c.title.length > 120 || !Array.isArray(c.outline) || c.outline.length < 2 || c.outline.some(s => typeof s !== 'string' || !s.trim())) throw Error('제목 또는 소제목 형식을 확인해 주세요.');
  }
  for (const s of result.sources) {
    if (typeof s.title !== 'string' || typeof s.fact !== 'string' || typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) throw Error('조사 출처 형식을 확인해 주세요.');
  }
  if (result.warnings.some(s => typeof s !== 'string') || result.documents.some(d => typeof d.path !== 'string' || typeof d.version !== 'string')) throw Error('검토 기록 형식이 올바르지 않아요.');
  return result;
}

function cli() { return runner.codex찾기(); }

function createPlanner(root, getConfig, options = {}) {
  const blog = options.blogRoot || process.env.OFFICE_BLOG_ROOT || path.join(os.homedir(), 'OneDrive', 'Documents', '꿀벌블로그');
  const base = path.join(root, '작업', '기획');
  fs.mkdirSync(base, { recursive: true });
  const active = new Map();
  const jobs = new Map();
  const statePath = (id) => path.join(base, id, 'state.json');
  const persist = (job) => { job.updatedAt = stamp(); save(statePath(job.id), job); jobs.set(job.id, job); };
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    try {
      const job = JSON.parse(read(statePath(entry.name)));
      if (job.id !== entry.name) continue;
      for (const name of fs.readdirSync(stateFolder()).filter(n => /^\d{1,3}\.json$/.test(n))) {
        let episode;
        try { episode = JSON.parse(read(path.join(stateFolder(), name))); } catch { continue; }
        if (episode.기획승인?.id === job.id) {
          job.status = 'approved'; job.approvedAt = episode.기획승인.시각; job.selectedIndex = episode.기획승인.후보; job.episodeFile = name;
          job.message = '기획 승인을 확인했어요. 글쓰기 시작 버튼으로 원고를 작성할 수 있어요.';
        }
      }
      if (job.status === 'running') {
        job.status = 'interrupted'; job.message = '사무실 서버가 다시 시작되어 기획을 중단했어요. 다시 시도할 수 있어요.';
        persist(job);
      }
      jobs.set(job.id, job);
    } catch (e) { console.error('기획 기록 읽기 실패:', entry.name, e.message); }
  }
  function stateFolder() {
    const room = getConfig().방.find(r => r.id === 'blog');
    if (!room) throw error(400, '블로그팀 설정이 없어요.');
    const folder = fs.realpathSync(path.resolve(root, '사무실', room.상태폴더 || '../상태'));
    const rel = path.relative(fs.realpathSync(root), folder);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw error(400, '상태 폴더 설정을 확인해 주세요.');
    return folder;
  }
  function inventory() {
    const states = [];
    const used = new Set(Array.from({ length: 14 }, (_, i) => i + 1));
    const folder = stateFolder();
    for (const file of fs.readdirSync(folder).filter(n => /^\d{1,3}\.json$/i.test(n))) {
      let data;
      try { data = JSON.parse(read(path.join(folder, file))); }
      catch { throw error(409, `${file}을 읽지 못해 다음 편을 정할 수 없어요.`); }
      const n = Number.parseInt(file, 10);
      if (n === 99) continue;
      used.add(n);
      if (Number.isInteger(data.편) && data.편 !== 99) used.add(data.편);
      states.push({ 파일: file, 데이터: data });
    }
    const folders = fs.readdirSync(blog, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    for (const name of folders) {
      const match = /^(\d{1,3})_/.exec(name);
      if (match && Number(match[1]) !== 99) used.add(Number(match[1]));
    }
    const progress = read(path.join(blog, '00_운영문서', 'smartbeetip_진행현황.md'));
    for (const match of progress.matchAll(/^\|\s*(\d{1,3})\s*\|/gm)) if (Number(match[1]) !== 99) used.add(Number(match[1]));
    const topics = read(path.join(blog, '00_운영문서', '꿀팁뿌리는 꿀벌 블로그 주제 목록.md'));
    for (const match of topics.matchAll(/^#{1,3}\s+(\d{1,3})편(?:\s|$)/gm)) if (Number(match[1]) !== 99) used.add(Number(match[1]));
    let next = Math.max(...used) + 1;
    if (next === 99) next++;
    if (next > 999) throw error(409, '사용 가능한 편 번호 범위를 넘었어요.');
    return { next, states, folders, progress, topics };
  }
  // Claude 직원이 읽기만 할 수 있는 곳. 꿀벌블로그는 지침 문서만 열고, 편 폴더는 열지 않아요.
  function 읽기목록() {
    return [path.join(blog, 'AGENTS.md'), path.join(blog, 'N번폴더*'), path.join(blog, '00_운영문서'),
      path.join(root, '직원'), path.join(root, '규칙'), path.join(root, '상태')];
  }
  function context() {
    const info = inventory();
    const files = ['AGENTS.md', 'N번폴더 자동제작 운영 지침 v1.0.md',
      '00_운영문서/꿀팁뿌리는 꿀벌 블로그 주제 목록.md', '00_운영문서/smartbeetip_진행현황.md',
      '00_운영문서/smartbeetip_운영마스터_v1.0.md', '00_운영문서/블로그 콘텐츠 기획·생성 지침 v1.0.md'];
    const docs = files.map(f => {
      const filename = path.join(blog, f); const text = read(filename);
      return { path: filename, sha256: createHash('sha256').update(text).digest('hex'), text };
    });
    return { ...info, docs };
  }
  function get(id) {
    const job = typeof id === 'string' && jobs.get(id);
    if (!job) throw error(404, '기획 기록을 찾지 못했어요.');
    return job;
  }
  function launch(job, ctx) {
    const directory = path.join(base, job.id);
    const attemptDir = path.join(directory, `실행-${job.attempt}`);
    fs.mkdirSync(attemptDir, { recursive: true });
    const output = path.join(attemptDir, 'result.json');
    const schemaPath = path.join(attemptDir, 'schema.json');
    save(schemaPath, schema);
    const cardPath = path.join(root, '직원', '주제기획.md');
    const prompt = `당신은 작가뀨 스튜디오의 주제기획 직원이에요. 사용자는 작가님, 말투는 ~해요 체예요.
현재 업무: 사용자가 주제를 입력하지 않고 새 글 기획을 시작했어요. 기존 콘텐츠와 지침을 검토하고 서로 다른 새 주제 후보 3~5개와 추천 하나를 제안해요.
편 번호 제안은 ${ctx.next}편이에요. 승인 전까지 번호와 주제 모두 제안일 뿐이에요. 주제확정·승인·제작완료로 표시하지 마세요.
도구는 읽기와 웹 검색만 사용해요. 파일 작성, 외부 서비스 변경, 다른 직원 실행, 원고 작성, 이미지 제작은 하지 마세요. 결과 파일은 호출 프로그램이 저장해요.
먼저 직원 카드 파일을 열어 읽고 카드대로 일해요. 읽을 문서는 이 요청에 붙이지 않았어요. 아래 '읽을 파일'을 직접 열어 전문을 읽고 내부 버전을 확인해요. 기존 제목·후보·새 작업과 의미 중복을 검토해요. 보류 후보는 후보로 제안할 수 있어요. 선택은 작가님이 해요.
변경 가능한 기능·요금·정책은 공식 웹 출처를 직접 검색하고 열어 확인해요. 수요·경쟁 수치를 추측하지 마세요. 수요 추론과 실측을 구분하고 미확인 사항은 warnings에 적어요.
후보마다 실제 상황형 제목, 선정 이유, 독자, 검색 의도, 기존 글과의 차이, 소제목을 적어요. 추천 사유와 조사메모, 실제 확인한 공식 URL을 반환해요.
필수 자료 부족이나 지침 충돌로 기획할 수 없으면 status=blocked, summary에 이유, candidates=[]로 반환해요. 허위 성공 보고는 금지예요.
출력은 제공된 JSON 스키마를 따라요. recommendedIndex는 0부터 시작해요.
작가님 선택 요청사항: ${JSON.stringify(job.notes)}
반려 기록: ${JSON.stringify(job.rejections || [])}
이전 제안: ${JSON.stringify(job.result || null)}
직원 카드 파일(현재 실행에서는 위 자동 제안/읽기 전용 반환 규칙을 우선해요): ${cardPath}
카드의 '상태 폴더 NN.json 읽기'는 이번에는 하지 않아요. 아래 목록을 쓰세요.
이미 쓴 편 번호와 주제(15편 이후, 99 시험 제외):
${JSON.stringify(ctx.states.map(s => ({ 편: s.데이터.편 ?? Number.parseInt(s.파일, 10), 주제: s.데이터.주제 })))}
읽을 파일(직접 열어서 전문을 읽어요):
${ctx.docs.map(d => `- ${d.path} (SHA256 ${d.sha256})`).join('\n')}`;
    fs.writeFileSync(path.join(attemptDir, 'prompt.txt'), prompt);
    job.inputDocuments = ctx.docs.map(({ path, sha256 }) => ({ path, sha256 }));
    job.proposedEpisode = ctx.next; job.status = 'running'; job.message = '기획자가 기존 글과 운영 지침을 검토하고 있어요.'; job.startedAt = stamp(); job.error = null;
    persist(job);
    const 설정 = options.worker ? { id: 'topic', AI: 'Codex', 모델: '', 추론강도: '' } : runner.직원설정(getConfig(), 'topic');
    let child;
    try {
      if (options.worker) child = options.worker({ prompt, output, schemaPath, cwd: root });
      else child = runner.실행({ 설정, 웹검색: true, prompt, schemaPath, output, cwd: root, 읽기: 읽기목록() });
    } catch (e) {
      job.status = 'failed'; job.message = '기획자를 실행하지 못했어요.'; job.error = e.message; persist(job);
      usage.기록(root, { 직원: 'topic', 편: job.proposedEpisode, 담당AI: 설정.AI, ...usage.모델정보(설정), 결과: '실패', 실행ID: job.id, 차수: job.attempt, 오류: e.message });
      return job;
    }
    active.set(job.id, child);
    const log = fs.createWriteStream(path.join(attemptDir, 'events.jsonl'));
    const errLog = fs.createWriteStream(path.join(attemptDir, 'stderr.log'));
    let tail = '', lineBuffer = '', lastProgress = 0, ended = false, timedOut = false;
    const meter = usage.계량기(설정.AI), startedMs = Date.now();
    function 사용량남기기(code) {
      const m = meter.끝();
      usage.기록(root, {
        직원: 'topic', 편: job.proposedEpisode, 담당AI: 설정.AI, ...usage.모델정보(설정), ...(m.실제모델 ? { 모델: m.실제모델 } : {}), 환산비용USD: m.환산비용USD,
        결과: job.status === 'failed' ? '실패' : ['interrupted', 'rejected'].includes(job.status) ? '중단' : '성공',
        종료코드: code, 소요초: Math.round((Date.now() - startedMs) / 1000), 웹검색: m.웹검색, 웹열기: m.웹열기, 토큰: m.토큰,
        실행ID: job.id, 차수: job.attempt, 오류: job.status === 'failed' ? job.error : undefined,
      });
    }
    const timer = setTimeout(() => { timedOut = true; terminate(child); }, options.timeoutMs || 15 * 60 * 1000);
    timer.unref();
    function finish(code, spawnError) {
      if (ended) return; ended = true; clearTimeout(timer); active.delete(job.id); log.end(); errLog.end();
      if (job.status !== 'running') { 사용량남기기(code); return; }
      try {
        if (timedOut) throw Error('15분 안에 결과를 받지 못했어요. 다시 시도할 수 있어요.');
        if (spawnError) throw spawnError;
        if (code !== 0) throw Error(friendly(tail, code));
        if (!fs.existsSync(output) || fs.statSync(output).size > 200000) throw Error(!fs.existsSync(output) && /Claude 결과 없음|Claude 출력을/.test(tail) ? friendly(tail, code) + ' ' + tail.slice(-300) : '기획 결과 파일이 없거나 너무 커요.');
        const result = validate(JSON.parse(read(output)));
        job.result = result;
        job.status = result.status === 'ready' ? 'awaiting_approval' : 'blocked';
        job.message = result.status === 'ready' ? '주제를 제안했어요. 후보를 고르고 승인하거나 반려해 주세요.' : result.summary;
        job.finishedAt = stamp(); job.exitCode = code;
      } catch (e) { job.status = 'failed'; job.message = '기획을 완료하지 못했어요.'; job.error = e.message; job.exitCode = code; }
      사용량남기기(code);
      try { persist(job); } catch (e) { console.error('기획 결과 저장 실패:', e.message); }
    }
    child.stdout.on('data', chunk => {
      meter.feed(chunk);
      log.write(chunk); lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n'); lineBuffer = lines.pop().slice(-100000);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'error' || event.type === 'turn.failed') tail = JSON.stringify(event).slice(-3000);
          if (Date.now() - lastProgress < 4000 || job.status !== 'running') continue;
          const type = event.item?.type;
          if (type === 'web_search') job.message = '기획자가 공식 자료를 검색하고 주제를 비교하고 있어요.';
          else if (type === 'agent_message') job.message = '기획자가 조사 내용을 정리하고 있어요.';
          else continue;
          lastProgress = Date.now(); persist(job);
        } catch { /* 로그 한 줄이 불완전해도 최종 결과 검증은 계속해요. */ }
      }
    });
    child.stderr.on('data', chunk => { errLog.write(chunk); tail = (tail + chunk.toString()).slice(-5000); });
    child.on('error', e => finish(null, e));
    for (const stream of [log, errLog]) stream.on('error', e => { finish(null, e); terminate(child); });
    child.on('close', code => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    return job;
  }
  function ensureIdle() { if (active.size) throw error(409, '기획자가 작업 중이에요. 현재 기획 결과를 기다려 주세요.'); }
  function start(input) {
    ensureIdle();
    if ([...jobs.values()].some(j => j.status === 'awaiting_approval')) throw error(409, '승인을 기다리는 기획이 있어요. 먼저 승인하거나 반려해 주세요.');
    if (!input || (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 2000))) throw error(400, '요청사항은 2,000자 이내로 적어 주세요.');
    if (!options.worker) runner.확인(runner.직원설정(getConfig(), 'topic').AI);
    const ctx = context();
    const job = { id: randomUUID(), notes: (input.notes || '').trim(), createdAt: stamp(), attempt: 1, status: 'starting', rejections: [] };
    fs.mkdirSync(path.join(base, job.id));
    return launch(job, ctx);
  }
  function retry(input) {
    ensureIdle(); const job = get(input.id);
    if (!['failed', 'blocked', 'interrupted', 'rejected'].includes(job.status)) throw error(409, '지금은 다시 시작할 수 없는 단계예요.');
    if ([...jobs.values()].some(j => j.id !== job.id && j.status === 'awaiting_approval')) throw error(409, '다른 기획의 승인 여부를 먼저 정해 주세요.');
    if (!options.worker) runner.확인(runner.직원설정(getConfig(), 'topic').AI);
    const ctx = context(); job.attempt++; return launch(job, ctx);
  }
  function reject(input) {
    const job = get(input.id);
    if (job.status !== 'awaiting_approval') throw error(409, '승인 대기 중인 기획만 반려할 수 있어요.');
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) throw error(400, '반려 이유를 1~2,000자로 적어 주세요.');
    job.rejections.push({ at: stamp(), reason: input.reason.trim(), attempt: job.attempt });
    job.status = 'rejected'; job.message = '반려 이유를 저장했어요. 다시 기획하기를 누르면 반영해서 제안해요.'; persist(job); return job;
  }
  function approve(input) {
    const job = get(input.id);
    if (job.status === 'approved') return job;
    if (job.status !== 'awaiting_approval') throw error(409, '기획 결과가 나온 뒤 승인할 수 있어요.');
    if (!Number.isInteger(input.index) || !job.result.candidates[input.index]) throw error(400, '승인할 후보를 선택해 주세요.');
    const inv = inventory();
    if (inv.next !== job.proposedEpisode) {
      job.proposedEpisode = inv.next; persist(job);
      throw error(409, `기존 작업이 바뀌어 ${inv.next}편으로 제안 번호를 갱신했어요. 확인 후 다시 승인해 주세요.`);
    }
    const c = job.result.candidates[input.index];
    if (inv.states.some(s => s.데이터.주제?.replace(/\s+/g, '') === c.title.replace(/\s+/g, ''))) throw error(409, '같은 제목의 작업이 이미 있어요. 반려 후 다른 주제를 제안받아 주세요.');
    // 승인 기록을 먼저 보존하고, 상태 파일을 마지막에 만들어요.
    const folder = path.join(root, '작업', String(job.proposedEpisode).padStart(2, '0'));
    const owner = path.join(folder, '기획연결.json');
    if (fs.existsSync(folder) && (!fs.existsSync(owner) || JSON.parse(read(owner)).id !== job.id)) throw error(409, '같은 편의 작업 폴더가 이미 있어요. 기존 기록을 먼저 확인해 주세요.');
    fs.mkdirSync(folder, { recursive: true }); save(owner, { id: job.id });
    const approvedAt = stamp();
    fs.writeFileSync(path.join(folder, '주제확정서.md'), `# ${job.proposedEpisode}. ${c.title}\n\n- 승인: 작가님이 사무실에서 기획 승인① 버튼을 눌렀어요.\n- 승인 시각: ${approvedAt}\n- 기획 실행: ${job.id} / ${job.attempt}차\n\n## 선정 이유\n${c.reason}\n\n## 독자와 검색 의도\n${c.audience}\n${c.searchIntent}\n\n## 기존 글과의 차이\n${c.difference}\n\n## 소제목\n${c.outline.map(s => `- ${s}`).join('\n')}\n\n## 비교한 후보\n${job.result.candidates.map(s => `- ${s.title}: ${s.reason}`).join('\n')}\n`);
    fs.writeFileSync(path.join(folder, '조사메모.md'), `# 조사메모\n\n${job.result.researchNotes}\n\n## 공식 출처\n${job.result.sources.map(s => `- ${s.title}: ${s.url}\n  ${s.fact}`).join('\n')}\n\n## 문서 버전\n${job.result.documents.map(d => `- ${d.path}: ${d.version}`).join('\n')}\n\n## 미확인·주의사항\n${job.result.warnings.map(s => `- ${s}`).join('\n')}\n`);
    const created = 작업만들기(root, getConfig(), { 방: 'blog', 편: job.proposedEpisode, 주제: c.title, 요청사항: job.notes, 기획승인: { id: job.id, 시각: approvedAt, 후보: input.index } });
    job.status = 'approved'; job.approvedAt = approvedAt; job.selectedIndex = input.index; job.episodeFile = created.파일;
    job.message = '기획을 승인하고 주제확정서와 조사메모를 저장했어요. 글쓰기 시작 버튼을 눌러 주세요.';
    persist(job); return job;
  }
  function list() { return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30); }
  function shutdown() {
    for (const [id, child] of active) {
      const job = get(id); job.status = 'interrupted'; job.message = '서버 종료로 기획이 중단됐어요. 다시 시도할 수 있어요.';
      try { persist(job); } catch {} terminate(child);
    }
    active.clear();
  }
  return { start, retry, reject, approve, list, shutdown };
}
function terminate(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  else child.kill('SIGTERM');
}
function friendly(text, code) {
  if (/usage.limit|session.limit|hit your .{0,20}limit|quota|rate.limit|limit.reached|insufficient_quota/i.test(text)) return 'AI 사용 한도에 도달했어요. 한도가 회복된 뒤 다시 시도해 주세요.';
  if (/unauthorized|not.logged|login|authentication|401/i.test(text)) return 'Codex/Claude 로그인을 확인해 주세요.';
  if (/network|connection|timed.out|fetch|stream disconnected/i.test(text)) return 'AI 연결이 끊겼어요. 네트워크를 확인하고 다시 시도해 주세요.';
  return `AI 실행이 종료됐어요(종료 코드 ${code}). 실행 폴더의 stderr.log에서 원인을 확인할 수 있어요.`;
}
module.exports = { createPlanner, validate, cli, terminate, friendly, save };

