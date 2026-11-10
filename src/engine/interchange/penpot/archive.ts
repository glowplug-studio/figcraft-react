import { ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js/lib/zip-core-native.js";
import { isLosslessNumber, parse } from "lossless-json";
import { ArchiveReader, archiveOptions } from "../../file-format";
import { archiveJsonText } from "../archive-json";
import { object, type JsonObject } from "../rest/values";

const MiB = 1024 ** 2;
const prefix = "not a valid FigCraft file: Penpot: ";
export const penpotError = (reason: string) => new Error(prefix + reason);
const uuidPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && value.length === 36 && uuidPattern.test(value);
export const rootId = "00000000-0000-0000-0000-000000000000";

interface PageBudget { remaining: number }
type Source = Blob | Uint8Array;
type Fields = Record<string, unknown>;

/** Preserve lexical numbers wherever native serde distinguishes an integer from a float or a JS number loses bits. */
export class PenpotNumbers {
  private readonly tokens = new WeakMap<object, Map<string, string>>();

  parse(text: string): unknown {
    const root: unknown = parse(text);
    const visit = (container: Fields) => {
      for (const [key, value] of Object.entries(container)) {
        if (isLosslessNumber(value)) {
          const numeric = Number(value.value);
          container[key] = numeric;
          if (String(numeric) !== value.value || !Number.isSafeInteger(numeric)) {
            let tokens = this.tokens.get(container);
            if (!tokens) this.tokens.set(container, tokens = new Map());
            tokens.set(key, value.value);
          }
        } else if (value !== null && typeof value === "object") visit(value as Fields);
      }
    };
    if (isLosslessNumber(root)) return Number(root.value);
    if (root !== null && typeof root === "object") visit(root as Fields);
    return root;
  }

  token(container: object, key: string, value: number) {
    return this.tokens.get(container)?.get(key) ?? String(value);
  }

  integer(container: JsonObject, key: string) {
    const value = container[key];
    if (typeof value !== "number") return;
    const token = this.token(container, key, value);
    if (/^-?\d{1,20}$/.test(token)) return BigInt(token);
  }
}

export class PenpotArchive {
  readonly numbers = new PenpotNumbers();
  private remaining = 1024 * MiB;
  private jsonValues = 4_000_000;
  private fatal?: Error;

  constructor(private readonly members: ReadonlyMap<string, Entry>, private readonly source: Source, private readonly checkCurrent: () => void) {}

  names() { return this.members.keys(); }
  has(name: string) { return this.members.has(name); }

  check() {
    this.checkCurrent();
    if (this.fatal) throw this.fatal;
  }

  private exhausted(reason: string): never {
    this.fatal = penpotError(reason);
    throw this.fatal;
  }

  private file(path: string): FileEntry {
    const entry = this.members.get(path);
    if (!entry || entry.directory) throw penpotError(path + ": specified file not found in archive");
    return entry;
  }

  /** Charge actual output in the sink, including reads that fail after delivering data. */
  private async read(path: string, limit: number, tooLarge: string, page?: PageBudget) {
    this.check();
    const entry = this.file(path);
    if (entry.uncompressedSize > limit) throw penpotError(tooLarge);
    if (page && entry.uncompressedSize > page.remaining) throw penpotError("page shapes exceed byte budget");
    const result = new Uint8Array(entry.uncompressedSize);
    let offset = 0;
    try {
      await entry.getData(new WritableStream<Uint8Array>({
        write: chunk => {
          this.check();
          const count = chunk.length;
          if (count > this.remaining) this.exhausted("actual decompressed ZIP contents exceed 1 GiB");
          this.remaining -= count;
          if (offset + count > limit) throw penpotError(tooLarge);
          if (page && count > page.remaining) throw penpotError("page shapes exceed byte budget");
          if (offset + count > result.length) throw penpotError("incorrect uncompressed size");
          if (page) page.remaining -= count;
          result.set(chunk.subarray(0, count), offset);
          offset += count;
        },
      }));
    } catch (error) {
      this.check();
      throw error;
    }
    this.check();
    return result;
  }

  private bytes(start: number, end: number) {
    return this.source instanceof Blob ? this.source.slice(start, end) : new Blob([Uint8Array.from(this.source.subarray(start, end))]);
  }

  /** Native font detection only consumes the first four decompressed bytes. */
  private async fontSignature(path: string) {
    const entry = this.file(path);
    if (entry.encrypted || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) return;
    const local = new DataView(await this.bytes(entry.offset, entry.offset + 30).arrayBuffer());
    if (local.byteLength !== 30 || local.getUint32(0, true) !== 0x04034b50) return;
    const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const chunks = this.source instanceof Blob ? this.source.slice(start, start + entry.compressedSize).stream() :
      this.streamBytes(start, entry.compressedSize);
    const stream = entry.compressionMethod === 8 ? chunks.pipeThrough(new DecompressionStream("deflate-raw")) : chunks;
    const reader = stream.getReader(), signature = [];
    try {
      while (signature.length < 4) {
        this.check();
        const {value, done} = await reader.read();
        if (done) break;
        const count = Math.min(4 - signature.length, value.length);
        if (count > this.remaining) this.exhausted("actual decompressed ZIP contents exceed 1 GiB");
        this.remaining -= count;
        signature.push(...value.subarray(0, count));
      }
    } finally { await reader.cancel(); }
    return String.fromCharCode(...signature);
  }

  private streamBytes(start: number, length: number) {
    const source = this.source as Uint8Array, end = Math.min(start + length, source.length);
    let offset = start;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        if (offset >= end) return controller.close();
        const next = Math.min(offset + 32768, end);
        controller.enqueue(Uint8Array.from(source.subarray(offset, next)));
        offset = next;
      },
    });
  }

  async fontWarning() {
    let count = 0;
    for (const name of this.names()) {
      if (!/^(?:objects|fonts|assets\/fonts)\//.test(name)) continue;
      try {
        const signature = await this.fontSignature(name);
        if (["OTTO", "true", "ttcf", "wOFF", "wOF2", "\x00\x01\x00\x00"].includes(signature ?? "")) count++;
      } catch { this.check(); }
    }
    if (count) return "Penpot contains " + count + " embedded font file(s); the current model does not retain font binaries. Install the licensed fonts locally; original family references are preserved";
  }

  async json(path: string, page?: PageBudget): Promise<unknown> {
    const bytes = await this.read(path, 16 * MiB, "JSON member too large: " + path, page);
    let cost = 1, quoted = false;
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      if (quoted && byte === 92) index++;
      else if (byte === 34) quoted = !quoted;
      else if (!quoted && (byte === 91 || byte === 123 || byte === 44 || byte === 58)) cost++;
    }
    if (cost > this.jsonValues) this.exhausted("JSON structure exceeds import value budget");
    this.jsonValues -= cost;
    return this.numbers.parse(archiveJsonText(bytes.buffer, prefix + path));
  }

  private records(prefix: string, max: number, reason: string) {
    const paths: string[] = [];
    for (const path of this.names()) {
      if (path.length !== prefix.length + 41 || !path.startsWith(prefix) || !path.endsWith(".json") ||
          !isUuid(path.slice(prefix.length, -5))) continue;
      if (paths.length === max) throw penpotError(reason);
      paths.push(path);
    }
    return paths;
  }

  async manifest() {
    const manifest = object(await this.json("manifest.json"));
    if (manifest.type !== "penpot/export-files") throw penpotError("not a Penpot export-files archive");
    if (this.numbers.integer(manifest, "version") !== 1n) throw penpotError("unsupported Penpot export version");
    if (!Array.isArray(manifest.files)) throw penpotError("no files in manifest");
    if (!manifest.files.length || manifest.files.length > 50) throw penpotError("invalid number of Penpot files");
    return manifest.files.map(object);
  }

  async pages(file: JsonObject) {
    if (!isUuid(file.id)) throw penpotError("invalid file UUID");
    const paths = this.records("files/" + file.id + "/pages/", 500, "too many pages");
    const pages = [];
    const max = 0x7fffffffffffffffn;
    for (const path of paths) {
      const data = object(await this.json(path));
      if (!isUuid(data.id)) continue;
      const index = this.numbers.integer(data, "index");
      const name = Array.from(typeof data.name === "string" ? data.name : "Page").slice(0, 256).join("");
      pages.push({ data, name, id: data.id, index: index !== undefined && index >= -max - 1n && index <= max ? index : max });
    }
    return pages.sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0);
  }

  async shapes(fileId: string, page: {id: string; name: string}) {
    const paths = this.records("files/" + fileId + "/pages/" + page.id + "/", 50_000, "too many layers on a page");
    const pageBudget = {remaining: 128 * MiB};
    const shapes = new Map<string, JsonObject>();
    for (const path of paths) {
      const shape = object(await this.json(path, pageBudget));
      if (isUuid(shape.id)) shapes.set(shape.id, shape);
    }
    if (!shapes.has(rootId)) throw penpotError("page " + page.name + " has no root frame");
    return shapes;
  }
}

