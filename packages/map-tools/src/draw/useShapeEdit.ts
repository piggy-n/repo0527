import type { MapInputEvent, MapTool, ScreenPoint, StyleGroup, ToolView } from '@mx/map-core';
import type { MapContext } from '@mx/map-vue';
import type { MultiPolygon } from 'geojson';
import { computed, type ComputedRef, getCurrentScope, type ShallowRef, shallowReadonly, shallowRef } from 'vue';
import type { PointerHintContent } from '../pointer-hint/pointer-hint';
import {
  editGroup,
  type Handle,
  handleAt,
  handlesOf,
  insertVertex,
  moveVertex,
  removeVertex,
  type VertexRef
} from './shape-edit';

/** 逐点编辑登记到会话里的工具 ID */
export const EDIT_TOOL_ID = 'edit-vertices';

export interface ShapeEditOptions {
  /** 正在编辑的范围；为 null 时工具不处理输入 */
  readonly geometry: () => MultiPolygon | null;
  /** 拖完、插入或删除节点后交出新的范围；拥有者决定怎样使用 */
  readonly onChange: (next: MultiPolygon) => void;
}

/** 删除选中节点的结果 */
export type RemoveResult = 'removed' | 'none' | 'minimum';

/** 逐点编辑的拥有者：页面登记工具、绑定 shape-edit 分组，面板和浮层通过 props 拿到它 */
export interface ShapeEdit {
  /** 交给 registerTools */
  readonly tools: Readonly<Record<typeof EDIT_TOOL_ID, MapTool>>;
  readonly active: ComputedRef<boolean>;
  /** 选中的节点：按 Delete 或面板上的按钮删除 */
  readonly selected: Readonly<ShallowRef<VertexRef | null>>;
  /** 鼠标旁的提示：工具在用、视图就绪、指针在画布上时有值 */
  readonly hint: ComputedRef<PointerHintContent | null>;
  /** 进入编辑；已经在用时退出 */
  readonly toggle: () => void;
  readonly stop: () => void;
  /** 删除选中的节点；环只剩 3 个节点时不删 */
  readonly removeSelected: () => RemoveResult;
  /** 绑定到 shape-edit 分组 */
  readonly deriveGroup: () => StyleGroup;
}

// 按下后移动不到这么多像素不算拖动：单击节点只是选中
const DRAG_THRESHOLD = 3;

interface Drag {
  readonly handle: Handle;
  readonly from: ScreenPoint;
  readonly geometry: MultiPolygon;
  /** 拖动后的范围和节点；还没移动时为 null */
  readonly result: { readonly geometry: MultiPolygon; readonly ref: VertexRef } | null;
}

/**
 * 创建逐点编辑的拥有者（ADR 0122），在页面的 setup 中调用：拖动节点移动，拖动边的中点插入节点，
 * 单击选中节点后按 Delete 删除。按在节点上时由工具接管拖动，其余地方照常平移地图；只在二维编辑
 */
