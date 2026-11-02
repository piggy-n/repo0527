import { gunzipSync } from 'node:zlib';

// 瓦片的解码：只读图层名、几何类型和属性，不解码坐标（Vector Tile 2.1 的 protobuf 结构）。
// 不依赖第三方库，这个目录可以单独拷到能连后端的机器上运行

export type TileValue = string | number | boolean;

export interface TileFeature {
  readonly geometry: 'point' | 'line' | 'polygon' | 'unknown';
  readonly properties: Readonly<Record<string, TileValue>>;
}

export interface TileLayer {
  readonly name: string;
  readonly features: readonly TileFeature[];
}

/** 瓦片接口的返回：空内容、瓦片，或者 HTTP 200 里的错误（后端用 JSON 报"系统异常"，见 docs/migration.md） */
export type TileBody =
  | { readonly kind: 'empty' }
  | { readonly kind: 'tile'; readonly layers: readonly TileLayer[] }
  | { readonly kind: 'error'; readonly message: string };

const TEXT = new TextDecoder();
const GEOMETRY: readonly TileFeature['geometry'][] = ['unknown', 'point', 'line', 'polygon'];

const WIRE = { varint: 0, fixed64: 1, bytes: 2, fixed32: 5 } as const;

class Reader {
  readonly #view: DataView;
  readonly #bytes: Uint8Array;
  #position = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.#position >= this.#bytes.length;
  }

  #byte(): number {
    const value = this.#bytes[this.#position];
    if (value === undefined) {
      throw new RangeError('瓦片内容在字段中途结束');
    }
    this.#position += 1;
    return value;
  }

  varint(): number {
    return Number(this.varint64());
  }

  // 负的 int64 占 10 个字节，超出 Number 的精度，要用 BigInt 读（后端的 -9999 可能这样编码）
  varint64(): bigint {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      const byte = this.#byte();
      value |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) {
        return value;
      }
      shift += 7n;
    }
  }

  bytes(): Uint8Array {
    const length = this.varint();
    const start = this.#position;
    this.#position += length;
    if (this.#position > this.#bytes.length) {
      throw new RangeError('瓦片内容在字段中途结束');
    }
    return this.#bytes.subarray(start, this.#position);
  }

  string(): string {
    return TEXT.decode(this.bytes());
  }

  float(): number {
    const value = this.#view.getFloat32(this.#position, true);
    this.#position += 4;
    return value;
  }

  double(): number {
    const value = this.#view.getFloat64(this.#position, true);
    this.#position += 8;
    return value;
  }

  skip(wire: number): void {
    if (wire === WIRE.varint) {
      this.varint64();
    } else if (wire === WIRE.fixed64) {
      this.#position += 8;
    } else if (wire === WIRE.bytes) {
      this.bytes();
    } else if (wire === WIRE.fixed32) {
      this.#position += 4;
    } else {
      throw new RangeError(`不认识的字段类型 ${wire}`);
    }
  }

  // 依次读每个字段；回调返回 false 时说明没有读，由这里跳过
  fields(read: (tag: number, wire: number) => boolean): void {
    while (!this.done) {
      const key = this.varint();
      const wire = key % 8;
      if (!read(Math.floor(key / 8), wire)) {
        this.skip(wire);
      }
    }
  }
}

function decodeValue(bytes: Uint8Array): TileValue | null {
  const reader = new Reader(bytes);
  let value: TileValue | null = null;
  reader.fields(tag => {
    switch (tag) {
      case 1:
        value = reader.string();
        return true;
      case 2:
        value = reader.float();
        return true;
      case 3:
        value = reader.double();
        return true;
      case 4:
        value = Number(BigInt.asIntN(64, reader.varint64()));
        return true;
      case 5:
        value = Number(reader.varint64());
        return true;
      case 6: {
        const zigzag = reader.varint64();
        value = Number((zigzag >> 1n) ^ -(zigzag & 1n));
        return true;
      }
      case 7:
        value = reader.varint() !== 0;
        return true;
      default:
        return false;
    }
  });
  return value;
}

function decodeFeature(
  bytes: Uint8Array,
  keys: readonly string[],
  values: readonly (TileValue | null)[]
): TileFeature {
  const reader = new Reader(bytes);
  const properties: Record<string, TileValue> = {};
  let geometry: TileFeature['geometry'] = 'unknown';
  reader.fields(tag => {
    if (tag === 2) {
      const tags = new Reader(reader.bytes());
      while (!tags.done) {
        const key = keys[tags.varint()];
        const value = values[tags.varint()];
        if (key !== undefined && value !== undefined && value !== null) {
          properties[key] = value;
        }
      }
      return true;
    }
    if (tag === 3) {
      geometry = GEOMETRY[reader.varint()] ?? 'unknown';
      return true;
    }
    return false;
  });
  return { geometry, properties };
}

function decodeLayer(bytes: Uint8Array): TileLayer {
  const reader = new Reader(bytes);
  let name = '';
  const keys: string[] = [];
  const values: (TileValue | null)[] = [];
  // 要素可能排在 keys、values 前面，先记下，读完整个图层再解码
  const features: Uint8Array[] = [];
  reader.fields(tag => {
    if (tag === 1) {
      name = reader.string();
    } else if (tag === 2) {
      features.push(reader.bytes());
    } else if (tag === 3) {
      keys.push(reader.string());
    } else if (tag === 4) {
      values.push(decodeValue(reader.bytes()));
    } else {
      return false;
    }
    return true;
  });
  return { name, features: features.map(feature => decodeFeature(feature, keys, values)) };
}

/** 解码瓦片；不是合法的瓦片时抛错 */
export function decodeTile(bytes: Uint8Array): TileLayer[] {
  const reader = new Reader(bytes);
  const layers: TileLayer[] = [];
  reader.fields(tag => {
    if (tag !== 3) {
      return false;
    }
    layers.push(decodeLayer(reader.bytes()));
    return true;
  });
  return layers;
}

function errorMessage(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'msg' in body) {
      return String(body.msg);
    }
  } catch {
    // 不是 JSON，直接用文本
  }
  return text.slice(0, 200);
}

/** 按内容判断瓦片接口的返回 */
export function readTileBody(raw: Uint8Array): TileBody {
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? new Uint8Array(gunzipSync(raw)) : raw;
  if (bytes.length === 0) {
    return { kind: 'empty' };
  }
  // 合法的瓦片以图层字段开头（0x1a）；{ 是后端报错的 JSON
  if (bytes[0] === 0x7b) {
    return { kind: 'error', message: errorMessage(TEXT.decode(bytes)) };
  }
  try {
    return { kind: 'tile', layers: decodeTile(bytes) };
  } catch (error) {
    return { kind: 'error', message: `解码失败：${String(error)}` };
  }
}
