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
