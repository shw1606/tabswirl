# TabSwirl — PRD v0.3

> AI가 상시 자동 분류하는 탭 + 한 번 꺼내면 소모되는 Pouch
>
> **Status:** PRD v0.3 — Claude Code 첫 세션용 기획 문서
> **v0.2 대비 변경:** 자동 분류 기본값 on 확정, 초기 일괄 분류 동작 추가, 자동 분류 off 시 평면 리스트 fallback 명시
> **작성일:** 2026-05-12
> **타깃 사용자(P0):** 본인 → Chrome heavy user (개발자/리서처)
> **제품명:** TabSwirl (확정)
> **도메인 용어:** "Swirl" = 자동 분류 동작 / "Pouch" = 저장 객체 — 분리해서 사용

---

## 0. 핵심 시맨틱 — 두 개의 메모리 모델

이 제품은 두 개의 시간 스케일을 다룬다:

```
[현재 작업 메모리]                       [장기 보관 메모리]
  탭 바의 자동 분류 그룹                    Pouch (영구 저장)
  ↓ Stash 액션                            ↓ Restore 액션 (consume)
  탭들이 닫히고 Pouch에 들어감              탭들이 다시 열리고 Pouch는 소멸
```

- **현재 작업 메모리**: 익스텐션이 활성인 동안 탭 바에서 LLM이 알아서 카테고리·컬러로 묶어준다. 사용자 액션 없음.
- **장기 보관 메모리**: 사용자가 Stash하면 분류 정보까지 통째로 Pouch에 들어가 영구 보존. **복원하면 즉시 소멸**한다.

휘발성은 더 이상 "시간이 지나면 사라진다"가 아니라 **"한 번 꺼내면 사라진다(consume-on-restore)"**. 영수증 없이 맡겨두고 한 번에 찾아가는 보관소 모델.

---

## 1. 한 줄 정의

> 새 탭이 열릴 때마다 AI가 자동으로 카테고리·컬러로 분류해 탭 바를 늘 깔끔하게 유지하고, 닫기 아까운 탭 묶음은 분류 정보 그대로 "Pouch"에 넣어두었다가 필요할 때 한 번에 꺼내 쓰는 Chrome 익스텐션. Pouch는 꺼내는 순간 소멸한다.

---

## 2. 시장 빈자리

| 카테고리 | 대표 제품 | 빈 곳 |
|---|---|---|
| AI 자동 분류 | TidyTabs, AI Tab Organizer, AI TabGrouper (BYOK), Sessionat | 대부분 **수동 트리거**. 상시 분류는 드물고, 한다 해도 Pouch 시맨틱 없음 |
| 세션 매니저 | Session Buddy, OneTab, Tablerone, Workona, Nest | 영구 저장 일변도. 복원해도 데이터 남음 → "세션 묘지" 문제 |
| 임시 stash | TabStash, Stash, VertiTab "temporary panels" | 복원 시 자동 소멸 트리거 없음. AI 분류 없음 |

**TabSwirl의 위치:** "상시 자동 분류(swirl)" + "consume-on-restore Pouch"를 단일 흐름으로 묶는다.

---

## 3. 핵심 사용 시나리오

### S1. 그냥 평소 브라우징
사용자는 아무것도 안 한다. 새 탭을 열면 1~2초 안에 탭 바에 컬러 그룹이 자동으로 형성된다. PostgreSQL 문서를 열면 같은 `Database` 그룹으로, GitHub 이슈를 열면 `Code` 그룹으로 자동 합류. 사용자가 손으로 그룹을 만든 적 없다.

### S2. 컨텍스트 스위치
다른 작업이 들어옴 → 익스텐션 아이콘 클릭 → 현재 탭 리스트 표시 (이미 자동 분류된 그룹 구조 그대로 보임) → 전체가 기본 선택됨 → 옮기고 싶지 않은 그룹 한두 개 체크 해제 → `[Stash]` → 선택된 탭들이 닫히고 Pouch 생성. 분류 정보(그룹명·컬러·소속) 그대로 저장.

### S3. 돌아와서 복원
며칠 뒤 같은 작업 다시 시작 → popup의 Pouch 리스트 → 해당 Pouch 클릭 → `[Restore]` → 탭들이 새로 열리며 원래 그룹·컬러로 자동 묶임 (이때 LLM 호출 없음, 저장된 그룹 메타데이터 그대로 적용) → **Pouch는 사라짐**.

