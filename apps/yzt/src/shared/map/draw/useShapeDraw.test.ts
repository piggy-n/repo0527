import type { CameraState, MapInputEvent, MapPointerEvent, ScreenPoint, ToolView, ViewKind } from '@yzt/map-core';
import type { MapViewport } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref, shallowRef } from 'vue';
import { required } from '../../testing/required';
import type { DrawnShape } from './shape-draw';
import { DRAW_TOOL_IDS, useShapeDraw } from './useShapeDraw';

// 拾取：每像素 0.001 度，画布左上角是 (118, 33)
function toolView(kind: ViewKind = '2d'): ToolView {
  return {
    kind,
    pick: ({ x, y }) => ({ kind: 'hit', surface: 'map', lngLat: [118 + x / 1000, 33 - y / 1000] }),
    project: ([lng, lat]) => ({ x: (lng - 118) * 1000, y: (33 - lat) * 1000 }),
    queryRendered: () => []
  };
}

const MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false };

function pointer(type: MapPointerEvent['type'], x: number, y: number, clickCount = 1): MapPointerEvent {
  return { type, point: { x, y }, button: 0, clickCount, modifiers: MODIFIERS };
}

function setup() {
  const camera = shallowRef<CameraState>({ center: [119, 33], zoom: 10, bearing: 0, pitch: 0 });
  const view = shallowRef<MapViewport | null>({ ...toolView(), eyeHeight: () => null, heading: () => null });
  const mapPointer = shallowRef<ScreenPoint | null>(null);
  const activeTool = ref('browse');
  const map = {
    useCamera: () => camera,
    view,
    pointer: mapPointer,
    activeTool,
    activateTool: (id: string) => {
      activeTool.value = id;
    },
    releaseTool: (id: string) => {
      if (activeTool.value === id) {
        activeTool.value = 'browse';
      }
    }
  };
  const onStart = vi.fn<() => void>();
  const onComplete = vi.fn<(shape: DrawnShape) => void>();
  const scope = effectScope();
  const draw = required(
    scope.run(() => useShapeDraw(map, { onStart, onComplete })),
    '绘制的拥有者'
  );
  const send = (kind: 'rectangle' | 'polygon', event: MapInputEvent, viewKind: ViewKind = '2d') =>
    draw.tools[DRAW_TOOL_IDS[kind]].handleInput?.(event, toolView(viewKind));
  return { draw, send, camera, mapPointer, activeTool, onStart, onComplete, scope };
}

