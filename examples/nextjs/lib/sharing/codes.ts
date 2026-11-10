import { createHash, timingSafeEqual } from "node:crypto";

export interface SealedJoinCode {
  hash: string;
  token: string;
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();

/** Called by the server after admitting a lookup against its guessing limits. */
export class JoinCodeKey {
  readonly hash: string;
  readonly #pad: Buffer;

  constructor(symbols: string) {
    let key = createHash("sha256").update("figcraft join code\0").update(symbols).digest();
    for (let round = 0; round < 10_000; round++) key = digest(key);
    this.hash = createHash("sha256").update("find\0").update(key).digest("hex");
    this.#pad = createHash("sha256").update("wrap\0").update(key).digest();
  }

  #wrap(bytes: Buffer) {
    const output = Buffer.alloc(bytes.length);
    for (let index = 0; index < bytes.length; index++) output[index] = bytes[index] ^ this.#pad[index];
    return output;
  }

  seal(token: string): SealedJoinCode {
    const bytes = Buffer.from(token);
    if (bytes.length > 32) throw new Error("this link's token is too long for a join code");
    return { hash: this.hash, token: this.#wrap(bytes).toString("hex") };
  }

  open(sealed: SealedJoinCode): string | undefined {
    if (sealed.hash.length !== this.hash.length || sealed.token.length > 64) return;
    const presented = Buffer.from(sealed.hash);
    const expected = Buffer.from(this.hash);
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return;
    const pairs = sealed.token.slice(0, sealed.token.length - sealed.token.length % 2);
    if (!/^[0-9a-f]*$/i.test(pairs)) return;
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(this.#wrap(Buffer.from(pairs, "hex")));
    } catch { return; }
  }
}
