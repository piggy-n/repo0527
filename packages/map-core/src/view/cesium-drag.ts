import type { ViewKind } from '../camera/camera-model';
import type { ClientPoint } from './modifier-pan';

/**
 * 鼠标的操作方式（ADR 0168）：maplibre 是 MapLibre 自带的（右键拖、Ctrl + 左键拖旋转和倾斜）；cesium 是 Cesium 式
 * （右键拖缩放，中键拖、Ctrl + 左键拖旋转和倾斜）。两种都是左键拖平移、滚轮朝鼠标缩放
 */
export type MouseScheme = 'maplibre' | 'cesium';

/** 二维、三维各用哪种操作方式 */
export type MouseSchemes = Readonly<Record<ViewKind, MouseScheme>>;

/** 都用 MapLibre 自带的：页面、测试没给时 */
export const MAPLIBRE_MOUSE: MouseSchemes = Object.freeze({ '2d': 'maplibre', '3d': 'maplibre' });

// MouseEvent.button 和 MouseEvent.buttons 里对应的位
const LEFT = 0;
const MIDDLE = 1;
const RIGHT = 2;
const BUTTON_FLAGS: Readonly<Record<number, number>> = { [LEFT]: 1, [MIDDLE]: 4, [RIGHT]: 2 };
// 右键往下拖放大、往上拖缩小（同 Cesium）：拖 100 像素一级
const ZOOM_PER_PIXEL = 0.01;
// 旋转、倾斜的速率同 MapLibre 自带的右键拖：横向每像素 0.8°，往上拖抬起视角、每像素 0.5°
const BEARING_PER_PIXEL = 0.8;
const PITCH_PER_PIXEL = -0.5;
// 移动不到这么多像素不算拖动（同 MapLibre 的 clickTolerance）
const CLICK_TOLERANCE = 3;

export interface CesiumDragOptions {
  /** 画布的容器：在它的捕获阶段截下按下，先于引擎和画布上的监听（同 ModifierPan） */
  readonly container: HTMLElement;
  /** 现在是否按 Cesium 式：视图就绪、当前种类用 cesium、漫游没有接管 */
  readonly active: () => boolean;
  /** Ctrl + 左键拖能不能旋转：当前工具把 Ctrl 用作临时拖动（ADR 0056）时让给它 */
  readonly ctrlRotates: () => boolean;
  /** 缩放 delta 级，around 是按下的位置（客户区坐标），缩放时它不动 */
  readonly zoom: (delta: number, around: ClientPoint) => void;
  /** 旋转、倾斜（度），绕视野中心 */
  readonly rotate: (bearingDelta: number, pitchDelta: number) => void;
  /** DOM 事件回调里的错误交给它，不抛出 */
  readonly guard: (callback: () => void) => void;
}

// 正在进行的拖动：start 是按下的位置，last 是上一次处理的位置；moved 是已经超过了点击的容差
interface Drag {
  readonly kind: 'zoom' | 'rotate';
  readonly button: number;
  readonly start: ClientPoint;
  last: ClientPoint;
  moved: boolean;
}

/**
 * Cesium 式的鼠标操作（ADR 0168）：右键拖缩放，中键拖、Ctrl + 左键拖旋转和倾斜。截下这些按下，引擎自带的手势和工具都收不到；
 * 左键拖、滚轮、双击、Shift 拉框照旧交给引擎。按 Cesium 式时地图上没有浏览器的右键菜单（MapLibre 的旋转手势开着时也没有）
 */
export class CesiumDrag implements Disposable {
  readonly #options: CesiumDragOptions;
  readonly #listeners = new AbortController();
  #drag: Drag | null = null;

  constructor(options: CesiumDragOptions) {
    this.#options = options;
    const { container } = options;
    const document = container.ownerDocument;
    const listening = { capture: true, signal: this.#listeners.signal };
    container.addEventListener('mousedown', this.#onMouseDown, listening);
    container.addEventListener('contextmenu', this.#onContextMenu, listening);
    // 指针移出画布后也要继续拖动、知道松开
    document.addEventListener('mousemove', this.#onMouseMove, listening);
    document.addEventListener('mouseup', this.#onMouseUp, listening);
    document.defaultView?.addEventListener('blur', this.#onBlur, { signal: this.#listeners.signal });
  }

  /** 结束正在进行的拖动：切换种类、工具，视图暂停时 */
  cancel(): void {
    this.#drag = null;
  }

  [Symbol.dispose](): void {
    this.#drag = null;
    this.#listeners.abort();
  }

  #onMouseDown = this.#guarded((event: MouseEvent) => {
    if (!this.#options.active()) {
      this.#drag = null;
      return;
    }
    if (this.#drag !== null) {
      // 拖动期间又来的按下一并截下
      event.stopPropagation();
      return;
    }
    const kind = this.#kindOf(event);
    if (kind === null) {
      return;
    }
    // 引擎的手势和地图事件都收不到；中键还要阻止浏览器的自动滚动
    event.stopPropagation();
    if (event.button === MIDDLE) {
      event.preventDefault();
    }
    const start = { x: event.clientX, y: event.clientY };
    this.#drag = { kind, button: event.button, start, last: start, moved: false };
  });

  #onMouseMove = this.#guarded((event: MouseEvent) => {
    const drag = this.#drag;
    if (drag === null) {
      return;
    }
    // 在窗口外松开时收不到 mouseup，按 buttons 判断；中途换了种类、漫游接管了也结束
    if ((event.buttons & (BUTTON_FLAGS[drag.button] ?? 0)) === 0 || !this.#options.active()) {
      this.#drag = null;
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < CLICK_TOLERANCE) {
      return;
    }
    drag.moved = true;
    // 和引擎自己的拖动一样，拖动中不选中页面上的文字
    event.preventDefault();
    const dx = point.x - drag.last.x;
    const dy = point.y - drag.last.y;
    drag.last = point;
    if (dx === 0 && dy === 0) {
      return;
    }
    if (drag.kind === 'zoom') {
      if (dy !== 0) {
        this.#options.zoom(dy * ZOOM_PER_PIXEL, drag.start);
      }
    } else {
      this.#options.rotate(dx * BEARING_PER_PIXEL, dy * PITCH_PER_PIXEL);
    }
  });

  #onMouseUp = this.#guarded((event: MouseEvent) => {
    if (this.#drag?.button === event.button) {
      this.#drag = null;
    }
  });

  // 右键拖缩放：松开时不弹出浏览器的菜单
  #onContextMenu = this.#guarded((event: MouseEvent) => {
    if (this.#options.active()) {
      event.preventDefault();
    }
  });

  #onBlur = this.#guarded(() => {
    this.#drag = null;
  });

  #kindOf(event: MouseEvent): Drag['kind'] | null {
    if (event.button === RIGHT) {
      return 'zoom';
    }
    if (event.button === MIDDLE) {
      return 'rotate';
    }
    if (event.button === LEFT && event.ctrlKey && this.#options.ctrlRotates()) {
      return 'rotate';
    }
    return null;
  }

  // DOM 事件的回调里不抛错
  #guarded<E extends Event>(handler: (event: E) => void): (event: E) => void {
    return event => this.#options.guard(() => handler(event));
  }
}
