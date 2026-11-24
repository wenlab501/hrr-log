# HRR 事件紀錄 PWA（hrr-log）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個可加到手機主畫面、離線使用的 PWA，讓研究人員在跑步機 HRR 測試中以按鈕記錄帶狀態標籤的事件，並匯出 CSV。

**Architecture:** 純 HTML／CSS／JavaScript ES modules，無框架、無建置步驟。邏輯拆成不依賴瀏覽器 API 的純函式模組（`clock.js`、`state.js`、`session.js`、`export.js`，以 `node --test` 測試）與瀏覽器模組（`store.js` 的 IndexedDB、`app.js` 的介面）。`sw.js` 以版本化快取提供離線使用，部署在 GitHub Pages。

**Tech Stack:** HTML5、CSS、JavaScript ES modules、IndexedDB、Service Worker、Web App Manifest、Screen Wake Lock API、Web Share API、Node.js 24 內建 test runner（`node --test`）、Python 3 標準函式庫 `http.server`（只用於本機預覽）、Pillow（只用於一次性產生圖示）、`gh` CLI。

**Spec:** `docs/superpowers/specs/2026-11-24-hrr-log-pwa-design.md`

## Global Constraints

- 專案根目錄：`C:\Wen_Files\GPT_Projects\hrr-log\`（Google Drive 同步目錄內的獨立 git repo）。
- 不使用框架、不需建置步驟、不安裝任何套件；不得產生 `node_modules/`、`__pycache__/`、暫存檔或 lock 檔。`package.json` 只宣告 `"type": "module"` 與測試指令，不含 dependencies。
- 本版不做任何藍牙或裝置連線；不上傳資料、不含分析追蹤或外部請求。
- 所有紀錄只存在瀏覽器 IndexedDB；受試者只以代碼識別（英數字、底線、連字號，1–32 字）。
- 事件只新增、不修改、不刪除；撤銷以 `correction` 事件表示，只能作用於最後一筆有效、且不是 `correction` 的事件。
- 事件類型固定為：`sync`、`warmup_start`、`run_start`、`run_stop`、`recovery_end`、`cooldown_start`、`test_end`、`rpe`、`note`、`correction`。
- 每個有效的 `run_start` 使組數加 1（即使前一組沒有 `run_stop`）。
- RPE 為 1–10 整數，只用於各組停止跑步後；app 不記錄、不檢查暖身強度條件。
- 速度調整單位 ±0.5 km/h，預設帶入上一組速度。
- 休息時間異常門檻：與前幾組中位數相差超過 30 秒；時鐘跳動門檻：2 秒。
- CSV：UTF-8 含 BOM、CRLF 換行、`#` 起始的註解列、含 `valid` 欄；檔名 `HRR-log_<受試者代碼>_<YYYYMMDD-HHMM>.csv`。
- 所有按鈕至少 64 × 64 px（CSS `button` 的 `min-height` 與 `min-width`），手機直式優先。
- app 版本 `0.1.0`；`sw.js` 快取名稱含相同版本號。
- 部署目標：公開 repo `wenlab501/hrr-log`，GitHub Pages 由 `main` 分支根目錄提供，網址 `https://wenlab501.github.io/hrr-log/`。建立 repo、推送與開啟 Pages 前必須取得使用者確認。
- 每次 commit 訊息結尾加上：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- Node 若不在 PATH，使用 `"C:\Program Files\nodejs\node.exe"`。

---

## File Structure

| 檔案 | 職責 | 任務 |
|---|---|---|
| `package.json` | 宣告 ES module 與 `npm test` 指令（無 dependencies） | 1 |
| `.gitignore` | 防止誤加入快取或套件目錄 | 1 |
| `version.js` | `APP_VERSION` 常數 | 1 |
| `clock.js` | 本地 ISO 時間字串、可接續的場次單調時鐘 | 1 |
| `state.js` | 事件建立、有效性、組數、狀態、撤銷目標、異常提示、時間格式 | 2、3 |
| `session.js` | 場次輸入驗證與建立 | 4 |
| `export.js` | CSV 文字與檔名 | 4 |
| `store.js` | IndexedDB 讀寫 | 5 |
| `index.html`、`styles.css`、`app.js` | 介面與互動 | 5 |
| `manifest.webmanifest`、`sw.js`、`icons/` | 安裝與離線 | 6 |
| `README.md` | 使用、資料、開發與部署說明 | 7 |
| `tests/*.test.mjs` | 單元與靜態一致性測試 | 1–4、6 |

---

### Task 1: 專案骨架與場次時鐘

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `version.js`
- Create: `clock.js`
- Test: `tests/clock.test.mjs`

**Interfaces:**
- Consumes: 無。
- Produces:
  - `APP_VERSION: string`（`version.js`）
  - `toLocalIso(epochMs: number, tzOffsetMinutes: number): string`，`tzOffsetMinutes` 為 UTC 以東分鐘數（台灣 `480`），回傳如 `2026-11-24T16:00:00.000+08:00`。
  - `createSessionClock({ perfNow: () => number, dateNow: () => number, tzOffsetMinutes: number, resumeFrom?: { t_mono_ms: number, t_epoch_ms: number } | null }): { now(): { epochMs: number, monoMs: number, localIso: string }, takeResumedFlag(): boolean }`

- [ ] **Step 1: 建立骨架檔案**

`package.json`：

```json
{
  "name": "hrr-log",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Event-logging PWA for treadmill heart-rate-recovery tests",
  "scripts": {
    "test": "node --test \"tests/*.test.mjs\""
  }
}
```

`.gitignore`：

```gitignore
node_modules/
__pycache__/
*.tmp
.DS_Store
Thumbs.db
```

`version.js`：

```js
export const APP_VERSION = "0.1.0";
```

- [ ] **Step 2: 撰寫失敗的測試**

`tests/clock.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createSessionClock, toLocalIso } from "../clock.js";

test("toLocalIso writes local wall time with the UTC offset", () => {
  const epoch = Date.UTC(2026, 10, 24, 8, 0, 0);
  assert.equal(toLocalIso(epoch, 480), "2026-11-24T16:00:00.000+08:00");
  assert.equal(toLocalIso(epoch, -150), "2026-11-24T05:30:00.000-02:30");
});

test("a new session clock starts monotonic time at zero", () => {
  let perf = 1000;
  let date = 5000;
  const clock = createSessionClock({ perfNow: () => perf, dateNow: () => date, tzOffsetMinutes: 480 });
  perf = 3500;
  date = 7500;
  const reading = clock.now();
  assert.equal(reading.monoMs, 2500);
  assert.equal(reading.epochMs, 7500);
  assert.equal(clock.takeResumedFlag(), false);
});

test("monotonic time ignores wall-clock changes after start", () => {
  let perf = 0;
  let date = 10_000;
  const clock = createSessionClock({ perfNow: () => perf, dateNow: () => date, tzOffsetMinutes: 480 });
  perf = 1000;
  date = 70_000;
  assert.equal(clock.now().monoMs, 1000);
});

test("a resumed clock continues from the last event and flags once", () => {
  let perf = 200;
  let date = 130_000;
  const clock = createSessionClock({
    perfNow: () => perf,
    dateNow: () => date,
    tzOffsetMinutes: 480,
    resumeFrom: { t_mono_ms: 60_000, t_epoch_ms: 100_000 },
  });
  perf = 1200;
  assert.equal(clock.now().monoMs, 91_000);
  assert.equal(clock.takeResumedFlag(), true);
  assert.equal(clock.takeResumedFlag(), false);
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL，錯誤為找不到 `../clock.js`。

- [ ] **Step 4: 實作 `clock.js`**

```js
// Session clock with injected time sources so the logic runs under node --test.

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

