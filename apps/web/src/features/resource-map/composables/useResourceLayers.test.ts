// @vitest-environment node
import { NO_SOURCE_ERRORS, type SourceErrors } from '@yzt/map-core';
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

// 拥有者在 effectScope 里创建，用例结束时停止它的侦听器；目录和数据源错误由测试控制
function setup(options: Partial<ResourceLayersOptions> = {}) {
  const scope = effectScope();
  const catalog = shallowRef<ResourceCatalog | undefined>(undefined);
  const sourceErrors = shallowRef<SourceErrors>(NO_SOURCE_ERRORS);
  const errors: unknown[] = [];
  const onError = (error: unknown) => errors.push(error);
  const resolved: ResourceLayersOptions = { catalog, tileBase: TILE_BASE, onError, ...options };
  const owner = scope.run(() => useResourceLayers({ sourceErrors }, resolved));
  if (!owner) {
    throw new Error('拥有者没有创建');
  }
  return { owner, catalog, sourceErrors, errors, [Symbol.dispose]: () => scope.stop() };
}

async function loaded(options: Partial<ResourceLayersOptions> = {}) {
  const ctx = setup(options);
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

  it('目录重新加载：按资源合并，保留用户的勾选，删掉没有了的资源', async () => {
    using ctx = await loaded();
    ctx.owner.setChecked('csxhjctb_hydl', true);

    ctx.catalog.value = catalogOf(DLTB, HYDL);
    await nextTick();

    expect(ctx.owner.state.value.order).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl']);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-csxhjctb_hydl', 'resources-bgdc_dltb']);
  });

  it('操作整体替换状态，推导随之变化；值没变时不替换', async () => {
    using ctx = await loaded();
    const initial = ctx.owner.state.value;

    ctx.owner.setChecked('bgdc_dltb', true);
    ctx.owner.setOpacity('bgdc_dltb', 1);
    ctx.owner.setYear('csxhjctb_hydl', 2025);
    ctx.owner.move('bgdc_dltb', 0);
    expect(ctx.owner.state.value).toBe(initial);

    ctx.owner.setChecked('csxhjctb_hydl', true);
    ctx.owner.setOpacity('csxhjctb_hydl', 0.3);
    ctx.owner.setYear('csxhjctb_hydl', 2023);
    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')).toStrictEqual({
      checked: true,
      opacity: 0.3,
      year: 2023
    });
    expect(ctx.owner.deriveGroup().sources['resources-csxhjctb_hydl']).toMatchObject({
      tiles: [`${TILE_BASE}csxhjctb_hydl_2023/{z}/{x}/{y}.pbf`]
    });
    expect(initial.displays.get('csxhjctb_hydl')?.checked).toBe(false);
  });

  it('批量勾选：一次替换状态；都已是目标值时不替换；有目录里没有的资源时抛错、什么也不改', async () => {
    using ctx = await loaded();
    const initial = ctx.owner.state.value;

    ctx.owner.setCheckedMany(['bgdc_dltb'], true);
    expect(ctx.owner.state.value).toBe(initial);
    expect(() => ctx.owner.setCheckedMany(['bgdc_cjdcq', 'szy_kt'], true)).toThrow('目录里没有资源 szy_kt');
    expect(ctx.owner.state.value).toBe(initial);

    ctx.owner.setCheckedMany(['bgdc_cjdcq', 'csxhjctb_hydl', 'bgdc_dltb'], true);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-csxhjctb_hydl', 'resources-bgdc_cjdcq', 'resources-bgdc_dltb']);
    ctx.owner.setCheckedMany(['bgdc_cjdcq', 'csxhjctb_hydl'], false);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
  });

  it('移到面板上的第 index 位：排在最上面的画在最上层', async () => {
    using ctx = await loaded();
    ctx.owner.setChecked('csxhjctb_hydl', true);

    ctx.owner.move('csxhjctb_hydl', 0);
    expect(ctx.owner.state.value.order).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq']);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb', 'resources-csxhjctb_hydl']);

    ctx.owner.move('csxhjctb_hydl', 2);
    expect(ctx.owner.state.value.order).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);
  });

  it('参数不合法时抛错，状态不变：目录里没有的资源、透明度越界、不是资源的年份、位置越界', async () => {
    using ctx = await loaded();
    const before = ctx.owner.state.value;

    expect(() => ctx.owner.setChecked('szy_kt', true)).toThrow('目录里没有资源 szy_kt');
    expect(() => ctx.owner.setOpacity('bgdc_dltb', 1.5)).toThrow(RangeError);
    expect(() => ctx.owner.setOpacity('bgdc_dltb', Number.NaN)).toThrow(RangeError);
    expect(() => ctx.owner.setYear('csxhjctb_hydl', 2030)).toThrow('没有 2030 年的数据');
    expect(() => ctx.owner.move('bgdc_dltb', 3)).toThrow(RangeError);
    expect(() => ctx.owner.move('bgdc_dltb', -1)).toThrow(RangeError);
    expect(() => ctx.owner.move('bgdc_dltb', 0.5)).toThrow(RangeError);
    expect(() => ctx.owner.move('szy_kt', 0)).toThrow('目录里没有资源 szy_kt');
    expect(ctx.owner.state.value).toBe(before);
  });

  it('目录还没加载时操作抛错', () => {
    using ctx = setup();

    expect(() => ctx.owner.setChecked('bgdc_dltb', true)).toThrow('目录里没有资源 bgdc_dltb');
  });

  it('只在目录变化时校验：勾选、改透明度、调整顺序都不重新校验', async () => {
    const validate = vi.fn<typeof validateCatalog>(validateCatalog);
    using ctx = await loaded({ validate });
    ctx.owner.deriveGroup();
    const calls = validate.mock.calls.length;

    ctx.owner.setChecked('csxhjctb_hydl', true);
    ctx.owner.setOpacity('csxhjctb_hydl', 0.5);
    ctx.owner.move('csxhjctb_hydl', 0);
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
          return uniform && { uniform };
        }
      }
    });
    ctx.owner.setChecked('bgdc_cjdcq', true);
    const fillColors = computed(() =>
      ctx.owner.deriveGroup().layers.map(item => (item.type === 'fill' ? item.paint?.['fill-color'] : undefined))
    );
    const [, landuse] = fillColors.value;

    overrides.value = new Map([['bgdc_dltb', { fillColor: 'rgba(0, 0, 0, 1)' }], ['bgdc_cjdcq', { fillColor: 'red' }]]);
    // 地类图斑按属性配色，不用统一样式的覆盖
    expect(fillColors.value).toStrictEqual(['red', landuse]);
  });

  it('批量设置年份：只替换一次状态，推导用新的年份；没有资源要改时不替换；没有任何资源有这一年时抛错、状态不变', async () => {
    using ctx = await loaded();
    ctx.owner.setChecked('csxhjctb_hydl', true);
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
    expect(() => ctx.owner.setYearForAll(2030)).toThrow('没有资源有 2030 年的数据');
    expect(ctx.owner.state.value).toBe(before);
    stop();
  });

  it('重复操作：批量设成 2023，单独把一个改回 2025，再批量设成 2023，它又回到 2023', async () => {
    using ctx = await loaded();

    ctx.owner.setYearForAll(2023);
    ctx.owner.setYear('csxhjctb_hydl', 2025);
    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2025);
    ctx.owner.setYearForAll(2023);

    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2023);
  });

  it('换年份不改变勾选、透明度、顺序和符号', async () => {
    using ctx = await loaded({ symbols: { overrideOf: redVillageSurvey } });
    ctx.owner.setChecked('bgdc_cjdcq', true);
    ctx.owner.setOpacity('bgdc_cjdcq', 0.5);
    ctx.owner.move('bgdc_cjdcq', 0);
    const fillOf = () => ctx.owner.deriveGroup().layers.find(({ id }) => id === 'resources-bgdc_cjdcq');

    ctx.owner.setYearForAll(2023);
    ctx.owner.setYear('bgdc_cjdcq', 2024);

    expect(ctx.owner.state.value.displays.get('bgdc_cjdcq')).toStrictEqual({ checked: true, opacity: 0.5, year: 2024 });
    expect(ctx.owner.state.value.order).toStrictEqual(['bgdc_cjdcq', 'bgdc_dltb', 'csxhjctb_hydl']);
    const fill = fillOf();
    expect(fill?.type === 'fill' && fill.paint?.['fill-color']).toBe('red');
  });

  it('最小显示级别来自登记表', () => {
    using ctx = setup();

    expect(ctx.owner.minzoomOf('bgdc_cjdcq')).toBe(9);
    expect(ctx.owner.minzoomOf('bgdc_dltb')).toBeUndefined();
  });
});