### S4. 의도적 폐기
Pouch가 더 이상 필요 없음 → `[Discard]` → 명시적 삭제.

---

## 4. 핵심 기능 요구사항

### F1. 상시 자동 분류 (핵심)

**기본값: ON.** 설정 페이지에서 끌 수 있음.

**트리거:**
- **초기 일괄 분류:** 익스텐션 설치 직후, 그리고 자동 분류를 off → on 토글한 직후 — 현재 열려있는 모든 윈도우의 기존 탭들을 일괄로 LLM에 보내 분류·그룹화
- **상시 분류:** 새 탭 열림 + URL 로드 완료 (`chrome.tabs.onUpdated`, `status === 'complete'`)
- 기존 탭이 다른 도메인으로 navigate

**초기 일괄 분류 세부 동작:**
1. 모든 윈도우 순회 → 각 윈도우의 탭 목록 수집 (시크릿/핀/내부 URL 제외)
2. 윈도우당 한 번씩 LLM 호출: "이 탭들을 카테고리로 묶고 컬러 지정" (기존 그룹 컨텍스트 없음 — 처음이므로)
3. 응답 받아 `chrome.tabGroups` 생성·적용
4. 도메인 캐시(`cache:domains:<windowId>`)를 분류 결과로 시드
5. 사용자에게 "초기 정리 완료" 토스트 (조용히)
6. 탭 수가 많으면(가령 50개+) LLM 컨텍스트 한계를 고려해 30개씩 청크로 분할 호출

**상시 분류 동작:**
1. **빠른 경로 (도메인 캐시 hit):** 현재 윈도우에 이미 같은 도메인 또는 LLM이 이전에 같은 그룹으로 분류한 도메인이 있으면, LLM 호출 없이 즉시 그 그룹에 추가
2. **느린 경로 (LLM 호출):** 캐시 miss → 디바운싱 큐에 넣음 → 500ms 동안 추가 탭 변경 모으기 → 배치로 LLM에 "기존 그룹 목록 + 새 탭들"을 보내 분류 받음

**LLM에 전달하는 컨텍스트:**
```
existing_groups: [
  { name: "Database", color: "blue", sample_tabs: [...] },
  { name: "Frontend", color: "purple", sample_tabs: [...] },
]
new_tabs: [{ id, title, domain }]

질문: 각 new_tab을 기존 그룹 중 어디에 넣을지,
      또는 새 그룹을 만들지 (그룹명·컬러 포함)
```

이렇게 해서 **카테고리 일관성**을 유지한다. 같은 종류의 탭이 "Database" → "DB" → "Backend" 처럼 매번 다른 이름으로 분류되는 걸 막는다.

**사용자 액션 존중:**
- 사용자가 수동으로 탭을 다른 그룹으로 옮기면 → 그 결정을 도메인 캐시에 학습
- 사용자가 그룹명·컬러를 바꾸면 → 기존 그룹 컨텍스트에서 새 이름·컬러 사용
- 사용자가 그룹을 ungroup하면 → 그 그룹은 카테고리 풀에서 제외

**비-분류 대상:**
- 시크릿 윈도우 탭
- `chrome://`, `about:`, `chrome-extension://` 등 내부 URL
- 핀 탭 (사용자가 명시적으로 고정한 것이므로)
- title이 아직 없는 로딩 중 탭

### F2. Stash (탭 → Pouch)

**트리거:** 익스텐션 아이콘 클릭 또는 단축키 (`Cmd+Shift+P`)

**popup UI (자동 분류 ON 모드 — 기본):**
- 현재 윈도우의 탭들이 **이미 자동 분류된 그룹 구조 그대로** 트리 형태로 표시
- 기본 상태: 모든 그룹·탭 체크됨
- 그룹 단위 체크 토글, 개별 탭 단위 체크 토글 모두 가능
- 우상단 `[Stash]` 버튼

**popup UI (자동 분류 OFF 모드 — fallback):**
- 현재 윈도우의 탭들이 **단순 평면 리스트**로 표시 (그룹화 없음)
- 기본 상태: 모든 탭 체크됨
- 개별 탭 단위 체크 토글
- 우상단 `[Stash]` 버튼
- 이 모드의 Pouch는 `groups: []`, `ungrouped`에 모든 탭이 들어감
- 복원 시에도 그룹화 없이 그냥 탭들만 열림

