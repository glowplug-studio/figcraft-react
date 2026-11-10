import { OwnerShareControls } from "./OwnerShareControls";
import { OnlineFilesPanel, PublishOnlineDialog } from "./OnlineFilesPanel";
import { OnlineWorkspace } from "./engine/sharing/online-workspace";
import type { GuestSessionEnd, OnlineInvitations, OnlineWorkspaceHost } from "./backends/online-files";
import { defaultPrint, type PrintSettings } from "./engine/export-settings";
import { ImportReportPanel } from "./ImportReportPanel";
import { importNotice, readImportReport, type ImportReport } from "./engine/interchange/import-report";
import { BranchReviewDialog } from "./BranchReviewDialog";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DocumentEditor, type EditorProps } from "./Editor";
import type { WorkspaceRecoveryStore } from "./backends/recovery";
import { EditorWorkspace } from "./engine/workspace";
import { WorkspaceRecovery, type WorkspaceRecoveryState } from "./engine/workspace-recovery";

type WorkspaceProps = Omit<EditorProps, "engine" | "recoveryStore"> & { recoveryStore: WorkspaceRecoveryStore; onlineHost?: OnlineWorkspaceHost };

function GuestSubscription({connection, invitations, ended}: {
  connection: string;
  invitations: OnlineInvitations;
  ended: (connection: string, reason: GuestSessionEnd) => void;
}) {
  useEffect(() => invitations.watch?.(connection, reason => ended(connection, reason)), [connection, invitations, ended]);
  return null;
}

