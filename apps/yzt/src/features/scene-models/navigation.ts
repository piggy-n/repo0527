import {
  buildNavigation,
  buildScanNavigation,
  type NavBuildProgress,
  type Navigation,
  prepareTileset,
  type ScanMesh,
  type ScanNavigation,
  type SplatSource,
  splatNavigationFrame
} from '@mx/map-core';
import { fetchLcc2Index, fetchTilesetJson, type Lcc2Index } from './api';

interface BuildOptions {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: NavBuildProgress) => void;
}

/** 建导航网格（ADR 0085、0086）：读索引、下载最精细一级的瓦片，在 Worker 里构建；测试时换掉 */
export type LoadNavigation = (url: string, options: BuildOptions) => Promise<Navigation>;

export const loadNavigation: LoadNavigation = async (url, { signal, onProgress }) => {
  const tileset = await prepareTileset(url, fetchTilesetJson, signal);
  signal.throwIfAborted();
  return buildNavigation(tileset, { signal, onProgress });
};

/** 清单里出生点的位置：脚下地板的经纬度、椭球高 */
interface SpawnSpot {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
}

/** LCC2 索引里带碰撞网格的节点（ADR 0156 第 2 节）：文件按索引的地址解析，包围盒和网格在同一个局部系里 */
export function scanMeshesOf(index: Lcc2Index, indexUrl: string): ScanMesh[] {
  const files = index.root.meshFiles ?? [];
  const meshes: ScanMesh[] = [];
  const visit = (node: Lcc2Index['root']) => {
    const mesh = node.data?.mesh;
    if (mesh) {
      const file = files.at(mesh.name);
      if (file === undefined) {
        throw new Error(`LCC2 索引的网格序号 ${mesh.name} 超出了 meshFiles（共 ${files.length} 个）`);
      }
      const { min, max } = node.boundingBox;
      meshes.push({ url: new URL(file, indexUrl).href, triangles: mesh.face, min, max });
    }
    Object.values(node.child ?? {}).forEach(visit);
  };
  visit(index.root);
  return meshes;
}

/** 建泼溅（LCC2）的导航网格（ADR 0156）：读索引里的碰撞网格，按清单的摆放和出生点建；测试时换掉 */
export type LoadSplatNavigation = (
  splat: SplatSource,
  spawn: SpawnSpot | undefined,
  options: BuildOptions
) => Promise<ScanNavigation>;

export const loadSplatNavigation: LoadSplatNavigation = async (splat, spawn, { signal, onProgress }) => {
  const index = await fetchLcc2Index(splat.url, signal);
  signal.throwIfAborted();
  // 地面（楼层名、出生点用）取出生点的地板；网格太多时从出生点附近读起
  const near = spawn ? splatNavigationFrame(splat.placement).toLocal(spawn.lng, spawn.lat, spawn.height) : null;
  const frame = splatNavigationFrame(splat.placement, near?.[2]);
  return buildScanNavigation({ meshes: scanMeshesOf(index, splat.url), frame, near }, { signal, onProgress });
};

/** 进度换成 0～1：下载占八成，之后在 Worker 里构建 */
export function buildFraction(progress: NavBuildProgress | null): number {
  if (!progress) {
    return 0;
  }
  return progress.stage === 'download' ? (progress.done / progress.total) * 0.8 : 0.9;
}
