# TabSwirl — Work Log

커밋 단위로 실제로 진행한 작업을 기록한다. PRD §14 부트스트랩 순서를 참조점으로 사용한다.

기록 규칙:
- **시간 정순 (오래된 커밋 → 최근 커밋)**. 항상 파일 맨 아래에 새 항목을 추가한다.
- 항목당: 커밋 해시, 날짜, 한 줄 요약, PRD §14 단계 매핑, 핵심 변경, 결정·트레이드오프(있을 때만), 테스트·검증 결과.
- 커밋을 만들면 곧바로 이 파일에 한 항목을 추가하고 같은(또는 다음) 커밋에 포함시킨다 — 작업 직후 한 번에 처리.

---

## 46accee — 2026-05-12 09:48 KST
**chore: initial commit (PRD, CLAUDE.md, llm prompts)**

- **PRD §14 단계:** 0번 (베이스라인)
- **핵심 변경:**
  - `CLAUDE.md` — 운영 가이드 (사용자가 사전 작성).
  - `docs/TabSwirl-PRD.md` — 제품 PRD v0.3 (사용자가 사전 작성).
  - `src/llm/prompts.ts` — LLM 시스템 프롬프트 + Anthropic tool use 스키마 (사용자가 사전 작성).
  - `.gitignore` — node_modules, dist, .env 등.
- **결정:** git 저장소가 없던 상태였기에 `git init -b main`으로 시작. 사용자가 직접 쓴 파일들을 분리된 베이스라인 커밋으로 박제 → 이후 모든 변경은 AI 작업.
- **검증:** 해당 없음 (베이스라인).

---

## b9a91e7 — 2026-05-12 09:51 KST
**chore: bootstrap project scaffold**

- **PRD §14 단계:** 1번 + 2번
- **핵심 변경:**
  - `package.json` — Vite 6 / crxjs 2 / React 19 / TypeScript 5.9 strict / Tailwind 3 / Vitest 2. 스크립트: `dev` `build` `test` `test:watch` `typecheck`.
  - `tsconfig.json` — strict + `noUncheckedIndexedAccess` + `noImplicitOverride` 등 엄격 옵션 활성, JSX react-jsx.
  - `vite.config.ts` — `@crxjs/vite-plugin`의 `crx({ manifest })` + React 플러그인.
  - `vitest.config.ts` — node 환경, `tests/**/*.test.ts` 패턴, `clearMocks: true`.
  - `tailwind.config.ts`, `postcss.config.js` — UI 마일스톤(M5+) 사전 준비.
  - `manifest.config.ts` — PRD §6.5 그대로 (`tabs` / `tabGroups` / `storage` / `unlimitedStorage`, host_permissions: anthropic, `Cmd+Shift+P` 단축키).
  - `pnpm-workspace.yaml` — pnpm v11의 새 빌드 스크립트 게이트 통과용 `allowBuilds: { esbuild: true }`.
- **결정·발견:**
  - 처음에 pnpm v11이 `[ERR_PNPM_IGNORED_BUILDS]`로 막혔다. 해결책 탐색 중 `pnpm.onlyBuiltDependencies` (package.json) 와 `.npmrc verify-deps-before-run=false` 둘 다 무효 → `pnpm-workspace.yaml`의 `allowBuilds.esbuild: true` 가 동작했다.
  - 매니페스트의 entry point들(`src/popup/index.html`, `src/options/index.html`, `src/background/service-worker.ts`)은 M5+에서 생긴다. **결과: 현재 `pnpm build`는 실패하고, `pnpm test`·`pnpm typecheck`만 통과한다.** 이는 의도된 상태 — M1 목표는 단위 테스트 통과까지.
- **검증:** `pnpm install` 클린, `pnpm typecheck`는 prompts.ts의 미해결 import 한 건만 남김 (다음 커밋에서 해소).

---

## 3ba09eb — 2026-05-12 09:52 KST
**feat(core): add types module (PRD §7 data model)**

