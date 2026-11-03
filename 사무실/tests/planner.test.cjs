const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createPlanner } = require('../planner');
const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'office-planner-test-'));
const blog = path.join(root, 'blog');
for (const folder of ['상태', '직원', 'blog/00_운영문서', 'blog/14_기존편']) fs.mkdirSync(path.join(root, folder), {recursive:true});
fs.writeFileSync(path.join(root,'직원','주제기획.md'), 'test card');
for (const f of ['AGENTS.md','N번폴더 자동제작 운영 지침 v1.0.md','00_운영문서/꿀팁뿌리는 꿀벌 블로그 주제 목록.md','00_운영문서/smartbeetip_진행현황.md','00_운영문서/smartbeetip_운영마스터_v1.0.md','00_운영문서/블로그 콘텐츠 기획·생성 지침 v1.0.md']) fs.writeFileSync(path.join(blog,f),'test document');
fs.writeFileSync(path.join(root,'상태','99.json'), '{"편":99,"주제":"시험"}');
const config = {방:[{id:'blog',상태폴더:'../상태',직원:[{id:'topic'}]}]};
let mode = 'ready', prompts=[];
const valid = {status:'ready',summary:'실제 AI가 아닌 자동 테스트 결과',recommendedIndex:0,candidates:[0,1,2].map(i=>({title:`시험 주제 ${i}`,reason:'시험 이유',audience:'시험 독자',searchIntent:'시험 의도',difference:'시험 차이',outline:['소제목1','소제목2']})),sources:[{title:'시험 출처',url:'https://example.com/',fact:'test'}],documents:[{path:'test',version:'test'}],researchNotes:'test',warnings:[]};
function worker({output, prompt}) {
  prompts.push(prompt);
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill=()=>{};
  setTimeout(()=>{
    if(mode==='invalid') fs.writeFileSync(output,'not json');
    else fs.writeFileSync(output,JSON.stringify(valid));
    if(mode==='failed') child.stderr.write('usage limit reached');
    child.emit('close',mode==='failed'?1:0);
  }, 15);
  return child;
}
const opts={blogRoot:blog,worker};
const p=createPlanner(root,()=>config,opts);
const wait=()=>new Promise(r=>setTimeout(r,60));
(async()=>{
  const j=p.start({}); assert.equal(j.proposedEpisode,15); assert.equal(j.status,'running');
  assert.throws(()=>p.start({}),{status:409});
  assert.throws(()=>p.approve({id:j.id,index:0}),{status:409});
  await wait(); assert.equal(j.status,'awaiting_approval');
  assert.equal(fs.readdirSync(path.join(root,'상태')).length,1);
  assert.throws(()=>p.start({}),{status:409});
  assert.throws(()=>p.reject({id:j.id,reason:''}),{status:400});
  p.reject({id:j.id,reason:'더 쉬운 내용'}); assert.equal(j.status,'rejected');
  assert.throws(()=>p.approve({id:j.id,index:0}),{status:409});
  p.retry({id:j.id}); await wait(); assert.match(prompts.at(-1),/더 쉬운 내용/);
  assert.throws(()=>p.approve({id:j.id,index:99}),{status:400});
  const approved=p.approve({id:j.id,index:1}); assert.equal(approved.status,'approved');
  const data=JSON.parse(fs.readFileSync(path.join(root,'상태','15.json'))); assert.equal(data.단계,'기획승인'); assert.equal(data.주제,'시험 주제 1');
  assert.equal(p.approve({id:j.id,index:1}).status,'approved');
  assert.ok(fs.existsSync(path.join(root,'작업','15','주제확정서.md')));
  const restarted=createPlanner(root,()=>config,opts); assert.equal(restarted.list()[0].status,'approved');
  mode='failed'; const f=p.start({}); await wait(); assert.equal(f.status,'failed'); assert.match(f.error,/사용 한도/);
  mode='invalid'; p.retry({id:f.id}); await wait(); assert.equal(f.status,'failed');
  mode='ready'; p.retry({id:f.id}); await wait();
  fs.mkdirSync(path.join(blog,'16_외부추가')); assert.throws(()=>p.approve({id:f.id,index:0}),{status:409}); assert.equal(f.proposedEpisode,17);
  assert.equal(p.approve({id:f.id,index:0}).status,'approved');
  const k=p.start({}); const recovered=createPlanner(root,()=>config,opts); assert.equal(recovered.list().find(x=>x.id===k.id).status,'interrupted');
  await wait();
  assert.equal(fs.readFileSync(path.join(root,'상태','99.json'),'utf8'),'{"편":99,"주제":"시험"}');
  console.log('PASS: empty-input start, automatic episode, double-start guard, approval gating, rejection/retry context, approved artifacts, idempotence, restart recovery, usage-limit/invalid output, numbering collision, 99 preservation');
})().catch(e=>{console.error(e);process.exitCode=1});

