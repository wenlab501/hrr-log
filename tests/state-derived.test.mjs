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
