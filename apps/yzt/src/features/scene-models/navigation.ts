import { buildNavigation, type NavBuildProgress, type Navigation, prepareTileset } from '@yzt/map-core';
import { fetchTilesetJson } from './api';

/** 建导航网格（ADR 0085、0086）：读索引、下载最精细一级的瓦片，在 Worker 里构建；测试时换掉 */
export type LoadNavigation = (
  url: string,
  options: { readonly signal: AbortSignal; readonly onProgress: (progress: NavBuildProgress) => void }
) => Promise<Navigation>;

export const loadNavigation: LoadNavigation = async (url, { signal, onProgress }) => {
  const tileset = await prepareTileset(url, fetchTilesetJson, signal);
  signal.throwIfAborted();
  return buildNavigation(tileset, { signal, onProgress });
};

/** 进度换成 0～1：下载占八成，之后在 Worker 里构建 */
export function buildFraction(progress: NavBuildProgress | null): number {
  if (!progress) {
    return 0;
  }
  return progress.stage === 'download' ? (progress.done / progress.total) * 0.8 : 0.9;
}
