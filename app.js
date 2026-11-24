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