**Stash 액션:**
1. 선택된 탭들의 URL·title·favicon + 소속 그룹 메타데이터(이름·컬러) 수집
2. Pouch 객체 생성, `chrome.storage.local`에 영구 저장
3. 선택된 탭 닫기 (`chrome.tabs.remove`)
4. popup이 Pouch 리스트 뷰로 전환 (방금 만든 Pouch가 맨 위)

**중요:** Stash 시점에 LLM 호출 일절 없음. 이미 자동 분류된 결과를 그대로 박제하는 것.

### F3. Pouch 영구 보존

- `chrome.storage.local`에 저장 → 브라우저 재시작·OS 재부팅에도 살아남음
- Chrome storage local은 기본 10MB 한도, MV3에선 `unlimitedStorage` 권한으로 확장 가능
- 사용자가 명시적으로 삭제하지 않는 한 사라지지 않음
- Pouch 메타데이터: 생성 시각, 사용자 라벨(optional), 탭 수, 그룹 미리보기

### F4. Restore (소모)

**트리거:** popup의 Pouch 클릭 → `[Restore]`

**액션:**
1. 확인 다이얼로그: "복원 후 이 Pouch는 사라집니다" (설정에서 끌 수 있음)
2. Pouch의 각 그룹별로:
   - 그룹의 탭들을 새로 열기 (`chrome.tabs.create`)
   - 같은 윈도우에 `chrome.tabGroups.group()` 으로 묶기
   - 그룹명·컬러를 저장돼있던 그대로 적용
3. **`chrome.storage.local.remove('pouch:<id>')` — Pouch 삭제**
4. **이때 F1 자동 분류는 작동하지 않아야 함** — 복원 중인 탭들은 이미 그룹이 정해져 있으므로, 자동 분류 로직이 다시 건드리면 안 됨

**자동 분류 회피 메커니즘:**
- 복원으로 열리는 탭 id를 `restoringTabIds` Set에 넣고, 해당 id가 `onUpdated`에 잡히면 분류 skip
- 그룹화 완료 후 1.5초 뒤 안전하게 Set에서 제거
- 백업: service worker에 `restoreInProgress` flag도 같이 set

### F5. 명시적 Discard
- Pouch 우클릭/스와이프 → 삭제 (확인 다이얼로그 후)
- "복원하지 않고 그냥 버린다"가 의도적으로 가능해야 함

---

## 5. 의도적 제외 (스코프 보호)

| 빼는 것 | 이유 |
|---|---|
| 사용자 정의 카테고리 룰 | LLM이 학습해서 알아서 — 룰 시스템은 복잡도만 늘림 |
| Pouch export / 백업 | "consume-on-restore" 시맨틱 약화 위험 |
| 클라우드 동기화 | MVP 외 |
| 워크스페이스 / 프로젝트 | Workona 영역 |
| 비활성 탭 freeze | Chrome Memory Saver로 충분 |
| 검색 | Pouch 라벨/카테고리명으로 충분 |
| 다중 LLM provider | MVP 후 |

---

## 6. 기술 아키텍처

### 6.1 스택
- **Manifest V3** Chrome Extension
- **TypeScript** + **Vite** + `@crxjs/vite-plugin`
- **React** + **Tailwind CSS** — popup UI
- 패키지 매니저: pnpm
- 테스트: Vitest

### 6.2 컴포넌트 다이어그램

```
┌─────────────────────────────────────────────────────────┐
│ Service Worker (background)                             │
│                                                          │
│  ┌─────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Tab Listener│→ │ Classifier Q   │→ │ LLM Caller   │  │
│  │ onUpdated   │  │ (debounce 500ms│  │ (BYOK)       │  │
│  │ onRemoved   │  │  + dedup)      │  │              │  │
│  └─────────────┘  └────────────────┘  └──────────────┘  │
│         │                  │                   │         │
│         ↓                  ↓                   ↓         │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Group Manager                                    │    │
│  │ - applies group/color via chrome.tabGroups       │    │
│  │ - maintains domain → groupId cache               │    │
│  │ - respects user manual edits                     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Pouch Store (chrome.storage.local)               │    │
│  │ - CRUD on Pouch objects                          │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                       ↑
                       │
┌──────────────────────┴──────────────────────────────────┐
│ Popup (React)                                            │
│  - 현재 탭 트리 (자동 분류 결과 반영)                       │
│  - Stash 액션                                            │
│  - Pouch 리스트 & Restore                                │
└─────────────────────────────────────────────────────────┘
```

