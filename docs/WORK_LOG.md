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

## 알려진 미해결 / 다음 작업으로 넘긴 사항

- **PRD ↔ CLAUDE.md 경로 불일치:** CLAUDE.md는 `docs/PRD.md`로 참조하나 실제 파일은 `docs/TabSwirl-PRD.md`. 둘 중 하나로 통일 필요 (별 임팩트 없음).
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
