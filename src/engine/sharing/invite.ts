import { parseJoinCode } from "./join-code";

export interface InviteServer { host: string; path: string; secure: boolean }
export type SessionInvite =
  | { kind: "link"; server: InviteServer; file: string; token: string }
  | { kind: "team"; server: InviteServer; file: string }
  | { kind: "code"; server: InviteServer; code: string };

const notInvite = "that's not a live session invite: expected figcraft://join?host=…&file=…&token=… or ws://host:port/?file=…&token=…";
const badServer = "that's not a server address: expected ws://host:port/ or wss://host/";
const badHost = "the address's host isn't a host name or IP address with a port (like 192.168.1.20:47900)";
const clean = (value: string) => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "").replace(/^['"<>]+|['"<>]+$/g, "");
const tooLong = (input: string) => input.length > 2048 || new TextEncoder().encode(input).length > 2048;

function split(text: string, delimiter: string): [string, string] {
  const at = text.indexOf(delimiter);
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + delimiter.length)];
}

function pairs(query: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const [key, raw] = split(part, "=");
    let value: string;
    try { value = decodeURIComponent(raw.replaceAll("+", " ")); } catch { throw new Error("a broken %-escape"); }
    if (!result.has(key)) result.set(key, value);
  }
  return result;
}

function validHost(host: string) {
  const at = host.lastIndexOf(":");
  if (at < 0) return false;
  const name = host.slice(0, at), port = host.slice(at + 1);
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return false;
  if (name.startsWith("[")) {
    const address = /^\[([0-9a-f:.]+)(?:%(\d+))?\]$/i.exec(name);
    if (!address || (address[2] && Number(address[2]) > 0xffffffff)) return false;
    try { return Boolean(new URL("http://[" + address[1] + "]").hostname); } catch { return false; }
  }
  return /^[a-z0-9][a-z0-9.-]{0,252}$/i.test(name);
}

export function parseInviteServer(value: string) {
  const text = clean(value);
  const [scheme, rest] = split(text, "://");
  if (tooLong(text) || !/^wss?$/i.test(scheme) || !text.includes("://")) throw new Error(badServer);
  const secure = scheme.toLowerCase() === "wss";
  const [authorityPath, query] = split(rest, "?");
  const [authority, tail] = split(authorityPath, "/");
  const hasPort = authority.startsWith("[") ? authority.includes("]:") : authority.includes(":");
  const host = hasPort ? authority : authority + (secure ? ":443" : ":80");
  if (!validHost(host)) throw new Error(badHost);
  const path = "/" + tail;
  if (!/^\/[A-Za-z0-9/_.~-]*$/.test(path) || path.length > 256) throw new Error("the address's path has characters a server path can't have");
  return { server: { host, path: path.endsWith("/") ? path : path + "/", secure }, query: pairs(query) };
}

export function inviteEndpoint(server: InviteServer) {
  return (server.secure ? "wss://" : "ws://") + server.host + server.path;
}

export function nativeInviteLink(invite: Extract<SessionInvite, { kind: "link" }>) {
  const { server, file, token } = invite;
  const address = !server.secure && server.path === "/" ? "host=" + server.host : "server=" + inviteEndpoint(server);
  return "figcraft://join?" + address + "&file=" + file + "&token=" + token;
}

export function parseSessionInvite(value: string): SessionInvite {
  const text = clean(value);
  if (tooLong(text)) throw new Error(notInvite);
  const [scheme, rest] = split(text, "://");
  let server: InviteServer, query: Map<string, string>;
  if (scheme.toLowerCase() === "figcraft" && text.includes("://")) {
    const [action, raw] = split(rest, "?");
    if (action.replace(/\/+$/, "").toLowerCase() !== "join") throw new Error(notInvite);
    try { query = pairs(raw); } catch { throw new Error(notInvite); }
    if (query.has("server")) {
      try { server = parseInviteServer(query.get("server")!).server; }
      catch { throw new Error("the invite link's server isn't a ws:// or wss:// address"); }
    } else {
      const host = query.get("host") ?? "";
      if (!validHost(host)) throw new Error("the invite link's host isn't an address with a port (like 192.168.1.20:47900)");
      server = { host, path: "/", secure: false };
    }
  } else if (/^wss?$/i.test(scheme) && text.includes("://")) {
    try { ({ server, query } = parseInviteServer(text)); }
    catch (error) { throw error instanceof Error && error.message.includes("host") ? error : new Error(notInvite); }
  } else throw new Error(notInvite);
  if (query.has("code")) {
    try {
      const code = parseJoinCode(query.get("code")!);
      if (code.kind === "online") return { kind: "code", code: code.code, server };
    } catch { /* All invalid lookup codes have the same invite error. */ }
    throw new Error("the link's join code isn't one");
  }
  const file = query.get("file") ?? "";
  if (!/^[a-z0-9_-]{1,64}$/i.test(file)) throw new Error("the invite link has no valid file id");
  if (query.has("team")) return { kind: "team", server, file };
  const token = query.get("token") ?? "";
  if (!/^[a-z0-9_-]{16,128}$/i.test(token)) throw new Error("the invite link has no valid token");
  return { kind: "link", server, file, token };
}
