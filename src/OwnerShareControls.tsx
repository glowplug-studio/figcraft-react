import { useEffect, useId, useState } from "react";
import type { OnlineGuestSession, OnlineOwnerSharing, OwnerShareSummary } from "./backends/online-files";
import { isShared, offeredShareAccess } from "./engine/sharing/share-access";

type Access = OnlineGuestSession["access"];
const accessLabel: Record<Access, string> = { edit: "Can edit", comment: "Can comment", view: "Can view" };

export function OwnerShareControls({ sharing, file, publish, published, changed }: {
  sharing: OnlineOwnerSharing;
  file?: string;
  publish?: () => Promise<string>;
  published?: (file: string) => void;
  changed?: (file: string, shared: boolean) => void;
}) {
  const [summary, setSummary] = useState<OwnerShareSummary>({ codes: {} });
  const accessId = useId();
  const [role, setRole] = useState<Access>(()=>file ? sharing.access?.(file) ?? "edit" : "edit");
  const [busy, setBusy] = useState(Boolean(file));
  const [message, setMessage] = useState("");
  const shared = isShared(summary);
  // Only the ways in this share actually has are offered, as the native access choice does.
  const offered = offeredShareAccess(summary);
  const shown: Access = offered.includes(role) ? role : "edit";
  useEffect(() => {
    if (!file) return;
    let active = true;
    setBusy(true);
    sharing.read(file, true).then(value => {
      if (active) { setRole(sharing.access?.(file) ?? "edit"); setSummary(value); changed?.(file, isShared(value)); }
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
      setSummary(result); changed?.(target, isShared(result));
    } catch (error) {
      if (target) {
        try { setSummary(await sharing.read(target)); } catch { /* Show the original error. */ }
      }
      setMessage(error instanceof Error ? error.message : "Could not change sharing");
    } finally { setBusy(false); if (!file && target) published?.(target); }
  }
  async function copy(format: "code" | "link") {
    if (!file) return;
    try { await sharing.copy(file, shown, format); setMessage(format === "code" ? "Code copied" : "Link copied"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not copy invitation"); }
  }
  return <>
    <button type="button" disabled={busy} onClick={change}>{summary.pending ? "Retry " + summary.pending + " sharing" : shared ? "Stop sharing" : "Start sharing"}</button>
    {shared && <>{offered.length > 1 && <><label htmlFor={accessId}>Access</label><select id={accessId} value={shown} onChange={event => {
      const access = event.target.value as Access;
      // The visible role changes only once the host has accepted it.
      try { if (file) sharing.selectAccess?.(file, access); setRole(access); setMessage(""); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not change access"); }
    }}>
      {offered.map(access => <option key={access} value={access}>{accessLabel[access]}</option>)}
    </select></>}
      <output aria-label="Join code">{summary.codes[shown]}</output>
      <button type="button" disabled={busy} onClick={() => void copy("link")}>Copy link</button>
      <button type="button" disabled={busy || !summary.codes[shown]} onClick={() => void copy("code")}>Copy code</button>
    </>}
    {message && <p role="status">{message}</p>}
  </>;
}
