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
