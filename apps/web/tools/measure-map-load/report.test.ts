// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LOGIN_TO_MAP_STEPS, loginToMap } from '../../src/shared/perf/login-to-map';
import {
  formatComparison,
  formatReport,
  median,
  parseOptions,
  type RawRun,
  STEPS,
  summarizeRun,
  TRACE_NAME
} from './report.ts';

const ORIGIN = 'http://localhost:4173';

function raw(overrides: Partial<RawRun> = {}): RawRun {
  return {
    settled: true,
    measures: { session: 100, runtime: 900, page: 1300, 'view-ready': 2000, settled: 3000 },
    dwellStart: 1000,
    traceStart: 7000,
    longTasks: [],
    requests: [],
    unfinished: [],
    ...overrides
  };
}

describe('步骤与应用一致', () => {
  it('名称和步骤同 src/shared/perf/login-to-map.ts', () => {
    expect(loginToMap.entryName('start')).toBe(`${TRACE_NAME}:start`);
    expect(STEPS).toStrictEqual(LOGIN_TO_MAP_STEPS);
  });
});

describe('parseOptions', () => {
  it('默认三档网络各 5 次、停留 5 秒、用 Edge 有界面运行', () => {
    expect(parseOptions([])).toStrictEqual({
      builds: [{ name: 'dist', dir: 'dist' }],
      runs: 5,
      profiles: ['none', 'fast4g', 'slow4g'],
      dwell: 5000,
      cpu: 1,
      channel: 'msedge',
      headless: false,
      label: 'run',
      url: undefined,
      timeout: 120000
    });
  });

  it('接受 pnpm 转发时的 --，解析给出的参数', () => {
    expect(
      parseOptions(['--', '--runs', '3', '--profiles', 'slow4g', '--cpu', '4', '--label', 'baseline', '--headless'])
    ).toMatchObject({ runs: 3, profiles: ['slow4g'], cpu: 4, label: 'baseline', headless: true });
  });

  it('--builds 按顺序给出要交替测量的构建', () => {
    expect(parseOptions(['--builds', 'baseline=builds.local/baseline, preload = builds.local/preload']).builds).toStrictEqual([
      { name: 'baseline', dir: 'builds.local/baseline' },
      { name: 'preload', dir: 'builds.local/preload' }
    ]);
  });

  it.each([
    [['--builds', 'a=x,a=y'], '名称重复'],
    [['--builds', 'a'], '名称=目录'],
    [['--builds', 'a b=x'], '名称=目录'],
    [['--builds', 'a=x=y'], '名称=目录'],
    [['--builds', 'a=x', '--url', 'http://localhost:5173'], '不能同时给出'],
    [['--runs', '0'], '--runs'],
    [['--runs', '2.5'], '--runs'],
    [['--profiles', 'fast4g,3g'], '--profiles'],
    [['--channel', 'firefox'], '--channel'],
    [['--label', 'a/b'], '--label'],
    [['--unknown'], 'unknown']
  ])('不合法的参数 %j 抛错', (argv, message) => {
    expect(() => parseOptions(argv)).toThrow(message);
  });
});

