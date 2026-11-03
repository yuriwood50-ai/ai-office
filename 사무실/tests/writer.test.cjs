const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createWriter}=require('../writer');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'office-writer-test-')),blog=path.join(root,'blog'),planId='11111111-1111-4111-8111-111111111111';
for(const p of ['상태','직원','작업/15',`작업/기획/${planId}`,'blog/00_운영문서'])fs.mkdirSync(path.join(root,p),{recursive:true});
const title='15. 승인한 시험 제목';
fs.writeFileSync(path.join(root,'상태','15.json'),JSON.stringify({편:15,주제:'승인한 시험 제목',기획승인:{id:planId},직원:{},단계:'기획승인'}));
fs.writeFileSync(path.join(root,'작업','기획',planId,'state.json'),JSON.stringify({status:'approved',selectedIndex:0,result:{candidates:[{title:'승인한 시험 제목'}]}}));
fs.writeFileSync(path.join(root,'작업','15','주제확정서.md'),'# '+title);fs.writeFileSync(path.join(root,'작업','15','조사메모.md'),'조사');fs.writeFileSync(path.join(root,'직원','글쓰기.md'),'직원');
for(const p of ['AGENTS.md','N번폴더 자동제작 운영 지침 v1.0.md','00_운영문서/블로그 콘텐츠 기획·생성 지침 v1.0.md','00_운영문서/블로그 운영설계 지침 문서.md','00_운영문서/smartbeetip_운영마스터_v1.0.md','00_운영문서/smartbeetip 블로그 이미지 디자인·생성 지침 v1.0.md','00_운영문서/smartbeetip Instagram 카드뉴스 디자인·생성 지침 v1.0.md'])fs.writeFileSync(path.join(blog,p),'시험 지침');
const config={방:[{id:'blog',상태폴더:'../상태'}]};let mode='ok',prompts=[];
const result={status:'ready',summary:'모의 검증',manuscript:'# '+title+'\n'+('검증 본문입니다. '.repeat(100)),instagramPost:'게시글 '.repeat(30),readingScript:'대본 '.repeat(100),blogImages:Array.from({length:7},(_,i)=>({filename:`0${i+1}_시험.png`,anchor:'본문',role:'설명',message:'정보'})),instagramCards:Array.from({length:5},(_,i)=>({filename:`0${i+1}_시험.jpg`,message:'정보',screenCopy:'짧은 카피',narration:'대본'})),episodeColor:'파랑',sources:[{title:'시험',url:'https://example.com',fact:'모의 근거'}],documents:[{path:'test',version:'test'}],checks:['자동 시험용'],warnings:[]};result.manuscript+='\n'+result.blogImages.map(i=>i.filename).join('\n');
function worker({prompt,output}){prompts.push(prompt);const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};setTimeout(()=>{const r=structuredClone(result);if(mode==='title')r.manuscript=r.manuscript.replace(title,'다른 제목');if(mode==='path')r.blogImages[0].filename='../oops.png';if(mode==='blocked')r.status='blocked';fs.writeFileSync(output,JSON.stringify(r));if(mode==='quota')c.stderr.write('quota reached');c.emit('close',mode==='quota'?1:0);},20);return c;}
const opts={blogRoot:blog,worker};const p=createWriter(root,()=>config,opts);const wait=()=>new Promise(r=>setTimeout(r,80));
(async()=>{
 assert.throws(()=>p.start({episode:99}),{status:400});assert.throws(()=>p.start({episode:16}),{status:409});
 const j=p.start({episode:15});assert.equal(j.status,'running');assert.throws(()=>p.start({episode:15}),{status:409});assert.throws(()=>p.approve({id:j.id}),{status:409});await wait();assert.equal(j.status,'awaiting_review');assert.equal(j.files.length,6);
 assert.equal(p.file(j.id,'블로그15편_원고.md').content,p.file(j.id,'블로그15편_원고.txt').content);assert.throws(()=>p.file(j.id,'../../x'),{status:404});
 const dir=path.join(root,'작업','글쓰기',j.id,'실행-1','산출물');const old=fs.readFileSync(path.join(dir,'블로그15편_원고.md'),'utf8');
 fs.appendFileSync(path.join(dir,'블로그15편_원고.md'),'외부 변경');assert.throws(()=>p.approve({id:j.id}),{status:409});
 p.reject({id:j.id,reason:'쉬운 말로 수정'});p.retry({id:j.id});await wait();assert.equal(j.status,'awaiting_review');assert.match(prompts.at(-1),/쉬운 말로 수정/);assert.equal(fs.readFileSync(path.join(dir,'블로그15편_원고.md'),'utf8'),old+'외부 변경');
 const memo=path.join(root,'작업','15','조사메모.md');fs.appendFileSync(memo,'변경');assert.throws(()=>p.approve({id:j.id}),{status:409});
 p.reject({id:j.id,reason:'최신 근거로'});mode='title';p.retry({id:j.id});await wait();assert.equal(j.status,'failed');
 mode='quota';p.retry({id:j.id});await wait();assert.equal(j.status,'failed');assert.match(j.error,/한도/);
 mode='path';p.retry({id:j.id});await wait();assert.equal(j.status,'failed');
 mode='ok';p.retry({id:j.id});await wait();assert.equal(j.status,'awaiting_review');p.approve({id:j.id});assert.equal(j.status,'approved');assert.equal(p.approve({id:j.id}).status,'approved');assert.throws(()=>p.retry({id:j.id}),{status:409});
 const q=createWriter(root,()=>config,opts);assert.equal(q.list()[0].status,'approved');const ep=JSON.parse(fs.readFileSync(path.join(root,'상태','15.json')));assert.equal(ep.단계,'인계승인');assert.equal(ep.인계승인.해시.length,6);
 console.log('PASS: approval gate, duplicate execution, six artifacts, MD/TXT equality, path allowlist, tamper protection, source changes, revision preservation, retry feedback, invalid output, quota, frozen approval, restart');
})().catch(e=>{console.error(e);process.exitCode=1});