export function toLocalIso(epochMs, tzOffsetMinutes) {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000);
  const local = shifted.toISOString().replace("Z", "");
  const sign = tzOffsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(tzOffsetMinutes);
  return `${local}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function createSessionClock({ perfNow, dateNow, tzOffsetMinutes, resumeFrom = null }) {
  const loadPerf = perfNow();
  const loadEpoch = dateNow();
  const baseMono = resumeFrom
    ? resumeFrom.t_mono_ms + Math.max(0, loadEpoch - resumeFrom.t_epoch_ms)
    : 0;
  let resumedPending = Boolean(resumeFrom);
  return {
    now() {
      const epochMs = dateNow();
      return {
        epochMs,
        monoMs: Math.round(baseMono + (perfNow() - loadPerf)),
        localIso: toLocalIso(epochMs, tzOffsetMinutes),
      };
    },
    takeResumedFlag() {
      const flag = resumedPending;
      resumedPending = false;
      return flag;
    },
  };
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS（4 tests）。

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore version.js clock.js tests/clock.test.mjs
git commit -m "feat: add project skeleton and resumable session clock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 事件建立、有效性、組數與撤銷

**Files:**
- Create: `state.js`
- Test: `tests/state-events.test.mjs`

**Interfaces:**
- Consumes: 無（clock reading 以參數傳入，型別同 Task 1 的 `now()` 回傳值）。
- Produces（`state.js`）:
  - `STATE_EVENTS: string[]`、`EVENT_TYPES: string[]`、`EVENT_LABELS: Record<string, string>`
  - `CLOCK_JUMP_MS = 2000`
  - `withValidity(events): Event[]`（每筆加上 `valid: boolean`）
  - `activeEvents(events): Event[]`（排除 `correction` 與被撤銷者）
  - `currentBout(events): number`
  - `lastSpeed(events, fallback): number | null`
  - `undoTarget(events): number | null`
  - `createEvent(sessionId: string, events: Event[], input: { event_type, speed_kmh?, rpe?, note?, corrects_seq? }, reading: { epochMs, monoMs, localIso }, options?: { resumed?: boolean }): Event`
  - `Event` 欄位：`session_id, seq, event_type, bout, speed_kmh, rpe, note, t_epoch_ms, t_local_iso, t_mono_ms, corrects_seq, flags`

- [ ] **Step 1: 撰寫失敗的測試**

`tests/state-events.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  activeEvents,
  createEvent,
  currentBout,
  lastSpeed,
  undoTarget,
  withValidity,
} from "../state.js";

function reading(monoMs, epochOffset = 0) {
  return { epochMs: 1_000_000 + monoMs + epochOffset, monoMs, localIso: `t${monoMs}` };
}

function run(steps) {
  let events = [];
  for (const [event_type, monoMs, extra = {}] of steps) {
    events = [...events, createEvent("S", events, { event_type, ...extra }, reading(monoMs))];
  }
  return events;
}

test("events get sequential numbers and bout numbers", () => {
  const events = run([
    ["warmup_start", 0],
    ["run_start", 10_000, { speed_kmh: 9 }],
    ["run_stop", 250_000],
    ["recovery_end", 340_000],
    ["run_start", 345_000, { speed_kmh: 9.5 }],
  ]);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(events.map((e) => e.bout), [0, 1, 1, 1, 2]);
  assert.deepEqual(events.map((e) => e.speed_kmh), [null, 9, null, null, 9.5]);
  assert.equal(events[2].t_mono_ms, 250_000);
  assert.equal(events[2].t_local_iso, "t250000");
});

test("every run_start increments the bout even without a stop", () => {
  const events = run([["run_start", 0], ["run_start", 60_000]]);
  assert.deepEqual(events.map((e) => e.bout), [1, 2]);
  assert.equal(currentBout(events), 2);
});

test("undoing the latest run_start removes its bout", () => {
  const events = run([
    ["run_start", 0, { speed_kmh: 9 }],
    ["correction", 5_000, { corrects_seq: 1 }],
  ]);
  assert.equal(currentBout(events), 0);
  assert.equal(events[1].bout, 0);
  assert.equal(events[1].corrects_seq, 1);
  assert.deepEqual(withValidity(events).map((e) => e.valid), [false, true]);
  assert.deepEqual(activeEvents(events), []);
});

test("only the latest active non-correction event can be undone", () => {
  const events = run([["run_start", 0], ["run_stop", 240_000]]);
  assert.equal(undoTarget(events), 2);
  assert.throws(
    () => createEvent("S", events, { event_type: "correction", corrects_seq: 1 }, reading(250_000)),
    /latest active event/,
  );
  const undone = [...events, createEvent("S", events, { event_type: "correction", corrects_seq: 2 }, reading(250_000))];
  assert.equal(undoTarget(undone), 1);
  assert.throws(
    () => createEvent("S", undone, { event_type: "correction", corrects_seq: 3 }, reading(260_000)),
    /latest active event/,
  );
});

test("RPE must be an integer from 1 to 10 and carries the current bout", () => {
  const events = run([["run_start", 0], ["run_stop", 240_000]]);
  for (const bad of [0, 11, 5.5, undefined]) {
    assert.throws(() => createEvent("S", events, { event_type: "rpe", rpe: bad }, reading(241_000)), /RPE/);
  }
  const rpe = createEvent("S", events, { event_type: "rpe", rpe: 7 }, reading(241_000));
  assert.equal(rpe.rpe, 7);
  assert.equal(rpe.bout, 1);
});

test("unknown event types are rejected", () => {
  assert.throws(() => createEvent("S", [], { event_type: "lap" }, reading(0)), /Unknown event type/);
});

test("a wall-clock jump larger than 2 s is flagged", () => {
  const first = createEvent("S", [], { event_type: "sync" }, reading(0));
  const jumped = createEvent("S", [first], { event_type: "note", note: "x" }, reading(10_000, 5_000));
  const steady = createEvent("S", [first], { event_type: "note", note: "x" }, reading(10_000, 1_000));
  assert.equal(jumped.flags, "clock_jump");
  assert.equal(steady.flags, "");
});

test("the resumed option is recorded as a flag", () => {
  const event = createEvent("S", [], { event_type: "sync" }, reading(0), { resumed: true });
  assert.equal(event.flags, "resumed");
});

