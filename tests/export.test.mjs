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
  assert.ok(csv.startsWith("﻿# app: hrr-log\r\n"));
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
