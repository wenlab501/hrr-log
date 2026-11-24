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