test("lastSpeed returns the speed of the latest active run_start", () => {
  const events = run([
    ["run_start", 0, { speed_kmh: 9 }],
    ["run_stop", 240_000],
    ["run_start", 330_000, { speed_kmh: 10 }],
    ["correction", 331_000, { corrects_seq: 3 }],
  ]);
  assert.equal(lastSpeed(events, null), 9);
  assert.equal(lastSpeed([], 6), 6);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL，錯誤為找不到 `../state.js`。

- [ ] **Step 3: 實作 `state.js`（事件部分）**

```js
// Pure event logic. Events are append-only; corrections revoke earlier events.

export const STATE_EVENTS = [
  "warmup_start", "run_start", "run_stop", "recovery_end", "cooldown_start", "test_end",
];
export const EVENT_TYPES = ["sync", ...STATE_EVENTS, "rpe", "note", "correction"];
export const EVENT_LABELS = {
  sync: "同步",
  warmup_start: "暖身開始",
  run_start: "跑步開始",
  run_stop: "停止跑步",
  recovery_end: "恢復結束",
  cooldown_start: "緩和開始",
  test_end: "測試結束",
  rpe: "RPE",
  note: "備註",
  correction: "撤銷",
};
export const CLOCK_JUMP_MS = 2000;

function revokedSeqs(events) {
  return new Set(
    events.filter((e) => e.event_type === "correction").map((e) => e.corrects_seq),
  );
}

export function withValidity(events) {
  const revoked = revokedSeqs(events);
  return events.map((e) => ({ ...e, valid: !revoked.has(e.seq) }));
}

export function activeEvents(events) {
  const revoked = revokedSeqs(events);
  return events.filter((e) => e.event_type !== "correction" && !revoked.has(e.seq));
}

export function currentBout(events) {
  return activeEvents(events).filter((e) => e.event_type === "run_start").length;
}

export function lastSpeed(events, fallback = null) {
  const starts = activeEvents(events).filter(
    (e) => e.event_type === "run_start" && Number.isFinite(e.speed_kmh),
  );
  return starts.length ? starts.at(-1).speed_kmh : fallback;
}

export function undoTarget(events) {
  const active = activeEvents(events);
  return active.length ? active.at(-1).seq : null;
}

export function createEvent(sessionId, events, input, reading, options = {}) {
  const type = input.event_type;
  if (!EVENT_TYPES.includes(type)) throw new Error(`Unknown event type: ${type}`);
  if (type === "rpe" && !(Number.isInteger(input.rpe) && input.rpe >= 1 && input.rpe <= 10)) {
    throw new Error("RPE must be an integer from 1 to 10");
  }
  if (type === "correction" && (input.corrects_seq == null || input.corrects_seq !== undoTarget(events))) {
    throw new Error("Only the latest active event can be undone");
  }
  const seq = events.length ? Math.max(...events.map((e) => e.seq)) + 1 : 1;

  const flags = [];
  if (options.resumed) flags.push("resumed");
  const previous = events.at(-1);
  if (previous) {
    const drift = (reading.epochMs - previous.t_epoch_ms) - (reading.monoMs - previous.t_mono_ms);
    if (Math.abs(drift) > CLOCK_JUMP_MS) flags.push("clock_jump");
  }

  let bout = currentBout(events);
  if (type === "run_start") bout += 1;
  if (type === "correction") {
    bout = currentBout([...events, { seq, event_type: "correction", corrects_seq: input.corrects_seq }]);
  }

  return {
    session_id: sessionId,
    seq,
    event_type: type,
    bout,
    speed_kmh: type === "run_start" && Number.isFinite(input.speed_kmh) ? input.speed_kmh : null,
    rpe: type === "rpe" ? input.rpe : null,
    note: typeof input.note === "string" ? input.note : "",
    t_epoch_ms: reading.epochMs,
    t_local_iso: reading.localIso,
    t_mono_ms: reading.monoMs,
    corrects_seq: type === "correction" ? input.corrects_seq : null,
    flags: flags.join(";"),
  };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS（clock 4 tests＋state-events 9 tests）。

- [ ] **Step 5: Commit**

```bash
git add state.js tests/state-events.test.mjs
git commit -m "feat: add append-only event model with corrections and bout counting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 目前狀態、建議按鈕、異常提示與時間格式

**Files:**
- Modify: `state.js`（在檔案末尾新增）
- Test: `tests/state-derived.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `activeEvents`、`currentBout`、`STATE_EVENTS`、`createEvent`。
- Produces（`state.js`）:
  - `REST_DEVIATION_MS = 30000`
  - `deriveState(events, nowMonoMs): { key: string, label: string, bout: number, elapsedInStateMs: number | null, totalElapsedMs: number }`，`key` 為 `"none"` 或最後一個狀態事件類型。
  - `suggestedNext(key): string | null`
  - `restDurations(active: Event[]): number[]`（毫秒）
  - `anomalies(events): string[]`
  - `formatDuration(ms): string`（`m:ss` 或 `h:mm:ss`）

- [ ] **Step 1: 撰寫失敗的測試**

`tests/state-derived.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  anomalies,
  createEvent,
  deriveState,
  formatDuration,
  suggestedNext,
} from "../state.js";

function run(steps) {
  let events = [];
  for (const [event_type, monoMs, extra = {}] of steps) {
    const reading = { epochMs: 1_000_000 + monoMs, monoMs, localIso: "x" };
    events = [...events, createEvent("S", events, { event_type, ...extra }, reading)];
  }
  return events;
}

test("deriveState reports status, bout and elapsed time", () => {
  const events = run([["warmup_start", 0], ["run_start", 300_000], ["run_stop", 540_000]]);
  const state = deriveState(events, 590_000);
  assert.equal(state.key, "run_stop");
  assert.equal(state.label, "第 1 組｜恢復中");
  assert.equal(state.bout, 1);
  assert.equal(state.elapsedInStateMs, 50_000);
  assert.equal(state.totalElapsedMs, 590_000);
});

test("deriveState before any state event", () => {
  const events = run([["sync", 0]]);
  const state = deriveState(events, 5_000);
  assert.equal(state.key, "none");
  assert.equal(state.label, "未開始");
  assert.equal(state.elapsedInStateMs, null);
});

test("sync, rpe and note do not change the state", () => {
  const events = run([["run_start", 0], ["run_stop", 240_000], ["rpe", 241_000, { rpe: 6 }], ["note", 242_000, { note: "ok" }]]);
  const state = deriveState(events, 250_000);
  assert.equal(state.key, "run_stop");
  assert.equal(state.elapsedInStateMs, 10_000);
});

test("non-bout states have plain labels", () => {
  assert.equal(deriveState(run([["warmup_start", 0]]), 1).label, "暖身中");
  assert.equal(deriveState(run([["cooldown_start", 0]]), 1).label, "緩和中");
  assert.equal(deriveState(run([["test_end", 0]]), 1).label, "已結束");
});

test("suggestedNext follows the usual protocol order", () => {
  assert.equal(suggestedNext("none"), "warmup_start");
  assert.equal(suggestedNext("warmup_start"), "run_start");
  assert.equal(suggestedNext("run_start"), "run_stop");
  assert.equal(suggestedNext("run_stop"), "recovery_end");
  assert.equal(suggestedNext("recovery_end"), "run_start");
  assert.equal(suggestedNext("cooldown_start"), "test_end");
  assert.equal(suggestedNext("test_end"), null);
});

test("anomalies flag a missing stop and a stop without a start", () => {
  assert.match(anomalies(run([["run_start", 0], ["run_start", 60_000]])).join(), /停止跑步/);
  assert.match(anomalies(run([["warmup_start", 0], ["run_stop", 60_000]])).join(), /跑步開始/);
  assert.deepEqual(anomalies(run([["run_start", 0], ["run_stop", 240_000]])), []);
});

test("anomalies flag a rest that deviates more than 30 s from earlier rests", () => {
  const base = [
    ["run_start", 0], ["run_stop", 240_000],
    ["run_start", 330_000], ["run_stop", 570_000],
    ["run_start", 660_000], ["run_stop", 900_000],
  ];
  const long = anomalies(run([...base, ["run_start", 1_050_000]]));
  assert.match(long.join(), /休息 150 秒/);
  const normal = anomalies(run([...base, ["run_start", 1_000_000]]));
  assert.deepEqual(normal, []);
});

test("anomalies surface a clock jump on the latest event", () => {
  const first = createEvent("S", [], { event_type: "sync" }, { epochMs: 0, monoMs: 0, localIso: "x" });
  const jumped = createEvent("S", [first], { event_type: "note", note: "x" }, { epochMs: 20_000, monoMs: 10_000, localIso: "x" });
  assert.match(anomalies([first, jumped]).join(), /時鐘/);
});

test("formatDuration uses m:ss and h:mm:ss", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(formatDuration(3_723_000), "1:02:03");
  assert.equal(formatDuration(-500), "0:00");
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL，`deriveState` 等不是 `state.js` 的 export。

- [ ] **Step 3: 在 `state.js` 末尾新增實作**

```js
export const REST_DEVIATION_MS = 30_000;

const STATUS_LABELS = {
  none: "未開始",
  warmup_start: "暖身中",
  run_start: "跑步中",
  run_stop: "恢復中",
  recovery_end: "恢復結束",
  cooldown_start: "緩和中",
  test_end: "已結束",
};
const BOUT_STATES = new Set(["run_start", "run_stop", "recovery_end"]);
const NEXT_EVENT = {
  none: "warmup_start",
  warmup_start: "run_start",
  run_start: "run_stop",
  run_stop: "recovery_end",
  recovery_end: "run_start",
  cooldown_start: "test_end",
  test_end: null,
};

export function deriveState(events, nowMonoMs) {
  const stateEvents = activeEvents(events).filter((e) => STATE_EVENTS.includes(e.event_type));
  const last = stateEvents.at(-1) ?? null;
  const key = last ? last.event_type : "none";
  const bout = currentBout(events);
  const status = STATUS_LABELS[key];
  return {
    key,
    label: BOUT_STATES.has(key) ? `第 ${bout} 組｜${status}` : status,
    bout,
    elapsedInStateMs: last ? nowMonoMs - last.t_mono_ms : null,
    totalElapsedMs: nowMonoMs,
  };
}

export function suggestedNext(key) {
  return NEXT_EVENT[key] ?? null;
}

export function restDurations(active) {
  const rests = [];
  let stop = null;
  for (const event of active) {
    if (event.event_type === "run_stop") stop = event;
    if (event.event_type === "run_start" && stop) {
      rests.push(event.t_mono_ms - stop.t_mono_ms);
      stop = null;
    }
  }
  return rests;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function anomalies(events) {
  const active = activeEvents(events);
  const last = active.at(-1);
  if (!last) return [];
  const warnings = [];
  const stateEvents = active.filter((e) => STATE_EVENTS.includes(e.event_type));
  const previousState = stateEvents.at(-2);
  if (last.event_type === "run_start" && previousState?.event_type === "run_start") {
    warnings.push("上一組沒有按「停止跑步」");
  }
  if (last.event_type === "run_stop" && previousState?.event_type !== "run_start") {
    warnings.push("「停止跑步」前沒有「跑步開始」");
  }
  if (last.event_type === "run_start") {
    const rests = restDurations(active);
    if (rests.length >= 2) {
      const current = rests.at(-1);
      if (Math.abs(current - median(rests.slice(0, -1))) > REST_DEVIATION_MS) {
        warnings.push(`本次休息 ${Math.round(current / 1000)} 秒，與前幾組中位數相差超過 30 秒`);
      }
    }
  }
  if (last.flags.split(";").includes("clock_jump")) {
    warnings.push("偵測到手機時鐘跳動，請在備註說明");
  }
  return warnings;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS（clock 4＋state-events 9＋state-derived 9）。

- [ ] **Step 5: Commit**

```bash
git add state.js tests/state-derived.test.mjs
git commit -m "feat: derive status, suggestions, anomalies and durations from events" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 場次驗證與 CSV 匯出

**Files:**
- Create: `session.js`
- Create: `export.js`
- Test: `tests/session.test.mjs`
- Test: `tests/export.test.mjs`

**Interfaces:**
- Consumes: `APP_VERSION`（Task 1）；`withValidity`、`EVENT_LABELS`、`createEvent`（Task 2）。
- Produces:
  - `session.js`：`CODE_PATTERN: RegExp`；`validateSessionInput(input): string[]`；`createSession(input, reading, uuid, appVersion): Session`
  - `Session` 欄位：`session_id, participant_code, protocol_label, operator, created_epoch_ms, created_local_iso, exported, app_version`（`created_local_iso` 為檔名所需，補充規格中的 `created_epoch_ms`）
  - `export.js`：`CSV_COLUMNS: string[]`；`escapeCsv(value): string`；`toCsv(session, events): string`；`csvFileName(session): string`

- [ ] **Step 1: 撰寫失敗的測試**

`tests/session.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createSession, validateSessionInput } from "../session.js";

test("participant codes must be short code-like identifiers", () => {
  assert.deepEqual(validateSessionInput({ participant_code: "S01" }), []);
  assert.deepEqual(validateSessionInput({ participant_code: "A-2_b" }), []);
  for (const bad of ["", "王小明", "S 01", "x".repeat(33)]) {
    assert.equal(validateSessionInput({ participant_code: bad }).length, 1, bad);
  }
});

test("protocol and operator lengths are limited", () => {
  assert.equal(validateSessionInput({ participant_code: "S01", protocol_label: "p".repeat(61) }).length, 1);
  assert.equal(validateSessionInput({ participant_code: "S01", operator: "o".repeat(33) }).length, 1);
});

test("createSession trims fields and records creation time", () => {
  const session = createSession(
    { participant_code: " S01 ", protocol_label: " 9 km/h × 4 min ", operator: "" },
    { epochMs: 123, localIso: "2026-11-24T16:05:12.345+08:00", monoMs: 0 },
    "uuid-1",
    "0.1.0",
  );
  assert.deepEqual(session, {
    session_id: "uuid-1",
    participant_code: "S01",
    protocol_label: "9 km/h × 4 min",
    operator: "",
    created_epoch_ms: 123,
    created_local_iso: "2026-11-24T16:05:12.345+08:00",
    exported: false,
    app_version: "0.1.0",
  });
  assert.throws(() => createSession({ participant_code: "王小明" }, { epochMs: 0, localIso: "", monoMs: 0 }, "u", "0.1.0"));
});
```

`tests/export.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";

import { CSV_COLUMNS, csvFileName, escapeCsv, toCsv } from "../export.js";
import { createEvent } from "../state.js";

const session = {
  session_id: "uuid-1",
  participant_code: "S01",
  protocol_label: "9 km/h × 4 min",
  operator: "op",
  created_epoch_ms: 0,
  created_local_iso: "2026-11-24T16:05:12.345+08:00",
  exported: false,
  app_version: "0.1.0",
};

function build() {
  let events = [];
  const steps = [
    { event_type: "run_start", speed_kmh: 9 },
    { event_type: "run_stop" },
    { event_type: "note", note: '含,逗號與"引號"' },
    { event_type: "correction", corrects_seq: 3 },
  ];
  steps.forEach((input, index) => {
    const reading = { epochMs: 1000 * index, monoMs: 1000 * index, localIso: `iso${index}` };
    events = [...events, createEvent(session.session_id, events, input, reading)];
  });
  return events;
}

test("escapeCsv quotes commas, quotes and line breaks", () => {
  assert.equal(escapeCsv("plain"), "plain");
  assert.equal(escapeCsv('a,"b"'), '"a,""b"""');
  assert.equal(escapeCsv("a\nb"), '"a\nb"');
  assert.equal(escapeCsv(null), "");
  assert.equal(escapeCsv(false), "false");
});

test("toCsv writes BOM, CRLF, metadata comments, header and rows", () => {
  const csv = toCsv(session, build());
  assert.ok(csv.startsWith("\uFEFF# app: hrr-log\r\n"));
  assert.ok(csv.endsWith("\r\n"));
  const lines = csv.slice(1).split("\r\n").filter(Boolean);
  const meta = lines.filter((line) => line.startsWith("# "));
  assert.ok(meta.includes("# participant_code: S01"));
  assert.ok(meta.includes("# protocol_label: 9 km/h × 4 min"));
  const body = lines.filter((line) => !line.startsWith("# "));
  assert.equal(body[0], CSV_COLUMNS.join(","));
  assert.equal(body.length, 5);
});

test("rows keep revoked events with valid=false and escape notes", () => {
  const body = toCsv(session, build()).slice(1).split("\r\n").filter((line) => line && !line.startsWith("# "));
  const header = body[0].split(",");
  const validIndex = header.indexOf("valid");
  const noteRow = body[3];
  assert.ok(noteRow.includes('"含,逗號與""引號"""'));
  assert.ok(noteRow.endsWith(",false,"));
  assert.ok(body[4].includes(",撤銷,"));
  assert.equal(body[1].split(",")[validIndex], "true");
});

test("csvFileName uses the code and local creation minute", () => {
  assert.equal(csvFileName(session), "HRR-log_S01_20261124-1605.csv");
  assert.equal(csvFileName({ ...session, participant_code: "a/b c" }), "HRR-log_a_b_c_20261124-1605.csv");
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL，找不到 `../session.js` 與 `../export.js`。

- [ ] **Step 3: 實作 `session.js`**

```js
export const CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export function validateSessionInput(input) {
  const errors = [];
  const code = String(input.participant_code ?? "").trim();
  if (!CODE_PATTERN.test(code)) {
    errors.push("受試者代碼只能使用英數字、底線或連字號，長度 1–32；請勿輸入姓名。");
  }
  if (String(input.protocol_label ?? "").trim().length > 60) errors.push("Protocol 名稱最多 60 字。");
  if (String(input.operator ?? "").trim().length > 32) errors.push("操作者最多 32 字。");
  return errors;
}

export function createSession(input, reading, uuid, appVersion) {
  const errors = validateSessionInput(input);
  if (errors.length) throw new Error(errors.join(" "));
  return {
    session_id: uuid,
    participant_code: String(input.participant_code).trim(),
    protocol_label: String(input.protocol_label ?? "").trim(),
    operator: String(input.operator ?? "").trim(),
    created_epoch_ms: reading.epochMs,
    created_local_iso: reading.localIso,
    exported: false,
    app_version: appVersion,
  };
}
```

- [ ] **Step 4: 實作 `export.js`**

```js
import { APP_VERSION } from "./version.js";
import { EVENT_LABELS, withValidity } from "./state.js";

export const CSV_COLUMNS = [
  "session_id", "seq", "event_type", "event_label", "bout", "speed_kmh", "rpe", "note",
  "t_epoch_ms", "t_local_iso", "t_mono_ms", "corrects_seq", "valid", "flags",
];

export function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ");
}

export function toCsv(session, events) {
  const meta = [
    ["app", "hrr-log"],
    ["app_version_at_creation", session.app_version],
    ["app_version_at_export", APP_VERSION],
    ["session_id", session.session_id],
    ["participant_code", session.participant_code],
    ["protocol_label", session.protocol_label],
    ["operator", session.operator],
    ["created_local_iso", session.created_local_iso],
    ["readme", "Lines starting with '# ' are metadata. valid=false rows were undone by a correction event."],
  ].map(([key, value]) => `# ${key}: ${oneLine(value)}`);
  const rows = withValidity([...events].sort((a, b) => a.seq - b.seq)).map((event) =>
    CSV_COLUMNS.map((column) =>
      escapeCsv(column === "event_label" ? EVENT_LABELS[event.event_type] : event[column]),
    ).join(","),
  );
  return `\uFEFF${[...meta, CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

export function csvFileName(session) {
  const code = String(session.participant_code).replace(/[<>:"/\\|?*\s]+/g, "_");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(session.created_local_iso);
  const stamp = match ? `${match[1]}${match[2]}${match[3]}-${match[4]}${match[5]}` : "unknown";
  return `HRR-log_${code}_${stamp}.csv`;
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS（全部測試，含 session 3 與 export 4）。

- [ ] **Step 6: Commit**

```bash
git add session.js export.js tests/session.test.mjs tests/export.test.mjs
git commit -m "feat: add session validation and CSV export" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: IndexedDB 儲存與介面

**Files:**
- Create: `store.js`
- Create: `index.html`
- Create: `styles.css`
- Create: `app.js`

**Interfaces:**
- Consumes: Task 1–4 的全部 export。
- Produces（`store.js`）：`openDb(): Promise<IDBDatabase>`；`putSession(db, session)`；`getSession(db, id)`；`listSessions(db)`（依建立時間新到舊）；`putEvent(db, event)`；`listEvents(db, sessionId)`（依 `seq`）；`deleteSession(db, id)`；`setMeta(db, key, value)`；`getMeta(db, key)`。全部回傳 Promise，寫入在 transaction `complete` 後才 resolve。

本任務為瀏覽器程式，以 Step 5 的瀏覽器操作驗證，不寫 Node 單元測試。

- [ ] **Step 1: 實作 `store.js`**

```js
// IndexedDB persistence. Writes resolve only after the transaction commits.

const DB_NAME = "hrr-log";
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("sessions", { keyPath: "session_id" });
      const events = db.createObjectStore("events", { keyPath: ["session_id", "seq"] });
      events.createIndex("by_session", "session_id");
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function write(db, storeNames, apply) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, "readwrite");
    apply(transaction);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function read(db, storeName, query) {
  return new Promise((resolve, reject) => {
    const request = query(db.transaction(storeName, "readonly").objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const putSession = (db, session) =>
  write(db, "sessions", (t) => t.objectStore("sessions").put(session));

export const getSession = (db, id) => read(db, "sessions", (s) => s.get(id));

export async function listSessions(db) {
  const sessions = await read(db, "sessions", (s) => s.getAll());
  return sessions.sort((a, b) => b.created_epoch_ms - a.created_epoch_ms);
}

export const putEvent = (db, event) =>
  write(db, "events", (t) => t.objectStore("events").put(event));

export async function listEvents(db, sessionId) {
  const events = await read(db, "events", (s) => s.index("by_session").getAll(sessionId));
  return events.sort((a, b) => a.seq - b.seq);
}

export const deleteSession = (db, id) =>
  write(db, ["sessions", "events"], (t) => {
    t.objectStore("sessions").delete(id);
    t.objectStore("events").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  });

export const setMeta = (db, key, value) =>
  write(db, "meta", (t) => t.objectStore("meta").put({ key, value }));

export async function getMeta(db, key) {
  const row = await read(db, "meta", (s) => s.get(key));
  return row ? row.value : null;
}
```

- [ ] **Step 2: 建立 `index.html`**

```html
<!doctype html>
<html lang="zh-Hant-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#20364D">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="HRR Log">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icons/icon-192.png">
  <link rel="stylesheet" href="styles.css">
  <title>HRR 事件紀錄</title>
  <script type="module" src="app.js"></script>
</head>
<body>
  <main id="home" class="screen">
    <header class="bar"><h1>HRR 事件紀錄</h1><span id="version" class="muted"></span></header>
    <form id="new-session" class="card" autocomplete="off">
      <label>受試者代碼<input name="participant_code" required placeholder="例如 S01"></label>
      <p class="hint">只用代碼，請勿輸入姓名（英數字、底線、連字號，最多 32 字）。</p>
      <label>Protocol<input name="protocol_label" placeholder="例如 9 km/h × 4 min"></label>
      <label>操作者（選填）<input name="operator"></label>
      <p id="form-error" class="error" hidden></p>
      <button type="submit" class="primary">開始新場次</button>
    </form>
    <section class="card">
      <h2>歷史場次</h2>
      <p class="hint">資料只存在這支手機。每場結束後請立即匯出 CSV。</p>
      <ul id="session-list" class="sessions"></ul>
    </section>
  </main>

  <main id="test" class="screen" hidden>
    <header class="status">
      <div class="status-main"><span id="st-code"></span><span id="st-label"></span></div>
      <div class="clocks">
        <span>本狀態 <b id="st-elapsed">—</b></span>
        <span>總時間 <b id="st-total">0:00</b></span>
      </div>
    </header>
    <p id="warnings" class="warning" hidden></p>
    <p id="wakelock-hint" class="warning" hidden>此瀏覽器無法保持螢幕常亮，請關閉自動鎖定。</p>
    <section class="speed">
      <span>下一組速度</span>
      <button id="speed-down" type="button">−0.5</button>
      <b id="speed-value">—</b><span>km/h</span>
      <button id="speed-up" type="button">+0.5</button>
    </section>
    <section class="grid">
      <button type="button" class="ev" data-event="run_start">跑步開始</button>
      <button type="button" class="ev" data-event="run_stop">停止跑步</button>
      <button type="button" class="ev" data-event="recovery_end">恢復結束</button>
      <button type="button" class="ev" data-event="warmup_start">暖身開始</button>
      <button type="button" class="ev" data-event="cooldown_start">緩和開始</button>
      <button type="button" class="ev" data-event="sync">同步</button>
    </section>
    <section id="rpe-panel" class="rpe" hidden>
      <span>RPE（第 <b id="rpe-bout"></b> 組，1–10）</span>
      <div id="rpe-buttons" class="rpe-buttons"></div>
      <button id="rpe-skip" type="button">略過</button>
    </section>
    <section class="tools">
      <button id="btn-rpe" type="button">RPE</button>
      <button id="btn-note" type="button">備註</button>
      <button id="btn-undo" type="button">撤銷上一筆</button>
    </section>
    <ol id="recent" class="recent"></ol>
    <button id="btn-end" type="button" class="danger">長按 1 秒：測試結束</button>
    <p id="save-error" class="error clickable" hidden></p>
    <section id="export-panel" class="overlay" hidden>
      <div class="card">
        <p>測試已結束。請立即匯出 CSV，資料只存在這支手機。</p>
        <button id="btn-export-now" type="button" class="primary">匯出 CSV</button>
        <button id="btn-export-later" type="button">稍後（回首頁）</button>
      </div>
    </section>
  </main>
</body>
</html>
```

- [ ] **Step 3: 建立 `styles.css`**

```css
:root {
  --navy: #20364d;
  --teal: #187a84;
  --ink: #203247;
  --paper: #f4f7f9;
  --line: #d7e1e8;
  --warn: #9a3412;
  --warn-bg: #ffedd5;
  --danger: #b91c1c;
  font-family: system-ui, "Microsoft JhengHei", "PingFang TC", sans-serif;
  color: var(--ink);
  background: var(--paper);
}
* { box-sizing: border-box; }
body { margin: 0; padding: env(safe-area-inset-top) 12px env(safe-area-inset-bottom); }
.screen { max-width: 520px; margin: 0 auto; padding-bottom: 24px; }
h1 { font-size: 1.3rem; margin: 12px 0; }
h2 { font-size: 1.1rem; margin: 0 0 8px; }
.bar { display: flex; justify-content: space-between; align-items: baseline; }
.muted, .hint { color: #667481; font-size: 0.85rem; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px; margin: 12px 0; }
label { display: block; margin: 8px 0; font-weight: 600; }
input { display: block; width: 100%; min-height: 44px; margin-top: 4px; padding: 8px; font-size: 1rem; border: 1px solid var(--line); border-radius: 8px; }
button { min-height: 64px; min-width: 64px; padding: 8px 12px; font-size: 1rem; border-radius: 10px; border: 1px solid var(--line); background: #fff; color: var(--ink); }
button.primary { width: 100%; background: var(--navy); color: #fff; border-color: var(--navy); }
.error { color: var(--danger); font-weight: 600; }
.clickable { cursor: pointer; text-decoration: underline; }
.warning { background: var(--warn-bg); color: var(--warn); border-radius: 8px; padding: 8px; margin: 8px 0; }
.sessions { list-style: none; padding: 0; margin: 0; }
.sessions li { border-top: 1px solid var(--line); padding: 8px 0; }
.sessions .actions { display: flex; gap: 8px; margin-top: 6px; }
.badge { font-size: 0.8rem; padding: 2px 6px; border-radius: 6px; margin-left: 6px; }
.badge.pending { background: var(--warn-bg); color: var(--warn); }
.badge.done { background: #e0f2f1; color: var(--teal); }
.status { position: sticky; top: 0; background: var(--navy); color: #fff; border-radius: 0 0 12px 12px; padding: 10px 12px; z-index: 1; }
.status-main { display: flex; gap: 12px; font-size: 1.15rem; font-weight: 700; }
.clocks { display: flex; justify-content: space-between; margin-top: 4px; font-variant-numeric: tabular-nums; }
.speed { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
.speed b { font-size: 1.4rem; min-width: 3.5ch; text-align: center; font-variant-numeric: tabular-nums; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ev { min-height: 84px; font-size: 1.15rem; font-weight: 700; }
.ev.suggested { background: var(--teal); color: #fff; border-color: var(--teal); }
.rpe { background: #fff; border: 2px solid var(--teal); border-radius: 12px; padding: 10px; margin: 10px 0; }
.rpe-buttons { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 8px 0; }
.rpe-buttons button { font-size: 1.2rem; font-weight: 700; }
.tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
.recent { padding-left: 0; list-style: none; font-size: 0.9rem; font-variant-numeric: tabular-nums; }
.recent li { padding: 4px 0; border-bottom: 1px dashed var(--line); }
.recent li.revoked { text-decoration: line-through; color: #94a3b8; }
.danger { width: 100%; min-height: 64px; background: #fff; color: var(--danger); border: 2px solid var(--danger); font-weight: 700; }
.danger.holding { background: var(--danger); color: #fff; }
.overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 2; }
.overlay .card { width: 100%; max-width: 420px; display: grid; gap: 10px; }
[hidden] { display: none !important; }
```

- [ ] **Step 4: 建立 `app.js`**

```js
import { APP_VERSION } from "./version.js";
import { createSessionClock, toLocalIso } from "./clock.js";
import {
  EVENT_LABELS,
  anomalies,
  createEvent,
  deriveState,
  formatDuration,
  lastSpeed,
  suggestedNext,
  undoTarget,
  withValidity,
} from "./state.js";
import { createSession, validateSessionInput } from "./session.js";
import { csvFileName, toCsv } from "./export.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);
const tzOffset = () => -new Date().getTimezoneOffset();

let db = null;
let session = null;
let events = [];
let clock = null;
let speed = null;
let wakeLock = null;
let ticker = null;
let unsaved = [];

function describe(event) {
  const time = event.t_local_iso.slice(11, 19);
  const parts = [`#${event.seq}`, time, EVENT_LABELS[event.event_type]];
  if (event.bout) parts.push(`第 ${event.bout} 組`);
  if (event.speed_kmh != null) parts.push(`${event.speed_kmh} km/h`);
  if (event.rpe != null) parts.push(`RPE ${event.rpe}`);
  if (event.note) parts.push(event.note);
  if (event.corrects_seq != null) parts.push(`→ #${event.corrects_seq}`);
  return parts.join("  ");
}

function sessionEnded(list) {
  return list.some((e) => e.event_type === "test_end");
}

// ---------------------------------------------------------------- home

async function showHome() {
  $("test").hidden = true;
  $("home").hidden = false;
  const list = $("session-list");
  list.replaceChildren();
  for (const item of await store.listSessions(db)) {
    const itemEvents = await store.listEvents(db, item.session_id);
    const li = document.createElement("li");
    const title = document.createElement("div");
    title.textContent = `${item.created_local_iso.slice(0, 16).replace("T", " ")}　${item.participant_code}　${item.protocol_label}`;
    const badge = document.createElement("span");
    badge.className = `badge ${item.exported ? "done" : "pending"}`;
    badge.textContent = item.exported ? "已匯出" : "未匯出";
    title.append(badge);
    const actions = document.createElement("div");
    actions.className = "actions";
    if (!sessionEnded(itemEvents)) {
      actions.append(button("繼續", () => enterTest(item)));
    }
    actions.append(button("匯出", async () => {
      await exportSession(item, itemEvents);
      await showHome();
    }));
    actions.append(button("刪除", async () => {
      const ok = confirm(`刪除後無法復原。確定刪除「${item.participant_code}」這個場次的所有紀錄？`);
      if (!ok) return;
      await store.deleteSession(db, item.session_id);
      await showHome();
    }));
    li.append(title, actions);
    list.append(li);
  }
}

function button(label, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

function bindHome() {
  $("new-session").addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const input = Object.fromEntries(new FormData(submitEvent.target).entries());
    const errors = validateSessionInput(input);
    $("form-error").hidden = !errors.length;
    $("form-error").textContent = errors.join(" ");
    if (errors.length) return;
    const now = Date.now();
    const created = createSession(
      input,
      { epochMs: now, localIso: toLocalIso(now, tzOffset()), monoMs: 0 },
      crypto.randomUUID(),
      APP_VERSION,
    );
    await store.putSession(db, created);
    submitEvent.target.reset();
    await enterTest(created);
  });
}

