import type { Document, DocumentNode, NodeId } from "./document";
import { ancestors, pageForNode } from "./hierarchy";
import { boundsOf, pageToScreen, type Viewport } from "./viewport";
import type { Ballots, BoardItem, BoardTimer, Vote, VoteRecord, VoteScope } from "./board-data";
import { timerMaxMs, voteHistoryMax, votesMax } from "./board-data";
import { textOf } from "./board-commands";
import { parseNodeId, parseNumber, parseString } from "./parameters";

/** Source: upstream engine/src/cmd/facilitate.rs and doc/src/facilitation.rs (#2226): a board's countdown and votes. Neither is an undo step. */
export const startMinutes = 5, addMinutes = 1, defaultVotes = 3, badgePx = 11, maxVoter = 64;
export const facilitateSpecs = Object.freeze({
  "board.timer": { label: "Timer", undo: false },
  "board.timerState": { label: "Timer state", undo: false },
  "board.vote": { label: "Voting session", undo: false },
  "board.voteResults": { label: "Voting results", undo: false },
});
export type FacilitateCommand = keyof typeof facilitateSpecs;
type Layer = DocumentNode & { board?: BoardItem };
const disabled = (cmd: string, why: string) => new Error("command `" + cmd + "` is not available right now: " + why);
const bad = (cmd: string, why: string) => new Error("invalid parameters for `" + cmd + "`: " + why);
const noNode = (id: NodeId) => new Error("no such node " + id);
const present = (p: Record<string, unknown>, k: string) => p[k] !== undefined && p[k] !== null;
/** Native `num`: lenient, finite, else none. */
const num = (v: unknown) => { if (v === undefined || v === null) return undefined; try { return parseNumber(v); } catch { return undefined; } };
/** Native `string`: strings, numbers and booleans as text. */
const str = (v: unknown) => v === null ? undefined : parseString(v);
const cmpId = (a: NodeId, b: NodeId) => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; };
/** Native `shown`: a value as JSON, cut at 40 characters. */
const shown = (v: unknown) => { const t = JSON.stringify(v) ?? String(v), c = [...t]; return c.length > 40 ? c.slice(0, 40).join("") + "…" : t; };

