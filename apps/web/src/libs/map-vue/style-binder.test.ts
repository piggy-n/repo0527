// @vitest-environment node
import { type StyleGroup, StyleModel } from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { StyleBinder } from './style-binder';

type Groups = 'resources' | 'highlight' | 'measure';

const GROUPS: Groups[] = ['resources', 'highlight', 'measure'];

// 资源分组的数据源 ID 带年份：换年份时高亮必须一起改引用
function resourcesByYear(year: number): StyleGroup {
  return {
    sources: { [`resources-${year}`]: { type: 'vector', tiles: [`https://tiles.test/${year}/{z}/{x}/{y}.pbf`] } },
    layers: [{ id: 'resources-fill', type: 'fill', source: `resources-${year}`, 'source-layer': 'dltb' }]
  };
}

function highlightByYear(year: number): StyleGroup {
  return {
    sources: {},
    layers: [{ id: 'highlight-line', type: 'line', source: `resources-${year}`, 'source-layer': 'dltb' }]
  };
}

// 数据源 ID 不随年份变化：引用始终合法，校验发现不了年份不配套
function resourcesWithStableSource(year: number): StyleGroup {
  return {
    sources: { resources: { type: 'vector', tiles: [`https://tiles.test/${year}/{z}/{x}/{y}.pbf`] } },
    layers: [{ id: 'resources-fill', type: 'fill', source: 'resources', 'source-layer': 'dltb' }]
  };
}

function highlightWithStableSource(year: number): StyleGroup {
  return {
    sources: {},
    layers: [
      { id: 'highlight-line', type: 'line', source: 'resources', 'source-layer': 'dltb', filter: ['==', 'year', year] }
    ]
  };
}

