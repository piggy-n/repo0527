import {
  type MapTool,
  type MeasureKind,
  type MeasureState,
  MeasureStore,
  type ScreenPoint,
  type StyleGroup
} from '@yzt/map-core';
import { getCurrentScope, onScopeDispose, type ShallowRef, shallowReadonly, shallowRef } from 'vue';
import { measureGroup } from './measure-style';

/** 测距、测面登记到会话里的工具 ID，工具栏用同样的 ID */
export const MEASURE_TOOL_IDS = {
  distance: 'measure-distance',
  area: 'measure-area'
} as const satisfies Record<MeasureKind, string>;

export type MeasureToolId = (typeof MEASURE_TOOL_IDS)[MeasureKind];

const KIND_BY_TOOL = new Map<string, MeasureKind>([
  [MEASURE_TOOL_IDS.distance, 'distance'],
  [MEASURE_TOOL_IDS.area, 'area']
]);

/** 当前工具对应的测量类型；不是测量工具时为 undefined */
export function measureKindOf(toolId: string): MeasureKind | undefined {
  return KIND_BY_TOOL.get(toolId);
}

/** 测量的拥有者（ADR 0035）：页面登记工具、绑定 measure 分组，浮层和工具栏通过 props 拿到它 */
export interface Measure {
  /** 交给 registerTools */
  readonly tools: Readonly<Record<MeasureToolId, MapTool>>;
  /** 测量结果和正在画的那一条 */
  readonly state: Readonly<ShallowRef<MeasureState>>;
  /** 鼠标在画布上的位置，只用来放提示；不进样式推导 */
  readonly pointer: Readonly<ShallowRef<ScreenPoint | null>>;
  readonly remove: (id: string) => void;
  /** 清除全部测量（工具栏的"清除"） */
  readonly clear: () => void;
  /** 绑定到 measure 分组 */
  readonly deriveGroup: () => StyleGroup;
}

/** 创建测量的拥有者，在页面的 setup 中调用；作用域销毁时释放测量的状态 */
export function useMeasure(): Measure {
  if (!getCurrentScope()) {
    throw new Error('useMeasure 只能在组件的 setup 或 effectScope 中调用');
  }
  const store = new MeasureStore();
  // 状态和鼠标位置分开：只有前者进样式推导，没在画时移动鼠标不会提交样式
  const state = shallowRef(store.state);
  const pointer = shallowRef(store.pointer);
  store.on('change', next => (state.value = next));
  store.on('pointer', next => (pointer.value = next));
  onScopeDispose(() => store[Symbol.dispose]());

  return {
    tools: {
      [MEASURE_TOOL_IDS.distance]: store.createTool('distance'),
      [MEASURE_TOOL_IDS.area]: store.createTool('area')
    },
    state: shallowReadonly(state),
    pointer: shallowReadonly(pointer),
    remove: id => store.remove(id),
    clear: () => store.clear(),
    deriveGroup: () => measureGroup(state.value)
  };
}
