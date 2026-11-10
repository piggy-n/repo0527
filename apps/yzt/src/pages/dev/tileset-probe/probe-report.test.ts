// @vitest-environment node
import type { SceneInspection, TilesetInspection } from '@mx/map-cesium';
import type { CameraState } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import {
  buildProbeReport,
  type ProbeEnvironment,
  type ProbeLongTasks,
  type ProbeSample,
  type ProbeSession,
  summarizeInspection
} from './probe-report';

const MB = 1024 * 1024;
const CAMERA: CameraState = { center: [120.3, 31.5], zoom: 16, bearing: 0, pitch: 0 };

interface Numbers {
  readonly frames?: number;
  readonly memoryMB?: number;
  readonly sse?: number;
  readonly floor?: number;
  readonly selected?: number;
  readonly pending?: number;
  readonly processing?: number;
  readonly loaded?: number;
  readonly unloaded?: number;
  readonly failed?: number;
  readonly tilesLoaded?: boolean;
  /** 给了纹素密度才算画过；其他清晰度的数跟着给默认值 */
  readonly density?: number;
  readonly blurry?: number;
  readonly errorPx?: number;
  readonly coarsest?: number;
}

function selectionOf({ density, blurry = 0, errorPx = 8, coarsest = 7.2 }: Numbers) {
  return density === undefined
    ? null
    : { count: 50, texelDensity: density, blurryShare: blurry, errorPixels: errorPx, coarsestError: coarsest };
}

function tilesetOf(id: string, numbers: Numbers): TilesetInspection {
  const { memoryMB = 0, sse = 16, selected = 0, pending = 0, processing = 0, loaded = 0, unloaded = 0, failed = 0 } =
    numbers;
  return {
    id,
    show: true,
    cacheBytes: 1024 * MB,
    maximumCacheOverflowBytes: 512 * MB,
    maximumScreenSpaceError: 16,
    screenSpaceErrorFloor: numbers.floor ?? null,
    memoryAdjustedScreenSpaceError: sse,
    totalMemoryUsageInBytes: memoryMB * MB,
    tilesLoaded: numbers.tilesLoaded ?? true,
    statistics: {
      selected,
      visited: selected * 2,
      numberOfAttemptedRequests: 0,
      numberOfPendingRequests: pending,
      numberOfTilesProcessing: processing,
      numberOfTilesWithContentReady: loaded - unloaded,
      numberOfTilesTotal: 1000,
      numberOfLoadedTilesTotal: loaded,
      numberOfTrianglesSelected: 0
    },
    selection: selectionOf(numbers),
    loaded,
    unloaded,
    failed
  };
}

// tick 固定是帧的两倍
function inspectionOf(numbers: Numbers, tilesets = [tilesetOf('jkq', numbers)]): SceneInspection {
  const { frames = 0 } = numbers;
  return {
    ticks: frames * 2,
    frames,
    imageryLoaded: true,
    renderErrors: 0,
    cameraChanges: 0,
    cameraIdles: 0,
    drawingBufferWidth: 1920,
    drawingBufferHeight: 1080,
    devicePixelRatio: 1,
    renderer: 'NVIDIA GeForce RTX 3060',
    tilesets
  };
}

function sampleOf(
  atMs: number,
  poseIndex: number,
  numbers: Numbers,
  longTasks: ProbeLongTasks = { count: 0, maxMs: 0 }
): ProbeSample {
  return { atMs, poseIndex, camera: CAMERA, inspection: inspectionOf(numbers), longTasks };
}

const ENVIRONMENT: ProbeEnvironment = {
  requestedScreenSpaceError: 16,
  userAgent: 'Chrome/142',
  renderer: 'NVIDIA GeForce RTX 3060',
  devicePixelRatio: 1,
  drawingBuffer: { width: 1920, height: 937 },
  screen: { width: 1920, height: 1080 },
  window: { width: 1920, height: 969 },
  cacheBytes: 1024 * MB,
  maximumCacheOverflowBytes: 512 * MB,
  maximumScreenSpaceError: 16
};

function sessionOf(partial: Partial<ProbeSession>): ProbeSession {
  return {
    startedAt: '2026-11-06T08:00:00.000Z',
    mode: 'sequence',
    model: { id: 'jkq', name: '经开区', url: 'http://example.test/3dt/jkq/tileset.json' },
    environment: ENVIRONMENT,
    poses: [],
    samples: [],
    events: [],
    ...partial
  };
}

