'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const runner = require('../runner');
function schema() {
  const field = { type: 'object', properties: { 값: { type: ['string', 'null'] }, 근거: { type: 'string', maxLength: 120 } }, required: ['값', '근거'], additionalProperties: false };
  const fields = {}; for (const name of ['대상','장소','시간대','금액','자격','제출서류','접수방법','분야','접수마감']) fields[name] = field;
  const list = { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 5 };
  return { type: 'object', properties: { 결과: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, 필드: { type: 'object', properties: fields, additionalProperties: false }, 적합도: { type: 'object', properties: { 판정: { enum: ['적합', '확인 필요', '부적합'] }, 미충족: list, 확인필요: list, 근거: list }, required: ['판정','미충족','확인필요','근거'], additionalProperties: false } }, required: ['id','필드','적합도'], additionalProperties: false } } }, required: ['결과'], additionalProperties: false };
}
async function extract(input, { 루트, 데이터폴더, 프로필 }) {
  const config = JSON.parse(fs.readFileSync(path.join(루트, '사무실', 'office.config.json'), 'utf8'));
  const 설정 = runner.직원설정(config, 'verifier', 'notice');
  if (설정.AI !== 'Claude') throw Object.assign(new Error('검증 직원의 담당 AI를 Claude로 설정해 주세요.'), { kind: 'config' });
  runner.확인(설정.AI);
  const dir = path.join(데이터폴더, 'ai', randomUUID()); fs.mkdirSync(dir, { recursive: true });
  const schemaPath = path.join(dir, 'schema.json'), output = path.join(dir, 'result.json');
  fs.writeFileSync(schemaPath, JSON.stringify(schema()));
  const card = fs.readFileSync(path.join(루트, '직원', '공고검증.md'), 'utf8');
  const prompt = card + '\n' + input.공통문맥 + '\n검색종류: ' + 프로필.id + '\n조건 및 공고 데이터(JSON):\n' + JSON.stringify({ 내조건: input.내조건, 판정규칙: input.판정규칙, 공고들: input.공고들 });
  fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
  return new Promise((resolve, reject) => {
    let child, settled = false, timer, stderr = '';
    const done = (err, data) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(data); };
    try { child = runner.실행({ 설정, prompt, schemaPath, output, cwd: dir, 도구없음: true }); }
    catch(e) { done(e); return; }
    timer = setTimeout(() => { child.kill(); done(Object.assign(new Error('검증 응답 대기 시간이 초과됐어요.'), { kind: 'timeout' })); }, 180000);
    child.stdout.on('data', () => {}); child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-6000); });
    child.stdin.on('error', e => done(e)); child.on('error', e => done(e));
    child.on('close', code => {
      fs.writeFileSync(path.join(dir, 'stderr.log'), stderr);
      try { if (code !== 0 || !fs.existsSync(output)) throw new Error(stderr || `검증 실행 종료 코드 ${code}`); done(null, JSON.parse(fs.readFileSync(output, 'utf8'))); }
      catch(e) { const kind = /limit|quota|usage|한도|rate/i.test(e.message) ? 'limit' : /auth|login|로그인/i.test(e.message) ? 'auth' : 'schema'; done(Object.assign(e, { kind })); }
    });
    child.stdin.end(prompt);
  });
}
module.exports = { extract, schema };
