import type { SplatReadings } from './bench-api.ts';

const MB = 1024 * 1024;

/** 一份泼溅的读数，结构同 map-three 的 SplatEntryInspection：这个模块不依赖 map-three，Node 里能测 */
export interface SplatEntryReading {
  readonly visibleSplats: number;
  readonly residentChunks: number;
  readonly loadingChunks: number;
  readonly loadProgress: number;
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  readonly pendingBytes: number;
  readonly downloadedBytes: number;
  readonly peakWasmBytes: number;
}

/** 泼溅的读数：各份加起来，加载进度取最低的；没有泼溅时为 null */
export function splatReadings(budget: number, entries: readonly SplatEntryReading[]): SplatReadings | null {
  if (entries.length === 0) {
    return null;
  }
  const sum = (read: (item: SplatEntryReading) => number) => entries.reduce((total, item) => total + read(item), 0);
  return {
    budget,
    visible: sum(item => item.visibleSplats),
    residentChunks: sum(item => item.residentChunks),
    loadingChunks: sum(item => item.loadingChunks),
    loadProgress: Math.min(...entries.map(item => item.loadProgress)),
    cpuMB: sum(item => item.cpuBytes) / MB,
    gpuMB: sum(item => item.gpuBytes) / MB,
    pendingMB: sum(item => item.pendingBytes) / MB,
    downloadedMB: sum(item => item.downloadedBytes) / MB,
    peakWasmMB: Math.max(...entries.map(item => item.peakWasmBytes)) / MB
  };
}

/** 泼溅稳定了：每份都读到了索引，当前视角要的细节都到了、没有在加载的分块 */
export function splatsSettled(entries: readonly SplatEntryReading[], expected: number): boolean {
  return entries.length === expected && entries.every(item => item.visibleSplats > 0 && item.loadingChunks === 0 && item.loadProgress >= 1);
}