/** Native `BoardTimer::left`. */
export const timerLeft = (t: BoardTimer, now: number) => Math.min(t.state === "running" ? Math.max(t.ends - now, 0) : t.left, timerMaxMs);
/** Native `clock`: whole seconds rounded up, "4:05" or "1:02:03". */
export function clock(left: number): string {
  const s = Math.ceil(left / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60, two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
/** Native `timer_state`. */
export const timerState = (t: BoardTimer | undefined, now: number) => !t ? "off" : t.state === "paused" ? "paused" : timerLeft(t, now) === 0 ? "done" : "running";
export function timerJson(t: BoardTimer | undefined, now: number) {
  const left = t ? timerLeft(t, now) : 0;
  return { state: timerState(t, now), left, text: clock(left), ends: t?.state === "running" ? t.ends : null };
}
function duration(cmd: string, p: Record<string, unknown>, fallback: number): number {
  let m = fallback;
  if (present(p, "minutes")) { const v = num(p.minutes); if (v === undefined) throw bad(cmd, "`minutes` must be a number"); m = v; }
  const ms = Math.round(m * 60_000);
  if (!(ms >= 1000 && ms <= timerMaxMs)) throw bad(cmd, "`minutes` must be from 1 second to 1440 minutes");
  return ms;
}
/** Native `timer_after`: the timer after `action` at `now` (undefined: stopped). */
export function timerAfter(cmd: string, t: BoardTimer | undefined, action: string, p: Record<string, unknown>, now: number): BoardTimer | undefined {
  switch (action) {
    case "start": return { state: "running", ends: now + duration(cmd, p, startMinutes) };
    case "stop": return undefined;
    case "pause": if (t?.state === "running" && timerLeft(t, now) > 0) return { state: "paused", left: timerLeft(t, now) }; throw disabled(cmd, "the timer isn't running");
    case "resume": if (t?.state === "paused") return { state: "running", ends: now + t.left }; throw disabled(cmd, "the timer isn't paused");
    case "add": {
      const more = duration(cmd, p, addMinutes);
      if (!t) throw disabled(cmd, "there is no timer: start one");
      const left = Math.min(timerLeft(t, now) + more, timerMaxMs);
      return t.state === "paused" ? { state: "paused", left } : { state: "running", ends: now + left };
    }
    default: throw bad(cmd, `unknown action \`${action}\` (start|pause|resume|add|stop)`);
  }
}

/** Native `VoteScope::takes`. */
export function scopeTakes(scope: VoteScope, doc: Document, id: NodeId): boolean {
  const n = doc.nodes[id] as Layer | undefined;
  if (!n || n.kind === "page" || n.parent == null) return false;
  return scope.type === "all" || (scope.type === "stickies" ? n.board?.type === "sticky" : scope.ids.includes(id));
}
/** Native `VoteScope::target`: where a vote at layer `leaf` goes (`whole`: the object a click there picks). */
export function scopeTarget(scope: VoteScope, doc: Document, leaf: NodeId, whole: NodeId): NodeId | undefined {
  if (scope.type === "all") return scopeTakes(scope, doc, whole) ? whole : undefined;
  return [leaf, ...ancestors(doc, leaf)].find(id => scopeTakes(scope, doc, id));
}
/** Native `Vote::counted`. */
export const counted = (vote: Vote, doc: Document, ballot: readonly NodeId[]) => ballot.filter(id => doc.nodes[id]).slice(0, Math.min(vote.perPerson, votesMax));
/** Native `Vote::tally`: most first, ties by id. */
export function tally(vote: Vote, doc: Document, ballots: Ballots): [NodeId, number][] {
  const counts = new Map<NodeId, number>();
  for (const b of Object.values(ballots)) for (const id of counted(vote, doc, b)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || cmpId(a[0], b[0]));
}
/** Native `ranked`: ties share a rank ("1, 2, 2, 4"). */
export function ranked(vote: Vote, doc: Document, ballots: Ballots): [number, NodeId, number][] {
  let last: number | undefined, rank = 0;
  return tally(vote, doc, ballots).map(([id, n], i) => { if (last !== n) { rank = i + 1; last = n; } return [rank, id, n]; });
}
/** Native `mine`: `who`'s votes per object, in the order first voted on. */
export function mine(doc: Document, who: string): [NodeId, number][] {
  const vote = doc.vote, ballot = doc.votes?.[who];
  if (!vote || !ballot) return [];
  const out: [NodeId, number][] = [];
  for (const id of counted(vote, doc, ballot)) { const e = out.find(o => o[0] === id); if (e) e[1]++; else out.push([id, 1]); }
  return out;
}
/** Native `object_name`: its text (a sticky's note), else its name; first line, 60 characters. */
export function objectName(doc: Document, id: NodeId): string {
  const t = textOf(doc, id), tn = t ? doc.nodes[t] : undefined;
  const text = tn?.kind === "text" ? tn.text.characters.trim() : "";
  const name = text || doc.nodes[id]?.name || "";
  const short = [...(name.split("\n")[0] ?? "").replace(/\r$/, "")].slice(0, 60).join("");
  return short.length < name.length ? short + "…" : short;
}
/** Native `voters_of`, by ballot key order. */
export function votersOf(doc: Document, vote: Vote, ballots: Ballots, id: NodeId): [string, number][] {
  return Object.keys(ballots).sort(cmpKey).flatMap(who => { const n = counted(vote, doc, ballots[who]!).filter(v => v === id).length; return n ? [[who, n] as [string, number]] : []; });
}
/** BTreeMap<String,_> order: by UTF-8 bytes. */
export function cmpKey(a: string, b: string): number {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}
const sameVote = (a: Vote, b: Vote) => a.perPerson === b.perPerson && a.ended === b.ended && (a.by ?? "") === (b.by ?? "") && a.scope.type === b.scope.type
  && (a.scope.type !== "only" || b.scope.type === "only" && a.scope.ids.length === b.scope.ids.length && a.scope.ids.every((v, i) => (b.scope as { ids: readonly NodeId[] }).ids[i] === v));
export function sameBallots(a: Ballots | undefined, b: Ballots | undefined): boolean {
  const x = a ?? {}, y = b ?? {}, kx = Object.keys(x), ky = Object.keys(y);
  return kx.length === ky.length && kx.every(k => y[k] !== undefined && x[k]!.length === y[k]!.length && x[k]!.every((v, i) => y[k]![i] === v));
}
/** Native `on_board`: whether kept results are the ended vote on the board now. */
const onBoard = (doc: Document, r: VoteRecord) => !!doc.vote?.ended && sameVote(doc.vote, r.vote) && sameBallots(doc.votes, r.ballots);

/** What the facilitation commands need from the session. */
export interface FacilitateContext {
  readonly now: number;
  /** Who votes when `voter` is not given (native `voter`). */
  readonly me: string;
  /** Who starts a vote (native `board::author`). */
  readonly author: string;
  readonly selection: readonly NodeId[];
  /** Native `voter_name`: the name a "peer N" key goes by in the live session (undefined: not there). */
  readonly peerName?: (client: number) => string | undefined;
}
/** Native `voter`: `voter` from the params, trimmed of controls to 64 characters, else you. */
export function voterOf(p: Record<string, unknown>, me: string): string {
  const v = str(p.voter);
  if (v !== undefined) { const t = [...v.trim()].filter(c => !/\p{Cc}/u.test(c)).slice(0, maxVoter).join(""); if (t) return t; }
  return me;
}
export function voterName(key: string, ctx: FacilitateContext): string | undefined {
  const m = /^peer (\d+)$/.exec(key), client = m ? Number(m[1]) : NaN;
  if (!m || !(client <= 0xffffffff)) return key;
  return ctx.peerName?.(client);
}

interface Row { rank: number; id: NodeId; name: string; votes: number; voters: [string, string | undefined, number][] }
interface Session { index?: number; onBoard: boolean; ended: number; vote: Vote; rows: Row[] }
function resultRows(doc: Document, vote: Vote, ballots: Ballots, names: Readonly<Record<string, string>>, ctx: FacilitateContext): Row[] {
  const name = (k: string) => names[k] ?? voterName(k, ctx);
  return ranked(vote, doc, ballots).map(([rank, id, votes]) => ({ rank, id, name: objectName(doc, id), votes, voters: votersOf(doc, vote, ballots, id).map(([k, n]) => [k, name(k), n]) }));
}
/** Native `sessions`: every ended vote's results, newest first. */
export function voteSessions(doc: Document, ctx: FacilitateContext): Session[] {
  const out: Session[] = (doc.voteHistory ?? []).map((r, i) => ({ index: i, onBoard: onBoard(doc, r), ended: r.ended, vote: r.vote, rows: resultRows(doc, r.vote, r.ballots, r.names ?? {}, ctx) }));
  if (doc.vote?.ended && !out.some(x => x.onBoard)) out.push({ onBoard: true, ended: 0, vote: doc.vote, rows: resultRows(doc, doc.vote, doc.votes ?? {}, {}, ctx) });
  return out.reverse();
}
const numId = (id: NodeId) => Number(id);
const scopeJson = (s: VoteScope) => s.type === "only" ? { selection: s.ids.map(numId) } : s.type;
const rowsJson = (rows: readonly Row[]) => rows.map(r => ({ id: numId(r.id), name: r.name, votes: r.votes, rank: r.rank, voters: r.voters.map(([voter, name, votes]) => ({ voter, name: name ?? null, votes })) }));
/** Native `vote_json`. */
export function voteJson(doc: Document, who: string, ctx: FacilitateContext): Record<string, unknown> {
  const sessions = voteSessions(doc, ctx);
  const kept = sessions.map(x => ({ index: x.index ?? null, onBoard: x.onBoard, ended: x.ended, votesPerPerson: x.vote.perPerson, on: scopeJson(x.vote.scope), by: x.vote.by ?? "", results: rowsJson(x.rows) }));
  const vote = doc.vote;
  if (!vote) return { state: "off", sessions: kept };
  const m = mine(doc, who), used = m.reduce((t, x) => t + x[1], 0);
  const voters = Object.values(doc.votes ?? {}).filter(b => counted(vote, doc, b).length > 0).length;
  const out: Record<string, unknown> = { state: vote.ended ? "ended" : "running", votesPerPerson: vote.perPerson, on: scopeJson(vote.scope), by: vote.by ?? "",
    left: Math.max(vote.perPerson - used, 0), mine: m.map(([id, votes]) => ({ id: numId(id), votes })), voters, sessions: kept };
  const shown = vote.ended ? sessions.find(x => x.onBoard) : undefined;
  if (shown) out.results = rowsJson(shown.rows);
  return out;
}

type Facilitation = Pick<Document, "timer" | "vote" | "votes" | "voteHistory">;
function running(cmd: string, doc: Document): Vote {
  if (doc.vote && !doc.vote.ended) return doc.vote;
  throw disabled(cmd, "no vote is running");
}
function withBallot(votes: Ballots, who: string, ballot: readonly NodeId[]): Ballots {
  const out: Record<string, readonly NodeId[]> = { ...votes };
  if (ballot.length) out[who] = Object.freeze([...ballot]); else delete out[who];
  return Object.freeze(out);
}
/** Native `opt_index` within `0..=last`. */
function wholeIndex(cmd: string, v: unknown, last: number): number {
  if (v !== undefined && v !== null) {
    const k = num(v);
    if (k === undefined) throw bad(cmd, "`index` must be a number");
    if (!(k >= 0 && k < 1e9) || !Number.isInteger(k)) throw bad(cmd, "`index` out of range");
    if (k <= last) return k;
  }
  throw bad(cmd, `\`index\` is from 0 to ${last}`);
}
/** Native `vote_cmd`'s change to the document (the same document when nothing changes). */
function voteAfter(doc: Document, p: Record<string, unknown>, who: string, ctx: FacilitateContext): Facilitation | undefined {
  const cmd = "board.vote", action = str(p.action);
  if (action === undefined) throw bad(cmd, "`action` must be a string");
  switch (action) {
    case "start": {
      if (doc.vote && !doc.vote.ended) throw disabled(cmd, "a vote is already running: end it first");
      let per = defaultVotes;
      if (present(p, "votes")) { const v = num(p.votes); if (v === undefined || !Number.isInteger(v) || v < 1 || v > votesMax) throw bad(cmd, "`votes` must be a whole number from 1 to 99"); per = v; }
      const on = str(p.on) ?? "all";
      let scope: VoteScope;
      if (on === "all") scope = { type: "all" };
      else if (on === "stickies") scope = { type: "stickies" };
      else if (on === "selection") {
        const targets = reqTargets(cmd, doc, p, ctx.selection);
        const ids = targets.filter(i => scopeTakes({ type: "all" }, doc, i));
        if (!ids.length) throw bad(cmd, "pick the objects to vote on (not pages)");
        scope = { type: "only", ids: Object.freeze(ids) };
      } else throw bad(cmd, `unknown \`on\` \`${on}\` (all|stickies|selection)`);
      return { vote: Object.freeze({ perPerson: per, scope, ended: false, ...(ctx.author && { by: ctx.author }) }), votes: Object.freeze({}) };
    }
    case "cast": case "retract": {
      const target = p.id === null ? undefined : parseNodeId(p.id);
      if (target === undefined) throw bad(cmd, "`id` must be the object to vote on");
      const vote = running(cmd, doc), ballot = counted(vote, doc, doc.votes?.[who] ?? []);
      if (action === "cast") {
        if (!scopeTakes(vote.scope, doc, target)) throw doc.nodes[target] ? disabled(cmd, "this vote isn't on that object") : noNode(target);
        if (ballot.length >= vote.perPerson) throw disabled(cmd, "you have no votes left: remove one first");
        return { votes: withBallot(doc.votes ?? {}, who, [...ballot, target]) };
      }
      const i = ballot.lastIndexOf(target);
      if (i < 0) throw disabled(cmd, "you have no vote on that object");
      return { votes: withBallot(doc.votes ?? {}, who, ballot.filter((_, j) => j !== i)) };
    }
    case "end": {
      const vote = running(cmd, doc), ballots = doc.votes ?? {};
      const names: Record<string, string> = {};
      for (const k of Object.keys(ballots).sort(cmpKey)) { const n = voterName(k, ctx); if (n !== undefined && n !== k) names[k] = n; }
      const ended = Object.freeze({ ...vote, ended: true });
      const record: VoteRecord = Object.freeze({ vote: ended, ballots, ...(Object.keys(names).length && { names: Object.freeze(names) }), ended: ctx.now });
      return { vote: ended, voteHistory: Object.freeze([...(doc.voteHistory ?? []), record].slice(-voteHistoryMax)) };
    }
    case "clear":
      return doc.vote || Object.keys(doc.votes ?? {}).length ? { vote: undefined, votes: Object.freeze({}) } : undefined;
    case "delete": {
      const kept = doc.voteHistory ?? [];
      if (!kept.length) throw disabled(cmd, "no results are kept");
      const index = wholeIndex(cmd, p.index, kept.length - 1), shown = onBoard(doc, kept[index]!);
      return { voteHistory: Object.freeze(kept.filter((_, i) => i !== index)), ...(shown && { vote: undefined, votes: Object.freeze({}) }) };
    }
    default: throw bad(cmd, `unknown action \`${action}\` (start|cast|retract|end|clear|delete)`);
  }
}
/** Native `req_targets`: `ids`, else `id`, else the selection; a bad entry, nothing at all or a missing layer refused. */
function reqTargets(cmd: string, doc: Document, p: Record<string, unknown>, selection: readonly NodeId[]): NodeId[] {
  let t: NodeId[];
  if (Array.isArray(p.ids)) {
    const wrong = p.ids.find(v => parseNodeId(v) === undefined);
    if (wrong !== undefined) throw bad(cmd, `\`ids\`: every entry must be a node id (got ${shown(wrong)})`);
    t = p.ids.map(v => parseNodeId(v)!);
  } else if (p.ids === undefined || p.ids === null) {
    const one = present(p, "id") ? parseNodeId(p.id) : undefined;
    if (present(p, "id") && one === undefined) throw bad(cmd, `\`id\` must be a node id (got ${shown(p.id)})`);
    t = one !== undefined ? [one] : [...selection];
  } else throw bad(cmd, `\`ids\` must be an array (got ${shown(p.ids)})`);
  if (!t.length) throw disabled(cmd, "nothing is selected (pass `ids`)");
  const missing = t.find(i => !doc.nodes[i]);
  if (missing !== undefined) throw noNode(missing);
  return t;
}
const apply = (doc: Document, f: Facilitation | undefined): Document => {
  if (!f) return doc;
  const out: Record<string, unknown> = { ...doc, ...f };
  for (const k of Object.keys(f) as (keyof Facilitation)[]) if (f[k] === undefined) delete out[k];
  return Object.freeze(out) as unknown as Document;
};

/** Native `board.timer`, `board.timerState`, `board.vote` and `board.voteResults`. */
export function executeFacilitate(command: FacilitateCommand, doc: Document, p: Record<string, unknown>, ctx: FacilitateContext): { document: Document; result: Record<string, unknown> } {
  if (command === "board.timerState") return { document: doc, result: timerJson(doc.timer, ctx.now) };
  if (command === "board.voteResults") return { document: doc, result: voteJson(doc, voterOf(p, ctx.me), ctx) };
  if (command === "board.timer") {
    const action = str(p.action);
    if (action === undefined) throw bad(command, "`action` must be a string");
    const t = timerAfter(command, doc.timer, action, p, ctx.now);
    const same = t === undefined ? doc.timer === undefined : doc.timer !== undefined && JSON.stringify(t) === JSON.stringify(doc.timer);
    return { document: same ? doc : apply(doc, { timer: t ? Object.freeze(t) : undefined }), result: timerJson(t, ctx.now) };
  }
  const who = voterOf(p, ctx.me), next = apply(doc, voteAfter(doc, p, who, ctx));
  return { document: next, result: voteJson(next, who, ctx) };
}

/** Native `keep`: undo and redo leave the timer, the vote and the kept results as they are now (`from`). */
export function keepFacilitation(from: Document, to: Document): Document {
  if (from.timer === to.timer && from.vote === to.vote && from.votes === to.votes && from.voteHistory === to.voteHistory) return to;
  return apply(to, { timer: from.timer, vote: from.vote, votes: from.votes, voteHistory: from.voteHistory });
}
/** Native `badge`: where an object's vote badge sits (its top-right corner) and its radius in page units. */
export const badge = (b: { x: number; y: number; width: number }, zoom: number) => ({ x: b.x + b.width, y: b.y, r: badgePx / Math.max(zoom, 1e-6) });

/** Native `BRAND` and `ACCENT_ON`: a badge's fill and its number. */
export const badgeFill = "#02DA96", badgeInk = "#07352A";
/** Native canvas `badges`: while a vote runs your votes, once it ends everyone's, as numbered circles at objects' top-right corners. */
export function drawVoteBadges(context: CanvasRenderingContext2D, doc: Document, view: Viewport, me: string): void {
  const vote = doc.vote;
  if (doc.kind !== "board" || !vote) return;
  const counts = vote.ended ? tally(vote, doc, doc.votes ?? {}) : mine(doc, me);
  if (!counts.length) return;
  context.save();
  context.textAlign = "center"; context.textBaseline = "middle"; context.font = "600 11px sans-serif";
  for (const [id, n] of counts) {
    const b = pageForNode(doc, id) === doc.currentPage ? boundsOf(doc, [id]) : undefined;
    if (!b) continue;
    const at = badge(b, view.zoom), c = pageToScreen(view, at), r = badgePx;
    context.fillStyle = "rgba(0,0,0,0.157)"; context.beginPath(); context.arc(c.x, c.y + 1, r + 1, 0, Math.PI * 2); context.fill();
    context.fillStyle = badgeFill; context.beginPath(); context.arc(c.x, c.y, r, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#FFFFFF"; context.lineWidth = 1.5; context.stroke();
    context.fillStyle = badgeInk; context.fillText(String(n), c.x, c.y);
  }
  context.restore();
}
