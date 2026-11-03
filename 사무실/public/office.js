'use strict';

// 상태 파일에 적는 말 -> 화면에서 쓰는 종류
const 상태종류 = { 일함: 'work', 쉼: 'rest', 대표님대기: 'boss', 결재대기: 'approve' };
const 기본갱신초 = 4;
const 대화줄수 = 12;

const 화면 = {
  방이름: document.getElementById('방이름'),
  방탭: document.getElementById('방탭'),
  편선택: document.getElementById('편선택'),
  주제: document.getElementById('주제'),
  단계: document.getElementById('단계'),
  갱신: document.getElementById('갱신'),
  알림: document.getElementById('알림'),
  무대: document.getElementById('무대'),
  대화창: document.getElementById('대화창'),
};

let 응답 = null; // 서버에서 마지막으로 받은 내용
let 현재방 = null; // 보고 있는 방 id
let 선택편 = null; // null이면 가장 최근에 갱신된 편
let 지은방 = ''; // 무대를 지을 때 쓴 설정 (바뀌면 다시 지어요)
let 대화서명 = '';
let 타이머 = null;
let 갱신간격 = 기본갱신초;
const 직원요소 = new Map();
let 서류요소 = null;
let 조회번호 = 0;

// 화면에 들어가는 글은 전부 textContent로 넣어요 (파일 내용이 코드로 실행되지 않게)
function 만들기(태그, 클래스, 글) {
  const e = document.createElement(태그);
  if (클래스) e.className = 클래스;
  if (글 != null) e.textContent = 글;
  return e;
}

function 정규화(말) {
  return String(말 ?? '').replace(/\s+/g, '');
}

function 시간표시(값, 초까지) {
  const d = new Date(값);
  if (Number.isNaN(d.getTime())) return String(값 ?? '');
  return d.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', ...(초까지 ? { second: '2-digit' } : {}) });
}

function 알림표시(글) {
  화면.알림.hidden = !글;
  화면.알림.textContent = 글 || '';
}

// ---- 서버에서 읽기 -------------------------------------------------

async function 가져오기() {
  const 이번조회 = ++조회번호;
  try {
    const r = await fetch('/api/all', { cache: 'no-store' });
    const j = await r.json();
    if (이번조회 !== 조회번호) return;
    if (!r.ok) throw new Error(j.오류 || r.status);
    응답 = j;
    그리기();
    const 초 = Number(j.설정.서버?.갱신초) || 기본갱신초;
    if (초 !== 갱신간격) {
      갱신간격 = 초;
      if (타이머) { 멈춤(); 시작(); }
    }
  } catch (e) {
    if (이번조회 !== 조회번호) return;
    알림표시(`서버에서 읽지 못했어요: ${e.message}\n(화면은 마지막으로 읽은 모습 그대로예요)`);
  }
}

function 시작() {
  if (타이머) return;
  가져오기();
  타이머 = setInterval(가져오기, 갱신간격 * 1000);
}

function 멈춤() {
  clearInterval(타이머);
  타이머 = null;
}

// 탭이 가려지면 멈추고, 다시 보이면 바로 한 번 읽고 이어가요
document.addEventListener('visibilitychange', () => (document.hidden ? 멈춤() : 시작()));

// ---- 방 그리기 -------------------------------------------------------

function 안전한경로(p) {
  return typeof p === 'string' && p !== '' && !/^[a-z][a-z0-9+.-]*:|^\/\/|\.\./i.test(p);
}

// 그림 파일을 불러와요. 실패하면 조용히 빼요 (그림이 없어도 화면은 돌아가요)
function 그림만들기(경로, 클래스) {
  if (!안전한경로(경로)) return null;
  const img = new Image();
  img.alt = '';
  img.className = 클래스;
  img.onerror = () => img.remove();
  img.src = 경로;
  return img;
}

// x, y는 그림의 "발 밑" 위치(무대 가로·세로 %), w는 무대 가로 %
function 무대에놓기(요소, x, y, w) {
  요소.style.left = `${x}%`;
  요소.style.top = `${y}%`;
  if (w != null) 요소.style.width = `${w}%`;
  요소.style.zIndex = String(10 + Math.round(y * 10));
}

