import { useState } from "react";
import type { EditorEngine } from "./engine/editor";
import type { FileVersion } from "./engine/file-versions";
import type { EditorWorkspace } from "./engine/workspace";

export function VersionPanel({ engine, workspace, initialForm, onReviewBranch }: {
  engine: EditorEngine; workspace?: EditorWorkspace; initialForm?: "new" | "branch"; onReviewBranch?: (id: string) => void;
}) {
  const [form, setForm] = useState<"new" | FileVersion | undefined>(initialForm === "new" ? "new" : undefined);
  const [branchForm, setBranchForm] = useState(initialForm === "branch");
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = engine.getSnapshot().previewVersionId;
  const versions = [...engine.versions].reverse();
  const groups: FileVersion[][] = [];
  for (const version of versions) {
    const previous = groups.at(-1);
    if (version.auto && previous?.[0].auto) previous.push(version);
    else groups.push([version]);
  }
  async function action(command: string, params: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try {
      if (command === "branch.create" || command === "branch.open" || command === "branch.archive") {
        workspace!.execute(command, params); setBranchForm(false);
      } else if (command === "version.duplicate") await workspace!.duplicateVersion(params);
      else await engine.executeAsync(command, params);
      setForm(undefined); setDeleting(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Version command failed"); }
    finally { setBusy(false); }
  }
  const row = (version: FileVersion) => {
    const date = new Date(Number(version.time) * 1000);
    return <li key={version.id} aria-label={version.name}>
      <button type="button" aria-pressed={preview === version.id} onClick={() => void action("version.preview", { id: version.id })}>{version.name}</button>
      {Number.isFinite(date.getTime()) && <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>}
      {version.description && <p>{version.description}</p>}
      <div>
        <button type="button" onClick={() => void action("version.restore", { id: version.id })}>Restore</button>
        {workspace && <button type="button" onClick={() => void action("version.duplicate", { id: version.id })}>Duplicate</button>}
        <button type="button" onClick={() => { setForm(version); setDeleting(undefined); }}>Rename</button>
        {deleting === version.id ? <>
          <button type="button" onClick={() => setDeleting(undefined)}>Cancel</button>
          <button type="button" onClick={() => void action("version.delete", { id: version.id })}>Confirm delete</button>
        </> : <button type="button" onClick={() => { setDeleting(version.id); setForm(undefined); }}>Delete</button>}
      </div>
    </li>;
  };
  return <aside aria-label="Version history" className="figcraft-version-panel">
    <h2>Version history</h2>
    <button type="button" onClick={() => { engine.exitVersionPreview(); engine.closeVersionPanel(); }}>Close version history</button>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy}>
      <button type="button" aria-pressed={!preview} onClick={() => void action("version.exitPreview")}>Current version</button>
      <button type="button" onClick={() => { setForm("new"); setDeleting(undefined); }}>Save a version</button>
      {form && <form key={form === "new" ? form : form.id} onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void action(form === "new" ? "file.saveVersion" : "version.rename", {
          ...(form !== "new" && { id: form.id }), name: fields.get("name"), description: fields.get("description"),
        });
      }}>
        <label>Version name<input autoFocus name="name" defaultValue={form === "new" ? "" : form.name} /></label>
        <label>Description<textarea name="description" defaultValue={form === "new" ? "" : form.description} /></label>
        <button type="submit">Save version</button><button type="button" onClick={() => setForm(undefined)}>Cancel</button>
      </form>}
      {groups.length ? <ol>{groups.map(group => group.length === 1 ? row(group[0]) :
        <li key={group[0].id}><details open={group.some(v => v.id === preview) || undefined}>
          <summary>{group.length} autosaves</summary><ol>{group.map(row)}</ol>
        </details></li>)}</ol> : <p>No saved versions yet.</p>}
      {workspace && <section aria-label="Branches">
        <h3>Branches</h3>
        {!workspace.onBranch && <button type="button" onClick={() => setBranchForm(true)}>Create branch</button>}
        {branchForm && <form onSubmit={event => {
          event.preventDefault();
          void action("branch.create", { name: new FormData(event.currentTarget).get("name") });
        }}>
          <label>Branch name<input autoFocus name="name" /></label>
          <button type="submit">Create</button><button type="button" onClick={() => setBranchForm(false)}>Cancel</button>
        </form>}
        {workspace.fileBranches.length ? <ul>{workspace.fileBranches.map(branch => <li key={branch.id} aria-label={branch.name}>
          <button type="button" onClick={() => void action("branch.open", { id: branch.id })}>{branch.name}</button>
          <span>{branch.state}</span>
          <button type="button" aria-label={"Review branch " + branch.name} onClick={() => onReviewBranch?.(branch.id)}>Review</button>
          {branch.state === "active" && <button type="button" onClick={() => void action("branch.archive", { id: branch.id })}>Archive</button>}
        </li>)}</ul> : <p>No branches.</p>}
      </section>}
    </fieldset>
  </aside>;
}
