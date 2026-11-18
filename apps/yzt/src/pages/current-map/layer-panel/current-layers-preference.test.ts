import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, shallowRef } from 'vue';
import type { ResourceTreeCategory } from '@/features/resource-map/api';
import { buildCatalog } from '@/features/resource-map/catalog';
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceLayersState,
  withAdded,
  withMoved,
  withRemoved
} from '@/features/resource-map/resource-layers';
import type { SceneModel } from '@/features/scene-models/catalog';
import { createMemoryStore } from '@/shared/storage/key-value-store';
import { createTestPreferenceScope } from '@/shared/storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '@/shared/storage/use-preference';
import { useCurrentLayers } from './useCurrentLayers';

const layer = (code: string) => ({ code, name: code, geoType: 'Polygon' as const, yearList: [2024] as [number] });

// 只有地类图斑默认加入
const CATALOG = buildCatalog([
  {
    code: null,
    name: '基础库',
    children: [{ code: 'tdzy', name: '土地资源', children: ['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl'].map(layer) }]
  }
] satisfies ResourceTreeCategory[]);

const KEY = 'zhangsan/current-layers';
const r = (code: string) => `resource:${code}`;
const m = (id: string) => `model:${id}`;

// 资源目录到了：地类图斑默认加入，再加入村级调查区放在最上面
const ARRIVED = withAdded(mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG), ['bgdc_cjdcq'], 0);

// 两个拥有者只保留用到的部分；arrived 为 false 时资源目录还没到、记下的模型还没恢复
function setup({ order, arrived = true, models: initial = [] as readonly string[] } = {} as {
  readonly order?: readonly string[];
  readonly arrived?: boolean;
  readonly models?: readonly string[];
}) {
  const store = createMemoryStore(order ? { [KEY]: { version: 1, value: { order } } } : {});
  const state = shallowRef<ResourceLayersState>(arrived ? ARRIVED : EMPTY_RESOURCE_LAYERS);
  const resources = {
    state,
    add: (codes: readonly string[], at?: number) => (state.value = withAdded(state.value, codes, at)),
    remove: (codes: readonly string[]) => (state.value = withRemoved(state.value, codes)),
    moveLayer: (code: string, to: number) => (state.value = withMoved(state.value, code, to))
  };
  const added = shallowRef<readonly string[]>(initial);
  const restored = shallowRef(arrived);
  const models = {
    models: computed(() => ['x', 'y'].map(id => ({ id }) as SceneModel)),
    restored: computed(() => restored.value),
    added,
    hidden: shallowRef<ReadonlySet<string>>(new Set()),
    add: (ids: readonly string[]) => (added.value = [...ids.filter(id => !added.value.includes(id)), ...added.value]),
    remove: (ids: readonly string[]) => (added.value = added.value.filter(id => !ids.includes(id))),
    moveModel: (id: string, to: number) => (added.value = added.value.filter(item => item !== id).toSpliced(to, 0, id))
  };
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const current = effect.run(() => useCurrentLayers(resources, models, { preferences: scope }));
  if (!current) {
    throw new Error('图层列表没有创建');
  }
  return { current, state, added, restored, store, [Symbol.dispose]: () => effect.stop() };
}

const written = (store: ReturnType<typeof createMemoryStore>) => store.entries.get(KEY);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('图层的顺序：按账号记住（ADR 0167）', () => {
  it('恢复记下的穿插：盖住模型的资源刷新后还盖着', async () => {
    using ctx = setup({ order: [r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')], models: ['x'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.current.keys.value).toStrictEqual([r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')]);
    expect(ctx.current.overModels.value).toStrictEqual(['bgdc_cjdcq']);
  });

  it('只在加入、移出、移动时写入；恢复本身不写', async () => {
    using ctx = setup({ order: [r('bgdc_cjdcq'), r('bgdc_dltb')] });
    const set = vi.spyOn(ctx.store, 'set');
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.current.keys.value).toStrictEqual([r('bgdc_cjdcq'), r('bgdc_dltb')]);
    expect(set).not.toHaveBeenCalled();

    ctx.current.add([m('x')]);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(written(ctx.store)).toStrictEqual({
      version: 1,
      value: { order: [m('x'), r('bgdc_cjdcq'), r('bgdc_dltb')] }
    });

    ctx.current.move(r('bgdc_dltb'), 0);
    ctx.current.remove([r('bgdc_cjdcq')]);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(written(ctx.store)).toStrictEqual({ version: 1, value: { order: [r('bgdc_dltb'), m('x')] } });
  });

  it('目录、清单没到时就操作：记下的资源留着原来的位置，到了以后照旧穿插', async () => {
    using ctx = setup({ order: [r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')], arrived: false });
    await vi.advanceTimersByTimeAsync(0);
    // 模型先恢复了，资源目录还没到；这时加入模型 y
    ctx.added.value = ['x'];
    ctx.restored.value = true;
    ctx.current.add([m('y')]);
    expect(ctx.current.keys.value).toStrictEqual([m('y'), m('x')]);

    ctx.state.value = ARRIVED;
    expect(ctx.current.keys.value).toStrictEqual([m('y'), r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')]);
    expect(ctx.current.overModels.value).toStrictEqual([]);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(written(ctx.store)).toStrictEqual({
      version: 1,
      value: { order: [m('y'), r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')] }
    });
  });

  it('记下的顺序里还没到的行照样能加入：放在最上面，拥有者里也加上', async () => {
    // 模型 y 记在顺序里，模型的记录里却没有它（比如别处移出了）；资源目录还没到
    using ctx = setup({ order: [r('bgdc_cjdcq'), m('y'), m('x'), r('bgdc_dltb')], arrived: false });
    await vi.advanceTimersByTimeAsync(0);
    ctx.added.value = ['x'];
    ctx.restored.value = true;
    ctx.current.add([m('y')]);
    expect(ctx.added.value).toStrictEqual(['y', 'x']);
    expect(ctx.current.keys.value).toStrictEqual([m('y'), m('x')]);

    ctx.state.value = ARRIVED;
    expect(ctx.current.keys.value).toStrictEqual([m('y'), r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')]);
  });

  it('都到齐以后丢掉没有了的行（目录里删了、换了服务器）', async () => {
    using ctx = setup({ order: [r('gone'), m('x'), m('lost'), r('bgdc_dltb')], models: ['x'] });
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.current.keys.value).toStrictEqual([m('x'), r('bgdc_cjdcq'), r('bgdc_dltb')]);
    expect(written(ctx.store)).toStrictEqual({ version: 1, value: { order: [m('x'), r('bgdc_dltb')] } });
  });

  it('格式不对当作没有存过：有重复的行、认不出的键', async () => {
    using duplicated = setup({ order: [r('bgdc_dltb'), r('bgdc_dltb')], models: ['x'] });
    using unknown = setup({ order: ['basemap', r('bgdc_dltb')], models: ['x'] });
    await vi.advanceTimersByTimeAsync(0);
    // 没有记下的顺序：自己出现的接在最后，先模型后资源
    expect(duplicated.current.keys.value).toStrictEqual([m('x'), r('bgdc_cjdcq'), r('bgdc_dltb')]);
    expect(unknown.current.keys.value).toStrictEqual([m('x'), r('bgdc_cjdcq'), r('bgdc_dltb')]);
  });
});
