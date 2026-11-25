import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { clock, timerAfter, timerState } from "../../src/engine/board-facilitate";
import native from "../fixtures/native-board-facilitate.json" with { type: "json" };

// A board's timer and votes: native's tests restated from engine/src/facilitate_tests.rs, and a native run at bad07e44
// (tests/fixtures/native-board-facilitate.provenance.md). Times depend on the clock, so `ends` and `ended` are compared by what they mean.
const MIN = 60_000, none = {};
type Json = Record<string, unknown>;
/** Drop the clock's readings (`ends`, `ended`) from a receipt. */
const timeless = (v: unknown): unknown => Array.isArray(v) ? v.map(timeless) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "ends" && k !== "ended").map(([k, x]) => [k, timeless(x)])) : v;

describe("the timer, as native's tests pin it", () => {
  it("counts from its end time", () => {
    const now = 1_000_000;
    const t = timerAfter("t", undefined, "start", { minutes: 2 }, now);
    expect(t).toEqual({ state: "running", ends: now + 2 * MIN });
    expect(timerState(t, now + MIN)).toBe("running");
    expect(timerState(t, now + 3 * MIN)).toBe("done");
    let p = timerAfter("t", t, "pause", none, now + MIN);
    expect(p).toEqual({ state: "paused", left: MIN });
    p = timerAfter("t", p, "add", none, now + 5 * MIN);
    expect(p).toEqual({ state: "paused", left: 2 * MIN });
    let r = timerAfter("t", p, "resume", none, now + 10 * MIN);
    expect(r).toEqual({ state: "running", ends: now + 12 * MIN });
    r = timerAfter("t", r, "add", { minutes: 0.5 }, now + 20 * MIN);
    expect(r).toEqual({ state: "running", ends: now + 20 * MIN + MIN / 2 });
    expect(timerAfter("t", r, "stop", none, now)).toBeUndefined();
    expect(() => timerAfter("t", undefined, "pause", none, now)).toThrow();
    expect(() => timerAfter("t", undefined, "add", none, now)).toThrow();
    expect(() => timerAfter("t", r, "resume", none, now)).toThrow();
    expect(() => timerAfter("t", { state: "running", ends: now }, "pause", none, now)).toThrow();
    for (const m of [0, -1, 1441, "NaN", 1e308, "x", [1]]) expect(() => timerAfter("t", undefined, "start", { minutes: m }, now), String(m)).toThrow();
    const long = timerAfter("t", undefined, "start", { minutes: 1440 }, now);
    expect(timerAfter("t", long, "add", none, now)).toEqual({ state: "running", ends: now + 1440 * MIN });
  });
  it("reads minutes and seconds", () => {
    expect([clock(0), clock(1), clock(5 * MIN), clock(65_000), clock(3_723_000)]).toEqual(["0:00", "0:01", "5:00", "1:05", "1:02:03"]);
  });
});

