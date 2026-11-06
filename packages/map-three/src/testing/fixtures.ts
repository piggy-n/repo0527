// 只供测试使用：在内存里生成的瓦片集和 glTF，地址在 https://fixture.test/ 下，由 serveFixtures 拦下 fetch
import { type LngLat, toEcef } from '@mx/map-core';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
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

/** 东北天局部系到地心坐标（列主序），3D Tiles 根节点的 transform */
export function enuToEcef([lng, lat]: LngLat): number[] {
  const lambda = toRadians(lng);
  const phi = toRadians(lat);
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  return [...east, 0, ...north, 0, ...up, 0, ...toEcef(lng, lat, 0), 1];
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