// 两个姿态：第一个 0～500 毫秒 3 次采样，第二个 500～1500 毫秒 3 次采样
const SEQUENCE = sessionOf({
  poses: [
    { label: 'z16 俯视', camera: CAMERA, startedMs: 0, endedMs: 500 },
    { label: 'z16 倾斜', camera: { ...CAMERA, pitch: 55 }, startedMs: 500, endedMs: 1500 }
  ],
  samples: [
    sampleOf(0, 0, { frames: 10, loaded: 5, memoryMB: 100, sse: 16, selected: 10, pending: 4, tilesLoaded: false }),
    sampleOf(
      250,
      0,
      { frames: 14, loaded: 8, memoryMB: 300, sse: 20, selected: 5, pending: 2, density: 1.2 },
      { count: 1, maxMs: 120 }
    ),
    sampleOf(500, 0, { frames: 20, loaded: 9, memoryMB: 200, sse: 18, selected: 25, density: 1.3 }, { count: 2, maxMs: 300 }),
    sampleOf(750, 1, { frames: 26, loaded: 12, memoryMB: 400, sse: 18, selected: 40, density: 2 }),
    sampleOf(1000, 1, { frames: 30, loaded: 20, unloaded: 6, memoryMB: 350, sse: 24, selected: 10, density: 1 }),
    sampleOf(1500, 1, {
      frames: 32,
      loaded: 21,
      unloaded: 7,
      failed: 1,
      memoryMB: 360,
      sse: 24,
      floor: 24,
      selected: 30,
      pending: 1,
      processing: 2,
      tilesLoaded: false,
      density: 1.5,
      blurry: 0.25,
      errorPx: 12.345,
      coarsest: 14.6
    })
  ]
});

describe('summarizeInspection', () => {
  it('把各瓦片集加起来：显存、选中、等待、累计计数求和，误差和地板取最大，都就绪才算就绪', () => {
    const totals = summarizeInspection(
      inspectionOf({}, [
        tilesetOf('a', { memoryMB: 100, sse: 16, selected: 10, pending: 1, loaded: 5, unloaded: 1, tilesLoaded: true }),
        tilesetOf('b', {
          memoryMB: 50,
          sse: 24,
          floor: 20,
          selected: 4,
          processing: 2,
          loaded: 3,
          failed: 1,
          tilesLoaded: false,
          density: 1.5
        })
      ])
    );

    expect(totals).toEqual({
      memoryBytes: 150 * MB,
      sse: 24,
      floor: 20,
      selected: 14,
      pending: 1,
      processing: 2,
      loaded: 8,
      unloaded: 1,
      failed: 1,
      tilesLoaded: false,
      // 第一个画过的瓦片集的清晰度
      selection: { count: 50, texelDensity: 1.5, blurryShare: 0, errorPixels: 8, coarsestError: 7.2 }
    });
  });

  it('没有瓦片集时都是 0，不算就绪', () => {
    expect(summarizeInspection(inspectionOf({}, []))).toEqual({
      memoryBytes: 0,
      sse: 0,
      floor: null,
      selected: 0,
      pending: 0,
      processing: 0,
      loaded: 0,
      unloaded: 0,
      failed: 0,
      tilesLoaded: false,
      selection: null
    });
  });
});

