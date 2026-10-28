// b3dm → 根节点局部系下的三角形（ADR 0085），只读导航网格要用的部分：三角形列表的位置和索引
import { identity, type Mat4, multiply, translation } from './nav-frame';

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function objects(value: unknown, where: string): readonly Json[] {
  if (!Array.isArray(value) || !value.every(isObject)) {
    throw new Error(`glTF 的 ${where} 不是对象数组`);
  }
  return value;
}

function item(list: readonly Json[], index: unknown, where: string): Json {
  const found = typeof index === 'number' ? list[index] : undefined;
  if (!found) {
    throw new Error(`glTF 的 ${where} 引用了不存在的 ${String(index)}`);
  }
  return found;
}

function integer(object: Json, key: string, fallback?: number): number {
  const value = object[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`glTF 的 ${key} 不是整数`);
  }
  return value;
}

function numbers(value: unknown, length: number, fallback: readonly number[]): readonly number[] {
  if (value === undefined) {
    return fallback;
  }
  if (!Array.isArray(value) || value.length !== length || !value.every(entry => typeof entry === 'number')) {
    throw new Error(`glTF 的变换不是 ${length} 个数`);
  }
  return value;
}

const COMPONENT_SIZES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZES: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readComponent(view: DataView, type: number, offset: number): number {
  switch (type) {
    case 5120:
      return view.getInt8(offset);
    case 5121:
      return view.getUint8(offset);
    case 5122:
      return view.getInt16(offset, true);
    case 5123:
      return view.getUint16(offset, true);
    case 5125:
      return view.getUint32(offset, true);
    default:
      return view.getFloat32(offset, true);
  }
}

function nodeMatrix(node: Json): Mat4 {
  if (node.matrix !== undefined) {
    return Float64Array.from(numbers(node.matrix, 16, []));
  }
  const [tx, ty, tz] = numbers(node.translation, 3, [0, 0, 0]);
  const [qx, qy, qz, qw] = numbers(node.rotation, 4, [0, 0, 0, 1]);
  const [sx, sy, sz] = numbers(node.scale, 3, [1, 1, 1]);
  return Float64Array.from([
    (1 - 2 * (qy * qy + qz * qz)) * sx,
    2 * (qx * qy + qz * qw) * sx,
    2 * (qx * qz - qy * qw) * sx,
    0,
    2 * (qx * qy - qz * qw) * sy,
    (1 - 2 * (qx * qx + qz * qz)) * sy,
    2 * (qy * qz + qx * qw) * sy,
    0,
    2 * (qx * qz + qy * qw) * sz,
    2 * (qy * qz - qx * qw) * sz,
    (1 - 2 * (qx * qx + qy * qy)) * sz,
    0,
    tx,
    ty,
    tz,
    1
  ]);
}

// b3dm 里的 glTF 约定 y 轴向上，3D Tiles 运行时会转成 z 向上：(x, y, z) → (x, -z, y)
const Y_UP_TO_Z_UP = Float64Array.from([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);

/** 解析一个 b3dm，返回局部系下的三角形顶点（每个三角形 9 个数）；toLocal 是瓦片内容坐标 → 根节点局部系 */
export function parseB3dmTriangles(buffer: ArrayBuffer, toLocal: ArrayLike<number> = identity()): Float32Array {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  if (decoder.decode(new Uint8Array(buffer, 0, 4)) !== 'b3dm') {
    throw new Error('不是 b3dm 瓦片');
  }
  const featureJsonLength = view.getUint32(12, true);
  const featureBinaryLength = view.getUint32(16, true);
  const batchJsonLength = view.getUint32(20, true);
  const batchBinaryLength = view.getUint32(24, true);
  const featureTable: unknown = featureJsonLength
    ? JSON.parse(decoder.decode(new Uint8Array(buffer, 28, featureJsonLength)))
    : {};
  const glbStart = 28 + featureJsonLength + featureBinaryLength + batchJsonLength + batchBinaryLength;
  const jsonLength = view.getUint32(glbStart + 12, true);
  const gltf: unknown = JSON.parse(decoder.decode(new Uint8Array(buffer, glbStart + 20, jsonLength)));
  const binStart = glbStart + 20 + jsonLength + 8;
  if (!isObject(gltf)) {
    throw new Error('glTF 不是对象');
  }
  const required = gltf.extensionsRequired;
  if (Array.isArray(required) && required.length > 0) {
    throw new Error(`不支持的 glTF 扩展：${required.join(', ')}`);
  }
  const accessors = objects(gltf.accessors, 'accessors');
  const bufferViews = objects(gltf.bufferViews, 'bufferViews');
  const meshes = objects(gltf.meshes, 'meshes');
  const nodes = objects(gltf.nodes, 'nodes');
  const scenes = objects(gltf.scenes, 'scenes');

  const rtc = isObject(featureTable) ? numbers(featureTable.RTC_CENTER, 3, [0, 0, 0]) : [0, 0, 0];
  const [rx, ry, rz] = rtc;
  const base = multiply(toLocal, multiply(translation(rx, ry, rz), Y_UP_TO_Z_UP));

  const readAccessor = (index: unknown): Float64Array => {
    const accessor = item(accessors, index, 'accessor');
    const bufferView = item(bufferViews, accessor.bufferView, 'bufferView');
    const componentType = integer(accessor, 'componentType');
    const width = TYPE_SIZES[String(accessor.type)];
    const size = COMPONENT_SIZES[componentType];
    if (width === undefined || size === undefined) {
      throw new Error(`不支持的 accessor：${String(accessor.type)} / ${componentType}`);
    }
    const count = integer(accessor, 'count');
    const stride = integer(bufferView, 'byteStride', width * size);
    const start = binStart + integer(bufferView, 'byteOffset', 0) + integer(accessor, 'byteOffset', 0);
    const out = new Float64Array(count * width);
    if (componentType === 5126 && stride === width * 4 && start % 4 === 0) {
      out.set(new Float32Array(buffer, start, count * width));
      return out;
    }
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < width; k++) {
        out[i * width + k] = readComponent(view, componentType, start + i * stride + k * size);
      }
    }
    return out;
  };

  const chunks: Float32Array[] = [];
  let total = 0;
  const visit = (nodeIndex: unknown, parent: Mat4) => {
    const node = item(nodes, nodeIndex, 'node');
    const m = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of objects(item(meshes, node.mesh, 'mesh').primitives, 'primitives')) {
        const attributes = isObject(primitive.attributes) ? primitive.attributes : {};
        // 只要三角形列表
        if ((primitive.mode ?? 4) !== 4 || attributes.POSITION === undefined) {
          continue;
        }
        const positions = readAccessor(attributes.POSITION);
        const indices = primitive.indices === undefined ? null : readAccessor(primitive.indices);
        const corners = indices ? indices.length : positions.length / 3;
        const out = new Float32Array(corners * 3);
        for (let i = 0; i < corners; i++) {
          const v = (indices ? indices[i] : i) * 3;
          const x = positions[v];
          const y = positions[v + 1];
          const z = positions[v + 2];
          out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        chunks.push(out);
        total += out.length;
      }
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(child => visit(child, m));
    }
  };
  const scene = item(scenes, gltf.scene ?? 0, 'scene');
  if (Array.isArray(scene.nodes)) {
    scene.nodes.forEach(index => visit(index, base));
  }

  const triangles = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    triangles.set(chunk, offset);
    offset += chunk.length;
  }
  return triangles;
}
