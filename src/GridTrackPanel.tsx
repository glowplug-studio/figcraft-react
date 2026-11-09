import { LayoutNumber, type LayoutFieldHost } from "./LayoutNumber";
import { useMemo } from "react";
import { gridGeometry } from "./engine/grid-layout";
import type { Document, FrameNode } from "./engine/document";

export function GridTrackPanel({document, frame, enabled, ...host}: LayoutFieldHost & {
  document: Document; frame: FrameNode; enabled: boolean;
}) {
  const {dispatch} = host;
  const geometry = useMemo(() => gridGeometry(document, frame), [document, frame]);
  return <section aria-label="Grid tracks"><fieldset disabled={!enabled}><legend>Grid tracks</legend>
    {(["columns", "rows"] as const).map(axis => {
      const columns = axis === "columns", word = columns ? "Column" : "Row";
      const tracks = columns ? frame.layout!.columnTracks : frame.layout!.rowTracks;
      return <fieldset key={axis}><legend>{word} sizes</legend>
        {geometry[axis].slice(0, 24).map(([start, end], index) => {
          const track = tracks[index] ?? {sizing: "fill", value: 1};
          const fill = track.sizing === "fill";
          const value = fill ? track.value : Math.round((end-start)*100)/100;
          const label = `${word} ${index+1}`;
          const set = (sizing: string, value?: number) => dispatch("layout.setTrack", {ids: [frame.id], axis, index, sizing, value});
          return <div key={index}><LayoutNumber {...host} key={frame.id+"/"+track.sizing} label={label+" size"}
            value={value} step={fill ? .1 : 1} min={0} suffix={fill ? "fr" : "px"} command="layout.setTrack"
            params={n => ({ids:[frame.id],axis,index,sizing:fill ? "fill" : "fixed",value:n})}/>
            <select aria-label={`${label} sizing`} value={track.sizing} onChange={e => set(e.target.value)}>
              <option value="fixed">Fixed</option><option value="hug">Hug</option><option value="fill">Fill</option>
            </select></div>;
        })}
      </fieldset>;
    })}
  </fieldset></section>;
}
