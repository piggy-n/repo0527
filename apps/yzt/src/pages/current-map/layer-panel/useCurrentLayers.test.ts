// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computed, effectScope, shallowRef } from 'vue';
import type { ResourceTreeCategory } from '@/features/resource-map/api';
import { buildCatalog } from '@/features/resource-map/catalog';
import {
  addedCodes,
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  type ResourceLayersState,
  withAdded,
  withMoved,
  withRemoved
} from '@/features/resource-map/resource-layers';
import type { SceneModel } from '@/features/scene-models/catalog';
import { required } from '@/shared/testing/required';
import { type CurrentLayers, useCurrentLayers } from './useCurrentLayers';

const layer = (code: string) => ({ code, name: code, geoType: 'Polygon' as const, yearList: [2024] as [number] });

// 只有地类图斑默认加入
const CATALOG = buildCatalog([
  {
    code: null,
    name: '基础库',
    children: [{ code: 'tdzy', name: '土地资源', children: ['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl'].map(layer) }]
  }
] satisfies ResourceTreeCategory[]);

const r = (code: string) => `resource:${code}`;
const m = (id: string) => `model:${id}`;

// 两个拥有者只保留用到的部分，状态按真实的纯函数变化
function setup() {
  const state = shallowRef<ResourceLayersState>(mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG));
  const resources = {
    state,
    add: (codes: readonly string[], at?: number) => (state.value = withAdded(state.value, codes, at)),
    remove: (codes: readonly string[]) => (state.value = withRemoved(state.value, codes)),
    moveLayer: (code: string, to: number) => (state.value = withMoved(state.value, code, to))
  };
  const added = shallowRef<readonly string[]>([]);
  const hidden = shallowRef<ReadonlySet<string>>(new Set());
  const catalog = shallowRef(['x', 'y', 'z'].map(id => ({ id }) as SceneModel));
  const models = {
    models: computed(() => catalog.value),
    added,
    hidden,
    add: (ids: readonly string[]) => (added.value = [...ids.filter(id => !added.value.includes(id)), ...added.value]),
    remove: (ids: readonly string[]) => (added.value = added.value.filter(id => !ids.includes(id))),
    moveModel: (id: string, to: number) => (added.value = added.value.filter(item => item !== id).toSpliced(to, 0, id))
  };
  const scope = effectScope();
  const current: CurrentLayers = required(
    scope.run(() => useCurrentLayers(resources, models)),
    '图层的平铺列表'
  );
  return { current, state, added, hidden, catalog, [Symbol.dispose]: () => scope.stop() };
}

describe('useCurrentLayers（ADR 0161）', () => {
  it('进页面时没有模型：列表就是资源的先后，没有资源画在模型上面', () => {
    using env = setup();
    expect(env.current.keys.value).toStrictEqual([r('bgdc_dltb')]);
    expect(env.current.overModels.value).toStrictEqual([]);
  });

  it('新加入的模型在最上面，新加入的资源在最上面那个模型的下面；同一批里先放模型', () => {
    using env = setup();
    env.current.add([m('x')]);
    expect(env.current.keys.value).toStrictEqual([m('x'), r('bgdc_dltb')]);

    env.current.add([r('bgdc_cjdcq'), m('y')]);
    expect(env.current.keys.value).toStrictEqual([m('y'), r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')]);
    // 资源的拥有者里也是这个先后（地图按它画）
    expect(addedCodes(env.state.value)).toStrictEqual(['bgdc_cjdcq', 'bgdc_dltb']);
  });

  it('挪到模型上面的资源画在模型上面；之后新加入的资源放在模型下面，不盖住模型', () => {
    using env = setup();
    env.current.add([m('x')]);
    env.current.move(r('bgdc_dltb'), 0);
    expect(env.current.keys.value).toStrictEqual([r('bgdc_dltb'), m('x')]);
    expect(env.current.overModels.value).toStrictEqual(['bgdc_dltb']);

    env.current.add([r('csxhjctb_hydl')]);
    expect(env.current.keys.value).toStrictEqual([r('bgdc_dltb'), m('x'), r('csxhjctb_hydl')]);
    expect(addedCodes(env.state.value)).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl']);
    expect(env.current.overModels.value).toStrictEqual(['bgdc_dltb']);
  });

  it('再加入模型时，之前放下的行不换位置；最上面的模型换了，画在模型上面的跟着变', () => {
    using env = setup();
    env.current.add([m('x'), r('bgdc_cjdcq')]);
    env.current.move(r('bgdc_cjdcq'), 0);
    expect(env.current.keys.value).toStrictEqual([r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')]);

    env.current.add([m('y')]);
    expect(env.current.keys.value).toStrictEqual([m('y'), r('bgdc_cjdcq'), m('x'), r('bgdc_dltb')]);
    expect(env.current.overModels.value).toStrictEqual([]);
  });

  it('筛选时按看得见的行挪，模型之间的先后交给模型的拥有者', () => {
    using env = setup();
    env.current.add([m('x'), m('y')]);
    env.current.add([r('bgdc_cjdcq')]);
    expect(env.current.keys.value).toStrictEqual([m('x'), r('bgdc_cjdcq'), m('y'), r('bgdc_dltb')]);

    // 只看模型：y 挪到第一行，放到 x 的正上方
    env.current.move(m('y'), 0, [m('x'), m('y')]);
    expect(env.current.keys.value).toStrictEqual([m('y'), m('x'), r('bgdc_cjdcq'), r('bgdc_dltb')]);
    expect(env.added.value).toStrictEqual(['y', 'x']);
    // 只看资源：地类图斑上移，放到村级调查区的正上方，模型不动
    env.current.move(r('bgdc_dltb'), 0, [r('bgdc_cjdcq'), r('bgdc_dltb')]);
    expect(env.current.keys.value).toStrictEqual([m('y'), m('x'), r('bgdc_dltb'), r('bgdc_cjdcq')]);
  });

  it('有显示着的模型：没有模型、模型都隐藏着时没有', () => {
    using env = setup();
    expect(env.current.shownModel.value).toBe(false);
    env.current.add([m('x'), m('y')]);
    env.hidden.value = new Set(['x']);
    expect(env.current.shownModel.value).toBe(true);
    env.hidden.value = new Set(['x', 'y']);
    expect(env.current.shownModel.value).toBe(false);
  });

  it('移出；清单里没有了的模型不显示', () => {
    using env = setup();
    env.current.add([m('x'), m('z')]);
    env.current.remove([m('x'), r('bgdc_dltb')]);
    expect(env.current.keys.value).toStrictEqual([m('z')]);

    env.catalog.value = [{ id: 'x' } as SceneModel];
    expect(env.current.keys.value).toStrictEqual([]);
  });
});
