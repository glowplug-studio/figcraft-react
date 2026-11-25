import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";

// Native comments::frame_of reads a layer's `visible`, which is true unless hidden; the port leaves it unset on layers made by command.
describe("the frame a comment belongs to", () => {
  it("is the visible top-level frame under its pin, its visibility unset or not", () => {
    const e = new EditorEngine();
    const home = (e.execute("frame.create", { name: "Home", x: 0, y: 0, width: 200, height: 300 }) as { id: number }).id;
    const hidden = (e.execute("frame.create", { name: "Hidden", x: 300, y: 0, width: 200, height: 300 }) as { id: number }).id;
    e.execute("node.set", { id: hidden, props: { visible: false } });
    e.execute("comment.add", { x: 150, y: 200, text: "On Home" });
    e.execute("comment.add", { x: 350, y: 200, text: "On a hidden frame" });
    const rows = (e.execute("comment.list", { page: "all" }) as { comments: { text: string; frame: number | null; frameName: string | null }[] }).comments;
    expect(rows.find(r => r.text === "On Home")).toMatchObject({ frame: Number(home), frameName: "Home" });
    expect(rows.find(r => r.text === "On a hidden frame")!.frame).toBeNull();
    expect((e.execute("comment.list", { frame: home, page: "all" }) as { comments: unknown[] }).comments).toHaveLength(1);
  });
});