describe("facilitation, as native runs it", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(1_795_585_000_000); });
  afterEach(() => { vi.useRealTimers(); });
  it("replays native's run: receipts, refusals and the kept results", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const cs = native.commands as unknown as [string, Json][], rs = native.results as unknown as ({ receipt: Json } | { error: string })[];
    for (const [i, [c, p]] of cs.slice(1, -1).entries()) {
      const want = rs[i + 1]!;
      if ("error" in want) { await expect(e.executeAsync(c, p), `${c} ${JSON.stringify(p)}`).rejects.toThrow(want.error); continue; }
      const got = await e.executeAsync(c, p);
      // The port's select.set reports ids as text (native: numbers), a difference kept on the deferred queue.
      if (c === "select.set") { expect((got.selection as string[]).map(Number)).toEqual(want.receipt.selection); continue; }
      expect(timeless(got), `${i + 1} ${c} ${JSON.stringify(p)}`).toEqual(timeless(want.receipt));
      if (typeof got.ends === "number") expect(got.ends - Date.now()).toBe(got.left);
    }
    const doc = e.getSnapshot().document;
    expect([doc.timer, doc.vote, doc.votes && Object.keys(doc.votes).length ? doc.votes : undefined]).toEqual([undefined, undefined, undefined]);
    const kept = (native.document as unknown as { vote_history: Json[] }).vote_history;
    expect(doc.voteHistory?.map(r => ({ perPerson: r.vote.perPerson, scope: r.vote.scope.type, ballots: r.ballots }))).toEqual(kept.map(r => {
      const v = r.vote as Json, s = v.scope as Json;
      return { perPerson: v.perPerson, scope: s.type, ballots: Object.fromEntries(Object.entries(r.ballots as Json).map(([k, b]) => [k, (b as number[]).map(String)])) };
    }));
    expect(e.getUndoDepth(), "only the four objects and the deletion are undo steps").toBe(5);
  });
  it("leaves the timer and the vote alone on undo and redo", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const a = (await e.executeAsync("board.sticky", { x: 0, y: 0, text: "A" })).id as number;
    await e.executeAsync("board.timer", { action: "start" });
    await e.executeAsync("board.vote", { action: "start" });
    await e.executeAsync("board.vote", { action: "cast", id: a });
    await e.executeAsync("board.sticky", { x: 300, y: 0, text: "B" });
    e.execute("edit.undo"); e.execute("edit.undo");
    let doc = e.getSnapshot().document;
    expect(Object.keys(doc.nodes).some(id => doc.nodes[id]?.name === "A")).toBe(false);
    expect([!!doc.timer, !!doc.vote, Object.keys(doc.votes ?? {}).length]).toEqual([true, true, 1]);
    await e.executeAsync("board.timer", { action: "stop" });
    e.execute("edit.redo");
    doc = e.getSnapshot().document;
    expect(doc.timer).toBeUndefined();
    expect(doc.nodes[String(a)]).toBeDefined();
  });
  it("is for boards only", async () => {
    const e = EditorEngine.newTab();
    for (const [c, p] of [["board.timer", { action: "start" }], ["board.timerState", {}], ["board.vote", { action: "start" }], ["board.voteResults", {}]] as const)
      await expect(e.executeAsync(c, p), c).rejects.toThrow("this is for boards");
  });
  it("shares ranks between ties", async () => {
    const e = EditorEngine.newTab(undefined, {}, "board");
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push((await e.executeAsync("board.sticky", { x: i * 300, y: 0, text: "x" })).id as number);
    await e.executeAsync("board.vote", { action: "start", votes: 2 });
    for (const [who, on] of [["a", 0], ["a", 1], ["b", 1], ["b", 0], ["c", 2], ["c", 3], ["d", 2]] as const) await e.executeAsync("board.vote", { action: "cast", id: ids[on], voter: who });
    const r = await e.executeAsync("board.vote", { action: "end" });
    expect((r.results as { rank: number }[]).map(x => x.rank)).toEqual([1, 1, 1, 4]);
  });
  it("survives junk and keeps voter names short", async () => {
    const junk: unknown[] = [{}, null, [1], { action: 5, minutes: "NaN", votes: -1, on: [1], id: "x", voter: { a: 1 } }, { action: "start", minutes: 1e308, votes: 1e308, on: "selection", ids: ["x", -1] },
      { action: "add", minutes: -1e308 }, { action: "cast", id: 99_999, voter: "\u0000\u0007" }, { action: "retract", id: -1, voter: "x".repeat(10_000) }, { action: "end" },
      { action: "clear", ids: 7 }, { action: "resume", minutes: [1] }, { action: "delete" }, { action: "delete", index: -1 }, { action: "delete", index: 1e308 }, { action: "delete", index: "0" }, { action: "delete", index: 0 },
      { action: "cast", id: 2, voter: "y".repeat(100) }];
    for (const c of ["board.timer", "board.timerState", "board.vote", "board.voteResults"]) for (const j of junk) {
      const e = EditorEngine.newTab(undefined, {}, "board");
      const a = (await e.executeAsync("board.sticky", { x: 0, y: 0, text: "A" })).id;
      await e.executeAsync("board.timer", { action: "start" });
      await e.executeAsync("board.vote", { action: "start" });
      await e.executeAsync("board.vote", { action: "cast", id: a });
      await e.executeAsync(c, j).catch((err: Error) => expect(err.message).not.toMatch(/internal error|TypeError|undefined/));
      expect(Object.keys(e.getSnapshot().document.votes ?? {}).every(k => [...k].length <= 64)).toBe(true);
    }
  });
});