function measureGroup(points: number): StyleGroup {
  return {
    sources: { 'measure-points': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [{ id: 'measure-line', type: 'line', source: 'measure-points', paint: { 'line-width': points } }]
  };
}

function tileOf(style: StyleModel<Groups>, sourceId: string): unknown {
  const source = style.current.sources[sourceId];
  return source && 'tiles' in source ? source.tiles?.[0] : undefined;
}

function setup() {
  const style = new StyleModel<Groups>({ groups: GROUPS });
  const errors: Error[] = [];
  const binder = new StyleBinder(style, error => errors.push(error as Error));
  const setGroups = vi.spyOn(style, 'setGroups');
  return {
    style,
    binder,
    errors,
    setGroups,
    [Symbol.dispose]() {
      binder[Symbol.dispose]();
      style[Symbol.dispose]();
    }
  };
}

describe('StyleBinder', () => {
  it('start 时把所有绑定的初始值一次提交', () => {
    using env = setup();
    env.binder.bind({ resources: () => resourcesByYear(2022), highlight: () => highlightByYear(2022) });
    expect(env.setGroups).not.toHaveBeenCalled();

    env.binder.start();

    expect(env.setGroups).toHaveBeenCalledTimes(1);
    expect(env.style.version).toBe(1);
    expect(env.style.current.layers.map(layer => layer.id)).toEqual(['resources-fill', 'highlight-line']);
  });

  it('同一轮里资源换数据源、高亮改引用，一次提交成功；分开提交时中间状态通不过校验', async () => {
    using env = setup();
    const year = ref(2022);
    env.binder.bind({ resources: () => resourcesByYear(year.value), highlight: () => highlightByYear(year.value) });
    env.binder.start();

    // 背景：只换资源分组时，高亮引用的数据源不存在
    expect(() => env.style.setGroup('resources', resourcesByYear(2023))).toThrow(
      '图层 "highlight-line" 引用的数据源 "resources-2022" 不存在'
    );

    year.value = 2023;
    await nextTick();

    expect(env.setGroups).toHaveBeenCalledTimes(2);
    expect(env.errors).toEqual([]);
    expect(Object.keys(env.style.current.sources)).toEqual(['resources-2023']);
  });

  it('高亮晚一轮变化：第一轮被拒绝并报告、不抛出，会话保持原样；下一轮连同资源一起提交', async () => {
    using env = setup();
    const year = ref(2022);
    const highlightYear = ref(2022);
    env.binder.bind({
      resources: () => resourcesByYear(year.value),
      highlight: () => highlightByYear(highlightYear.value)
    });
    env.binder.start();

    year.value = 2023;
    await nextTick();

    expect(env.errors).toHaveLength(1);
    expect(env.errors[0]?.message).toContain('没有通过校验');
    expect(env.errors[0]?.cause).toBeInstanceOf(Error);
    expect(env.style.version).toBe(1);
    expect(Object.keys(env.style.current.sources)).toEqual(['resources-2022']);

    highlightYear.value = 2023;
    await nextTick();

    expect(env.errors).toHaveLength(1);
    expect(env.style.version).toBe(2);
    expect(Object.keys(env.style.current.sources)).toEqual(['resources-2023']);
    expect(env.setGroups).toHaveBeenLastCalledWith({
      resources: resourcesByYear(2023),
      highlight: highlightByYear(2023)
    });
  });

  it('任一推导失败时整批不提交，同一个失败只报告一次；无关的变化不会提交新资源配旧高亮', async () => {
    using env = setup();
    const year = ref(2022);
    const points = ref(1);
    const failure = new Error('高亮规则不支持 2023 年');
    env.binder.bind({
      resources: () => resourcesWithStableSource(year.value),
      highlight: () => {
        if (year.value === 2023) {
          throw failure;
        }
        return highlightWithStableSource(year.value);
      },
      measure: () => measureGroup(points.value)
    });
    env.binder.start();

    // 推导函数的异常不能冒出侦听器
    year.value = 2023;
    await expect(nextTick()).resolves.toBeUndefined();

    expect(env.style.version).toBe(1);
    expect(tileOf(env.style, 'resources')).toContain('/2022/');
    expect(env.errors).toHaveLength(1);
    expect(env.errors[0]?.message).toContain('highlight');
    expect(env.errors[0]?.cause).toBe(failure);

    // 失败的结果被缓存：再读不会变成旧的成功值，测量也跟着停在上一份快照
    points.value = 2;
    await expect(nextTick()).resolves.toBeUndefined();
    points.value = 3;
    await expect(nextTick()).resolves.toBeUndefined();

    expect(env.style.version).toBe(1);
    expect(tileOf(env.style, 'resources')).toContain('/2022/');
    expect(env.errors).toHaveLength(1);

    year.value = 2024;
    await nextTick();

    expect(env.style.version).toBe(2);
    expect(env.setGroups).toHaveBeenLastCalledWith({
      resources: resourcesWithStableSource(2024),
      highlight: highlightWithStableSource(2024),
      measure: measureGroup(3)
    });
  });

  it('一个绑定变化时，其他绑定的推导函数不执行', async () => {
    using env = setup();
    const points = ref(1);
    const resources = vi.fn<() => StyleGroup>(() => resourcesByYear(2022));
    const highlight = vi.fn<() => StyleGroup>(() => highlightByYear(2022));
    env.binder.bind({ resources, highlight, measure: () => measureGroup(points.value) });
    env.binder.start();

    points.value = 2;
    await nextTick();
    points.value = 3;
    await nextTick();
    points.value = 4;
    await nextTick();

    expect(env.setGroups).toHaveBeenCalledTimes(4);
    expect(resources).toHaveBeenCalledTimes(1);
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('同一轮的多次变化只提交一次；推导结果还是同一个对象时不提交', async () => {
    using env = setup();
    const points = ref(1);
    const flag = ref(false);
    const constant = resourcesByYear(2022);
    env.binder.bind({
      resources: () => (flag.value ? constant : constant),
      measure: () => measureGroup(points.value)
    });
    env.binder.start();

    points.value = 2;
    points.value = 3;
    await nextTick();
    flag.value = true;
    await nextTick();

    expect(env.setGroups).toHaveBeenCalledTimes(2);
    expect(env.style.version).toBe(2);
  });

  it('start 之后再绑定、同一个分组重复绑定时抛错；重复时这一次的绑定都不生效', () => {
    using env = setup();
    env.binder.bind({ resources: () => resourcesByYear(2022) });

    expect(() => env.binder.bind({ measure: () => measureGroup(1), resources: () => resourcesByYear(2023) })).toThrow(
      '分组 resources 已经绑定过'
    );

    env.binder.start();
    expect(env.style.current.layers.map(layer => layer.id)).toEqual(['resources-fill']);
    expect(() => env.binder.bind({ highlight: () => highlightByYear(2022) })).toThrow('只能在 provideMap');
  });

  it('释放后不再提交，也不清空已提交的分组', async () => {
    using env = setup();
    const points = ref(1);
    env.binder.bind({ measure: () => measureGroup(points.value) });
    env.binder.start();

    env.binder[Symbol.dispose]();
    points.value = 2;
    await nextTick();

    expect(env.setGroups).toHaveBeenCalledTimes(1);
    expect(env.style.current.layers.map(layer => layer.id)).toEqual(['measure-line']);
  });
});
