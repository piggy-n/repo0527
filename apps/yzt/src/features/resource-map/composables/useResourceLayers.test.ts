// @vitest-environment node
import { NO_SOURCE_ERRORS, type SourceErrors, type ViewKind } from '@mx/map-core';
import type { SceneCapabilities } from '@mx/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { computed, effectScope, nextTick, shallowRef, watch } from 'vue';
import type { ResourceTreeCategory, ResourceTreeLayer } from '../api';
import { buildCatalog, type ResourceCatalog } from '../catalog';
import { EMPTY_RESOURCE_LAYERS, validateCatalog } from '../resource-layers';
import type { SymbolOverride } from '../symbols';
import { type ResourceLayersOptions, useResourceLayers } from './useResourceLayers';

const TILE_BASE = 'http://localhost:5173/backend/api/tiles/';

function layer(code: string, geoType: ResourceTreeLayer['geoType'], ...yearList: [number, ...number[]]) {
  return { code, name: code, geoType, yearList };
}

function catalogOf(...layers: ResourceTreeLayer[]): ResourceCatalog {
  const tree: ResourceTreeCategory[] = [{ code: null, name: '测试', children: layers }];
  return buildCatalog(tree);
}

const DLTB = layer('bgdc_dltb', 'Polygon', 2022);
const CJDCQ = layer('bgdc_cjdcq', 'Polygon', 2023, 2024);
const HYDL = layer('csxhjctb_hydl', 'Line', 2023, 2024, 2025);
const CATALOG = catalogOf(DLTB, CJDCQ, HYDL);

const HIDDEN_IN_SCENE: SceneCapabilities = { styleLayers: false, identify: false, splats: true };
const MAPLIBRE_LIKE: SceneCapabilities = { styleLayers: true, identify: true, splats: true };

// 拥有者在 effectScope 里创建，用例结束时停止它的侦听器；目录、数据源错误和维度由测试控制，三维引擎的能力默认同 app 注入的（三维里不画样式图层、不识别）
function setup(options: Partial<ResourceLayersOptions> = {}, sceneCapabilities = HIDDEN_IN_SCENE) {
  const scope = effectScope();
  const catalog = shallowRef<ResourceCatalog | undefined>(undefined);
  const sourceErrors = shallowRef<SourceErrors>(NO_SOURCE_ERRORS);
  const dimension = shallowRef<ViewKind>('2d');
  const errors: unknown[] = [];
  const onError = (error: unknown) => errors.push(error);
  const resolved: ResourceLayersOptions = { catalog, tileBase: TILE_BASE, onError, ...options };
  const owner = scope.run(() => useResourceLayers({ sourceErrors, dimension, sceneCapabilities }, resolved));
  if (!owner) {
    throw new Error('拥有者没有创建');
  }
  return { owner, catalog, sourceErrors, dimension, errors, [Symbol.dispose]: () => scope.stop() };
}

async function loaded(options: Partial<ResourceLayersOptions> = {}, sceneCapabilities = HIDDEN_IN_SCENE) {
  const ctx = setup(options, sceneCapabilities);
  ctx.catalog.value = CATALOG;
  await nextTick();
  return ctx;
}

// 目录加载后地类图斑校验不通过
function invalidLanduse(catalog: ResourceCatalog | null): ReadonlyMap<string, readonly string[]> {
  return new Map(catalog ? [['bgdc_dltb', ['layers[0].paint.fill-color: 取值重复']]] : []);
}

function layerIds(owner: ReturnType<typeof useResourceLayers>): string[] {
  return owner.deriveGroup().layers.map(({ id }) => id);
}

// 村级调查区的统一符号改成红色
const redVillageSurvey = (code: string) => (code === 'bgdc_cjdcq' ? { uniform: { fillColor: 'red' } } : undefined);

