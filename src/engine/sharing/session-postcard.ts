import { nodePropertyOrder } from "../branch-diff";
import { U64_MAX } from "../native-values";

const properties = ["parent", "position", ...nodePropertyOrder.filter(name => name !== "parent")];
const documentProperties = ["name", "currentPage", "documentColors", "colorProfile", "imagePresets", "annotationCategories",
  "libraries", "styles", "styleOrder", "comments", "commentOrder", "collections", "collectionOrder", "variables",
  "variableOrder", "kind", "timer", "vote", "voteHistory"];
const entryKinds = ["style", "comment", "collection", "variable", "devSnapshot", "image", "ballot"];
const utf8 = new TextEncoder();

/** Native collaboration wraps each typed property in a compact JSON string. */
export type InitialChange =
  | {type: "create"; id: string; kind: string; parent: string | null; position: string; props: [string, string][]}
  | {type: "setDoc"; prop: string; value: string}
  | {type: "put"; entry: string; key: string; value: string};

export const SESSION_DISK_HEADER_BYTES = 17;

class Postcard {
  size = 0;
  constructor(private output?: Uint8Array) {}

  byte(value: number) {
    if (this.output) this.output[this.size] = value;
    this.size++;
  }

  uint(value: bigint | number) {
    let remaining = BigInt(value);
    if (remaining < 0n || remaining > U64_MAX) throw new RangeError("Session integer outside u64");
    while (remaining >= 128n) {
      this.byte(128 + Number(remaining & 127n));
      remaining >>= 7n;
    }
    this.byte(Number(remaining));
  }

  variant(values: string[], name: string) {
    const index = values.indexOf(name);
    if (index < 0) throw new Error("Unknown session property " + name);
    this.uint(index);
  }

  text(value: string) {
    // Count UTF-8 without making a second copy of large image or text properties.
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const point = value.codePointAt(i)!;
      if (point > 0xffff) { bytes += 4; i++; }
      else bytes += point < 128 ? 1 : point < 2048 ? 2 : 3;
    }
    this.uint(bytes);
    if (this.output) utf8.encodeInto(value, this.output.subarray(this.size, this.size + bytes));
    this.size += bytes;
  }

  imageSize(key: string, valueBytes: number) {
    this.byte(4); // Change::Put
    this.variant(entryKinds, "image");
    this.text(key);
    this.uint(valueBytes);
    this.size += valueBytes;
  }

  change(change: InitialChange) {
    switch (change.type) {
      case "create":
        this.byte(0);
        this.uint(BigInt(change.id));
        this.text(change.kind);
        this.byte(change.parent === null ? 0 : 1);
        if (change.parent !== null) this.uint(BigInt(change.parent));
        this.text(change.position);
        this.uint(change.props.length);
        for (const [prop, value] of change.props) { this.variant(properties, prop); this.text(value); }
        break;
      case "setDoc":
        this.byte(3);
        this.variant(documentProperties, change.prop);
        this.text(change.value);
        break;
      case "put":
        this.byte(4);
        this.variant(entryKinds, change.entry);
        if (change.entry === "comment" || change.entry === "devSnapshot") this.uint(BigInt(change.key));
        else this.text(change.key);
        this.text(change.value);
        break;
    }
  }
}

export interface InitialSession {
  session: bigint;
  nextClient: number;
  changes: readonly InitialChange[];
}

function prefix(writer: Postcard, session: bigint, count: number) {
  writer.byte(1); // message::WIRE_VERSION
  writer.uint(session);
  writer.uint(count);
}

function suffix(writer: Postcard, nextClient: number) {
  writer.uint(0); // last accepted sequence
  writer.uint(nextClient);
  for (let i = 0; i < 4; i++) writer.byte(0); // issued clients, deleted nodes, removed entries and accepted log
}

function writeInitialState(state: InitialSession, output?: Uint8Array) {
  const writer = new Postcard(output);
  prefix(writer, state.session, state.changes.length);
  for (const change of state.changes) writer.change(change);
  suffix(writer, state.nextClient);
  return writer.size;
}

/** Counts the same postcard fields as the encoder. Image base64 length is known from its Blob. */
export class InitialSnapshotMeasure {
  private body = new Postcard();
  private count = 0;

  add(change: InitialChange) {
    this.body.change(change);
    this.count++;
  }

  image(key: string, jsonBytes: number) {
    this.body.imageSize(key, jsonBytes);
    this.count++;
  }

  framedBytes(session: bigint, nextClient: number) {
    const envelope = new Postcard();
    prefix(envelope, session, this.count);
    suffix(envelope, nextClient);
    return SESSION_DISK_HEADER_BYTES + envelope.size + this.body.size;
  }
}

export function initialSnapshotSize(state: InitialSession) {
  return SESSION_DISK_HEADER_BYTES + writeInitialState(state);
}

export function encodeInitialState(state: InitialSession) {
  const output = new Uint8Array(writeInitialState(state));
  writeInitialState(state, output);
  return output;
}
