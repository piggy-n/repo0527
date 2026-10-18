import { CameraEventType, KeyboardEventModifier } from 'cesium';
import type { MapPointerEvent, ToolModel, ToolView } from '@yzt/map-core';
import { safeReporter } from '@yzt/utils';

/** 输入适配器只修改公开手势配置，不接触 Cesium 的聚合器和私有状态 */
export interface CesiumInputController {
  enableInputs: boolean;
  enableRotate: boolean;
  enableTilt: boolean;
  enableLook: boolean;
  rotateEventTypes: unknown;
}

export interface CesiumInputOptions {
  canvas: HTMLCanvasElement;
  controller: CesiumInputController;
  tool: ToolModel;
  view: ToolView;
  beginUserOperation: () => void;
  onError: (error: unknown) => void;
}

// 拖动开始后松开或改变修饰键，仍然保持这一次平移，不突然变成旋转或俯仰
const PAN_EVENTS = [
  CameraEventType.LEFT_DRAG,
  ...[
    [KeyboardEventModifier.CTRL],
    [KeyboardEventModifier.SHIFT],
    [KeyboardEventModifier.ALT],
    [KeyboardEventModifier.CTRL, KeyboardEventModifier.SHIFT],
    [KeyboardEventModifier.CTRL, KeyboardEventModifier.ALT],
    [KeyboardEventModifier.SHIFT, KeyboardEventModifier.ALT],
    [KeyboardEventModifier.CTRL, KeyboardEventModifier.SHIFT, KeyboardEventModifier.ALT]
  ].map(modifier => ({ eventType: CameraEventType.LEFT_DRAG, modifier }))
];

/** 只让就绪且当前显示的三维画布向工具发送输入 */
export class CesiumInput implements Disposable {
  readonly #options: CesiumInputOptions;
  readonly #resources = new DisposableStack();
  readonly #report: (error: unknown) => void;
  readonly #defaults: Pick<CesiumInputController, 'enableRotate' | 'enableTilt' | 'enableLook' | 'rotateEventTypes'>;
  #active = false;
  #pointer: PointerEvent | null = null;
  #last: MapPointerEvent | null = null;
  #ctrl = false;
  #meta = false;
  #panning = false;
  #finishPan = false;
  #swallowClick = false;
  #releasing = false;

