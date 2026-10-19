import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl, ImageryLayer } from 'cesium';
import type { Polygon } from 'geojson';
import { CesiumView } from '@yzt/map-cesium';
import { MapSession, type LngLat, type StyleGroup } from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { FILL_PATTERNS, type FillPattern } from '@/features/resource-map/fill-patterns';
import { selectionGroup } from '@/features/resource-map/selection-style';
import { symbolLayers } from '@/features/resource-map/symbols';
import { boundaryGroup } from '@/shared/map/boundary/boundary-style';
import { measureGroup } from '@/shared/map/measure/measure-style';
import { regionClipGroup } from '@/shared/map/region/region-clip';
import type { RegionBoundary } from '@/shared/map/region/region-geometry';
import { regionGroup } from '@/shared/map/region/region-style';
import { SAMPLE_MVT_SOURCE } from './sample-mvt';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

// 测试通过公开视图契约读取真实帧，业务层不引用三维适配器内部文件
function fixture(center: LngLat = [-90, 0], zoom = 11) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = 'width:512px;height:512px;';
  const session = new MapSession({
    groups: ['basemap', 'resources', 'selection', 'region-clip', 'basemap-labels', 'boundaries', 'region', 'measure'],
    camera: { center, zoom, bearing: 0, pitch: 0 }
  });
  session.style.setGroup('basemap', { sources: {}, layers: [
    { id: 'basemap-background', type: 'background', paint: { 'background-color': '#00ff00' } }
  ] });
  const errors: unknown[] = [];
  const view = new CesiumView({ session, container, assetBaseUrl: '/cesium/', onError: error => errors.push(error) });
  return {
    container, session, view, errors,
    [Symbol.dispose]() { view[Symbol.dispose](); session[Symbol.dispose](); container.remove(); }
  };
}

// 在操作前登记稳定帧事件并在回调里取像素，超时保留最后一帧让断言给出实际画面
function nextFrame(
  view: CesiumView,
  container: HTMLElement,
  size = 1,
  accepts: (pixels: readonly number[]) => boolean = () => true
): Promise<readonly number[]> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { throw new Error('浏览器测试需要 Canvas 2D'); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remove: (() => void) | undefined;
  let last: readonly number[] = [];
  return new Promise<readonly number[]>(resolve => {
    remove = view.on('settle', () => {
      const output = container.querySelector('canvas');
      if (!output) { return; }
      context.drawImage(output, Math.floor((output.width - size) / 2), Math.floor((output.height - size) / 2),
        size, size, 0, 0, size, size);
      const pixels = [...context.getImageData(0, 0, size, size).data];
      last = pixels;
      if (accepts(pixels)) { resolve(pixels); }
    });
    timer = setTimeout(() => resolve(last), 15000);
  }).finally(() => { clearTimeout(timer); remove?.(); });
}

// 样式换层可能先发出旧影像的稳定帧，单色断言也要等到目标颜色
function nextColor(ctx: ReturnType<typeof fixture>, color: readonly number[]): Promise<readonly number[]> {
  return nextFrame(ctx.view, ctx.container, 1, pixels => pixels.every((value, index) => value === color[index]));
}

const AREA: Polygon = {
  type: 'Polygon', coordinates: [[[-92, -2], [-88, -2], [-88, 2], [-92, 2], [-92, -2]]]
};

// 蓝色边界应当覆盖绿色背景，取邻域避免恰好落在反锯齿像素上
const hasBlue = (pixels: readonly number[]) => pixels.some((red, index) => index % 4 === 0 && red < 120 &&
  pixels[index + 1] < 170 && pixels[index + 2] > 180);

// 细线花纹经过地球影像的缩小过滤会变浅，仍须同时看见蓝色前景和白色间隙
function patternCoverage(pixels: readonly number[]) {
  const blue = pixels.filter((_, index) => index % 4 === 0 && pixels[index] < 200 &&
    pixels[index + 1] < 200 && pixels[index + 2] > 240).length;
  const white = pixels.filter((_, index) => index % 4 === 0 && pixels[index] > 240 &&
    pixels[index + 1] > 240 && pixels[index + 2] > 240).length;
  return { blue, white };
}

function hasPattern(pixels: readonly number[]): boolean {
  const { blue, white } = patternCoverage(pixels);
  return blue > 50 && white > 50;
}