### 6.3 자동 분류 전략 — 핵심 엔지니어링 챕터

**문제:** 새 탭마다 LLM 호출하면 비용·속도 둘 다 깨짐.

**해결 — 3단계 의사결정:**

```
새 탭 onUpdated('complete')
        │
        ▼
┌───────────────────────────┐
│ Step 1: 도메인 캐시 조회   │
│ domain → existingGroupId? │
└───────────────────────────┘
        │
   ┌────┴────┐
  hit       miss
   │         │
   ▼         ▼
같은 그룹에  ┌───────────────────────────┐
즉시 추가    │ Step 2: 디바운스 큐 추가   │
LLM 호출 X  │ 500ms 동안 더 모으기       │
            └───────────────────────────┘
                       │
                       ▼
            ┌───────────────────────────┐
            │ Step 3: 배치로 LLM 호출    │
            │ existing_groups + new_tabs│
            │ → 분류 결과                │
            └───────────────────────────┘
```

**LLM 응답 처리:**
- 응답이 "기존 그룹 X에 넣어라" → 즉시 적용, 도메인 캐시 업데이트
- 응답이 "새 그룹 Y(컬러 Z) 만들어라" → 그룹 생성, 캐시 업데이트
- 응답 실패/타임아웃 → 탭을 그냥 ungrouped 상태로 둠 (조용히 fallback)

**도메인 캐시 (`chrome.storage.session`):**
```ts
type DomainCache = {
  // windowId 별로 격리 — 다른 윈도우는 다른 컨텍스트
  [windowId: number]: {
    [domain: string]: {
      groupId: number;        // Chrome tab group ID
      categoryName: string;
      color: ChromeGroupColor;
      lastUsed: number;
    }
  }
}
```

캐시는 휘발성. 윈도우 닫히면 사라짐. 새 윈도우는 처음부터 학습.

**예상 호출 빈도 (캐시 효과 고려):**
- 하루 평균 새 탭 50개 가정
- 도메인 캐시 hit rate 70% (반복 도메인 많음)
- LLM 호출: 15회/일, 배치로 묶이면 5~10회/일
- Claude Haiku 4.5 기준 월 비용 BYOK $0.5 미만

### 6.4 저장소 분리

| 저장소 | 용도 | 영속성 |
|---|---|---|
| `chrome.storage.local` | Pouch (영구), 사용자 설정, BYOK 키 | 명시적 삭제 전까지 영구 |
| `chrome.storage.session` | 도메인 캐시, restoringTabIds flag, 디바운스 상태 | 브라우저 종료 시 자동 소멸 |

키 prefix:
- `pouch:<id>` → local
- `pouches:index` → local (id 목록·정렬)
- `settings:main` → local
- `byok:<provider>` → local
- `cache:domains:<windowId>` → session
- `flags:restoring` → session

### 6.5 권한

```json
{
  "manifest_version": 3,
  "permissions": [
    "tabs",
    "tabGroups",
    "storage",
    "unlimitedStorage"
  ],
  "host_permissions": [
    "https://api.anthropic.com/*"
  ],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "service-worker.js" },
  "commands": {
    "open-stash": {
      "suggested_key": { "default": "Ctrl+Shift+P", "mac": "Command+Shift+P" }
    }
  }
}
```

### 6.6 폴더 구조

```
tabpouch/
├── manifest.config.ts (crxjs)
├── vite.config.ts
├── package.json
├── tsconfig.json
├── src/
│   ├── background/
│   │   ├── service-worker.ts        # 진입점
│   │   ├── tab-listener.ts          # onUpdated, onRemoved
│   │   ├── classifier-queue.ts      # 디바운스 + 배치
│   │   ├── group-manager.ts         # chrome.tabGroups 조작
│   │   └── domain-cache.ts          # session storage 래퍼
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── views/
│   │   │   ├── StashView.tsx        # 현재 탭 + Stash 액션
│   │   │   └── PouchesView.tsx      # Pouch 리스트 + Restore
│   │   └── components/
│   │       ├── TabTree.tsx
│   │       ├── PouchCard.tsx
│   │       └── ConfirmDialog.tsx
│   ├── core/
│   │   ├── types.ts
│   │   ├── pouch-store.ts           # local storage CRUD
│   │   └── messaging.ts             # popup ↔ SW 메시지
│   ├── llm/
│   │   ├── provider.ts              # 인터페이스
│   │   ├── anthropic.ts
│   │   └── prompts.ts               # 시스템·유저 프롬프트
│   └── options/
│       ├── index.html
│       └── main.tsx                 # BYOK 키, 설정
├── public/
│   └── icons/
└── tests/
    ├── core/
    │   └── pouch-store.test.ts
    └── background/
        └── classifier-queue.test.ts
```

