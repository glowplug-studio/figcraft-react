import { useState, type FormEvent } from "react";
import { parseCssColour } from "./engine/colour-css";
import { fromRgba8, renderColour, withAlpha } from "./engine/colour";
import { pageColour, rectanglePaints, type PageNode, type LayerNode } from "./engine/document";
import { paintColour, solidPaint, type SolidPaint } from "./engine/solid-paint";

interface AppearancePanelProps {
  page: PageNode;
  selected?: LayerNode;
  editable: boolean;
  dispatch: (command: string, params?: unknown) => void;
}

function AppearanceControls({ page, selected, editable, dispatch }: AppearancePanelProps) {
  const [alert, setAlert] = useState("");
  const paints = selected ? rectanglePaints(selected) : [];
  const updatePaints = (next: readonly SolidPaint[]) => dispatch("node.set", { id: selected?.id, props: { fills: next } });
  const updatePaint = (index: number, next: SolidPaint) => updatePaints(paints.map((paint, current) => current === index ? next : paint));
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
      {selected.kind === "rectangle" && <fieldset disabled={!editable}><legend>Fills</legend>
        <ol>{paints.map((paint, index) => ({ paint, index })).reverse().map(({ paint, index }, row) => <li key={`${selected.id}:${index}`}>
          <form key={`paint:${selected.id}:${index}:${JSON.stringify(paint)}`} onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const css = (form.elements.namedItem("colour") as HTMLInputElement).value;
            const opacity = Number((form.elements.namedItem("paintOpacity") as HTMLInputElement).value);
            let next = paint;
            if (css !== renderColour(paintColour(paint))) {
              const value = parseInput(css);
              if (!value) return;
              next = value.a === paintColour(paint).a
                ? { ...paint, color: withAlpha(value, paint.color.a) }
                : { ...solidPaint(value), visible: paint.visible, blend: paint.blend };
            }
            if (opacity !== paint.opacity) next = { ...next, opacity, colorAlpha: 1 };
            if (next !== paint) updatePaint(index, next);
          }}>
            <label>Fill {row + 1} CSS colour<input name="colour" type="text" defaultValue={renderColour(paintColour(paint))} required /></label>
            <label>Fill {row + 1} opacity<input name="paintOpacity" type="number" min="0" max="1" step="any" defaultValue={paint.opacity} required /></label>
            <label>Fill {row + 1} visible<input type="checkbox" checked={paint.visible} onChange={event => updatePaint(index, { ...paint, visible: event.currentTarget.checked })} /></label>
            <button type="submit">Apply fill {row + 1}</button>
            <button type="button" onClick={() => updatePaints(paints.filter((_, current) => current !== index))}>Remove fill {row + 1}</button>
            <button type="button" disabled={index === paints.length - 1} onClick={() => { const next = [...paints]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; updatePaints(next); }}>Move fill {row + 1} up</button>
            <button type="button" disabled={index === 0} onClick={() => { const next = [...paints]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; updatePaints(next); }}>Move fill {row + 1} down</button>
          </form>
        </li>)}</ol>
        <button type="button" onClick={() => updatePaints([...paints, solidPaint(fromRgba8(128, 128, 128))])}>Add fill</button>
      </fieldset>}
    </>}
  </section>;
}

export function AppearancePanel(props: AppearancePanelProps) {
  return <AppearanceControls key={`${props.page.id}:${props.selected?.id ?? "none"}`} {...props} />;
}
