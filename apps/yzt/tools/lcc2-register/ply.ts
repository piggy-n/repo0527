// 读 LCC2 的碰撞网格（data/mesh/*.ply）：二进制小端，顶点是 x、y、z，面是顶点序号的列表
import { ToolError } from './errors.ts';

export interface Mesh {
  /** 顶点坐标，每 3 个一组 */
  readonly positions: Float32Array;
  /** 三角形的顶点序号，每 3 个一组；多边形按扇形拆成三角形 */
  readonly triangles: Uint32Array;
}

type ScalarType = 'char' | 'uchar' | 'short' | 'ushort' | 'int' | 'uint' | 'float' | 'double';

const SCALAR_SIZES: Record<ScalarType, number> = {
  char: 1,
  uchar: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  float: 4,
  double: 8
};

const SCALAR_ALIASES: Record<string, ScalarType> = {
  int8: 'char',
  uint8: 'uchar',
  int16: 'short',
  uint16: 'ushort',
  int32: 'int',
  uint32: 'uint',
  float32: 'float',
  float64: 'double'
};

function scalarType(name: string | undefined): ScalarType {
  if (name !== undefined && name in SCALAR_SIZES) {
    return name as ScalarType;
  }
  const alias = name === undefined ? undefined : SCALAR_ALIASES[name];
  if (!alias) {
    throw new ToolError(`PLY 里有不认识的类型：${name}`);
  }
  return alias;
}

const READERS: Record<ScalarType, (view: DataView, offset: number) => number> = {
  char: (view, offset) => view.getInt8(offset),
  uchar: (view, offset) => view.getUint8(offset),
  short: (view, offset) => view.getInt16(offset, true),
  ushort: (view, offset) => view.getUint16(offset, true),
  int: (view, offset) => view.getInt32(offset, true),
  uint: (view, offset) => view.getUint32(offset, true),
  float: (view, offset) => view.getFloat32(offset, true),
  double: (view, offset) => view.getFloat64(offset, true)
};

const readScalar = (view: DataView, offset: number, type: ScalarType) => READERS[type](view, offset);

interface Element {
  readonly name: string;
  readonly count: number;
  readonly properties: { name: string; type: ScalarType; countType?: ScalarType }[];
}

const END_HEADER = 'end_header\n';
// 面的顶点序号：两种写法都有人用
const FACE_INDEX_NAMES = new Set(['vertex_indices', 'vertex_index']);

/** 读二进制小端的 PLY：顶点要有 x、y、z，面是 `property list` 的顶点序号；序号越界、坐标不是有限数、长度和头部对不上都报错 */
export function parsePly(bytes: Uint8Array): Mesh {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  if (head.startsWith('ply\r\n')) {
    throw new ToolError('PLY 的头部是 CRLF 换行，不支持');
  }
  const headerEnd = head.indexOf(END_HEADER);
  if (!head.startsWith('ply\n') || headerEnd < 0) {
    throw new ToolError('不是 PLY 文件，或者头部不完整');
  }
  const elements: Element[] = [];
  for (const line of head.slice(0, headerEnd).split('\n')) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'format' && words[1] !== 'binary_little_endian') {
      throw new ToolError(`只支持二进制小端的 PLY：${line}`);
    }
    if (words[0] === 'element') {
      const count = Number(words[2]);
      if (!(Number.isSafeInteger(count) && count >= 0)) {
        throw new ToolError(`PLY 头部的元素个数不对：${line}`);
      }
      elements.push({ name: words[1] ?? '', count, properties: [] });
    }
    const element = elements.at(-1);
    if (words[0] === 'property' && element) {
      if (words[1] === 'list') {
        element.properties.push({ name: words[4] ?? '', type: scalarType(words[3]), countType: scalarType(words[2]) });
      } else {
        element.properties.push({ name: words[2] ?? '', type: scalarType(words[1]) });
      }
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let body: Body;
  try {
    body = readBody(view, headerEnd + END_HEADER.length, elements);
  } catch (error) {
    // 头部声明的数据比文件长时 DataView 越界
    throw error instanceof RangeError ? new ToolError('PLY 文件比头部声明的短（文件不完整）', { cause: error }) : error;
  }
  const { positions, triangles, end } = body;
  if (end !== bytes.length) {
    throw new ToolError(
      end > bytes.length
        ? 'PLY 文件比头部声明的短（文件不完整）'
        : `PLY 文件比头部声明的长 ${bytes.length - end} 字节`
    );
  }
  if (!positions.every(Number.isFinite)) {
    throw new ToolError('PLY 的顶点坐标里有不是有限数的值');
  }
  const vertexCount = positions.length / 3;
  const outOfRange = triangles.find((index) => !(index >= 0 && index < vertexCount));
  if (outOfRange !== undefined) {
    throw new ToolError(`PLY 的面引用了不存在的顶点 ${outOfRange}（共 ${vertexCount} 个顶点）`);
  }
  return { positions, triangles: Uint32Array.from(triangles) };
}

interface Body {
  readonly positions: Float32Array;
  readonly triangles: readonly number[];
  /** 读完以后的字节位置，应当正好是文件的长度 */
  readonly end: number;
}

// 按头部声明的元素依次读数据；面的元素可以在顶点前面
function readBody(view: DataView, start: number, elements: readonly Element[]): Body {
  let offset = start;
  let positions = new Float32Array(0);
  const triangles: number[] = [];
  for (const element of elements) {
    if (element.name === 'vertex') {
      const axes = ['x', 'y', 'z'].map((axis) => element.properties.findIndex((property) => property.name === axis));
      if (axes.some((index) => index < 0) || element.properties.some((property) => property.countType)) {
        throw new ToolError('PLY 的顶点要有 x、y、z，不能有列表属性');
      }
      positions = new Float32Array(element.count * 3);
      for (let i = 0; i < element.count; i++) {
        element.properties.forEach((property, index) => {
          const axis = axes.indexOf(index);
          if (axis >= 0) {
            positions[i * 3 + axis] = readScalar(view, offset, property.type);
          }
          offset += SCALAR_SIZES[property.type];
        });
      }
      continue;
    }
    for (let i = 0; i < element.count; i++) {
      for (const property of element.properties) {
        if (!property.countType) {
          offset += SCALAR_SIZES[property.type];
          continue;
        }
        const count = readScalar(view, offset, property.countType);
        offset += SCALAR_SIZES[property.countType];
        const indices: number[] = [];
        for (let k = 0; k < count; k++) {
          indices.push(readScalar(view, offset, property.type));
          offset += SCALAR_SIZES[property.type];
        }
        if (element.name === 'face' && FACE_INDEX_NAMES.has(property.name)) {
          for (let k = 1; k + 1 < indices.length; k++) {
            triangles.push(indices[0], indices[k], indices[k + 1]);
          }
        }
      }
    }
  }
  return { positions, triangles, end: offset };
}
