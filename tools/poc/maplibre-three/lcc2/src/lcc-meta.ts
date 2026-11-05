// .lcc2 索引的读取和碰撞数据（.ply + .btree），规范见 github.com/xgrids/LCC2Whitepaper 的 btree_spec.md

export const LCC_BASE = '/lcc2/';

// 索引文件名不写死：?lcc= 指定，否则取样例目录里的第一个 .lcc2
async function resolveLccUrl(): Promise<string> {
  const given = new URLSearchParams(location.search).get('lcc');
  if (given) {
    return LCC_BASE + encodeURIComponent(given);
  }
  const names = (await (await fetch(`${LCC_BASE}__index.json`)).json()) as string[];
  const [first] = names;
  if (!first) {
    throw new Error('样例目录里没有 .lcc2 文件，检查环境变量 LCC2_DIR');
  }
  return LCC_BASE + encodeURIComponent(first);
}

export const LCC_URL = await resolveLccUrl();

export interface LccBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface LccNode {
  readonly id: string;
  readonly boundingBox: LccBox;
  readonly child?: Readonly<Record<string, LccNode>>;
  readonly data?: {
    readonly mesh?: { readonly name: number; readonly vertex: number; readonly face: number };
    readonly bvh?: { readonly name: number };
  };
}

export interface LccIndex {
  readonly epsg: number;
  readonly offset: readonly [number, number, number];
  readonly totalSplats: number;
  readonly lodSplats: readonly number[];
  readonly root: LccNode & { readonly meshFiles?: readonly string[]; readonly bvhFiles?: readonly string[] };
}

export async function loadIndex(): Promise<LccIndex> {
  const response = await fetch(LCC_URL);
  return JSON.parse((await response.text()).replace(/^﻿/, '')) as LccIndex;
}

export interface CollisionNode {
  readonly id: string;
  readonly box: LccBox;
  readonly ply: string;
  readonly btree: string;
  readonly vertices: number;
  readonly faces: number;
}

/** 列出带碰撞数据的节点 */
export function collisionNodes(index: LccIndex): CollisionNode[] {
  const out: CollisionNode[] = [];
  const meshFiles = index.root.meshFiles ?? [];
  const bvhFiles = index.root.bvhFiles ?? [];
  const visit = (node: LccNode) => {
    const { mesh, bvh } = node.data ?? {};
    if (mesh && bvh) {
      out.push({
        id: node.id,
        box: node.boundingBox,
        ply: LCC_BASE + meshFiles[mesh.name],
        btree: LCC_BASE + bvhFiles[bvh.name],
        vertices: mesh.vertex,
        faces: mesh.face
      });
    }
    for (const child of Object.values(node.child ?? {})) {
      visit(child);
    }
  };
  visit(index.root);
  return out;
}

/** 一个碰撞网格：顶点、面（已按 BVH 重排）和 32 字节一个节点的 BVH */
export class CollisionMesh {
  readonly positions: Float32Array;
  readonly indices: Int32Array;
  readonly #nodes: DataView;

  constructor(positions: Float32Array, indices: Int32Array, btree: ArrayBuffer) {
    this.positions = positions;
    this.indices = indices;
    this.#nodes = new DataView(btree);
  }

  get byteLength(): number {
    return this.positions.byteLength + this.indices.byteLength + this.#nodes.byteLength;
  }

