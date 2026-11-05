import { GaussianSplatRenderer, Lcc2StreamScheduler } from 'gaussian-splat-lite';
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { collisionNodes, type CollisionMesh, type CollisionNode, LCC_URL, loadCollisionMesh, loadIndex } from './lcc-meta.ts';

const params = new URLSearchParams(location.search);
const budget = Number(params.get('budget') ?? 300000);
const view = document.querySelector<HTMLElement>('#view');
const hud = document.querySelector<HTMLElement>('#hud');
if (!view || !hud) {
  throw new Error('缺少页面元素');
}

const errors: string[] = [];
window.addEventListener('error', event => errors.push(`window: ${event.message}`));
window.addEventListener('unhandledrejection', event => errors.push(`rejection: ${String(event.reason)}`));

// antialias 关掉：库的文档说多重采样只会拖慢泼溅
const renderer = new WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(view.clientWidth, view.clientHeight);
view.append(renderer.domElement);

const scene = new Scene();
// 文件是 Z 向上：只在这里转成 Three 的 Y 向上；相机坐标用文件坐标，walk 时好和索引对照
const camera = new PerspectiveCamera(60, view.clientWidth / view.clientHeight, 0.05, 8000);
camera.up.set(0, 0, 1);

const splatRenderer = new GaussianSplatRenderer({ renderer });
scene.add(splatRenderer);

const startedAt = performance.now();
let firstRenderableMs: number | null = null;
const streaming = new Lcc2StreamScheduler({
  splatBudget: budget,
  maxSh: 0,
  splatBudgetMode: 'limit',
  maxConcurrentLoads: Number(params.get('loads') ?? 2),
  cooldownMs: Number(params.get('cooldown') ?? 500),
  fadeDurationMs: 0,
  lodBaseDistance: Number(params.get('lodBase') ?? 100),
  onError: (error: unknown, url?: string) => errors.push(`load ${url ?? ''}: ${String(error)}`)
});
scene.add(streaming.group);
streaming.setCamera(camera);
const sourceId = await streaming.addSource({ url: LCC_URL, environment: params.get('env') === '1' });
void streaming.firstRenderable.then(() => {
  firstRenderableMs = performance.now() - startedAt;
});

const index = await loadIndex();
const { min, max } = index.root.boundingBox;
const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
camera.position.set(center.x, center.y - 260, max[2] + 220);
camera.lookAt(center);

let frames = 0;
let frameMs = 0;
let last = performance.now();
function loop(): void {
  const now = performance.now();
  frameMs = now - last;
  last = now;
  streaming.update();
  renderer.render(scene, camera);
  frames += 1;
}
renderer.setAnimationLoop(loop);

function stats(): Record<string, unknown> {
  const raw = streaming.stats as unknown as Record<string, number>;
  return {
    ...raw,
    residentCpuMB: Math.round((raw.residentCpuBytes ?? 0) / 1048576),
    residentGpuMB: Math.round((raw.residentGpuBytes ?? 0) / 1048576),
    firstRenderableMs: firstRenderableMs === null ? null : Math.round(firstRenderableMs),
    frames,
    frameMs: Math.round(frameMs),
    budget: streaming.splatBudget,
    heapMB: Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576),
    errors: errors.length
  };
}

// ---------- 碰撞：.ply + .btree ----------

const nodes = collisionNodes(index);
const meshes = new Map<string, CollisionMesh>();

function containing(x: number, y: number, z: number): CollisionNode[] {
  return nodes.filter(({ box: { min: a, max: b } }) => x >= a[0] && x <= b[0] && y >= a[1] && y <= b[1] && z >= a[2] && z <= b[2]);
}

async function meshesAt(x: number, y: number, z: number): Promise<CollisionMesh[]> {
  const out: CollisionMesh[] = [];
  for (const node of containing(x, y, z)) {
    let mesh = meshes.get(node.id);
    if (!mesh) {
      mesh = await loadCollisionMesh(node);
      meshes.set(node.id, mesh);
    }
    out.push(mesh);
  }
  return out;
}

/** 从 (x, y, z) 朝下打射线，返回地板的 z；同时查这个点所在的所有节点 */
async function floorAt(x: number, y: number, z: number, maxDistance = 6): Promise<{ floor: number | null; nodes: number; ms: number }> {
  const candidates = await meshesAt(x, y, z);
  const start = performance.now();
  let best: number | null = null;
  for (const mesh of candidates) {
    const t = mesh.raycast([x, y, z], [0, 0, -1], maxDistance);
    if (t !== null && (best === null || t < best)) {
      best = t;
    }
  }
  return { floor: best === null ? null : z - best, nodes: candidates.length, ms: performance.now() - start };
}

function setPose(x: number, y: number, z: number, headingDeg: number, pitchDeg = 0): void {
  const heading = (headingDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  camera.position.set(x, y, z);
  camera.lookAt(x + Math.sin(heading) * Math.cos(pitch), y + Math.cos(heading) * Math.cos(pitch), z + Math.sin(pitch));
}

async function poses(): Promise<{ T: [number, number, number]; R: [number, number, number, number]; ts: string }[]> {
  const text = await (await fetch('/lcc2/info/poses.json')).text();
  return (JSON.parse(text.replace(/^﻿/, '')) as { fusionPoses: { T: [number, number, number]; R: [number, number, number, number]; ts: string }[] }).fusionPoses;
}

Object.assign(window, {
  lcc: {
    renderer,
    scene,
    camera,
    splatRenderer,
    streaming,
    sourceId,
    index,
    errors,
    nodes,
    meshes,
    stats,
    setPose,
    floorAt,
    meshesAt,
    poses,
    center
  },
  lccReady: true
});

setInterval(() => {
  hud.textContent = JSON.stringify(stats()).replace(/,/g, '\n').replace(/[{}"]/g, '');
}, 500);