describe('buildProbeReport', () => {
  it('每个姿态一行：累计计数按差值，第一个姿态从自己的第一次采样起算，后面的从上一个姿态的最后一次采样起算', () => {
    const { json } = buildProbeReport(SEQUENCE);

    expect(json.session).toBe(SEQUENCE);
    expect(json.poses).toEqual([
      {
        label: 'z16 俯视',
        durationS: 0.5,
        samples: 3,
        frames: 10,
        ticks: 20,
        memoryMaxMB: 300,
        memoryEndMB: 200,
        sseMin: 16,
        sseMax: 20,
        sseEnd: 18,
        floorEnd: null,
        loaded: 4,
        unloaded: 0,
        failed: 0,
        selectedEnd: 25,
        pendingEnd: 0,
        processingEnd: 0,
        tilesLoadedEnd: true,
        longTasks: { count: 3, maxMs: 300 },
        // 10 → 5 虽然跌了一半，起点不到 20，不算
        selectedDrops: 0,
        // 第一次采样还没画过：起点取第一次有密度的
        densityStart: 1.2,
        densityMin: 1.2,
        densityEnd: 1.3,
        blurryShareEnd: 0,
        errorPixelsEnd: 8,
        coarsestErrorEnd: 7.2,
        densityDrops: 0
      },
      {
        label: 'z16 倾斜',
        durationS: 1,
        samples: 3,
        frames: 12,
        ticks: 24,
        memoryMaxMB: 400,
        memoryEndMB: 360,
        sseMin: 18,
        sseMax: 24,
        sseEnd: 24,
        floorEnd: 24,
        loaded: 12,
        unloaded: 7,
        failed: 1,
        selectedEnd: 30,
        pendingEnd: 1,
        processingEnd: 2,
        tilesLoadedEnd: false,
        longTasks: { count: 0, maxMs: 0 },
        // 40 → 10
        selectedDrops: 1,
        // 2 → 1 跌了一半算一次，回到 1.5 不算
        densityStart: 2,
        densityMin: 1,
        densityEnd: 1.5,
        blurryShareEnd: 0.25,
        errorPixelsEnd: 12.35,
        coarsestErrorEnd: 14.6,
        densityDrops: 1
      }
    ]);
  });

  it('清晰→模糊按纹素密度的高点算：低两成以上算一次，之后从新的高点重新算；瓦片数变多也照样算', () => {
    const densities = [2, 1.9, 1.5, 0.8, 2.2, 1.7, 1.75];
    const session = sessionOf({
      poses: [{ label: 'z16 俯视', camera: CAMERA, startedMs: 0, endedMs: 1750 }],
      samples: densities.map((density, index) => sampleOf(index * 250, 0, { selected: 10 + index * 20, density }))
    });
    const [row] = buildProbeReport(session).json.poses;
    // 2 → 1.5（25%）、1.5 → 0.8（47%）、2.2 → 1.7（23%）
    expect(row?.densityDrops).toBe(3);
    expect(row?.selectedDrops).toBe(0);
    expect(row?.densityMin).toBe(0.8);
  });

  it('Markdown 有环境、每个姿态一行的表、事件和怎么读', () => {
    const { markdown } = buildProbeReport(
      sessionOf({
        ...SEQUENCE,
        events: [
          { atMs: 1200, kind: 'warn', message: 'Tile  slow\nagain', count: 2 },
          { atMs: 2000, kind: 'warn', message: 'Tile  slow\nagain', count: 1 },
          { atMs: 3000, kind: 'contextlost', message: 'webglcontextlost', count: 1 }
        ]
      })
    );

    expect(markdown).toContain('# 瓦片集加载诊断\n');
    expect(markdown).toContain('- 模型：经开区（jkq）\n');
    expect(markdown).toContain('- 方式：自动序列\n');
    expect(markdown).toContain('- 采样 6 次，事件 4 次\n');
    expect(markdown).toContain('- 显卡：NVIDIA GeForce RTX 3060\n');
    expect(markdown).toContain('- 屏幕：1920 × 1080，窗口 1920 × 969，devicePixelRatio 1\n');
    expect(markdown).toContain('- 瓦片集：显存预算 1024 MB + 溢出 512 MB，屏幕误差上限 16（设定 16）\n');
    expect(markdown).toContain(
      '| z16 俯视 | 0.5 | 10 / 20 | 300 / 200 | 16 / 20 / 18 | — | 4 / 0 / 0 | 25 | 0 + 0 | 是 | 3 / 300 | ' +
        '1.20 / 1.20 / 1.30 | 0% | 8.00 px / 7.20 m | 0 | 0 |\n'
    );
    expect(markdown).toContain(
      '| z16 倾斜 | 1 | 12 / 24 | 400 / 360 | 18 / 24 / 24 | 24 | 12 / 7 / 1 | 30 | 1 + 2 | 否 | 0 / 0 | ' +
        '2.00 / 1.00 / 1.50 | 25% | 12.35 px / 14.60 m | 1 | 1 |\n'
    );
    expect(markdown).toContain('## 事件\n\n- 1.2 s 起 [console.warn] ×3：Tile slow again\n- 3 s 起 [WebGL 上下文丢失] ×1：webglcontextlost\n');
    expect(markdown).toContain('## 怎么读\n');
  });

  it('显卡取不到、显存预算未知、没有事件时照常生成', () => {
    const { markdown } = buildProbeReport(
      sessionOf({
        environment: {
          ...ENVIRONMENT,
          requestedScreenSpaceError: 24,
          renderer: '',
          cacheBytes: null,
          maximumCacheOverflowBytes: null,
          maximumScreenSpaceError: null
        }
      })
    );

    expect(markdown).toContain('- 显卡：未知（取不到 WEBGL_debug_renderer_info）\n');
    expect(markdown).toContain('- 瓦片集：显存预算 未知 MB + 溢出 未知 MB，屏幕误差上限 未知（设定 24）\n');
    expect(markdown).toContain('## 事件\n\n没有记录到事件\n');
  });

  it('手动记录没有姿态：整段算一行，从第一次采样到最后一次', () => {
    const { json, markdown } = buildProbeReport(
      sessionOf({
        mode: 'manual',
        samples: [
          sampleOf(0, -1, { frames: 10, loaded: 5, memoryMB: 100 }),
          sampleOf(250, -1, { frames: 15, loaded: 7, memoryMB: 150 }),
          sampleOf(500, -1, { frames: 20, loaded: 12, memoryMB: 120 })
        ]
      })
    );

    expect(json.poses.map(({ label, durationS, samples, frames, loaded, memoryMaxMB }) => [label, durationS, samples, frames, loaded, memoryMaxMB]))
      .toEqual([['手动记录', 0.5, 3, 10, 7, 150]]);
    expect(markdown).toContain('- 方式：手动记录\n');
    expect(markdown).toContain('| 手动记录 | 0.5 | 10 / 20 |');
  });

  it('一次采样都没有时给出全 0 的一行，不报错', () => {
    const { json } = buildProbeReport(sessionOf({ mode: 'manual' }));

    expect(json.poses).toHaveLength(1);
    expect(json.poses[0]).toMatchObject({ label: '手动记录', durationS: 0, samples: 0, frames: 0, memoryMaxMB: 0 });
  });
});
