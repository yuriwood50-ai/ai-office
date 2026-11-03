// 모델 클라이언트: Mock(가짜 응답)과 Real(실제 AI, 이번 MVP에서는 연결하지 않았어요).
// 이 파일은 child_process·네트워크·runner.js를 불러오지 않아요. 그래서 Mock 모드에서는 실제 AI가 실행될 길이 없어요.
'use strict';
const { 마감읽기 } = require('./deadline');

const 칸 = (본문, 이름) => { const m = new RegExp(`^\\s*${이름}\\s*[:：]\\s*(.+)$`, 'm').exec(본문); return m ? { 값: m[1].trim(), 근거: m[0].trim() } : null; };

class MockClient {
  constructor() { this.mock = true; this.호출수 = 0; this.이름 = 'MockClient'; }
  // 입력: { 공고들: [{ id, 공고명, 기관명, 본문, mock? }], 공통문맥 }  출력: { 결과: [...] }
  async extract({ 공고들 }) {
    this.호출수++;
    const 힌트 = 공고들.map((p) => p.mock).find((h) => h && h.오류);
    if (힌트) {
      if (힌트.오류 === 'limit') throw Object.assign(new Error('(Mock) 사용 한도에 도달했어요'), { kind: 'limit' });
      if (힌트.오류 === 'transient') throw Object.assign(new Error('(Mock) 일시적인 연결 오류'), { kind: 'transient' });
      if (힌트.오류 === 'schema') return { 잘못된: '형식' };
      if (힌트.오류 === '거대응답') return { 결과: 공고들.map((p) => ({ id: p.id, 필드: {}, 적합도: { 판정: '확인 필요', 미충족: [], 확인필요: [], 근거: ['가'.repeat(30000)] } })) };
    }
    return {
      결과: 공고들.map((p) => {
        const 본문 = p.본문 || '';
        const 필드 = {};
        for (const 이름 of ['대상', '장소', '시간대', '금액', '자격', '제출서류', '접수방법']) { const c = 칸(본문, 이름); if (c) 필드[이름] = c; }
        const 분야 = 칸(본문, '분야'); if (분야) 필드.분야 = { 값: 분야.값[0], 근거: 분야.근거 };
        const 마 = 칸(본문, '마감');
        if (마) { const 읽음 = 마감읽기(마.값); 필드.접수마감 = { 값: 읽음.날짜, 근거: 마.근거 }; }
        if (p.mock?.마감환각) 필드.접수마감 = { 값: p.mock.마감환각, 근거: `마감: ${p.mock.마감환각}` }; // 원문에 없는 날짜를 지어내는 AI 흉내
        const 자격 = 필드.자격?.값 || '';
        const 확인 = 칸(본문, '확인');
        const 적합도 = /법인\s*(사업자)?\s*만/.test(자격)
          ? { 판정: '부적합', 미충족: ['법인만 지원할 수 있어요'], 확인필요: [], 근거: [필드.자격.근거] }
          : 확인 ? { 판정: '확인 필요', 미충족: [], 확인필요: 확인.값.split(/[;；]/).map((s) => s.trim()).filter(Boolean), 근거: [확인.근거] }
            : { 판정: '적합', 미충족: [], 확인필요: [], 근거: 필드.대상 ? [필드.대상.근거] : [] };
        return { id: p.id, 필드, 적합도 };
      }),
    };
  }
}

// 실제 AI: 이번 구현 범위에서 제외했어요. 연결하려면 runner.js를 이 안에서만(지연 로딩) 쓰고, 도구를 끈 상태로 실행해야 해요.
class RealClient {
  constructor(options = {}) { this.mock = false; this.이름 = 'Claude'; this.options = options; this.준비됨 = !!options.루트 && options.환경?.OFFICE_DISABLE_AI !== '1'; }
  async extract(input) {
    if (!this.준비됨) throw Object.assign(new Error('실제 AI 실행이 꺼져 있어요.'), { kind: 'notimplemented' });
    return require('./realclient').extract(input, this.options);
  }
}

// 실제 모드의 3중 열쇠(설정 모드, 환경 변수, 화면 확인) 중 앞의 둘은 여기서, 마지막은 routes.js에서 확인해요.
function 클라이언트만들기({ 모드, 환경 = {}, 루트, 데이터폴더, 프로필 }) {
  if (모드 === 'real' && 환경.OFFICE_ALLOW_REAL === '1') return new RealClient({ 루트, 환경, 데이터폴더, 프로필 });
  return new MockClient();
}

module.exports = { MockClient, RealClient, 클라이언트만들기 };