export function useShapeEdit(
  map: Pick<MapContext, 'view' | 'pointer' | 'activeTool' | 'activateTool' | 'releaseTool'>,
  options: ShapeEditOptions
): ShapeEdit {
  if (!getCurrentScope()) {
    throw new Error('useShapeEdit 只能在组件的 setup 或 effectScope 中调用');
  }
  const drag = shallowRef<Drag | null>(null);
  const hovered = shallowRef<Handle | null>(null);
  const selected = shallowRef<VertexRef | null>(null);
  const active = computed(() => map.activeTool.value === EDIT_TOOL_ID);

  const hit = (point: ScreenPoint, view: ToolView): Handle | null => {
    const geometry = options.geometry();
    return geometry && view.kind === '2d' ? handleAt(handlesOf(geometry), point, lngLat => view.project(lngLat)) : null;
  };

  const reset = () => {
    drag.value = null;
    hovered.value = null;
    selected.value = null;
  };

  const removeSelected = (): RemoveResult => {
    const geometry = options.geometry();
    const ref = selected.value;
    if (!geometry || !ref) {
      return 'none';
    }
    const next = removeVertex(geometry, ref);
    if (!next) {
      return 'minimum';
    }
    selected.value = null;
    options.onChange(next);
    return 'removed';
  };

  const onMove = (point: ScreenPoint, view: ToolView): boolean => {
    const current = drag.value;
    if (!current) {
      hovered.value = hit(point, view);
      return false;
    }
    if (current.result === null && Math.hypot(point.x - current.from.x, point.y - current.from.y) < DRAG_THRESHOLD) {
      return true;
    }
    const picked = view.pick(point);
    if (picked.kind !== 'hit') {
      return true;
    }
    const { handle } = current;
    const result =
      handle.kind === 'vertex'
        ? { geometry: moveVertex(current.geometry, handle.ref, picked.lngLat), ref: handle.ref }
        : insertVertex(current.geometry, handle.ref, picked.lngLat);
    drag.value = { ...current, result };
    return true;
  };

  const onRelease = (): boolean => {
    const current = drag.value;
    if (!current) {
      return false;
    }
    drag.value = null;
    if (current.result) {
      selected.value = current.result.ref;
      options.onChange(current.result.geometry);
    } else if (current.handle.kind === 'vertex') {
      selected.value = current.handle.ref;
    }
    return true;
  };

  const onKey = (key: string): boolean => {
    if (key === 'Delete' || key === 'Backspace') {
      return removeSelected() !== 'none';
    }
    if (key !== 'Escape') {
      return false;
    }
    // Esc 先取消拖动、再取消选中，都没有时由工具模型退出编辑
    if (drag.value) {
      drag.value = null;
      return true;
    }
    if (selected.value) {
      selected.value = null;
      return true;
    }
    return false;
  };

  const handleInput = (event: MapInputEvent, view: ToolView): boolean => {
    switch (event.type) {
      case 'down': {
        const handle = event.button === 0 ? hit(event.point, view) : null;
        const geometry = options.geometry();
        if (!handle || !geometry) {
          return false;
        }
        drag.value = { handle, from: event.point, geometry, result: null };
        return true;
      }
      case 'move':
        return onMove(event.point, view);
      case 'up':
        return event.button === 0 && onRelease();
      case 'click':
        // 点在空白处取消选中；点在手柄上的已经在松开时处理
        if (event.button === 0 && !hit(event.point, view)) {
          selected.value = null;
        }
        return false;
      case 'leave':
        hovered.value = null;
        return false;
      case 'key':
        return onKey(event.key);
      case 'dblclick':
        break;
    }
    return false;
  };

  const tool: MapTool = {
    persistent: false,
    gestures: { doubleClickZoom: false },
    deactivate: reset,
    capturesPress: (point, view) => hit(point, view) !== null,
    handleInput: (event, view) => view.kind === '2d' && handleInput(event, view)
  };

  const hintLines = (): readonly string[] => {
    if (drag.value) {
      return ['松开鼠标完成调整', 'Esc 取消这次拖动'];
    }
    if (hovered.value?.kind === 'vertex') {
      return ['拖动调整节点的位置', '单击选中节点后按 Delete 删除'];
    }
    if (hovered.value?.kind === 'middle') {
      return ['拖动在这条边上增加节点'];
    }
    if (selected.value) {
      return ['按 Delete 删除选中的节点', 'Esc 取消选中'];
    }
    return ['拖动节点调整范围，拖动边上的小圆点增加节点', 'Esc 退出编辑'];
  };

  return {
    tools: { [EDIT_TOOL_ID]: tool },
    active,
    selected: shallowReadonly(selected),
    hint: computed(() => {
      const point = map.pointer.value;
      if (!active.value || point === null || map.view.value?.kind !== '2d') {
        return null;
      }
      return { point, lines: hintLines() };
    }),
    toggle: () => {
      if (active.value) {
        map.releaseTool(EDIT_TOOL_ID);
      } else {
        map.activateTool(EDIT_TOOL_ID);
      }
    },
    stop: () => map.releaseTool(EDIT_TOOL_ID),
    removeSelected,
    deriveGroup: () =>
      editGroup(active.value ? options.geometry() : null, {
        preview: drag.value?.result?.geometry ?? null,
        hovered: hovered.value,
        selected: selected.value
      })
  };
}
