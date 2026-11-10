/** Mirror the guest command before sending the reason to the host for its own cleaning. */
export function participantReportReason(value: string) {
  const trimmed = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  const reason = [...trimmed.replace(/\p{Cc}/gu, " ")].slice(0, 500).join("");
  if (!reason) throw new Error("Say in a few words what is wrong with the file");
  return reason;
}
