// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ToolModel, type ToolView } from '../tool/tool-model';
import type { LngLat, MapInputEvent, MapPointerEvent, ScreenPoint } from '../view/view-input';
import { geodesicArea, geodesicDistance, lineLength } from './geodesic';
import { type MeasureState, MeasureStore } from './measure-store';

// 屏幕坐标与经纬度的固定换算：每 100 像素 0.01 度；x 为负时什么都没打到
const lngLat = (x: number, y: number): LngLat => [118 + x / 10000, 32 + y / 10000];

const VIEW: ToolView = {
  kind: '2d',
  pick: ({ x, y }) => (x < 0 ? { kind: 'miss' } : { kind: 'hit', surface: 'map', lngLat: lngLat(x, y) }),
  project: () => null
};

function pointer(
  type: MapPointerEvent['type'],
  x: number,
  y: number,
  options: { button?: number; clickCount?: number } = {}
): MapPointerEvent {
  return {
    type,
    point: { x, y },
    button: options.button ?? 0,
    clickCount: options.clickCount ?? 1,
    modifiers: { shift: false, ctrl: false, alt: false, meta: false }
  };
}

const ESCAPE: MapInputEvent = { type: 'key', key: 'Escape' };

function setup() {
  const store = new MeasureStore();
  const distance = store.createTool('distance');
  const area = store.createTool('area');
  const states: MeasureState[] = [];
  const pointers: (ScreenPoint | null)[] = [];
  store.on('change', state => void states.push(state));
  store.on('pointer', point => void pointers.push(point));
  const input = (tool: typeof distance, ...events: MapInputEvent[]) =>
    events.map(event => tool.handleInput?.(event, VIEW));
  return { store, distance, area, states, pointers, input };
}