function 방짓기(방) {
  화면.무대.replaceChildren();
  직원요소.clear();
  서류요소 = null;

  const 배경 = 그림만들기(방.배경, 'bg');
  if (배경) {
    // 배경 그림의 가로세로 비율대로 무대 모양을 맞춰요 (그림을 바꿔 끼워도 안 찌그러져요)
    배경.onload = () => { 화면.무대.style.aspectRatio = `${배경.naturalWidth} / ${배경.naturalHeight}`; };
    화면.무대.append(배경);
  }

  for (const p of 방.소품 || []) {
    const img = 그림만들기(p.그림, 'prop-static');
    if (img) { 무대에놓기(img, p.x, p.y, p.w); 화면.무대.append(img); }
  }

  if (방.서류) {
    const 더미 = 만들기('div', 'docstack');
    const img = 그림만들기(방.서류.그림, 'doc');
    if (img) 더미.append(img);
    더미.append(만들기('span', 'count'));
    무대에놓기(더미, 방.서류.x, 방.서류.y, 방.서류.w);
    서류요소 = 더미;
    화면.무대.append(더미);
  }

  (방.직원 || []).forEach((s, i) => {
    const el = 만들기('div', 'char st-rest');
    const 아바타 = 만들기('div', 'avatar');
    아바타.style.background = s.색 || '#999';
    아바타.style.animationDelay = `${(i % 5) * 0.12}s`;
    아바타.append(만들기('span', 'letter', Array.from(s.이름 || '?')[0]));
    if (안전한경로(s.이미지)) {
      // 그림이 잘 불러와지면 동그라미 대신 그림을 보여줘요. 실패하면 동그라미가 그대로 남아요.
      const img = new Image();
      img.alt = '';
      img.onload = () => { 아바타.append(img); 아바타.classList.add('photo'); };
      img.src = s.이미지;
    }
    const 이름표 = 만들기('div', 'tag');
    이름표.append(만들기('span', 'name', s.이름 || s.id));
    const 배지 = 만들기('span', 'ai', s.AI || '?');
    배지.dataset.ai = s.AI || '';
    이름표.append(배지);
    el.append(아바타, 이름표);

    // 상태에 맞는 소품 (일함=노트북, 쉼=커피, 대표님대기=팻말, 결재대기=서류). 여러 개면 직원마다 번갈아 써요.
    for (const [상태말, 목록] of Object.entries(방.상태소품 || {})) {
      const 종류 = 상태종류[상태말];
      const 항목 = Array.isArray(목록) ? 목록[i % 목록.length] : null;
      const img = 종류 && 항목 ? 그림만들기(항목.그림, 'prop') : null;
      if (!img) continue;
      img.dataset.kind = 종류;
      img.hidden = true;
      img.style.width = `${항목.w}cqw`;
      img.style.left = `calc(50% + ${항목.dx || 0}cqw)`;
      img.style.bottom = `${항목.dy || 0}cqw`;
      el.append(img);
    }

    el.style.left = `${s.책상자리?.x ?? 50}%`;
    el.style.top = `${s.책상자리?.y ?? 50}%`;
    직원요소.set(s.id, el);
    화면.무대.append(el);
  });
}

function 자리고르기(목록, 번호, 기본) {
  return Array.isArray(목록) && 목록.length ? 목록[번호 % 목록.length] : 기본;
}

function 에피소드시각(ep) {
  const t = Date.parse(ep.데이터.갱신시각);
  return Number.isNaN(t) ? ep.수정시각 : t;
}

function 편번호(ep) {
  return Number(ep.데이터.편) || Number.parseInt(ep.파일, 10);
}

function 상태적용(방, ep) {
  const 직원상태 = ep?.데이터.직원 || {};
  let 서류수 = 0;
  (방.직원 || []).forEach((s, i) => {
    const 원본 = 직원상태[s.id]?.상태;
    const 종류 = 상태종류[정규화(원본)] || 'rest';
    const el = 직원요소.get(s.id);
    let 자리 = s.책상자리;
    if (종류 === 'rest') 자리 = 자리고르기(방.자리?.쉼, i, 자리);
    if (종류 === 'boss') 자리 = 자리고르기(방.자리?.대표님대기, i, 자리);
    if (종류 === 'approve') 서류수 += 1;
    el.className = `char st-${종류}`;
    el.style.left = `${자리?.x ?? 50}%`;
    el.style.top = `${자리?.y ?? 50}%`;
    el.style.zIndex = String(10 + Math.round((자리?.y ?? 50) * 10));
    el.querySelectorAll('.prop').forEach((p) => { p.hidden = p.dataset.kind !== 종류; });
    const 메시지 = 직원상태[s.id]?.메시지;
    el.title = `${s.이름} · ${원본 || '쉼'}${메시지 ? ` — ${메시지}` : ''}`;
  });
  if (서류요소) {
    서류요소.hidden = !서류수;
    서류요소.querySelector('.count').textContent = 서류수 > 1 ? `×${서류수}` : '';
  }
}

