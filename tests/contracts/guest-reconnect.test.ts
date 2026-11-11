import {afterEach, expect, it, vi} from "vitest";
import {IndexedDbRecoveryStore} from "../../src/backends/browser/recovery";
import type {GuestSessionEnd} from "../../src/backends/online-files";
import {BrowserInvitations, guestReconnectDelay} from "../../examples/nextjs/lib/sharing/browser-invites";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses the pinned native twelve-attempt rounds, including the minute between rounds", () => {
  expect(Array.from({length: 15}, (_, i) => guestReconnectDelay(i + 1))).toEqual([
    500, 1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 60000, 1000, 2000,
  ]);
  expect(guestReconnectDelay(25)).toBe(60000);
});

it("releases a late reconnect grant when its logical tab has already left", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", {hash: ""});
  let assignment = "";
  let disconnect: ((reason: GuestSessionEnd) => void) | undefined;
  let resolveJoin: ((value: Response) => void) | undefined;
  const physical: string[] = [], released: string[] = [], resumes: string[] = [];
  let finished!: () => void;
  const releasedBoth = new Promise<void>(resolve => { finished = resolve; });
  const welcome = () => new Response(new Blob(["archive"]), {headers: {"X-Figcraft-Access": "view", "X-Figcraft-Client": "42"}});
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/leave")) {
      released.push(body.connection);
      if (released.length === 2) finished();
      return new Response(null, {status: 204});
    }
    physical.push(body.tab);
    resumes.push(body.resume);
    if (physical.length === 1) return welcome();
    return new Promise<Response>(resolve => { resolveJoin = resolve; });
  });
  const host = new BrowserInvitations(new IndexedDbRecoveryStore(), "guest", "http://files.example",
    (_, ended) => { disconnect = ended; return () => {}; }, () => {}, () => {});
  const unsub = host.subscribe(async session => { assignment = session.connection; });
  await host.join("ws://files.example/?file=drawing&token=abcdefghijklmnop");
  const changed = vi.fn(), ended = vi.fn();
  const stop = host.watch(assignment, ended, changed);
  disconnect!("unavailable");
  expect(changed).toHaveBeenCalledWith({attempt: 1});
  host.retryNow(assignment);
  expect(physical).toHaveLength(2);
  expect(physical[0]).not.toBe(physical[1]);
  expect(resumes[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(resumes[1]).toBe(resumes[0]);
  expect(physical).not.toContain(resumes[0]);
  await host.leave(assignment);
  stop();
  resolveJoin!(welcome());
  await releasedBoth;
  await vi.advanceTimersByTimeAsync(100_000);
  expect(released.sort()).toEqual(physical.sort());
  expect(changed).toHaveBeenCalledTimes(1);
  expect(ended).not.toHaveBeenCalled();
  unsub();
});