// ---------------------------------------------------------------- test screen

async function enterTest(selected) {
  session = selected;
  events = await store.listEvents(db, selected.session_id);
  clock = createSessionClock({
    perfNow: () => performance.now(),
    dateNow: () => Date.now(),
    tzOffsetMinutes: tzOffset(),
    resumeFrom: events.at(-1) ?? null,
  });
  speed = lastSpeed(events, null);
  await store.setMeta(db, "active_session_id", selected.session_id);
  $("home").hidden = true;
  $("test").hidden = false;
  $("export-panel").hidden = true;
  $("rpe-panel").hidden = true;
  await requestWakeLock();
  render();
  clearInterval(ticker);
  ticker = setInterval(renderClocks, 250);
}

async function persist(event) {
  try {
    await store.putEvent(db, event);
  } catch (error) {
    console.error(error);
    unsaved.push(event);
  }
  renderSaveError();
}

function renderSaveError() {
  $("save-error").hidden = !unsaved.length;
  $("save-error").textContent = `有 ${unsaved.length} 筆尚未存入手機，點此重試。`;
}

async function record(input) {
  let event;
  try {
    event = createEvent(session.session_id, events, input, clock.now(), {
      resumed: clock.takeResumedFlag(),
    });
  } catch (error) {
    alert(error.message);
    return null;
  }
  events = [...events, event];
  render();
  await persist(event);
  return event;
}