function 대화그리기(방, ep) {
  const 이름찾기 = (값) => (방.직원 || []).find((s) => s.id === 값 || s.이름 === 값)?.이름 || 값 || '';
  let 줄 = [];
  if (Array.isArray(ep?.데이터.기록)) {
    줄 = ep.데이터.기록.slice(-대화줄수).map((r) => ({ 시각: r?.시각, 누구: 이름찾기(r?.직원), 내용: r?.내용 }));
  }
  if (!줄.length && ep?.데이터.마지막메시지) {
    줄 = [{ 시각: ep.데이터.갱신시각, 누구: '마지막 메시지', 내용: ep.데이터.마지막메시지 }];
  }
  const 서명 = JSON.stringify(줄);
  if (서명 === 대화서명) return;
  대화서명 = 서명;
  화면.대화창.replaceChildren();
  if (!줄.length) {
    화면.대화창.append(만들기('div', 'line empty', '아직 메시지가 없어요.'));
    return;
  }
  for (const r of 줄) {
    const 한줄 = 만들기('div', 'line');
    한줄.title = String(r.내용 ?? '');
    if (r.시각) 한줄.append(만들기('span', 'when', 시간표시(r.시각)));
    한줄.append(만들기('span', 'who', r.누구), document.createTextNode(String(r.내용 ?? '')));
    화면.대화창.append(한줄);
  }
  화면.대화창.scrollTop = 화면.대화창.scrollHeight;
}

function 방탭그리기(방들) {
  화면.방탭.replaceChildren();
  if (방들.length < 2) return;
  for (const 방 of 방들) {
    const b = 만들기('button', 방.id === 현재방 ? 'on' : '', 방.이름 || 방.id);
    b.type = 'button';
    b.onclick = () => { 현재방 = 방.id; 선택편 = null; 지은방 = ''; 그리기(); };
    화면.방탭.append(b);
  }
}

function 편선택그리기(에피소드, 보는편) {
  화면.편선택.replaceChildren();
  for (const ep of 에피소드) {
    const o = 만들기('option', '', `${편번호(ep)}편 · ${ep.데이터.주제 || '(주제 없음)'}`);
    o.value = ep.파일;
    o.selected = ep === 보는편;
    화면.편선택.append(o);
  }
  화면.편선택.disabled = !에피소드.length;
  if (!에피소드.length) 화면.편선택.append(만들기('option', '', '(없음)'));
}

화면.편선택.onchange = () => { 선택편 = 화면.편선택.value; 그리기(); };

function 그리기() {
  if (!응답) return;
  const 방들 = 응답.설정.방;
  if (!방들.some((b) => b.id === 현재방)) 현재방 = 응답.설정.서버?.블로그팀활성 === false && 방들.some(b => b.id === 'notice') ? 'notice' : 방들[0]?.id;
  const 방 = 방들.find((b) => b.id === 현재방);
  if (!방) { 알림표시('office.config.json에 "방"이 하나도 없어요.'); return; }

  const 설정서명 = JSON.stringify(방);
  if (설정서명 !== 지은방) { 방짓기(방); 지은방 = 설정서명; 대화서명 = ''; }
  방탭그리기(방들);
  화면.방이름.textContent = 방.이름 || 방.id;

  const 상태 = 응답.방상태[방.id] || { 에피소드: [], 경고: [] };
  // 공고정보센터 방: 블로그 전용 패널은 숨기고, 캐릭터는 같은 방식으로 움직여요 (notice-ui.js)
  const 공고방 = 방.종류 === 'notice';
  if (typeof 공고화면전환 === 'function') 공고화면전환(공고방);
  if (공고방) {
    const ep = 상태.에피소드[0] || null;
    상태적용(방, ep);
    대화그리기(방, ep);
    알림표시(상태.경고.join('\n'));
    공고그리기(방);
    return;
  }
  const 기획들 = 응답.기획 || [];
  const 에피소드 = [...상태.에피소드].filter(ep => !기획들.length || 편번호(ep) !== 99).sort((a, b) => 에피소드시각(b) - 에피소드시각(a));
  const 보는편 = 에피소드.find((e) => e.파일 === 선택편) || 에피소드[0] || null;

  편선택그리기(에피소드, 보는편);
  화면.주제.textContent = 보는편?.데이터.주제 || '';
  화면.단계.textContent = 보는편?.데이터.단계 ? `${편번호(보는편) === 99 ? '시험 예시' : '지금 단계'}: ${보는편.데이터.단계}` : '기획 승인 후 편이 등록돼요';
  기획그리기();
  글쓰기그리기(보는편);
  document.getElementById('작업상세').hidden = !보는편?.데이터.요청사항;
  document.getElementById('요청내용').textContent = 보는편?.데이터.요청사항 || '';
  화면.갱신.textContent = 보는편
    ? `파일 갱신 ${시간표시(에피소드시각(보는편), true)} · 확인 ${시간표시(Date.now(), true)}`
    : `확인 ${시간표시(Date.now(), true)}`;

  const 진행기획 = (응답.기획 || []).find(j => j.status === 'running' || j.status === 'awaiting_approval');
  const 표시편 = 진행기획 ? { 데이터: { 직원: { topic: { 상태: 진행기획.status === 'running' ? '일함' : '결재대기', 메시지: 진행기획.message } } } } : 보는편;
  상태적용(방, 표시편);
  const 최근기획 = 기획들[0];
  const 최근글쓰기 = (응답.글쓰기 || []).find(j => j.episode === 보는편?.데이터.편);
  대화그리기(방, 최근글쓰기 ? 보는편 : 최근기획 ? { 데이터: { 기록: [{ 시각: 최근기획.updatedAt, 직원: 'topic', 내용: 최근기획.message }] } } : 보는편);

  const 안내 = [...상태.경고];
  if (!에피소드.length && !안내.length && !기획들.length) 안내.push('아직 승인한 기획이 없어요. 새 글 기획 시작을 눌러 주세요.');
  알림표시(안내.join('\n'));
}