describe('useResourceLayers', () => {
  it('目录还没加载：空状态、空分组；目录到了按默认值合并，推导出默认勾选的地类图斑', async () => {
    using ctx = setup();
    expect(ctx.owner.state.value).toBe(EMPTY_RESOURCE_LAYERS);
    expect(ctx.owner.deriveGroup()).toStrictEqual({ sources: {}, layers: [] });

    ctx.catalog.value = CATALOG;
    await nextTick();

    expect(ctx.owner.state.value.catalog).toBe(CATALOG);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
  });

  it('创建时目录已经在查询缓存里：立即合并，第一次推导就有默认勾选的图层', () => {
    using ctx = setup({ catalog: CATALOG });

    expect(ctx.owner.state.value.catalog).toBe(CATALOG);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
  });

  it('目录重新加载：按资源合并，保留用户加入的图层和顺序，删掉没有了的资源', async () => {
    using ctx = await loaded();
    ctx.owner.add(['csxhjctb_hydl']);

    ctx.catalog.value = catalogOf(DLTB, HYDL);
    await nextTick();

    expect(ctx.owner.state.value.order).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb']);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb', 'resources-csxhjctb_hydl']);
  });

  it('三维引擎不画样式图层时（app 注入的能力）三维里推导出空分组，切回二维恢复（ADR 0147、0153）', async () => {
    using ctx = await loaded();
    // 和页面的 bindStyle 一样在响应式的推导里读，维度变化时要重新推导
    const group = computed(() => ctx.owner.deriveGroup());
    expect(ctx.owner.hiddenInScene.value).toBe(false);
    expect(group.value.layers).toHaveLength(1);

    ctx.dimension.value = '3d';

    expect(ctx.owner.hiddenInScene.value).toBe(true);
    expect(group.value).toStrictEqual({ sources: {}, layers: [] });

    ctx.dimension.value = '2d';

    expect(ctx.owner.hiddenInScene.value).toBe(false);
    expect(group.value.layers.map(({ id }) => id)).toStrictEqual(['resources-bgdc_dltb']);
  });

  it('三维引擎画样式图层时（能力 styleLayers 为 true）三维里照常推导', async () => {
    using ctx = await loaded({}, MAPLIBRE_LIKE);

    ctx.dimension.value = '3d';

    expect(ctx.owner.hiddenInScene.value).toBe(false);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
  });

  it('操作整体替换状态，推导随之变化；值没变时不替换', async () => {
    using ctx = await loaded();
    const initial = ctx.owner.state.value;

    ctx.owner.add(['bgdc_dltb']);
    ctx.owner.remove(['bgdc_cjdcq']);
    ctx.owner.setVisible('bgdc_dltb', true);
    ctx.owner.setOpacity('bgdc_dltb', 1);
    ctx.owner.setYear('csxhjctb_hydl', 2025);
    ctx.owner.moveLayer('bgdc_dltb', 0);
    expect(ctx.owner.state.value).toBe(initial);

    ctx.owner.add(['csxhjctb_hydl']);
    ctx.owner.setOpacity('csxhjctb_hydl', 0.3);
    ctx.owner.setYear('csxhjctb_hydl', 2023);
    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')).toStrictEqual({
      added: true,
      checked: true,
      opacity: 0.3,
      year: 2023
    });
    expect(ctx.owner.deriveGroup().sources['resources-csxhjctb_hydl']).toMatchObject({
      tiles: [`${TILE_BASE}csxhjctb_hydl_2023/{z}/{x}/{y}.pbf`]
    });
    expect(initial.displays.get('csxhjctb_hydl')?.checked).toBe(false);
  });

  it('加入多个、移出多个：各只替换一次状态；新加的整批放在最前；有目录里没有的资源时抛错、什么也不改（ADR 0157）', async () => {
    using ctx = await loaded();
    const initial = ctx.owner.state.value;
    let replaced = 0;
    const stop = watch(ctx.owner.state, () => replaced++, { flush: 'sync' });

    expect(() => ctx.owner.add(['bgdc_cjdcq', 'szy_kt'])).toThrow('目录里没有资源 szy_kt');
    expect(ctx.owner.state.value).toBe(initial);

    ctx.owner.add(['bgdc_cjdcq', 'csxhjctb_hydl', 'bgdc_dltb']);
    expect(replaced).toBe(1);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb', 'resources-csxhjctb_hydl', 'resources-bgdc_cjdcq']);
    ctx.owner.remove(['bgdc_cjdcq', 'csxhjctb_hydl']);
    expect(replaced).toBe(2);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
    stop();
  });

  it('隐藏的图层不画，仍在当前地图里、位置不变；再显示时照旧', async () => {
    using ctx = await loaded();
    ctx.owner.add(['csxhjctb_hydl']);

    ctx.owner.setVisible('csxhjctb_hydl', false);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
    expect(ctx.owner.state.value.order).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq']);

    ctx.owner.setVisible('csxhjctb_hydl', true);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb', 'resources-csxhjctb_hydl']);
  });

  it('当前地图里挪动就是调整叠放顺序：排在最上面的画在最上层', async () => {
    using ctx = await loaded();
    ctx.owner.add(['csxhjctb_hydl']);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb', 'resources-csxhjctb_hydl']);

    ctx.owner.moveLayer('csxhjctb_hydl', 1);
    expect(ctx.owner.state.value.order).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl', 'bgdc_cjdcq']);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-csxhjctb_hydl', 'resources-bgdc_dltb']);
  });

  it('参数不合法时抛错，状态不变：目录里没有的资源、透明度越界、不是资源的年份、没加入、位置越界', async () => {
    using ctx = await loaded();
    const before = ctx.owner.state.value;

    expect(() => ctx.owner.add(['szy_kt'])).toThrow('目录里没有资源 szy_kt');
    expect(() => ctx.owner.remove(['szy_kt'])).toThrow('目录里没有资源 szy_kt');
    expect(() => ctx.owner.setVisible('szy_kt', true)).toThrow('目录里没有资源 szy_kt');
    expect(() => ctx.owner.setOpacity('bgdc_dltb', 1.5)).toThrow(RangeError);
    expect(() => ctx.owner.setOpacity('bgdc_dltb', Number.NaN)).toThrow(RangeError);
    expect(() => ctx.owner.setYear('csxhjctb_hydl', 2030)).toThrow('没有 2030 年的数据');
    expect(() => ctx.owner.moveLayer('csxhjctb_hydl', 0)).toThrow('不在当前地图里');
    expect(() => ctx.owner.moveLayer('bgdc_dltb', 1)).toThrow(RangeError);
    expect(ctx.owner.state.value).toBe(before);
  });

  it('目录还没加载时操作抛错', () => {
    using ctx = setup();

    expect(() => ctx.owner.add(['bgdc_dltb'])).toThrow('目录里没有资源 bgdc_dltb');
  });

  it('只在目录变化时校验：加入、改透明度、调整顺序都不重新校验', async () => {
    const validate = vi.fn<typeof validateCatalog>(validateCatalog);
    using ctx = await loaded({ validate });
    ctx.owner.deriveGroup();
    const calls = validate.mock.calls.length;

    ctx.owner.add(['csxhjctb_hydl']);
    ctx.owner.setOpacity('csxhjctb_hydl', 0.5);
    ctx.owner.moveLayer('csxhjctb_hydl', 1);
    ctx.owner.deriveGroup();
    await nextTick();

    expect(validate).toHaveBeenCalledTimes(calls);
    expect(validate).toHaveBeenLastCalledWith(CATALOG, TILE_BASE);
    ctx.catalog.value = catalogOf(DLTB, HYDL);
    await nextTick();
    expect(validate).toHaveBeenCalledTimes(calls + 1);
  });

  it('配置不合法的资源不进入推导，原因交给 onError', async () => {
    using ctx = await loaded({ validate: invalidLanduse });

    expect(layerIds(ctx.owner)).toStrictEqual([]);
    expect([...ctx.owner.configErrors.value.keys()]).toStrictEqual(['bgdc_dltb']);
    expect(ctx.errors).toHaveLength(1);
    expect(String(ctx.errors[0])).toContain('bgdc_dltb');
  });

  it('瓦片加载失败：从上下文的数据源错误按前缀推导，其他分组的数据源不算', async () => {
    using ctx = await loaded();
    expect(ctx.owner.tileErrors.value).toStrictEqual(new Set());

    ctx.sourceErrors.value = new Map([
      ['resources-csxhjctb_hydl', new Error('Unable to parse the tile')],
      ['boundaries-city', new Error('404')]
    ]);

    expect(ctx.owner.tileErrors.value).toStrictEqual(new Set(['csxhjctb_hydl']));
  });

  it('推导读符号的覆盖和预览，只有它们变化时也重新推导', async () => {
    const overrides = shallowRef<ReadonlyMap<string, SymbolOverride>>(new Map());
    using ctx = await loaded({
      symbols: {
        overrideOf: code => {
          const uniform = overrides.value.get(code);
          // 选了分类样式：地类图斑不用统一样式的覆盖
          return uniform && { uniform, mode: 'classified' as const };
        }
      }
    });
    ctx.owner.add(['bgdc_cjdcq']);
    const fillColors = computed(() =>
      ctx.owner.deriveGroup().layers.map(item => (item.type === 'fill' ? item.paint?.['fill-color'] : undefined))
    );
    const [landuse] = fillColors.value;

    overrides.value = new Map([['bgdc_dltb', { fillColor: 'rgba(0, 0, 0, 1)' }], ['bgdc_cjdcq', { fillColor: 'red' }]]);
    // 地类图斑按属性配色，不用统一样式的覆盖；村级调查区新加入，在最上面（样式里最后）
    expect(fillColors.value).toStrictEqual([landuse, 'red']);
  });

  it('批量设置年份：只替换一次状态，推导用新的年份；没有资源要改、没有任何资源有这一年时不替换（ADR 0094）', async () => {
    using ctx = await loaded();
    ctx.owner.add(['csxhjctb_hydl']);
    let replaced = 0;
    const stop = watch(ctx.owner.state, () => replaced++, { flush: 'sync' });

    ctx.owner.setYearForAll(2023);
    expect(replaced).toBe(1);
    const years = [...ctx.owner.state.value.displays].map(([code, { year }]) => [code, year]);
    expect(years).toStrictEqual([
      ['bgdc_dltb', 2022],
      ['bgdc_cjdcq', 2023],
      ['csxhjctb_hydl', 2023]
    ]);
    expect(ctx.owner.deriveGroup().sources['resources-csxhjctb_hydl']).toMatchObject({
      tiles: [`${TILE_BASE}csxhjctb_hydl_2023/{z}/{x}/{y}.pbf`]
    });

    ctx.owner.setYearForAll(2023);
    expect(replaced).toBe(1);
    const before = ctx.owner.state.value;
    ctx.owner.setYearForAll(2030);
    expect(replaced).toBe(1);
    expect(ctx.owner.state.value).toBe(before);
    stop();
  });

  it('记下最后一次批量设置的年份给面板回显：单独改资源的年份不影响，没有数据的年份也记；不在可选年份里时为 null（ADR 0116）', async () => {
    using ctx = await loaded();
    expect(ctx.owner.batchYears.value).toStrictEqual([2025, 2024, 2023, 2021, 2020]);
    expect(ctx.owner.batchYear.value).toBeNull();

    ctx.owner.setYearForAll(2023);
    ctx.owner.setYear('csxhjctb_hydl', 2024);
    expect(ctx.owner.batchYear.value).toBe(2023);
    ctx.owner.setYearForAll(2020);
    expect(ctx.owner.batchYear.value).toBe(2020);
    ctx.owner.setYearForAll(2030);
    expect(ctx.owner.batchYear.value).toBeNull();
  });

  it('重复操作：批量设成 2023，单独把一个改回 2025，再批量设成 2023，它又回到 2023', async () => {
    using ctx = await loaded();

    ctx.owner.setYearForAll(2023);
    ctx.owner.setYear('csxhjctb_hydl', 2025);
    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2025);
    ctx.owner.setYearForAll(2023);

    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2023);
  });

  it('换年份不改变加入、显示、透明度、顺序和符号', async () => {
    using ctx = await loaded({ symbols: { overrideOf: redVillageSurvey } });
    ctx.owner.add(['bgdc_cjdcq']);
    ctx.owner.setOpacity('bgdc_cjdcq', 0.5);
    const fillOf = () => ctx.owner.deriveGroup().layers.find(({ id }) => id === 'resources-bgdc_cjdcq');

    ctx.owner.setYearForAll(2023);
    ctx.owner.setYear('bgdc_cjdcq', 2024);

    expect(ctx.owner.state.value.displays.get('bgdc_cjdcq')).toStrictEqual({
      added: true,
      checked: true,
      opacity: 0.5,
      year: 2024
    });
    expect(ctx.owner.state.value.order).toStrictEqual(['bgdc_cjdcq', 'bgdc_dltb', 'csxhjctb_hydl']);
    const fill = fillOf();
    expect(fill?.type === 'fill' && fill.paint?.['fill-color']).toBe('red');
  });

  it('最小显示级别来自目录：目录没到或没有这个资源时没有级别', async () => {
    using ctx = setup();
    expect(ctx.owner.minzoomOf('bgdc_cjdcq')).toBeUndefined();

    ctx.catalog.value = CATALOG;
    await nextTick();

    expect(ctx.owner.minzoomOf('bgdc_cjdcq')).toBe(8);
    expect(ctx.owner.minzoomOf('bgdc_dltb')).toBeUndefined();
    expect(ctx.owner.minzoomOf('nope')).toBeUndefined();
  });
});
