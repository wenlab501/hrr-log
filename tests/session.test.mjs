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