const 기획이름 = { running: '기획 중', awaiting_approval: '승인 대기', approved: '기획 승인', rejected: '반려', failed: '실행 실패', interrupted: '실행 중단', blocked: '확인 필요' };
let 선택기획 = null;
let 기획서명 = '';
let 기획요청중 = false;
const 후보선택기억 = new Map();
const 반려초안 = new Map();
const 기획오류 = document.getElementById('기획오류');
const 기획선택 = document.getElementById('기획선택');
기획선택.onchange = () => { 선택기획 = 기획선택.value; 기획서명 = ''; 그리기(); };
function 기획그리기() {
  const jobs = 응답?.기획 || [];
  const job = jobs.find(j => j.id === 선택기획) || jobs[0];
  document.getElementById('새작업').disabled = 기획요청중 || 응답.설정.서버?.블로그팀활성 === false || 현재방 !== 'blog' || jobs.some(j => ['running', 'awaiting_approval'].includes(j.status));
  document.getElementById('기획패널').hidden = !job;
  if (!job) return;
  const toast = document.getElementById('작업결과');
  if (!toast.hidden) toast.textContent = job.message;
  기획선택.replaceChildren();
  jobs.forEach(j => {
    const option = 만들기('option', '', `${new Date(j.createdAt).toLocaleString('ko-KR')} · ${기획이름[j.status] || j.status}`);
    option.value = j.id; option.selected = j.id === job.id; 기획선택.append(option);
  });
  const signature = JSON.stringify(job);
  if (signature === 기획서명) return;
  기획서명 = signature;
  const panel = document.getElementById('기획내용'); panel.replaceChildren();
  panel.append(만들기('h2', '', `${기획이름[job.status] || job.status} · ${job.proposedEpisode || ''}편 제안`));
  panel.append(만들기('p', 'planner-message', job.message));
  if (job.notes) panel.append(만들기('p', 'hint', `작가님 요청: ${job.notes}`));
  if (job.error) panel.append(만들기('p', 'form-error', job.error));
  if (job.status === 'approved') {
    const selected = job.result?.candidates[job.selectedIndex];
    if (selected) panel.append(만들기('p', '', `승인한 주제: ${selected.title}`));
    const next = 만들기('a', 'download-link', '글쓰기 화면으로 이동'); next.href = '#글쓰기패널'; panel.append(next);
    return;
  }
  if (job.status === 'running') {
    panel.append(만들기('p', 'hint', 'Codex 기획자가 조사하고 있어요. 몇 분 걸릴 수 있고, 창을 닫아도 서버가 켜져 있으면 계속 진행해요.'));
    return;
  }
  if (job.result) {
    panel.append(만들기('p', '', job.result.summary));
    const group = 만들기('fieldset', 'candidate-list');
    group.append(만들기('legend', '', job.status === 'approved' ? '검토한 주제 후보' : '기획자가 제안한 주제'));
    job.result.candidates.forEach((candidate, i) => {
      const card = 만들기('label', 'candidate');
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'candidate'; radio.value = String(i);
      radio.checked = i === (job.selectedIndex ?? 후보선택기억.get(`${job.id}:${job.attempt}`) ?? job.result.recommendedIndex);
      radio.onchange = () => 후보선택기억.set(`${job.id}:${job.attempt}`, i);
      radio.disabled = job.status !== 'awaiting_approval';
      card.append(radio, 만들기('strong', '', `${i === job.result.recommendedIndex ? '추천 · ' : ''}${candidate.title}`));
      card.append(만들기('p', '', candidate.reason));
      const detail = 만들기('details', 'candidate-detail'); detail.append(만들기('summary', '', '독자·차별점·소제목 보기'));
      detail.append(만들기('p', 'hint', `독자: ${candidate.audience}\n검색 의도: ${candidate.searchIntent}\n기존 글과의 차이: ${candidate.difference}`));
      const list = 만들기('ul'); candidate.outline.forEach(s => list.append(만들기('li', '', s))); detail.append(list); card.append(detail); group.append(card);
    });
    if (job.result.candidates.length) panel.append(group);
    const research = 만들기('details', 'research'); research.append(만들기('summary', '', '조사 근거와 확인하지 못한 내용'));
    research.append(만들기('p', 'research-notes', job.result.researchNotes));
    for (const source of job.result.sources) {
      const p = 만들기('p');
      const a = 만들기('a', '', source.title); if (/^https?:\/\//.test(source.url)) a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      p.append(a, document.createTextNode(` — ${source.fact}`)); research.append(p);
    }
    job.result.documents.forEach(d => research.append(만들기('p', 'hint', `${d.path} · ${d.version}`)));
    job.result.warnings.forEach(w => research.append(만들기('p', 'form-error', w)));
    panel.append(research);
  }
  if (job.status === 'awaiting_approval') {
    const approve = 만들기('button', 'primary', '선택한 주제와 편 번호 승인'); approve.type = 'button';
    approve.onclick = () => 기획동작('approve', { id: job.id, index: Number(panel.querySelector('input[name="candidate"]:checked')?.value) });
    panel.append(approve);
    const label = 만들기('label', 'reject-label', '다른 방향이 필요하면 반려 이유를 적어 주세요.'); label.htmlFor = '반려이유';
    const reason = 만들기('textarea'); reason.id = '반려이유'; reason.maxLength = 2000; reason.rows = 2;
    reason.value = 반려초안.get(job.id) || '';
    reason.oninput = () => 반려초안.set(job.id, reason.value);
    const reject = 만들기('button', '', '반려하기'); reject.type = 'button';
    reject.onclick = () => {
      if (!reason.value.trim()) { 기획오류.textContent = '반려 이유를 적어 주세요.'; 기획오류.hidden = false; reason.focus(); return; }
      기획동작('reject', { id: job.id, reason: reason.value.trim() });
    };
    panel.append(label, reason, reject);
  }
  if (['failed', 'blocked', 'interrupted', 'rejected'].includes(job.status)) {
    if (job.rejections?.length) panel.append(만들기('p', '', `최근 반려 이유: ${job.rejections.at(-1).reason}`));
    const retry = 만들기('button', 'primary', '다시 기획하기'); retry.type = 'button'; retry.onclick = () => 기획동작('retry', { id: job.id }); panel.append(retry);
  }
}
async function 기획동작(action, body) {
  if (기획요청중) return;
  기획요청중 = true; 기획오류.hidden = true;
  document.querySelectorAll('.planner-panel button, #새작업').forEach(b => b.disabled = true);
  try {
    const r = await fetch(`/api/planning/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Request': '1' }, body: JSON.stringify(body) });
    const job = await r.json();
    if (!r.ok) throw new Error(job.오류 || '요청을 처리하지 못했어요.');
    조회번호++;
    선택기획 = job.id;
    응답.기획 = [job, ...(응답.기획 || []).filter(j => j.id !== job.id)];
    if (job.episodeFile) 선택편 = job.episodeFile;
    const result = document.getElementById('작업결과'); result.hidden = false; result.textContent = job.message;
    await 가져오기();
  } catch (e) { 기획오류.hidden = false; 기획오류.textContent = e.message; await 가져오기(); }
  finally { 기획요청중 = false; 기획서명 = ''; 그리기(); }
}
document.getElementById('새작업').onclick = () => 기획동작('start', { notes: document.getElementById('기획요청').value });

// writer-ui.js가 초기화된 뒤 상태 조회를 시작해요.

