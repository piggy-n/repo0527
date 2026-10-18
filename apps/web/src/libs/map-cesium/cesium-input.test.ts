import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ScreenSpaceCameraController } from 'cesium';
import { ToolModel, type ToolView, type MapInputEvent } from '@yzt/map-core';
import { CesiumInput, type CesiumInputController } from './cesium-input';

const resources: DisposableStack[] = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.dispose();
  }
  document.body.replaceChildren();
});

function setup() {
  const stack = new DisposableStack();
  resources.push(stack);
  const tool = stack.use(new ToolModel());
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 400, 300));
  const controller: CesiumInputController = {
    enableInputs: true,
    enableRotate: true,
    enableTilt: true,
    enableLook: false,
    rotateEventTypes: ['original']
  };
  const view: ToolView = {
    kind: '3d',
    pick: () => ({ kind: 'miss' }),
    project: () => null,
    queryRendered: () => []
  };
  const handleInput = vi.fn<(event: MapInputEvent, view: ToolView) => boolean | void>();
  const onError = vi.fn<(error: unknown) => void>();
  const beginUserOperation = vi.fn<() => void>();
  const input = stack.use(new CesiumInput({ canvas, controller, tool, view, onError, beginUserOperation }));
  tool.register('select', {
    persistent: true,
    cursor: 'crosshair',
    gestures: { dragPan: false, doubleClickZoom: false, boxZoom: false },
    panModifier: 'ctrl',
    handleInput
  });
  tool.activate('select');
  return { canvas, controller, tool, view, input, handleInput, onError, beginUserOperation };
}

function pointer(target: EventTarget, type: string, options: PointerEventInit = {}) {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: 70,
    clientY: 90,
    button: 0,
    buttons: 1,
    ...options
  }));
}

