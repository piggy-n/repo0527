// @vitest-environment node
import type { SplatEntryInspection, ThreeSceneInspection } from '@mx/map-three';
import { describe, expect, it } from 'vitest';
import type { ProbeSnapshot } from './splat-probe';
import { readoutLines, reportText } from './watch-report';

const MB = 1024 * 1024;

const entry: SplatEntryInspection = {
  budget: 6_000_000,
  visibleSplats: 5_950_000,
  residentChunks: 40,
  loadingChunks: 0,
  loadProgress: 1,
  cpuBytes: 870 * MB,
  gpuBytes: 450 * MB,
  pendingBytes: 0,
  downloadedBytes: 300 * MB,
  peakWasmBytes: 64 * MB
};

const inspection = {
  splatBudget: 6_000_000,
  splats: { 'xz-pc-lcc2': entry },
  tilesets: {},
  triangles: 0,
  cachedBytes: 0
} as unknown as ThreeSceneInspection;

const snapshot = (watch: ProbeSnapshot['watch'], gpu = 'NVIDIA GeForce RTX 3060'): ProbeSnapshot => ({ gpu, fps: 58.24, inspection, watch });

describe('readoutLines', () => {
  it('还没有渲染器时只说在等', () => {
    expect(readoutLines(null)).toEqual(['还没有三维渲染器：等地图和模型加载']);
  });

  it('泼溅的读数：可见的高斯、进度、库估计的内存；监听没开时说没开', () => {
    expect(readoutLines(snapshot(null))).toEqual([
      '显卡：NVIDIA GeForce RTX 3060',
      '帧率：58.2',
      '可见的高斯：595.0 万 / 总预算 600 万',
      '加载进度：100%；分块 驻留 40、加载中 0',
      '库估计：GPU 450 MB，CPU 870 MB，WASM 峰值 64 MB；累计下载 300 MB',
      '瓦片集：0 个，缓存 0 MB；最近一帧的三角形（含泼溅）0',
      'GL 监听：没开'
    ]);
  });

  it('开着监听：帧率不算数，错误分回调里外，库在回调外的调用按次数排', () => {
    const lines = readoutLines(
      snapshot({
        seconds: 61.6,
        errorCount: 2,
        errors: [
          { name: 'texSubImage2D', error: 0x502, inside: false },
          { name: 'drawArrays', error: 0x502, inside: true }
        ],
        libraryOutside: 1300,
        libraryOutsideByMethod: { bindTexture: 300, texSubImage2D: 1000 }
      })
    );
    expect(lines[1]).toBe('帧率：58.2（开着 GL 监听，帧率不算数）');
    expect(lines.slice(6)).toEqual([
      'GL 监听：开了 62 秒；GL 错误 2（记下的 2 条里渲染回调里 1、外 1）',
      '库在渲染回调外的 GL 调用：1,300 次（texSubImage2D 1,000，bindTexture 300）',
      '  错误：texSubImage2D 0x502，渲染回调外',
      '  错误：drawArrays 0x502，渲染回调里'
    ]);
  });

  it('软件渲染时提醒帧率和画面不算数', () => {
    expect(readoutLines(snapshot(null, 'ANGLE (Google, SwiftShader Device)'))[0]).toContain('软件渲染');
  });
});

describe('reportText', () => {
  it('带上时间和设置，发回来时知道是什么条件', () => {
    const text = reportText(snapshot(null), { model: '彭城广场 LCC2 样例', budget: 6_000_000, reference: null, mode: '只看泼溅' }, new Date('2026-11-10T08:00:00Z'));
    expect(text.split('\n').slice(0, 3)).toEqual([
      '高斯泼溅的 GL 监听和预算（/dev/splat-watch，2026-11-10T08:00:00.000Z）',
      '模型：彭城广场 LCC2 样例；总预算 600 万；对照：无；显示：只看泼溅',
      '显卡：NVIDIA GeForce RTX 3060'
    ]);
  });
});
