import { expect, it } from "vitest";
import { EditorWorkspace } from "../../src/engine/workspace";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";

it("allocates distinct full-width IDs, keeps the counter across undo and does not serialise the client identity", async () => {
  const a = EditorEngine.newTab(), b = EditorEngine.newTab();
  a.setLiveClient(2097152);
  b.setLiveClient(2097153);
  const first = String(a.execute("shape.rectangle").id);
  expect(first).toBe("9007199254740993");
  expect(String(b.execute("shape.rectangle").id)).toBe("9007203549708289");
  a.execute("edit.undo");
  a.setLiveClient(0);
  a.setLiveClient(2097152);
  expect(String(a.execute("shape.rectangle").id)).toBe("9007199254740994");
  const result = await decodeFigcraft(await a.nativeSnapshot());
  expect(result.document.nodes["9007199254740994"]).toBeDefined();
  expect(result.document).not.toHaveProperty("client");
});

it("uses the native 2^24 counter gap for separate branches of a joined drawing", () => {
  const workspace = new EditorWorkspace();
  const tab = workspace.getSnapshot()[0];
  workspace.attachGuestSession(tab.id, { connection: "logical", client: 7, file: "file", access: "edit" });
  const base = 7n << 32n;
  expect(BigInt(String(workspace.activeEngine!.execute("shape.rectangle").id))).toBe(base + 1n);
  workspace.execute("branch.create", {name:"First"});
  const first = BigInt(String(workspace.activeEngine!.execute("shape.rectangle").id));
  expect(first).toBe(base + 2n + (1n << 24n));
  workspace.execute("doc.switch", {index:0});
  workspace.execute("branch.create", {name:"Second"});
  const second = BigInt(String(workspace.activeEngine!.execute("shape.rectangle").id));
  expect(second).toBe(first + 1n + (1n << 24n));
});

it("refuses to merge layers created in an offline branch into another participant's namespace", () => {
  const workspace = new EditorWorkspace(), main = workspace.getSnapshot()[0];
  const { id } = workspace.execute("branch.create", { name: "Local work" });
  workspace.activeEngine!.execute("shape.rectangle", { name: "Proposed" });
  workspace.execute("doc.switch", { index: 0 });
  workspace.attachGuestSession(main.id, { file: "shared", connection: "tab", client: 8, access: "edit" });
  expect(() => workspace.execute("branch.merge", { id })).toThrow(/outside this live session/);
  expect(Object.values(workspace.activeEngine!.getSnapshot().document.nodes).some(n => n.name === "Proposed")).toBe(false);
  workspace.leaveSession("tab");
  expect(workspace.execute("branch.merge", { id })).toMatchObject({ merged: true });
});
