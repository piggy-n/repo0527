import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl } from 'cesium';
import type { Polygon, Position } from 'geojson';
import { CesiumView } from '@yzt/map-cesium';
import { MapSession, type CameraState, type ScreenBox } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '@/features/resource-map/catalog';
import { planBox, planIdentify, type PickResource, screenBoxPolygon } from '@/features/resource-map/feature-query';
import { isValidPolygonal, QUERY_VERTEX_LIMIT, vertexCount } from '@/features/resource-map/query-geometry';
import { scopeContains } from '@/shared/map/region/region-scope';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

function fixture(camera: CameraState) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = 'width:800px;height:600px;';
  const session = new MapSession({ groups: ['sample'], camera });
  const errors: unknown[] = [];
  const view = new CesiumView({ session, container, assetBaseUrl: '/cesium/', onError: error => errors.push(error) });
  return { view, errors,
    [Symbol.dispose]() { view[Symbol.dispose](); session[Symbol.dispose](); container.remove(); }
  };
}

// 监听先于相机操作登记；超时作为断言数据，释放时一并清除监听和定时器
function settled(view: CesiumView): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remove: (() => void) | undefined;
  return new Promise<boolean>(resolve => {
    remove = view.on('settle', () => resolve(true));
    timer = setTimeout(() => resolve(false), 15000);
  }).finally(() => { clearTimeout(timer); remove?.(); });
}

const catalog = buildCatalog([{ name: '本地测试', code: null, children: [
  { code: 'bgdc_dltb', name: '地类图斑', geoType: 'Polygon', yearList: [2022] },
  { code: 'csxhjctb_hydl', name: '河道', geoType: 'Line', yearList: [2025] },
  { code: 'szy_kt', name: '坑塘', geoType: 'Polygon', yearList: [2025] }
] }]);

function target(code: string, year: number): PickResource {
  const resource = catalog.resources.get(code);
  if (!resource) { throw new Error('测试目录缺少资源'); }
  return { resource, year, sourceId: `resources-${code}`, layerCode: `${code}_${year}` };
}

const DLTB = target('bgdc_dltb', 2022);
const HYDL = target('csxhjctb_hydl', 2025);
const SZY = target('szy_kt', 2025);
const BOX: ScreenBox = { from: { x: 200, y: 240 }, to: { x: 600, y: 500 } };

// 后端经纬度直线每段再取 100 个点，比实现的三个内部检查点更密，独立检验真实椭球投影
function maxBoundaryError(ring: readonly Position[], view: CesiumView, box: ScreenBox): number {
  let maximum = 0;
  for (let index = 1; index < ring.length; index++) {
    const [ax = 0, ay = 0] = ring[index - 1] ?? [];
    const [bx = 0, by = 0] = ring[index] ?? [];
    for (let sample = 0; sample <= 100; sample++) {
      const ratio = sample / 100;
      const point = view.project([ax + (bx - ax) * ratio, ay + (by - ay) * ratio]);
      if (!point) { return Infinity; }
      const distance = Math.min(Math.abs(point.x - box.from.x), Math.abs(point.x - box.to.x),
        Math.abs(point.y - box.from.y), Math.abs(point.y - box.to.y));
      maximum = Math.max(maximum, distance);
    }
  }
  return maximum;
}

