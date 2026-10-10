import type { Unsubscribe } from '../events';
import { ModelEvents } from '../model-events';
import type { MapTool, ToolView } from '../tool/tool-model';
import type { LngLat, MapInputEvent, ScreenPoint } from '../view/view-input';
import { geodesicArea, lineLength } from './geodesic';

export type MeasureKind = 'distance' | 'area';

/** 一条完成的测量（ADR 0024 第 4 条）：数值在完成时算一次，测距是米，测面是平方米 */
export interface Measurement {
  readonly id: string;
  readonly kind: MeasureKind;
  readonly points: readonly LngLat[];
  readonly method: 'geodesic';
  readonly value: number;
}

/** 正在画的那一条：已确定的点属于工具状态（ADR 0024 第 5 条），预览点跟随鼠标 */
export interface MeasureDraft {
  readonly kind: MeasureKind;
  readonly points: readonly LngLat[];
  readonly preview: LngLat | null;
}

/** 推导样式和标签用的状态：不可变，变化时整体替换 */
export interface MeasureState {
  readonly measurements: readonly Measurement[];
  readonly draft: MeasureDraft | null;
}

interface MeasureStoreEvents {
  change: (state: MeasureState) => void;
  /** 鼠标在画布上的位置，只用来放提示；离开画布、工具退出时为 null */
  pointer: (pointer: ScreenPoint | null) => void;
}

// 完成一条需要的最少点数
const MIN_POINTS: Readonly<Record<MeasureKind, number>> = { distance: 2, area: 3 };

const EMPTY: MeasureState = Object.freeze({ measurements: Object.freeze([]), draft: null });

function measure(kind: MeasureKind, points: readonly LngLat[]): number {
  return kind === 'distance' ? lineLength(points) : geodesicArea(points);
}

/** 测量的状态与测距、测面两个工具（ADR 0035）；两个工具共用这一份结果 */
export class MeasureStore implements Disposable {
  readonly #events = new ModelEvents<MeasureStoreEvents>('MeasureStore');
  #state: MeasureState = EMPTY;
  #pointer: ScreenPoint | null = null;
  #nextId = 1;

  get state(): MeasureState {
    return this.#state;
  }

  get pointer(): ScreenPoint | null {
    return this.#pointer;
  }

  /** 创建一个工具：临时任务，十字光标，只关掉双击放大，测量中可以拖动地图 */
  createTool(kind: MeasureKind): MapTool {
    return {
      persistent: false,
      cursor: 'crosshair',
      gestures: { doubleClickZoom: false },
      // 退出时丢掉没画完的那一条，已完成的保留
      deactivate: () => {
        this.#setDraft(null);
        this.#setPointer(null);
      },
      handleInput: (event, view) => this.#handleInput(kind, event, view)
    };
  }

  /** 删除一条测量；不存在时什么也不做 */
  remove(id: string): void {
    this.#events.assertAlive();
    const measurements = this.#state.measurements.filter(item => item.id !== id);
    if (measurements.length !== this.#state.measurements.length) {
      this.#setState({ ...this.#state, measurements });
    }
  }

  /** 清除全部测量，连同正在画的那一条 */
  clear(): void {
    this.#events.assertAlive();
    if (this.#state !== EMPTY) {
      this.#setState(EMPTY);
    }
  }

  on<E extends keyof MeasureStoreEvents>(event: E, callback: MeasureStoreEvents[E]): Unsubscribe {
    return this.#events.on(event, callback);
  }

  [Symbol.dispose](): void {
    this.#events[Symbol.dispose]();
  }

  #handleInput(kind: MeasureKind, event: MapInputEvent, view: ToolView): boolean {
    this.#events.assertAlive();
    const draft = this.#state.draft;
    switch (event.type) {
      case 'click': {
        // 只用左键；双击里的第二次单击不加点
        if (event.button !== 0 || event.clickCount > 1) {
          return false;
        }
        const point = this.#pick(view, event.point);
        if (point) {
          const points = draft?.kind === kind ? [...draft.points, point] : [point];
          this.#setDraft({ kind, points, preview: null });
        }
        return true;
      }
      case 'move': {
        this.#setPointer(event.point);
        if (draft) {
          this.#setDraft({ ...draft, preview: this.#pick(view, event.point) });
        }
        return true;
      }
      case 'leave': {
        this.#setPointer(null);
        if (draft?.preview) {
          this.#setDraft({ ...draft, preview: null });
        }
        return true;
      }
      case 'dblclick': {
        if (draft) {
          this.#finish(draft);
        }
        return true;
      }
      case 'key': {
        // 正在画时 Esc 取消这一条、留在工具里；没在画时不处理，由工具模型退回常驻模式
        if (event.key !== 'Escape' || !draft) {
          return false;
        }
        this.#setDraft(null);
        return true;
      }
      case 'down':
      case 'up':
        break;
    }
    return false;
  }

  // 点数够了就完成并算出数值，不够就取消这一条
  #finish({ kind, points }: MeasureDraft): void {
    if (points.length < MIN_POINTS[kind]) {
      this.#setDraft(null);
      return;
    }
    const measurement: Measurement = {
      id: `${kind}-${this.#nextId++}`,
      kind,
      points,
      method: 'geodesic',
      value: measure(kind, points)
    };
    this.#setState({ measurements: [...this.#state.measurements, measurement], draft: null });
  }

  #pick(view: ToolView, point: ScreenPoint): LngLat | null {
    const result = view.pick(point);
    return result.kind === 'hit' ? result.lngLat : null;
  }

  #setDraft(draft: MeasureDraft | null): void {
    if (draft !== this.#state.draft) {
      this.#setState({ ...this.#state, draft });
    }
  }

  #setState(state: MeasureState): void {
    this.#state = state;
    this.#events.emit('change', state);
  }

  #setPointer(pointer: ScreenPoint | null): void {
    if (pointer?.x !== this.#pointer?.x || pointer?.y !== this.#pointer?.y) {
      this.#pointer = pointer;
      this.#events.emit('pointer', pointer);
    }
  }
}
