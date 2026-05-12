# TabSwirl — Claude Code Operating Guide

> 이 파일을 가장 먼저 읽고, 그 다음 `docs/PRD.md`를 읽은 뒤 코드 작성을 시작할 것.

---

## What this is

TabSwirl은 Manifest V3 Chrome 익스텐션이다. 세 가지를 한다:

1. 열려있는 탭을 LLM이 실시간으로 컬러 코드된 카테고리로 자동 분류한다.
2. 사용자가 일부 또는 전체 탭을 "Stash"하면, 분류 정보까지 통째로 **Pouch**(영구 저장 묶음)에 들어간다.
3. **Pouch는 복원하는 순간 삭제된다(consume-on-restore).** 이게 제품의 정의적 시맨틱이다.

두 개의 시간 스케일:

```
[Working memory]                       [Long-term memory]
탭 바의 자동 분류 그룹                    Pouch (복원 전까지 영구)
       ↓ Stash                          ↓ Restore (소모)
탭들이 닫히고 Pouch에 들어감              탭들이 다시 열리고 Pouch는 소멸
```

---

## Read these in order before coding

1. `CLAUDE.md` (this file) — operating guide
2. `docs/PRD.md` — full product spec, data model, work order
3. `src/llm/prompts.ts` — LLM contract (system prompts + tool schema)

PRD와 이 파일이 충돌하면 **PRD가 우선**이다. 충돌을 발견하면 멈추고 알릴 것.

---

## Stack (PRD §6.1과 동일)

- Manifest V3 Chrome Extension
- TypeScript (strict mode)
- Vite + `@crxjs/vite-plugin`
- React + Tailwind CSS (popup, options 페이지)
- pnpm
- Vitest (unit tests)
- Anthropic API via **raw `fetch`** — SDK 사용 안 함 (MV3 service worker 가볍게 유지)

---

## Folder structure

`docs/PRD.md` §6.6 그대로. 이 파일에서 다시 옮기지 않는다 — 단일 출처(single source of truth) 유지. 구조 변경 시 PRD부터 업데이트.

---

## Commands

```bash
pnpm install         # 의존성 설치
pnpm dev             # Vite + crxjs HMR. dist/ 를 unpacked extension으로 로드
pnpm build           # 프로덕션 빌드 → dist/
pnpm test            # Vitest 실행
pnpm typecheck       # tsc --noEmit
```

---

## Critical invariants (절대 위반 금지)

이건 선호가 아니라 시맨틱이다. 깨면 제품이 무너진다.

### 1. Storage discipline

| Storage | 용도 |
|---|---|
| `chrome.storage.local` | Pouches (영구), settings, BYOK 키 |
| `chrome.storage.session` | domain cache, debounce 큐 상태, `restoringTabIds` flag |

**절대 섞지 말 것.** Pouch를 session에 넣으면 재시작 시 데이터 손실. 캐시를 local에 넣으면 세션 간 stale.

키 prefix는 PRD §6.4 표 그대로 사용.

### 2. Consume-on-restore

Pouch의 탭이 브라우저에 다시 만들어지는 순간, 해당 Pouch는 `chrome.storage.local`에서 **반드시 제거**된다.

이게 제품의 정의 시맨틱이다. 사용자가 "복원했는데 Pouch가 그대로 있어요"라고 보고하면 P0 버그다.

### 3. Auto-classify must not touch restoring tabs

복원 시 탭은 그룹·컬러가 이미 정해진 상태로 만들어진다. `src/background/tab-listener.ts`의 `onUpdated` 핸들러는 `restoringTabIds` Set을 체크해 해당 탭은 분류 스킵해야 한다.

복원 완료 후 약 1.5초 뒤에 Set을 비운다.

### 4. Service worker lifecycle (MV3)

MV3 서비스 워커는 약 30초 idle 후 종료된다.

- 디바운스 타이머를 모듈 레벨 변수에만 두지 말 것 — SW가 죽으면 사라진다.
- 디바운스 큐를 `chrome.storage.session`에 persist하고, SW가 깨어날 때 (`chrome.runtime.onStartup`, 이벤트 핸들러 재호출) 큐를 재구성한다.
- 또는 `chrome.alarms.create`로 타이머 대체 가능하지만 최소 30초 단위라 디바운스용으론 적합하지 않다.