---

## 7. 데이터 모델

```ts
// src/core/types.ts

type ChromeGroupColor =
  | "grey" | "blue" | "red" | "yellow"
  | "green" | "pink" | "purple" | "cyan" | "orange";

interface SavedTab {
  url: string;
  title: string;
  favIconUrl?: string;
}

interface SavedGroup {
  name: string;             // "Database", "Research", ...
  color: ChromeGroupColor;
  tabs: SavedTab[];
}

interface UngroupedBucket {
  // 그룹에 속하지 않은 탭들 (분류 실패/대기 중이었던 것)
  tabs: SavedTab[];
}

interface Pouch {
  id: string;               // crypto.randomUUID()
  createdAt: number;
  label?: string;           // 사용자 명명 (optional)
  sourceWindowTitle?: string; // "리서치 윈도우" 같은 힌트
  groups: SavedGroup[];
  ungrouped: UngroupedBucket;
  totalTabs: number;
}

interface Settings {
  llmProvider: "anthropic";
  llmModel: string;         // "claude-haiku-4-5"
  autoClassifyEnabled: boolean;
  sendUrls: boolean;        // false면 domain만 LLM에 전달
  confirmBeforeRestore: boolean;
  confirmBeforeDiscard: boolean;
  language: "ko" | "en";
}

interface DomainCacheEntry {
  groupId: number;
  categoryName: string;
  color: ChromeGroupColor;
  lastUsed: number;
}
```

---

## 8. UX 흐름 상세

### 8.1 자동 분류 (백그라운드)

**8.1.a 초기 일괄 분류 (설치 직후 1회)**
1. 익스텐션 설치 또는 자동 분류 토글 off→on
2. service worker가 모든 윈도우 enumerate
3. 윈도우별로 (탭 30개씩 청크로) LLM에 일괄 분류 요청
4. 응답대로 `chrome.tabGroups` 생성·적용
5. 도메인 캐시 시드 완료 → 이후 상시 분류는 캐시 hit이 잘 나옴

**8.1.b 상시 분류 (이후)**
1. 사용자가 새 탭 열거나 URL 변경
2. `onUpdated('complete')` 트리거
3. 빠른 경로: 도메인 캐시 hit → 즉시 그룹화, popup에도 즉시 반영
4. 느린 경로: 디바운스 큐에 들어감
5. 500ms 후 배치 LLM 호출
6. 응답 도착 → 그룹화 적용 → 도메인 캐시 업데이트
7. 사용자 시야에서는: 새 탭이 1~2초 후 자연스럽게 컬러 그룹에 합류

### 8.2 Stash flow
1. 툴바 아이콘 또는 `Cmd+Shift+P`
2. popup 오픈 → "Stash" 탭 활성
3. 트리: `[Database] (3 tabs)` `[Research] (5 tabs)` `[ungrouped] (1 tab)` 식
4. 기본: 모두 체크
5. 사용자가 일부 해제 가능 (그룹 또는 개별 탭)
6. `[Stash N tabs]` 버튼 (선택된 탭 수 라이브 업데이트)
7. 클릭 → Pouch 저장 + 해당 탭 닫힘
8. popup이 "Pouches" 탭으로 자동 전환, 새 Pouch가 맨 위 강조

### 8.3 Restore flow
1. popup → "Pouches" 탭
2. Pouch 리스트 (생성시각, 탭 수, 그룹 컬러 점 미리보기)
3. Pouch 클릭 → 상세 (그룹별 탭 목록)
4. `[Restore]` 클릭 → 확인 다이얼로그 ("복원 후 이 Pouch는 사라집니다")
5. 확인 → service worker에 RESTORE 메시지
6. SW: `restoringTabIds` Set에 만들 탭들의 placeholder 추가
7. 그룹별로 탭 생성 → `chrome.tabGroups.group()` → 컬러·이름 적용
8. 완료 후 Pouch 삭제 → popup에 결과 반영
9. `restoringTabIds` 비우기 (`setTimeout` 1.5초 후 안전하게)

