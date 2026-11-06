import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { decodeFigcraft, encodeFigcraft, FIGCRAFT_TREE_DEPTH_LIMIT } from "../../src/engine/file-format";
import type { Document, GroupNode } from "../../src/engine/document";

// Source: original/figcraft/crates/doc/src/node.rs Node/NodeKind and
// original/figcraft/crates/render/src/export_depth.rs MAX_EXPORT_DEPTH (0b97f3f).
const source = readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8");
type Native = { pages: number[]; nodes: Record<string, Record<string, unknown>>; current_page: number; next_id: number };
const fixture = (): Native => JSON.parse(source) as Native;
const bytes = (value: Native) => new TextEncoder().encode(JSON.stringify(value));
const group = (id: number, parent: number, children: number[], extra: Record<string, unknown> = {}) => ({
  id, type: "group", name: `Group ${id}`, parent, children, width: 100, height: 80,
  transform: [1, 0, 0, 1, 10, 20], ...extra,
});

describe("native group tree file parity", () => {
  it("retains nested child order, local affine matrices, appearance and both supported blends", async () => {
    const native = fixture();
    native.nodes["1"].children = [3];
    native.nodes["2"].parent = 3;
    native.nodes["2"].blend = "passThrough";
    native.nodes["3"] = group(3, 1, [2, 4], {
      transform: [0, -1, 1, 0, 30, 40], blend: "normal", visible: false, locked: true, opacity: 0.625,
      fills: [{ type: "solid", color: [0.12345, 0.25, 0.5, 0.5], opacity: 0.35, colorAlpha: 0.4, visible: false, blend: "passThrough" }],
    });
    native.nodes["4"] = group(4, 3, [5], { transform: [2, 0, 0, 2, 5, 7], blend: "passThrough" });
    native.nodes["5"] = { ...native.nodes["2"], id: 5, name: "Nested rectangle", parent: 4, transform: [1, 0.25, 0.5, 1, 8, 9] };
    native.next_id = 6;
    const decoded = await decodeFigcraft(bytes(native));
    expect(decoded.document.nodes["1"]).toMatchObject({ children: ["3"] });
    expect(decoded.document.nodes["3"]).toMatchObject({ kind: "group", parent: "1", children: ["2", "4"], transform: [0, -1, 1, 0, 30, 40], blend: "normal", visible: false, locked: true, opacity: 0.625 });
    expect(decoded.document.nodes["4"]).toMatchObject({ kind: "group", parent: "3", children: ["5"], transform: [2, 0, 0, 2, 5, 7] });
    expect(decoded.document.nodes["2"]).toMatchObject({ parent: "3", blend: "passThrough" });
    expect((decoded.document.nodes["3"] as GroupNode).fills?.[0]).toMatchObject({ opacity: Math.fround(0.35), colorAlpha: Math.fround(0.4), visible: false, blend: "passThrough" });
    const archive = await encodeFigcraft(decoded.document, decoded.nextId);
    const wire = JSON.parse(strFromU8(unzipSync(archive)["document.json"])) as Native;
    expect(wire.nodes["3"]).toMatchObject({ children: [2, 4], blend: "normal" });
    expect(wire.nodes["4"]).toMatchObject({ children: [5], blend: "passThrough" });
    expect(wire.nodes["2"].blend).toBe("passThrough");
    expect(await decodeFigcraft(archive)).toEqual(decoded);
  });

  it.each([
    ["wrong parent", (native: Native) => { native.nodes["2"].parent = 1; }],
    ["duplicate descendant", (native: Native) => { native.nodes["3"].children = [2, 2]; }],
    ["cycle", (native: Native) => { native.nodes["3"].children = [2, 3]; }],
    ["orphan", (native: Native) => { native.nodes["3"].children = []; }],
    ["unlisted page", (native: Native) => { native.nodes["4"] = { id: 4, type: "page", name: "Unlisted", width: 0, height: 0, children: [] }; }],
    ["cross-page child", (native: Native) => { native.nodes["4"] = { id: 4, type: "page", name: "Other", width: 0, height: 0, children: [2] }; native.pages = [1, 4]; }],
  ] as const)("rejects %s in a page-rooted tree", async (_name, change) => {
    const native = fixture();
    native.nodes["1"].children = [3];
    native.nodes["2"].parent = 3;
    native.nodes["3"] = group(3, 1, [2]);
    native.next_id = 5;
    change(native);
    await expect(decodeFigcraft(bytes(native))).rejects.toThrow("Cannot open Figcraft file");
  });

  it("rejects a layer deeper than the native export limit without recursive traversal", async () => {
    const native = fixture();
    native.nodes["1"].children = [3];
    delete native.nodes["2"];
    for (let depth = 1; depth <= FIGCRAFT_TREE_DEPTH_LIMIT + 1; depth++) {
      const id = depth + 2;
      native.nodes[String(id)] = group(id, depth === 1 ? 1 : id - 1, depth <= FIGCRAFT_TREE_DEPTH_LIMIT ? [id + 1] : []);
    }
    native.next_id = FIGCRAFT_TREE_DEPTH_LIMIT + 4;
    await expect(decodeFigcraft(bytes(native))).rejects.toThrow(`maximum depth of ${FIGCRAFT_TREE_DEPTH_LIMIT}`);
    delete native.nodes[String(FIGCRAFT_TREE_DEPTH_LIMIT + 3)];
    native.nodes[String(FIGCRAFT_TREE_DEPTH_LIMIT + 2)].children = [];
    await expect(decodeFigcraft(bytes(native))).resolves.toMatchObject({ document: { currentPage: "1" } });
  });

  it("validates in-memory group relationships before saving", async () => {
    const native = fixture();
    native.nodes["1"].children = [3];
    native.nodes["2"].parent = 3;
    native.nodes["3"] = group(3, 1, [2]);
    const decoded = await decodeFigcraft(bytes(native));
    const broken: Document = { ...decoded.document, nodes: { ...decoded.document.nodes, "3": { ...decoded.document.nodes["3"] as GroupNode, children: ["2", "2"] } } };
    await expect(encodeFigcraft(broken)).rejects.toThrow("invalid, repeated or cyclic child relationship");
  });
});