export async function withPenpotArchive<T>(source: Source, checkCurrent: () => void, visit: (archive: PenpotArchive) => Promise<T>) {
  if ((source instanceof Blob ? source.size : source.byteLength) > 512 * MiB) throw penpotError("archive exceeds 512 MiB");
  const reader = new ZipReader(new ArchiveReader(source), archiveOptions);
  try {
    const members = new Map<string, Entry>();
    try {
      for await (const entry of reader.getEntriesGenerator()) {
        checkCurrent();
        // zip::ZipArchive indexes by name. The last central-directory record owns duplicate names.
        members.set(entry.filename, entry);
        if (members.size > 100_000) throw penpotError("too many ZIP members");
      }
    } catch (error) {
      checkCurrent();
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(prefix)) throw error;
      const cause = /End of central directory not found|File format is not recognized/.test(message) ?
        "invalid Zip archive: Could not find EOCD" : message;
      // This is reported after the complete directory has been yielded.
      if (!(error instanceof Error && "reason" in error && error.reason === "duplicate filename"))
        throw penpotError("invalid ZIP: " + cause);
    }
    let expanded = 0;
    for (const [name, entry] of members) {
      if (name.startsWith("/") || name.includes("\\") || /\p{Cc}/u.test(name) || name.split("/").some(p => p === "." || p === ".."))
        throw penpotError("unsafe ZIP member path");
      expanded += entry.uncompressedSize;
      if (expanded > 1024 * MiB) throw penpotError("ZIP contents exceed 1 GiB");
    }
    return await visit(new PenpotArchive(members, source, checkCurrent));
  } finally { await reader.close(); }
}