  constructor(options: CesiumInputOptions) {
    this.#options = options;
    this.#report = safeReporter(options.onError, 'CesiumInput');
    const { canvas, controller, tool } = options;
    this.#defaults = {
      enableRotate: controller.enableRotate,
      enableTilt: controller.enableTilt,
      enableLook: controller.enableLook,
      rotateEventTypes: controller.rotateEventTypes
    };
    const tabIndex = canvas.getAttribute('tabindex');
    canvas.tabIndex = 0;
    this.#resources.defer(() => {
      if (tabIndex === null) {
        canvas.removeAttribute('tabindex');
      } else {
        canvas.setAttribute('tabindex', tabIndex);
      }
    });
    controller.enableInputs = false;
    const listeners = new AbortController();
    this.#resources.defer(() => listeners.abort());
    const listening = { capture: true, signal: listeners.signal };
    canvas.addEventListener('pointerdown', this.#onDown, listening);
    canvas.ownerDocument.addEventListener('pointermove', this.#onMove, listening);
    canvas.ownerDocument.addEventListener('pointerup', this.#onUp, listening);
    canvas.ownerDocument.addEventListener('pointercancel', this.#onCancel, listening);
    canvas.addEventListener('pointerleave', this.#onLeave, listening);
    canvas.addEventListener('click', this.#onClick, listening);
    canvas.addEventListener('dblclick', this.#onDoubleClick, listening);
    canvas.addEventListener('wheel', this.#onWheel, { ...listening, passive: true });
    canvas.addEventListener('keydown', this.#onKeyDown, listening);
    canvas.ownerDocument.addEventListener('keydown', this.#onModifier, listening);
    canvas.ownerDocument.addEventListener('keyup', this.#onModifier, listening);
    canvas.ownerDocument.defaultView?.addEventListener('blur', this.#onBlur, listening);
    this.#resources.defer(tool.on('change', () => this.#guard(() => {
      this.#cancel(false);
      this.#applyTool();
    })));
  }

  /** 恢复后先等待新的用户意图，避免旧的惯性在隐藏视图上继续写回相机 */
  setActive(active: boolean): void {
    if (this.#resources.disposed || active === this.#active) {
      return;
    }
    this.#guard(() => {
      if (!active) {
        this.#cancel(true);
      }
      this.#active = active;
      this.#options.controller.enableInputs = false;
      this.#applyTool();
    });
  }

  /** 最后一次移动先交给引擎渲染，再结束临时平移的映射 */
  afterRender(): void {
    if (this.#finishPan) {
      this.#finishPan = false;
      this.#panning = false;
      this.#options.controller.enableInputs = false;
      this.#applyTool();
    }
  }

  /** 程序定位结束旧手势，新的真实输入再开放相机，避免惯性打断飞行 */
  cancelInteraction(): void {
    if (!this.#resources.disposed) {
      this.#guard(() => this.#cancel(true));
    }
  }

  [Symbol.dispose](): void {
    if (this.#resources.disposed) {
      return;
    }
    this.#guard(() => this.#cancel(false));
    this.#active = false;
    this.#resources.dispose();
    Object.assign(this.#options.controller, this.#defaults, { enableInputs: false });
    this.#options.canvas.style.cursor = '';
  }

  #onDown = this.#guarded((event: PointerEvent) => {
    if (!this.#active || !event.isPrimary && event.pointerType === 'touch') {
      return;
    }
    this.afterRender();
    this.#readKeys(event);
    this.#pointer = event;
    this.#swallowClick = false;
    const { canvas, controller, tool, beginUserOperation } = this.#options;
    const modifier = tool.activeTool.panModifier;
    this.#panning = event.button === 0 && tool.activeTool.gestures?.dragPan === false
      && (modifier === 'ctrl' ? this.#ctrl : modifier === 'meta' && this.#meta);
    this.#swallowClick = this.#panning;
    canvas.focus({ preventScroll: true });
    beginUserOperation();
    controller.enableInputs = true;
    this.#applyTool();
    if (this.#panning) {
      return;
    }
    // 工具占用的左键不能进入 SDK，避免 Ctrl 俯仰、Shift 自由观察和框选同时发生
    if (event.button === 0 && tool.activeTool.gestures?.dragPan === false) {
      event.stopPropagation();
      controller.enableInputs = false;
    }
    this.#dispatch('down', event);
  });

  #onMove = this.#guarded((event: PointerEvent) => {
    if (!this.#active || !this.#onCanvas(event) && this.#pointer === null) {
      return;
    }
    this.#readKeys(event);
    if (this.#pointer !== null && event.pointerId !== this.#pointer.pointerId) {
      return;
    }
    if (this.#pointer !== null && event.buttons === 0) {
      this.#cancel(true);
      return;
    }
    if (this.#pointer && Math.hypot(
      event.clientX - this.#pointer.clientX,
      event.clientY - this.#pointer.clientY
    ) > 3) {
      this.#swallowClick = true;
    }
    this.#applyCursor();
    if (!this.#panning) {
      this.#dispatch('move', event);
    }
  });

  #onUp = this.#guarded((event: PointerEvent) => {
    if (!this.#active || this.#releasing || this.#pointer?.pointerId !== event.pointerId) {
      return;
    }
    this.#readKeys(event);
    this.#pointer = null;
    if (this.#panning) {
      this.#finishPan = true;
    } else {
      this.#dispatch('up', event);
    }
    this.#applyCursor();
  });

  #onCancel = this.#guarded((event: PointerEvent) => {
    if (!this.#releasing && this.#pointer?.pointerId === event.pointerId) {
      this.#cancel(true);
    }
  });

  #onLeave = this.#guarded((event: PointerEvent) => {
    if (this.#active && !this.#panning) {
      this.#dispatch('leave', event);
    }
  });

  #onClick = this.#guarded((event: MouseEvent) => {
    if (this.#active && !this.#swallowClick) {
      this.#dispatch('click', event);
    }
  });

  #onDoubleClick = this.#guarded((event: MouseEvent) => {
    if (this.#active && !this.#swallowClick) {
      this.#dispatch('dblclick', event);
    }
  });

  #onWheel = this.#guarded(() => {
    if (this.#active) {
      this.#options.beginUserOperation();
      this.#options.controller.enableInputs = true;
    }
  });

  #onKeyDown = this.#guarded((event: KeyboardEvent) => {
    if (this.#active && !event.isComposing) {
      this.#options.tool.dispatch({ type: 'key', key: event.key }, this.#options.view);
    }
  });

  #onModifier = this.#guarded((event: KeyboardEvent) => {
    if (this.#active) {
      this.#readKeys(event);
      this.#applyCursor();
    }
  });

  #onBlur = this.#guarded(() => this.#cancel(true));

  #readKeys(event: MouseEvent | KeyboardEvent): void {
    this.#ctrl = event.ctrlKey;
    this.#meta = event.metaKey;
  }

  #onCanvas(event: Event): boolean {
    return event.target === this.#options.canvas;
  }

  #dispatch(type: MapPointerEvent['type'], event: MouseEvent): void {
    const bounds = this.#options.canvas.getBoundingClientRect();
    const input: MapPointerEvent = {
      type,
      point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      button: event.button,
      clickCount: event.detail,
      modifiers: { ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }
    };
    this.#last = input;
    this.#options.tool.dispatch(input, this.#options.view);
  }

  #cancel(notify: boolean): void {
    const { canvas, controller, tool, view } = this.#options;
    controller.enableInputs = false;
    const pointer = this.#pointer;
    this.#pointer = null;
    this.#panning = false;
    this.#finishPan = false;
    this.#swallowClick = true;
    this.#ctrl = false;
    this.#meta = false;
    // 使用公开 DOM 取消事件清掉 SDK 的按钮状态；忽略本适配器再次收到的事件
    if (pointer !== null) {
      this.#releasing = true;
      try {
        canvas.dispatchEvent(new PointerEvent('pointercancel', {
          pointerId: pointer.pointerId,
          pointerType: pointer.pointerType,
          clientX: pointer.clientX,
          clientY: pointer.clientY,
          button: pointer.button,
          ctrlKey: this.#last?.modifiers.ctrl ?? pointer.ctrlKey,
          metaKey: this.#last?.modifiers.meta ?? pointer.metaKey,
          bubbles: true
        }));
        if (canvas.hasPointerCapture?.(pointer.pointerId)) {
          canvas.releasePointerCapture(pointer.pointerId);
        }
      } finally {
        this.#releasing = false;
      }
    }
    this.#applyTool(false);
    if (notify && this.#active && this.#last) {
      tool.dispatch({ ...this.#last, type: 'leave' }, view);
    }
    this.#last = null;
  }

  #applyTool(focus = true): void {
    const { controller, canvas, tool } = this.#options;
    const current = tool.activeTool;
    controller.enableRotate = this.#panning || this.#defaults.enableRotate && current.gestures?.dragPan !== false;
    controller.enableTilt = !this.#panning && this.#defaults.enableTilt;
    controller.enableLook = !this.#panning && this.#defaults.enableLook;
    controller.rotateEventTypes = this.#panning ? PAN_EVENTS : this.#defaults.rotateEventTypes;
    this.#applyCursor();
    // 临时任务从面板激活后也能直接用 Esc；常驻工具不抢页面焦点
    if (this.#active && focus && !current.persistent) {
      canvas.focus({ preventScroll: true });
    }
  }

  #applyCursor(): void {
    const { canvas, tool } = this.#options;
    const current = tool.activeTool;
    const held = current.panModifier === 'ctrl' ? this.#ctrl : current.panModifier === 'meta' && this.#meta;
    const temporary = current.gestures?.dragPan === false && held && this.#pointer === null;
    canvas.style.cursor = !this.#active ? '' : this.#panning && !this.#finishPan ? 'grabbing'
      : temporary ? 'grab' : current.cursor ?? '';
  }

  #guard(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.#options.controller.enableInputs = false;
      this.#report(error);
    }
  }

  #guarded<E extends Event>(callback: (event: E) => void): (event: E) => void {
    return event => this.#guard(() => callback(event));
  }
}