  /** 三角形的 xyz，每个三角形 9 个数，可以直接交给 buildNavGrid */
  triangles(): Float32Array {
    const { indices, positions } = this;
    const out = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i += 1) {
      const v = indices[i] * 3;
      out[i * 3] = positions[v];
      out[i * 3 + 1] = positions[v + 1];
      out[i * 3 + 2] = positions[v + 2];
    }
    return out;
  }

  /** 射线和网格的最近交点距离，没有命中时返回 null；方向不必单位化，距离按方向长度计 */
  raycast(origin: readonly number[], direction: readonly number[], maxDistance: number): number | null {
    const stack = [0];
    let best = maxDistance;
    let hit = false;
    const nodes = this.#nodes;
    const inverse = [1 / direction[0], 1 / direction[1], 1 / direction[2]];
    while (stack.length > 0) {
      const offset = stack.pop() as number;
      if (!boxHit(nodes, offset, origin, inverse, best)) {
        continue;
      }
      const field6 = nodes.getUint32(offset + 24, true);
      const low = nodes.getUint16(offset + 28, true);
      const high = nodes.getUint16(offset + 30, true);
      if (high === 0xffff) {
        for (let face = field6; face < field6 + low; face += 1) {
          const t = this.#triangle(face, origin, direction);
          if (t !== null && t < best) {
            best = t;
            hit = true;
          }
        }
      } else {
        stack.push(offset + 32, field6 * 4);
      }
    }
    return hit ? best : null;
  }

  // Möller–Trumbore
  #triangle(face: number, o: readonly number[], d: readonly number[]): number | null {
    const { positions: p, indices } = this;
    const a = indices[face * 3] * 3;
    const b = indices[face * 3 + 1] * 3;
    const c = indices[face * 3 + 2] * 3;
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    const hx = d[1] * e2z - d[2] * e2y;
    const hy = d[2] * e2x - d[0] * e2z;
    const hz = d[0] * e2y - d[1] * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-9) {
      return null;
    }
    const f = 1 / det;
    const sx = o[0] - p[a];
    const sy = o[1] - p[a + 1];
    const sz = o[2] - p[a + 2];
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) {
      return null;
    }
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
    if (v < 0 || u + v > 1) {
      return null;
    }
    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    return t > 1e-6 ? t : null;
  }
}

function boxHit(nodes: DataView, offset: number, o: readonly number[], inverse: readonly number[], far: number): boolean {
  let near = 0;
  let limit = far;
  for (let axis = 0; axis < 3; axis += 1) {
    const min = nodes.getFloat32(offset + axis * 4, true);
    const max = nodes.getFloat32(offset + 12 + axis * 4, true);
    let a = (min - o[axis]) * inverse[axis];
    let b = (max - o[axis]) * inverse[axis];
    if (a > b) {
      [a, b] = [b, a];
    }
    near = Math.max(near, a);
    limit = Math.min(limit, b);
    if (near > limit) {
      return false;
    }
  }
  return true;
}

/** 读一个节点的 .ply（二进制小端，顶点 3 个 float，面 uchar + int 列表）和 .btree */
export async function loadCollisionMesh(node: CollisionNode): Promise<CollisionMesh> {
  const [plyBuffer, btree] = await Promise.all([
    fetch(node.ply).then(r => r.arrayBuffer()),
    fetch(node.btree).then(r => r.arrayBuffer())
  ]);
  const bytes = new Uint8Array(plyBuffer);
  const marker = new TextEncoder().encode('end_header\n');
  let headerEnd = -1;
  for (let i = 0; i < Math.min(bytes.length, 4096); i += 1) {
    if (marker.every((value, j) => bytes[i + j] === value)) {
      headerEnd = i + marker.length;
      break;
    }
  }
  if (headerEnd < 0) {
    throw new Error(`${node.ply} 找不到 end_header`);
  }
  const positions = new Float32Array(plyBuffer.slice(headerEnd, headerEnd + node.vertices * 12));
  const indices = new Int32Array(node.faces * 3);
  const view = new DataView(plyBuffer);
  let cursor = headerEnd + node.vertices * 12;
  for (let face = 0; face < node.faces; face += 1) {
    const count = view.getUint8(cursor);
    if (count !== 3) {
      throw new Error(`${node.ply} 第 ${face} 个面有 ${count} 个顶点`);
    }
    indices[face * 3] = view.getInt32(cursor + 1, true);
    indices[face * 3 + 1] = view.getInt32(cursor + 5, true);
    indices[face * 3 + 2] = view.getInt32(cursor + 9, true);
    cursor += 13;
  }
  return new CollisionMesh(positions, indices, btree);
}
