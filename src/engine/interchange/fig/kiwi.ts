/** Each canvas carries its own Kiwi schema. Field IDs and enum values are file-local. */
interface Field {
  readonly name: string;
  readonly type: number;
  readonly array: boolean;
  readonly id: number;
}
interface Definition {
  readonly name: string;
  readonly kind: number;
  readonly fields: Field[];
  readonly byId: Map<number, Field>;
}
export type KiwiValue = string | number | bigint | boolean | Uint8Array | KiwiValue[] | KiwiObject;
export interface KiwiObject { [name: string]: KiwiValue | undefined }

const utf8 = new TextDecoder("utf-8", {ignoreBOM: true});
class Reader {
  position = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining() { return this.bytes.length - this.position; }
  take(count: number) {
    if (count > this.remaining) throw new Error("unexpected end of data");
    const start = this.position;
    this.position += count;
    return this.bytes.subarray(start, this.position);
  }
  byte() {
    if (!this.remaining) throw new Error("unexpected end of data");
    return this.bytes[this.position++];
  }
  uint() {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      const b = this.byte();
      if (shift === 28 && b > 15) throw new Error("u32 varint overflow");
      value += (b & 127) * 2 ** shift;
      if (b < 128) return value;
    }
  }
  int() {
    const u = this.uint();
    return u % 2 ? -Math.floor(u / 2) - 1 : u / 2;
  }
  uint64() {
    let value = 0n;
    for (let shift = 0n; ; shift += 7n) {
      const b = this.byte();
      if (shift === 56n) return value | BigInt(b) << shift;
      value |= BigInt(b & 127) << shift;
      if (b < 128) return value;
    }
  }
  float() {
    const first = this.byte();
    if (first === 0) return 0;
    const start = this.position - 1;
    this.take(3);
    const bits = this.view.getUint32(start, true);
    floatBits.setUint32(0, bits << 23 | bits >>> 9, true);
    return floatBits.getFloat32(0, true);
  }
  string() {
    const end = this.bytes.indexOf(0, this.position);
    if (end < 0) throw new Error("unterminated string");
    const value = utf8.decode(this.bytes.subarray(this.position, end));
    this.position = end + 1;
    return value;
  }
}
const floatBits = new DataView(new ArrayBuffer(4));

export function readKiwiSchema(bytes: Uint8Array): Definition[] {
  const reader = new Reader(bytes);
  const count = reader.uint();
  if (count > 10000 || count > reader.remaining) throw new Error("schema: too many definitions");
  const schema: Definition[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const name = reader.string(), kind = reader.byte();
    if (kind > 2) throw new Error("schema: unknown definition kind " + kind);
    const length = reader.uint();
    total += length;
    if (length > 10000 || length > reader.remaining || total > 200000) throw new Error("schema: too many fields");
    const fields: Field[] = [], byId = new Map<number, Field>();
    for (let f = 0; f < length; f++) {
      const field = {name: reader.string(), type: reader.int(), array: Boolean(reader.byte() & 1), id: reader.uint()};
      if (kind === 2 && byId.has(field.id)) throw new Error("schema: duplicate field id " + field.id + " in " + name);
      if (!byId.has(field.id)) byId.set(field.id, field);
      fields.push(field);
    }
    schema.push({name, kind, fields, byId});
  }
  for (const d of schema) if (d.kind !== 0) for (const f of d.fields) {
    if (f.type < -8) throw new Error("schema: unknown type " + f.type);
    if (f.type >= count) throw new Error("schema: field " + f.name + " names missing definition " + f.type);
  }
  return schema;
}

export function readKiwiMessage(schema: readonly Definition[], bytes: Uint8Array, budget: number): KiwiValue {
  const reader = new Reader(bytes);
  function spend(amount: number) {
    budget -= amount;
    if (budget < 0) throw new Error("message: too many values");
  }
  function value(type: number, depth: number): KiwiValue {
    switch (type) {
      case -1: return reader.byte() !== 0;
      case -2: return reader.byte();
      case -3: return reader.int();
      case -4: return reader.uint();
      case -5: return reader.float();
      case -6: return reader.string();
      case -7: {
        const u = reader.uint64();
        return u & 1n ? ~(u >> 1n) : u >> 1n;
      }
      case -8: return reader.uint64();
      default: return definition(type, depth + 1);
    }
  }
  function field(f: Field, depth: number): KiwiValue {
    if (!f.array) {
      if (f.type < 0) spend(1);
      return value(f.type, depth);
    }
    const length = reader.uint();
    if (length > reader.remaining) throw new Error("message: array longer than the data");
    spend(1);
    if (f.type === -2) return reader.take(length);
    spend(length);
    const data: KiwiValue[] = [];
    for (let i = 0; i < length; i++) data.push(value(f.type, depth));
    return data;
  }
  function definition(index: number, depth: number): KiwiValue {
    if (depth > 64) throw new Error("message: nested too deeply");
    spend(1);
    const d = schema[index];
    if (d.kind === 0) {
      const id = reader.uint();
      return d.byId.get(id)?.name ?? id;
    }
    const result: KiwiObject = Object.create(null);
    // Native lookup returns the first occurrence, but later tags still consume bytes and budget.
    const read = (f: Field) => {
      const item = field(f, depth);
      if (!Object.hasOwn(result, f.name)) result[f.name] = item;
    };
    if (d.kind === 1) {
      for (const f of d.fields) read(f);
    } else {
      for (let id = reader.uint(); id !== 0; id = reader.uint()) {
        const f = d.byId.get(id);
        if (!f) throw new Error("message: " + d.name + " has no field " + id);
        read(f);
      }
    }
    return result;
  }
  const root = schema.findIndex(d => d.name === "Message");
  if (root < 0) throw new Error("the schema has no Message definition");
  return definition(root, 0);
}
