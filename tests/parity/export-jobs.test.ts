import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { layerExportJobs } from "../../src/engine/export-jobs";
import cases from "../fixtures/native-export-jobs.json";

it.each(cases)("matches upstream layer export jobs for $name", entry => {
  const engine = new EditorEngine();
  for (const [command, params] of entry.commands.slice(0,-1)) engine.execute(String(command),params);
  const {document,selection} = engine.getSnapshot();
  const run = () => layerExportJobs(document,selection,entry.commands.at(-1)![1] as Record<string,unknown>);
  if (entry.error) return expect(run().jobs).toEqual([]);
  const {jobs,skipped} = run();
  expect(skipped).toBe(entry.skipped);
  expect(jobs.map(({id,name}) => ({id:Number(id),name}))).toEqual(entry.files);
});

it("caps the batch at 1,000 files and resolves case-insensitive collisions", () => {
  const engine = new EditorEngine();
  engine.execute("shape.rectangle",{name:"/../."});
  const settings = Array.from({length:1001},()=>({}));
  engine.execute("node.set",{props:{exports:settings}});
  const {document,selection} = engine.getSnapshot();
  const {jobs} = layerExportJobs(document,selection,{});
  expect(jobs).toHaveLength(1000);
  expect(jobs[0].name).toBe("Untitled.png");
  expect(jobs.at(-1)?.name).toBe("Untitled 1000.png");
});
