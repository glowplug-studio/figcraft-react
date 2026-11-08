import { useMemo, useState } from "react";
import type { LayerNode } from "./engine/document";
import { parseCssColour } from "./engine/colour-css";
import { renderColour } from "./engine/colour";
import { paintColour } from "./engine/solid-paint";
import { bandCaps, capShape, defaultStroke, miterAngle, strokeCaps, strokeSideKeys, type StrokeProps } from "./engine/stroke";
import { sanitiseWidthProfile, widthPresetIds, widthPresetLabels, widthProfileMaxScale, widthProfilePoints, widthProfilePreset, widthProfileSidesAt, type WidthProfile } from "./engine/width-profile";
import { brushPreset, brushPresets, defaultBrush, type Brush } from "./engine/brush";
import { brushOutline } from "./engine/brush-geometry";

interface Props { nodes: readonly LayerNode[]; editable: boolean; dispatch: (command: string, params?: unknown) => void }
const capLabels = ["None", "Round", "Square", "Line arrow", "Triangle arrow", "Reversed triangle", "Circle", "Diamond"];
function common<T>(values: readonly T[]): T | undefined { return values.length && values.every(v => JSON.stringify(v) === JSON.stringify(values[0])) ? values[0] : undefined; }
function ProfileArt({ profile }: { profile?: WidthProfile }) {
  const clean = profile && sanitiseWidthProfile(profile), maximum = Math.max(1e-6, clean ? widthProfileMaxScale(clean) : 1);
  const samples = Array.from({ length: 41 }, (_, i) => {
    const [left, right] = clean ? widthProfileSidesAt(clean, i / 40) : [.5, .5];
    return { x: 2 + i * 2, top: 12 - Math.max(.5, left / maximum * 10), bottom: 12 + Math.max(.5, right / maximum * 10) };
  });
  const points = [...samples.map(p => `${p.x},${p.top}`), ...[...samples].reverse().map(p => `${p.x},${p.bottom}`)].join(" ");
  return <svg width="84" height="24" viewBox="0 0 84 24" aria-hidden="true"><polygon points={points} fill="currentColor" /></svg>;
}
function BrushArt({ preset }: { preset: string }) {
  const path = useMemo(() => brushOutline([["M", 0, 0], ["L", 84, 0]], 10, defaultStroke, { ...defaultBrush, preset })?.map(c => c.join(" ")).join(" ") ?? "", [preset]);
  return <svg width="84" height="24" viewBox="0 -6 84 12" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth=".4" /></svg>;
}
function StrokeControls({ nodes, editable, dispatch }: Props) {
  const [custom, setCustom] = useState(false), [error, setError] = useState("");
  if (!nodes.length) return null;
  const ids = nodes.map(n => n.id), props = nodes.map(n => n.stroke ?? defaultStroke), stack = common(nodes.map(n => n.strokes ?? []));
  const current = common(props), pattern = current?.dashes.length ? current.dashes : undefined;
  const customStyle = Boolean(pattern && (pattern.length > 2 || custom)), pair = pattern ? [pattern[0], pattern[1] ?? pattern[0]] : Array(2).fill(4 * Math.max(1, current?.weight ?? 1));
  const set = (values: Record<string, unknown>) => { setError(""); dispatch("node.set", { ids, props: values }); };
  const value = <K extends keyof StrokeProps>(key: K): StrokeProps[K] | undefined => common(props.map(p => p[key]));
  const field = (label: string, key: string, shown: number | undefined, min = 0, max?: number) => <form key={`${key}:${shown}`} onSubmit={event => {
    event.preventDefault(); const input = event.currentTarget.elements.namedItem(key) as HTMLInputElement;
    if (input.value !== "" && Number.isFinite(Number(input.value))) set({ [key]: Number(input.value) });
  }}><label>{label}<input name={key} type="number" min={min} max={max} step="any" defaultValue={shown ?? ""} placeholder={shown === undefined ? "Mixed" : undefined} /></label><button type="submit">Apply {label.toLowerCase()}</button></form>;
  const select = (label: string, key: string, shown: string | undefined, options: readonly string[], labels = options) => <label>{label}<select aria-label={label} value={shown ?? ""} onChange={event => set({ [key]: event.currentTarget.value })}>
    {shown === undefined && <option value="" disabled>Mixed</option>}{options.map((option, i) => <option key={option} value={option}>{labels[i]}</option>)}
  </select></label>;
  const dashCaps = current ? bandCaps(current).map(capShape) : undefined;
  const sides = value("sides");
  const profile = current?.widthProfile?.points.length ? current.widthProfile : undefined;
  const preset = current ? profile ? widthProfilePreset(profile) ?? "custom" : "uniform" : "mixed";
  const brush = current?.brush, brushId = current ? brush && brushPreset(brush.preset) ? brush.preset : "none" : "mixed";
  const brushField = (label: string, key: keyof Pick<Brush, "spacing" | "scatter" | "sizeJitter" | "rotationJitter">, min: number, max: number, factor = 1) => brush && <form key={`${key}:${brush[key]}`} onSubmit={event => {
    event.preventDefault(); const input = event.currentTarget.elements.namedItem(key) as HTMLInputElement;
    if (input.value !== "" && Number.isFinite(Number(input.value))) set({ brush: { ...brush, [key]: Number(input.value) / factor } });
  }}><label>{label}<input name={key} type="number" required min={min} max={max} step="any" defaultValue={brush[key] * factor} /></label><button type="submit">Apply {label.toLowerCase()}</button></form>;
  return <fieldset className="figcraft-stroke" disabled={!editable} aria-label="Stroke"><legend>Stroke</legend>
    {error && <p role="alert">{error}</p>}
    {stack === undefined ? <p>Mixed strokes</p> : <ol>{[...stack].map((paint, index) => ({ paint, index })).reverse().map(({ paint, index }, row) => <li key={`${index}:${JSON.stringify(paint)}`}>
      <form onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget), colour = String(data.get("colour")), opacity = Number(data.get("opacity"));
        const update: Record<string, unknown> = { ids, index };
        if (paint.type === "solid" && colour !== renderColour(paintColour(paint))) { if (!parseCssColour(colour)) { setError("Enter a valid CSS colour."); return; } update.color = colour; }
        if (opacity !== paint.opacity) update.opacity = opacity;
        if (Object.keys(update).length > 2) { setError(""); dispatch("stroke.set", update); }
      }}>
        {paint.type === "solid" && <label>Stroke {row + 1} CSS colour<input name="colour" type="text" required defaultValue={renderColour(paintColour(paint))} /></label>}
        <label>Stroke {row + 1} opacity<input name="opacity" type="number" min="0" max="1" step="any" required defaultValue={paint.opacity} /></label>
        <label>Stroke {row + 1} visible<input type="checkbox" checked={paint.visible} onChange={event => dispatch("stroke.set", { ids, index, visible: event.currentTarget.checked })} /></label>
        <button type="submit">Apply stroke {row + 1}</button>
        <button type="button" onClick={() => dispatch("stroke.remove", { ids, index })}>Remove stroke {row + 1}</button>
        <button type="button" disabled={index === stack.length - 1} onClick={() => dispatch("stroke.move", { ids, from: index, to: index + 1 })}>Move stroke {row + 1} up</button>
        <button type="button" disabled={index === 0} onClick={() => dispatch("stroke.move", { ids, from: index, to: index - 1 })}>Move stroke {row + 1} down</button>
      </form>
    </li>)}</ol>}
    <button type="button" onClick={() => dispatch("stroke.add", { ids })}>Add stroke</button>
    {stack && stack.length > 0 && <>
      {field("Stroke weight", "strokeWeight", value("weight"))}
      {select("Stroke alignment", "strokeAlign", value("align"), ["inside", "center", "outside"], ["Inside", "Centre", "Outside"])}
      {nodes.every(n => n.kind === "rectangle" || n.kind === "frame") && <label>Individual strokes<select aria-label="Individual strokes" value="" onChange={event => {
        const choice = event.currentTarget.value, weight = value("weight") ?? 1;
        set({ strokeSides: choice === "all" ? null : [0, 1, 2, 3].map(i => choice === "custom" || i === Number(choice) ? weight : 0) });
      }}><option value="" disabled>Choose sides</option><option value="all">All</option><option value="0">Top</option><option value="1">Right</option><option value="2">Bottom</option><option value="3">Left</option><option value="custom">Custom</option></select></label>}
      {sides && strokeSideKeys.map((key, i) => field(`${["Top", "Right", "Bottom", "Left"][i]} stroke weight`, key, sides[i]))}
      <details><summary>Advanced stroke</summary>
        <label>Width profile<select aria-label="Width profile" value={preset} onChange={event => dispatch("stroke.widthProfile", { ids, preset: event.currentTarget.value })}>
          {preset === "mixed" && <option value="mixed" disabled>Mixed</option>}
          {preset === "custom" && <option value="custom" disabled>Custom</option>}
          {widthPresetIds.map((id, i) => <option key={id} value={id}>{widthPresetLabels[i]}</option>)}
        </select></label>
        {current && <ProfileArt profile={profile} />}
        <button type="button" onClick={() => {
          if (profile) dispatch("stroke.widthProfile", { ids, points: widthProfilePoints({ points: [...profile.points].reverse().map(p => ({ ...p, t: 1 - p.t })) }) });
        }}>Flip width profile</button>
        <label>Brush<select aria-label="Brush" value={brushId} onChange={event => dispatch("stroke.brush", { ids, preset: event.currentTarget.value === "none" ? null : event.currentTarget.value })}>
          {brushId === "mixed" && <option value="mixed" disabled>Mixed</option>}<option value="none">None</option>
          {brushPresets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select></label>
        {brush && <BrushArt preset={brush.preset} />}
        {brush && brushPreset(brush.preset)?.kind === "scatter" && <>
          {brushField("Brush spacing", "spacing", .1, 100)}{brushField("Brush scatter", "scatter", 0, 4)}
          {brushField("Brush size jitter (%)", "sizeJitter", 0, 100, 100)}{brushField("Brush rotation jitter (%)", "rotationJitter", 0, 100, 100)}
        </>}
        <label>Stroke style<select aria-label="Stroke style" value={!pattern ? "solid" : customStyle ? "custom" : "dash"} onChange={event => {
          const style = event.currentTarget.value;
          if (style === "solid") set({ dashes: [] });
          else { setCustom(style === "custom"); if (style === "dash" || !pattern) set({ dashes: pair }); }
        }}><option value="solid">Solid</option><option value="dash">Dash</option><option value="custom">Custom</option></select></label>
        {pattern && (customStyle ? <form key={`custom:${pattern.join()}`} onSubmit={event => {
          event.preventDefault(); const text = String(new FormData(event.currentTarget).get("dashes")), pieces = text.split(",").map(s => s.trim()).filter(Boolean);
          if (!pieces.length || pieces.some(s => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) || !Number.isFinite(Number(s)) || Number(s) < 0)) { setError("Dashes take non-negative numbers separated by commas."); return; }
          setCustom(true); set({ dashes: pieces.map(Number) });
        }}><label>Dashes<input name="dashes" defaultValue={pattern.join(", ")} required /></label><button type="submit">Apply dashes</button></form>
          : <form key={`pair:${pattern.join()}`} onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget), dashes = pattern.length % 2 ? [...pattern, ...pattern] : [...pattern];
            dashes[0] = Number(data.get("dash")); dashes[1] = Number(data.get("gap")); set({ dashes });
          }}><label>Dash<input name="dash" type="number" min="0" step="any" required defaultValue={pair[0]} /></label><label>Gap<input name="gap" type="number" min="0" step="any" required defaultValue={pair[1]} /></label><button type="submit">Apply dash and gap</button></form>)}
        {pattern && select("Dash cap", "dashCap", dashCaps && dashCaps[0] === dashCaps[1] ? dashCaps[0] : undefined, strokeCaps.slice(0, 3), capLabels.slice(0, 3))}
        {select("Stroke join", "strokeJoin", current?.join, ["miter", "bevel", "round"], ["Miter", "Bevel", "Round"])}
        {current?.join === "miter" && field("Miter angle", "miterAngle", Math.round(miterAngle(current.miterLimit) * 100) / 100, 1, 180)}
        {nodes.every(n => n.kind === "line" || n.kind === "vector") && <>{select("Start cap", "startCap", current?.capStart, strokeCaps, capLabels)}{select("End cap", "endCap", current?.capEnd, strokeCaps, capLabels)}</>}
      </details>
    </>}
  </fieldset>;
}
export function StrokePanel(props: Props) { return <StrokeControls key={props.nodes.map(n => n.id).join(",")} {...props} />; }
