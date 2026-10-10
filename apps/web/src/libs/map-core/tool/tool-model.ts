import type { ViewKind } from '../camera/camera-model';
import type { Unsubscribe } from '../events';
import { ModelEvents } from '../model-events';
import type { LngLat, MapInputEvent, PickResult, ScreenPoint } from '../view/view-input';

/** 地图的默认手势；工具激活时可以关掉其中几个 */
export interface Gestures {
  /** 拖动平移 */
  readonly dragPan: boolean;
  /** 双击放大 */
  readonly doubleClickZoom: boolean;
  /** 按住 Shift 拖动框选放大 */
  readonly boxZoom: boolean;
}

/** 工具能用到的视图能力：只有拾取和投影，拿不到视图的其他部分 */
export interface ToolView {
  readonly kind: ViewKind;
  pick(point: ScreenPoint): PickResult;
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
}

/** 交互工具（ADR 0034 第 2 条）；钩子不应抛错 */
export interface MapTool {
  /** 常驻模式（移动、点选）还是临时任务（测距、测面）；临时任务退出时回到上一个常驻模式 */
  readonly persistent: boolean;
  /** 激活时的光标；不写时用地图默认的样式 */
  readonly cursor?: string;
  /** 激活时要关掉的手势，写 false 的才会关掉 */
  readonly gestures?: Partial<Gestures>;
  activate?(): void;
  /** 退出时丢掉瞬时状态 */
  deactivate?(): void;
  /** 返回 true 表示已处理；Esc 没有被处理时，临时任务退出 */
  handleInput?(event: MapInputEvent, view: ToolView): boolean | void;
}

/** 内置的移动工具：默认的常驻模式，不改光标、不关手势 */
export const BROWSE_TOOL = 'browse';

const BROWSE: MapTool = Object.freeze({ persistent: true });

export interface ToolChange {
  readonly active: string;
  readonly previous: string;
}

interface ToolModelEvents {
  change: (change: ToolChange) => void;
}

/** 当前工具（ADR 0020 第 6 条、ADR 0034）：同一时间只有一个激活的工具，输入只交给它 */
export class ToolModel implements Disposable {
  readonly #events = new ModelEvents<ToolModelEvents>('ToolModel');
  readonly #tools = new Map<string, MapTool>([[BROWSE_TOOL, BROWSE]]);
  #active = BROWSE_TOOL;
  // 回退的目标：最近激活的常驻模式
  #base = BROWSE_TOOL;

  get active(): string {
    return this.#active;
  }

  /** 当前工具；视图据此应用光标和手势 */
  get activeTool(): MapTool {
    return this.#toolOf(this.#active);
  }

  has(id: string): boolean {
    return this.#tools.has(id);
  }

  register(id: string, tool: MapTool): void {
    this.#events.assertAlive();
    if (id === BROWSE_TOOL) {
      throw new Error(`工具 ID ${BROWSE_TOOL} 是内置的移动，不能登记`);
    }
    if (this.#tools.has(id)) {
      throw new Error(`工具 ${id} 已经登记`);
    }
    this.#tools.set(id, tool);
  }

  /** 激活一个工具：旧工具先退出；激活常驻模式时，它成为回退的目标 */
  activate(id: string): void {
    this.#events.assertAlive();
    const tool = this.#tools.get(id);
    if (!tool) {
      throw new Error(`未登记的工具：${id}`);
    }
    if (id !== this.#active) {
      this.#switchTo(id, tool);
    }
  }

  /** 让正在激活的工具退出：临时任务回到上一个常驻模式，常驻模式回到移动；没有激活时什么也不做 */
  release(id: string): void {
    this.#events.assertAlive();
    if (id !== this.#active) {
      return;
    }
    const target = this.activeTool.persistent ? BROWSE_TOOL : this.#base;
    if (target !== id) {
      this.#switchTo(target, this.#toolOf(target));
    }
  }

  /** 把输入交给当前工具；Esc 没有被处理时，临时任务退出 */
  dispatch(event: MapInputEvent, view: ToolView): void {
    this.#events.assertAlive();
    const tool = this.activeTool;
    const handled = tool.handleInput?.(event, view) === true;
    if (!handled && !tool.persistent && event.type === 'key' && event.key === 'Escape') {
      this.release(this.#active);
    }
  }

  on<E extends keyof ToolModelEvents>(event: E, callback: ToolModelEvents[E]): Unsubscribe {
    return this.#events.on(event, callback);
  }

  /** 释放时让当前工具退出 */
  [Symbol.dispose](): void {
    if (this.#events.disposed) {
      return;
    }
    this.activeTool.deactivate?.();
    this.#events[Symbol.dispose]();
  }

  #switchTo(id: string, tool: MapTool): void {
    const previous = this.#active;
    this.activeTool.deactivate?.();
    this.#active = id;
    if (tool.persistent) {
      this.#base = id;
    }
    tool.activate?.();
    this.#events.emit('change', { active: id, previous });
  }

  #toolOf(id: string): MapTool {
    const tool = this.#tools.get(id);
    if (!tool) {
      throw new Error(`未登记的工具：${id}`);
    }
    return tool;
  }
}
