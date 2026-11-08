// 只供测试使用：在内存里生成的瓦片集和 glTF，地址在 https://fixture.test/ 下，由 serveFixtures 拦下 fetch
import { type LngLat, toEcef } from '@mx/map-core';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  DataTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export const FIXTURE_ORIGIN = 'https://fixture.test';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** 东北天局部系到地心坐标（列主序），3D Tiles 根节点的 transform；原点在 height 米的椭球高处 */
export function enuToEcef([lng, lat]: LngLat, height = 0): number[] {
  const lambda = toRadians(lng);
  const phi = toRadians(lat);
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  return [...east, 0, ...north, 0, ...up, 0, ...toEcef(lng, lat, height), 1];
}

async function exportGlb(object: Group | Mesh, animations: AnimationClip[] = []): Promise<ArrayBuffer> {
  const result = await new GLTFExporter().parseAsync(object, { binary: true, animations });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter 没有给出 GLB');
  }
  return result;
}

/** 底面在原点、边长 2 × half 米的红色立方体（glTF 的 y 朝上，3D Tiles 加载时转成 z 朝上） */
export function boxGlb(half: number): Promise<ArrayBuffer> {
  const geometry = new BoxGeometry(half * 2, half * 2, half * 2).translate(0, half, 0);
  return exportGlb(new Mesh(geometry, new MeshBasicMaterial({ color: 0xff0000 })));
}

/**
 * 立方体放在 at 的地面上的瓦片集；content 是相对地址。根节点只分组、下面一个带内容的叶节点，和真实数据一样
 * （只有一个叶节点时 prepareTileset 把整个瓦片集的误差整理成 0）
 */
export function boxTileset(at: LngLat, half: number, content = 'box.glb'): unknown {
  const boundingVolume = { sphere: [0, 0, half, half * 1.8] };
  return {
    asset: { version: '1.1' },
    geometricError: half * 4,
    root: {
      transform: enuToEcef(at),
      boundingVolume,
      geometricError: half * 4,
      refine: 'ADD',
      children: [{ boundingVolume, geometricError: 0, content: { uri: content } }]
    }
  };
}

/**
 * 两节骨头的手臂：竖直的长方体蒙在两节骨头上，上面一节绕 z 轴来回摆（1 秒一个来回）；
 * 用来确认 glTF 的骨骼动画在自写层里能播放
 */
export function swingingArmGlb(height: number): Promise<ArrayBuffer> {
  const geometry = new BoxGeometry(height / 4, height, height / 4, 1, 8, 1).translate(0, height / 2, 0);
  const position = geometry.getAttribute('position');
  const indices: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < position.count; i++) {
    // 下半截跟第一节骨头，上半截跟第二节
    const upper = position.getY(i) > height / 2;
    indices.push(upper ? 1 : 0, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const root = new Bone();
  root.name = 'shoulder';
  const elbow = new Bone();
  elbow.name = 'elbow';
  elbow.position.y = height / 2;
  root.add(elbow);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ color: 0x00ff00 }));
  mesh.add(root);
  mesh.bind(new Skeleton([root, elbow]));
  const axis = new Vector3(0, 0, 1);
  const swing = (angle: number) => new Quaternion().setFromAxisAngle(axis, toRadians(angle)).toArray();
  const clip = new AnimationClip('swing', 1, [
    new QuaternionKeyframeTrack('elbow.quaternion', [0, 0.5, 1], [...swing(-80), ...swing(80), ...swing(-80)])
  ]);
  const group = new Group();
  group.add(mesh);
  return exportGlb(group, [clip]);
}

/**
 * 两层的屋子（ADR 0147 第 4 节的验收）：20 × 20 米，下层地板在局部 0 米，东半边 5 米高处是上层，四面墙和 8 米高的顶板；
 * 原点在屋子中央的下层地板上（glTF 的 y 朝上）
 */
export function roomGlb(): Promise<ArrayBuffer> {
  const material = new MeshBasicMaterial({ color: 0xff0000 });
  const group = new Group();
  const slab = (width: number, depth: number, x: number, y: number, z: number, height = 0.2) =>
    group.add(new Mesh(new BoxGeometry(width, height, depth).translate(x, y - height / 2, z), material));
  slab(20, 20, 0, 0, 0);
  slab(10, 20, 5, 5, 0);
  slab(20, 20, 0, 8.2, 0);
  for (const [width, depth, x, z] of [
    [20, 0.2, 0, -10],
    [20, 0.2, 0, 10],
    [0.2, 20, -10, 0],
    [0.2, 20, 10, 0]
  ] as const) {
    group.add(new Mesh(new BoxGeometry(width, 8, depth).translate(x, 4, z), material));
  }
  return exportGlb(group);
}

