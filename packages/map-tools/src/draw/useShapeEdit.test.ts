import type { MapInputEvent, MapPointerEvent, ScreenPoint, ToolView, ViewKind } from '@mx/map-core';
import type { MapViewport } from '@mx/map-vue';
import type { MultiPolygon } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref, shallowRef } from 'vue';
import { required } from '../testing/required';
import { EDIT_TOOL_ID, useShapeEdit } from './useShapeEdit';

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
const pointer = (type: MapPointerEvent['type'], x: number, y: number): MapPointerEvent => ({
  type,
  point: { x, y },
  button: 0,
  clickCount: 1,
  modifiers: MODIFIERS
});
const key = (name: string): MapInputEvent => ({ type: 'key', key: name });

// 屏幕上 (100,100)-(300,100)-(300,300)-(100,300) 的正方形
const SQUARE: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [118.1, 32.9],
        [118.3, 32.9],
        [118.3, 32.7],
        [118.1, 32.7],
        [118.1, 32.9]
      ]
    ]
  ]
};

function setup(initial: MultiPolygon | null = SQUARE) {
  const geometry = shallowRef<MultiPolygon | null>(initial);
  const view = shallowRef<MapViewport | null>({ ...toolView(), eyeHeight: () => null, heading: () => null });
  const mapPointer = shallowRef<ScreenPoint | null>(null);
  const activeTool = ref('browse');
  const map = {
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
  const onChange = vi.fn<(next: MultiPolygon) => void>(next => {
    geometry.value = next;
  });
  const scope = effectScope();
  const edit = required(
    scope.run(() => useShapeEdit(map, { geometry: () => geometry.value, onChange })),
    '编辑的拥有者'
  );
  const tool = edit.tools[EDIT_TOOL_ID];
  const send = (event: MapInputEvent, kind: ViewKind = '2d') => tool.handleInput?.(event, toolView(kind));
  const ring = () => geometry.value?.coordinates[0]?.[0];
  return { edit, tool, send, geometry, ring, onChange, activeTool, mapPointer, scope };
}

describe('useShapeEdit', () => {
  it('只在按到节点或边的中点时接管拖动，别处照常平移地图', () => {
    const { tool } = setup();
    expect(tool.capturesPress?.({ x: 102, y: 99 }, toolView())).toBe(true);
    expect(tool.capturesPress?.({ x: 200, y: 101 }, toolView())).toBe(true);
    expect(tool.capturesPress?.({ x: 200, y: 200 }, toolView())).toBe(false);
    expect(tool.capturesPress?.({ x: 102, y: 99 }, toolView('3d'))).toBe(false);
    const empty = setup(null);
    expect(empty.tool.capturesPress?.({ x: 102, y: 99 }, toolView())).toBe(false);
  });

  it('拖动节点：拖动中只预览，松开后交出新的范围并选中这个节点', () => {
    const { edit, send, ring, onChange } = setup();
    edit.toggle();
    expect(send(pointer('down', 100, 100))).toBe(true);
    expect(send(pointer('move', 150, 80))).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    const preview = edit.deriveGroup();
    expect(JSON.stringify(preview.sources)).toContain('"kind":"preview"');

    expect(send(pointer('up', 150, 80))).toBe(true);
    expect(onChange).toHaveBeenCalledOnce();
    expect(ring()?.[0]).toEqual([118.15, 32.92]);
    expect(ring()?.at(-1)).toEqual([118.15, 32.92]);
    expect(edit.selected.value).toEqual({ part: 0, ring: 0, index: 0 });
  });

  it('按下后移动不到 3 像素只是选中，不改范围', () => {
    const { edit, send, onChange } = setup();
    edit.toggle();
    send(pointer('down', 300, 100));
    send(pointer('move', 301, 101));
    send(pointer('up', 301, 101));
    expect(onChange).not.toHaveBeenCalled();
    expect(edit.selected.value).toEqual({ part: 0, ring: 0, index: 1 });
  });

  it('拖动边的中点插入节点', () => {
    const { edit, send, ring } = setup();
    edit.toggle();
    send(pointer('down', 200, 100));
    send(pointer('move', 200, 50));
    send(pointer('up', 200, 50));
    expect(ring()).toHaveLength(6);
    expect(ring()?.[1]).toEqual([118.2, 32.95]);
    expect(edit.selected.value).toEqual({ part: 0, ring: 0, index: 1 });
  });

  it('选中节点后按 Delete 删除；只剩 3 个节点时不删', () => {
    const { edit, send, ring } = setup();
    edit.toggle();
    expect(send(key('Delete'))).toBe(false);
    send(pointer('down', 100, 100));
    send(pointer('up', 100, 100));
    expect(send(key('Delete'))).toBe(true);
    expect(ring()).toHaveLength(4);
    expect(edit.selected.value).toBeNull();

    send(pointer('down', 300, 100));
    send(pointer('up', 300, 100));
    expect(edit.removeSelected()).toBe('minimum');
    expect(ring()).toHaveLength(4);
  });

  it('点在空白处取消选中；Esc 先取消拖动、再取消选中，最后交给工具模型退出', () => {
    const { edit, send } = setup();
    edit.toggle();
    send(pointer('down', 100, 100));
    send(pointer('up', 100, 100));
    send(pointer('click', 200, 200));
    expect(edit.selected.value).toBeNull();

    send(pointer('down', 100, 100));
    send(pointer('move', 150, 80));
    expect(send(key('Escape'))).toBe(true);
    expect(edit.deriveGroup().sources).not.toHaveProperty('preview');
    expect(send(pointer('up', 150, 80))).toBe(false);
    expect(edit.selected.value).toBeNull();

    send(pointer('down', 100, 100));
    send(pointer('up', 100, 100));
    expect(send(key('Escape'))).toBe(true);
    expect(send(key('Escape'))).toBe(false);
  });

  it('提示随悬停、拖动、选中变化；不在编辑时没有提示、没有手柄', () => {
    const { edit, send, mapPointer, activeTool } = setup();
    mapPointer.value = { x: 100, y: 100 };
    expect(edit.hint.value).toBeNull();
    expect(edit.deriveGroup().layers).toEqual([]);
    edit.toggle();
    expect(activeTool.value).toBe(EDIT_TOOL_ID);
    expect(edit.hint.value?.lines[0]).toBe('拖动节点调整范围，拖动边上的小圆点增加节点');
    send(pointer('move', 101, 101));
    expect(edit.hint.value?.lines[0]).toBe('拖动调整节点的位置');
    send(pointer('move', 200, 101));
    expect(edit.hint.value?.lines[0]).toBe('拖动在这条边上增加节点');
    send(pointer('down', 200, 101));
    expect(edit.hint.value?.lines[0]).toBe('松开鼠标完成调整');
    edit.toggle();
    expect(activeTool.value).toBe('browse');
  });
});
