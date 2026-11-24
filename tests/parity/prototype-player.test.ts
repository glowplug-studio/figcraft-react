import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import native from "../fixtures/native-prototype-player.json" with { type: "json" };

type Step = { command: string; params: Record<string, unknown>; receipt?: unknown; error?: string };

// Native cmd/proto.rs (open_player, presentOptions, linkNotice) and cmd.rs::refuse_unknown_params, observed at bad07e44.
describe("prototype player requests and parameter checks, as native runs them", () => {
  for (const c of native.cases as { name: string; steps: Step[] }[]) {
    it(c.name, () => {
      const e = new EditorEngine();
      for (const [n, step] of c.steps.entries()) {
        const where = `${c.name} step ${n}: ${step.command} ${JSON.stringify(step.params)}`;
        let receipt: unknown, error: string | undefined;
        try { receipt = e.execute(step.command, step.params); } catch (x) { error = (x as Error).message; }
        if (step.error !== undefined) expect(error, where).toBe(step.error);
        else {
          expect(error, where).toBeUndefined();
          if (step.command.startsWith("proto.")) expect(receipt, where).toEqual(step.receipt);
        }
      }
    });
  }

  it("asks the interface to open the player and keeps the presenter's options and the link notice preference", () => {
    const e = new EditorEngine();
    e.execute("node.create", { type: "frame", x: 0, y: 0, width: 100, height: 200 });
    e.execute("node.create", { type: "frame", x: 200, y: 0, width: 100, height: 200 });
    e.execute("proto.preview", { start: 3 });
    expect(e.getSnapshot().prototypePlayer).toEqual({ mode: "preview", start: "3" });
    e.execute("proto.closePreview");
    expect(e.getSnapshot().prototypePlayer).toBeUndefined();
    e.execute("proto.present", { start: 2 });
    expect(e.getSnapshot().prototypePlayer).toEqual({ mode: "present", start: "2" });
    // Closing the preview pane leaves a presentation alone.
    e.execute("proto.closePreview");
    expect(e.getSnapshot().prototypePlayer).toEqual({ mode: "present", start: "2" });
    e.execute("proto.presentOptions", { scale: "fill" });
    e.execute("proto.presentOptions", { hideUi: true });
    expect(e.getSnapshot().presentOptions).toEqual({ scale: "fill", hideUi: true });
    e.execute("proto.linkNotice", { show: false });
    expect(e.getSnapshot().linkNoticeSkipped).toBe(true);
    // None of it is an edit.
    expect(e.getSnapshot().document.nodes["2"].interactions).toBeUndefined();
  });
});