describe('MeasureStore', () => {
  it('一开始没有测量结果，也没有鼠标位置', () => {
    const { store } = setup();

    expect(store.state).toStrictEqual({ measurements: [], draft: null });
    expect(store.pointer).toBeNull();
  });

  it('工具是临时任务：十字光标，只关掉双击放大', () => {
    const { distance } = setup();

    expect(distance).toMatchObject({ persistent: false, cursor: 'crosshair', gestures: { doubleClickZoom: false } });
  });

  it('测距：单击加点，双击完成；双击里的第二次单击不加点；数值按椭球面算一次', () => {
    const { store, distance, input } = setup();

    input(
      distance,
      pointer('click', 0, 0),
      pointer('click', 300, 400),
      pointer('click', 300, 400, { clickCount: 2 }),
      pointer('dblclick', 300, 400, { clickCount: 2 })
    );

    expect(store.state).toStrictEqual({
      measurements: [
        {
          id: 'distance-1',
          kind: 'distance',
          points: [lngLat(0, 0), lngLat(300, 400)],
          method: 'geodesic',
          value: geodesicDistance(lngLat(0, 0), lngLat(300, 400))
        }
      ],
      draft: null
    });
  });

  it('测面：至少三个点，数值是椭球面上的面积', () => {
    const { store, area, input } = setup();

    input(area, pointer('click', 0, 0), pointer('click', 100, 0), pointer('click', 100, 100));
    input(area, pointer('dblclick', 100, 100, { clickCount: 2 }));

    const points = [lngLat(0, 0), lngLat(100, 0), lngLat(100, 100)];
    expect(store.state.measurements).toStrictEqual([
      { id: 'area-1', kind: 'area', points, method: 'geodesic', value: geodesicArea(points) }
    ]);
  });

  it('点数不够时双击取消这一条：测距少于 2 个，测面少于 3 个', () => {
    const { store, distance, area, input } = setup();

    input(distance, pointer('click', 0, 0), pointer('dblclick', 0, 0, { clickCount: 2 }));
    input(area, pointer('click', 0, 0), pointer('click', 100, 0), pointer('dblclick', 100, 0, { clickCount: 2 }));

    expect(store.state).toStrictEqual({ measurements: [], draft: null });
  });

  it('只用左键；什么都没打到时不加点；没在画时双击什么也不做', () => {
    const { store, distance, states, input } = setup();

    input(distance, pointer('click', 0, 0, { button: 2 }), pointer('click', -1, 0), pointer('dblclick', 0, 0));

    expect(store.state.draft).toBeNull();
    expect(states).toStrictEqual([]);
  });

  it('鼠标移动：总是记下位置；正在画时更新预览点，离开画布时清掉位置和预览点', () => {
    const { store, distance, states, pointers, input } = setup();

    input(distance, pointer('move', 10, 20));
    expect(states).toStrictEqual([]);

    input(distance, pointer('click', 0, 0), pointer('move', 200, 0), pointer('leave', 200, 0));

    expect(pointers).toStrictEqual([{ x: 10, y: 20 }, { x: 200, y: 0 }, null]);
    expect(states.map(state => state.draft?.preview ?? null)).toStrictEqual([null, lngLat(200, 0), null]);
    expect(store.state.draft?.points).toStrictEqual([lngLat(0, 0)]);

    input(distance, pointer('move', 300, 0), pointer('click', 300, 0));
    expect(store.state.draft).toStrictEqual({
      kind: 'distance',
      points: [lngLat(0, 0), lngLat(300, 0)],
      preview: null
    });
  });

  it('鼠标位置没变时不通知', () => {
    const { distance, pointers, input } = setup();

    input(distance, pointer('move', 10, 20), pointer('move', 10, 20), pointer('leave', 0, 0), pointer('leave', 0, 0));

    expect(pointers).toStrictEqual([{ x: 10, y: 20 }, null]);
  });

  it('Esc：正在画时取消这一条并留在工具里；没在画时交给工具模型退出', () => {
    const { store, distance } = setup();
    const tools = new ToolModel();
    tools.register('measure-distance', distance);
    tools.activate('measure-distance');

    tools.dispatch(pointer('click', 0, 0), VIEW);
    tools.dispatch(ESCAPE, VIEW);
    expect(store.state.draft).toBeNull();
    expect(tools.active).toBe('measure-distance');

    tools.dispatch(ESCAPE, VIEW);
    expect(tools.active).toBe('browse');
  });

  it('工具退出时丢掉没画完的那一条和鼠标位置，已完成的保留', () => {
    const { store, distance, pointers, input } = setup();
    input(distance, pointer('click', 0, 0), pointer('click', 100, 0), pointer('dblclick', 100, 0, { clickCount: 2 }));
    input(distance, pointer('click', 0, 100), pointer('move', 50, 100));

    distance.deactivate?.();

    expect(store.state.measurements).toHaveLength(1);
    expect(store.state.draft).toBeNull();
    expect(pointers.at(-1)).toBeNull();
  });

  it('两个工具共用结果；编号递增；换一种工具时重新开始画', () => {
    const { store, distance, area, input } = setup();

    input(distance, pointer('click', 0, 0), pointer('click', 100, 0), pointer('dblclick', 100, 0, { clickCount: 2 }));
    input(distance, pointer('click', 0, 100));
    input(area, pointer('click', 0, 0), pointer('click', 100, 0), pointer('click', 100, 100));
    input(area, pointer('dblclick', 100, 100, { clickCount: 2 }));

    expect(store.state.measurements.map(({ id, kind }) => [id, kind])).toStrictEqual([
      ['distance-1', 'distance'],
      ['area-2', 'area']
    ]);
    expect(store.state.measurements[1]?.points).toStrictEqual([lngLat(0, 0), lngLat(100, 0), lngLat(100, 100)]);
    expect(store.state.measurements[0]?.value).toBe(lineLength([lngLat(0, 0), lngLat(100, 0)]));
  });

  it('删除一条、清除全部（连同正在画的）；没有变化时不通知', () => {
    const { store, distance, states, input } = setup();
    input(distance, pointer('click', 0, 0), pointer('click', 100, 0), pointer('dblclick', 100, 0, { clickCount: 2 }));
    input(
      distance,
      pointer('click', 0, 100),
      pointer('click', 100, 100),
      pointer('dblclick', 100, 100, { clickCount: 2 })
    );
    input(distance, pointer('click', 0, 200));
    const before = states.length;

    store.remove('distance-1');
    store.remove('distance-9');
    expect(store.state.measurements.map(({ id }) => id)).toStrictEqual(['distance-2']);
    expect(states).toHaveLength(before + 1);

    store.clear();
    store.clear();
    expect(store.state).toStrictEqual({ measurements: [], draft: null });
    expect(states).toHaveLength(before + 2);
  });

  it('状态不可变：变化时整体替换，之前拿到的状态不变', () => {
    const { store, distance, input } = setup();
    input(distance, pointer('click', 0, 0));
    const before = store.state;

    input(distance, pointer('click', 100, 0));

    expect(store.state).not.toBe(before);
    expect(before.draft?.points).toStrictEqual([lngLat(0, 0)]);
  });

  it('释放后不能再使用，监听器清空', () => {
    const { store, distance } = setup();
    const listener = vi.fn<(state: MeasureState) => void>();
    store.on('change', listener);

    store[Symbol.dispose]();

    expect(() => store.clear()).toThrow('MeasureStore 已释放');
    expect(() => store.remove('distance-1')).toThrow('MeasureStore 已释放');
    expect(() => distance.handleInput?.(pointer('click', 0, 0), VIEW)).toThrow('MeasureStore 已释放');
    expect(listener).not.toHaveBeenCalled();
  });
});
