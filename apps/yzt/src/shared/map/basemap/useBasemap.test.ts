// @vitest-environment node
import type { StyleGroup } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import { computed, createApp } from 'vue';
import { appConfig } from '../../config/app-config';
import type { ServerBasemapId } from '../../config/server-basemap-options';
import { type BasemapId, basemapOptions } from './basemap-style';
import { SERVER_BASEMAPS, type ServerBasemaps } from './server-basemaps';
import { staticLabelsGroup } from './static-basemap';
import { useBasemap } from './useBasemap';

const TIANDITU = { key: '0123456789abcdef0123456789abcdef' };

// 探测到的服务器底图（ADR 0165）
const servers = (...ids: ServerBasemapId[]): ServerBasemaps =>
  ids.map(id => ({ id, root: `http://intranet.test/basemap/${id}/`, thumbnail: `data:image/png;base64,${id}` }));
const ALL_FOUR = servers('standard', 'imagery', 'black', 'night-blue');

// 分组里各图层的透明度，按图层 ID
function opacities(group: StyleGroup) {
  return Object.fromEntries(
    group.layers.flatMap(layer => (layer.type === 'raster' ? [[layer.id, layer.paint?.['raster-opacity']]] : []))
  );
}

describe('useBasemap', () => {
  it('默认读取 appConfig.tianditu', () => {
    expect(useBasemap().options).toStrictEqual(basemapOptions(appConfig.tianditu));
  });

  it('开启天地图：三种底图可选，进入时是矢量底图，透明度 1', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    expect(basemap.options.map(option => option.id)).toStrictEqual(['vector', 'imagery', 'none']);
    expect(basemap.selected.value).toBe('vector');
    expect(basemap.opacity.value).toBe(1);
    expect(Object.keys(basemap.deriveGroup().sources)).toStrictEqual(['basemap-vector']);
    expect(JSON.stringify([basemap.deriveGroup(), basemap.deriveLabelsGroup()])).toContain(`tk=${TIANDITU.key}`);
  });

  it('关闭天地图：静态底图和无底图可选，进入时是静态底图，推导结果里没有天地图', () => {
    const basemap = useBasemap({ tianditu: null });

    expect(basemap.options.map(option => option.id)).toStrictEqual(['static', 'none']);
    expect(basemap.selected.value).toBe('static');
    expect(basemap.opacity.value).toBe(1);
    expect(Object.keys(basemap.deriveGroup().sources)).toStrictEqual(['basemap-static']);
    expect(basemap.labelsVisible.value).toBe(false);
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);
    basemap.setLabelsVisible(true);
    expect(basemap.deriveLabelsGroup()).toStrictEqual(staticLabelsGroup(1));
    expect(JSON.stringify([basemap.deriveGroup(), basemap.deriveLabelsGroup()])).not.toContain('tianditu');
  });

  it('关闭天地图：一键切到无底图没有透明度，切回静态底图还是原来的透明度', () => {
    const basemap = useBasemap({ tianditu: null });
    basemap.setOpacity(0.4);

    basemap.select('none');
    expect(basemap.opacity.value).toBeNull();
    expect(basemap.deriveGroup().sources).toStrictEqual({});
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);

    basemap.select('static');
    expect(basemap.opacity.value).toBe(0.4);
    expect(Object.keys(basemap.deriveGroup().sources)).toStrictEqual(['basemap-static']);
  });

  it('开启天地图时不能选静态底图', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    expect(() => basemap.select('static')).toThrow('底图 static 不可用');
    expect(basemap.selected.value).toBe('vector');
  });

  it('切换底图后，推导出所选底图和配套的注记', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    basemap.select('imagery');

    expect(basemap.selected.value).toBe('imagery');
    expect(Object.keys(basemap.deriveGroup().sources)).toStrictEqual(['basemap-imagery']);
    expect(Object.keys(basemap.deriveLabelsGroup().sources)).toStrictEqual(['basemap-labels-imagery']);

    basemap.select('none');

    expect(basemap.opacity.value).toBeNull();
    expect(basemap.deriveGroup().sources).toStrictEqual({});
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);
  });

  it('切换二三维：三维选影像、二维选矢量；关闭天地图时保持原来的底图', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    basemap.selectForDimension('3d');
    expect(basemap.selected.value).toBe('imagery');
    basemap.selectForDimension('2d');
    expect(basemap.selected.value).toBe('vector');

    const intranet = useBasemap({ tianditu: null });
    intranet.selectForDimension('3d');
    expect(intranet.selected.value).toBe('static');
    intranet.select('none');
    intranet.selectForDimension('3d');
    expect(intranet.selected.value).toBe('none');
  });

  it('切换二三维（ADR 0165 第 1 节）：内网有影像时三维选影像、二维选二维的默认；没有影像时两个方向都不变', () => {
    // [服务器有的, 进入时, 先选的（null 不选）, 切三维后, 再切二维后]
    const cases: readonly [ServerBasemaps, BasemapId, BasemapId | null, BasemapId, BasemapId][] = [
      [servers(), 'static', null, 'static', 'static'],
      [servers('imagery'), 'static', null, 'imagery', 'static'],
      [servers('standard'), 'standard', null, 'standard', 'standard'],
      [servers('standard'), 'standard', 'static', 'static', 'static'],
      [servers('standard', 'black'), 'standard', 'black', 'black', 'black'],
      [ALL_FOUR, 'standard', null, 'imagery', 'standard'],
      [ALL_FOUR, 'standard', 'black', 'imagery', 'standard'],
      [ALL_FOUR, 'standard', 'static', 'imagery', 'standard'],
      [ALL_FOUR, 'standard', 'none', 'imagery', 'standard'],
      [servers('imagery', 'night-blue'), 'static', 'none', 'imagery', 'static']
    ];

    const results = cases.map(([found, , picked]) => {
      const basemap = useBasemap({ tianditu: null, servers: found });
      const initial = basemap.selected.value;
      if (picked) {
        basemap.select(picked);
      }
      basemap.selectForDimension('3d');
      const in3d = basemap.selected.value;
      basemap.selectForDimension('2d');
      return [found, initial, picked, in3d, basemap.selected.value];
    });

    expect(results).toStrictEqual(cases);
  });

  it('公网不看探测结果：选项、进入时的底图、切换二三维都和没有服务器底图时一样', () => {
    const basemap = useBasemap({ tianditu: TIANDITU, servers: ALL_FOUR });

    expect(basemap.options.map(option => option.id)).toStrictEqual(['vector', 'imagery', 'none']);
    expect(basemap.selected.value).toBe('vector');
    basemap.select('none');
    basemap.selectForDimension('3d');
    expect(basemap.selected.value).toBe('imagery');
    basemap.selectForDimension('2d');
    expect(basemap.selected.value).toBe('vector');
    expect(() => basemap.select('standard')).toThrow('底图 standard 不可用');
  });

  it('内网的影像叠静态底图的地名，跟着标注开关、用影像的透明度；三套矢量的地名印在图上，标注打开也是空的', () => {
    const basemap = useBasemap({ tianditu: null, servers: ALL_FOUR });
    expect(Object.keys(basemap.deriveGroup().sources)).toStrictEqual(['basemap-standard']);
    basemap.setLabelsVisible(true);
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);

    basemap.select('imagery');
    basemap.setOpacity(0.4);
    expect(Object.keys(basemap.deriveGroup().sources)).toStrictEqual(['basemap-imagery']);
    expect(basemap.deriveLabelsGroup()).toStrictEqual(staticLabelsGroup(0.4));
    basemap.setLabelsVisible(false);
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);

    basemap.select('night-blue');
    basemap.setLabelsVisible(true);
    expect(basemap.labelsVisible.value).toBe(true);
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);
  });

  it('服务器底图的缩略图来自探测结果', () => {
    const basemap = useBasemap({ tianditu: null, servers: servers('black') });

    expect(basemap.thumbnails.black?.base).toBe('data:image/png;base64,black');
    expect(basemap.thumbnails.standard).toBeNull();
  });

  it('默认注入地图页提供的探测结果；没有注入上下文时没有服务器底图，传入的优先', () => {
    const app = createApp({}).provide(SERVER_BASEMAPS, servers('imagery'));

    const injected = app.runWithContext(() => useBasemap({ tianditu: null }));
    const passed = app.runWithContext(() => useBasemap({ tianditu: null, servers: servers('standard') }));

    expect(injected.options.map(option => option.id)).toStrictEqual(['imagery', 'static', 'none']);
    expect(passed.options.map(option => option.id)).toStrictEqual(['standard', 'static', 'none']);
    expect(useBasemap({ tianditu: null }).options.map(option => option.id)).toStrictEqual(['static', 'none']);
  });

  it('透明度作用于当前底图的底图和注记，每种底图各自记住', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    basemap.setOpacity(0.5);

    expect(basemap.opacity.value).toBe(0.5);
    expect(opacities(basemap.deriveGroup())).toStrictEqual({ 'basemap-vector': 0.5 });
    expect(opacities(basemap.deriveLabelsGroup())).toStrictEqual({ 'basemap-labels-vector': 0.5 });

    basemap.select('imagery');
    expect(basemap.opacity.value).toBe(1);
    basemap.setOpacity(0.2);

    basemap.select('vector');
    expect(basemap.opacity.value).toBe(0.5);
    basemap.select('imagery');
    expect(basemap.opacity.value).toBe(0.2);
    expect(opacities(basemap.deriveGroup())).toStrictEqual({ 'basemap-imagery': 0.2 });
  });

  it('开启天地图时标注默认显示；关掉后切换底图、二三维都沿用，无底图时也保留', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    expect(basemap.labelsVisible.value).toBe(true);
    expect(Object.keys(basemap.deriveLabelsGroup().sources)).toStrictEqual(['basemap-labels-vector']);

    basemap.setLabelsVisible(false);
    expect(basemap.labelsVisible.value).toBe(false);
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);

    basemap.select('imagery');
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);
    basemap.selectForDimension('2d');
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);
    basemap.select('none');
    expect(basemap.labelsVisible.value).toBe(false);

    basemap.select('imagery');
    basemap.setLabelsVisible(true);
    expect(Object.keys(basemap.deriveLabelsGroup().sources)).toStrictEqual(['basemap-labels-imagery']);
  });

  it('切换标注不影响底图分组，也不重新推导它', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    const group = computed(() => basemap.deriveGroup());
    const initial = group.value;

    basemap.setLabelsVisible(false);

    expect(group.value).toBe(initial);
  });

  it('包进 computed 时只在状态变化后重新推导；相同的选择和透明度不触发', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    basemap.setOpacity(0.6);
    const group = computed(() => basemap.deriveGroup());
    const labels = computed(() => basemap.deriveLabelsGroup());
    const initial = group.value;
    const initialLabels = labels.value;

    basemap.select('vector');
    basemap.setOpacity(0.6);

    expect(group.value).toBe(initial);
    expect(labels.value).toBe(initialLabels);

    basemap.setOpacity(0.4);

    expect(group.value).not.toBe(initial);
    expect(labels.value).not.toBe(initialLabels);
  });

  it('选择不可用的底图时抛错，状态不变', () => {
    const basemap = useBasemap({ tianditu: null });

    expect(() => basemap.select('vector')).toThrow('底图 vector 不可用');
    expect(basemap.selected.value).toBe('static');
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])('透明度为 %s 时抛错，状态不变', value => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    basemap.setOpacity(0.3);

    expect(() => basemap.setOpacity(value)).toThrow(RangeError);
    expect(basemap.opacity.value).toBe(0.3);
  });

  it('透明度可以是 0 和 1', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    expect(() => basemap.setOpacity(0)).not.toThrow();
    expect(basemap.opacity.value).toBe(0);
    expect(() => basemap.setOpacity(1)).not.toThrow();
    expect(basemap.opacity.value).toBe(1);
  });

  it('无底图时修改透明度抛错，状态不变', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    basemap.select('none');

    expect(() => basemap.setOpacity(0.5)).toThrow('无底图时没有透明度');
    basemap.select('vector');
    expect(basemap.opacity.value).toBe(1);
  });
});
