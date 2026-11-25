import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { NodeId } from "../../src/engine/document";
import { PrototypePlayer } from "../../src/engine/prototype-player";
import { PresenterInput } from "../../src/engine/prototype-input";
import { presentedScreen } from "../../src/engine/prototype-screen";
import { goesToWebsite } from "../../src/engine/prototype-links";

// Restated from native ui-egui/src/present_links_tests.rs at bad07e44 (#1096): every openable link waits behind a notice that it leaves the
// prototype; skipping the notice opens at once only a link the viewer's own click, press, drag or key fired, one per frame. Each frame here
// ticks the input controller and then finishes the links, as the presenter does.
const id = (v: unknown) => String((v as { id: unknown }).id);
const none = { ctrl: false, alt: false, shift: false, cmd: false };
class Harness {
  time = 0;
  readonly input: PresenterInput;
  readonly opened: string[] = [];
  constructor(readonly p: PrototypePlayer, public skipped: boolean) { this.input = new PresenterInput(p); }
  get screen() { return presentedScreen(this.p)!; }
  get notice() { return this.p.linkNotice?.url; }
  readonly #open = (url: string, newTab: boolean) => { this.opened.push(newTab ? url : `here ${url}`); };
  #after() { this.input.tick(this.screen, this.time); this.input.finish(this.skipped, this.#open); }
  frame() { this.time += 1 / 60; this.#after(); }
  frames(n: number) { for (let i = 0; i < n; i++) this.frame(); }
  move(x: number, y: number) { this.time += 1 / 60; this.input.move(this.screen, { x, y }, false, this.time); this.#after(); }
  button(x: number, y: number, pressed: boolean) {
    this.time += 1 / 60;
    if (pressed) this.input.down(this.screen, { x, y }, this.time); else this.input.up(this.screen, { x, y }, this.time);
    this.#after();
  }
  key(name: string) { this.time += 1 / 60; this.input.key(this.screen, name, none, this.time); this.#after(); }
  click() { this.button(150, 200, true); this.button(150, 200, false); this.frames(3); }
  answer(go: boolean) { if (this.input.answerNotice(go, this.#open)) this.skipped = true; }
}
const frameA = (e: EditorEngine) => id(e.execute("frame.create", { x: 0, y: 0, width: 300, height: 400, name: "A" }));
const present = (e: EditorEngine, start: NodeId, skipped: boolean) => {
  const p = new PrototypePlayer(start);
  p.sync(e.getSnapshot().document, 0);
  const u = new Harness(p, skipped);
  u.frames(2);
  return u;
};
/** Frame A presented with the notice skipped or not, its interaction opening each of `urls`. */
function playing(skipped: boolean, interaction: Record<string, unknown>, urls: string[]) {
  const e = new EditorEngine(), a = frameA(e);
  e.execute("proto.interaction.add", { ...interaction, id: Number(a), actions: urls.map(url => ({ type: "openUrl", url })), transition: { type: "instant" } });
  return present(e, a, skipped);
}
/** A frame that opens `url` 100 ms after it shows, no click anywhere. */
const presented = (url: string, skipped: boolean) => { const u = playing(skipped, { trigger: { type: "afterDelay", ms: 100 } }, [url]); u.frames(40); return u; };
const opensOnAClick = (url: string) => { const u = playing(true, { trigger: { type: "onClick" } }, [url]); u.click(); return u.opened; };

describe("links a prototype opens, as native's tests pin them", () => {
  it("opens web and mail links the viewer clicks with the notice skipped, else waits behind it", () => {
    expect(opensOnAClick("https://example.com/a")).toEqual(["https://example.com/a"]);
    expect(opensOnAClick("mailto:a@b.c")).toEqual(["mailto:a@b.c"]);
    const u = presented("mailto:a@b.c", false);
    expect(u.opened).toEqual([]);
    expect(u.notice).toBe("mailto:a@b.c");
    u.answer(true);
    expect(u.opened).toEqual(["mailto:a@b.c"]);
    expect(u.notice).toBeUndefined();
  });
  it("still shows a skipped notice for a link no click fired, without the checkbox", () => {
    for (const url of ["https://example.com/a", "mailto:a@b.c"]) {
      const u = presented(url, true);
      expect(u.opened).toEqual([]);
      expect(u.notice).toBe(url);
      expect(u.p.linkNotice!.skip).toBeUndefined();
      u.answer(true);
      expect(u.opened).toEqual([url]);
    }
  });
  it("offers to skip the notice for a clicked link", () => {
    const u = playing(false, { trigger: { type: "onClick" } }, ["https://example.com/a"]);
    u.click();
    expect(u.notice).toBe("https://example.com/a");
    expect(u.p.linkNotice!.skip).toBe(false);
  });
  it("opens one link per click with the notice skipped", () => {
    const u = playing(true, { trigger: { type: "onClick" } }, ["https://example.com/1", "https://example.com/2", "mailto:a@b.c"]);
    u.click();
    expect(u.opened).toEqual(["https://example.com/1"]);
    expect(u.notice).toBe("https://example.com/2");
  });
  it("keeps a link the pointer fires by passing behind the notice", () => {
    const u = playing(true, { trigger: { type: "mouseEnter" } }, ["https://example.com/hover"]);
    u.move(150, 200); u.frames(3);
    expect(u.opened).toEqual([]);
    expect(u.notice).toBe("https://example.com/hover");
  });
  it("does not pile up delayed opens unattended", () => {
    const e = new EditorEngine(), a = frameA(e);
    for (const ms of [100, 200, 300]) {
      const layer = id(e.execute("shape.rectangle", { x: 10, y: 10, width: 30, height: 30, parent: Number(a) }));
      e.execute("proto.interaction.add", { id: Number(layer), trigger: { type: "afterDelay", ms }, action: { type: "openUrl", url: `mailto:victim@example.com?subject=spam${ms}` } });
    }
    const u = present(e, a, true);
    u.frames(40);
    expect(u.opened).toEqual([]);
    expect(u.notice).toBe("mailto:victim@example.com?subject=spam100");
    u.answer(true);
    expect(u.opened).toEqual(["mailto:victim@example.com?subject=spam100"]);
  });
  it("keeps a clicked mail link behind the notice", () => {
    const u = playing(false, { trigger: { type: "onClick" } }, ["mailto:a@b.c?subject=hello"]);
    u.click();
    expect(u.opened).toEqual([]);
    expect(u.notice).toBe("mailto:a@b.c?subject=hello");
    u.answer(true);
    expect(u.opened).toEqual(["mailto:a@b.c?subject=hello"]);
  });
  it("keeps a link a click queued to fire later behind the notice", () => {
    for (const skip of [false, true]) {
      const u = playing(skip, { trigger: { type: "mouseUp" }, delayMs: 150 }, ["https://example.com/late"]);
      u.click(); u.frames(20);
      expect(u.opened, `skip ${skip}`).toEqual([]);
      expect(u.notice).toBe("https://example.com/late");
    }
  });
  it("opens a link a key fires with the notice skipped, else waits", () => {
    for (const skip of [false, true]) {
      const u = playing(skip, { trigger: { type: "keyPress", key: "K" } }, ["https://example.com/keyed"]);
      u.key("K"); u.frames(3);
      if (skip) expect(u.opened).toEqual(["https://example.com/keyed"]);
      else { expect(u.opened).toEqual([]); expect(u.notice).toBe("https://example.com/keyed"); }
    }
  });
  it("drops the link on Cancel, and shows the notice again next time", () => {
    const u = presented("https://example.com/a", false);
    u.answer(false);
    expect(u.notice).toBeUndefined();
    expect(u.opened).toEqual([]);
    expect(u.skipped).toBe(false);
  });
  it("takes no keys or clicks while the notice shows", () => {
    const e = new EditorEngine(), a = frameA(e);
    const b = id(e.execute("frame.create", { x: 400, y: 0, width: 300, height: 400, name: "B" }));
    const layer = id(e.execute("shape.rectangle", { x: 10, y: 10, width: 30, height: 30, parent: Number(a) }));
    e.execute("proto.interaction.add", { id: Number(layer), trigger: { type: "afterDelay", ms: 100 }, action: { type: "openUrl", url: "https://example.com/a" } });
    e.execute("proto.interaction.add", { id: Number(a), trigger: { type: "keyPress", key: "Escape" }, action: { type: "navigate", dest: Number(b) } });
    e.execute("proto.interaction.add", { id: Number(a), trigger: { type: "onClick" }, action: { type: "navigate", dest: Number(b) }, transition: { type: "instant" } });
    const u = present(e, a, false);
    u.frames(40);
    expect(u.notice).toBe("https://example.com/a");
    u.key("Escape");
    u.click();
    expect(u.p.current).toBe(a);
    expect(u.notice).toBe("https://example.com/a");
    u.answer(false);
    u.click();
    expect(u.p.current).toBe(b);
  });
  it("saves Don't show this again with Open link", () => {
    const u = playing(false, { trigger: { type: "onClick" } }, ["https://example.com/a"]);
    u.click();
    u.p.linkNotice!.skip = true;
    u.answer(true);
    expect(u.opened).toEqual(["https://example.com/a"]);
    expect(u.skipped).toBe(true);
  });
  it("never opens a script or handler URL", () => {
    for (const url of ["javascript:alert(document.cookie)", "JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd",
      "smb://attacker.example/share/x", "ms-msdt:/id PCWDiagnostic", "figcraft://join?host=127.0.0.1:47900&file=f&token=t"])
      expect(opensOnAClick(url), url).toEqual([]);
    expect(goesToWebsite("HTTPS://example.com")).toBe(true);
    expect(goesToWebsite("mailto:a@b.c")).toBe(false);
  });
  it("opens nothing while a notice shows with the notice skipped, and a press that raised one does not release behind it", () => {
    const open = (url: string) => ({ type: "openUrl", url });
    const e = new EditorEngine(), a = frameA(e);
    const b = id(e.execute("frame.create", { x: 400, y: 0, width: 300, height: 400, name: "B" }));
    e.execute("proto.interaction.add", { id: Number(a), trigger: { type: "mouseDown" }, actions: [open("https://example.com/1"), open("https://example.com/2")], transition: { type: "instant" } });
    e.execute("proto.interaction.add", { id: Number(a), trigger: { type: "mouseUp" }, actions: [open("https://example.com/3"), { type: "navigate", dest: Number(b) }], transition: { type: "instant" } });
    const u = present(e, a, true);
    u.button(150, 200, true); u.frames(2);
    expect(u.opened).toEqual(["https://example.com/1"]);
    expect(u.notice).toBe("https://example.com/2");
    u.button(150, 200, false); u.frames(3);
    expect(u.opened).toEqual(["https://example.com/1"]);
    expect(u.notice).toBe("https://example.com/2");
    expect(u.p.current).toBe(a);
  });
  it("opens a link in place when Open in new tab is off, through the notice or with it skipped", () => {
    for (const skip of [true, false]) {
      const e = new EditorEngine(), a = frameA(e);
      e.execute("proto.interaction.add", { id: Number(a), trigger: { type: "onClick" }, actions: [{ type: "openUrl", url: "https://example.com/a", openInNewTab: false }], transition: { type: "instant" } });
      const u = present(e, a, skip);
      u.click();
      if (!skip) u.answer(true);
      expect(u.opened, `skip ${skip}`).toEqual(["here https://example.com/a"]);
    }
    expect(opensOnAClick("https://example.com/b")).toEqual(["https://example.com/b"]);
  });
});