function render() {
  const state = deriveState(events, clock.now().monoMs);
  $("st-code").textContent = session.participant_code;
  $("st-label").textContent = state.label;
  $("speed-value").textContent = speed == null ? "—" : speed.toFixed(1);
  const next = suggestedNext(state.key);
  for (const element of document.querySelectorAll("[data-event]")) {
    element.classList.toggle("suggested", element.dataset.event === next);
  }
  const warnings = anomalies(events);
  $("warnings").hidden = !warnings.length;
  $("warnings").textContent = warnings.join("；");
  const recent = withValidity(events).slice(-5).reverse().map((event) => {
    const li = document.createElement("li");
    li.textContent = describe(event);
    if (!event.valid) li.classList.add("revoked");
    return li;
  });
  $("recent").replaceChildren(...recent);
  renderClocks();
}

function renderClocks() {
  if (!clock || !session) return;
  const state = deriveState(events, clock.now().monoMs);
  $("st-elapsed").textContent = state.elapsedInStateMs == null ? "—" : formatDuration(state.elapsedInStateMs);
  $("st-total").textContent = formatDuration(state.totalElapsedMs);
}

function showRpe(bout) {
  $("rpe-bout").textContent = String(bout);
  $("rpe-panel").hidden = false;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    $("wakelock-hint").hidden = false;
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    $("wakelock-hint").hidden = true;
  } catch {
    $("wakelock-hint").hidden = false;
  }
}

