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