- **PRD §14 단계:** 3번
- **핵심 변경:** `src/core/types.ts` — `ChromeGroupColor`, `SavedTab`, `SavedGroup`, `UngroupedBucket`, `Pouch`, `Settings`, `DomainCacheEntry`.
- **결정:**
  - 모든 타입을 structured-cloneable한 평면 객체로만 정의 (no `Map` / `Set` / `Date`). CLAUDE.md "Common traps" §5 준수 — chrome.storage가 직렬화 못 하는 자료형은 처음부터 못 들어가게.
  - `ChromeGroupColor`는 9개 enum로 고정. LLM 응답 검증·`chrome.tabGroups.update` 양쪽 단일 진실.
- **검증:** 이 커밋으로 `src/llm/prompts.ts`의 `import type { ChromeGroupColor } from "../core/types"` 미해결 import가 사라짐 → typecheck 통과.

---

## c7dc4e2 — 2026-05-12 09:53 KST
**feat(core): pouch-store CRUD with Vitest (M1)**

- **PRD §14 단계:** 4번 완료 → CLAUDE.md 마일스톤 M1 종료
- **핵심 변경:**
  - `src/core/pouch-store.ts` — `createPouch` / `getPouch` / `listPouches` / `removePouch`. 저장소 레이아웃은 PRD §6.4 그대로 `pouch:<id>` + `pouches:index` (newest first).
  - `tests/core/pouch-store.test.ts` — 9개 케이스 (round-trip, 순서, totalTabs 합산, optional 필드, 없는 id, 멱등 삭제, 깨진 index 자가 복구, 빈 상태).
  - `tests/helpers/chrome-storage.ts` — Vitest용 in-memory `chrome.storage.local` 목.
- **결정:**
  - `removePouch`는 consume-on-restore의 원시 동작. **멱등**으로 설계해 같은 id에 두 번 호출돼도 안전.
  - `listPouches`는 index에 있는데 실제 pouch가 사라진 항목을 만나면 index를 즉시 보정한다 (자가 복구). 데이터 손실 시나리오에서 UI가 멈추지 않게.
  - id 생성은 `crypto.randomUUID()` — MV3 서비스 워커·Node 19+ 모두 지원.
- **검증:** `pnpm test` 9/9 통과, `pnpm typecheck` 깨끗.

---

## 31fd580 — 2026-05-12 09:55 KST
**docs: add WORK_LOG.md with retrospective entries for commits so far**

- **PRD §14 단계:** 해당 없음 (메타 문서)
- **핵심 변경:** `docs/WORK_LOG.md` 신설. 이 시점까지의 4개 커밋을 회고적으로 기록.
- **결정:** 초기 버전은 역시간순으로 작성했으나 사용자 피드백을 받아 다음 커밋에서 정순으로 재정렬.
- **검증:** 해당 없음.

---

## b13c024 — 2026-05-12 10:01 KST
**docs: reorder WORK_LOG chronologically + codify commit/log rhythm**

- **PRD §14 단계:** 해당 없음 (메타 문서·운영 규칙)
- **핵심 변경:**
  - `docs/WORK_LOG.md` — 역시간순 → 정순 재정렬. 상단 "기록 규칙"에 "맨 아래에 추가" 명시.
  - `CLAUDE.md` — "Working rhythm — 커밋 단위 작업 + WORK_LOG" 섹션 신설. 작업을 의미 있는 커밋 단위로 쪼개고, 커밋 직후 WORK_LOG에 항목을 추가한다는 규칙 코드화.
- **결정:** WORK_LOG 추가분은 같은 커밋에 포함하거나 별도 커밋 둘 다 허용. 단, 시간 간격은 짧게.
- **검증:** 해당 없음.

---