async function exportSession(target, targetEvents) {
  const name = csvFileName(target);
  const file = new File([toCsv(target, targetEvents)], name, { type: "text/csv" });
  let shared = false;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      shared = true;
    } catch (error) {
      if (error.name === "AbortError") return false;
    }
  }
  if (!shared) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await store.putSession(db, { ...target, exported: true });
  return true;
}

async function endTest() {
  const event = await record({ event_type: "test_end" });
  if (!event) return;
  clearInterval(ticker);
  ticker = null;
  await wakeLock?.release().catch(() => {});
  wakeLock = null;
  await store.setMeta(db, "active_session_id", null);
  $("export-panel").hidden = false;
}

async function leaveTest() {
  session = null;
  events = [];
  clock = null;
  await showHome();
}

function bindTest() {
  for (const element of document.querySelectorAll("[data-event]")) {
    element.addEventListener("click", async () => {
      const type = element.dataset.event;
      const input = { event_type: type };
      if (type === "run_start") input.speed_kmh = speed;
      const event = await record(input);
      if (event && type === "run_stop") showRpe(event.bout);
    });
  }
  $("speed-up").addEventListener("click", () => {
    speed = speed == null ? 6 : Math.min(30, speed + 0.5);
    render();
  });
  $("speed-down").addEventListener("click", () => {
    speed = speed == null ? 6 : Math.max(0, speed - 0.5);
    render();
  });
  for (let value = 1; value <= 10; value += 1) {
    $("rpe-buttons").append(button(String(value), async () => {
      $("rpe-panel").hidden = true;
      await record({ event_type: "rpe", rpe: value });
    }));
  }
  $("rpe-skip").addEventListener("click", () => { $("rpe-panel").hidden = true; });
  $("btn-rpe").addEventListener("click", () => showRpe(deriveState(events, clock.now().monoMs).bout));
  $("btn-note").addEventListener("click", async () => {
    const text = prompt("備註");
    if (text && text.trim()) await record({ event_type: "note", note: text.trim() });
  });
  $("btn-undo").addEventListener("click", async () => {
    const target = undoTarget(events);
    if (target == null) return;
    const targetEvent = events.find((e) => e.seq === target);
    if (!confirm(`撤銷 #${target}「${EVENT_LABELS[targetEvent.event_type]}」？`)) return;
    await record({ event_type: "correction", corrects_seq: target });
  });
  const endButton = $("btn-end");
  let endTimer = null;
  endButton.addEventListener("pointerdown", () => {
    endButton.classList.add("holding");
    endTimer = setTimeout(endTest, 1000);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) {
    endButton.addEventListener(type, () => {
      clearTimeout(endTimer);
      endButton.classList.remove("holding");
    });
  }
  $("btn-export-now").addEventListener("click", async () => {
    await exportSession(session, events);
    await leaveTest();
  });
  $("btn-export-later").addEventListener("click", leaveTest);
  $("save-error").addEventListener("click", async () => {
    const pending = unsaved;
    unsaved = [];
    for (const event of pending) await persist(event);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session && !$("test").hidden && ticker) {
      requestWakeLock();
    }
  });
}