describe('useShapeDraw 框选', () => {
  it('离开起点后开始（清掉上一个范围），松开时完成：四角拾取的多边形，工具退回移动', async () => {
    const { draw, send, activeTool, onStart, onComplete } = setup();
    draw.toggle('rectangle');
    expect(activeTool.value).toBe(DRAW_TOOL_IDS.rectangle);

    send('rectangle', pointer('down', 100, 100));
    expect(onStart).not.toHaveBeenCalled();
    send('rectangle', pointer('move', 300, 200));
    expect(onStart).toHaveBeenCalledOnce();
    expect(draw.boxDraft.value).toStrictEqual({ from: { x: 100, y: 100 }, to: { x: 300, y: 200 } });

    expect(send('rectangle', pointer('up', 300, 200))).toBe(true);
    const shape = required(draw.shape.value, '画完的范围');
    expect(shape.kind).toBe('rectangle');
    expect(shape.polygon.coordinates[0]).toHaveLength(5);
    expect(shape.polygon.coordinates[0]?.[0]).toStrictEqual([118.1, 32.9]);
    expect(shape.pixelSize).toBeCloseTo(0.001, 10);
    expect(onComplete).toHaveBeenCalledWith(shape);
    expect(activeTool.value).toBe('browse');
    expect(draw.boxDraft.value).toBeNull();
  });

  it('没离开起点就松开不算绘制，已有的范围保留', () => {
    const { draw, send, onStart, onComplete } = setup();
    draw.toggle('rectangle');
    send('rectangle', pointer('down', 100, 100));
    send('rectangle', pointer('move', 300, 200));
    send('rectangle', pointer('up', 300, 200));
    const first = draw.shape.value;
    draw.toggle('rectangle');

    send('rectangle', pointer('down', 50, 50));
    expect(send('rectangle', pointer('up', 51, 51))).toBe(false);

    expect(draw.shape.value).toBe(first);
    expect(onStart).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('拖动中地图移动时取消这次手势，松开也不完成', async () => {
    const { draw, send, camera, onComplete } = setup();
    draw.toggle('rectangle');
    send('rectangle', pointer('down', 100, 100));
    send('rectangle', pointer('move', 300, 200));

    camera.value = { ...camera.value, zoom: 11 };
    await Promise.resolve();

    expect(draw.boxDraft.value).toBeNull();
    send('rectangle', pointer('up', 300, 200));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('Esc 只在拖动中处理（取消这次），没有拖动时交给工具模型退出', () => {
    const { draw, send } = setup();
    draw.toggle('rectangle');

    expect(send('rectangle', { type: 'key', key: 'Escape' })).toBe(false);
    send('rectangle', pointer('down', 100, 100));
    send('rectangle', pointer('move', 300, 200));
    expect(send('rectangle', { type: 'key', key: 'Escape' })).toBe(true);
    expect(draw.boxDraft.value).toBeNull();
  });
});

describe('useShapeDraw 多边形', () => {
  it('单击加节点（第一次时开始），双击里的第二次单击不加，双击完成', () => {
    const { draw, send, activeTool, onStart, onComplete } = setup();
    draw.toggle('polygon');

    send('polygon', pointer('click', 0, 0));
    expect(onStart).toHaveBeenCalledOnce();
    send('polygon', pointer('click', 100, 0));
    send('polygon', pointer('click', 100, 100));
    send('polygon', pointer('click', 100, 100, 2));
    send('polygon', pointer('dblclick', 100, 100));

    const shape = required(draw.shape.value, '画完的范围');
    expect(shape.polygon.coordinates[0]).toStrictEqual([
      [118, 33],
      [118.1, 33],
      [118.1, 32.9],
      [118, 33]
    ]);
    expect(onStart).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(shape);
    expect(activeTool.value).toBe('browse');
  });

  it('不足三个节点时双击取消这一次；Esc 在画时取消、没在画时不处理', () => {
    const { draw, send, onComplete } = setup();
    draw.toggle('polygon');
    send('polygon', pointer('click', 0, 0));
    send('polygon', pointer('click', 100, 0));
    send('polygon', pointer('dblclick', 100, 0));

    expect(onComplete).not.toHaveBeenCalled();
    expect(draw.deriveGroup()).toStrictEqual({ sources: {}, layers: [] });

    send('polygon', pointer('click', 0, 0));
    expect(send('polygon', { type: 'key', key: 'Escape' })).toBe(true);
    expect(draw.deriveGroup().layers).toHaveLength(0);
    expect(send('polygon', { type: 'key', key: 'Escape' })).toBe(false);
  });

  it('三维视图的输入不处理', () => {
    const { draw, send } = setup();
    draw.toggle('polygon');

    expect(send('polygon', pointer('click', 0, 0), '3d')).toBe(false);
    expect(draw.deriveGroup().layers).toHaveLength(0);
  });
});

describe('useShapeDraw 操作与提示', () => {
  it('再点一次同一种方式退出；退出、stop 都保留画完的范围，clear 清掉', () => {
    const { draw, send, activeTool } = setup();
    draw.toggle('polygon');
    send('polygon', pointer('click', 0, 0));
    send('polygon', pointer('click', 100, 0));
    send('polygon', pointer('click', 100, 100));
    send('polygon', pointer('dblclick', 100, 100));

    draw.toggle('rectangle');
    expect(draw.active.value).toBe('rectangle');
    draw.toggle('rectangle');
    expect(activeTool.value).toBe('browse');
    draw.toggle('polygon');
    draw.stop();
    expect(draw.active.value).toBeNull();
    expect(draw.shape.value).not.toBeNull();

    draw.clear();
    expect(draw.shape.value).toBeNull();
  });

  it('工具在用、指针在画布上时有提示，文案随进度变化', () => {
    const { draw, send, mapPointer } = setup();
    expect(draw.hint.value).toBeNull();
    draw.toggle('polygon');
    expect(draw.hint.value).toBeNull();

    mapPointer.value = { x: 10, y: 10 };
    expect(draw.hint.value?.lines[0]).toBe('单击绘制首个节点');
    send('polygon', pointer('click', 0, 0));
    expect(draw.hint.value?.lines[0]).toBe('单击继续绘制第二个节点');

    draw.stop();
    expect(draw.hint.value).toBeNull();
  });
});
