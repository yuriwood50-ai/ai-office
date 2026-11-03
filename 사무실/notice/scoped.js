'use strict';
const path = require('node:path');
const { 종류, 프로필 } = require('./profiles');

// 기존 강사 저장 경로는 유지해요. 추가 분야만 하위 폴더를 써서 기존 기록을 옮기거나 덮지 않아요.
function createScopedApi(options, createSingle) {
  const apis = new Map(); let 선택 = 'instructor';
  function get(id) {
    const p = 프로필(id);
    if (!apis.has(id)) {
      const 환경 = { ...options.환경, OFFICE_PROFILE: id };
      if (id !== 'instructor') {
        const parent = apis.get('instructor');
        const base = parent.store.root;
        환경.OFFICE_MODE = parent.방식.모드;
        환경.OFFICE_DATA_DIR = path.join(base, '분야', id);
      }
      apis.set(id, createSingle({ ...options, 환경, 프로필: p, 공통사용량: apis.get('instructor')?.store, 상위모드: apis.get('instructor')?.방식.모드 }));
    }
    return apis.get(id);
  }
  const base = get('instructor');
  return { ...base,
    async handle(req) {
      try {
        if (req.method === 'GET' && req.pathname === '/api/notice/profiles') return { status: 200, body: { 종류: Object.values(종류) } };
        const id = req.query?.get('종류') || 'instructor';
        const api = get(id); 선택 = id;
        return await api.handle(req);
      } catch (e) { return { status: e.status || 500, body: { 오류: e.status ? e.message : '검색 종류를 읽지 못했어요.' } }; }
    },
    방상태() { return get(선택).방상태(); },
    종료() { for (const api of apis.values()) api.종료(); },
  };
}
module.exports = { createScopedApi };
