import type { FormEvent } from "react";
import { arrangeSpecs, canAlign } from "./engine/arrange";
import type { Document, NodeId } from "./engine/document";

const alignments = ["align.left", "align.hcenter", "align.right", "align.top", "align.vcenter", "align.bottom"] as const;
const stacking = ["arrange.front", "arrange.forward", "arrange.backward", "arrange.back"] as const;

export function ArrangePanel({ document, selection, editable, dispatch }: {
  document: Document; selection: readonly NodeId[]; editable: boolean; dispatch: (command: string, params?: unknown) => void;
}) {
  const enabled = editable && selection.length > 0, align = enabled && canAlign(document, selection);
  function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const absolute = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "absolute";
    dispatch(absolute ? "transform.moveTo" : "transform.move", absolute ? { x: data.get("x"), y: data.get("y") } : { dx: data.get("x"), dy: data.get("y") });
  }
  return <details className="figcraft-arrange"><summary>Arrange</summary>
    <div role="group" aria-label="Alignment">{alignments.map(command => <button key={command} disabled={!align} onClick={() => dispatch(command)}>{arrangeSpecs[command].label}</button>)}</div>
    <div role="group" aria-label="Stacking order">{stacking.map(command => <button key={command} disabled={!enabled} onClick={() => dispatch(command)}>{arrangeSpecs[command].label}</button>)}</div>
    <form onSubmit={move}><fieldset disabled={!enabled}><legend>Move selection</legend>
      <label>Move X<input name="x" type="number" step="any" defaultValue="0" required /></label>
      <label>Move Y<input name="y" type="number" step="any" defaultValue="0" required /></label>
      <button type="submit" value="relative">Move by</button><button type="submit" value="absolute">Move to</button>
    </fieldset></form>
    <form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget), value = data.get("spacing");
      const command = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
      if (command) dispatch(command, value === "" || command.startsWith("arrange.pack") ? {} : { spacing: value });
    }}><fieldset disabled={!enabled || selection.length < 2}><legend>Spacing</legend>
      <label>Gap<input name="spacing" type="number" step="any" placeholder="Automatic" /></label>
      <button type="submit" value="distribute.horizontal">Distribute horizontally</button>
      <button type="submit" value="distribute.vertical">Distribute vertically</button>
      <button type="submit" value="arrange.packH">Pack horizontally</button>
      <button type="submit" value="arrange.packV">Pack vertically</button>
      <button type="submit" value="arrange.tidy">Tidy up</button>
    </fieldset></form>
  </details>;
}
