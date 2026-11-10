import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { renderAssetThumbnail } from "./engine/canvas";
import type { Document } from "./engine/document";
import type { BranchSide } from "./engine/branch-merge";
import { boundsOf } from "./engine/viewport";
import { worldRenderBounds } from "./engine/render-bounds";
import type { EditorWorkspace } from "./engine/workspace";

function topLayer(doc: Document, id?: string) {
  let node = id && doc.nodes[id];
  while (node && node.parent) {
    if (doc.nodes[node.parent]?.kind === "page") return node.id;
    node = doc.nodes[node.parent];
  }
}

type Review = ReturnType<typeof import("./engine/branch-review").branchReview>;

function Shot({ doc, frame, changes, conflicts, label }: {
  doc: Document; frame: string; changes: Review["branch"]["layers"]; conflicts: readonly string[]; label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController(), target = canvas.current!;
    setFailed(false);
    void (async () => {
      await renderAssetThumbnail(target, doc, frame, 1400, abort.signal);
      const ctx = target.getContext("2d"), area = worldRenderBounds(doc, frame);
      if (abort.signal.aborted || !ctx || !area || !area.width) return;
      const scale = target.width / area.width;
      const outlined = new Set(conflicts);
      for (const change of changes) {
        const id = String(change.id), box = boundsOf(doc, [id]);
        if (!box || topLayer(doc, id) !== frame) continue;
        ctx.strokeStyle = outlined.has(id) ? "#c04436" : change.change === "added" ? "#247749" : "#436dae";
        ctx.lineWidth = 2;
        ctx.strokeRect((box.x - area.x) * scale, (box.y - area.y) * scale, box.width * scale, box.height * scale);
      }
    })().catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [doc, frame, changes, conflicts]);
  return <figure><figcaption>{label}</figcaption>{failed && <p role="alert">Unable to render this frame.</p>}
    <canvas ref={canvas} aria-label={label + " frame preview"} /></figure>;
}

export function BranchReviewDialog({ workspace, id, close }: { workspace: EditorWorkspace; id: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const main = workspace.branchOwner ?? workspace.activeEngine!;
  const snapshot = useSyncExternalStore(main.subscribe, main.getSnapshot, main.getSnapshot);
  const record = main.branches.find(b => b.id === id);
  const review = useMemo(() => record && workspace.execute("branch.review", { id }), [workspace, id, record, snapshot.document]);
  const [picks, setPicks] = useState<Record<string, BranchSide>>({});
  const [selected, setSelected] = useState<string>(), [overlay, setOverlay] = useState(false), [split, setSplit] = useState(50);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const conflictIds = useMemo(() => review?.conflicts.flatMap(c => "id" in c && c.id !== undefined ? [String(c.id)] : []) ?? [], [review]);
  if (!record || !review) return null;
  const current = main.archiveRevision.document, head = record.head.document;
  const target = selected ?? conflictIds[0] ?? String(review.branch.layers[0]?.id ?? review.main.layers[0]?.id ?? "");
  const frame = topLayer(current, target) ?? topLayer(head, target);
  const left = review.conflicts.filter(c => !picks[c.key]).length;
  const active = record.state === "active";
  const apply = (command: "branch.merge" | "branch.updateFromMain") => {
    try { workspace.execute(command, { id, resolutions: picks }); setPicks({}); setError(""); if (command === "branch.merge") close(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to apply branch changes"); }
  };
  return <dialog ref={dialog} aria-label="Review and merge" className="figcraft-branch-review" onCancel={close}>
    <header><h2>Review and merge</h2><strong>{record.name}</strong></header>
    <div className="figcraft-branch-body"><section aria-label="Design comparison">
      <div><button aria-pressed={!overlay} onClick={() => setOverlay(false)}>Side by side</button>
        <button aria-pressed={overlay} onClick={() => setOverlay(true)}>Overlay</button></div>
      {frame && current.nodes[frame] && head.nodes[frame] ? <>
        <div className={overlay ? "figcraft-branch-overlay" : "figcraft-branch-pair"}>
          <Shot doc={current} frame={frame} changes={review.main.layers} conflicts={conflictIds} label="Main" />
          <div style={overlay ? { clipPath: "inset(0 0 0 " + split + "%)" } : undefined}>
            <Shot doc={head} frame={frame} changes={review.branch.layers} conflicts={conflictIds} label="Branch" />
          </div>
        </div>{overlay && <label>Comparison split<input type="range" value={split} onChange={e => setSplit(Number(e.target.value))} /></label>}
      </> : <p>{!frame ? "No layer changes to show." : !current.nodes[frame] ? "This frame is new on the branch." : "This frame isn't on the branch."}</p>}
    </section><section aria-label="Changes and conflicts">
      {!!review.conflicts.length && <><h3>Conflicts</h3>{review.conflicts.map(c => <fieldset key={c.key}>
        <legend>{c.name} · {c.property}</legend>
        {(["branch", "main"] as const).map(side => <label key={side}>
          <input type="radio" name={c.key} checked={picks[c.key] === side} onChange={() => {
            setPicks({ ...picks, [c.key]: side }); if ("id" in c) setSelected(String(c.id));
          }} />{side === "branch" ? "Branch" : "Main"} · {c[side]}
        </label>)}</fieldset>)}</>}
      {(["branch", "main"] as const).map(side => <section key={side}>
        <h3>{side === "main" ? "Changes on main" : "Changes on the branch"}</h3>
        {review[side].document.map((entry, i) => <p key={i}>{entry.change} · {entry.what}</p>)}
        {review[side].layers.map(layer => <div key={layer.id}>
          <button type="button" onClick={() => setSelected(String(layer.id))}>{layer.change} · {layer.name}</button>
          {layer.properties?.map((p, i) => <p key={i}>{p.text}</p>)}
        </div>)}{!review[side].layers.length && !review[side].document.length && <p>None.</p>}
        {review[side].truncated && <p>More changes omitted.</p>}</section>)}
    </section></div>
    {error && <p role="alert">{error}</p>}
    <footer><span role="status">{!active ? "This branch was merged or archived." : left ? left + " unresolved" : review.conflicts.length ? "Every conflict has a choice." : "No conflicts."}</span>
      <button onClick={close}>Close</button>
      <button disabled={!active || !!left || !review.main.layers.length && !review.main.document.length} onClick={() => apply("branch.updateFromMain")}>Update from main</button>
      <button disabled={!active || !!left} onClick={() => apply("branch.merge")}>Merge into main</button>
    </footer>
  </dialog>;
}
