// 三维冒烟用的模型（3D.5c）：一间 12 米见方的屋子，地板在地面以下 6 米、顶板在地面以上 6 米；
// 生成 glb 包成 b3dm，再给出瓦片集索引和清单。模型数据不入库，CI 里也没有，所以冒烟自己生成

/** 屋子中心的经纬度 */
export const ROOM_AT = [120.66, 31.31] as const;

const HALF = 6;

// GLB 的块按 4 字节对齐要补的字节数
const padding = (length: number, to: number) => (to - (length % to)) % to;

// 立方体（glTF 2.0 的 GLB，不受光照的灰色）：8 个角、12 个三角形，朝里朝外都画
function cubeGlb(): Uint8Array {
  const h = HALF;
  const positions = new Float32Array([
    // z = -h 的四个角
    -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
    // z = h 的四个角
    -h, -h, h, h, -h, h, h, h, h, -h, h, h
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3
  ]);
  const gltf = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0 },
        doubleSided: true,
        extensions: { KHR_materials_unlit: {} }
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-h, -h, -h], max: [h, h, h] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 }
    ],
    buffers: [{ byteLength: positions.byteLength + indices.byteLength }]
  };
  // JSON 块补空格、二进制块补 0
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonChunk = new Uint8Array(json.length + padding(json.length, 4)).fill(0x20);
  jsonChunk.set(json);
  const binLength = positions.byteLength + indices.byteLength;
  const binChunk = new Uint8Array(binLength + padding(binLength, 4));
  binChunk.set(new Uint8Array(positions.buffer), 0);
  binChunk.set(new Uint8Array(indices.buffer), positions.byteLength);
  const glb = new Uint8Array(12 + 8 + jsonChunk.length + 8 + binChunk.length);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.byteLength, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonChunk, 20);
  const binStart = 20 + jsonChunk.length;
  view.setUint32(binStart, binChunk.length, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  glb.set(binChunk, binStart + 8);
  return glb;
}

/** 屋子的 b3dm：28 字节的头、只有 BATCH_LENGTH 的特征表（按 8 字节对齐），没有批量表 */
export function roomB3dm(): Buffer {
  const glb = cubeGlb();
  const featureText = JSON.stringify({ BATCH_LENGTH: 0 });
  const padded = featureText.padEnd(featureText.length + padding(featureText.length, 8), ' ');
  const feature = new TextEncoder().encode(padded);
  const out = new Uint8Array(28 + feature.length + glb.length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('b3dm'), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, feature.length, true);
  out.set(feature, 28);
  out.set(glb, 28 + feature.length);
  return Buffer.from(out);
}

// WGS84 上一点的东北天坐标系（列主序的 4×4 矩阵）：瓦片集根节点的 transform
function eastNorthUp([lng, lat]: readonly [number, number]): number[] {
  const a = 6378137;
  const e2 = 6.69437999014e-3;
  const [lambda, phi] = [(lng * Math.PI) / 180, (lat * Math.PI) / 180];
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const origin = [
    n * Math.cos(phi) * Math.cos(lambda),
    n * Math.cos(phi) * Math.sin(lambda),
    n * (1 - e2) * Math.sin(phi)
  ];
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  return [...east, 0, ...north, 0, ...up, 0, ...origin, 1];
}

/** 只有一个瓦片的瓦片集：根节点就是叶节点，内容是 room.b3dm */
export function roomTileset(): object {
  return {
    asset: { version: '1.0' },
    geometricError: 100,
    root: {
      transform: eastNorthUp(ROOM_AT),
      boundingVolume: { sphere: [0, 0, 0, HALF * 2] },
      geometricError: 0,
      refine: 'ADD',
      content: { uri: 'room.b3dm' }
    }
  };
}

/** 只有这间屋子的清单：地下的室内模型，出生点在地板中央、朝东 */
export function roomManifest(): object {
  return {
    models: [
      {
        id: 'smoke-room',
        name: '冒烟测试屋',
        cityCode: '320500',
        kind: 'indoor',
        underground: true,
        tileset: 'smoke-room/tileset.json',
        spawn: { lng: ROOM_AT[0], lat: ROOM_AT[1], height: -HALF, heading: 90 }
      }
    ]
  };
}
