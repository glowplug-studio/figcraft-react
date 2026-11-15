import { describe, expect, it, vi } from "vitest";
import { OnlineServerPreference, ONLINE_SHARING_OFF, resolveOnlineJoinTarget } from "../../src/engine/sharing/server-preference";

// Source contract: original/figcraft/crates/engine/src/cmd/view.rs pref.publishServer,
// prefs.rs publish_server and sharing/live/types.rs DEFAULT_SERVER / join_target.
// Native automation/params.rs::get filters null, making it equivalent to omission.
// Fixtures below are independent: no test imports or executes the Rust reference.
const defaultUrl = "wss://default.example/";

describe("saved online server preference", () => {
  it("uses the configured default, preserves explicit off, and restores defaults", () => {
    const preference = new OnlineServerPreference(defaultUrl);
    expect(preference.getSnapshot()).toEqual({ url: defaultUrl, default: defaultUrl });
    expect(preference.execute({ url: "" })).toEqual({ url: "", default: defaultUrl });
    expect(preference.execute({})).toEqual({ url: defaultUrl, default: defaultUrl });
    preference.execute({ url: "wss://other.example/" });
    expect(preference.execute({ url: null }).url).toBe(defaultUrl);
    expect(new OnlineServerPreference("", "wss://saved.example/").execute({}).url).toBe("");
    expect(new OnlineServerPreference("").getSnapshot()).toEqual({ url: "", default: "" });
    expect(new OnlineServerPreference(defaultUrl, "").getSnapshot().url).toBe("");
  });

  it("reloads valid saved choices and discards invalid legacy values", () => {
    const save = vi.fn();
    const preference = new OnlineServerPreference(defaultUrl, undefined, save);
    preference.execute({ url: " \u0085wss://Saved.example/Path\u3000" });
    expect(save).toHaveBeenCalledExactlyOnceWith("wss://Saved.example/Path");
    expect(new OnlineServerPreference(defaultUrl, save.mock.calls[0]![0] as string).getSnapshot().url).toBe("wss://Saved.example/Path");
    expect(new OnlineServerPreference(defaultUrl, "https://invalid.example/").getSnapshot().url).toBe(defaultUrl);
    expect(new OnlineServerPreference(defaultUrl, "wss://host/?key=secret").getSnapshot().url).toBe(defaultUrl);
  });

  it.each(["ws://", "wss://", "ws://not a host".replaceAll(" ", ""), "wss://host/@:;", "wss://host/\uFEFF"])(
    "uses native command checks rather than strict URL parsing: %s", url => {
      expect(new OnlineServerPreference(defaultUrl).execute({ url }).url).toBe(url);
    },
  );

  it.each(["WSS://host/", "https://host/", "wss://a b/", "wss://a\u0085b/", "wss://a\u3000b/", "wss://a\u0000b/", "wss://a\u007Fb/", "wss://a\u009Fb/", "wss://host/?key=x", "wss://host/#x", "\uFEFFwss://host/"])(
    "refuses invalid addresses without saving or notifying: %s", url => {
      const save = vi.fn(), listener = vi.fn();
      const preference = new OnlineServerPreference(defaultUrl, undefined, save);
      const before = preference.getSnapshot();
      preference.subscribe(listener);
      expect(() => preference.execute({ url })).toThrow("the server's address is");
      expect(preference.getSnapshot()).toBe(before);
      expect(save).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it.each([42, false, [], {}, ["wss://host/"]])("refuses malformed parameters: %j", url => {
    const preference = new OnlineServerPreference(defaultUrl);
    const before = preference.getSnapshot();
    expect(() => preference.execute({ url })).toThrow();
    expect(preference.getSnapshot()).toBe(before);
  });

  it("enforces 500 UTF-8 bytes, including supplementary Unicode scalars", () => {
    const preference = new OnlineServerPreference(defaultUrl);
    for (const suffix of ["a".repeat(494), "é".repeat(247), "😀".repeat(123) + "aa"]) {
      const url = "wss://" + suffix;
      expect(new TextEncoder().encode(url)).toHaveLength(500);
      expect(preference.execute({ url }).url).toBe(url);
      expect(() => preference.execute({ url: url + "a" })).toThrow();
      expect(preference.getSnapshot().url).toBe(url);
    }
  });

  it("provides immutable stable snapshots and removable listeners", () => {
    const save = vi.fn(), listener = vi.fn();
    const preference = new OnlineServerPreference(defaultUrl, undefined, save);
    const { getSnapshot, subscribe } = preference;
    const before = getSnapshot(), unsubscribe = subscribe(listener);
    expect(getSnapshot()).toBe(before);
    expect(Object.isFrozen(before)).toBe(true);
    expect(preference.execute({ url: defaultUrl })).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    const after = preference.execute({ url: "" });
    expect(after).not.toBe(before);
    expect(listener).toHaveBeenCalledOnce();
    expect(getSnapshot()).toBe(after);
    unsubscribe();
    preference.execute({});
    expect(listener).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("keeps a usable in-memory choice when browser persistence fails", () => {
    const preference = new OnlineServerPreference(defaultUrl, undefined, () => { throw new Error("storage denied"); });
    const listener = vi.fn();
    preference.subscribe(listener);
    expect(preference.execute({ url: "" }).url).toBe("");
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("join target preference", () => {
  it("resolves normalised online codes against the current server", () => {
    const preference = new OnlineServerPreference(defaultUrl);
    expect(resolveOnlineJoinTarget(" \u0085k7m_2qx.9td\u3000", preference)).toBe("figcraft://join?server=wss://default.example/&code=K7M2QX9TD");
    preference.execute({ url: "ws://other.example/path/" });
    expect(resolveOnlineJoinTarget("K7M-2QX-9TD", preference)).toBe("figcraft://join?server=ws://other.example/path/&code=K7M2QX9TD");
  });

  it("preserves explicit links and local codes while online sharing is off", () => {
    const preference = new OnlineServerPreference(defaultUrl, "");
    for (const link of ["figcraft://join?server=wss://other.example/&code=K7M2QX9TD", "ws://host/?file=x&token=y", "arbitrary?explicit", "arbitrary://explicit"]) {
      expect(resolveOnlineJoinTarget("\u0085 " + link + " \u3000", preference)).toBe(link);
    }
    expect(resolveOnlineJoinTarget("r2m02-50fs0-00000-0005h", preference)).toBe("figcraft://join?host=192.168.1.20:4040&file=local&token=local-00000000000");
    expect(() => resolveOnlineJoinTarget("K7M2QX9TD", preference)).toThrow("that is an online join code, and " + ONLINE_SHARING_OFF);
    // Browser substitution: do not suggest unavailable native LAN hosting.
    expect(ONLINE_SHARING_OFF).toBe("Online sharing is off: choose a server in Preferences");
    expect(() => resolveOnlineJoinTarget("", preference)).toThrow("type the join code you were given");
    expect(() => resolveOnlineJoinTarget("K7M2QU9TD", preference)).toThrow("only letters and digits");
  });
});
