import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserServerPreference } from "../../src/backends/browser/server-preference";

const defaultUrl = "wss://default.example/";
let values: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem">;

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("browser server preference", () => {
  it("persists only the address, reloads it, and isolates accounts", () => {
    browserServerPreference("account-a", defaultUrl).execute({ url: "wss://selected.example/" });
    expect([...values]).toEqual([["figcraft.publish-server.account-a", "wss://selected.example/"]]);
    expect(browserServerPreference("account-a", defaultUrl).getSnapshot().url).toBe("wss://selected.example/");
    expect(browserServerPreference("account-b", defaultUrl).getSnapshot().url).toBe(defaultUrl);
    browserServerPreference("account-b", defaultUrl).execute({ url: "ws://other.example/" });
    expect(browserServerPreference("account-a", defaultUrl).getSnapshot().url).toBe("wss://selected.example/");
  });

  it("distinguishes missing storage from off and restores the configured default", () => {
    expect(browserServerPreference("missing", defaultUrl).getSnapshot().url).toBe(defaultUrl);
    const preference = browserServerPreference("off", defaultUrl);
    preference.execute({ url: "" });
    expect(values.get("figcraft.publish-server.off")).toBe("");
    expect(browserServerPreference("off", defaultUrl).getSnapshot().url).toBe("");
    preference.execute({});
    expect(browserServerPreference("off", defaultUrl).getSnapshot().url).toBe(defaultUrl);
    expect(browserServerPreference("empty-default", "").getSnapshot().url).toBe("");
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it.each(["not a server", "{broken JSON", "https://host/", "wss://host/?key=secret"])(
    "uses the default for corrupt storage: %s", value => {
      values.set("figcraft.publish-server.corrupt", value);
      expect(browserServerPreference("corrupt", defaultUrl).getSnapshot().url).toBe(defaultUrl);
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it("remains usable with denied reads and writes, including off and account isolation", () => {
    vi.mocked(storage.getItem).mockImplementation(() => { throw new Error("read denied"); });
    vi.mocked(storage.setItem).mockImplementation(() => { throw new Error("write denied"); });
    const preference = browserServerPreference("denied-a", defaultUrl);
    expect(preference.getSnapshot().url).toBe(defaultUrl);
    preference.execute({ url: "" });
    expect(browserServerPreference("denied-a", defaultUrl).getSnapshot().url).toBe("");
    expect(browserServerPreference("denied-b", defaultUrl).getSnapshot().url).toBe(defaultUrl);
    preference.execute({ url: "wss://memory.example/" });
    expect(browserServerPreference("denied-a", defaultUrl).getSnapshot().url).toBe("wss://memory.example/");
    preference.execute({});
    expect(browserServerPreference("denied-a", defaultUrl).getSnapshot().url).toBe(defaultUrl);
  });

  it("keeps refused writes ahead of stale readable storage, then recovers persistence", () => {
    values.set("figcraft.publish-server.stale", "wss://old.example/");
    vi.mocked(storage.setItem).mockImplementationOnce(() => { throw new Error("quota exceeded"); });
    browserServerPreference("stale", defaultUrl).execute({ url: "" });
    const reloaded = browserServerPreference("stale", defaultUrl);
    expect(reloaded.getSnapshot().url).toBe("");
    reloaded.execute({ url: "wss://recovered.example/" });
    expect(values.get("figcraft.publish-server.stale")).toBe("wss://recovered.example/");
    values.set("figcraft.publish-server.stale", "wss://external.example/");
    expect(browserServerPreference("stale", defaultUrl).getSnapshot().url).toBe("wss://external.example/");
  });

  it("handles an unavailable localStorage global", () => {
    vi.stubGlobal("localStorage", undefined);
    const preference = browserServerPreference("unavailable", defaultUrl);
    expect(preference.getSnapshot().url).toBe(defaultUrl);
    expect(preference.execute({ url: "ws://memory.example/" }).url).toBe("ws://memory.example/");
    expect(browserServerPreference("unavailable", defaultUrl).getSnapshot().url).toBe("ws://memory.example/");
  });
});
