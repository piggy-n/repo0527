// 只供测试：按 Vector Tile 2.1 的结构编码一张瓦片（属性和几何类型；不给 parts 时几何只放占位）

type Value = string | number | boolean;

interface FeatureInput {
  readonly geometry?: 1 | 2 | 3;
  readonly properties: Readonly<Record<string, Value>>;
  /** 部件的坐标，x、y 交替：面的每个环（不重复首点）、线的每条折线、每个点 */
  readonly parts?: readonly (readonly number[])[];
}

function varint(value: bigint): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80n) {
    bytes.push(Number((rest & 0x7fn) | 0x80n));
    rest >>= 7n;
  }
  bytes.push(Number(rest));
  return bytes;
}

const field = (tag: number, wire: number) => varint(BigInt(tag * 8 + wire));
const bytesField = (tag: number, bytes: readonly number[]) => [
  ...field(tag, 2),
  ...varint(BigInt(bytes.length)),
  ...bytes
];
const stringField = (tag: number, text: string) => bytesField(tag, [...new TextEncoder().encode(text)]);

function encodeValue(value: Value): number[] {
  if (typeof value === 'string') {
    return stringField(1, value);
  }
  if (typeof value === 'boolean') {
    return [...field(7, 0), value ? 1 : 0];
  }
  if (Number.isInteger(value)) {
    // 负数按 int64 的十个字节编码，后端可能这样写 -9999
    return [...field(4, 0), ...varint(BigInt.asUintN(64, BigInt(value)))];
  }
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, value, true);
  return [...field(3, 1), ...new Uint8Array(buffer.buffer)];
}

function indexOf<T>(list: T[], item: T): number {
  const found = list.indexOf(item);
  return found >= 0 ? found : list.push(item) - 1;
}

const command = (id: number, count: number) => varint(BigInt(count * 8 + id));
const zigzag = (value: number) => varint(BigInt(value >= 0 ? value * 2 : -value * 2 - 1));

function encodeParts(parts: readonly (readonly number[])[], closed: boolean): number[] {
  let x = 0;
  let y = 0;
  const delta = (nextX: number, nextY: number) => {
    const bytes = [...zigzag(nextX - x), ...zigzag(nextY - y)];
    x = nextX;
    y = nextY;
    return bytes;
  };
  return parts.flatMap(part => {
    const [startX = 0, startY = 0] = part;
    const bytes = [...command(1, 1), ...delta(startX, startY)];
    const rest = part.length / 2 - 1;
    if (rest > 0) {
      bytes.push(...command(2, rest));
      for (let index = 2; index < part.length; index += 2) {
        bytes.push(...delta(part[index] ?? 0, part[index + 1] ?? 0));
      }
    }
    return closed ? [...bytes, ...command(7, 1)] : bytes;
  });
}

export function encodeTile(name: string, features: readonly FeatureInput[]): Uint8Array {
  const keys: string[] = [];
  const values: Value[] = [];
  const encoded = features.map(({ geometry = 3, properties, parts }) => {
    const tags = Object.entries(properties).flatMap(([key, value]) =>
      varint(BigInt(indexOf(keys, key))).concat(varint(BigInt(indexOf(values, value))))
    );
    // 占位的几何是一个 MoveTo，让 @mapbox/vector-tile 也能读
    const commands = parts ? encodeParts(parts, geometry === 3) : [9, 2, 2];
    return bytesField(2, bytesField(2, tags).concat(field(3, 0), geometry, bytesField(4, commands)));
  });
  const layer = [
    ...field(15, 0),
    2,
    ...stringField(1, name),
    ...encoded.flat(),
    ...keys.flatMap(key => stringField(3, key)),
    ...values.flatMap(value => bytesField(4, encodeValue(value))),
    ...field(5, 0),
    ...varint(4096n)
  ];
  return new Uint8Array(bytesField(3, layer));
}
