// 只供测试使用：在局部系（x 东、y 北、z 上，米）里拼几何，写成 b3dm

/** 水平矩形（两个三角形），高度 z */
export function floorQuad(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  return [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
}

/** 竖直的墙：从 (x0, y0) 到 (x1, y1)，高度从 bottom 到 top */
export function wallQuad(x0: number, y0: number, x1: number, y1: number, bottom: number, top: number): number[] {
  return [x0, y0, bottom, x1, y1, bottom, x1, y1, top, x0, y0, bottom, x1, y1, top, x0, y0, top];
}

/** 一段楼梯：沿 +y 从 y0 走到 y1，从 z0 爬到 z1，每级踏面一个水平矩形 */
export function stairs(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  steps: number
): number[] {
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const z = z0 + ((z1 - z0) * (i + 1)) / steps;
    out.push(...floorQuad(x0, y0 + ((y1 - y0) * i) / steps, x1, y0 + ((y1 - y0) * (i + 1)) / steps, z));
  }
  return out;
}

export function triangles(...parts: readonly number[][]): Float32Array {
  return Float32Array.from(parts.flat());
}

export interface B3dmOptions {
  /** 特征表的 RTC_CENTER（局部系里，z 向上） */
  readonly rtc?: readonly [number, number, number];
  /** 写成带索引的三角形 */
  readonly indexed?: boolean;
  /** 再加一个不是三角形列表（线）的图元，解析时应跳过 */
  readonly withLines?: boolean;
  readonly extensionsRequired?: readonly string[];
}

const pad = (length: number, to: number) => Math.ceil(length / to) * to;

/** 把局部系里的三角形写成 b3dm：glTF 是 y 向上，所以写成 (x, z - rz, -(y - ry)) 再减去 RTC */
export function b3dmOf(
  points: Float32Array,
  { rtc, indexed = false, withLines = false, extensionsRequired }: B3dmOptions = {}
): ArrayBuffer {
  const [rx, ry, rz] = rtc ?? [0, 0, 0];
  const count = points.length / 3;
  const positions = new Float32Array(points.length);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = points[i * 3] - rx;
    positions[i * 3 + 1] = points[i * 3 + 2] - rz;
    positions[i * 3 + 2] = -(points[i * 3 + 1] - ry);
  }
  const indices = indexed ? Uint16Array.from({ length: count }, (_, i) => i) : null;
  const positionBytes = positions.byteLength;
  const indexBytes = indices ? pad(indices.byteLength, 4) : 0;
  const bin = new Uint8Array(positionBytes + indexBytes);
  bin.set(new Uint8Array(positions.buffer), 0);
  if (indices) {
    bin.set(new Uint8Array(indices.buffer), positionBytes);
  }
  const primitives: Record<string, unknown>[] = [
    { attributes: { POSITION: 0 }, mode: 4, ...(indices ? { indices: 1 } : {}) }
  ];
  if (withLines) {
    primitives.push({ attributes: { POSITION: 0 }, mode: 1 });
  }
  const gltf = {
    asset: { version: '2.0' },
    ...(extensionsRequired ? { extensionsRequired } : {}),
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ children: [1] }, { mesh: 0 }],
    meshes: [{ primitives }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3' },
      ...(indices ? [{ bufferView: 1, componentType: 5123, count, type: 'SCALAR' }] : [])
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes },
      ...(indices ? [{ buffer: 0, byteOffset: positionBytes, byteLength: indices.byteLength }] : [])
    ],
    buffers: [{ byteLength: bin.byteLength }]
  };
  const encoder = new TextEncoder();
  const jsonText = JSON.stringify(gltf);
  const json = encoder.encode(jsonText.padEnd(pad(encoder.encode(jsonText).length, 4), ' '));
  const glbLength = 12 + 8 + json.length + 8 + bin.length;
  const featureText = JSON.stringify(rtc ? { BATCH_LENGTH: 0, RTC_CENTER: rtc } : { BATCH_LENGTH: 0 });
  const feature = encoder.encode(featureText.padEnd(pad(featureText.length, 8), ' '));
  const total = 28 + feature.length + glbLength;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  bytes.set(encoder.encode('b3dm'), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, total, true);
  view.setUint32(12, feature.length, true);
  bytes.set(feature, 28);
  const glb = 28 + feature.length;
  bytes.set(encoder.encode('glTF'), glb);
  view.setUint32(glb + 4, 2, true);
  view.setUint32(glb + 8, glbLength, true);
  view.setUint32(glb + 12, json.length, true);
  bytes.set(encoder.encode('JSON'), glb + 16);
  bytes.set(json, glb + 20);
  view.setUint32(glb + 20 + json.length, bin.length, true);
  bytes.set(encoder.encode('BIN\0'), glb + 24 + json.length);
  bytes.set(bin, glb + 28 + json.length);
  return out;
}

/**
 * 两层的小车站：下层 -10 米（0～20 × 0～12），楼梯（x 8～10，y 12～17，每级 0.2 米）上到 -5 米的上层（0～20 × 17～29），
 * 上层旁边隔开一间 10 × 12 米的房间（x 22～32），下层旁边一间 6 × 12 米的小房间（x 22～28）；-1 米处一整块顶板
 */
export function twoLevelStation(): Float32Array {
  return triangles(
    floorQuad(0, 0, 20, 12, -10),
    stairs(8, 10, 12, 17, -10, -5, 25),
    floorQuad(0, 17, 20, 29, -5),
    floorQuad(22, 17, 32, 29, -5),
    floorQuad(22, 0, 28, 12, -10),
    floorQuad(0, 0, 32, 29, -1)
  );
}
