import { parse } from "lossless-json";

function invalid(reason: string): never { throw Error("Cannot open Figcraft file: " + reason); }

function parseValue(text: string) {
  return parse(text, undefined, {onDuplicateKey: ({key}) => invalid("duplicate JSON key " + key)});
}

/** Read only complete root fields and individual node records into the lossless parser. */
class NativeJsonReader {
  #reader: ReadableStreamDefaultReader<string>;
  #chunk = "";
  #at = 0;
  #yielded = performance.now();

  constructor(input: ReadableStream<Uint8Array<ArrayBuffer>>) {
    this.#reader = input.pipeThrough(new TextDecoderStream("utf-8",{fatal:true})).getReader();
  }

  async #available() {
    while (this.#at === this.#chunk.length) {
      if (performance.now() - this.#yielded > 12) {
        await new Promise<void>(resolve => setTimeout(resolve,0));
        this.#yielded = performance.now();
      }
      const next = await this.#reader.read();
      if (next.done) return false;
      this.#chunk = next.value;
      this.#at = 0;
    }
    return true;
  }

  async nextCharacter() {
    while (await this.#available()) {
      for (;this.#at < this.#chunk.length;this.#at++) {
        const code = this.#chunk.charCodeAt(this.#at);
        if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return this.#chunk[this.#at];
      }
    }
    return "";
  }

  async #expect(character: string) {
    if (await this.nextCharacter() !== character) invalid("invalid JSON object structure");
    this.#at++;
  }

  /** Delimiters inside strings and nested values belong to the existing JSON parser. */
  async value(key = false): Promise<unknown> {
    await this.nextCharacter();
    const parts: string[] = [];
    let quoted = false, escaped = false, depth = 0;
    while (await this.#available()) {
      const begin = this.#at;
      for (; this.#at < this.#chunk.length; this.#at++) {
        const code = this.#chunk.charCodeAt(this.#at);
        if (quoted) {
          if (escaped) escaped = false;
          else if (code === 92) escaped = true;
          else if (code === 34) quoted = false;
          continue;
        }
        if (code === 34) quoted = true;
        else if (code === 123 || code === 91) depth++;
        else if (depth === 0 && (code === 44 || code === 125 || key && code === 58)) {
          parts.push(this.#chunk.slice(begin,this.#at));
          return parseValue(parts.join(""));
        } else if (code === 125 || code === 93) {
          if (--depth < 0) invalid("unmatched JSON delimiter");
        }
      }
      parts.push(this.#chunk.slice(begin));
    }
    return invalid("truncated JSON object");
  }

  async object<T>(read: (key: string) => Promise<T>): Promise<Record<string,T>> {
    const result: Record<string,T> = Object.create(null);
    await this.#expect("{");
    if (await this.nextCharacter() === "}") { this.#at++; return result; }
    while (true) {
      if (await this.nextCharacter() !== '"') invalid("JSON property name must be a string");
      const key = await this.value(true);
      if (typeof key !== "string") invalid("invalid JSON property name");
      if (Object.hasOwn(result,key)) invalid("duplicate JSON key " + key);
      await this.#expect(":");
      result[key] = await read(key);
      const separator = await this.nextCharacter();
      if (separator !== "," && separator !== "}") invalid("invalid JSON object separator");
      this.#at++;
      if (separator === "}") return result;
    }
  }

  async close() {
    try { await this.#reader.cancel(); } finally { this.#reader.releaseLock(); }
  }
}

export async function readNativeJson<T>(input: ReadableStream<Uint8Array<ArrayBuffer>>, node: (key: string, raw: unknown) => T) {
  const reader = new NativeJsonReader(input);
  try {
    const root = await reader.object<unknown>(key => key === "nodes"
      ? reader.object(async id => node(id,await reader.value()))
      : reader.value());
    if (await reader.nextCharacter()) invalid("unexpected data after the document");
    return root;
  } finally { await reader.close(); }
}