### 5. LLM 호출은 게이트된다

- 모든 LLM 호출은 `src/llm/anthropic.ts`만 통해 나간다.
- 모든 프롬프트는 `src/llm/prompts.ts`에 모인다. 인라인 문자열 금지.
- 응답 파싱은 tool schema에 대해 반드시 검증한다:
  - 모든 `tab_id`가 입력에 있던 것인지
  - `color`가 9개 enum 중 하나인지
  - 같은 `group_name`은 같은 `color`로 일관 배정됐는지
  - `assignments` 길이가 입력 탭 수와 일치하는지
- 검증 실패 시: 해당 배치 분류 폐기, 탭은 ungrouped로 두고 조용히 fallback.

### 6. Exclusion rules (auto-classification)

다음은 절대 분류 대상에 포함하지 않는다:
- incognito 탭
- pinned 탭
- `chrome://*`, `about:*`, `chrome-extension://*`, `edge://*` 등 내부 URL
- title이 비어있는 로딩 중 탭

단일 진실: `src/core/tabs.ts`의 `isClassifiable(tab: chrome.tabs.Tab): boolean` 술어 함수 하나만 사용. 다른 곳에서 같은 체크를 인라인으로 짜지 말 것.

---

## Documentation-first principle (공식 문서 우선)

기억과 패턴 매칭이 아니라 **공식 문서에 기반해 작업한다.** 이 원칙은 양보 불가능하다. Chrome Extension MV3는 API surface가 빠르게 바뀌고, deprecated/removed된 메서드를 기억에 의존해 호출하면 조용한 버그로 이어진다.

### 1순위 출처 (이걸 먼저 본다)

| 영역 | 공식 출처 |
|---|---|
| Chrome Extensions / Manifest V3 | https://developer.chrome.com/docs/extensions |
| `chrome.*` API (tabs, tabGroups, storage, runtime, action, commands) | https://developer.chrome.com/docs/extensions/reference/api |
| Anthropic API (messages, tool use, headers) | https://docs.anthropic.com |
| Vite | https://vitejs.dev |
| `@crxjs/vite-plugin` | https://crxjs.dev/vite-plugin |
| React | https://react.dev |
| Tailwind CSS | https://tailwindcss.com/docs |
| Vitest | https://vitest.dev |
| TypeScript | https://www.typescriptlang.org/docs |

### 어떻게 활용하는가

- **API 시그니처·옵션·에러 동작이 의심스러우면 추측하지 말고 가져온다.** 도구 사용 가능하면 `web_fetch` / `web_search`로 공식 문서를 직접 읽고 작업.
- **StackOverflow · 블로그 글 · 자기 기억은 보조 출처일 뿐.** 공식과 충돌하면 공식이 이긴다.
- **존재하지 않는 메서드를 만들지 말 것.** 익숙해 보이는 API가 실제론 deprecated거나 MV2 잔재인 경우가 흔하다 (예: `chrome.extension.*` 대부분, `chrome.tabs.executeScript` 등). 의심 시 반드시 확인.
- **버전 차이를 인지한다.** `chrome.tabGroups`는 Chrome 89+, `chrome.storage.session`은 Chrome 102+. PRD §6.5 권한과 API 가용성이 일치하는지 확인.
- **Anthropic API**: tool use 응답 구조, 필수 헤더(`anthropic-version`, `anthropic-dangerous-direct-browser-access`), error 코드 — 코드 작성 전 docs.anthropic.com에서 한 번 확인.

### 코드 주석으로 출처 남기기

비표준·헷갈리기 쉬운 동작에는 짧은 출처 코멘트를 남긴다:

```ts
// chrome.storage.session: in-memory only, cleared on browser shutdown.
// Ref: https://developer.chrome.com/docs/extensions/reference/api/storage#property-session
```

이 한 줄이 6개월 후 디버깅 시간을 줄인다.

### 모르면 멈춘다

