// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type SplatEntryReading, splatReadings, splatsSettled } from './splat-readings.ts';

const MB = 1024 * 1024;

const entry: SplatEntryReading = {
  visibleSplats: 1_000_000,
  residentChunks: 4,
  loadingChunks: 0,
  loadProgress: 1,
  cpuBytes: 100 * MB,
  gpuBytes: 50 * MB,
  pendingBytes: 0,
  downloadedBytes: 30 * MB,
  peakWasmBytes: 20 * MB
};

describe('splatReadings', () => {
  it('没有泼溅时是 null', () => {
    expect(splatReadings(3_000_000, [])).toBeNull();
  });

  it('各份加起来，进度取最低的，WASM 峰值取最大的', () => {
    const other = {
      ...entry,
      visibleSplats: 500_000,
      residentChunks: 2,
      loadingChunks: 1,
      loadProgress: 0.5,
      cpuBytes: 40 * MB,
      peakWasmBytes: 28 * MB
    };
    expect(splatReadings(6_000_000, [entry, other])).toEqual({
      budget: 6_000_000,
      visible: 1_500_000,
      residentChunks: 6,
      loadingChunks: 1,
      loadProgress: 0.5,
      cpuMB: 140,
      gpuMB: 100,
      pendingMB: 0,
      downloadedMB: 60,
      peakWasmMB: 28
    });
  });
});

describe('splatsSettled', () => {
  it('份数对上、细节都到了才算稳定', () => {
    expect(splatsSettled([entry], 1)).toBe(true);
  });

  it('没有泼溅的场景不用等', () => {
    expect(splatsSettled([], 0)).toBe(true);
  });

  it.each([
    ['还有一份没读到索引', [entry], 2],
    ['细节没到', [{ ...entry, loadProgress: 0.99 }], 1],
    ['还在加载分块', [{ ...entry, loadingChunks: 1 }], 1],
    ['一个高斯都没画', [{ ...entry, visibleSplats: 0 }], 1]
  ] as const)('%s 时不算', (_name, entries, expected) => {
    expect(splatsSettled(entries, expected)).toBe(false);
  });
});