export function WorkspaceEditor({ identity, capabilities, recoveryStore, onlineHost }: WorkspaceProps) {
  const [workspace] = useState(() => new EditorWorkspace());
  const tabs = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const [principal] = useState(() => identity.getSnapshot().principal?.id);
  const [authorised, setAuthorised] = useState(false);
  const [recovery, setRecovery] = useState<WorkspaceRecoveryState>({ status: "loading" });
  const [reviewId, setReviewId] = useState<string>();
  const [closeId, setCloseId] = useState<number>();
  const [renaming, setRenaming] = useState(false);
  const [pdfPrint, setPdfPrint] = useState<PrintSettings>(defaultPrint);
  const [report, setReport] = useState<{ owner: number; value: ImportReport }>();
  const [notice, setNotice] = useState("");
  const closeDialog = useRef<HTMLDialogElement>(null), renameDialog = useRef<HTMLDialogElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const active = tabs.find(tab => tab.active);
  const enabled = authorised && recovery.status !== "loading";
  const [home, setHome] = useState<"recent" | "online">();
  const [publishTab, setPublishTab] = useState<{ id: number; name: string }>();
  const online = useMemo(() => onlineHost && principal ? new OnlineWorkspace(workspace, onlineHost, principal, () => {
    const current = identity.getSnapshot();
    return current.status === "authenticated" && current.principal.id === principal && capabilities.includes("document.edit");
  }) : undefined, [workspace, onlineHost, principal, identity, capabilities]);
  useEffect(() => {
    let controller: WorkspaceRecovery | undefined;
    const update = () => {
      const snapshot = identity.getSnapshot();
      const allow = snapshot.status === "authenticated" && snapshot.principal.id === principal && capabilities.includes("document.edit");
      setAuthorised(allow);
      workspace.setEditable(allow);
      if (!allow) { setHome(undefined); setPublishTab(undefined); setPdfPrint(defaultPrint); setReport(undefined); setNotice(""); controller?.dispose(); controller = undefined; }
      else if (!controller && principal) {
        controller = new WorkspaceRecovery(workspace, recoveryStore, principal, next => setRecovery(previous =>
          previous.status === next.status && previous.message === next.message ? previous : next));
        void controller.start();
      }
    };
    update();
    const unsubscribe = identity.subscribe(update);
    const hidden = () => { if (document.hidden) void controller?.flush(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      unsubscribe(); controller?.dispose(); workspace.setEditable(false);
    };
  }, [identity, principal, capabilities, recoveryStore, workspace]);
  const invitations = onlineHost?.invitations;
  useEffect(() => {
    if (!enabled || !invitations) return;
    return invitations.subscribe(async (session, bytes) => {
      await workspace.open(new File([bytes], session.file + ".figcraft"), session);
      setHome(undefined);
      setNotice("");
    });
  }, [workspace, enabled, invitations]);
  const ended = useCallback((connection: string, reason: GuestSessionEnd) => {
    const session = workspace.getSnapshot().find(tab => tab.guest?.connection === connection)?.guest;
    if (!session || !workspace.setGuestSession({...session, ended: reason})) return;
    const notice = {removed: "The file was removed from the server", stopped: "Sharing was stopped", unavailable: "The session is no longer available"};
    setNotice(notice[reason]);
  }, [workspace]);
  const guest = active?.guest;
  const tabCapabilities = useMemo(() => guest && !guest.ended && guest.access !== "edit" ? capabilities.filter(cap => cap === "document.read"
    || (guest.access === "comment" && cap === "document.comment")) : capabilities, [capabilities, guest]);
  const [openShareTab, setOpenShareTab] = useState<number>();
  const publishedId = active && online?.publishedFile(active.id);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      for (const engine of workspace.engines) engine.execute("version.autosave");
    }, 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [enabled, workspace]);
  useEffect(() => { if (closeId !== undefined) closeDialog.current?.showModal(); }, [closeId]);
  useEffect(() => { if (renaming) renameDialog.current?.showModal(); }, [renaming]);

  useEffect(() => {
    if (report && !tabs.some(tab => tab.id === report.owner)) setReport(undefined);
  }, [report, tabs]);
  const close = async (id: number, force = false) => {
    const tab = workspace.getSnapshot().find(item => item.id === id);
    if (!tab) return;
    if (tab.dirty && !tab.branchId && !force) { setCloseId(id); return; }
    if (tab.guest && invitations) {
      try { await invitations.leave(tab.guest.connection); }
      catch { setCloseId(undefined); setNotice("Could not leave the session"); return; }
      workspace.leaveSession(tab.guest.connection);
    }
    const current = workspace.getSnapshot().find(item => item.id === id);
    if (current?.dirty && !current.branchId && !force) { setCloseId(id); return; }
    if (current) workspace.execute("file.close", { index: current.index, force });
    setCloseId(undefined);
  };
  const leave = async () => {
    if (!guest || !invitations) return;
    try { await invitations.leave(guest.connection); workspace.leaveSession(guest.connection); setNotice("Left session"); }
    catch { setNotice("Could not leave the session"); }
  };
  const shareMenu = enabled && active && online && !guest && (online.sharing || (invitations && publishedId)) && <details className="figcraft-bar-menu"
    onToggle={event => setOpenShareTab(event.currentTarget.open ? active.id : undefined)}><summary>Share</summary><div className="figcraft-menu-items">
    {online.sharing && openShareTab === active.id && <OwnerShareControls sharing={online.sharing} file={publishedId}
      publish={async () => (await online.publish(active.id, active.name)).id} published={() => setNotice("Published " + active.name)} />}
    {invitations && publishedId && (["edit", "view"] as const).map(access => <button key={access} type="button" onClick={async () => {
      try { await invitations.copyPublished(publishedId, access); setNotice(access === "edit" ? "Edit link copied" : "View link copied"); }
      catch { setNotice("Could not copy the published link"); }
    }}>Copy {access} link</button>)}
  </div></details>;
  const fileMenu = active && <>
    {invitations && <button type="button" disabled={!enabled} onClick={event => {
      event.currentTarget.closest("details")?.removeAttribute("open"); invitations.showJoin();
    }}>Join live session…</button>}
    {guest?.ended && invitations?.rejoin && <button type="button" onClick={async () => {
      try {
        const access = await invitations.rejoin!(guest.connection);
        if (!workspace.setGuestSession({file: guest.file, connection: guest.connection, access})) await invitations.leave(guest.connection);
        else setNotice("Rejoined session");
      } catch { setNotice("The invite is unavailable"); }
    }}>Reconnect</button>}
    {guest && <button type="button" onClick={() => void leave()}>Leave session</button>}
    <button type="button" disabled={!enabled} onClick={() => workspace.execute("file.new")}>New file</button>
    <button type="button" disabled title="Browser downloads have no writable file path">Revert to saved</button>
    <details><summary>Open recent</summary><button type="button" disabled>Clear recent</button></details>
    <button type="button" disabled={!enabled} onClick={() => workspace.execute("file.duplicate")}>Duplicate file</button>
    <button type="button" disabled={!enabled} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setRenaming(true); }}>Rename file</button>
    <button type="button" disabled={!enabled} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); close(active.id); }}>Close file</button>
    {online && !guest && <button type="button" disabled={!enabled} onClick={event => {
      event.currentTarget.closest("details")?.removeAttribute("open"); setPublishTab(active);
    }}>Publish to server…</button>}
    {tabs.length > 1 && ([-1, 1] as const).map(offset => {
      const to = active.index + offset;
      return <button type="button" key={offset} disabled={!enabled || to < 0 || to >= tabs.length}
        onClick={() => workspace.execute("file.moveTab", { from: active.index, to })}>Move tab {offset < 0 ? "left" : "right"}</button>;
    })}
  </>;
  return <div className="figcraft-file-workspace" onKeyDown={event => {
    if (enabled && event.ctrlKey && event.key === "Tab" && !event.altKey && !event.metaKey && active) {
      event.preventDefault();
      setHome(undefined);
      workspace.execute(event.shiftKey ? "doc.previousTab" : "doc.nextTab");
    }
  }}>
    {enabled && invitations?.watch && tabs.map(tab => tab.guest && !tab.guest.ended &&
      <GuestSubscription key={tab.guest.connection} connection={tab.guest.connection} invitations={invitations} ended={ended} />)}
    {tabs.length > 1 && <div role="tablist" aria-label="Open files" className="figcraft-file-tabs">
      {tabs.map(tab => <button key={tab.id} type="button" role="tab" disabled={!enabled} aria-selected={tab.active}
        aria-label={tab.guest?.ended ? tab.name + ", disconnected from its live session" : undefined}
        title={tab.guest?.ended ? "Disconnected from its live session" : undefined}
        tabIndex={tab.active ? 0 : -1} onClick={() => { setHome(undefined); workspace.execute("doc.switch", { index: tab.index }); }}
        onKeyDown={event => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          event.preventDefault();
          const index = (tab.index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          (event.currentTarget.parentElement?.children[index] as HTMLElement)?.focus();
          setHome(undefined);
          workspace.execute("doc.switch", { index });
        }}>{tab.name}{tab.guest?.ended && " · Disconnected"}{tab.dirty && <span aria-label="unsaved"> ●</span>}</button>)}
    </div>}
    {online && authorised && home ? <section aria-label="Home" className="figcraft-home">
      <nav aria-label="Home sections">
        <button aria-pressed={home === "recent"} onClick={() => setHome("recent")}>Recents</button>
        <button aria-pressed={home === "online"} onClick={() => setHome("online")}>Online</button>
      </nav>
      {home === "online" ? <OnlineFilesPanel online={online} opened={() => setHome(undefined)} /> : <section aria-label="Open files">
        <h2>Open files</h2>{tabs.map(tab => <button key={tab.id} onClick={() => {
          workspace.execute("doc.switch", { index: tab.index }); setHome(undefined);
        }}>{tab.name}</button>)}
        <button onClick={() => { workspace.execute("file.new"); setHome(undefined); }}>New file</button>
      </section>}
    </section> : active ? <DocumentEditor key={active.id} identity={identity} capabilities={tabCapabilities} engine={workspace.activeEngine}
      shareMenu={shareMenu} sessionLabel={guest && (guest.ended ? "Disconnected" : guest.access === "view" ? "View only" : guest.access === "comment" ? "Can comment" : "Can edit")}
      onHome={online && enabled ? () => setHome("recent") : undefined}
      workspacePrint={pdfPrint} onWorkspacePrint={setPdfPrint}
      onImportReport={(value, owner = active.id) => setReport({ value, owner })}
      workspace={workspace} recoveryStore={recoveryStore} workspaceRecovery={recovery} fileMenu={fileMenu} onWorkspaceNotice={setNotice} onReviewBranch={setReviewId} /> :
      <section aria-label="File workspace"><h1>Files</h1>
        {online && <button disabled={!enabled} onClick={() => setHome("online")}>Online files</button>}
        <button disabled={!enabled} onClick={() => workspace.execute("file.new")}>New file</button>
        <button disabled={!enabled} onClick={() => openInput.current?.click()}>Open file</button>
        <input hidden type="file" aria-label="Open Figcraft file" ref={openInput} onChange={async event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (file) try {
            const result = await workspace.open(file);
            const value = readImportReport("file.open", file.name, result);
            if (value) setReport({ owner: result.tabId, value });
            setNotice(importNotice(file.name, result.repairs, true));
          }
          catch (error) { setNotice(error instanceof Error ? error.message : "File could not be opened"); }
        }} />
        {recovery.status === "stored" && <p role="status">Recovery saved on this device</p>}
        {recovery.status === "error" && <p role="alert">{recovery.message}</p>}
      </section>}
    {enabled && online && publishTab && <PublishOnlineDialog online={online} tab={publishTab} close={() => setPublishTab(undefined)}
      published={name => { setPublishTab(undefined); setNotice("Published " + name); }} />}
    {enabled && report && tabs.some(tab => tab.id === report.owner) && <ImportReportPanel report={report.value} close={() => setReport(undefined)} />}
    {enabled && reviewId && <BranchReviewDialog workspace={workspace} id={reviewId} close={() => setReviewId(undefined)} />}
    {authorised && notice && <p role="alert">{notice}</p>}
    {closeId !== undefined && <dialog ref={closeDialog} aria-label="Close unsaved file" onCancel={() => setCloseId(undefined)}>
      <p>Discard unsaved changes to {tabs.find(tab => tab.id === closeId)?.name}?</p>
      <button autoFocus onClick={() => setCloseId(undefined)}>Cancel</button>
      <button disabled={!enabled} onClick={() => close(closeId, true)}>Discard changes</button>
    </dialog>}
    {renaming && active && <dialog ref={renameDialog} aria-label="Rename file" onCancel={() => setRenaming(false)}>
      <form onSubmit={event => {
        event.preventDefault();
        if (enabled) workspace.activeEngine?.execute("file.rename", { name: new FormData(event.currentTarget).get("name") });
        setRenaming(false);
      }}><label>File name<input autoFocus name="name" defaultValue={active.name} /></label>
        <button type="button" onClick={() => setRenaming(false)}>Cancel</button><button disabled={!enabled}>Rename</button></form>
    </dialog>}
  </div>;
}