function patternedResource(pattern: FillPattern): StyleGroup {
  const style = symbolLayers({
    geometry: 'fill', fillColor: '#ffffff', fillStyle: pattern, patternColor: '#0000ff',
    outlineColor: '#ff0000', outlineWidth: 4, outlineDash: 'dashed'
  });
  return {
    sources: { 'resources-area': { type: 'geojson', data: AREA } }, images: style.images,
    layers: style.parts.map(({ suffix, ...part }) => Object.assign({}, part, {
      id: `resources-area${suffix ? `-${suffix}` : ''}`, source: 'resources-area',
      filter: ['==', ['geometry-type'], 'Polygon'] as const
    }))
  };
}

// 本地样例改为零级来源，让两个 guid 点有固定世界坐标，真实 Worker 仍完整解码和绘制
function pointResource(year: string): StyleGroup {
  const source = `resources-${year}`;
  return {
    sources: { [source]: { type: 'vector', tiles: SAMPLE_MVT_SOURCE.tiles, maxzoom: 0, promoteId: 'guid' } },
    layers: [{ id: 'resources-point', type: 'circle', source, 'source-layer': 'detail',
      filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#0000ff', 'circle-radius': 9 } }]
  };
}

describe('实际业务样式的三维装配', () => {
  it('八种业务花纹经过真实视图显示，缩放换档仍保留前景和底色', async () => {
    using ctx = fixture();
    const first = nextColor(ctx, [0, 255, 0, 255]);
    expect(await first).toEqual([0, 255, 0, 255]);
    for (const pattern of FILL_PATTERNS) {
      const frame = nextFrame(ctx.view, ctx.container, 64, hasPattern);
      ctx.session.style.setGroup('resources', patternedResource(pattern));
      // oxlint-disable-next-line no-await-in-loop -- 同一真实视图逐次替换样式，必须等上一张画面稳定
      const pixels = await frame;
      const { blue, white } = patternCoverage(pixels);
      expect(ctx.errors.map(String)).toEqual([]);
      expect(blue, `${pattern} 前景，红通道：${[...new Set(pixels.filter((_, index) => index % 4 === 0))].join(',')}`)
        .toBeGreaterThan(50);
      expect(white, `${pattern} 底色`).toBeGreaterThan(50);
    }
    ctx.session.style.setGroup('resources', patternedResource('diagonal'));
    for (const zoom of [9, 15]) {
      const frame = nextFrame(ctx.view, ctx.container, 64, hasPattern);
      ctx.view.flyTo({ zoom }, { duration: 0 });
      // oxlint-disable-next-line no-await-in-loop -- 同一相机逐个验证缩放换档，不能并发修改
      const pixels = await frame;
      expect(hasPattern(pixels), `级别 ${zoom}：${JSON.stringify(patternCoverage(pixels))}，像素数 ${pixels.length}`)
        .toBe(true);
    }
    expect(ctx.view.sourceErrors.size).toBe(0);
    expect(ctx.errors).toEqual([]);
  }, 90000);

  it('批量高亮只匹配 guid，切换年份与单个详情闪烁使用同一会话', async () => {
    using ctx = fixture();
    const initial = nextColor(ctx, [0, 255, 0, 255]);
    expect(await initial).toEqual([0, 255, 0, 255]);
    const selected = nextColor(ctx, [245, 34, 45, 255]);
    ctx.session.style.setGroups({ resources: pointResource('2022'), selection: selectionGroup(null, false, {
      sourceId: 'resources-2022', sourceLayer: 'detail', minzoom: undefined, guids: ['points-secondary']
    }) });
    expect(await selected).toEqual([245, 34, 45, 255]);
    const other = nextColor(ctx, [0, 0, 255, 255]);
    ctx.session.style.setGroup('selection', selectionGroup(null, false, {
      sourceId: 'resources-2022', sourceLayer: 'detail', minzoom: undefined, guids: ['unselected']
    }));
    expect(await other).toEqual([0, 0, 255, 255]);
    const year = nextColor(ctx, [245, 34, 45, 255]);
    ctx.session.style.setGroups({ resources: pointResource('2025'), selection: selectionGroup(null, false, {
      sourceId: 'resources-2025', sourceLayer: 'detail', minzoom: undefined, guids: ['points-secondary']
    }) });
    expect(await year).toEqual([245, 34, 45, 255]);
    const detail = nextColor(ctx, [255, 120, 117, 255]);
    ctx.session.style.setGroup('selection', selectionGroup({ type: 'Point', coordinates: [-90, 0] }, true));
    expect(await detail).toEqual([255, 120, 117, 255]);
    expect(ctx.session.style.current.sources['resources-2022']).toBeUndefined();
    expect(ctx.view.sourceErrors.size).toBe(0);
    expect(ctx.errors).toEqual([]);
  }, 60000);

  it('世界遮罩保留洞里的岛，盖住选择但不盖住测量，斜视层序不变', async () => {
    const boundary: RegionBoundary = {
      code: 'sample', bounds: [-92, -2, -88, 2], geometry: {
        type: 'MultiPolygon', coordinates: [
          [AREA.coordinates[0], [[-90.5, -0.5], [-90.5, 0.5], [-89.5, 0.5], [-89.5, -0.5], [-90.5, -0.5]]],
          [[[-90.1, -0.1], [-89.9, -0.1], [-89.9, 0.1], [-90.1, 0.1], [-90.1, -0.1]]]
        ]
      }
    };
    using ctx = fixture();
    const initial = nextColor(ctx, [0, 255, 0, 255]);
    expect(await initial).toEqual([0, 255, 0, 255]);
    const island = nextColor(ctx, [245, 34, 45, 255]);
    ctx.session.style.setGroups({
      selection: selectionGroup({ type: 'Point', coordinates: [-90, 0] }, false),
      'region-clip': regionClipGroup(boundary), region: regionGroup(boundary)
    });
    expect(await island).toEqual([245, 34, 45, 255]);
    const hole = nextColor(ctx, [243, 245, 248, 255]);
    ctx.view.flyTo({ center: [-90.3, 0], pitch: 35, bearing: 20 }, { duration: 0 });
    expect(await hole).toEqual([243, 245, 248, 255]);
    const hidden = nextColor(ctx, [243, 245, 248, 255]);
    ctx.session.style.setGroup('selection', selectionGroup({ type: 'Point', coordinates: [-90.3, 0] }, false));
    expect(await hidden).toEqual([243, 245, 248, 255]);
    const measure = nextColor(ctx, [89, 126, 247, 255]);
    ctx.session.style.setGroup('measure', measureGroup({
      measurements: [], draft: { kind: 'distance', points: [[-90.3, 0]], preview: null }
    }));
    expect(await measure).toEqual([89, 126, 247, 255]);
    // 此斜视存在 SDK 的微小姿态噪声；稳定后再次移动仍须合并影像刷新
    const destroy = vi.spyOn(ImageryLayer.prototype, 'destroy');
    try {
      const zoomed = nextColor(ctx, [89, 126, 247, 255]);
      ctx.view.flyTo({ zoom: 12 }, { duration: 700 });
      expect(await zoomed).toEqual([89, 126, 247, 255]);
      expect(ctx.session.camera.current.zoom).toBeCloseTo(12, 5);
      expect(destroy.mock.calls.length).toBeLessThanOrEqual(ctx.session.style.current.layers.length);
    } finally {
      destroy.mockRestore();
    }
    expect(ctx.view.sourceErrors.size).toBe(0);
    expect(ctx.errors).toEqual([]);
  }, 60000);

  it('实际省市县界的本地 URL、虚线与光晕能共同进入三维视图', async () => {
    // 本地省界的首个顶点，取邻域确认确实画出边线，不能只靠“没有错误”判断 URL 加载成功
    using ctx = fixture([119.915389, 31.173165], 13);
    const frame = nextFrame(ctx.view, ctx.container, 64, hasBlue);
    ctx.session.style.setGroup('boundaries', boundaryGroup({
      visible: { province: true, city: true, county: true }, opacity: 1
    }));
    const pixels = await frame;
    expect(ctx.errors.map(String)).toEqual([]);
    expect(hasBlue(pixels), `中心像素：${pixels.slice(0, 12).join(',')}；像素数：${pixels.length}`).toBe(true);
    expect(ctx.view.sourceErrors.size).toBe(0);
    expect(ctx.errors).toEqual([]);
  }, 30000);
});
