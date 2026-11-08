import { expectSolid } from "../fixtures/expect-solid";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { decodeFigcraft, encodeFigcraft, MAX_FILE_BYTES } from "../../src/engine/file-format";
import { newDocument, type Document, type RectangleNode } from "../../src/engine/document";
import { colour } from "../../src/engine/colour";

// Inspection-derived fixture, NOT captured from a running Rust engine.
// Based on original/figcraft/crates/format/src/lib.rs:DocumentJson,
// doc/src/lib.rs:Document and doc/src/node.rs:Node/NodeKind at upstream 0b97f3f.
const fixtureText = readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8");
const bytes = (source: string) => new TextEncoder().encode(source);
const fixture = () => JSON.parse(fixtureText) as {
  format: string; version: number; imageIndex: unknown[]; name: string; pages: number[];
  nodes: Record<string, Record<string, unknown>>; next_id: number; current_page: number;
  styles: unknown[]; variables: unknown; document_colors: unknown[]; comments: unknown[];
};
const encodedFixture = (change: (value: ReturnType<typeof fixture>) => void) => {
  const value = fixture(); change(value); return bytes(JSON.stringify(value));
};

describe("bounded native Figcraft file adapter", () => {
  it("opens the inspection-derived native fixture with omitted upstream defaults", async () => {
    const { document, nextId } = await decodeFigcraft(bytes(fixtureText));
    expect(nextId).toBe("3");
    expect(document.name).toBe("Native rectangle");
    expect(document.nodes["1"]).toMatchObject({ kind: "page", background: "#f5f5f5", children: ["2"] });
    expect(document.nodes["2"]).toEqual({ id: "2", name: "Rectangle", kind: "rectangle", parent: "1", x: 10, y: 20, width: 30, height: 40, fill: "#d9d9d9" });
    expect(Object.isFrozen(document.nodes["1"])).toBe(true);
    expect(Object.isFrozen(document.nodes)).toBe(true);
  });

  it.each([0, 3] as const)("opens native ZIP compression level %i and writes document.json", async (level) => {
    const original = await decodeFigcraft(zipSync({ "document.json": bytes(fixtureText) }, { level }));
    const archive = await encodeFigcraft(original.document, "100");
    const members = unzipSync(archive);
    expect(Object.keys(members)).toEqual(["document.json"]);
    expect(JSON.parse(strFromU8(members["document.json"]))).toMatchObject({ format: "figcraft", version: 1, next_id: 100 });
    expect(await decodeFigcraft(archive)).toEqual({ ...original, nextId: "100" });
  });

  it("round-trips multiple pages, order, selected page, Unicode names and empty paints", async () => {
    const native = fixture();
    native.nodes["3"] = { id: 3, type: "page", name: "Página 二", width: 0, height: 0, background: "#abcdef", children: [] };
    native.nodes["2"].fills = [];
    native.pages = [3, 1]; native.current_page = 3; native.next_id = 4;
    const original = await decodeFigcraft(bytes(JSON.stringify(native)));
    expect((original.document.nodes["2"] as RectangleNode).fill).toBe("transparent");
    expect(await decodeFigcraft(await encodeFigcraft(original.document))).toEqual(original);
  });

  it("retains unsigned 64-bit numeric ID tokens beyond JavaScript integer precision", async () => {
    const source = fixtureText.replaceAll('"2"', '"18446744073709551614"').replace(/\b2\b/g, "18446744073709551614").replace('"next_id": 3', '"next_id": 18446744073709551615');
    const decoded = await decodeFigcraft(bytes(source));
    expect(decoded.nextId).toBe("18446744073709551615");
    expect(decoded.document.nodes["1"].kind === "page" && decoded.document.nodes["1"].children).toEqual(["18446744073709551614"]);
    const archive = await encodeFigcraft(decoded.document, decoded.nextId);
    const wire = strFromU8(unzipSync(archive)["document.json"]);
    expect(wire).toContain('"id":18446744073709551614');
    expect(wire).toContain('"next_id":18446744073709551615');
    expect(await decodeFigcraft(archive)).toEqual(decoded);
  });

  it("repairs the allocator upward and preserves the exhausted u64 maximum", async () => {
    expect((await decodeFigcraft(encodedFixture((value) => { value.next_id = 1; }))).nextId).toBe("3");
    const source = fixtureText.replaceAll('"2"', '"18446744073709551615"').replace(/\b2\b/g, "18446744073709551615");
    const decoded = await decodeFigcraft(bytes(source));
    expect(decoded.nextId).toBe("18446744073709551615");
    expect(await decodeFigcraft(await encodeFigcraft(decoded.document, decoded.nextId))).toEqual(decoded);
  });

  it("defaults an omitted current page to the first page", async () => {
    const source = fixtureText.replace('"current_page": 1,', "");
    expect((await decodeFigcraft(bytes(source))).document.currentPage).toBe("1");
  });

  it.each([[0, -1, 1, 0, 30, 40], [2, .5, .25, -3, 10, 20], [0, 0, 0, 1, 12, 14]])("retains finite affine coefficients through a native round-trip (%j)", async (...transform) => {
    const source = encodedFixture(value => { value.nodes["2"].transform = transform; });
    const decoded = await decodeFigcraft(source);
    expect(decoded.document.nodes["2"]).toMatchObject({ transform, x: transform[4], y: transform[5] });
    expect(await decodeFigcraft(await encodeFigcraft(decoded.document, decoded.nextId))).toEqual(decoded);
  });

  it("rejects malformed or overflowing affine geometry before import", async () => {
    await expect(decodeFigcraft(encodedFixture(value => { value.nodes["2"].transform = [1, 0, 0]; }))).rejects.toThrow();
    await expect(decodeFigcraft(encodedFixture(value => { value.nodes["2"].transform = [1e308, 0, 0, 1, 0, 0]; }))).rejects.toThrow();
  });

  it("accepts explicitly written default node properties", async () => {
    const data = encodedFixture((value) => {
      Object.assign(value.nodes["2"], { visible: true, locked: false, opacity: 1, effects: [], strokes: [], corners: { radii: [0, 0, 0, 0], smoothing: 0 }, constraints: { horizontal: "left", vertical: "top" }, stroke: { weight: 1, align: "inside", sides: null, cap_start: "none", cap_end: "none", join: "miter", miter_limit: 4, dashes: [] }, child_layout: { sizing_h: "fixed", sizing_v: "fixed", absolute: false, grid_column_span: 0, grid_row_span: 0 }, styles: { fill: null, stroke: null, effect: null, text: null, grid: null } });
    });
    expect(await decodeFigcraft(data)).toEqual(await decodeFigcraft(bytes(fixtureText)));
  });

  it("retains f32 colour channels and alpha without rounding them to CSS bytes", async () => {
    const source = encodedFixture(value => {
      value.nodes["1"].background = [0.12345, 0.23456, 0.34567, 0.45678];
      value.nodes["2"].fills = [{ type: "solid", color: [0.12345, 0.23456, 0.34567, 0.45678] }];
    });
    const decoded = await decodeFigcraft(source);
    const expected = colour(0.12345, 0.23456, 0.34567, 0.45678);
    expect(decoded.document.nodes["1"]).toMatchObject({ backgroundColor: expected });
    expect(expectSolid((decoded.document.nodes["2"] as RectangleNode).fills?.[0]).color).toEqual(expected);
    expect(await decodeFigcraft(await encodeFigcraft(decoded.document, decoded.nextId))).toEqual(decoded);
    const wire = JSON.parse(strFromU8(unzipSync(await encodeFigcraft(decoded.document))["document.json"]));
    expect(wire.nodes["1"].background).toEqual(expected);
    expect(wire.nodes["2"].fills[0].color).toEqual(expected);
  });

  it("retains independent node opacity, paint opacity, colour alpha, order and visibility", async () => {
    const source = encodedFixture(value => {
      Object.assign(value.nodes["2"], { visible: false, locked: true, opacity: 0.6, fills: [
        { type: "solid", color: [0.25, 0.5, 0.75, 0.8], opacity: 0.4, colorAlpha: 0.2, visible: false },
        { type: "solid", color: "#123456", opacity: 0.9, colorAlpha: 0.7, visible: true },
      ] });
    });
    const decoded = await decodeFigcraft(source);
    const node = decoded.document.nodes["2"] as RectangleNode;
    expect(node).toMatchObject({ visible: false, locked: true, opacity: Math.fround(0.6) });
    expect(node.fills).toHaveLength(2);
    expect(node.fills?.[0]).toMatchObject({ opacity: Math.fround(0.4), colorAlpha: Math.fround(0.2), visible: false, color: colour(0.25, 0.5, 0.75, 0.8) });
    expect(node.fills?.[1]).toMatchObject({ opacity: Math.fround(0.9), colorAlpha: Math.fround(0.7), visible: true });
    expect(Object.isFrozen(node.fills)).toBe(true);
    const archive = await encodeFigcraft(decoded.document, decoded.nextId);
    const wire = JSON.parse(strFromU8(unzipSync(archive)["document.json"])).nodes["2"];
    expect(wire).toMatchObject({ visible: false, locked: true, opacity: Math.fround(0.6) });
    expect(wire.fills.map((paint: { color: { r: number } }) => paint.color.r)).toEqual([0.25, Math.fround(0x12 / 255)]);
    expect(wire.fills[0]).toMatchObject({ opacity: Math.fround(0.4), colorAlpha: Math.fround(0.2), visible: false });
    expect(await decodeFigcraft(archive)).toEqual(decoded);
  });

  it.each([
    ["future version", (value: ReturnType<typeof fixture>) => { value.version = 2; }],
    ["comments", (value: ReturnType<typeof fixture>) => { value.comments = [{ text: "preserve me" }]; }],
    ["text", (value: ReturnType<typeof fixture>) => { value.nodes["2"].type = "text"; }],
    ["custom metadata", (value: ReturnType<typeof fixture>) => { value.nodes["2"].plugin_data = { key: "preserve me" }; }],
    ["paint blend", (value: ReturnType<typeof fixture>) => { value.nodes["2"].fills = [{ type: "solid", color: "#ffffff", blend: "multiply" }]; }],
    ["node blend", (value: ReturnType<typeof fixture>) => { value.nodes["2"].blend = "multiply"; }],
    ["unknown properties", (value: ReturnType<typeof fixture>) => { value.nodes["2"].future = null; }],
  ])("refuses unsupported %s without dropping it", async (_label, change) => {
    await expect(decodeFigcraft(encodedFixture(change))).rejects.toThrow(/not supported|newer/);
  });

  it.each([
    ["gradient missing kind and handles", (value: ReturnType<typeof fixture>) => { value.nodes["2"].fills = [{ type: "gradient", stops: [] }]; }],
    ["duplicate page", (value: ReturnType<typeof fixture>) => { value.pages = [1, 1]; }],
    ["missing child", (value: ReturnType<typeof fixture>) => { value.nodes["1"].children = [7]; }],
    ["duplicate child", (value: ReturnType<typeof fixture>) => { value.nodes["1"].children = [2, 2]; }],
    ["wrong parent", (value: ReturnType<typeof fixture>) => { value.nodes["2"].parent = 9; }],
    ["orphan", (value: ReturnType<typeof fixture>) => { value.nodes["1"].children = []; }],
    ["ID mismatch", (value: ReturnType<typeof fixture>) => { value.nodes["2"].id = 3; }],
    ["wrong current page", (value: ReturnType<typeof fixture>) => { value.current_page = 2; }],
    ["negative ID", (value: ReturnType<typeof fixture>) => { value.next_id = -1; }],
  ])("refuses invalid graph/data: %s", async (_label, change) => {
    await expect(decodeFigcraft(encodedFixture(change))).rejects.toThrow("Cannot open Figcraft file");
  });

  it.each(["versions/index.json", "branches/index.json", "library/manifest.json", "thumbnail.png", "../document.json"])("refuses unsupported ZIP member %s", async (member) => {
    const archive = zipSync({ "document.json": bytes(fixtureText), [member]: bytes("{}") });
    await expect(decodeFigcraft(archive)).rejects.toThrow("Cannot open Figcraft file");
  });

  it("round-trips stored and compressed images with native byte-derived dimensions and sorted keys", async () => {
    const png = new Uint8Array(readFileSync(new URL("../fixtures/images/six-pixels.png", import.meta.url)));
    const json = encodedFixture(value => { value.imageIndex = [{ hash: "z", width: 999, height: 999 }]; });
    const archive = zipSync({ "images/z": [png, { level: 9 }], "document.json": json, "images/__proto__": [bytes("unknown bytes"), { level: 0 }] });
    const { document, issues } = await decodeFigcraft(archive);
    expect(issues).toBeUndefined();
    expect(document.images?.z).toMatchObject({ width: 3, height: 2 });
    expect(document.images?.["__proto__"]).toMatchObject({ width: 0, height: 0 });
    const members = unzipSync(await encodeFigcraft(document));
    expect(members["images/z"]).toEqual(png);
    expect(members["images/__proto__"]).toEqual(bytes("unknown bytes"));
    expect(JSON.parse(strFromU8(members["document.json"]!)).imageIndex).toEqual([{ hash: "__proto__", width: 0, height: 0 }, { hash: "z", width: 3, height: 2 }]);
  });

  it.each(["png", "jpg", "webp", "gif", "bmp", "tiff"])("preserves exact %s bytes when native files are reopened", async extension => {
    const image = readFileSync(new URL(`../fixtures/images/six-pixels.${extension}`, import.meta.url));
    const archive = zipSync({ "document.json": bytes(fixtureText), "images/shape": image });
    const opened = await decodeFigcraft(archive);
    const reopened = await decodeFigcraft(await encodeFigcraft(opened.document));
    expect(reopened.document.images?.shape).toMatchObject({ width: 3, height: 2 });
    expect(Buffer.from(await reopened.document.images!.shape!.bytes.arrayBuffer())).toEqual(image);
  });

  it("refuses ambiguous duplicate image entries", async () => {
    const archive = zipSync({ "document.json": bytes(fixtureText), "images/keyA": bytes("first"), "images/keyB": bytes("second") }, { level: 0 });
    const view = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
    for (let offset = view.indexOf("images/keyB"); offset !== -1; offset = view.indexOf("images/keyB", offset + 1)) {
      view.write("images/keyA", offset);
    }
    await expect(decodeFigcraft(archive)).rejects.toThrow("Cannot open Figcraft file");
  });

  it("reports damaged, unsafe and missing resources while retaining accessible images", async () => {
    const json = encodedFixture(value => { value.imageIndex = ["bad", "missing", "../path"].map(hash => ({ hash })); });
    const archive = zipSync({ "images/bad": bytes("damage marker"), "images/../path": bytes("unsafe"), "images/good": bytes("original"), "document.json": json }, { level: 0 });
    const offset = Buffer.from(archive).indexOf("damage marker");
    expect(offset).toBeGreaterThan(0);
    archive[offset] = 0;
    const decoded = await decodeFigcraft(archive);
    expect(Object.keys(decoded.document.images!)).toEqual(["good"]);
    expect(decoded.issues).toHaveLength(3);
    expect(decoded.issues?.join("\n")).toMatch(/image bad.*CRC32/);
    expect(decoded.issues?.join("\n")).toMatch(/image missing.*missing/);
    expect(decoded.issues?.join("\n")).toMatch(/image \.\.\/path.*invalid image name/);
    expect((await decodeFigcraft(json)).issues).toBeUndefined();
  });

  it("limits missing image notices and skips resources past the aggregate budget", async () => {
    const json = encodedFixture(value => { value.imageIndex = Array.from({ length: 23 }, (_, i) => ({ hash: String(i) })); });
    const archive = zipSync({ "document.json": json, "images/large": new Uint8Array(MAX_FILE_BYTES), "images/small": bytes("kept") });
    const { document, issues } = await decodeFigcraft(archive);
    expect(Object.keys(document.images!)).toEqual(["small"]);
    expect(issues).toHaveLength(21);
    expect(issues?.[0]).toContain("exceeds the browser archive budget");
    expect(issues?.at(-1)).toBe("4 more images couldn't be loaded");
  });

  it("refuses malformed, truncated, duplicate-key and oversized input", async () => {
    await expect(decodeFigcraft(bytes("garbage"))).rejects.toThrow("invalid JSON or ZIP");
    await expect(decodeFigcraft(bytes('{"version":1,"version":2}'))).rejects.toThrow("duplicate JSON key");
    const archive = await encodeFigcraft(newDocument());
    await expect(decodeFigcraft(archive.slice(0, -20))).rejects.toThrow("invalid JSON or ZIP");
    await expect(decodeFigcraft(new Uint8Array(MAX_FILE_BYTES + 1))).rejects.toThrow("16 MiB");
    const bomb = zipSync({ "document.json": new Uint8Array(MAX_FILE_BYTES + 1) });
    await expect(decodeFigcraft(bomb)).rejects.toThrow("16 MiB");
  });

  it("refuses non-finite geometry instead of silently serialising it to null", async () => {
    const decoded = await decodeFigcraft(bytes(fixtureText));
    const document: Document = { ...decoded.document, nodes: { ...decoded.document.nodes, "2": { ...decoded.document.nodes["2"] as RectangleNode, x: Infinity } } };
    await expect(encodeFigcraft(document)).rejects.toThrow("finite");
  });

  it("bounds actual inflation even when ZIP sizes falsely advertise a small document", async () => {
    const archive = zipSync({ "document.json": bytes(" ".repeat(2 * 1024 * 1024)) });
    const directory = archive.findIndex((byte, index) => byte === 0x50 && archive[index + 1] === 0x4b && archive[index + 2] === 1 && archive[index + 3] === 2);
    expect(directory).toBeGreaterThan(0);
    // Corrupt both declared uncompressed sizes; the real deflate stream stays large.
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    view.setUint32(22, 100, true);
    view.setUint32(directory + 24, 100, true);
    await expect(decodeFigcraft(archive)).rejects.toThrow("decompressed data exceeds");
  });

  it("rejects out-of-range IDs, string IDs and invalid UTF-8", async () => {
    await expect(decodeFigcraft(bytes(fixtureText.replace('"next_id": 3', '"next_id": 18446744073709551616')))).rejects.toThrow("64-bit");
    await expect(decodeFigcraft(bytes(fixtureText.replace('"next_id": 3', '"next_id": "3"')))).rejects.toThrow("numeric node ID");
    await expect(decodeFigcraft(Uint8Array.of(123, 255, 125))).rejects.toThrow("invalid JSON or ZIP");
  });

  it("checks CRC32 even when a corrupted payload is valid JSON with the same byte length", async () => {
    const archive = zipSync({ "document.json": bytes(fixtureText) }, { level: 0 });
    const nameOffset = archive.findIndex((byte, index) => byte === 78 && archive[index + 1] === 97 && archive[index + 2] === 116);
    expect(nameOffset).toBeGreaterThan(0);
    archive[nameOffset] = 77; // Native rectangle -> Mative rectangle; valid same-length JSON.
    await expect(decodeFigcraft(archive)).rejects.toThrow("CRC32 checksum mismatch");
  });

  it("rejects a forged CRC with otherwise matching compressed and uncompressed sizes", async () => {
    const archive = zipSync({ "document.json": bytes(fixtureText) }, { level: 3 });
    const directory = archive.findIndex((byte, index) => byte === 0x50 && archive[index + 1] === 0x4b && archive[index + 2] === 1 && archive[index + 3] === 2);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const forged = (view.getUint32(directory + 16, true) ^ 0xffffffff) >>> 0;
    view.setUint32(14, forged, true);
    view.setUint32(directory + 16, forged, true);
    await expect(decodeFigcraft(archive)).rejects.toThrow("CRC32 checksum mismatch");
  });

  it("rejects documents over the browser node count limit before graph traversal", async () => {
    const native = fixture();
    for (let index = 3; index <= 10_001; index++) native.nodes[String(index)] = { ...native.nodes["2"], id: index };
    await expect(decodeFigcraft(bytes(JSON.stringify(native)))).rejects.toThrow("more than 10000 nodes");
  });
});
