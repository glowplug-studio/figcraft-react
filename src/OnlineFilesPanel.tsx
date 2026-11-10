import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OnlineRow, OnlineWorkspace } from "./engine/sharing/online-workspace";

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={close} className="figcraft-online-dialog">
    <h2>{title}</h2>{children}
  </dialog>;
}

const failure = (error: unknown) => error instanceof Error ? error.message : "The server request failed";
const hostName = (address: string) => address.replace(/^\w+:\/\//, "");

function utcDay(seconds: number) {
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().split("T")[0] : "Unknown";
}

export function PublishOnlineDialog({ online, tab, close, published }: {
  online: OnlineWorkspace; tab: { id: number; name: string }; close: () => void; published: (name: string) => void;
}) {
  const [name, setName] = useState(tab.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="Publish to server" close={close}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setError(""); setBusy(true);
      try { const file = await online.publish(tab.id, name); published(file.name); }
      catch (error) { setError(failure(error)); }
      finally { setBusy(false); }
    }}>
      <label>Server address<input readOnly value={online.server} /></label>
      <label>File name<input autoFocus value={name} disabled={busy} onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>Publish</button><button type="button" onClick={close}>Cancel</button>
    </form>
  </Modal>;
}

export function OnlineFilesPanel({ online, opened }: { online: OnlineWorkspace; opened: () => void }) {
  const [rows, setRows] = useState<OnlineRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dialog, setDialog] = useState<{ row: OnlineRow; action: "remove" | "rename" }>();
  const [name, setName] = useState("");
  const host = hostName(online.server);
  useEffect(() => {
    let active = true;
    setBusy(true); setOffline(false); setError("");
    void (async () => {
      try {
        const local = await online.list();
        if (!active) return;
        setRows(local);
        const fresh = await online.refresh();
        if (active) setRows(fresh);
      } catch {
        if (active) setOffline(true);
      } finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [online, retry]);

  const run = async (action: () => Promise<void>, showFile = false) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await action();
      setRows(await online.list());
      setDialog(undefined);
      if (showFile) opened();
    } catch (problem) { setError(failure(problem)); }
    finally { setBusy(false); }
  };
  return <section className="figcraft-online-files" aria-label="Online files">
    <h2>Online files</h2>
    <p>The files you shared or published online from this computer.</p>
    {busy && <p role="status">Checking the server…</p>}
    {offline && <p role="alert">Couldn’t reach {host}. Showing what this computer remembers. <button disabled={busy} onClick={() => setRetry(n => n + 1)}>Try again</button></p>}
    {error && !dialog && <p role="alert">{error}</p>}
    {!busy && !rows.length && <p>Nothing online yet.</p>}
    <ul>{rows.map(row => <li key={row.file}>
      <button type="button" disabled={busy || row.state === "gone" || row.state === "pending"} onClick={() => void run(() => online.open(row.file), true)}>
        <strong>{row.name}</strong><small>{host} · {row.state === "pending" ? "Publication unconfirmed" : row.state === "gone" ? "No longer on the server" : "Not shared · Opened " + utcDay(row.opened)}</small>
      </button>
      <details><summary aria-label={"Actions for " + row.name}>•••</summary><div>
        {row.state === "pending" ? <>
          <button disabled={busy} onClick={() => void run(() => online.retryPublication(row.file))}>Retry publication</button>
          <button disabled={busy} onClick={() => void run(() => online.forget(row.file))}>Forget on this computer</button>
        </> : row.state === "gone" ? <button disabled={busy} onClick={() => void run(() => online.forget(row.file))}>Clear from this list</button> : <>
          <button disabled={busy} onClick={() => void run(() => online.open(row.file), true)}>Open</button>
          <button disabled={busy} onClick={() => { setName(row.name); setDialog({ row, action: "rename" }); }}>Rename on the server…</button>
          <button disabled={busy} onClick={() => setDialog({ row, action: "remove" })}>Remove from server…</button>
          <button disabled={busy} onClick={() => void run(() => online.forget(row.file))}>Forget on this computer</button>
        </>}
      </div></details>
    </li>)}</ul>
    {dialog && <Modal title={dialog.action === "rename" ? "Rename on the server" : "Remove from server"} close={() => setDialog(undefined)}>
      <form onSubmit={event => {
        event.preventDefault();
        void run(() => dialog.action === "rename" ? online.rename(dialog.row.file, name) : online.remove(dialog.row.file));
      }}>
        {dialog.action === "rename" ? <label>File name<input autoFocus value={name} onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} /></label> : <>
          <p>Remove {dialog.row.name} from {host}?</p><p>Open copies remain on their devices. Removing the server file is permanent.</p></>}
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{dialog.action === "rename" ? "Rename" : "Remove"}</button>
        <button type="button" onClick={() => setDialog(undefined)}>Cancel</button>
      </form>
    </Modal>}
  </section>;
}
