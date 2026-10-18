// @vitest-environment node
import { CameraModel, type CameraChange, type CameraState } from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { CesiumCameraBridge, type CameraPort } from './camera-bridge';

const INITIAL: CameraState = { center: [119.2, 32.8], zoom: 8, bearing: 0, pitch: 45 };
const MOVED: CameraState = { center: [118.8, 32.05], zoom: 10, bearing: 30, pitch: 60 };

// 精确姿态中还有共享相机不能表达的值；用它检查恢复时没有重新换算
interface Pose {
  readonly state: CameraState;
  readonly detail: number;
}

function fixture(onError = vi.fn<(error: unknown) => void>()) {
  const camera = new CameraModel(INITIAL);
  const changes: CameraChange[] = [];
  camera.on('change', change => changes.push(change));
  let pose: Pose = { state: INITIAL, detail: 0 };
  let hit = true;
  const apply = vi.fn<(state: CameraState) => void>(state => { pose = { state, detail: 0 }; });
  const restore = vi.fn<(saved: Pose) => void>(saved => { pose = saved; });
  const port: CameraPort<Pose> = {
    read: () => hit ? pose.state : null,
    capture: () => pose,
    apply,
    restore,
    equals: (left, right) => left === right
  };
  const bridge = new CesiumCameraBridge(camera, port, onError);
  return {
    camera, changes, bridge, port, apply, restore,
    move: (state: CameraState, detail = 1) => { pose = { state, detail }; },
    miss: () => { hit = false; }
  };
}

describe('Cesium 会话相机桥接', () => {
  it('程序终点与中间帧按 program 写回，后续渲染没有用户回声', () => {
    const { bridge, camera, changes, move } = fixture();
    using lifetime = new DisposableStack();
    lifetime.use(camera);
    lifetime.use(bridge);
    bridge.resume();
    move({ ...MOVED, zoom: 9 });
    bridge.update('program');
    bridge.move({ state: MOVED, detail: 1 });
    bridge.update();
    expect(camera.current).toEqual(MOVED);
    expect(changes.map(change => change.cause)).toEqual(['program', 'program']);
  });
  it('构造时不改引擎，激活后才应用会话；迟到的渲染不产生用户回声', () => {
    const { bridge, apply, changes, camera } = fixture();
    using lifetime = new DisposableStack();
    lifetime.use(camera);
    lifetime.use(bridge);

    expect(apply).not.toHaveBeenCalled();
    bridge.resume();
    bridge.update();
    bridge.update();
    expect(apply).toHaveBeenCalledExactlyOnceWith(INITIAL);
    expect(changes).toEqual([]);

    camera.set(MOVED, { view: '2d', cause: 'program' });
    bridge.update();
    expect(apply).toHaveBeenLastCalledWith(MOVED);
    expect(changes.map(change => change.cause)).toEqual(['program']);
  });

  it('用户意图作废等待中的定位，真实移动只写回一次，暂停时收下最后一帧', () => {
    const { bridge, camera, changes, move } = fixture();
    using lifetime = new DisposableStack();
    lifetime.use(camera);
    lifetime.use(bridge);
    bridge.resume();
    const operation = camera.operation;
    bridge.beginUserOperation();
    expect(operation.aborted).toBe(true);

    move(MOVED);
    bridge.update();
    bridge.update();
    expect(changes).toEqual([{ state: MOVED, view: '3d', cause: 'user' }]);
    move(INITIAL);
    bridge.pause();
    expect(camera.current).toEqual(INITIAL);
    const pausedOperation = camera.operation;
    bridge.beginUserOperation();
    expect(pausedOperation.aborted).toBe(false);
  });

  it('暂停期间只有同步时不追随，恢复保留三维精确姿态', () => {
    const { bridge, camera, apply, restore, port, move } = fixture();
    using lifetime = new DisposableStack();
    lifetime.use(camera);
    lifetime.use(bridge);
    bridge.resume();
    move(MOVED, 123);
    bridge.pause();
    const saved = port.capture();
    camera.set(INITIAL, { view: '2d', cause: 'sync' });
    bridge.update();
    bridge.pause();
    expect(apply).toHaveBeenCalledOnce();

    bridge.resume();
    expect(restore).toHaveBeenCalledExactlyOnceWith(saved);
    expect(port.capture().detail).toBe(123);
    expect(camera.current).toEqual(MOVED);
  });

  it.each(['user', 'program'] as const)('暂停期间有 %s 定位时丢弃旧姿态，后来的 sync 不恢复它', cause => {
    const { bridge, camera, apply, restore, move } = fixture();
    using lifetime = new DisposableStack();
    lifetime.use(camera);
    lifetime.use(bridge);
    bridge.resume();
    move(MOVED, 123);
    bridge.pause();
    camera.set(INITIAL, { view: '2d', cause });
    camera.set({ ...INITIAL, zoom: 9 }, { view: '2d', cause: 'sync' });
    expect(apply).toHaveBeenCalledOnce();

    bridge.resume();
    expect(restore).not.toHaveBeenCalled();
    expect(apply).toHaveBeenLastCalledWith({ ...INITIAL, zoom: 9 });
  });

  it('尺寸改变按 sync 记录；看向天空时不制造共享中心', () => {
    const { bridge, camera, changes, move, miss } = fixture();
    using lifetime = new DisposableStack();
    lifetime.use(camera);
    lifetime.use(bridge);
    bridge.resume();
    move(MOVED);
    bridge.viewportChanged();
    bridge.update();
    expect(changes).toEqual([{ state: MOVED, view: '3d', cause: 'sync' }]);

    miss();
    move(INITIAL);
    bridge.update();
    expect(camera.current).toEqual(MOVED);
  });

  it('释放后解绑模型，不写回尚未读取的移动，也不再应用相机', () => {
    const { bridge, camera, apply, changes, move } = fixture();
    using lifetime = new DisposableStack();
    lifetime.use(camera);
    bridge.resume();
    move(MOVED);
    bridge[Symbol.dispose]();
    bridge[Symbol.dispose]();
    bridge.update();
    bridge.resume();
    expect(changes).toEqual([]);
    camera.set(MOVED, { view: '2d', cause: 'program' });
    expect(apply).toHaveBeenCalledOnce();
  });

  it('应用失败交给拥有者，后续渲染不把未应用的姿态写回', () => {
    const onError = vi.fn<(error: unknown) => void>();
    const { bridge, camera, apply, changes } = fixture(onError);
    using lifetime = new DisposableStack();
    lifetime.use(camera);
    lifetime.use(bridge);
    apply.mockImplementation(() => { throw new Error('相机失败'); });
    bridge.resume();
    bridge.update();
    expect(onError).toHaveBeenCalledExactlyOnceWith(new Error('相机失败'));
    expect(changes).toEqual([]);
  });
});