---

## 9. MVP 정의 (v0.1 릴리즈)

**Done 기준:**
- [x] 새 탭 열리면 자동으로 LLM 분류 → 그룹·컬러 적용 (캐시 + 디바운스 동작)
- [x] 사용자가 수동으로 그룹 변경하면 캐시에 학습
- [x] popup에서 현재 탭 트리 표시 + 선택 Stash
- [x] Pouch가 `chrome.storage.local`에 저장되어 브라우저 재시작에도 유지
- [x] Pouch 복원 시 그룹·컬러 그대로 복원 + Pouch 즉시 삭제
- [x] 복원 중 자동 분류 비활성화 동작
- [x] BYOK Anthropic Haiku 4.5 단일 provider
- [x] 한국어/영어 UI

**MVP에 없는 것:**
- 자동 분류 on/off 토글 외 세부 설정
- 다중 LLM provider
- 다중 윈도우 컨텍스트 공유 (각 윈도우 독립)
- Pouch 라벨 편집
- 부분 복원 (그룹 일부만 복원)
- 사용자 정의 카테고리 시드

**MVP 분량:** TypeScript 기준 2,500~3,500 LOC. Claude Code 3~4 세션.

---

## 10. Phase 2 후보

- 부분 복원 (Pouch의 일부 그룹만)
- Pouch 라벨 인라인 편집
- 다중 LLM provider (OpenAI, Gemini, Chrome 내장 Prompt API)
- 다중 윈도우 동일 카테고리 공유
- 자동 분류 제외 도메인 리스트 (사용자 설정)
- Pouch별 "잠금" 옵션 — 실수 복원 방지 (한 번 더 클릭 필요)
- "최근 Pouch 즉시 복원" 단축키
- LLM 호출 횟수 통계 / 비용 추정 표시
- 그룹 일관성 향상: 글로벌 카테고리 사전(persistent)

---

## 11. 보안 / 프라이버시

- BYOK 키는 `chrome.storage.local` 평문 (OS 사용자 격리)
- LLM에 전달되는 기본 데이터: tab title + domain만 (full URL은 opt-in)
- 시크릿 탭 자동 제외
- 외부 통신: LLM provider API만. 텔레메트리/분석 없음
- 권한 최소화 (위 6.5)
- 본문 절대 스크래핑 안 함 — content script 사용하지 않음

---

## 12. 알려진 트레이드오프 / 리스크

### R1. 자동 분류의 사용자 신뢰
새 탭이 자기 의도와 다른 그룹으로 들어가면 사용자가 짜증남. 완화:
- 첫 사용 시 "학습 중" 안내
- 사용자가 수동 옮기면 즉시 학습 (도메인 캐시)
- LLM 컨텍스트에 "기존 그룹을 최대한 재사용" 명시

### R2. LLM 호출 지연
1~2초 지연 동안 탭이 ungrouped 상태로 깜빡일 수 있음. 완화:
- 도메인 캐시로 대부분 즉시 처리
- 미응답 동안엔 그냥 ungrouped로 두기 (실패해도 사용자가 손해 보는 게 없음)

### R3. 그룹 카테고리 인플레이션
시간 지나면 그룹 종류가 10개, 15개로 늘어나며 의미 흐려질 수 있음. 완화:
- LLM 프롬프트에 "그룹 수는 8개 이하 유지" 가이드
- 같은 윈도우에 5개 이상 빈 그룹이 있으면 정리 제안 (Phase 2)

### R4. 사용자가 LLM 분류 결과를 매번 거부
극단적 케이스. 익스텐션 무용지물. 완화:
- 자동 분류 토글 off → 수동 모드 (Stash 시점에만 분류) — 이전 v0.1 PRD 동작으로 fallback

### R5. Service Worker 라이프사이클
MV3 SW는 30초 idle 후 종료됨. 디바운스 타이머가 죽을 수 있음. 완화:
- 디바운스 상태를 `chrome.storage.session`에 persist
- SW가 깨어날 때 pending queue 확인 후 재개
- 또는 `chrome.alarms.create` 사용 (최소 30초 단위라 부적합 가능)

---