/** 屋子的瓦片集：下层地板在 at 处 floor 米的椭球高上，根节点是盒子 */
export function roomTileset(at: LngLat, floor: number, content = 'room.glb'): unknown {
  const boundingVolume = { box: [0, 0, 4, 10.2, 0, 0, 0, 10.2, 0, 0, 0, 4.4] };
  return {
    asset: { version: '1.1' },
    geometricError: 40,
    root: {
      transform: enuToEcef(at, floor),
      boundingVolume,
      geometricError: 40,
      refine: 'ADD',
      children: [{ boundingVolume, geometricError: 0, content: { uri: content } }]
    }
  };
}

/** 边长 2 × half 米、贴一张 size × size 贴图的立方体：瓦片的显存主要看贴图 */
export function texturedBoxGlb(half: number, size: number): Promise<ArrayBuffer> {
  const pixels = new Uint8Array(size * size * 4).fill(255);
  const map = new DataTexture(pixels, size, size);
  map.needsUpdate = true;
  const geometry = new BoxGeometry(half * 2, half * 2, half * 2).translate(0, half, 0);
  return exportGlb(new Mesh(geometry, new MeshBasicMaterial({ map })));
}

/**
 * JKQ2 那样的瓦片集：根节点只分组（没有内容），下面 blocks × blocks 个并排的块，每块一个粗的瓦片，下面一组 4 块细的。
 * 各块离相机一样远时，细的那一层要么全要、要么全不要；blockError、fineError 是粗、细两层的几何误差
 */
export function blockTileset(
  at: LngLat,
  { blocks, spacing, blockError, fineError }: { blocks: number; spacing: number; blockError: number; fineError: number }
): unknown {
  const half = (blocks * spacing) / 2;
  const fine = (x: number, y: number) => ({
    boundingVolume: { box: [x, y, 5, spacing / 4, 0, 0, 0, spacing / 4, 0, 0, 0, 5] },
    geometricError: fineError,
    content: { uri: 'fine.glb' }
  });
  const children = Array.from({ length: blocks * blocks }, (_, index) => {
    const x = (index % blocks) * spacing - half + spacing / 2;
    const y = Math.floor(index / blocks) * spacing - half + spacing / 2;
    return {
      boundingVolume: { box: [x, y, 5, spacing / 2, 0, 0, 0, spacing / 2, 0, 0, 0, 5] },
      geometricError: blockError,
      refine: 'REPLACE',
      content: { uri: 'block.glb' },
      children: [
        fine(x - spacing / 4, y - spacing / 4),
        fine(x + spacing / 4, y - spacing / 4),
        fine(x - spacing / 4, y + spacing / 4),
        fine(x + spacing / 4, y + spacing / 4)
      ]
    };
  });
  return {
    asset: { version: '1.1' },
    geometricError: blockError,
    root: {
      transform: enuToEcef(at),
      boundingVolume: { box: [0, 0, 5, half, 0, 0, 0, half, 0, 0, 0, 5] },
      geometricError: blockError,
      refine: 'REPLACE',
      children
    }
  };
}

/** GLB 包成 b3dm（导航网格只读 b3dm）：28 字节的头、只有 BATCH_LENGTH 的特征表（按 8 字节对齐） */
export function b3dmOf(glb: ArrayBuffer): ArrayBuffer {
  const featureText = JSON.stringify({ BATCH_LENGTH: 0 });
  const feature = new TextEncoder().encode(featureText.padEnd(Math.ceil(featureText.length / 8) * 8, ' '));
  const out = new ArrayBuffer(28 + feature.length + glb.byteLength);
  const view = new DataView(out);
  new Uint8Array(out).set(new TextEncoder().encode('b3dm'), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, feature.length, true);
  new Uint8Array(out).set(feature, 28);
  new Uint8Array(out).set(new Uint8Array(glb), 28 + feature.length);
  return out;
}

/** 拦下 https://fixture.test/ 的 fetch，按路径给出内存里的内容；返回撤销函数 */
export function serveFixtures(files: Readonly<Record<string, unknown>>): () => void {
  const original = window.fetch;
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== FIXTURE_ORIGIN) {
      return original(input, init);
    }
    const body = files[url.pathname];
    if (body === undefined) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    return Promise.resolve(
      body instanceof ArrayBuffer ? new Response(body) : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    );
  };
  return () => {
    window.fetch = original;
  };
}