문서를 찾을 수 없거나 정보가 모순될 때: **추측하지 말고 멈춰서 사용자에게 알린다.** 잘못된 가정으로 30분 작업하는 것보다 명확화에 1분 쓰는 게 항상 싸다.

---

## Common traps

1. **`chrome.tabGroups.update` color는 enum**: `grey | blue | red | yellow | green | pink | purple | cyan | orange`. 다른 문자열은 throws. LLM tool schema가 이미 제약하지만 응답 받은 후에도 다시 검증한다.

2. **Tab ID는 재시작 시 바뀐다.** Pouch에는 `id`가 아니라 `url`을 저장한다 (PRD §7 `SavedTab` 참고).

3. **`chrome.tabs.create({url})`** 의 반환값에 새 tab `id`가 있다. 이걸로 `chrome.tabGroups.group()` 호출한다.

4. **`chrome.tabGroups.group`** 은 모든 탭이 같은 윈도우에 있어야 한다. 윈도우 단위로 그룹화한다.

5. **`chrome.storage`는 structured-cloneable 직렬화.** `Map`, `Set`, `Date`를 직접 넣지 말 것. 평범한 객체/배열로 변환해서 저장.

6. **Manifest는 `manifest.config.ts`에서 정의** (crxjs). 정적 JSON 아님. `@crxjs/vite-plugin`의 `defineManifest` 사용.

7. **Anthropic API 호출 시 `anthropic-version` 헤더 필수.** 현재 권장: `2023-06-01`. tool use는 이 버전에서 지원됨. CORS 우회를 위해 `anthropic-dangerous-direct-browser-access: true` 헤더도 추가 (브라우저 확장에서 직접 호출 시).

---

## Work order

`docs/PRD.md` §14를 그대로 따른다. UI 만지기 전에 분류 큐와 Pouch store가 단위 테스트 통과한 상태여야 한다.

마일스톤:

- **M1**: Pouch CRUD + Vitest 통과
- **M2**: 단일 LLM 호출로 initial bulk classify 성공 (UI 없이, background console에서 실행)
- **M3**: domain cache + debounce 큐 + incremental classify
- **M4**: tab listener 연결, 새 탭 열면 자동 분류 작동
- **M5**: popup 최소 UI — 현재 탭 트리
- **M6**: Stash 액션 end-to-end
- **M7**: Pouch 리스트 + Restore + consume

M7까지 가면 MVP 기능 완성. UI 다듬기는 M8 이후.

---

## LLM 호출 규칙

- 모든 호출은 `src/llm/anthropic.ts` 통해서만.
- BYOK 키는 `chrome.storage.local`의 `byok:anthropic` 키에 저장.
- 키 없을 때: 친절한 에러 + 옵션 페이지로 안내. crash 금지.
- 호출 실패(네트워크, rate limit, 응답 검증 실패): 조용히 fallback — 탭들을 ungrouped로 두기. 사용자 워크플로우는 분류 없이도 굴러가야 한다.
- 비용 모니터링: 디버그 빌드에서만 호출 횟수 카운터를 `chrome.storage.session`에 누적, 옵션 페이지에 표시 (production 빌드에선 strip).

---

## When you're stuck

- `docs/PRD.md` §4 (functional requirements), §6.3 (auto-classify 전략) 다시 읽기.
- LLM 계약 관련: `src/llm/prompts.ts`의 tool schema가 최종 진실.
- PRD가 모호하거나 잘못된 것 같으면 **멈추고 사용자에게 알릴 것.** 추측해서 만들지 말 것.
- 새로운 의존성을 추가하기 전에 stop. 가능하면 표준 web/chrome API로 해결할 것.

---

## Out of scope (이번 세션에서 손대지 말 것)

- 사용자 정의 카테고리 룰
- Pouch export / 백업 / 동기화
- 다중 LLM provider (Anthropic Haiku 4.5만)
- 검색 기능
- 워크스페이스 / 프로젝트 개념
- 영구 저장된 글로벌 카테고리 사전

이 중 어느 것도 PRD §10 Phase 2 영역이다. MVP 스코프를 늘리려는 충동을 거부할 것.
