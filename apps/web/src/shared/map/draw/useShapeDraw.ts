import { useEventListener } from '@vueuse/core';
import type { LngLat, MapInputEvent, MapTool, ScreenBox, ScreenPoint, StyleGroup, ToolView } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { computed, type ComputedRef, getCurrentScope, type ShallowRef, shallowReadonly, shallowRef, watch } from 'vue';
import {
  type BoxGesture,
  cancelBox,
  drawingBox,
  moveBox,
  NO_BOX_GESTURE,
  pressBox,
  releaseBox
} from '../box-select/box-gesture';
import { currentPanKey } from '../pan-key';
import type { PointerHintContent } from '../pointer-hint/pointer-hint';
import { pixelSizeAt, screenBoxPolygon } from '../query-geometry';
import {
  drawGroup,
  drawHintLines,
  type DrawnShape,
  MIN_POLYGON_POINTS,
  polygonOf,
  type PolygonDraft,
  type ShapeKind
} from './shape-draw';

/** 两种绘制登记到会话里的工具 ID */
export const DRAW_TOOL_IDS = {
  rectangle: 'draw-rectangle',
  polygon: 'draw-polygon'
} as const satisfies Record<ShapeKind, string>;

export interface ShapeDrawOptions {
  /** 开始画新的范围：上一个范围已经清掉，使用方据此作废依赖它的结果 */
  onStart?: () => void;
  /** 画完一个范围；之后工具退回移动 */
  onComplete?: (shape: DrawnShape) => void;
}

/** 绘制的拥有者：页面登记工具、绑定 draw 分组，面板和浮层通过 props 拿到它 */
export interface ShapeDraw {
  /** 交给 registerTools */
  readonly tools: Readonly<Record<(typeof DRAW_TOOL_IDS)[ShapeKind], MapTool>>;
  /** 画完的范围，只有一个 */
  readonly shape: Readonly<ShallowRef<DrawnShape | null>>;
  /** 当前在用的绘制方式；没有在画时为 null */
  readonly active: ComputedRef<ShapeKind | null>;
  /** 拖动框选时的矩形，交给框选的浮层 */
  readonly boxDraft: ComputedRef<ScreenBox | null>;
  /** 鼠标旁的提示，交给框选的浮层：工具在用、视图就绪、指针在画布上时有值 */
  readonly hint: ComputedRef<PointerHintContent | null>;
  /** 进入一种绘制方式；已经在用时退出（再点一次按钮取消，同旧页面），画完的范围保留 */
  readonly toggle: (kind: ShapeKind) => void;
  /** 退出绘制，画完的范围保留 */
  readonly stop: () => void;
  /** 清掉画完的范围和正在画的 */
  readonly clear: () => void;
  /** 绑定到 draw 分组 */
  readonly deriveGroup: () => StyleGroup;
}

// 拾取到的经纬度；拾取不到时为 null
function pickAt(view: ToolView, point: ScreenPoint): LngLat | null {
  const result = view.pick(point);
  return result.kind === 'hit' ? result.lngLat : null;
}

const KIND_BY_TOOL = new Map<string, ShapeKind>([
  [DRAW_TOOL_IDS.rectangle, 'rectangle'],
  [DRAW_TOOL_IDS.polygon, 'polygon']
]);

/**
 * 创建绘制的拥有者，在页面的 setup 中调用。框选用点/框选的手势（ADR 0049 第 1 节），关掉拖动平移、按住修饰键临时拖动；
 * 多边形同测面：单击加节点、双击完成，可以拖动地图。两种都是临时任务，画完或 Esc 退回移动
 */