// ---------------------------------------------------------------- start

async function init() {
  $("version").textContent = `v${APP_VERSION}`;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((error) => console.error(error));
  }
  navigator.storage?.persist?.();
  db = await store.openDb();
  bindHome();
  bindTest();
  const activeId = await store.getMeta(db, "active_session_id");
  const active = activeId ? await store.getSession(db, activeId) : null;
  if (active) {
    await enterTest(active);
  } else {
    await showHome();
  }
}

init().catch((error) => {
  document.body.textContent = `啟動失敗：${error.message}`;
});
```

- [ ] **Step 5: 本機瀏覽器檢查**

1. 背景啟動本機伺服器（不在專案中產生檔案）：

   Run: `python -m http.server 8765 --bind 127.0.0.1 --directory "C:/Wen_Files/GPT_Projects/hrr-log"`（`run_in_background: true`）

2. 以內建瀏覽器開啟 `http://127.0.0.1:8765/`，切換為手機尺寸（375 × 812）。
3. 依序操作並確認：
   - 受試者代碼輸入「王小明」→ 顯示代碼錯誤；改輸入 `S01` → 進入測試畫面。
   - 按「暖身開始」→ 狀態列顯示「暖身中」，「跑步開始」加亮。
   - 按兩次「+0.5」→ 速度顯示 `6.5`；按「跑步開始」→ 狀態列「第 1 組｜跑步中」。
   - 按「停止跑步」→ 跳出 RPE 面板；按「7」→ 最近事件出現 `RPE 7`。
   - 按「撤銷上一筆」並確認 → RPE 那一筆出現刪除線。
   - 重新整理頁面 → 自動回到同一場次，狀態與最近事件不變。
   - 長按「測試結束」1 秒 → 出現匯出面板；按「稍後」→ 首頁顯示該場次「未匯出」。
4. 以 JavaScript 檢查 CSV 內容（在頁面中執行）：

```js
const { toCsv } = await import("./export.js");
const store = await import("./store.js");
const db = await store.openDb();
const [latest] = await store.listSessions(db);
toCsv(latest, await store.listEvents(db, latest.session_id)).slice(0, 600);
```

   Expected：以 `\uFEFF# app: hrr-log` 起始；表頭為 `CSV_COLUMNS`；撤銷的 RPE 列 `valid` 為 `false`。

5. 停止本機伺服器。

- [ ] **Step 6: 執行單元測試確認未受影響**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add store.js index.html styles.css app.js
git commit -m "feat: add IndexedDB storage and event-logging interface" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 安裝與離線（manifest、service worker、圖示）

**Files:**
- Create: `manifest.webmanifest`
- Create: `sw.js`
- Create: `icons/icon-192.png`
- Create: `icons/icon-512.png`
- Test: `tests/static.test.mjs`

**Interfaces:**
- Consumes: `APP_VERSION`（Task 1）；Task 1–5 的所有前端檔名。
- Produces：`sw.js` 中的 `VERSION` 常數與 `ASSETS` 清單；測試保證兩者與 `version.js`、實際檔案一致。

- [ ] **Step 1: 撰寫失敗的測試**

`tests/static.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { APP_VERSION } from "../version.js";

const root = new URL("../", import.meta.url);

test("service worker cache version matches APP_VERSION", async () => {
  const sw = await readFile(new URL("sw.js", root), "utf8");
  assert.match(sw, new RegExp(`const VERSION = "${APP_VERSION.replace(/\./g, "\\.")}";`));
});

test("service worker caches every front-end file", async () => {
  const sw = await readFile(new URL("sw.js", root), "utf8");
  const files = (await readdir(root)).filter(
    (name) => /\.(js|html|css|webmanifest)$/.test(name) && name !== "sw.js",
  );
  for (const name of files) assert.ok(sw.includes(`"./${name}"`), `${name} missing from ASSETS`);
  assert.ok(sw.includes('"./icons/icon-192.png"'));
  assert.ok(sw.includes('"./icons/icon-512.png"'));
});

test("manifest declares standalone display and both icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node --test "tests/*.test.mjs"`
Expected: FAIL，找不到 `sw.js` 與 `manifest.webmanifest`。

- [ ] **Step 3: 建立 `manifest.webmanifest`**