## 13. 결정 완료 (v0.3에서 확정)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 제품명 | **TabSwirl** (확정). 도메인 용어 "Pouch"(저장 객체)는 데이터 모델·코드 전반에서 유지 |
| 2 | 자동 분류 기본값 | **ON** |
| 3 | 자동 분류 OFF 시 UI | **평면 탭 리스트** (그룹화 없음) |
| 4 | 첫 LLM 호출 시점 | 익스텐션 설치 직후 **기존 탭 일괄 분류** (§4 F1, §8.1.a) |
| 5 | 로깅 수준 | 구현자 재량 — production에선 `console.debug` strip 권장 |

---

## 14. Claude Code 첫 세션 부트스트랩 순서

이 PRD를 통째로 컨텍스트에 넣고 시작. 첫 세션 작업 순서:

```
1. Vite + crxjs + React + TS + Tailwind 부트
2. manifest.config.ts — 위 6.5 그대로
3. src/core/types.ts — 위 §7 그대로
4. src/core/pouch-store.ts + 단위 테스트 (Vitest)
5. src/llm/anthropic.ts + prompts.ts
   - 프롬프트는 영어로 작성, JSON 응답 강제 (tool use 또는 response_format)
   - "initial bulk classify" 와 "incremental classify" 두 프롬프트 분리
6. src/background/domain-cache.ts (storage.session 래퍼)
7. src/background/group-manager.ts (chrome.tabGroups 조작)
8. src/background/initial-classifier.ts (설치/활성화 시 일괄 분류)
   - chrome.runtime.onInstalled + 설정 토글 핸들러
9. src/background/classifier-queue.ts (debounce + batch — 상시 분류)
10. src/background/tab-listener.ts (onUpdated → queue)
11. src/popup 최소 UI — 현재 탭 트리 표시 (자동 분류 ON 모드)
12. Stash 액션 연결
13. Pouch 리스트 + Restore 액션 연결
14. 시크릿 탭 / 내부 URL 제외 로직
15. 복원 중 자동 분류 회피 (restoringTabIds)
16. 자동 분류 OFF 모드 fallback — 평면 리스트 UI
```

첫 세션 목표: **자동 분류가 동작하는 상태에서 Stash·Restore 한 번 왕복.** UI는 못생겨도 됨.

---

## 15. MVP done 검증 시나리오

수동 e2e 체크리스트:

1. **초기 일괄 분류:** 탭 15개가 열린 윈도우에 익스텐션을 처음 설치 → 5초 안에 모든 탭이 컬러 그룹으로 자동 분류됨
2. 빈 윈도우 → 탭 10개 열기 (잡다한 URL) → 1~3초 안에 컬러 그룹 3~5개로 자동 분류됨
3. 같은 도메인 새 탭 열기 → 즉시 같은 그룹 합류 (LLM 호출 없음)
4. 사용자가 한 탭을 다른 그룹으로 수동 이동 → 그 도메인의 다음 탭도 사용자가 이동시킨 그룹으로 분류됨
5. 익스텐션 아이콘 클릭 → popup 열리고 현재 탭 트리 정확히 표시
6. 일부 그룹 체크 해제 → `[Stash]` → 체크된 탭만 닫히고 Pouch 생성
7. 브라우저 완전 종료 후 재시작 → Pouch 여전히 존재
8. Pouch `[Restore]` → 탭들이 원래 그룹·컬러로 복원 → Pouch 사라짐
9. 복원 중 자동 분류가 끼어들지 않음 (그룹이 유지됨)
10. BYOK 키 없을 때 친절한 에러
11. 시크릿 윈도우에서는 자동 분류 동작 안 함, popup도 비활성
12. **자동 분류 OFF 모드:** 설정에서 토글 OFF → popup 열면 평면 탭 리스트만 표시 → Stash 가능, 복원 시 그룹화 없이 탭만 열림
13. **OFF → ON 토글:** 자동 분류를 다시 켜면 현재 열린 탭들이 일괄 재분류됨

---

## 16. 카피·메시징 원칙

- "저장(save)" 보다 "맡김(stash)", "꺼냄(restore)" 보다 "꺼내 쓰다(consume/take out)" — 인지 모델 강화
- 한 문장 포지셔닝: **"브라우저가 알아서 정리해주고, 닫기 아까운 묶음은 한 번 쓰는 영수증처럼 보관합니다."**
- Session Buddy / OneTab 비교 질문에 답: "저장이 아니라 잠시 맡겨두는 거예요. 꺼내면 영수증 안 줍니다."