## 648fcdd — 2026-05-12 19:29 KST
**feat(llm): anthropic.ts — Messages API + tool-use validation (PRD §14 #5)**

- **PRD §14 단계:** 5번
- **핵심 변경:**
  - `src/llm/anthropic.ts` — raw `fetch`로 Anthropic Messages API 호출. 헤더 3종(`x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`). `tool_choice`로 `classify_tabs` tool 강제. BYOK 키는 `chrome.storage.local`의 `byok:anthropic`에서 읽음.
  - 응답 검증 4개(CLAUDE.md §5): tab_id 존재 / color enum / 그룹명-color 일관성 / assignments 길이. 추가로 duplicate tab_id도 reject.
  - 결과는 tagged result (`ok: true | false` + `kind`). 호출자가 ungrouped fallback 결정. 모듈은 never throws.
  - `tests/llm/anthropic.test.ts` — 11 케이스 (happy / missing-key / network / http / no-tool-call / validation 5종 / incremental).
  - `tests/helpers/fetch-mock.ts` — `vi.stubGlobal("fetch", ...)` 헬퍼. 큐 기반 응답 + 요청 기록.
- **결정:**
  - SDK 미사용 (CLAUDE.md §6.1 mandate). MV3 SW 번들 크기 최소.
  - 응답 파싱은 unknown-first 패턴. content 블록 타입을 좁히지 않고 `Record<string, unknown>`으로 캐스팅 후 필드별 검사. 외부 API 응답을 신뢰하지 않음.
  - validation에서 duplicate tab_id를 명시적으로 reject — 같은 탭을 두 그룹에 넣는 모델 환각 방지.
- **검증:** `pnpm test` 20/20 통과 (기존 9 + 신규 11). `pnpm typecheck` 깨끗.

---

## 1cd51d7 — 2026-05-12 19:30 KST
**feat(core): isClassifiable predicate + extractDomain helper**

- **PRD §14 단계:** 14번을 미리 분리해 단일 진실 함수로. CLAUDE.md §6 mandate.
- **핵심 변경:**
  - `src/core/tabs.ts` — `isClassifiable(tab)` 술어. `incognito` / `pinned` / 내부 프로토콜 URL(`chrome://` `chrome-extension://` `about:` `edge://` `brave://` `opera://` `vivaldi://` `view-source:` `devtools://`) / 빈 title 거부. `extractDomain(url)` 헬퍼 — URL 파싱 실패 시 원본 반환.
  - `tests/core/tabs.test.ts` — 15 케이스 (각 제외 사유, URL 파싱 fallback).
- **결정:**
  - 이 함수를 일찍 만들어두면 이후 단계(initial-classifier, tab-listener)에서 인라인 체크 유혹이 사라진다.
  - 내부 프로토콜 리스트에 Chrome 외 브라우저 prefix도 포함 — 익스텐션이 Edge·Brave 등에서도 동작.
- **검증:** 35/35 통과.

---

## 알려진 미해결 / 다음 작업으로 넘긴 사항

- **PRD ↔ CLAUDE.md 경로 불일치:** CLAUDE.md는 `docs/PRD.md`로 참조하나 실제 파일은 `docs/TabSwirl-PRD.md`. 다음 세션에서 둘 중 하나로 정리 필요.
- **PRD §6.6의 폴더 이름 오기:** `tabpouch/` → `tabswirl/`. 순수 표기 문제.
- **`pnpm build` 미가용:** 매니페스트가 가리키는 entry point들이 아직 없어 빌드 불가. PRD §14 단계 5~11 진행하며 자연스럽게 해소된다.

---

## 다음 단계 — PRD §14 5번

`src/llm/anthropic.ts` 작성. 요구:
- raw `fetch`로 `https://api.anthropic.com/v1/messages` 호출 (SDK 미사용).
- 필수 헤더: `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, `x-api-key`.
- BYOK 키는 `chrome.storage.local`의 `byok:anthropic`에서 읽음.
- 응답의 tool_use 블록을 PRD/CLAUDE.md §5의 4개 검증 (`tab_id` 존재, color enum, 그룹명-color 일관성, assignments 길이)으로 게이트.
- 실패 시 조용히 ungrouped fallback — crash 금지.
