'use strict';
const 쓰기상태 = { running:'원고 작성 중',awaiting_review:'원고 검토 대기',approved:'이미지 인계 승인',rejected:'수정 요청',failed:'작성 실패',blocked:'확인 필요',interrupted:'작성 중단' };
let 쓰기서명='', 쓰기요청중=false;
const 수정초안=new Map();
function 글쓰기그리기(ep){
  const panel=document.getElementById('글쓰기내용');
  const n=ep ? 편번호(ep) : null;
  const job=(응답.글쓰기 || []).find(j=>j.episode===n);
  const signature=JSON.stringify([n,ep?.데이터.기획승인,job]);
  if(signature===쓰기서명)return;쓰기서명=signature;panel.replaceChildren();
  if(!ep?.데이터.기획승인){panel.append(만들기('p','hint','기획을 승인하면 글쓰기를 시작할 수 있어요.'));return;}
  panel.append(만들기('p','',`${n}편 · ${ep.데이터.주제}`));
  if(!job){
    const start=만들기('button','primary','글쓰기 시작');start.type='button';start.disabled=쓰기요청중||(응답.글쓰기||[]).some(j=>j.status==='running');
    start.onclick=()=>쓰기동작('start',{episode:n});panel.append(start,만들기('p','hint','승인한 기획으로 원고·인스타 게시글·대본·이미지 인계본을 작성해요.'));return;
  }
  panel.append(만들기('h3','',`${쓰기상태[job.status] || job.status} · ${job.attempt}차`),만들기('p','',job.message));
  if(job.error)panel.append(만들기('p','form-error',job.error));
  if(job.status==='running')panel.append(만들기('p','hint','Codex가 지침을 확인하고 작성하고 있어요. 몇 분 걸릴 수 있어요.'));
  if(job.files?.length){
    const list=만들기('div','writing-files');
    for(const file of [...job.files,...(job.status==='approved'?[{name:'인계승인.json'}]:[])]){
      const row=만들기('div','writing-file');const button=만들기('button','',file.name+' 읽기');button.type='button';
      const url=`/api/writing/file?id=${encodeURIComponent(job.id)}&name=${encodeURIComponent(file.name)}`;
      const view=만들기('pre','document-preview');view.hidden=true;
      button.onclick=async()=>{
        if(!view.hidden){view.hidden=true;return;}button.disabled=true;
        try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('파일을 불러오지 못했어요.');view.textContent=await r.text();view.hidden=false;}
        catch(e){view.textContent=e.message;view.hidden=false;}finally{button.disabled=false;}
      };
      const download=만들기('a','download-link','내려받기');download.href=url+'&download=1';download.download=file.name;
      row.append(button,download,view);list.append(row);
    }panel.append(list);
    if(job.result?.warnings?.length){const notes=만들기('details','research');notes.append(만들기('summary','','확인이 필요한 내용'));job.result.warnings.forEach(w=>notes.append(만들기('p','',w)));panel.append(notes);}
  }
  if(job.status==='awaiting_review'){
    const approve=만들기('button','primary','원고·이미지 인계 승인 ②');approve.type='button';approve.onclick=()=>쓰기동작('approve',{id:job.id});panel.append(approve);
    panel.append(만들기('p','hint','승인하면 이번 버전의 원고를 확정해요. 이미지 자동 제작은 아직 연결 전이에요.'));
    const label=만들기('label','reject-label','수정할 내용을 적어 주세요.');label.htmlFor='원고수정요청';
    const input=만들기('textarea');input.id='원고수정요청';input.maxLength=2000;input.rows=3;input.value=수정초안.get(job.id)||'';input.oninput=()=>수정초안.set(job.id,input.value);
    const reject=만들기('button','','수정 요청');reject.type='button';reject.onclick=()=>{if(!input.value.trim()){쓰기오류('수정할 내용을 적어 주세요.');input.focus();return;}쓰기동작('reject',{id:job.id,reason:input.value});};panel.append(label,input,reject);
  }
  if(['rejected','failed','blocked','interrupted'].includes(job.status)){
    if(job.rejections?.length)panel.append(만들기('p','',`최근 수정 요청: ${job.rejections.at(-1).reason}`));
    const retry=만들기('button','primary','다시 작성하기');retry.type='button';retry.onclick=()=>쓰기동작('retry',{id:job.id});panel.append(retry);
  }
}
function 쓰기오류(message){const e=document.getElementById('글쓰기오류');e.textContent=message||'';e.hidden=!message;}
async function 쓰기동작(action,body){
  if(쓰기요청중)return;쓰기요청중=true;쓰기오류('');document.querySelectorAll('#글쓰기내용 button').forEach(b=>b.disabled=true);
  try{const r=await fetch(`/api/writing/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-Office-Request':'1'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.오류||'요청을 처리하지 못했어요.');조회번호++;응답.글쓰기=[j,...(응답.글쓰기||[]).filter(x=>x.id!==j.id)];await 가져오기();}
  catch(e){쓰기오류(e.message);await 가져오기();}
  finally{쓰기요청중=false;쓰기서명='';그리기();}
}
시작();