describe('CesiumInput', () => {
  it('真实 SDK 控制器满足窄接口；输入只在激活后转发并使用画布 CSS 坐标', () => {
    expectTypeOf<ScreenSpaceCameraController>().toExtend<CesiumInputController>();
    const { canvas, controller, input, handleInput, view, beginUserOperation } = setup();
    pointer(canvas, 'pointerdown');
    expect(handleInput).not.toHaveBeenCalled();
    expect(beginUserOperation).not.toHaveBeenCalled();
    expect(controller.enableInputs).toBe(false);

    input.setActive(true);
    pointer(canvas, 'pointerdown', { shiftKey: true });
    expect(handleInput).toHaveBeenCalledExactlyOnceWith({
      type: 'down', point: { x: 50, y: 60 }, button: 0, clickCount: 0,
      modifiers: { ctrl: false, meta: false, alt: false, shift: true }
    }, view);
    expect(beginUserOperation).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(canvas);
    expect(controller.enableRotate).toBe(false);
    expect(controller.enableInputs).toBe(false);
    expect(canvas.style.cursor).toBe('crosshair');
  });

  it('工具占用的左键不进入 SDK，正常松开后单击仍交给工具', () => {
    const { canvas, input, handleInput } = setup();
    const nativeDown = vi.fn<(event: PointerEvent) => void>();
    canvas.addEventListener('pointerdown', nativeDown);
    input.setActive(true);
    pointer(canvas, 'pointerdown');
    pointer(canvas, 'pointerup', { buttons: 0 });
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(nativeDown).not.toHaveBeenCalled();
    expect(handleInput.mock.calls.map(([event]) => event.type)).toEqual(['down', 'up', 'click']);
  });

  it('Ctrl 临时平移吞掉整个工具序列，松键不改变正在拖动的手势', () => {
    const { canvas, controller, input, handleInput } = setup();
    input.setActive(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true }));
    expect(canvas.style.cursor).toBe('grab');
    pointer(canvas, 'pointerdown', { ctrlKey: true });
    expect(controller.enableInputs).toBe(true);
    expect(controller.enableRotate).toBe(true);
    expect(controller.enableTilt).toBe(false);
    expect(canvas.style.cursor).toBe('grabbing');
    pointer(document, 'pointermove', { clientX: 100 });
    expect(controller.enableRotate).toBe(true);
    pointer(document, 'pointerup', { buttons: 0 });
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    expect(handleInput).not.toHaveBeenCalled();
    // 松开那一帧渲染完毕后才恢复工具的手势
    expect(controller.enableRotate).toBe(true);
    input.afterRender();
    expect(controller.enableRotate).toBe(false);
    expect(controller.enableTilt).toBe(true);
    expect(controller.enableLook).toBe(false);
    expect(controller.enableInputs).toBe(false);
    expect(controller.rotateEventTypes).toEqual(['original']);
  });

  it('Mac 的 Meta 临时平移、临时工具聚焦和 Esc 退出保持相同契约', () => {
    const { canvas, controller, tool, input, handleInput } = setup();
    tool.register('temporary', {
      persistent: false,
      gestures: { dragPan: false },
      panModifier: 'meta',
      handleInput
    });
    input.setActive(true);
    tool.activate('temporary');
    expect(document.activeElement).toBe(canvas);
    pointer(canvas, 'pointerdown', { metaKey: true });
    expect(controller.enableRotate).toBe(true);
    expect(handleInput).not.toHaveBeenCalled();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));
    expect(tool.active).toBe('temporary');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tool.active).toBe('select');
    expect(controller.enableRotate).toBe(false);
  });

  it('暂停与失焦结束指针状态；恢复不接受旧移动，下一次按下才开始新的操作', () => {
    const { canvas, controller, input, handleInput, beginUserOperation } = setup();
    input.setActive(true);
    pointer(canvas, 'pointerdown');
    input.setActive(false);
    expect(handleInput.mock.calls.map(([event]) => event.type)).toEqual(['down', 'leave']);
    expect(controller.enableInputs).toBe(false);
    pointer(canvas, 'pointermove');
    pointer(canvas, 'pointerup', { buttons: 0 });
    expect(handleInput).toHaveBeenCalledTimes(2);
    input.setActive(true);
    expect(controller.enableInputs).toBe(false);
    pointer(document, 'pointerup', { buttons: 0 });
    expect(handleInput).toHaveBeenCalledTimes(2);
    pointer(canvas, 'pointerdown', { ctrlKey: true });
    window.dispatchEvent(new Event('blur'));
    expect(canvas.style.cursor).toBe('crosshair');
    expect(controller.enableInputs).toBe(false);
    pointer(canvas, 'pointerup', { buttons: 0 });
    expect(beginUserOperation).toHaveBeenCalledTimes(2);
    canvas.dispatchEvent(new WheelEvent('wheel'));
    expect(beginUserOperation).toHaveBeenCalledTimes(3);
    expect(controller.enableInputs).toBe(true);
  });

  it('窗口外松键按 buttons 结束临时拖动；释放后事件和工具变化不再操作画布', () => {
    const { canvas, controller, input, tool, handleInput, beginUserOperation } = setup();
    input.setActive(true);
    pointer(canvas, 'pointerdown', { ctrlKey: true });
    pointer(document, 'pointermove', { buttons: 0 });
    expect(controller.enableRotate).toBe(false);
    expect(controller.enableInputs).toBe(false);
    input[Symbol.dispose]();
    input[Symbol.dispose]();
    pointer(canvas, 'pointerdown');
    canvas.dispatchEvent(new WheelEvent('wheel'));
    tool.activate('browse');
    expect(handleInput).not.toHaveBeenCalled();
    expect(beginUserOperation).toHaveBeenCalledOnce();
    expect(canvas.getAttribute('tabindex')).toBeNull();
    expect(canvas.style.cursor).toBe('');
  });

  it('工具回调失败关闭引擎输入并报告', () => {
    const { canvas, controller, input, handleInput, onError } = setup();
    const error = new Error('工具失败');
    handleInput.mockImplementation(() => { throw error; });
    input.setActive(true);
    pointer(canvas, 'pointerdown');
    expect(onError).toHaveBeenCalledWith(error);
    expect(controller.enableInputs).toBe(false);
  });
});
