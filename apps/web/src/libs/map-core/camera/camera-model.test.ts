import { describe, expect, it, vi } from 'vitest';
import { type CameraChange, CameraModel, type CameraState } from './camera-model';

const NANJING: CameraState = { center: [118.8, 32.05], zoom: 8, bearing: 0, pitch: 0 };

function moved(state: CameraState, zoom: number): CameraState {
  return { ...state, zoom };
}

function listen(model: CameraModel) {
  const changes: CameraChange[] = [];
  model.on('change', change => changes.push(change));
  return changes;
}

describe('CameraModel', () => {
  it('starts from a copy of the initial state', () => {
    const initial = { center: [118.8, 32.05] as [number, number], zoom: 8, bearing: 0, pitch: 0 };
    using model = new CameraModel(initial);

    initial.zoom = 12;
    initial.center[0] = 120;

    expect(model.current).toEqual(NANJING);
  });

  it('notifies synchronously with the view and the cause', () => {
    using model = new CameraModel(NANJING);
    const changes = listen(model);

    model.set(moved(NANJING, 10), { view: '2d', cause: 'user' });

    expect(model.current.zoom).toBe(10);
    expect(changes).toEqual([{ state: model.current, view: '2d', cause: 'user' }]);
  });

  it('does not notify when every value is unchanged', () => {
    using model = new CameraModel(NANJING);
    const changes = listen(model);

    model.set({ ...NANJING, center: [118.8, 32.05] }, { view: '3d', cause: 'user' });

    expect(changes).toHaveLength(0);
    expect(model.intentRevision).toBe(0);
  });

  it('counts user and program changes as intent, but not sync', () => {
    using model = new CameraModel(NANJING);

    model.set(moved(NANJING, 9), { view: '2d', cause: 'sync' });
    expect(model.intentRevision).toBe(0);

    model.set(moved(NANJING, 10), { view: '2d', cause: 'user' });
    model.set(moved(NANJING, 11), { view: '2d', cause: 'program' });
    expect(model.intentRevision).toBe(2);
  });

  it('tells whether the exact 3D camera can be restored after a round trip', () => {
    using model = new CameraModel(NANJING);
    // 切到二维前，三维记下意图版本
    const leftAt = model.intentRevision;

    // 二维按会话相机同步过去，俯角被收到它的上限
    model.set({ ...NANJING, pitch: 60 }, { view: '2d', cause: 'sync' });
    expect(model.intentRevision).toBe(leftAt);

    model.set(moved(NANJING, 12), { view: '2d', cause: 'user' });
    expect(model.intentRevision).not.toBe(leftAt);
  });

  it('keeps the state frozen against the caller and the listeners', () => {
    using model = new CameraModel(NANJING);
    const next = { center: [119, 32] as [number, number], zoom: 9, bearing: 10, pitch: 30 };
    model.set(next, { view: '3d', cause: 'program' });

    next.center[0] = 0;

    expect(model.current.center).toEqual([119, 32]);
    expect(Object.isFrozen(model.current)).toBe(true);
    expect(Object.isFrozen(model.current.center)).toBe(true);
  });

  it.each([
    ['a NaN zoom', { ...NANJING, zoom: Number.NaN }, '相机的 zoom 不是有限数'],
    ['an infinite bearing', { ...NANJING, bearing: Number.POSITIVE_INFINITY }, '相机的 bearing 不是有限数'],
    ['a latitude beyond 90', { ...NANJING, center: [118.8, 91] as const }, '纬度超出范围：91']
  ])('rejects %s and keeps the previous state', (_, state, message) => {
    using model = new CameraModel(NANJING);
    const before = model.current;

    expect(() => model.set(state, { view: '2d', cause: 'user' })).toThrow(message);
    expect(model.current).toBe(before);
  });

  it('rejects an invalid initial state', () => {
    expect(() => new CameraModel({ ...NANJING, pitch: Number.NaN })).toThrow(RangeError);
  });

  it('stops notifying a listener after it unsubscribes', () => {
    using model = new CameraModel(NANJING);
    const listener = vi.fn<(change: CameraChange) => void>();
    const unsubscribe = model.on('change', listener);

    unsubscribe();
    model.set(moved(NANJING, 10), { view: '2d', cause: 'user' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops its listeners and rejects further changes after disposal', () => {
    const model = new CameraModel(NANJING);
    const listener = vi.fn<(change: CameraChange) => void>();
    model.on('change', listener);

    model[Symbol.dispose]();

    expect(() => model.set(moved(NANJING, 10), { view: '2d', cause: 'user' })).toThrow('CameraModel 已释放');
    expect(() => model.on('change', listener)).toThrow('CameraModel 已释放');
    expect(model.current).toEqual(NANJING);
    expect(listener).not.toHaveBeenCalled();
    expect(() => model[Symbol.dispose]()).not.toThrow();
  });
});
