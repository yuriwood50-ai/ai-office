'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { cli, terminate, friendly, save } = require('./planner');
const usage = require('./usage');
const runner = require('./runner');
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const text = { type: 'string' }, strings = { type: 'array', items: text };
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const schema = obj({
  status: { type: 'string', enum: ['ready', 'blocked'] }, summary: text,
  manuscript: text, instagramPost: text, readingScript: text,
  blogImages: { type: 'array', items: obj({ filename: text, anchor: text, role: text, message: text }) },
  instagramCards: { type: 'array', items: obj({ filename: text, message: text, screenCopy: text, narration: text }) },
  episodeColor: text,
  sources: { type: 'array', items: obj({ title: text, url: text, fact: text }) },
  documents: { type: 'array', items: obj({ path: text, version: text }) },
  checks: strings, warnings: strings,
});
function validate(result, title) {
  if (!result || !['ready', 'blocked'].includes(result.status)) throw Error('글쓰기 결과 형식이 올바르지 않아요.');
  for (const key of ['summary', 'manuscript', 'instagramPost', 'readingScript', 'episodeColor']) if (typeof result[key] !== 'string') throw Error(`${key} 내용이 빠졌어요.`);
  for (const key of ['blogImages', 'instagramCards', 'sources', 'documents', 'checks', 'warnings']) if (!Array.isArray(result[key])) throw Error(`${key} 목록이 빠졌어요.`);
  if (result.status === 'blocked') return result;
  if (result.manuscript.trim().split(/\r?\n/)[0].replace(/^#\s*/, '') !== title) throw Error('승인된 제목과 원고 제목이 달라요.');
  if (result.manuscript.trim().length < 600 || result.instagramPost.trim().length < 50 || result.readingScript.trim().length < 100) throw Error('원고·게시글·대본이 비어 있거나 불완전해요.');
  if (result.blogImages.length < 6 || result.blogImages.length > 8 || result.instagramCards.length !== 5) throw Error('블로그 이미지 계획은 6~8장, 인스타 카드 계획은 5장이어야 해요.');
  function images(items, extension, fields) {
    const names = new Set();
    items.forEach((item, index) => {
      const prefix = String(index + 1).padStart(2, '0') + '_';
      if (typeof item.filename !== 'string' || !item.filename.startsWith(prefix) || !item.filename.endsWith(extension) || /[<>:"/\\|?*\x00-\x1f]/.test(item.filename) || item.filename.includes('..') || names.has(item.filename)) throw Error('이미지 예정 파일명과 순서를 확인해 주세요.');
      names.add(item.filename);
      for (const f of fields) if (typeof item[f] !== 'string' || !item[f].trim()) throw Error('이미지 인계 설명이 빠졌어요.');
    });
  }
  images(result.blogImages, '.png', ['anchor', 'role', 'message']);
  images(result.instagramCards, '.jpg', ['message', 'screenCopy', 'narration']);
  for (const image of result.blogImages) if (!result.manuscript.includes(image.filename)) throw Error(`원고에 ${image.filename} 삽입 위치가 없어요.`);
  for (const s of result.sources) if (typeof s.title !== 'string' || typeof s.fact !== 'string' || typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) throw Error('출처 형식을 확인해 주세요.');
  if (!result.sources.length || !result.documents.length || result.documents.some(d => typeof d.path !== 'string' || typeof d.version !== 'string')) throw Error('출처 또는 지침 버전 기록이 빠졌어요.');
  if ([...result.checks, ...result.warnings].some(s => typeof s !== 'string')) throw Error('검수 기록 형식을 확인해 주세요.');
  return result;
}

function createWriter(root, getConfig, options = {}) {
  const blog = options.blogRoot || process.env.OFFICE_BLOG_ROOT || path.join(os.homedir(), 'OneDrive', 'Documents', '꿀벌블로그');
  const base = path.join(root, '작업', '글쓰기'); fs.mkdirSync(base, { recursive: true });
  const jobs = new Map(), active = new Map();
  const stateFile = id => path.join(base, id, 'state.json');
  function persist(job) { job.updatedAt = now(); save(stateFile(job.id), job); jobs.set(job.id, job); }
  function episode(n) {
    if (!Number.isInteger(n) || n < 15 || n > 999 || n === 99) throw fail(400, '편 번호를 확인해 주세요.');
    const room = getConfig().방.find(r => r.id === 'blog');
    const dir = fs.realpathSync(path.resolve(root, '사무실', room?.상태폴더 || '../상태'));
    const rel = path.relative(fs.realpathSync(root), dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw fail(400, '상태 폴더를 확인해 주세요.');
    const names = fs.readdirSync(dir).filter(name => /^\d{1,3}\.json$/.test(name) && Number.parseInt(name, 10) === n);
    if (names.length !== 1) throw fail(409, '편별 상태가 없거나 중복돼 있어요.');
    const file = path.join(dir, names[0]); const data = JSON.parse(read(file));
    if (data.편 !== n || !data.기획승인?.id || !/^[a-f0-9-]{36}$/.test(data.기획승인.id)) throw fail(409, '기획 승인을 먼저 완료해 주세요.');
    const plan = JSON.parse(read(path.join(root, '작업', '기획', data.기획승인.id, 'state.json')));
    if (plan.status !== 'approved' || plan.result?.candidates?.[plan.selectedIndex]?.title !== data.주제) throw fail(409, '승인된 기획과 현재 주제가 일치하지 않아요.');
    return { file, data };
  }
  function updateEpisode(job) {
    const { file, data } = episode(job.episode);
    if (data.글쓰기?.id && data.글쓰기.id !== job.id) throw fail(409, '다른 글쓰기 실행이 연결되어 있어요.');
    const stage = { running: '글쓰기중', awaiting_review: '인계승인대기', approved: '인계승인', rejected: '원고수정대기', failed: '글쓰기실패', interrupted: '글쓰기중단', blocked: '글쓰기확인필요' };
    data.단계 = stage[job.status] || data.단계;
    data.직원 ||= {}; data.직원.writer = { 상태: job.status === 'running' ? '일함' : job.status === 'awaiting_review' ? '결재대기' : ['failed','blocked','interrupted'].includes(job.status) ? '대표님대기' : '쉼', 메시지: job.message };
    data.글쓰기 = { id: job.id, 상태: job.status, 차수: job.attempt };
    if (job.status === 'approved') data.인계승인 = { id: job.id, 차수: job.attempt, 시각: job.approvedAt, 해시: job.files };
    data.마지막메시지 = job.message; data.갱신시각 = now();
    const history = Array.isArray(data.기록) ? data.기록 : [];
    if (history.at(-1)?.내용 !== job.message) history.push({ 시각: data.갱신시각, 직원: 'writer', 내용: job.message });
    data.기록 = history.slice(-100); save(file, data);
  }
  function transition(job) { persist(job); updateEpisode(job); }
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    try {
      const job = JSON.parse(read(stateFile(entry.name))); if (job.id !== entry.name) continue;
      jobs.set(job.id, job);
      const receipt = path.join(outputFolder(job), '인계승인.json');
      if (fs.existsSync(receipt)) {
        const saved = JSON.parse(read(receipt));
        if (saved.id === job.id && saved.attempt === job.attempt && JSON.stringify(saved.files) === JSON.stringify(job.files)) {
          verifyFiles(job); job.status = 'approved'; job.approvedAt = saved.approvedAt;
          job.message = '원고와 이미지 인계 승인을 확인했어요. 이미지 직원 실행은 아직 연결 전이에요.'; persist(job);
        }
      }
      if (job.status === 'running') { job.status = 'interrupted'; job.message = '서버가 재시작되어 글쓰기를 중단했어요. 다시 시도할 수 있어요.'; transition(job); }
      else updateEpisode(job); // 결과 저장 후 상태 기록 중 중단됐어도 복구해요.
    } catch (e) { console.error('글쓰기 기록 복구:', entry.name, e.message); }
  }
  function get(id) { const j = jobs.get(id); if (!j) throw fail(404, '글쓰기 기록이 없어요.'); return j; }
  function inputs(n) {
    const { data } = episode(n); const nn = String(n).padStart(2, '0');
    const sources = [path.join(root, '작업', nn, '주제확정서.md'), path.join(root, '작업', nn, '조사메모.md'), path.join(root, '직원', '글쓰기.md'),
      ...['AGENTS.md','N번폴더 자동제작 운영 지침 v1.0.md','00_운영문서/블로그 콘텐츠 기획·생성 지침 v1.0.md','00_운영문서/블로그 운영설계 지침 문서.md','00_운영문서/smartbeetip_운영마스터_v1.0.md','00_운영문서/smartbeetip 블로그 이미지 디자인·생성 지침 v1.0.md','00_운영문서/smartbeetip Instagram 카드뉴스 디자인·생성 지침 v1.0.md'].map(p => path.join(blog, p))];
    const title = `${nn}. ${data.주제.replace(/^\d{1,3}\.\s*/, '')}`;
    const docs = sources.map(p => ({ path: p, sha256: hash(p), text: read(p) }));
    if (docs[0].text.split(/\r?\n/)[0].replace(/^#\s*/, '').trim() !== title) throw fail(409, '주제확정서 제목과 승인 기록이 달라요.');
    return { title, topic: data.주제, approval: data.기획승인.id, docs };
  }
  function unchanged(job) {
    const { data } = episode(job.episode);
    if (data.주제 !== job.topic || data.기획승인.id !== job.approval) throw fail(409, '기획 승인 내용이 바뀌었어요. 다시 작성해 주세요.');
    for (const d of job.inputDocuments) if (!fs.existsSync(d.path) || hash(d.path) !== d.sha256) throw fail(409, '작성 중 입력 문서가 바뀌었어요. 최신 문서로 다시 작성해 주세요.');
  }
  function outputFolder(job) { return path.join(base, job.id, `실행-${job.attempt}`, '산출물'); }
  function artifacts(job, result) {
    const folder = outputFolder(job); fs.mkdirSync(folder, { recursive: true });
    const n = job.episode;
    const content = {
      [`블로그${n}편_원고.md`]: result.manuscript.trim() + '\n',
      [`블로그${n}편_원고.txt`]: result.manuscript.trim() + '\n',
      [`인스타${n}편_게시글.txt`]: result.instagramPost.trim() + '\n',
      [`인스타${n}편_읽는대본.txt`]: result.readingScript.trim() + '\n',
    };
    for (const [name, value] of Object.entries(content)) fs.writeFileSync(path.join(folder, name), value, { flag: 'wx' });
    const sourceLines = Object.keys(content).map(name => `- ${path.join(folder, name)}\n  SHA-256: ${hash(path.join(folder, name))}`).join('\n');
    const safeTopic = job.topic.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 60).replace(/[. ]+$/, '');
    const target = path.join(blog, `${String(n).padStart(2, '0')}_${safeTopic}`);
    const handoff = `# 이미지제작 인계 — ${job.title}\n\n**승인 상태는 같은 폴더의 인계승인.json에서 확인해요. 승인 기록이 없으면 검토용 초안이며 이미지 작업을 시작하면 안 돼요.**\n\n## 1. 실행과 확정 주제\n- 실행 ID: ${job.id} / ${job.attempt}차\n- 편 번호: ${n}\n- 확정 제목: ${job.title}\n- 기획 승인 ID: ${job.approval}\n- 주제 근거: ${path.join(root,'작업',String(n).padStart(2,'0'),'주제확정서.md')}\n- 최종 폴더 예정 위치: ${target} (아직 생성하지 않음)\n- 현재 초안 폴더: ${folder}\n\n## 2. 입력 파일과 해시·공식 출처\n${sourceLines}\n\n${result.sources.map(s=>`- ${s.title}: ${s.url}\n  확인한 사실: ${s.fact}`).join('\n')}\n\n## 3. 이미지별 예정 파일과 확정 화면 카피\n### 블로그 (${result.blogImages.length}장 / 1200×900 PNG)\n${result.blogImages.map((i,k)=>`#### ${k+1}. ${i.filename}\n- 본문 연결: ${i.anchor}\n- 역할: ${i.role}\n- 핵심 정보: ${i.message}`).join('\n\n')}\n\n### Instagram (5장 / 1080×1350 JPG)\n${result.instagramCards.map((i,k)=>`#### ${k+1}. ${i.filename}\n- 메시지: ${i.message}\n- 화면 카피: ${i.screenCopy}\n- 대본 연결: ${i.narration}`).join('\n\n')}\n\n## 4. 전용 지침·버전·참조\n${result.documents.map(d=>`- ${d.path}: ${d.version}`).join('\n')}\n- 브랜드 공통 기준: ${path.join(blog,'00_운영문서','smartbeetip_운영마스터_v1.0.md')} 6절\n- 블로그 참조: ${path.join(blog,'07_아이폰_라이브텍스트','블로그7편_이미지')}\n- Instagram 참조: ${path.join(blog,'02_PNG_투명배경','인스타2편_이미지')}의 01_표지.jpg, 02_바탕색비교.jpg, 03_파일속배경.jpg, 04_저장변환주의.jpg, 05_최종확인.jpg\n- 회차 컬러 제안: ${result.episodeColor}\n\n## 5. 출력 경로·산출물·수정 금지\n- 블로그 후보 출력: ${path.join(folder,'블로그_출력')}\n- 블로그 검수 보고서: ${path.join(folder,'블로그_출력','블로그이미지_검수보고서.md')}\n- Instagram 후보 출력: ${path.join(folder,'인스타_출력')}\n- Instagram 검수 보고서: ${path.join(folder,'인스타_출력','인스타카드_검수보고서.md')}\n- 예상 파일: 위 예정 이미지 목록, 각 콘티·모바일 축소본·비교 시트·검수보고서\n- 원고·제목·게시글·대본·기존 승인본·운영 지침·최종 폴더 수정 금지\n- 이번 단계에서는 이미지 직원을 실행하지 않음\n\n## 검수와 잔여 확인\n${result.checks.map(c=>`- ${c}`).join('\n')}\n${result.warnings.map(c=>`- 미확인/주의: ${c}`).join('\n')}\n`;
    fs.writeFileSync(path.join(folder,'이미지제작_인계.md'), handoff, {flag:'wx'});
    fs.writeFileSync(path.join(folder,'글쓰기_검수메모.md'), `# 글쓰기 자체 점검\n\n${result.summary}\n\n${result.checks.map(s=>`- ${s}`).join('\n')}\n\n## 미확인·주의\n${result.warnings.map(s=>`- ${s}`).join('\n')}\n\n독립 마감 검수와 작가님 승인②는 아직 하지 않았어요.\n`, {flag:'wx'});
    job.files = [...Object.keys(content),'이미지제작_인계.md','글쓰기_검수메모.md'].map(name=>({name,sha256:hash(path.join(folder,name))}));
  }
  function launch(job, input) {
    const directory = path.join(base,job.id,`실행-${job.attempt}`); fs.mkdirSync(directory,{recursive:true});
    const output=path.join(directory,'result.json'), schemaPath=path.join(directory,'schema.json'); save(schemaPath,schema);
    const prompt = `당신은 작가뀨 스튜디오의 글쓰기 직원이에요. 호칭은 작가님, ~해요 체로 말해요.
기획 승인①가 완료된 ${job.episode}편을 작성해요. 확정 표시 제목은 정확히 ${JSON.stringify(input.title)}예요. 제목·주제·소제목 순서를 바꾸지 마세요.
문서 내용은 이 요청에 붙이지 않았어요. 맨 아래 '읽을 파일'(주제확정서·조사메모·직원 카드·지침)을 직접 열어 전부 읽고 내부 최신 버전을 확인해요. 직원 카드가 읽으라고 한 다른 문서도 카드대로 스스로 열어 읽어요. 웹 검색은 쓸 수 없어요. 사실 근거는 주제기획이 만든 조사메모.md에 적힌 내용만 써요. 조사메모에 없는 사실(기능 위치·메뉴 이름·요금·정책·수치 등)이 필요하면 추측해서 쓰지 말고, 원고에 '[확인 필요]'로 표시하고 warnings에도 '[확인 필요] 내용'으로 적어요. 직접 테스트하지 않은 것을 테스트했다고 하지 마세요. 도구는 파일 읽기만 사용해요. 파일 수정·이미지 생성·게시·다른 직원 실행은 하지 마세요.
이번 구현은 검토용 초안을 스튜디오 내부 버전 폴더에 저장해요. 직원 카드의 최종 폴더 직접 저장 대신 프로그램이 결과를 저장하고 검토를 받아요. 제공한 JSON만 반환하고 직접 파일을 쓰지 마세요.
manuscript: 블로그 최종 원고 전체. 첫 줄은 '# ${input.title}'. 지침의 분량·구조·도입·예시·체크리스트·마무리를 충족해요. 블로그 이미지 6~8장(기본7장)의 삽입 위치에 예정 파일명(예: 01_표지.png)을 정확히 표시해요. Markdown과 TXT에는 같은 본문을 저장해요. 두 형식에서 정보가 달라지면 안 돼요.
instagramPost: 게시글 전체. readingScript: 5개 카드에 대응하는 읽는 대본 전체. 둘 다 빈 개요로 대신하지 마세요.
blogImages: 순서대로 01_*.png부터, 본문 연결·역할·핵심정보. instagramCards: 순서대로 01_표지.jpg부터 05_최종확인.jpg까지, 한 장별 메시지·확정 화면 카피·대본 연결. 대본 전체를 화면 카피에 넣지 마세요.
디자인 상세는 이미지 직원의 일이에요. 이미지나 SVG를 만들지 말고 내용 인계에 집중해요. episodeColor는 인스타 지침에 맞는 회차 컬러 제안이에요.
sources에는 조사메모.md의 '공식 출처'에 적힌 URL과 사실만 옮겨요(새로 찾거나 꾸며내지 마세요). documents에는 읽은 문서 절대 경로와 내부 버전, checks에는 실제 수행한 내용 검수, warnings에는 남은 미확인 사항을 적어요. 링크를 꾸며내지 마세요.
필수 자료가 없거나 사실 충돌로 작성할 수 없으면 status=blocked와 이유를 반환해요. ready는 검토 가능한 초안을 뜻하며 작가님 승인이나 독립 검수 완료를 뜻하지 않아요.
수정 요청 기록: ${JSON.stringify(job.rejections)}
이전 원고(있으면 요청된 부분을 중심으로 수정): ${JSON.stringify(job.result || null)}
읽을 파일(직접 열어서 전문을 읽어요):\n${input.docs.map(d=>`- ${d.path} (SHA256 ${d.sha256})`).join('\n')}`;
    fs.writeFileSync(path.join(directory,'prompt.txt'),prompt);
    Object.assign(job,{title:input.title,topic:input.topic,approval:input.approval,inputDocuments:input.docs.map(({path,sha256})=>({path,sha256})),status:'running',message:'글쓰기 직원이 승인된 기획과 지침을 읽고 원고를 작성하고 있어요.',error:null,startedAt:now(),files:[]});
    transition(job);
    const 설정=options.worker?{id:'writer',AI:'Codex',모델:'',추론강도:''}:runner.직원설정(getConfig(),'writer');
    let child;
    try {
      if(options.worker) child=options.worker({prompt,output,schemaPath,cwd:root});
      else child=runner.실행({설정,웹검색:false,prompt,schemaPath,output,cwd:root,읽기:[path.join(blog,'AGENTS.md'),path.join(blog,'N번폴더*'),path.join(blog,'00_운영문서'),path.join(root,'직원'),path.join(root,'규칙'),path.join(root,'작업',String(job.episode).padStart(2,'0'))]});
    } catch(e) {
      job.status='failed';job.message='글쓰기 직원을 실행하지 못했어요.';job.error=e.message;transition(job);
      usage.기록(root,{직원:'writer',편:job.episode,담당AI:설정.AI,...usage.모델정보(설정),결과:'실패',실행ID:job.id,차수:job.attempt,오류:e.message});
      return job;
    }
    active.set(job.id,child);
    let tail='',done=false,timedOut=false;
    const meter=usage.계량기(설정.AI),startedMs=Date.now();
    function 사용량남기기(code){
      const m=meter.끝();
      usage.기록(root,{
        직원:'writer',편:job.episode,담당AI:설정.AI,...usage.모델정보(설정),...(m.실제모델?{모델:m.실제모델}:{}),환산비용USD:m.환산비용USD,
        결과:job.status==='failed'?'실패':job.status==='interrupted'?'중단':'성공',
        종료코드:code,소요초:Math.round((Date.now()-startedMs)/1000),웹검색:m.웹검색,웹열기:m.웹열기,토큰:m.토큰,
        실행ID:job.id,차수:job.attempt,오류:job.status==='failed'?job.error:undefined,
      });
    }
    const log=fs.createWriteStream(path.join(directory,'events.jsonl')), errlog=fs.createWriteStream(path.join(directory,'stderr.log'));
    const timer=setTimeout(()=>{timedOut=true;terminate(child);finish(null,Error('작성 제한 시간 20분을 넘겼어요. 다시 시도할 수 있어요.'));},options.timeoutMs || 20*60*1000); timer.unref();
    function finish(code,err) {
      if(done)return;done=true;clearTimeout(timer);active.delete(job.id);log.end();errlog.end();
      if(job.status!=='running'){사용량남기기(code);return;}
      try {
        if(err)throw err;
        if(timedOut || code!==0)throw Error(friendly(tail,code));
        unchanged(job);
        if(!fs.existsSync(output)||fs.statSync(output).size>500000)throw Error(!fs.existsSync(output)&&/Claude 결과 없음|Claude 출력을/.test(tail)?friendly(tail,code)+' '+tail.slice(-300):'원고 결과가 없거나 너무 커요.');
        const result=validate(JSON.parse(read(output)),job.title);job.result=result;
        if(result.status==='blocked'){job.status='blocked';job.message=result.summary;}
        else{artifacts(job,result);job.status='awaiting_review';job.message='원고·게시글·대본·이미지 인계본을 저장했어요. 검토 후 승인하거나 수정을 요청해 주세요.';}
        job.exitCode=code;job.finishedAt=now();
      }catch(e){job.status='failed';job.message='글쓰기를 완료하지 못했어요.';job.error=e.message;job.exitCode=code;}
      사용량남기기(code);
      try{transition(job);}catch(e){console.error('글쓰기 상태 저장:',e.message);}
    }
    child.stdout.on('data',c=>{if(done)return;meter.feed(c);log.write(c);tail=(tail+c.toString()).slice(-6000);});
    child.stderr.on('data',c=>{if(done)return;errlog.write(c);tail=(tail+c.toString()).slice(-6000);});
    child.on('error',e=>finish(null,e));child.on('close',c=>finish(c));child.stdin.on('error',()=>{});
    for(const stream of [log,errlog])stream.on('error',e=>{finish(null,e);terminate(child);});
    child.stdin.end(prompt);return job;
  }
  function idle(){if(active.size)throw fail(409,'글쓰기 직원이 작업 중이에요. 완료를 기다려 주세요.');}
  function start(input){idle();if([...jobs.values()].some(j=>j.episode===input.episode))throw fail(409,'이 편은 이미 글쓰기 기록이 있어요. 기존 기록에서 다시 시도하거나 검토해 주세요.');if(!options.worker)runner.확인(runner.직원설정(getConfig(),'writer').AI);const ctx=inputs(input.episode);const j={id:randomUUID(),episode:input.episode,attempt:1,createdAt:now(),rejections:[]};fs.mkdirSync(path.join(base,j.id));return launch(j,ctx);}
  function retry(input){idle();const j=get(input.id);if(!['failed','blocked','interrupted','rejected'].includes(j.status))throw fail(409,'지금은 다시 작성할 수 없어요. 먼저 수정 요청을 남겨 주세요.');if(!options.worker)runner.확인(runner.직원설정(getConfig(),'writer').AI);const ctx=inputs(j.episode);j.attempt++;return launch(j,ctx);}
  function reject(input){const j=get(input.id);if(j.status!=='awaiting_review')throw fail(409,'검토 대기 중인 원고만 수정을 요청할 수 있어요.');if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw fail(400,'수정할 내용을 1~2,000자로 적어 주세요.');j.rejections.push({at:now(),attempt:j.attempt,reason:input.reason.trim()});j.status='rejected';j.message='수정 요청을 저장했어요. 다시 작성하기를 누르면 반영해요.';transition(j);return j;}
  function verifyFiles(j){for(const f of j.files || [])if(!fs.existsSync(path.join(outputFolder(j),f.name))||hash(path.join(outputFolder(j),f.name))!==f.sha256)throw fail(409,'저장된 원고 파일이 바뀌었어요. 수정 요청 후 다시 작성해 주세요.');}
  function approve(input){const j=get(input.id);if(j.status==='approved')return j;if(j.status!=='awaiting_review')throw fail(409,'원고 검토 대기 단계에서만 승인할 수 있어요.');unchanged(j);verifyFiles(j);const approvedAt=now();save(path.join(outputFolder(j),'인계승인.json'),{id:j.id,attempt:j.attempt,approvedAt,files:j.files});j.status='approved';j.approvedAt=approvedAt;j.message='원고와 이미지 인계를 승인했어요. 이미지 직원 실행은 아직 연결 전이에요.';transition(j);return j;}
  function file(id,name){const j=get(id);if(!j.files?.some(f=>f.name===name)&&!(name==='인계승인.json'&&j.status==='approved'))throw fail(404,'이 실행의 산출물이 아니에요.');return {name,content:read(path.join(outputFolder(j),name))};}
  function list(){return [...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  function shutdown(){for(const[id,child]of active){const j=get(id);j.status='interrupted';j.message='서버 종료로 글쓰기가 중단됐어요.';try{transition(j);}catch{}terminate(child);}active.clear();}
  return {start,retry,reject,approve,file,list,shutdown};
}
module.exports={createWriter,validate};