describe('三维真实椭球的查询范围', () => {
  it('俯视、斜视和旋转下后端范围保持屏幕精度，查询契约仍为空渲染要素与登记数据集', async () => {
    using ctx = fixture({ center: [119, 32], zoom: 6, bearing: 0, pitch: 0 });
    expect(await settled(ctx.view)).toBe(true);
    const oldErrors: number[] = [];
    for (const pose of [
      { zoom: 6, pitch: 0, bearing: 0 }, { zoom: 5, pitch: 60, bearing: 35 }, { zoom: 11, pitch: 65, bearing: 120 }
    ]) {
      const frame = settled(ctx.view);
      ctx.view.flyTo({ center: [119, 32], ...pose }, { duration: 0 });
      // oxlint-disable-next-line no-await-in-loop -- 同一相机逐个验证姿态，每次都等待真实地表瓦片稳定
      expect(await frame).toBe(true);
      expect(ctx.view.queryRendered(BOX, { sources: [DLTB.sourceId] })).toEqual([]);
      const tasks = planBox([SZY, DLTB], BOX, pose.zoom, ctx.view);
      expect(tasks).toHaveLength(1);
      const task = tasks[0];
      expect(task?.kind).toBe('server');
      if (task?.kind !== 'server' || task.geometry.type !== 'Polygon') { throw new Error('应当生成查询多边形'); }
      expect(task.target).toBe(DLTB);
      expect(vertexCount(task.geometry)).toBeLessThanOrEqual(QUERY_VERTEX_LIMIT);
      expect(isValidPolygonal(task.geometry)).toBe(true);
      const error = maxBoundaryError(task.geometry.coordinates[0] ?? [], ctx.view, BOX);
      expect(error).toBeLessThanOrEqual(2);
      const fourCorners = screenBoxPolygon(BOX, point => ctx.view.pick(point));
      oldErrors.push(fourCorners ? maxBoundaryError(fourCorners.coordinates[0] ?? [], ctx.view, BOX) : Infinity);
      const click = planIdentify([SZY, DLTB], { x: 400, y: 370 }, pose.zoom, ctx.view);
      expect(click).toMatchObject([{ kind: 'server', target: DLTB, geometry: { type: 'Point' } }]);
      const line = planIdentify([HYDL], { x: 400, y: 370 }, pose.zoom, ctx.view);
      expect(line).toMatchObject([{ kind: 'server', target: HYDL, geometry: { type: 'Polygon' } }]);
    }
    expect(Math.max(...oldErrors), '同组姿态必须复现四角直连超过 2 像素').toBeGreaterThan(2);
    expect(ctx.errors).toEqual([]);
  }, 60000);

  it('框跨过天空时明确拒绝，未命中的角点不会被丢弃后继续查询', async () => {
    using ctx = fixture({ center: [119, 32], zoom: 4, bearing: 0, pitch: 85 });
    expect(await settled(ctx.view)).toBe(true);
    const box = { from: { x: 200, y: 0 }, to: { x: 600, y: 550 } };
    expect(ctx.view.pick({ x: 400, y: 0 }).kind).toBe('miss');
    expect(ctx.view.pick({ x: 400, y: 550 }).kind).toBe('hit');
    expect(planBox([DLTB], box, 4, ctx.view)).toEqual([{ kind: 'query-unavailable', reason: 'surface' }]);
    expect(planIdentify([DLTB], { x: 400, y: 0 }, 4, ctx.view))
      .toEqual([{ kind: 'query-unavailable', reason: 'surface' }]);
    const moved = settled(ctx.view);
    ctx.view.flyTo({ center: [179.99, 0], zoom: 6, bearing: 0, pitch: 0 }, { duration: 0 });
    expect(await moved).toBe(true);
    expect(planBox([DLTB], BOX, 6, ctx.view)).toEqual([{ kind: 'query-unavailable', reason: 'geometry' }]);
    expect(ctx.errors).toEqual([]);
  }, 30000);

  it('三维区划求交保留洞和内部边界，点在遮罩内不查询', async () => {
    using ctx = fixture({ center: [119, 32], zoom: 9, bearing: 30, pitch: 50 });
    expect(await settled(ctx.view)).toBe(true);
    const scope: Polygon = { type: 'Polygon', coordinates: [
      [[118.98, 31.98], [119.02, 31.98], [119.02, 32.02], [118.98, 32.02], [118.98, 31.98]],
      [[118.995, 31.995], [119.005, 31.995], [119.005, 32.005], [118.995, 32.005], [118.995, 31.995]]
    ] };
    const box = { from: { x: 100, y: 100 }, to: { x: 700, y: 550 } };
    const tasks = planBox([DLTB], box, 9, ctx.view, scope);
    const task = tasks?.[0];
    expect(task?.kind).toBe('server');
    if (task?.kind !== 'server' || task.geometry.type === 'Point') { throw new Error('应当生成区划内查询范围'); }
    expect(isValidPolygonal(task.geometry)).toBe(true);
    expect(scopeContains(task.geometry, [119, 32])).toBe(false);
    expect(scopeContains(task.geometry, [119.015, 32.015])).toBe(true);
    const center = ctx.view.project([119, 32]);
    expect(center).not.toBeNull();
    expect(center && planIdentify([DLTB], center, 9, ctx.view, scope)).toBeNull();
    expect(ctx.errors).toEqual([]);
  }, 30000);
});
