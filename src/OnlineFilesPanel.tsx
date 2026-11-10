import {teamWebLink, type TeamDirectory} from "./engine/sharing/team-directory";
import { serverUtcDate } from "./engine/sharing/server-date";
import { OwnerShareControls } from "./OwnerShareControls";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

function ParticipantReport({send}: {send: (reason: string) => Promise<void>}) {
  const [reason, setReason] = useState<string>();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  return <>
    {reason === undefined ? <button type="button" onClick={() => { setReason(""); setMessage(""); }}>Report this file…</button> :
      <form onSubmit={async event => {
        event.preventDefault();
        if (sending || !reason.trim()) return;
        setSending(true);
        try { await send(reason); setReason(undefined); setMessage("Your report was sent to the server's operator"); }
        catch (error) { setMessage("The report wasn't sent: " + failure(error)); }
        finally { setSending(false); }
      }}>
        <p>What is wrong with this file? The server's operator gets your report.</p>
        <label>Report<input autoFocus value={reason} placeholder="Spam, stolen work, abuse…" disabled={sending}
          onChange={e => setReason([...e.target.value].slice(0,500).join(""))} /></label>
        <button disabled={sending || !reason.trim()}>Send report</button>
        <button type="button" disabled={sending} onClick={() => { setReason(undefined); setMessage(""); }}>Cancel</button>
      </form>}
    {message && <p role="status">{message}</p>}
  </>;
}

export function OnlineHostingInformation({online, file, report}: {
  online: OnlineWorkspace; file?: string; report?: (reason: string) => Promise<void>;
}) {
  const [request, setRequest] = useState(0);
  const [info, setInfo] = useState<Awaited<ReturnType<OnlineWorkspace["hosting"]>>>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!request && !file) return;
    let current = true;
    setFailed(false);
    void online.hosting(file).then(value => { if (current) setInfo(value); },
      () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [online, file, request]);
  if (!online.hasHostingInfo) return null;
  const days = (BigInt(info?.idleSeconds ?? "0") + 86399n) / 86400n;
  return <>
    {info?.operator && <p>Hosted by {info.operator}</p>}
    {info?.terms && /^https?:\/\//.test(info.terms) && <a href={info.terms} target="_blank" rel="noreferrer">Terms</a>}
    {request && info ? <div className="figcraft-hosting-information">
      {!file && info.open && <p>This server is open to the public: no key needed.</p>}
      {days > 0n && <p>Files nobody opens for {days.toString()} {days === 1n ? "day" : "days"} are deleted.</p>}
      {info.expires && <p>The server deletes this file if nobody opens it before {serverUtcDate(info.expires)}.</p>}
      <p>The server operator can read files hosted here.</p>
    </div> : <button type="button" disabled={!!request && !failed} onClick={() => setRequest(n => n + 1)}>
      {failed && request ? "Retry server information" : request ? "Asking the server…" : "About this server"}
    </button>}
    {info?.reports && report && <ParticipantReport send={report} />}
  </>;
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
      <OnlineHostingInformation online={online} />
      <label>File name<input autoFocus value={name} disabled={busy} onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>Publish</button><button type="button" onClick={close}>Cancel</button>
    </form>
  </Modal>;
}

