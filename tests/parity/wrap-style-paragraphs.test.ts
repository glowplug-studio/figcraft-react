import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/native-wrap-style-paragraphs.json";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import type { LayerNode } from "../../src/engine/document";
import { FontLibrary } from "../../src/engine/font-library";
import { layerCss } from "../../src/engine/layer-css";
import { ShapingFace } from "../../src/engine/shaping-face";
import { layoutTextFlow } from "../../src/engine/text-flow";

// A wrap style at three levels: the text layer, a paragraph (overriding the layer's) and a text style. Observed through
// the native engine at bad07e44 (upstream 136ca4cd, d14c637d, 7e2752d5; #1827, #2094;
// tests/fixtures/native-wrap-style-paragraphs.provenance.md).

type Receipt = Record<string, unknown>;
type Case = { name: string; commands: [string, Receipt][]; receipts: (Receipt | Receipt[] | null)[]; saved?: string };
const cases = fixture.cases as unknown as Case[];
const textKeys = ["characters", "wrapStyle", "lineWrapStyles", "textStyleRanges"];
/** What the fixture keeps of a `node.get` receipt. */
const ofText = (r: Receipt) => ({ ...Object.fromEntries(textKeys.filter(k => k in r).map(k => [k, r[k]])), textStyle: (r.styles as Receipt | undefined)?.text ?? null });

describe("a wrap style per paragraph and in text styles", () => {
  it.each(cases.map(c => [c.name, c] as const))("%s", async (_name, c) => {
    const engine = new EditorEngine();
    for (const [i, [command, params]] of c.commands.entries()) {
      const expected = c.receipts[i], why = `${command} ${JSON.stringify(params)} (step ${i})`;
      if (expected && !Array.isArray(expected) && "error" in expected) {
        const before = engine.getSnapshot().document;
        await expect(engine.executeAsync(command, params), why).rejects.toThrow(/wrapStyle: auto\|balance\|pretty/);
        expect(engine.getSnapshot().document, `${why}: a refused command changes nothing`).toBe(before);
        continue;
      }
      const actual = await engine.executeAsync(command, params).catch((error: unknown) => { throw new Error(`${why}: ${String(error)}`); }) as unknown;
      if (command === "node.get") expect(ofText(actual as Receipt), why).toEqual(expected);
      else if (command === "style.list") expect((actual as Receipt[]).map(s => ({ id: s.id, name: s.name, paragraph: s.paragraph ?? null })), why).toEqual(expected);
      else if (command === "style.create") expect((actual as Receipt).id, why).toBe((expected as Receipt).id);
    }
  });

  // Each paragraph breaks by its own wrap style, else the layer's. Native's line starts were read with the Down key
  // from each paragraph's start, in Inter Regular.
  it("each paragraph wraps by its own style", async () => {
    const { layout } = fixture, fonts = new FontLibrary();
    for (const face of ShapingFace.read(await readFile(new URL("../../" + layout.font, import.meta.url)))) fonts.add(face);
    const engine = new EditorEngine();
    for (const [command, params] of layout.setup as [string, Receipt][]) await engine.executeAsync(command, params);
    for (const step of layout.steps as unknown as { name: string; commands: [string, Receipt][]; secondLineStarts: number[]; wrapStyle?: string; lineWrapStyles?: string[] }[]) {
      for (const [command, params] of step.commands) await engine.executeAsync(command, params);
      const node = engine.getSnapshot().document.nodes["2"] as LayerNode & { kind: "text" };
      const lines = layoutTextFlow(node.text, fonts, { width: layout.width, height: undefined }, []).lines;
      // The line after each paragraph's first.
      const seconds = lines.flatMap((line, i) => i > 0 && !lines[i - 1].paragraphEnd && (i === 1 || lines[i - 2].paragraphEnd) ? [line.start] : []);
      expect(seconds, step.name).toEqual(step.secondLineStarts);
      const read = engine.execute("node.get", { id: "2" }) as Receipt;
      expect([read.wrapStyle, read.lineWrapStyles], step.name).toEqual([step.wrapStyle, step.lineWrapStyles]);
    }
  });

  // CSS has one `text-wrap` per element: written when every paragraph has the same style. Native's lines come from
  // inspect.code.
  it("writes text-wrap in CSS only when the paragraphs agree", async () => {
    const engine = new EditorEngine(), { css } = fixture;
    for (const [i, [command, params]] of (css.commands as [string, Receipt][]).entries()) {
      if (command !== "inspect.code") { await engine.executeAsync(command, params); continue; }
      const { document } = engine.getSnapshot();
      const lines = layerCss(document, document.nodes["2"]).split("\n").map(line => line.trim()).filter(line => line.includes("text-wrap"));
      expect(lines, `step ${i}`).toEqual(css.textWrap[i]);
    }
  });

  // The file keeps a paragraph's own wrap style and the port reads it as native wrote it.
  it.each(cases.filter(c => c.saved).map(c => [c.name, c] as const))("reads the file native saved for: %s", async (_name, c) => {
    const built = new EditorEngine();
    for (const [command, params] of c.commands) await built.executeAsync(command, params).catch(() => undefined);
    const opened = await decodeFigcraft(Uint8Array.from(Buffer.from(c.saved!, "base64")));
    const texts = (nodes: Readonly<Record<string, { kind: string }>>) => Object.values(nodes).filter(n => n.kind === "text").map(n => (n as unknown as { text: unknown }).text);
    expect(texts(opened.document.nodes)).toEqual(texts(built.getSnapshot().document.nodes));
  });
});
