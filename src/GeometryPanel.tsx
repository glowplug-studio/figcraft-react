import { isFrameLike, defaultConstraints, type Document, type LayerNode, type NodeId } from "./engine/document";
import {shownGeometry} from "./engine/geometry-fields";
import {LayoutNumber, type LayoutFieldHost} from "./LayoutNumber";

export function GeometryPanel({document, selection, enabled, ...host}: LayoutFieldHost & {
  document: Document; selection: readonly NodeId[]; enabled: boolean;
}) {
  const layers = selection.map(id => document.nodes[id]).filter((n): n is LayerNode => n && n.kind !== "page");
  if (!layers.length) return null;
  const labels = {x:"Edit X", y:"Edit Y", width:"Edit Width", height:"Edit Height", rotation:"Rotation"};
  const props = (properties: Record<string,unknown>) => host.dispatch("node.set",{ids:selection,props:properties});
  const canConstrain = layers.every(layer => {
    const parent = document.nodes[layer.parent];
    return isFrameLike(parent) && (!parent.layout || layer.childLayout?.absolute);
  });
  const firstConstraints = layers[0].constraints ?? defaultConstraints;
  const commonConstraints = canConstrain && layers.every(layer => {
    const c = layer.constraints ?? defaultConstraints;
    return c.horizontal === firstConstraints.horizontal && c.vertical === firstConstraints.vertical;
  });
  return <><form onSubmit={event => {
    event.preventDefault();
    const field = event.currentTarget.ownerDocument.activeElement;
    if (field instanceof HTMLInputElement && event.currentTarget.contains(field)) field.blur();
  }}><fieldset disabled={!enabled}><legend>Geometry</legend>
    {(["x","y","width","height","rotation"] as const).map(key => {
      const first = shownGeometry(document,layers[0],key);
      const value = layers.every(layer => shownGeometry(document,layer,key) === first) ? first : undefined;
      return <LayoutNumber {...host} key={key} variableField={key==="width" || key==="height" ? key : undefined} label={labels[key]} value={value} placeholder="Mixed"
        min={key === "width" || key === "height" ? 0 : undefined} suffix={key === "rotation" ? "°" : undefined}
        params={n => ({ids:selection,props:{[key]:n}})} onMixedRelative={edit => {
          try { host.onError(host.engine.editMixedGeometry(key,edit).join("\n")); }
          catch (error) { host.onError(error instanceof Error ? error.message : "Could not edit the geometry"); }
        }}/>;
    })}
    <button type="submit">Apply geometry</button>
  </fieldset></form>
  <label><input type="checkbox" checked={layers.every(layer => layer.constrainProportions === true)} disabled={!enabled}
    onChange={e => props({constrainProportions:e.currentTarget.checked})}/>Constrain proportions</label>
  {layers.every(layer => isFrameLike(layer)) && <label><input type="checkbox" checked={layers.every(layer => layer.clip)} disabled={!enabled}
    onChange={e => props({clip:e.currentTarget.checked})}/>Clip content</label>}
  {canConstrain && <form onSubmit={event => {
    event.preventDefault();
    const constraints = Object.fromEntries([...new FormData(event.currentTarget)].filter(([,value]) => value !== ""));
    if (Object.keys(constraints).length) props({constraints});
  }}><fieldset disabled={!enabled}><legend>Constraints</legend>
    {(["horizontal","vertical"] as const).map(axis => {
      const options = axis === "horizontal" ? [["left","Left"],["right","Right"],["leftRight","Left and right"]]
        : [["top","Top"],["bottom","Bottom"],["topBottom","Top and bottom"]];
      const label = axis === "horizontal" ? "Horizontal constraint" : "Vertical constraint";
      return <label key={axis}>{label}<select aria-label={label} name={axis} value={commonConstraints ? firstConstraints[axis] : ""}
        onChange={e => props({constraints:{[axis]:e.currentTarget.value}})}>
        {!commonConstraints && <option value="" disabled>Mixed</option>}
        {[...options,["center","Centre"],["scale","Scale"]].map(([value,text]) => <option key={value} value={value}>{text}</option>)}
      </select></label>;
    })}
    <button type="submit">Apply constraints</button>
  </fieldset></form>}</>;
}
