import { useEffect, useId, useState } from "react";
import type { OnlineGuestSession, OnlineOwnerSharing, OwnerShareSummary } from "./backends/online-files";

type Access = OnlineGuestSession["access"];

export function OwnerShareControls({ sharing, file, publish, published, changed }: {
  sharing: OnlineOwnerSharing;
  file?: string;
  publish?: () => Promise<string>;
  published?: (file: string) => void;
  changed?: (file: string, shared: boolean) => void;
}) {
  const [summary, setSummary] = useState<OwnerShareSummary>({ codes: {} });
  const accessId = useId();
  const [role, setRole] = useState<Access>("edit");
  const [busy, setBusy] = useState(Boolean(file));
  const [message, setMessage] = useState("");
  const shared = Boolean(summary.codes.edit);
  useEffect(() => {
    if (!file) return;
    let active = true;
    setBusy(true);
    sharing.read(file, true).then(value => {
      if (active) { setSummary(value); changed?.(file, Boolean(value.codes.edit)); }
    }).catch(error => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [file, sharing, changed]);

  async function change() {
    setBusy(true); setMessage("");
    let target = file;
    try {
      target ??= await publish?.();
      if (!target) throw new Error("The file is unavailable");
      const result = await sharing.change(target, summary.pending ? summary.pending === "start" : !shared);
      setSummary(result); changed?.(target, Boolean(result.codes.edit));
    } catch (error) {
      if (target) {
        try { setSummary(await sharing.read(target)); } catch { /* Show the original error. */ }
      }
      setMessage(error instanceof Error ? error.message : "Could not change sharing");
    } finally { setBusy(false); if (!file && target) published?.(target); }
  }
  async function copy(format: "code" | "link") {
    if (!file) return;
    try { await sharing.copy(file, role, format); setMessage(format === "code" ? "Code copied" : "Link copied"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not copy invitation"); }
  }
  return <>
    <button type="button" disabled={busy} onClick={change}>{summary.pending ? "Retry " + summary.pending + " sharing" : shared ? "Stop sharing" : "Start sharing"}</button>
    {shared && <><label htmlFor={accessId}>Access</label><select id={accessId} value={role} onChange={event => { setRole(event.target.value as Access); setMessage(""); }}>
      <option value="edit">Can edit</option><option value="comment">Can comment</option><option value="view">Can view</option>
    </select>
      <output aria-label="Join code">{summary.codes[role]}</output>
      <button type="button" disabled={busy} onClick={() => void copy("link")}>Copy link</button>
      <button type="button" disabled={busy} onClick={() => void copy("code")}>Copy code</button>
    </>}
    {message && <p role="status">{message}</p>}
  </>;
}
