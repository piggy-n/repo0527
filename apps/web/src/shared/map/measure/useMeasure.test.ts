// @vitest-environment node
import type { MapInputEvent, ToolView } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { computed, effectScope } from 'vue';
import { MEASURE_TOOL_IDS, measureKindOf, useMeasure } from './useMeasure';

// 每 100 像素 0.01 度
const VIEW: ToolView = {
  kind: '2d',
  pick: ({ x, y }) => ({ kind: 'hit', surface: 'map', lngLat: [118 + x / 10000, 32 + y / 10000] }),
  project: () => null
};

function input(type: 'click' | 'move' | 'dblclick', x: number, y: number, clickCount = 1): MapInputEvent {
  return {
    type,
    point: { x, y },
    button: 0,
    clickCount,
    modifiers: { shift: false, ctrl: false, alt: false, meta: false }
  };
}

function setup() {
  const scope = effectScope();
  const measure = scope.run(() => useMeasure());
  if (!measure) {
    throw new Error('没有创建测量');
  }
  const distance = measure.tools[MEASURE_TOOL_IDS.distance];
  const send = (...events: MapInputEvent[]) => events.forEach(event => distance.handleInput?.(event, VIEW));
  return { scope, measure, send };
}

describe('useMeasure', () => {
  it('交给 registerTools 的是测距、测面两个工具', () => {
    const { measure } = setup();

    expect(Object.keys(measure.tools)).toStrictEqual(['measure-distance', 'measure-area']);

    measure.tools[MEASURE_TOOL_IDS.area].handleInput?.(input('click', 0, 0), VIEW);
    expect(measure.state.value.draft?.kind).toBe('area');
  });

  it('由当前工具得到测量类型；不是测量工具时没有', () => {
    expect(measureKindOf('measure-distance')).toBe('distance');
    expect(measureKindOf('measure-area')).toBe('area');
    expect(measureKindOf('browse')).toBeUndefined();
  });

  it('状态跟随工具的输入，推导出 measure 分组；删除、清除', () => {
    const { measure, send } = setup();
    expect(measure.deriveGroup()).toStrictEqual({ sources: {}, layers: [] });

    send(input('click', 0, 0), input('click', 100, 0), input('dblclick', 100, 0, 2));

    expect(measure.state.value.measurements.map(({ id }) => id)).toStrictEqual(['distance-1']);
    expect(Object.keys(measure.deriveGroup().sources)).toStrictEqual(['measure']);

    measure.remove('distance-1');
    expect(measure.state.value.measurements).toStrictEqual([]);

    send(input('click', 0, 0));
    measure.clear();
    expect(measure.state.value).toStrictEqual({ measurements: [], draft: null });
  });

  it('鼠标位置单独跟随；没在画时移动鼠标不会重新推导样式', () => {
    const { measure, send } = setup();
    const group = computed(() => measure.deriveGroup());
    const before = group.value;

    send(input('move', 10, 20));

    expect(measure.pointer.value).toStrictEqual({ x: 10, y: 20 });
    expect(group.value).toBe(before);

    send(input('click', 0, 0), input('move', 30, 40));
    expect(group.value).not.toBe(before);
  });

  it('作用域销毁时释放测量的状态', () => {
    const { scope, measure } = setup();

    scope.stop();

    expect(() => measure.clear()).toThrow('MeasureStore 已释放');
  });

  it('不在组件 setup 或 effectScope 中调用时抛错', () => {
    expect(() => useMeasure()).toThrow('useMeasure 只能在组件的 setup 或 effectScope 中调用');
  });
});