function TeamFiles({online, revision, opened}: {online: OnlineWorkspace; revision: number; opened: () => void}) {
  const [directory, setDirectory] = useState<TeamDirectory | {state: "offline"}>();
  const [joining, setJoining] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true;
    setDirectory(undefined);
    setMessage("");
    void online.teamDirectory().then(value => { if (current) setDirectory(value); },
      () => { if (current) setDirectory({state:"offline"}); });
    return () => { current = false; };
  }, [online, revision]);
  if (!directory || directory.state === "none") return null;
  const host = new URL(online.server).host;
  const heading = "Shared by your team on " + host;
  async function open(file: string) {
    setJoining(true);
    setMessage("");
    try { await online.openTeam(file); opened(); }
    catch (error) { setMessage(failure(error)); }
    finally { setJoining(false); }
  }
  async function copy(link: string, web?: string) {
    try {
      await navigator.clipboard.writeText(web ? teamWebLink(web, link) : link);
      setMessage(web ? "Link copied: it opens the file in the browser" : "Link copied: it opens the file in FigCraft");
    } catch { setMessage("Could not copy the link"); }
  }
  return <section aria-label={heading}>
    <h3>{heading}</h3>
    {directory.state === "offline" ? <p role="alert">Couldn't reach {host} for its team list.</p> :
      directory.files.length === 0 ? <p>Nobody shares a file there now.</p> : <>
        <p>Everyone who reaches this server can open these files while they are shared.</p>
        <ul>{directory.files.map(row => <li key={row.file}>
          <button type="button" disabled={joining} onClick={() => void open(row.file)}>
            <strong>{row.name}</strong><small>{row.people > 0 && row.people + " in it now · "}Changed {serverUtcDate(row.updated).slice(0,10)}</small>
          </button>
          <details name="figcraft-online-actions"><summary aria-label={"Actions for " + row.name}>•••</summary><div>
            <button type="button" disabled={joining} onClick={() => void open(row.file)}>Open</button>
            <button type="button" onClick={() => void copy(online.teamLink(row.file))}>Copy link</button>
            {directory.web && <button type="button" onClick={() => void copy(online.teamLink(row.file), directory.web)}>Copy browser link</button>}
          </div></details>
        </li>)}</ul>
      </>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export function OnlineFilesPanel({ online, opened }: { online: OnlineWorkspace; opened: () => void }) {
  const [rows, setRows] = useState<OnlineRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dialog, setDialog] = useState<{ row: OnlineRow; action: "remove" | "rename" }>();
  const [name, setName] = useState("");
  const [actions, setActions] = useState<string>();
  const [teamRefresh, setTeamRefresh] = useState(0);
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const updateShared = useCallback((file: string, value: boolean) => {
    setShared(previous => previous[file] === value ? previous : { ...previous, [file]: value });
  }, []);
  const sharingChanged = useCallback((file: string, value: boolean) => {
    updateShared(file, value);
    setTeamRefresh(n => n + 1);
  }, [updateShared]);
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
        if (!active) return;
        setRows(fresh);
        if (online.sharing) {
          for (const row of fresh) {
            if (row.state !== "online" || !active) continue;
            const sharing = await online.sharing.read(row.file, true);
            if (active) updateShared(row.file, Boolean(sharing.codes.edit));
          }
        }
      } catch {
        if (active) setOffline(true);
      } finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [online, retry, updateShared]);

  const run = async (action: () => Promise<void>, showFile = false) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await action();
      setRows(await online.list());
      setDialog(undefined);
      if (showFile) opened();
      else setTeamRefresh(n => n + 1);
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
        <strong>{row.name}</strong><small>{host} · {row.state === "pending" ? "Publication unconfirmed" : row.state === "gone" ? "No longer on the server" : (shared[row.file] ? "Shared" : "Not shared") + " · Opened " + utcDay(row.opened)}</small>
      </button>
      <details name="figcraft-online-actions" onToggle={event => { const open = event.currentTarget.open; setActions(current => open ? row.file : current === row.file ? undefined : current); }}><summary aria-label={"Actions for " + row.name}>•••</summary><div>
        {row.state === "pending" ? <>
          <button disabled={busy} onClick={() => void run(() => online.retryPublication(row.file))}>Retry publication</button>
          <button disabled={busy} onClick={() => void run(() => online.forget(row.file))}>Forget on this computer</button>
        </> : row.state === "gone" ? <button disabled={busy} onClick={() => void run(() => online.forget(row.file))}>Clear from this list</button> : <>
          <button disabled={busy} onClick={() => void run(() => online.open(row.file), true)}>Open</button>
          {row.expires && <p>The server deletes this file if nobody opens it before {serverUtcDate(row.expires)}.</p>}
          {online.sharing && actions === row.file && <OwnerShareControls file={row.file} sharing={online.sharing} changed={sharingChanged} />}
          <button disabled={busy} onClick={() => { setName(row.name); setDialog({ row, action: "rename" }); }}>Rename on the server…</button>
          <button disabled={busy} onClick={() => setDialog({ row, action: "remove" })}>Remove from server…</button>
          <button disabled={busy} onClick={() => void run(() => online.forget(row.file))}>Forget on this computer</button>
        </>}
      </div></details>
    </li>)}</ul>
    <TeamFiles key={online.server} online={online} revision={teamRefresh + retry} opened={opened} />
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
