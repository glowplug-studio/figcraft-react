import { inverse, transformPoint } from "./affine";
import type { Document } from "./document";
import { ancestors, pageForNode, worldTransform } from "./hierarchy";
import { fail, id, number, wireId } from "./native-values";

export interface CommentMessage {
  readonly author: string;
  readonly text: string;
  readonly created: string;
  readonly edited: string;
  readonly agent: boolean;
  readonly reactions: readonly { readonly emoji: string; readonly users: readonly string[] }[];
}

export interface CommentThread extends CommentMessage {
  readonly id: string;
  readonly page: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: string | null;
  readonly resolved: boolean;
  readonly replies: readonly CommentMessage[];
  readonly readBy?: readonly string[];
}

const messageFields = ["author", "text", "created", "edited", "agent", "reactions"];
const threadFields = [...messageFields, "id", "page", "x", "y", "anchor", "resolved", "replies", "read_by"];

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("comment must be an object");
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail("comment/" + key + " is not supported yet");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") fail("comment text must be a string");
  return value;
}

function list<T>(value: unknown, read: (item: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) fail("comment list must be an array");
  return Object.freeze(value.map(read));
}

function flag(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail("invalid comment flag");
  return value;
}

function message(m: Record<string, unknown>): CommentMessage {
  return Object.freeze({
    author: text(m.author), text: text(m.text), agent: flag(m.agent),
    created: m.created === undefined ? "0" : id(m.created, "comment.created"),
    edited: m.edited === undefined ? "0" : id(m.edited, "comment.edited"),
    reactions: list(m.reactions === undefined ? [] : m.reactions, item => {
      const reaction = record(item, ["emoji", "users"]);
      return Object.freeze({ emoji: text(reaction.emoji), users: list(reaction.users, text) });
    }),
  });
}

export function readComments(value: unknown): readonly CommentThread[] | undefined {
  if (value === undefined) return;
  const comments = list(value, item => {
    const c = record(item, threadFields);
    return Object.freeze({
      ...message(c), id: id(c.id, "comment.id"), page: id(c.page, "comment.page"),
      x: number(c.x, "comment.x"), y: number(c.y, "comment.y"),
      anchor: c.anchor == null ? null : id(c.anchor, "comment.anchor"), resolved: flag(c.resolved),
      replies: list(c.replies === undefined ? [] : c.replies, reply => message(record(reply, messageFields))),
      ...(c.read_by != null && { readBy: list(c.read_by, text) }),
    });
  });
  return comments.length ? comments : undefined;
}

function wireMessage(m: CommentMessage) {
  return {
    author: m.author, text: m.text, created: wireId(m.created),
    ...(m.edited !== "0" && { edited: wireId(m.edited) }),
    ...(m.reactions.length > 0 && { reactions: m.reactions }), ...(m.agent && { agent: true }),
  };
}

export function wireComment(c: CommentThread) {
  return {
    id: wireId(c.id), page: wireId(c.page), x: c.x, y: c.y, anchor: c.anchor === null ? null : wireId(c.anchor),
    ...wireMessage(c), resolved: c.resolved, replies: c.replies.map(wireMessage), ...(c.readBy && { read_by: c.readBy }),
  };
}

export function commentPosition(doc: Document, comment: CommentThread) {
  return comment.anchor && doc.nodes[comment.anchor]
    ? transformPoint(worldTransform(doc, comment.anchor), comment) : { x: comment.x, y: comment.y };
}

/** Preserve the last page position when an anchored layer is removed. */
function survivingAnchor(doc: Document, before: Document, c: CommentThread, removed: string) {
  const point = commentPosition(before, c);
  for (const id of ancestors(before, removed)) {
    if (!doc.nodes[id] || doc.nodes[id].kind === "page" || pageForNode(doc, id) !== c.page) continue;
    const transform = worldTransform(doc, id);
    // A collapsed ancestor has no inverse in which to preserve the pin's position.
    if (transform[0] * transform[3] === transform[1] * transform[2]) continue;
    return { ...c, ...transformPoint(inverse(transform), point), anchor: id };
  }
  return { ...c, ...point, anchor: null };
}

export function followCommentAnchors(doc: Document, before: Document): Document {
  if (!doc.comments || doc.nodes === before.nodes) return doc;
  let changed: CommentThread[] | undefined;
  for (const [index, c] of doc.comments.entries()) {
    if (!c.anchor) continue;
    let next: CommentThread;
    if (doc.nodes[c.anchor]) {
      const page = pageForNode(doc, c.anchor);
      if (!page || page === c.page) continue;
      next = { ...c, page };
    } else {
      if (!before.nodes[c.anchor]) continue;
      next = survivingAnchor(doc, before, c, c.anchor);
    }
    (changed ??= [...doc.comments])[index] = Object.freeze(next);
  }
  return changed ? Object.freeze({ ...doc, comments: Object.freeze(changed) }) : doc;
}
