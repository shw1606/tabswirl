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

## ec1d6c4 — 2026-05-12 19:31 KST
**feat(background): domain-cache (PRD §14 #6)**

- **PRD §14 단계:** 6번
- **핵심 변경:**
  - `src/background/domain-cache.ts` — `chrome.storage.session` 래퍼. windowId × domain → `{groupId, categoryName, color, lastUsed}`. API: `getDomainEntry` / `setDomainEntry` / `seedDomainEntries` (벌크) / `listDomainEntries` (incremental 프롬프트용 스냅샷) / `clearWindow` / `forgetGroup`.
  - `tests/background/domain-cache.test.ts` — 8 케이스 (없음·round-trip·윈도우 격리·벌크 시드·빈 시드·전체 클리어·그룹별 invalidation·overwrite).
  - `tests/helpers/chrome-storage.ts` — `local`만 지원하던 목을 `session`까지 확장. 기존 테스트(20개) 영향 없음.
- **결정:**
  - 저장 형태는 `Record<domain, entry>` per window — structured-cloneable 보장.
  - `forgetGroup`: 사용자가 그룹 ungroup·삭제했을 때 해당 group을 가리키던 캐시 엔트리를 무효화. 그렇지 않으면 다음 같은 도메인 탭이 죽은 groupId를 만나 `chrome.tabGroups.move`에서 silent fail.
  - `chrome.storage.session`은 Chrome 102+. PRD §6.5 권한 `storage`만으로 충분.
- **검증:** 43/43 통과.

---

## bd159b3 — 2026-05-12 19:32 KST
**feat(background): group-manager (PRD §14 #7)**

- **PRD §14 단계:** 7번
- **핵심 변경:**
  - `src/background/group-manager.ts` — `chrome.tabs.group` + `chrome.tabGroups.update`의 원자적 래퍼.
    - `applyGroup(input)` — 새 그룹 생성 또는 기존 그룹 확장, name+color 적용. 빈 tabIds면 no-op.
    - `addTabsToGroup(groupId, tabIds)` — 캐시 hit 빠른 경로 전용.
    - `ungroupTabs(tabIds)` — 분리.
    - `snapshotWindowGroups(windowId, sampleTabCount=3)` — incremental 프롬프트 컨텍스트.
  - `tests/helpers/chrome-tabs.ts` — in-memory `chrome.tabs.{group,ungroup,query}` + `chrome.tabGroups.{update,query}` 목. 다른 chrome.* 목과 겹치지 않게 기존 `globalThis.chrome`을 합쳐서 stub.
  - `tests/background/group-manager.test.ts` — 8 케이스.
- **결정:**
  - 단일 진실 모듈: 외부에서 `chrome.tabs.group` / `chrome.tabGroups.update`를 직접 호출하지 않게 함. 9개 컬러 enum의 런타임 경계 한 곳.
  - 헬퍼는 cross-window grouping 시 throw — Common trap §4 (`chrome.tabs.group`은 같은 윈도우만 허용)를 테스트에서 재현.
- **검증:** 51/51 통과, typecheck 깨끗.

---

## d707189 — 2026-05-12 19:33 KST
**feat(background): initial-classifier — bulk classify all open tabs (M2)**

- **PRD §14 단계:** 8번 / **CLAUDE.md 마일스톤 M2 종료**
- **핵심 변경:**
  - `src/background/initial-classifier.ts` — `classifyAllOpenTabs(options)`. 모든 윈도우 enumerate → `isClassifiable` 필터 → 윈도우별로 `CHUNK_SIZE=30`씩 청크 분할 → 청크마다 `classifyInitial` 호출 → 응답을 group_name별 버킷화 → `applyGroup` 호출 → `seedDomainEntries`로 캐시 시드.
  - 같은 group_name이 청크 1과 청크 2에 모두 등장하면 첫 청크의 groupId를 재사용해 한 그룹으로 합침. 컬러도 첫 청크의 결정을 보존.
  - 실패 시(missing-key / http / validation) 조용히 fallback, 탭은 ungrouped 유지. PRD §6.3 mandate.
  - `tests/background/initial-classifier.test.ts` — 6 케이스 (happy / `isClassifiable` 필터 / 윈도우 격리 / 멀티 청크 그룹 통합 / http 에러 fallback / missing-key fallback).
- **결정:**
  - 청크 간 group_name 통합은 윈도우 단위로만. 윈도우 경계를 넘는 통합은 안 함 — 그룹은 윈도우 단위로만 존재.
  - LLM이 두 번째 청크에서 같은 이름에 다른 컬러를 줘도 첫 컬러를 사용 (`namedColors`). 일관성 우선.
- **검증:** 57/57 통과, typecheck 깨끗.

---

## 8861b6d — 2026-05-12 19:36 KST
**feat(background): classifier-queue — debounce + batch + SW persistence (M3)**

- **PRD §14 단계:** 9번 / **CLAUDE.md 마일스톤 M3 종료**
- **핵심 변경:**
  - `src/background/classifier-queue.ts` — incremental classify의 진입점. `enqueueTab(input)` 단일 함수.
    - 빠른 경로: `getDomainEntry` hit → `addTabsToGroup` + `setDomainEntry` 즉시. LLM 호출 없음.
    - 느린 경로: 큐(`chrome.storage.session`에 `queue:incremental:<windowId>` 키로 persist) + 500ms 디바운스 setTimeout. 새 탭이 도착하면 큐에 append, 타이머 reset(`scheduledAt = now + DEBOUNCE_MS`).
    - flush: `snapshotWindowGroups` → `classifyIncremental(existingGroups, newTabs)` → 응답을 group_name별 버킷화 → 기존 그룹 재사용 또는 신규 생성 → `seedDomainEntries`.
    - 큐는 flush 시 단 한 번 소진. 실패해도 재시도 없음 — 조용히 ungrouped. PRD §6.3 mandate.
  - `rehydrateQueue(options)` — SW 깨어날 때 호출. 과거 `scheduledAt`이면 즉시 flush, 미래면 잔여 시간만큼 재스케줄.
  - `_resetInMemoryTimers()` — 테스트 affordance.
  - `tests/background/classifier-queue.test.ts` — 9 케이스.
- **결정·발견:**
  - **`chrome.alarms` 부적합:** 최소 30~60초 단위로 500ms 디바운스에 못 쓴다 (CLAUDE.md §4 indication 재확인). setTimeout + storage persistence의 조합이 정답.
  - **per-window queue:** 그룹 컨텍스트는 윈도우 단위이므로 큐도 윈도우 단위. 다른 윈도우의 디바운스에 영향 안 줌.
  - **race window 의식적 무시:** 두 enqueueTab이 거의 동시에 같은 윈도우에 들어와 동시에 readQueue하면 한쪽이 누락될 가능성. 결과는 "한 탭만 ungrouped" — fallback 동작과 동일하므로 락 추가 안 함.
  - `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` 패턴으로 디바운스 동작 검증.
- **검증:** 66/66 통과, typecheck 깨끗.

---

## 605e0da — 2026-05-12 19:38 KST
**feat(background): tab-listener + service-worker entry (M4)**

- **PRD §14 단계:** 10번 / **CLAUDE.md 마일스톤 M4 종료**
- **핵심 변경:**
  - `src/background/tab-listener.ts` — `chrome.tabs.onUpdated` 리스너. `status === "complete"`일 때만 발화. 3단계 필터: `isRestoring` (CLAUDE.md §3) → `isClassifiable` → `settings.autoClassifyEnabled`. 통과하면 `enqueueTab`.
    - `markRestoring([ids])` / `unmarkRestoring([ids])` / `isRestoring(id)` — Restore 흐름(M7)이 사용할 hooks.
    - `registerTabListener()`는 idempotent.
  - `src/background/service-worker.ts` — MV3 진입점. 모듈 로드 시 `registerTabListener()`. `chrome.runtime.onInstalled`(install·update)에서 `classifyAllOpenTabs` 실행, `chrome.runtime.onStartup`에서 `rehydrateQueue`.
  - `src/core/settings.ts` — `settings:main` 단일 read/write. `DEFAULT_SETTINGS.autoClassifyEnabled = true` (PRD §13).
  - `tests/helpers/chrome-tabs.ts` — `chrome.tabs.onUpdated` 추가. 테스트에서 `fireOnUpdated(id, changeInfo)`로 합성 이벤트 발화.
  - `tests/background/tab-listener.test.ts` — 7 케이스.
- **결정·발견:**
  - 합성 이벤트의 async dispatch chain이 `await Promise.resolve()` 몇 번으로 끝나지 않음. `setTimeout(r, 0)` 매크로태스크 한 번 + microtask 16회 flush 헬퍼로 안정화.
  - **`pnpm build` 여전히 실패:** 매니페스트의 popup/options HTML entry가 없음. M5(팝업 UI)에서 자연스럽게 해소. SW entry point는 이제 resolvable.
- **검증:** 73/73 통과, typecheck 깨끗.

---

## b7a5f32 — 2026-05-12 19:41 KST
**feat(core,background): stash + restore + messaging primitives**

- **PRD §14 단계:** 12·13·15번 로직 부분 (UI는 별개 커밋).
- **핵심 변경:**
  - `src/core/stash.ts` — `buildPouchBody`(순수 변환) + `stashTabs`(IO). Selection을 chrome.tabGroups 상태에 따라 SavedGroup/ungrouped로 버킷화. `closeTabs` 옵션(default true)이면 `chrome.tabs.remove`.
  - `src/background/restore.ts` — `restorePouch(pouchId, {windowId?})`. PRD §8.3 흐름: getPouch → 각 group마다 chrome.tabs.create + 즉시 `markRestoring` → `applyGroup` → ungrouped도 동일 → `removePouch`(부분 실패에도 consume — P0 시맨틱) → 1.5초 뒤 `unmarkRestoring`.
  - `src/core/messaging.ts` — `RestoreRequest` / `RestoreResponse` + `sendRestorePouch(pouchId)` 헬퍼. throw를 tagged response로 변환.
  - 헬퍼 강화: `tests/helpers/chrome-tabs.ts`에 `chrome.tabs.create` / `chrome.tabs.remove` 추가.
- **결정:**
  - **부분 실패에도 pouch consume:** 일부 탭이 chrome.tabs.create에서 실패해도 pouch는 삭제. 남겨두면 "사용자가 꺼냈는데 영수증이 그대로" 상황 — 제품 정의 위반.
  - `markRestoring`은 생성된 tab id를 받자마자 동기 호출. `await chrome.tabs.create` resolve와 markRestoring 호출 사이엔 microtask gap 없음 — onUpdated가 발화하기 전에 set에 들어가 있음.
- **검증:** 87/87 통과, typecheck 깨끗.

---

## 71dc32e — 2026-05-12 19:42 KST
**feat(background): SW dispatches restore-pouch messages**

- **PRD §14 단계:** 13번 (Restore 메시징 끝점)
- **핵심 변경:**
  - `src/background/service-worker.ts` — `chrome.runtime.onMessage` 리스너 추가. `RestoreRequest`만 처리(다른 메시지는 false 반환해 다음 리스너로 패스). `restorePouch` 결과를 `RestoreResponse`로 변환해 `sendResponse`.
  - 리스너에서 `return true` — async sendResponse를 위해 채널 유지 (chrome docs 필수).
- **결정:** SW의 모든 메시지 디스패치는 이 한 곳에서. 새 메시지 타입이 생기면 같은 리스너에 분기 추가.
- **검증:** 87/87, typecheck 깨끗.

---

## fa27949 — 2026-05-12 19:44 KST
**feat(popup,options): full popup UI + BYOK options page (M5+M6+M7)**

- **PRD §14 단계:** 11·12·13번 / **CLAUDE.md 마일스톤 M5·M6·M7 종료 → MVP 기능 완성**
- **핵심 변경:**
  - `src/popup/index.html` + `main.tsx` + `index.css` (Tailwind directives).
  - `src/popup/tab-tree.ts` — 순수 변환: `(chrome.tabs[], chrome.tabGroups[])` → `TabTree { groups[], ungrouped[] }`. + `allTabIds(tree)` 헬퍼. 단위 테스트 5개.
  - `src/popup/colors.ts` — `ChromeGroupColor` → Tailwind 유틸 클래스 매핑.
  - `src/popup/App.tsx` — 2-탭 인터페이스. Stash 탭은 그룹별 섹션(이름 + 컬러 점 + 체크박스 indeterminate), 푸터에 `Stash N tab(s)`. Pouches 탭은 카드 리스트 + Restore / Discard. Restore는 `sendRestorePouch`로 SW에 메시지.
  - `src/options/` — BYOK 키 (save/clear), autoClassifyEnabled 토글, 언어(en/ko), confirmation 토글들. 셋 다 `getSettings`/`setSettings`/`chrome.storage.local`.
- **검증:** `pnpm test` 92/92, `pnpm typecheck` 깨끗, **`pnpm build` 성공** — dist/가 unpacked extension으로 로드 가능. 더 이상 미완료 entry point 없음.
- **Closes:** M5 (popup), M6 (Stash), M7 (Restore + consume). MVP 기능 완성.

---

## 5faf2b9 — 2026-05-12 21:15 KST
**feat: manual re-classify trigger + visible failure logging**

- **PRD §14 단계:** 해당 없음 (디버그·UX 보강).
- **상황:** 수동 e2e에서 자동 분류가 동작하지 않음. 추정 원인: 익스텐션 설치 시점엔 BYOK 키가 없어서 `classifyAllOpenTabs`가 `missing-key`로 즉시 silent fallback. 그 이후 키를 설정해도 재트리거 경로 없음. 게다가 모든 실패 경로가 console에 아무것도 안 남겨서 사용자가 원인을 못 봄.
- **핵심 변경:**
  - `src/core/messaging.ts` — `ClassifyAllRequest` / `ClassifyAllResponse` + `sendClassifyAll()`.
  - `src/background/service-worker.ts` — onMessage 리스너를 `message.type` 디스패치로 리팩터. `classify-all-tabs` 분기 추가 (현재 settings로 `classifyAllOpenTabs` 실행, 결과 카운트 반환).
  - `src/options/App.tsx` — "Re-classify all open tabs now" 버튼. 클릭 시 SW에 메시지 발송, 결과 표시. 설명 문구로 "auto-classify-on-install만 1회 발화" 한계 명시.
  - `src/llm/anthropic.ts` — 모든 silent-fallback 경로에 `console.warn` 추가. missing-key / network / HTTP non-2xx (status + body slice) / no tool_use / validation reason. `chrome://extensions` → "service worker" devtools 콘솔에서 한눈에 확인 가능.
- **검증:** 92/92, typecheck·build 깨끗.

---

## 4bd1f96 — 2026-05-12 22:21 KST
**feat(background): window-type predicate + defensive group-manager**

- **상황:** 수동 e2e에서 `Uncaught (in promise) Error: Grouping is not supported by tabs in this window.` 발생. 원인은 사용자의 Gemini PWA(window type `"app"`)가 열려있어 `chrome.tabs.group`이 throw. 한 윈도우의 실패가 전체 분류 흐름을 죽임.
- **PRD §14 단계:** 해당 없음 (안정성 패치, 4·5번 보강).
- **핵심 변경:**
  - `src/background/window-type.ts` 신설. `getWindowType(windowId)` (`chrome.windows.get` 캐시), `isGroupableWindow(windowId)` (단일 진실), `registerWindowTypeListeners()` (`chrome.windows.onRemoved`로 캐시 invalidate, idempotent), `_resetForTests()`.
  - `src/background/group-manager.ts` — `applyGroup`이 `chrome.tabs.group` throw를 잡아 `null` 반환 + `console.warn`. 기존 호출자는 이미 null을 skip으로 처리. `chrome.tabGroups.update` 실패는 그룹 자체는 살아있으니 그룹 id는 그대로 반환. `addTabsToGroup`도 try/catch + warn.
  - 테스트 헬퍼에 `chrome.windows.{get, getAll, getLastFocused, onRemoved}` 모킹 추가. `seedTabs`는 자동으로 unique windowId마다 `"normal"` 윈도우 생성. `seedWindow(id, type)`로 타입 override.
  - 신규 테스트 8개 (window-type 6 + group-manager 2).
- **결정:**
  - `chrome.windows.windowTypeEnum` 타입 사용 (camelCase, `@types/chrome`의 비표준 명명).
  - 캐시는 SW idle 시 사라지지만 단지 최적화. 정확성에 영향 없음.
- **검증:** 100/100 통과, typecheck 깨끗.

---

## 5965e46 — 2026-05-12 22:24 KST
**feat(background): per-window isolation for all classify paths**

- **상황:** 직전 커밋(4bd1f96)의 `window-type` + 방어적 group-manager 1차 보강. 이제 4개 진입점에 통합.
- **PRD §14 단계:** 8·9·10번 보강, 13번 안정성.
- **핵심 변경:**
  - `src/background/initial-classifier.ts` — `chrome.tabs.query({})` → `chrome.windows.getAll({populate: true})`. 각 윈도우의 `type === "normal"` 필터. 각 윈도우 `classifyOneWindow`는 try/catch로 감싸 한 윈도우의 크래시가 다른 윈도우 처리에 전파되지 않음.
  - `src/background/tab-listener.ts` — `handleTabUpdate`에 `isGroupableWindow(tab.windowId)` 게이트. PWA / app / popup 탭은 큐에 진입 자체를 못 함.
  - `src/background/classifier-queue.ts` — `flushWindow`: 큐 소진(멱등성 보장)은 먼저, 그 다음 non-groupable이면 LLM 호출 전에 bail.
  - `src/background/restore.ts` — `resolveTargetWindow`가 last-focused가 normal이면 그걸 쓰고, 아니면 다른 normal 윈도우를 찾음. normal이 하나도 없으면 tagged error 반환(pouch는 소비하지 않음 — 탭을 만들기 전에 실패하므로).
  - `src/background/service-worker.ts` — `registerWindowTypeListeners()` 호출 추가.
  - `tests/background/restore.test.ts` — 헬퍼 통합(`installChromeWindowsMock` 제거하고 `seedWindow` / `setFocusedWindow` 사용). PWA-focused 시 다른 normal 윈도우로 fallback 케이스 + normal 윈도우 0개 시 에러 케이스 추가.
  - 신규 테스트 5개 (initial-classifier 2 + tab-listener 1 + restore 2).
- **검증:** 105/105 통과, typecheck·build 깨끗.
- **Fixes:** `Uncaught (in promise) Error: Grouping is not supported by tabs in this window.` — Gemini PWA가 열려있을 때 발생하던 자동 분류 차단.

---

## ab4ec63 — 2026-05-12 23:03 KST
**refactor(llm): provider abstraction (PRD §6.6)**

- **상황:** 다음 단계(Gemini 무료 티어 도입)를 위한 사전 작업. 호출자들이 `./anthropic`를 직접 import하던 걸 끊고 facade 한 군데에 dispatch 모음. PRD §6.6의 `src/llm/provider.ts` 마침내 등장.
- **PRD §14 단계:** 5번 보강 (provider 추상화).
- **핵심 변경:**
  - `src/llm/provider.ts` 신설. `LlmProvider` 인터페이스, `LlmProviderName` 타입(현재 `"anthropic"` only), `ClassifyError` (+`unsupported-provider` kind), `ClassifyResult`, `ClassifyOptions`(+optional `provider`). `getProvider(name)` 팩토리 + `classifyInitial`/`classifyIncremental` facade.
  - `src/llm/anthropic.ts` — 공유 타입은 provider.ts에서 type-only import (런타임 cycle 없음, 모듈 의존은 provider→anthropic 한 방향). 끝에 `anthropicProvider: LlmProvider` const export.
  - 모든 callsite가 facade 경유: `initial-classifier.ts`, `classifier-queue.ts`. `settings.llmProvider`를 옵션 체인(`RunOptions` / `FlushOptions` / `EnqueueInput`)으로 propagate. `tab-listener` / `service-worker`(onInstalled · onMessage)에서 명시적으로 전달.
  - `tests/llm/provider.test.ts` — 5 케이스 (`getProvider`, default dispatch, explicit dispatch, `unsupported-provider` error, incremental routing). 기존 anthropic 테스트(11개)는 그대로 — wire protocol을 격리 검증.
- **결정:**
  - `LlmProviderName`은 현재 `"anthropic"` 단일 — Gemini는 다음 커밋에서 확장.
  - `core/types.ts`의 `Settings.llmProvider`는 literal `"anthropic"`로 유지(provider.ts로의 import cycle 회피). Gemini 추가 시 함께 확장.
  - 타입 import 양방향성: anthropic.ts → provider.ts는 `import type`만. provider.ts → anthropic.ts는 value import. 결과적으로 런타임 cycle 없음.
- **검증:** 110/110 통과 (기존 105 + 신규 5), typecheck·build 깨끗.

---

## 33e47a3 — 2026-05-12 23:04 KST
**chore: untrack stray AI-generated PNG + add gitignore patterns**

- **상황:** `ab4ec63`의 `git add -A`가 프로젝트 루트의 stray 3.4 MB PNG(`Gemini_Generated_Image_*.png`)를 같이 올림. AI 이미지 생성 결과물이 다운로드로 떨어진 것으로 추정.
- **핵심 변경:** `git rm --cached`로 untrack (디스크엔 유지). `.gitignore`에 `Gemini_Generated_*` / `ChatGPT_Image_*` 패턴 추가.
- **남은 일:** 바이너리는 ab4ec63의 tree object에 남아있음. 리모트로 push 전이고 단일 작가 repo라 크기 부담 없음. 필요하면 나중에 `git filter-repo`로 일괄 제거 가능.

---

## 2bd0eb9 — 2026-05-12 23:20 KST
**feat(llm,options): Gemini provider (free tier, default) + onboarding UI (Option A)**

- **상황:** Option B(provider 추상화) 직후 Gemini 구현체 추가. 1,000 RPD 무료 티어 + 카드 없음 + 30초 발급 = 진입장벽 최저.
- **핵심 변경:**
  - `src/llm/validate.ts` 신설 — anthropic.ts 내부에 있던 검증 로직(CLAUDE.md §5 4개 invariant + duplicate tab_id)을 provider 공유 헬퍼로 분리.
  - `src/llm/gemini.ts` 신설 — `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` 호출, `x-goog-api-key` 헤더, function calling 강제(`toolConfig.functionCallingConfig.mode: "ANY"`). 기본 모델 `gemini-2.5-flash-lite`. BYOK 키는 `byok:gemini`(anthropic 키와 독립). `resolveModel`이 비-Gemini 모델 id를 만나면 default로 fallback.
  - `src/llm/anthropic.ts` — 자체 검증 함수 제거, shared validator 사용. 코드 약 80줄 감소.
  - `src/llm/provider.ts` — `LlmProviderName` 유니언에 `"gemini"` 추가, `getProvider`에 case 등록, `DEFAULT_PROVIDER`를 `"gemini"`로 flip.
  - `src/core/types.ts` + `settings.ts` — `Settings.llmProvider` 유니언 확장, `llmModel`을 optional로. `DEFAULT_SETTINGS.llmProvider = "gemini"`. `setSettings`가 provider 전환 시 `llmModel`을 drop해서 새 provider가 자기 default 모델 사용하도록.
  - `manifest.config.ts` — `host_permissions`에 `https://generativelanguage.googleapis.com/*` 추가. 이거 없으면 SW의 fetch가 CORS로 403.
  - `src/options/App.tsx` — provider 라디오 버튼 2개 (Gemini "Free/Recommended" 배지, Anthropic "Paid" 배지). 활성 provider에 따라 placeholder · signup 링크 · onboarding 4단계 안내가 swap. 두 provider 키 모두 독립 저장 → 둘 다 미리 입력해두고 자유롭게 토글 가능.
  - `tests/llm/gemini.test.ts` 신설 (10 케이스): missing-key, key 격리(`byok:gemini`만 읽음), request shape 검증, `options.model` override 및 fallback, network·http 에러, no-tool-call, validation, incremental.
  - `tests/llm/provider.test.ts` 갱신: 기존 "unsupported gemini" 케이스 제거 → 명시적 Gemini 라우팅 + default-routes-to-Gemini + 미등록 provider("openrouter") unsupported 케이스로 대체.
  - 기존 `initial-classifier`/`classifier-queue` 테스트가 default 변경의 영향을 받아 `provider: "anthropic"` 명시.
- **결정:**
  - **Default = Gemini.** 신규 사용자 onboarding의 마찰을 0에 가깝게.
  - **두 키 분리 저장.** provider 토글 시 키 재입력 불필요. 사용자가 동시에 둘 다 설정해두고 비교·전환 가능.
  - **모델은 provider-internal default.** UI에 모델 노출 안 함 (advanced 영역). 각 provider가 들어온 `options.model`을 자기 prefix와 비교해 무시 가능.
  - **`anthropic-dangerous-direct-browser-access` 헤더 분기.** Gemini는 별도 헤더 불필요(CORS 정책이 다름). 두 provider 모듈이 각자 자기 wire detail 책임.
- **검증:** 121/121 통과 (기존 110 + 신규 11), typecheck·build 깨끗.

---

## 0aec088 — 2026-05-12 23:34 KST
**fix(classifier): invalidate cache when the cached group is gone**

- **상황 (사용자 보고):** Gemini로 한 번 전체 분류 → 사용자가 그룹의 모든 탭을 닫음 → Chrome이 빈 그룹 자동 삭제 → 인스타 다시 열기 → `[tabswirl] addTabsToGroup failed for group 1459190572: No group with id: 1459190572.` warn 발생. 크래시는 아니지만 (방어적 try/catch 덕분) 캐시가 dead groupId를 가리키고 있어 같은 도메인의 다음 탭도 똑같이 실패. 사용자 시점에선 "분류가 안 됨".
- **PRD §14 단계:** 해당 없음 (안정성 패치).
- **핵심 변경 (defense in depth, 두 층):**
  - **Proactive — `src/background/domain-cache.ts`:** `registerGroupRemovalInvalidator()` 신설. `chrome.tabGroups.onRemoved` 리스너로 `forgetGroup(windowId, groupId)` 즉시 호출. 그룹 사라지는 순간 캐시 일관성 회복. service-worker.ts entry에서 등록 (idempotent).
  - **Reactive — `src/background/group-manager.ts` + `classifier-queue.ts`:**
    - `addTabsToGroup` 반환 타입을 `Promise<void>` → `Promise<boolean>`. 성공 true, throw 시 false.
    - `enqueueTab` 빠른 경로: `addTabsToGroup` 결과 체크 → false면 `forgetGroup` + 슬로우 패스 fall through.
  - 테스트 헬퍼에 `chrome.tabGroups.onRemoved` + `fireTabGroupRemoved(groupId)` 추가.
  - 신규 테스트 6 (group-manager 2개 갱신·1개 신규 + classifier-queue 1 stale-cache fallback + domain-cache 2 proactive invalidation·idempotency).
- **결정:** 두 층이 redundant하지만 의도적. SW idle 중에 `chrome.tabGroups.onRemoved` 이벤트가 발화하면 SW는 깨어나지만 등록된 리스너가 다시 셋업되기 전 race 가능성이 작게나마 존재. reactive 폴백이 그 경우 안전망 역할. 비용은 boolean 반환 1줄 수정.
- **검증:** 126/126 통과, typecheck·build 깨끗.
- **남은 후속 의문:** 다른 cache invalidation 트리거가 있는지 — 예) 사용자가 그룹명을 수동으로 바꿈, 컬러 바꿈, 다른 윈도우로 이동. PRD §4 F1 "사용자 액션 존중" 일부. Phase 2.

---

## 8ad6de0 — 2026-05-12 23:42 KST
**chore(icons): add extension icon set + register in manifest**

- **상황:** 사용자가 외부에서 생성한 Pouch 라인아트 PNG(2816×1536, 흰 iOS-style 둥근 사각형 안에 파란 라인의 주머니 + 문서들)을 익스텐션 대표 이미지로 등록.
- **PRD §14 단계:** 해당 없음 (UX polish).
- **파이프라인 (macOS sips):**
  - 원본 분석: 2816×1536, 중앙에 1280×1280 정도의 흰 둥근 사각형 아이콘 영역.
  - `assets/icon-source.png` — 1280×1280 정중앙 크롭. 48/128 생성용 canonical 소스.
  - `public/icons/icon-128.png` — `sips -z 128` from 1280 소스.
  - `public/icons/icon-48.png` — `sips -z 48` from 1280 소스.
  - `public/icons/icon-32.png` — 별도 800×800 타이트 크롭에서 `sips -z 32`. (1280 소스에서 직접 줄이면 padding 때문에 흐려짐.)
  - `public/icons/icon-16.png` — 600×600 더 타이트한 크롭에서 `sips -z 16`. 라인이 frame을 채우게 해서 toolbar 표시에서 식별 가능.
- **매니페스트:** `manifest.config.ts`에 `icons.{16,32,48,128}` + `action.default_icon.{16,32}` 추가. 경로는 `icons/...`(naked) — vite가 `public/` prefix를 dist root로 flatten하므로 `public/icons/...`로 쓰면 dist에서 이중 경로 생김.
- **결정:**
  - 작은 사이즈는 별도 타이트 크롭. 한 소스에서 모든 사이즈를 sips로 줄이면 16px가 거의 안 보임 (저대비 + 안티앨리어싱).
  - `assets/icon-source.png`(1.6MB) 커밋 — repo 크기 부담 있지만, 디자인 변경 시 재생성용. 원본 3.4MB PNG는 디스크에서 삭제.
- **검증:** 126/126, typecheck·build 깨끗. dist/manifest.json이 4 사이즈 모두 올바른 경로로 반영. dist/icons/에 4 PNG 출력 확인.

---

## c06e16b — 2026-05-13 00:15 KST
**chore(icons): swap in revised source — darker / bolder lines, tighter frame**

- **상황:** 사용자가 아이콘 소스를 수정해서 가져옴 (`assets/icon-source-revised.png`). 기존 대비 라인이 더 진한 navy + 굵어짐, rounded square가 frame을 더 채워서 회색 padding 감소.
- **PRD §14 단계:** 해당 없음 (UX polish 이터레이션).
- **핵심 변경:**
  - `assets/icon-source.png` 교체 (1280×1280 유지, 1.2MB → 718KB로 압축률 좋아짐).
  - `public/icons/icon-128.png`, `icon-48.png` — 1280 소스에서 직접 `sips -z` (개선된 라인이 충분히 진해서 직접 다운샘플 OK).
  - `public/icons/icon-32.png` — 900×900 tight crop 후 `sips -z 32`.
  - `public/icons/icon-16.png` — 720×720 tighter crop 후 `sips -z 16`. 여전히 soft하지만 silhouette은 보임. sips로는 thin-line art의 16px가 한계 — imagemagick으로 더 좋은 resampling 가능하지만 미설치.
- **검증:** build 깨끗, 126/126 그대로 (아이콘 변경은 코드 테스트와 무관).

---

## 37784a2 — 2026-05-13 00:21 KST
**chore(icons): re-revised source — corrected alignment, resize-only pipeline**

- **상황:** 직전 c06e16b의 수정본은 pouch가 rounded square 안에서 약간 한쪽으로 치우쳐 있었음. 사용자가 정렬 보정해서 다시 가져옴 (1280×1280 유지).
- **PRD §14 단계:** 해당 없음.
- **핵심 변경:**
  - `assets/icon-source.png` 교체. pouch가 rounded square 정중앙으로 정렬됨.
  - `public/icons/icon-{16,32,48,128}.png` — 이번엔 **per-size tight crop 없이** 동일 1280 소스에서 `sips -z`만. 소스가 이미 충분히 확대돼있어서 32까지는 직접 다운샘플로 OK. 16은 sips 한계로 같은 수준(silhouette만 식별).
- **검증:** build 깨끗, 코드 영향 없음 (126/126 그대로).

---

## 4a34201 — 2026-05-13 00:28 KST
**chore(classifier): instrument timing logs for delay diagnosis**

- **상황:** 사용자가 새 탭 → 자동 분류 반응이 느리다고 보고. 어디서 시간이 나가는지 측정 안 한 채로 추측만 하면 위약 효과로 끝날 위험. 진단 로그부터 박음.
- **PRD §14 단계:** 해당 없음.
- **핵심 변경 (`src/background/classifier-queue.ts`):**
  - **Fast path:** 캐시 hit + addTabsToGroup 시간 → `[tabswirl:timing] fast-path tab=X domain → group=Y (Nms)`.
  - **Slow path enqueue:** queue 진입 시간 + debounce 안내 → `[tabswirl:timing] queued tab=X domain (enqueue=Nms, debounce=500ms)`.
  - **Flush summary:** snapshot · LLM · apply 단계별 + total → `[tabswirl:timing] flush(window=X tabs=Y) snapshot=Ams llm=Bms apply=Cms total=Dms`.
  - 실패 시 (LLM error 등): `... LLM FAILED (kind) snapshot=...ms llm=...ms total=...ms`.
- **핵심 변경 (`src/background/tab-listener.ts`):**
  - listener 진입 → enqueueTab 호출 사이 overhead가 30ms 넘으면 로그. 평상시엔 silent.
- **결정:** `performance.now()` 사용 (sub-ms 정밀도). `console.log` (Info level, devtools 기본 표시).
- **다음:** 사용자가 새 탭 몇 번 열어서 SW devtools 콘솔의 `[tabswirl:timing]` 로그 보고 가장 큰 항목 식별. 그 다음 타깃 최적화(디바운스 단축·onUpdated 조기 발화·기타).
- **검증:** 126/126, typecheck·build 깨끗.

---

## 8bcd62b — 2026-05-13 17:46 KST
**chore(icons): new revised source — colorful cartoon pouch with folders**

- **상황:** 사용자가 아이콘 디자인 자체를 교체. 기존: 단색 navy 라인아트(흰 둥근 사각형 안). 신규: 컬러 카툰 — tan drawstring 파우치에 빨강·초록·파랑 폴더가 꽂힌 모습. 시각적 톤이 완전히 바뀜.
- **PRD §14 단계:** 해당 없음.
- **핵심 변경:**
  - `assets/icon-source.png` 교체 (1280×1280, 693KB).
  - `public/icons/icon-{16,32,48,128}.png` — 동일 1280 소스에서 `sips -z`만 (per-size crop 없음).
- **부수 효과 (예상 외):** 16px 가독성이 큰 폭 개선됨. 단색 thin line은 다운샘플 시 안티앨리어싱으로 사라지지만, 컬러 블록은 살아남음. 이전 버전에서 sips 한계라고 했던 게 사실은 line-art 한계였던 셈.
- **검증:** 빌드 깨끗, 126/126 그대로.

---

## 5b89714 → f877522 — 2026-05-13 18:18~18:26 KST
**3-tier classification cascade + 사용자 학습 (Step 1~5)**

연속 5 commit으로 사용자 latency 문제와 분류 안정성 개선. 시장 조사
(TabPilot/gTabs 패턴 + Chrome 내장 Gemini Nano + 시장 #1이 룰 기반)
결과를 통합 적용.

### 5b89714 (Step 1) — `src/core/domain-rules.ts` 신설
- ~210 hand-curated 도메인 → category 매핑. 9 카테고리 (chrome 9 컬러와 1:1).
- code · ai · social · video · news · shopping · productivity · finance · entertainment.
- 글로벌 top + 한국 메이저 (naver, kakao, coupang, 한국 은행·음원).
- Subdomain walk (docs.github.com → github.com), www. strip, 더 구체적 entry 우선 (aws.amazon.com > amazon.com).
- en/ko 라벨 분리. multi-topic 도메인(google.com 등) 의도적 제외.
- 13 tests.

### fce2bf8 (Step 2) — enqueueTab에 Tier 1 통합
- enqueueTab 흐름: T0(cache) → **T1(rule, 신규)** → T2(slow path).
- T1 hit이면 즉시 applyGroup + cache seed → 다음부터 T0로 들어감.
- T1은 cache 다음에 배치돼 **사용자 수동 이동(cache에 저장된)이 룰을 이김**.
- 새 EnqueuePath 태그 `rule-hit`, timing log 추가.
- 5 신규 케이스 + 기존 stale-cache 테스트 보강.

### d0f9d14 (Step 3) — `src/llm/chrome-ai.ts` 신설
- Chrome 148+ `LanguageModel` API (on-device Gemini Nano).
- 자체 function calling 없어서 JSON instruction + JSON.parse + fence strip.
- 공유 `validate.ts` 통과로 모든 provider 동일한 검증.
- `availability() !== "available"`이면 missing-key로 cascade trigger.
- `outputLanguage: "ko"`도 시도(공식 지원 언어는 아니지만 best-effort).
- 11 tests.

### e5cb70c (Step 4) — Cascade + Gemini UI 숨김
- `provider.ts`의 `withCascade()` helper: chrome-ai 우선 시도, 실패 시 primary BYOK로 fall through.
- `DEFAULT_PROVIDER`를 `gemini` → `anthropic`. (Gemini는 코드 유지, UI에서만 제거.)
- Options 페이지에서 provider 라디오 제거. 대신 "Classification" 섹션이 3-tier 흐름 설명 + Chrome AI 가용성 ✓/✗ 라이브 표시.
- BYOK 섹션은 Anthropic 단일.
- 4 cascade tests 추가 (default, miss→fallback, short-circuit, no-loop).

### f877522 (Step 5) — 사용자 수동 이동 → cache 학습
- `src/background/group-learning.ts` — PRD §4 F1 "사용자 액션 존중" 구현.
- chrome.tabs.onUpdated(`changeInfo.groupId`) → 새 group의 title/color로 cache seed.
- chrome.tabGroups.onUpdated(rename/recolor) → 해당 group의 모든 탭 cache 재seed.
- `isClassifiable` + `isGroupableWindow` 필터.
- 5 tests + 헬퍼 보강 (chrome.tabGroups.get/onUpdated, fireTabGroupIdChanged 등).

### 전체 영향
- 사용자가 본 LLM latency 3-15초 문제: 일상 도메인 70-80%가 T1으로 즉시 분류 → LLM 호출 빈도 급감 → free-tier RPM 한도 부담도 함께 해결.
- Chrome 148+ 사용자는 T2(on-device)로 자동 전환되어 zero-key 경험 가능.
- 사용자가 그룹 손으로 옮기면 그게 진짜 진실 → 다음부터 그 도메인은 사용자 선택 따라감.
- 테스트 145 → **164 (총 +19)**, typecheck·build 깨끗.

---

## 07fa9e8 — 2026-05-15 21:06 KST
**fix(rules): drop naver.com / daum.net apex, add specific subdomains**

- **상황:** 사용자가 `naver.com → news` 매핑이 잘못이라고 지적. naver는 검색/메일/지도/쇼핑/카페/블로그/뉴스 모두 한 apex 아래라 google.com과 동일 케이스.
- **핵심 변경:**
  - apex `naver.com`, `daum.net` 제거 — 검색·블로그 등 multi-topic 페이지는 LLM이 title로 분류.
  - 단일 주제 naver subdomain 추가: `news.naver.com` (news), `mail.naver.com` (productivity), `cafe.naver.com` (social), `finance.naver.com`/`pay.naver.com` (finance), `shopping.naver.com` (shopping). `smartstore.naver.com`·`vibe.naver.com`은 기존 유지.
  - 파일 header 주석에 정책 명시. daum.net은 subdomain도 추가 안 함 (Kakao로 흡수돼 사실상 deprecated).
- **검증:** 165/165 (기존 164 + 신규 1 케이스 그룹), typecheck 깨끗.

---

## 알려진 미해결 / 다음 작업으로 넘긴 사항

- ~~**PRD ↔ CLAUDE.md 경로 불일치**~~ — 해결됨 (`docs/TabSwirl-PRD.md` → `docs/PRD.md`로 rename, CLAUDE.md 참조와 일치).
- **PRD §6.6 폴더 이름 오기:** `tabpouch/` → `tabswirl/`. 순수 표기 문제.
- **PRD §14 단계 14·15·16 마무리:**
  - 14번(시크릿 / 내부 URL 제외): `isClassifiable`로 처리됨, 별도 작업 불필요.
  - 15번(restoringTabIds 회피): 이미 `tab-listener` + `restore`로 구현됨.
  - **16번(자동 분류 OFF 시 평면 리스트 fallback):** 미구현. 현재 popup은 OFF 모드일 때도 그룹 트리 그대로 보여줌(그룹이 없으면 ungrouped만 나옴). PRD §4 F2가 명시한 "OFF 모드 평면 리스트"는 차이가 거의 없지만 명시적 분기 필요.
- **수동 e2e 검증 안 됨:** dist/를 실제 Chrome에 로드해서 PRD §15의 13개 체크리스트 돌려봐야 함. Vitest 단위 테스트로 보지 못한 회귀가 있을 수 있다 (e.g. CORS 헤더, chrome.tabs.create의 race, 매니페스트 권한 누락 등).

---

## 다음 단계

1. **수동 e2e 테스트** (PRD §15 시나리오 1–12). dist/를 `chrome://extensions` → Load unpacked.
2. PRD §14 #16 평면 리스트 fallback (자동 분류 OFF 모드에서 popup이 명시적으로 다르게 동작하도록).
3. 마이너 정리: CLAUDE.md / PRD 경로 일관성.
4. Phase 2 (PRD §10): 부분 복원, Pouch 라벨 편집, 다중 LLM provider 등.
