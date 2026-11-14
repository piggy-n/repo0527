// LCC2 的碰撞网格（data/mesh/*.ply）→ 三角形（ADR 0156 第 2 节）：二进制小端，顶点读 x、y、z，面是顶点序号的列表。
// 坐标就是 LCC2 的局部系，也是导航网格的局部系，不再变换；配准工具 apps/yzt/tools/lcc2-register/ply.ts 另有一份

type ScalarType = 'char' | 'uchar' | 'short' | 'ushort' | 'int' | 'uint' | 'float' | 'double';

const SIZES: Readonly<Record<ScalarType, number>> = {
  char: 1,
  uchar: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  float: 4,
  double: 8
};

const ALIASES: Readonly<Record<string, ScalarType>> = {
  int8: 'char',
  uint8: 'uchar',
  int16: 'short',
  uint16: 'ushort',
  int32: 'int',
  uint32: 'uint',
  float32: 'float',
  float64: 'double'
};

const READERS: Readonly<Record<ScalarType, (view: DataView, offset: number) => number>> = {
  char: (view, offset) => view.getInt8(offset),
  uchar: (view, offset) => view.getUint8(offset),
  short: (view, offset) => view.getInt16(offset, true),
  ushort: (view, offset) => view.getUint16(offset, true),
  int: (view, offset) => view.getInt32(offset, true),
  uint: (view, offset) => view.getUint32(offset, true),
  float: (view, offset) => view.getFloat32(offset, true),
  double: (view, offset) => view.getFloat64(offset, true)
};

const isScalar = (name: string): name is ScalarType => name in SIZES;

function scalarType(name: string | undefined): ScalarType {
  const type = name === undefined ? undefined : isScalar(name) ? name : ALIASES[name];
  if (!type) {
    throw new Error(`PLY 里有不认识的类型：${name}`);
  }
  return type;
}

interface Property {
  readonly name: string;
  readonly type: ScalarType;
  /** 列表属性的个数的类型；普通属性没有 */
  readonly countType?: ScalarType;
}

interface Element {
  readonly name: string;
  readonly count: number;
  readonly properties: Property[];
}

const END_HEADER = 'end_header\n';
// 头部最多读这么多字节找 end_header
const HEADER_LIMIT = 64 * 1024;
// 面的顶点序号：两种写法都有人用
const FACE_INDEX_NAMES = new Set(['vertex_indices', 'vertex_index']);

function parseHeader(bytes: Uint8Array): { readonly elements: readonly Element[]; readonly bodyStart: number } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, HEADER_LIMIT)));
  const headerEnd = head.indexOf(END_HEADER);
  if (!head.startsWith('ply\n') || headerEnd < 0) {
    throw new Error('不是 PLY 文件，或者头部不完整（只支持 LF 换行）');
  }
  const elements: Element[] = [];
  for (const line of head.slice(0, headerEnd).split('\n')) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'format' && words[1] !== 'binary_little_endian') {
      throw new Error(`只支持二进制小端的 PLY：${line}`);
    }
    if (words[0] === 'element') {
      const count = Number(words[2]);
      if (!(Number.isSafeInteger(count) && count >= 0)) {
        throw new Error(`PLY 头部的元素个数不对：${line}`);
      }
      elements.push({ name: words[1] ?? '', count, properties: [] });
    }
    const element = elements.at(-1);
    if (words[0] === 'property' && element) {
      element.properties.push(
        words[1] === 'list'
          ? { name: words[4] ?? '', type: scalarType(words[3]), countType: scalarType(words[2]) }
          : { name: words[2] ?? '', type: scalarType(words[1]) }
      );
    }
  }
  return { elements, bodyStart: headerEnd + END_HEADER.length };
}

/**
 * 读二进制小端的 PLY，给出三角形（每个三角形 9 个数：三个顶点的 x、y、z），多边形按扇形拆开；可以直接交给 buildNavGrid。
 * 面引用了不存在的顶点、坐标不是有限数、长度和头部对不上都报错
 */
export function parsePlyTriangles(buffer: ArrayBuffer): Float32Array {
  const bytes = new Uint8Array(buffer);
  const { elements, bodyStart } = parseHeader(bytes);
  const view = new DataView(buffer);
  let offset = bodyStart;
  let positions: Float32Array | null = null;
  const faces: number[] = [];
  const read = (type: ScalarType) => {
    if (offset + SIZES[type] > bytes.length) {
      throw new Error('PLY 文件比头部声明的短（文件不完整）');
    }
    const value = READERS[type](view, offset);
    offset += SIZES[type];
    return value;
  };
  for (const element of elements) {
    if (element.name === 'vertex') {
      const axes = ['x', 'y', 'z'].map(axis => element.properties.findIndex(property => property.name === axis));
      if (axes.includes(-1) || element.properties.some(property => property.countType)) {
        throw new Error('PLY 的顶点要有 x、y、z，不能有列表属性');
      }
      positions = new Float32Array(element.count * 3);
      for (let i = 0; i < element.count; i++) {
        for (let p = 0; p < element.properties.length; p++) {
          const value = read(element.properties[p].type);
          const axis = axes.indexOf(p);
          if (axis !== -1) {
            positions[i * 3 + axis] = value;
          }
        }
      }
      continue;
    }
    for (let i = 0; i < element.count; i++) {
      for (const { name, type, countType } of element.properties) {
        if (!countType) {
          read(type);
          continue;
        }
        const count = read(countType);
        const first = offset;
        const keep = element.name === 'face' && FACE_INDEX_NAMES.has(name);
        for (let k = 0; k < count; k++) {
          const index = read(type);
          // 扇形：(0, k-1, k)
          if (keep && k >= 2) {
            faces.push(READERS[type](view, first), READERS[type](view, first + (k - 1) * SIZES[type]), index);
          }
        }
      }
    }
  }
  if (offset !== bytes.length) {
    throw new Error(`PLY 文件比头部声明的长 ${bytes.length - offset} 字节`);
  }
  if (!positions) {
    throw new Error('PLY 里没有顶点');
  }
  const vertexCount = positions.length / 3;
  const out = new Float32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    const vertex = faces[i];
    if (!(Number.isInteger(vertex) && vertex >= 0 && vertex < vertexCount)) {
      throw new Error(`PLY 的面引用了不存在的顶点 ${vertex}（共 ${vertexCount} 个顶点）`);
    }
    out[i * 3] = positions[vertex * 3];
    out[i * 3 + 1] = positions[vertex * 3 + 1];
    out[i * 3 + 2] = positions[vertex * 3 + 2];
  }
  if (!out.every(Number.isFinite)) {
    throw new Error('PLY 的顶点坐标里有不是有限数的值');
  }
  return out;
}