describe('median', () => {
  it('奇数个取中间，偶数个取中间两个的平均，没有数据时为 undefined', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe('summarizeRun', () => {
  it('按路径认出各种资源，取最后完成的那次', () => {
    const summary = summarizeRun(
      raw({
        requests: [
          { url: `${ORIGIN}/assets/maplibre-gl-B2C8kz_j.js`, finish: 800, bytes: 280_000 },
          { url: `${ORIGIN}/assets/maplibre-gl-worker-MfjJLauD.js`, finish: 1500, bytes: 150_000 },
          { url: `${ORIGIN}/assets/CurrentMapPage-BsDuioMe.js`, finish: 1200, bytes: 160_000 },
          { url: `${ORIGIN}/assets/jiangsu-province-CHledIjM.json`, finish: 1800, bytes: 147_000 },
          { url: `${ORIGIN}/backend/resource-map/base/tree`, finish: 1600, bytes: 9000 },
          { url: `${ORIGIN}/backend/resource-map/base/tree`, finish: 2600, bytes: 9000 }
        ]
      })
    );

    expect(summary.resources).toStrictEqual({
      maplibre: { finish: 800, bytes: 280_000 },
      page: { finish: 1200, bytes: 160_000 },
      worker: { finish: 1500, bytes: 150_000 },
      province: { finish: 1800, bytes: 147_000 },
      catalog: { finish: 2600, bytes: 9000 }
    });
  });

  it('天地图瓦片记张数、最后一张的完成时刻和总大小；总量只算开始之后完成的', () => {
    const summary = summarizeRun(
      raw({
        requests: [
          { url: 'https://t0.tianditu.gov.cn/vec_w/wmts?TILEMATRIX=7', finish: 2400, bytes: 20_000 },
          { url: 'https://t5.tianditu.gov.cn/cva_w/wmts?TILEMATRIX=7', finish: 2900, bytes: 10_000 },
          { url: `${ORIGIN}/assets/LoginPage-ClaogDfb.js`, finish: -5000, bytes: 23_000 }
        ]
      })
    );

    expect(summary.tiles).toStrictEqual({ count: 2, lastFinish: 2900, bytes: 30_000 });
    expect(summary.bytesAfterStart).toBe(30_000);
    expect(summary.resources).toStrictEqual({});
  });

  it('没下载完的请求只留路径，天地图瓦片留主机和路径', () => {
    const summary = summarizeRun(
      raw({
        unfinished: [
          `${ORIGIN}/fonts/AlibabaPuHuiTi-3-75-SemiBold.woff2`,
          'https://t3.tianditu.gov.cn/vec_w/wmts?TILEMATRIX=8&tk=key'
        ]
      })
    );

    expect(summary.unfinished).toStrictEqual(['/fonts/AlibabaPuHuiTi-3-75-SemiBold.woff2', 't3.tianditu.gov.cn/vec_w/wmts']);
  });

  it('长任务只算登录页停留期间的', () => {
    const summary = summarizeRun(
      raw({
        longTasks: [
          { startTime: 500, duration: 300 },
          { startTime: 2000, duration: 80 },
          { startTime: 6900, duration: 120 },
          { startTime: 7000, duration: 400 }
        ]
      })
    );

    expect(summary.dwellLongTasks).toStrictEqual({ count: 2, total: 200, longest: 120 });
  });
});

describe('formatReport', () => {
  it('每档网络一行；中位数只取画面稳定了的几次，没有数据时写 —', () => {
    const report = formatReport([
      {
        profile: 'none',
        runs: [
          summarizeRun(raw()),
          summarizeRun(raw({ measures: { session: 300, settled: 5000 } })),
          summarizeRun(raw({ settled: false, measures: { session: 9999 } }))
        ]
      },
      { profile: 'slow4g', runs: [summarizeRun(raw({ settled: false, measures: {} }))] }
    ]);

    expect(report).toContain('| 不限速 | 2/3 | 200 | 900 | 1300 | 2000 | 4000 |');
    expect(report).toContain('| Slow 4G | 0/1 | — | — | — | — | — |');
  });

  it('资源写完成时刻和大小，Worker 脚本只写完成时刻；没下载完的请求按次数列出', () => {
    const font = `${ORIGIN}/fonts/SemiBold.woff2`;
    const requests = [
      { url: `${ORIGIN}/assets/maplibre-gl-abc.js`, finish: 800, bytes: 280 * 1024 },
      { url: `${ORIGIN}/assets/maplibre-gl-worker-abc.js`, finish: 1500, bytes: 0 }
    ];
    const report = formatReport([
      {
        profile: 'fast4g',
        runs: [
          summarizeRun(raw({ requests, unfinished: [font, font] })),
          summarizeRun(raw({ requests, unfinished: [] }))
        ]
      }
    ]);

    expect(report).toContain('| Fast 4G | 800（280 KB） | —（—） | 1500 | —（—） |');
    expect(report).toContain('- Fast 4G：/fonts/SemiBold.woff2（1/2 次）');
  });
});

describe('formatComparison', () => {
  it('每份构建一行，画面稳定和视图就绪写出和第一份的差，长任务不写差', () => {
    const report = formatComparison([
      { build: 'baseline', profiles: [{ profile: 'slow4g', runs: [summarizeRun(raw())] }] },
      {
        build: 'preload',
        profiles: [
          {
            profile: 'slow4g',
            runs: [
              summarizeRun(
                raw({
                  measures: { 'view-ready': 1500, settled: 2500 },
                  longTasks: [{ startTime: 3000, duration: 180 }]
                })
              )
            ]
          }
        ]
      }
    ]);

    expect(report).toContain('画面稳定（毫秒，括号里是和 baseline 的差）：\n\n| 构建 | Slow 4G |\n|---|---|\n| baseline | 3000 |\n| preload | 2500（-500） |');
    expect(report).toContain('| preload | 1500（-500） |');
    expect(report).toContain('登录页停留期间长任务的总时长（毫秒）：\n\n| 构建 | Slow 4G |\n|---|---|\n| baseline | 0 |\n| preload | 180 |');
  });

  it('慢了时差写成正数，没有构建时为空', () => {
    const report = formatComparison([
      { build: 'a', profiles: [{ profile: 'none', runs: [summarizeRun(raw())] }] },
      { build: 'b', profiles: [{ profile: 'none', runs: [summarizeRun(raw({ measures: { settled: 3200 } }))] }] }
    ]);

    expect(report).toContain('| b | 3200（+200） |');
    expect(formatComparison([])).toBe('');
  });
});
