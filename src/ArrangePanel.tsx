import type { FormEvent } from "react";
import { alignBlockedByAutoLayout, arrangeSpecs, canAlign } from "./engine/arrange";
import type { Document, NodeId } from "./engine/document";
import { canTidy } from "./engine/tidy";

const alignments = ["align.left", "align.hcenter", "align.right", "align.top", "align.vcenter", "align.bottom"] as const;
const stacking = ["arrange.front", "arrange.forward", "arrange.backward", "arrange.back"] as const;

export function ArrangePanel({ document, selection, editable, dispatch }: {
  document: Document; selection: readonly NodeId[]; editable: boolean; dispatch: (command: string, params?: unknown) => void;
}) {
  const enabled = editable && selection.length > 0, align = enabled && canAlign(document, selection);
  // Native right.rs: the disabled Align buttons say why when the one layer is placed by its auto layout frame.
  const alignTip = enabled && !align && alignBlockedByAutoLayout(document, selection) ? "A layer in an auto layout frame is placed by its frame" : undefined;
  // Offered for three or more layers that form a row, a column or a grid, none in an auto layout flow.
  const tidy = enabled && canTidy(document, selection);
  function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const absolute = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "absolute";
    dispatch(absolute ? "transform.moveTo" : "transform.move", absolute ? { x: data.get("x"), y: data.get("y") } : { dx: data.get("x"), dy: data.get("y") });
  }
  return <details className="figcraft-arrange"><summary>Arrange</summary>
    <div role="group" aria-label="Alignment" title={alignTip}>{alignments.map(command => <button key={command} disabled={!align} title={alignTip} onClick={() => dispatch(command)}>{arrangeSpecs[command].label}</button>)}</div>
    {alignTip && <small>{alignTip}</small>}
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
      <button type="submit" value="arrange.tidy" disabled={!tidy}>Tidy up</button>
    </fieldset></form>
  </details>;
}