```json
{
  "name": "HRR 事件紀錄",
  "short_name": "HRR Log",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F4F7F9",
  "theme_color": "#20364D",
  "lang": "zh-Hant-TW",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 4: 建立 `sw.js`**

```js
const VERSION = "0.1.0";
const CACHE = `hrr-log-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./clock.js",
  "./export.js",
  "./session.js",
  "./state.js",
  "./store.js",
  "./version.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("hrr-log-") && key !== CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
  );
});
```

- [ ] **Step 5: 產生圖示（一次性，不留下腳本）**

Run（於 `C:/Wen_Files/GPT_Projects/hrr-log`）：

```bash
cd "C:/Wen_Files/GPT_Projects/hrr-log" && mkdir -p icons && python -B -c "
from PIL import Image, ImageDraw, ImageFont
for size in (192, 512):
    img = Image.new('RGB', (size, size), '#20364D')
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('arialbd.ttf', int(size * 0.28))
    except OSError:
        font = ImageFont.load_default()
    box = draw.textbbox((0, 0), 'HRR', font=font)
    draw.text(((size - box[2] + box[0]) / 2, (size - box[3] + box[1]) / 2 - size * 0.04), 'HRR', fill='white', font=font)
    draw.rectangle([size * 0.2, size * 0.74, size * 0.8, size * 0.78], fill='#187A84')
    img.save(f'icons/icon-{size}.png')
"
```

Expected：產生 `icons/icon-192.png`、`icons/icon-512.png`；專案內無 `__pycache__`。

- [ ] **Step 6: 執行測試確認通過**

Run: `node --test "tests/*.test.mjs"`
Expected: PASS（含 static 3 tests）。

- [ ] **Step 7: 瀏覽器檢查離線快取**

1. 背景啟動 `python -m http.server 8765 --bind 127.0.0.1 --directory "C:/Wen_Files/GPT_Projects/hrr-log"`。
2. 以內建瀏覽器開啟 `http://127.0.0.1:8765/`，重新整理一次後在頁面中執行：

```js
const keys = await caches.keys();
const cache = await caches.open(keys.find((key) => key.startsWith("hrr-log-")));
[keys, (await cache.keys()).length, navigator.serviceWorker.controller !== null];
```

   Expected：`["hrr-log-0.1.0"]`、`13`、`true`。

3. 停止本機伺服器，重新整理頁面 → 頁面仍能載入（由快取提供）。

- [ ] **Step 8: Commit**

```bash
git add manifest.webmanifest sw.js icons/icon-192.png icons/icon-512.png tests/static.test.mjs
git commit -m "feat: make the app installable and available offline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: README 與整體驗收

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: Task 1–6 的成品。
- Produces：使用與開發說明。

- [ ] **Step 1: 建立 `README.md`**

````markdown
# hrr-log：HRR 測試事件紀錄 PWA

跑步機心率恢復（HRR）測試時，用按鈕記錄暖身、跑步開始、停止跑步、恢復結束等事件的時間點與組數，並匯出 CSV。本版不連接任何心率帶或裝置。

網址：https://wenlab501.github.io/hrr-log/

## 安裝到手機主畫面

- iPhone／iPad：用 Safari 開啟網址 → 分享 → 加入主畫面。
- Android：用 Chrome 開啟網址 → 選單 → 安裝應用程式（或加到主畫面）。

安裝後可離線使用。

## 測試流程

1. 輸入受試者代碼（只用代碼，請勿輸入姓名）與 protocol 名稱，開始新場次。
2. 心率裝置開始記錄時，同時按「同步」，留下兩邊共同的時間點。
3. 依實際狀況按「暖身開始」「跑步開始」「停止跑步」「恢復結束」「緩和開始」。
   - 「跑步開始」會記錄畫面上的速度，並自動把組數加 1。
   - 「停止跑步」後會跳出 RPE（1–10），可略過，之後用「RPE」補記。
   - 按錯時用「撤銷上一筆」；原紀錄不會刪除，CSV 中標為 `valid=false`。
4. 長按「測試結束」1 秒，接著按「匯出 CSV」。

## 資料保存

- 紀錄只存在手機瀏覽器（IndexedDB），不會上傳到 GitHub 或任何伺服器。
- 瀏覽器資料可能被系統清除；**每場測試結束後請立即匯出 CSV**，首頁會標示「未匯出」的場次。

## CSV 格式

- UTF-8（含 BOM）、CRLF 換行。
- 以 `# ` 起始的列為場次資訊；之後是表頭與每列一筆事件。
- 欄位：`session_id, seq, event_type, event_label, bout, speed_kmh, rpe, note, t_epoch_ms, t_local_iso, t_mono_ms, corrects_seq, valid, flags`。
- `t_mono_ms` 為場次開始起算的單調時間，不受手機自動校時影響；`flags` 可能為 `resumed`（頁面重開後的第一筆）或 `clock_jump`（偵測到手機時鐘跳動）。

以 Python 讀取：

```python
import io

import pandas as pd

with open("HRR-log_S01_20261124-1605.csv", encoding="utf-8-sig") as handle:
    lines = [line for line in handle if not line.startswith("# ")]
events = pd.read_csv(io.StringIO("".join(lines)))
valid = events[events["valid"]]
```

## 開發

- 純 HTML／CSS／JavaScript，無框架、無建置步驟、無套件相依。
- 單元測試：`node --test "tests/*.test.mjs"`
- 本機預覽：`python -m http.server 8765 --bind 127.0.0.1`，開啟 `http://127.0.0.1:8765/`。
- 發布新版：同步修改 `version.js` 與 `sw.js` 的版本號（測試會檢查兩者一致），推送到 `main` 後 GitHub Pages 自動更新；手機重新開啟 app 即套用新版。

設計文件：`docs/superpowers/specs/2026-11-24-hrr-log-pwa-design.md`
````

- [ ] **Step 2: 整體驗收**

1. Run: `node --test "tests/*.test.mjs"` → Expected: 全部 PASS（clock 4、state-events 9、state-derived 9、session 3、export 4、static 3，共 32）。
2. 依 Task 5 Step 5 與 Task 6 Step 7 再完整操作一次。
3. 檢查專案內沒有禁止項目：

   Run: `find . -path ./.git -prune -o \( -name node_modules -o -name __pycache__ -o -name "*.tmp" \) -print`
   Expected: 無輸出。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add usage, data and development guide" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 發布到 GitHub Pages（執行前須取得使用者確認）

**Files:** 無新增；只推送。

**Interfaces:**
- Consumes: Task 1–7 完成且測試通過的 `main` 分支。
- Produces：公開 repo `wenlab501/hrr-log` 與網址 `https://wenlab501.github.io/hrr-log/`。

- [ ] **Step 1: 向使用者確認**

說明將建立公開 repo `wenlab501/hrr-log`、推送 `main`、開啟 GitHub Pages；repo 只含程式碼與文件。取得明確同意後才繼續。

- [ ] **Step 2: 建立 repo 並推送**

Run: `gh repo create wenlab501/hrr-log --public --source "C:/Wen_Files/GPT_Projects/hrr-log" --remote origin --push --description "Event-logging PWA for treadmill heart-rate-recovery tests"`
Expected：輸出 repo 網址，`main` 已推送。

- [ ] **Step 3: 開啟 GitHub Pages**

Run: `gh api -X POST repos/wenlab501/hrr-log/pages -f "source[branch]=main" -f "source[path]=/"`
Expected：回傳 JSON，含 `"html_url": "https://wenlab501.github.io/hrr-log/"`。

- [ ] **Step 4: 確認部署完成**

Run: `gh api repos/wenlab501/hrr-log/pages --jq .status`
Expected：`built`（首次可能需要 1–2 分鐘；未完成時稍後再查）。

- [ ] **Step 5: 線上檢查**

以內建瀏覽器開啟 `https://wenlab501.github.io/hrr-log/`：首頁顯示 `v0.1.0`；在頁面中執行 `(await caches.keys())` 得到 `["hrr-log-0.1.0"]`。

- [ ] **Step 6: 交給使用者做真機演練**

請使用者在手機安裝後，搭配碼錶模擬一場測試，比對 app 記錄的間隔與碼錶時間，並回報問題。
