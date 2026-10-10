// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { MapInputEvent } from '../view/view-input';
import { BROWSE_TOOL, type MapTool, type ToolChange, ToolModel, type ToolView } from './tool-model';

const VIEW: ToolView = { kind: '2d', pick: () => ({ kind: 'miss' }), project: () => null };

const CLICK: MapInputEvent = {
  type: 'click',
  point: { x: 10, y: 20 },
  button: 0,
  clickCount: 1,
  modifiers: { shift: false, ctrl: false, alt: false, meta: false }
};
const ESCAPE: MapInputEvent = { type: 'key', key: 'Escape' };

// 记下钩子的调用顺序；handleInput 的返回值可以指定
function fakeTool(name: string, log: string[], options: { persistent: boolean; handles?: boolean }): MapTool {
  return {
    persistent: options.persistent,
    activate: () => void log.push(`${name}.activate`),
    deactivate: () => void log.push(`${name}.deactivate`),
    handleInput: (event, view) => {
      log.push(`${name}.${event.type}:${view.kind}`);
      return options.handles;
    }
  };
}

function setup() {
  const log: string[] = [];
  const model = new ToolModel();
  const changes: ToolChange[] = [];
  model.on('change', change => void changes.push(change));
  model.register('pick', fakeTool('pick', log, { persistent: true }));
  model.register('measure', fakeTool('measure', log, { persistent: false }));
  model.register('area', fakeTool('area', log, { persistent: false }));
  return { model, log, changes };
}

describe('ToolModel', () => {
  it('一开始是内置的移动：常驻模式，不改光标、不关手势', () => {
    const model = new ToolModel();

    expect(model.active).toBe(BROWSE_TOOL);
    expect(model.activeTool).toStrictEqual({ persistent: true });
    expect(model.has(BROWSE_TOOL)).toBe(true);
  });

  it('切换工具：旧工具先退出，新工具再进入，然后通知', () => {
    const { model, log, changes } = setup();

    model.activate('pick');
    model.activate('measure');

    expect(model.active).toBe('measure');
    expect(log).toStrictEqual(['pick.activate', 'pick.deactivate', 'measure.activate']);
    expect(changes).toStrictEqual([
      { active: 'pick', previous: BROWSE_TOOL },
      { active: 'measure', previous: 'pick' }
    ]);
  });

  it('激活正在激活的工具时什么也不做', () => {
    const { model, log, changes } = setup();
    model.activate('measure');

    model.activate('measure');

    expect(log).toStrictEqual(['measure.activate']);
    expect(changes).toHaveLength(1);
  });

  it('临时任务退出后回到上一个常驻模式', () => {
    const { model } = setup();

    model.activate('measure');
    model.release('measure');
    expect(model.active).toBe(BROWSE_TOOL);

    model.activate('pick');
    model.activate('measure');
    model.activate('area');
    model.release('area');
    expect(model.active).toBe('pick');
  });

  it('常驻模式退出后回到移动，之后临时任务也回到移动', () => {
    const { model } = setup();
    model.activate('pick');

    model.release('pick');
    expect(model.active).toBe(BROWSE_TOOL);

    model.activate('measure');
    model.release('measure');
    expect(model.active).toBe(BROWSE_TOOL);
  });

  it('退出没有激活的工具、退出移动时什么也不做', () => {
    const { model, log, changes } = setup();
    model.activate('measure');

    model.release('pick');
    model.release(BROWSE_TOOL);

    expect(model.active).toBe('measure');
    expect(log).toStrictEqual(['measure.activate']);
    expect(changes).toHaveLength(1);

    model.release('measure');
    model.release(BROWSE_TOOL);
    expect(changes).toHaveLength(2);
  });

  it('输入只交给当前工具，并带上视图', () => {
    const { model, log } = setup();
    model.activate('pick');

    model.dispatch(CLICK, VIEW);

    expect(log).toStrictEqual(['pick.activate', 'pick.click:2d']);
  });

  it('Esc 没有被处理时，临时任务退出；常驻模式不受影响', () => {
    const { model } = setup();
    model.activate('pick');
    model.activate('measure');

    model.dispatch(ESCAPE, VIEW);
    expect(model.active).toBe('pick');

    model.dispatch(ESCAPE, VIEW);
    expect(model.active).toBe('pick');
  });

  it('工具处理了 Esc（返回 true）时不退出；其他按键不会让临时任务退出', () => {
    const log: string[] = [];
    const model = new ToolModel();
    model.register('measure', fakeTool('measure', log, { persistent: false, handles: true }));
    model.register('area', fakeTool('area', log, { persistent: false }));

    model.activate('measure');
    model.dispatch(ESCAPE, VIEW);
    expect(model.active).toBe('measure');

    model.activate('area');
    model.dispatch({ type: 'key', key: 'Enter' }, VIEW);
    expect(model.active).toBe('area');
  });

  it('登记的 ID 不能是移动，也不能重复；激活未登记的工具时抛错', () => {
    const model = new ToolModel();
    model.register('measure', { persistent: false });

    expect(() => model.register(BROWSE_TOOL, { persistent: true })).toThrow('不能登记');
    expect(() => model.register('measure', { persistent: false })).toThrow('工具 measure 已经登记');
    expect(() => model.activate('area')).toThrow('未登记的工具：area');
    expect(model.active).toBe(BROWSE_TOOL);
  });

  it('释放时让当前工具退出，之后不能再使用；重复释放不再调用退出', () => {
    const { model, log } = setup();
    const listener = vi.fn<(change: ToolChange) => void>();
    model.on('change', listener);
    model.activate('measure');
    listener.mockClear();

    model[Symbol.dispose]();
    model[Symbol.dispose]();

    expect(log).toStrictEqual(['measure.activate', 'measure.deactivate']);
    expect(() => model.activate('pick')).toThrow('ToolModel 已释放');
    expect(() => model.dispatch(CLICK, VIEW)).toThrow('ToolModel 已释放');
    expect(() => model.register('other', { persistent: false })).toThrow('ToolModel 已释放');
    expect(listener).not.toHaveBeenCalled();
  });
});
