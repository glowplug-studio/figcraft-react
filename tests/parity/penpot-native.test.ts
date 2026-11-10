import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { expect, it } from "vitest";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";

const corpus = unzipSync(readFileSync(new URL("../fixtures/native-penpot-files.zip", import.meta.url)));
const inputs = Object.keys(corpus).filter(name => name.endsWith(".figcraft"));

it.each(inputs)("preserves interchange metadata and guides from the native Penpot save %s", async name => {
  const opened = await decodeFigcraft(corpus[name]);
  const native = JSON.parse(new TextDecoder().decode(unzipSync(corpus[name])["document.json"]));
  const archive = await encodeFigcraft(opened.document, opened.nextId);
  const saved = JSON.parse(new TextDecoder().decode(unzipSync(archive)["document.json"]));
  expect(Object.keys(saved.nodes).sort()).toEqual(Object.keys(native.nodes).sort());
  for (const id of Object.keys(native.nodes)) {
    expect(saved.nodes[id].plugin_data ?? {}).toEqual(native.nodes[id].plugin_data ?? {});
    expect(saved.nodes[id].guides ?? []).toEqual(native.nodes[id].guides ?? []);
  }
  expect(await decodeFigcraft(archive)).toEqual(opened);
});
