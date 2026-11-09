import { PaintPicker } from "./PaintPicker";
import { usePaintActions } from "./PaintActions";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { parseCssColour } from "./engine/colour-css";
import { renderColour, withAlpha } from "./engine/colour";
import { pageColour, rectanglePaints, type PageNode, type LayerNode } from "./engine/document";
import { paintColour, samePaints, solidPaint, type Paint } from "./engine/solid-paint";

import type { EditorEngine } from "./engine/editor";
import { selectedRegionFills } from "./engine/fill-commands";

interface AppearancePanelProps {
  engine: EditorEngine;
  page: PageNode;
  selected?: LayerNode;
  editable: boolean;
  dispatch: (command: string, params?: unknown) => void;
}

function AppearanceControls({ engine, page, selected, editable, dispatch }: AppearancePanelProps) {
  const [alert, setAlert] = useState("");
  const state = useSyncExternalStore(engine.subscribeVectorEdit, engine.getVectorEdit, engine.getVectorEdit);
  const snapshot = engine.getSnapshot(), ids = snapshot.selection;
  const inherited = selected ? rectanglePaints(selected) : [];
  const regionPaints = selected && ids.length === 1 ? selectedRegionFills(selected, state) : undefined;
  const mixed = regionPaints === null || ids.length > 1 && ids.some(id => {
    const node = snapshot.document.nodes[id];
    return node.kind !== "page" && !samePaints(inherited, rectanglePaints(node));
  });
  const paints = mixed ? [] : regionPaints ?? inherited;
  const updatePaint = (index: number, paint: Paint) => dispatch("fill.set", { ids, index, paint });
  const {openMenu, popup} = usePaintActions("fill", editable, engine.hasCopiedFill(), ids, dispatch);
  const parseInput = (input: string) => {
    const value = parseCssColour(input);
    if (!value) setAlert("Enter a valid CSS colour.");
    else setAlert("");
    return value;
  };
  function background(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("background") as HTMLInputElement;
    if (input.value === renderColour(pageColour(page))) return;
    const value = parseInput(input.value);
    if (value) dispatch("page.setBackground", { id: page.id, color: value });
  }
  function details(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value;
    const opacity = Number((form.elements.namedItem("opacity") as HTMLInputElement).value);
    const props: Record<string, unknown> = {};
    if (name !== selected.name) props.name = name;
    if (opacity !== (selected.opacity ?? 1)) props.opacity = opacity;
    if (Object.keys(props).length) dispatch("node.set", { id: selected.id, props });
  }
  return <section aria-label="Appearance">
    <h3>Appearance</h3>
    {alert && <p role="alert">{alert}</p>}
    <form key={`background:${page.id}:${JSON.stringify(pageColour(page))}`} onSubmit={background}>
      <fieldset disabled={!editable}><legend>Page</legend>
        <label>Background CSS colour<input name="background" type="text" defaultValue={renderColour(pageColour(page))} required /></label>
        <button type="submit">Apply background</button>
      </fieldset>
    </form>
    {selected && <>
      <form key={`details:${selected.id}:${selected.name}:${selected.opacity ?? 1}`} onSubmit={details}>
        <fieldset disabled={!editable}><legend>Layer</legend>
          <label>Name<input name="name" type="text" defaultValue={selected.name} required /></label>
          <label>Node opacity<input name="opacity" type="number" min="0" max="1" step="any" defaultValue={selected.opacity ?? 1} required /></label>
          <label>Visible<input type="checkbox" checked={selected.visible !== false} onChange={event => dispatch("node.set", { id: selected.id, props: { visible: event.currentTarget.checked } })} /></label>
          <label>Locked<input type="checkbox" checked={selected.locked === true} onChange={event => dispatch("node.set", { id: selected.id, props: { locked: event.currentTarget.checked } })} /></label>
          <button type="submit">Apply layer</button>
        </fieldset>
      </form>
      {selected.kind !== "group" && <fieldset disabled={!editable}><legend tabIndex={0} onContextMenu={event => openMenu(event)} onKeyDown={event => openMenu(event)}>Fills</legend>
        {mixed && <p>Click + to replace mixed content</p>}
        <ol>{paints.map((paint, index) => ({ paint, index })).reverse().map(({ paint, index }, row) => <li key={`${selected.id}:${index}`} tabIndex={0} onContextMenu={event => openMenu(event, index)} onKeyDown={event => openMenu(event, index)}>
          <form key={`paint:${selected.id}:${index}:${JSON.stringify(paint)}`} onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const css = (form.elements.namedItem("colour") as HTMLInputElement | null)?.value;
            const opacity = Number((form.elements.namedItem("paintOpacity") as HTMLInputElement).value);
            let next = paint;
            if (paint.type === "solid" && css !== undefined && css !== renderColour(paintColour(paint))) {
              const value = parseInput(css);
              if (!value) return;
              next = value.a === paintColour(paint).a
                ? { ...paint, color: withAlpha(value, paint.color.a) }
                : { ...solidPaint(value), visible: paint.visible, blend: paint.blend };
            }
            if (opacity !== paint.opacity) next = { ...next, opacity, colorAlpha: 1 };
            if (next !== paint) updatePaint(index, next);
          }}>
            {paint.type === "solid" && <label>Fill {row + 1} CSS colour<input name="colour" type="text" defaultValue={renderColour(paintColour(paint))} required /></label>}
            <label>Fill {row + 1} opacity<input name="paintOpacity" type="number" min="0" max="1" step="any" defaultValue={paint.opacity} required /></label>
            <label>Fill {row + 1} visible<input type="checkbox" checked={paint.visible} onChange={event => updatePaint(index, { ...paint, visible: event.currentTarget.checked })} /></label>
            <button type="submit">Apply fill {row + 1}</button>
            <button type="button" onClick={() => dispatch("fill.remove", { ids, index })}>Remove fill {row + 1}</button>
            <button type="button" disabled={index === paints.length - 1} onClick={() => dispatch("fill.move", { ids, from: index, to: index + 1 })}>Move fill {row + 1} up</button>
            <button type="button" disabled={index === 0} onClick={() => dispatch("fill.move", { ids, from: index, to: index - 1 })}>Move fill {row + 1} down</button>
          </form>
          {ids.length===1 && regionPaints===undefined && paint.type==="image" && <button type="button" aria-label={`Crop fill ${row+1} image`} onClick={()=>dispatch("image.crop",{ids,index})}>Crop image</button>}
          <PaintPicker engine={engine} region={regionPaints !== undefined} list="fill" label={`fill ${row+1}`} index={index} paint={paint} change={next=>updatePaint(index,next)} />
        </li>)}</ol>
        <button type="button" onClick={() => dispatch("fill.add", { ids })} onContextMenu={event => openMenu(event)} onKeyDown={event => openMenu(event)}>Add fill</button>
        {popup}
      </fieldset>}
    </>}
  </section>;
}

export function AppearancePanel(props: AppearancePanelProps) {
  return <AppearanceControls key={`${props.page.id}:${props.selected?.id ?? "none"}`} {...props} />;
}
