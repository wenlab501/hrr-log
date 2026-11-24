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
