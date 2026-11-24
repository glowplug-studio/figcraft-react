import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import native from "../fixtures/native-library-link-relative.json" with { type: "json" };

// Native library.rs (7b34dbab, #2132), observed at bad07e44: a document opened and saved with no path keeps each link's `relative`.
it("keeps a library link's relative path through open and save, as native does for a document with no path", async () => {
  const e = new EditorEngine();
  await e.executeAsync("file.open", { data: base64Bytes(new TextEncoder().encode(JSON.stringify(native.document))), name: "linked.figcraft" });
  const list = (e.execute("library.list") as { libraries: Record<string, unknown>[] }).libraries;
  // A server invite address is held under a hashed team-library key in the port (no raw share secret in the document model);
  // native lists the address. Every other field matches.
  expect(list.map(l => ({ id: l.id, name: l.name, path: l.server ? "server" : l.path, seenVersion: l.seenVersion, server: l.server })))
    .toEqual(native.list.map(l => ({ ...l, path: l.server ? "server" : l.path })));
  const bytes = await encodeFigcraft(e.getSnapshot().document);
  const { unzipSync, strFromU8 } = await import("fflate");
  const saved = JSON.parse(strFromU8(unzipSync(bytes)["document.json"]));
  // The port writes its hashed team-library key for the server link, never the invite address (an earlier, recorded choice).
  const server = (path: string) => path.startsWith("team-library:") || /^wss?:/.test(path) ? "server" : path;
  expect(saved.libraries.enabled.map((l: {path: string}) => ({ ...l, path: server(l.path) })))
    .toEqual(native.saved.map(l => ({ ...l, path: server(l.path) })));
  // And it survives another round through the port.
  const again = (await decodeFigcraft(bytes)).document.libraryLinks;
  expect(again?.map(l => l.relative)).toEqual(["brand.figcraft", "stale.figcraft"]);
});
