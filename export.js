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
  return `﻿${[...meta, CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

export function csvFileName(session) {
  const code = String(session.participant_code).replace(/[<>:"/\\|?*\s]+/g, "_");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(session.created_local_iso);
  const stamp = match ? `${match[1]}${match[2]}${match[3]}-${match[4]}${match[5]}` : "unknown";
  return `HRR-log_${code}_${stamp}.csv`;
}