export function useShapeDraw(
  map: Pick<MapContext, 'useCamera' | 'view' | 'pointer' | 'activeTool' | 'activateTool' | 'releaseTool'>,
  options: ShapeDrawOptions = {}
): ShapeDraw {
  if (!getCurrentScope()) {
    throw new Error('useShapeDraw 只能在组件的 setup 或 effectScope 中调用');
  }
  const panKey = currentPanKey();
  const shape = shallowRef<DrawnShape | null>(null);
  const draft = shallowRef<PolygonDraft | null>(null);
  const gesture = shallowRef<BoxGesture>(NO_BOX_GESTURE);
  const active = computed(() => KIND_BY_TOOL.get(map.activeTool.value) ?? null);

  const cancelGesture = () => {
    gesture.value = cancelBox(gesture.value);
  };
  // 框选时地图移动（滚轮缩放等）、窗口失焦、视图不再就绪都取消这次手势，同点/框选
  watch(map.useCamera(), cancelGesture);
  useEventListener('blur', cancelGesture);
  watch(
    () => map.view.value === null,
    gone => {
      if (gone) {
        cancelGesture();
      }
    }
  );

  // 开始画新的范围时清掉上一个
  const begin = () => {
    shape.value = null;
    options.onStart?.();
  };

  const complete = (kind: ShapeKind, next: DrawnShape) => {
    shape.value = next;
    draft.value = null;
    map.releaseTool(DRAW_TOOL_IDS[kind]);
    options.onComplete?.(next);
  };

  const handleRectangle = (event: MapInputEvent, view: ToolView): boolean => {
    switch (event.type) {
      case 'down':
        if (event.button === 0) {
          gesture.value = pressBox(event.point);
        }
        return event.button === 0;
      case 'move': {
        const wasDrawing = gesture.value.kind === 'drawing';
        gesture.value = moveBox(gesture.value, event.point);
        if (!wasDrawing && gesture.value.kind === 'drawing') {
          begin();
        }
        return gesture.value.kind !== 'idle';
      }
      case 'up': {
        if (event.button !== 0) {
          return false;
        }
        const wasDrawing = gesture.value.kind === 'drawing';
        const { gesture: next, box } = releaseBox(gesture.value, event.point);
        gesture.value = next;
        if (!box) {
          return false;
        }
        const polygon = screenBoxPolygon(box, point => view.pick(point));
        if (!wasDrawing) {
          begin();
        }
        if (polygon) {
          complete('rectangle', { kind: 'rectangle', polygon, pixelSize: pixelSizeAt(event.point, view.pick) });
        }
        return true;
      }
      case 'leave':
        cancelGesture();
        return false;
      case 'key':
        if (event.key !== 'Escape' || gesture.value.kind === 'idle') {
          return false;
        }
        cancelGesture();
        return true;
      case 'click':
      case 'dblclick':
        return false;
    }
  };

  const handlePolygon = (event: MapInputEvent, view: ToolView): boolean => {
    const current = draft.value;
    switch (event.type) {
      case 'click': {
        // 只用左键；双击里的第二次单击不加点
        if (event.button !== 0 || event.clickCount > 1) {
          return false;
        }
        const point = pickAt(view, event.point);
        if (!point) {
          return true;
        }
        if (!current) {
          begin();
        }
        draft.value = { points: [...(current?.points ?? []), point], preview: null };
        return true;
      }
      case 'move': {
        if (current) {
          draft.value = { ...current, preview: pickAt(view, event.point) };
        }
        return current !== null;
      }
      case 'leave':
        if (current?.preview) {
          draft.value = { ...current, preview: null };
        }
        return false;
      case 'dblclick':
        if (!current) {
          return false;
        }
        if (current.points.length < MIN_POLYGON_POINTS) {
          draft.value = null;
          return true;
        }
        complete('polygon', {
          kind: 'polygon',
          polygon: polygonOf(current.points),
          pixelSize: pixelSizeAt(event.point, view.pick)
        });
        return true;
      case 'key':
        // 正在画时 Esc 取消这一次、留在工具里；没在画时不处理，由工具模型退回移动
        if (event.key !== 'Escape' || !current) {
          return false;
        }
        draft.value = null;
        return true;
      case 'down':
      case 'up':
        return false;
    }
  };

  // 只在二维画；三维期间的输入不处理（数据查询页没有三维，留作保护）
  const tool = (kind: ShapeKind): MapTool => {
    const handle = kind === 'rectangle' ? handleRectangle : handlePolygon;
    return {
      persistent: false,
      cursor: 'crosshair',
      gestures: kind === 'rectangle' ? { dragPan: false, boxZoom: false } : { doubleClickZoom: false },
      ...(kind === 'rectangle' && { panModifier: panKey.modifier }),
      // 退出时丢掉没画完的，画完的保留
      deactivate: () => {
        gesture.value = NO_BOX_GESTURE;
        draft.value = null;
      },
      handleInput: (event, view) => view.kind === '2d' && handle(event, view)
    };
  };

  const progress = (kind: ShapeKind): number => {
    if (kind === 'rectangle') {
      return gesture.value.kind === 'drawing' ? 1 : 0;
    }
    return draft.value?.points.length ?? 0;
  };

  return {
    tools: {
      [DRAW_TOOL_IDS.rectangle]: tool('rectangle'),
      [DRAW_TOOL_IDS.polygon]: tool('polygon')
    },
    shape: shallowReadonly(shape),
    active,
    boxDraft: computed(() => drawingBox(gesture.value)),
    hint: computed(() => {
      const kind = active.value;
      const point = map.pointer.value;
      if (kind === null || point === null || map.view.value?.kind !== '2d') {
        return null;
      }
      return { point, lines: drawHintLines(kind, progress(kind), panKey) };
    }),
    toggle: kind => {
      const id = DRAW_TOOL_IDS[kind];
      if (active.value === kind) {
        map.releaseTool(id);
      } else {
        map.activateTool(id);
      }
    },
    stop: () => {
      const kind = active.value;
      if (kind !== null) {
        map.releaseTool(DRAW_TOOL_IDS[kind]);
      }
    },
    clear: () => {
      shape.value = null;
      draft.value = null;
      cancelGesture();
    },
    deriveGroup: () => drawGroup(shape.value, draft.value)
  };
}
