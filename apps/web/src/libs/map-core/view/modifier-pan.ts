import type { PanModifier } from '../tool/tool-model';
import type { MapPointerEvent } from './view-input';

// MouseEvent.buttons 里左键的位
const LEFT_BUTTON_FLAG = 1;

/** 客户区坐标（MouseEvent 的 clientX、clientY） */
export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

export interface ModifierPanOptions {
  /** 画布的容器：在它的捕获阶段截下按下，先于引擎和画布上的监听 */
  readonly container: HTMLElement;
  /**
   * 截下哪些按下事件，默认只有 mousedown（MapLibre 的手势用鼠标事件）。
   * 三维要加上 pointerdown：Cesium 的相机控制用指针事件，同一次按下的两种事件都要截下
   */
  readonly downEvents?: readonly ('mousedown' | 'pointerdown')[];
  /** 指针从 from 移到 to：地图内容跟着指针走；from、to 相同时不调用 */
  readonly pan: (from: ClientPoint, to: ClientPoint) => void;
  /** 现在按哪个键临时拖动：视图就绪、当前工具声明了修饰键时才有 */
  readonly modifier: () => PanModifier | null;
  /** 临时拖动的光标可能变了 */
  readonly onCursorChange: () => void;
  /** DOM 事件回调里的错误交给它，不抛出 */
  readonly guard: (callback: () => void) => void;
}

/** 按住修饰键临时拖动地图（ADR 0056 第 2 节、ADR 0080 第 4 节）：截下这次按下、自己平移，并给出临时的光标 */
export class ModifierPan implements Disposable {
  readonly #options: ModifierPanOptions;
  readonly #listeners = new AbortController();
  // 两个修饰键都记下，哪个算数由 modifier() 决定
  #ctrl = false;
  #meta = false;
  // 别的左键按下（如框选）还没松开时不显示手型
  #leftDown = false;
  // 正在临时拖动时是上一次指针的位置（客户区坐标）
  #last: ClientPoint | null = null;
  // 最近一次按下是临时拖动：它的松开和派生的单击不交给工具，到下一次按下为止
  #swallowing = false;
  #cursor: 'grab' | 'grabbing' | null = null;

  constructor(options: ModifierPanOptions) {
    this.#options = options;
    const { container, downEvents = ['mousedown'] } = options;
    const document = container.ownerDocument;
    const listening = { capture: true, signal: this.#listeners.signal };
    // 捕获阶段：先于引擎在画布容器、画布上的监听，截下的按下它收不到
    for (const type of downEvents) {
      container.addEventListener(type, this.#onMouseDown, listening);
    }
    // 指针移出画布后也要继续拖动、知道左键松开
    document.addEventListener('mousemove', this.#onMouseMove, listening);
    document.addEventListener('mouseup', this.#onMouseUp, listening);
    // 不移动鼠标时也要知道修饰键的变化；点/框选不抢焦点，只能在文档上监听
    document.addEventListener('keydown', this.#onKey, listening);
    document.addEventListener('keyup', this.#onKey, listening);
    document.defaultView?.addEventListener('blur', this.#onBlur, listening);
  }

  /** 应当显示的光标：临时拖动的手型，或者工具声明的光标 */
  cursor(toolCursor: string | undefined): string {
    return this.#tempCursor() ?? toolCursor ?? '';
  }

  /** 临时拖动的按下派生的输入（松开、单击、双击）不交给工具 */
  swallows(type: MapPointerEvent['type']): boolean {
    return this.#swallowing && (type === 'up' || type === 'click' || type === 'dblclick');
  }

  /** 结束正在进行的临时拖动：切换工具、视图暂停时 */
  cancel(): void {
    this.#last = null;
    this.#notify();
  }

  [Symbol.dispose](): void {
    this.#last = null;
    this.#listeners.abort();
  }

  #onMouseDown = this.#guarded((event: MouseEvent) => {
    this.#readKeys(event);
    if (this.#last !== null) {
      // 同一次按下的另一种事件（pointerdown 之后的 mousedown）一并截下
      event.stopPropagation();
      return;
    }
    const modifier = this.#options.modifier();
    if (event.button === 0 && modifier !== null && this.#held(modifier)) {
      // 引擎的手势和地图事件都收不到：不旋转、不俯仰，工具也不开始框选；不阻止默认行为，画布照常获得焦点
      event.stopPropagation();
      this.#swallowing = true;
      this.#last = { x: event.clientX, y: event.clientY };
    } else {
      this.#swallowing = false;
      this.#leftDown ||= event.button === 0;
    }
    this.#notify();
  });

  #onMouseMove = this.#guarded((event: MouseEvent) => {
    this.#readKeys(event);
    // 在窗口外松开时收不到 mouseup，按 buttons 判断
    const leftPressed = (event.buttons & LEFT_BUTTON_FLAG) !== 0;
    this.#leftDown &&= leftPressed;
    const last = this.#last;
    if (last !== null) {
      if (!leftPressed || this.#options.modifier() === null) {
        this.#last = null;
      } else {
        // 和引擎自己的拖动一样，拖动中不选中页面上的文字
        event.preventDefault();
        this.#last = { x: event.clientX, y: event.clientY };
        if (last.x !== event.clientX || last.y !== event.clientY) {
          this.#options.pan(last, { x: event.clientX, y: event.clientY });
        }
      }
    }
    this.#notify();
  });

  #onMouseUp = this.#guarded((event: MouseEvent) => {
    this.#readKeys(event);
    if (event.button === 0) {
      this.#leftDown = false;
      this.#last = null;
    }
    this.#notify();
  });

  #onKey = this.#guarded((event: KeyboardEvent) => {
    this.#readKeys(event);
    this.#notify();
  });

  // 失焦时收不到松开修饰键和左键
  #onBlur = this.#guarded(() => {
    this.#ctrl = false;
    this.#meta = false;
    this.#leftDown = false;
    this.#last = null;
    this.#notify();
  });

  #readKeys({ ctrlKey, metaKey }: MouseEvent | KeyboardEvent): void {
    this.#ctrl = ctrlKey;
    this.#meta = metaKey;
  }

  #held(modifier: PanModifier): boolean {
    return modifier === 'ctrl' ? this.#ctrl : this.#meta;
  }

  #tempCursor(): 'grab' | 'grabbing' | null {
    if (this.#last !== null) {
      return 'grabbing';
    }
    const modifier = this.#options.modifier();
    return modifier !== null && this.#held(modifier) && !this.#leftDown ? 'grab' : null;
  }

  // 光标变了才通知；切换工具时由视图自己重新应用
  #notify(): void {
    const cursor = this.#tempCursor();
    if (cursor !== this.#cursor) {
      this.#cursor = cursor;
      this.#options.onCursorChange();
    }
  }

  // DOM 事件的回调里不抛错
  #guarded<E extends Event>(handler: (event: E) => void): (event: E) => void {
    return event => this.#options.guard(() => handler(event));
  }
}
