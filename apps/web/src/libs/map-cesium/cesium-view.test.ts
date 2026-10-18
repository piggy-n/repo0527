import { MapSession, NO_SOURCE_ERRORS, type SourceErrors } from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { CesiumView, type CesiumViewSurface } from './cesium-view';
import type { CesiumSurfaceOptions } from './cesium-surface';

function setup(active = true) {
  const session = new MapSession({ groups: [], camera: { center: [119, 32], zoom: 8, bearing: 0, pitch: 0 } });
  let options!: CesiumSurfaceOptions;
  const surface = {
    pause: vi.fn<() => void>(), resume: vi.fn<() => void>(),
    flyTo: vi.fn<CesiumViewSurface['flyTo']>(), fitBounds: vi.fn<CesiumViewSurface['fitBounds']>(),
    pick: () => ({ kind: 'miss' as const }), project: () => null,
    [Symbol.dispose]: vi.fn<() => void>()
  };
  const errors = vi.fn<(error: unknown) => void>();
  const view = new CesiumView({
    session, container: document.createElement('div'), assetBaseUrl: '/cesium/', active, onError: errors,
    createSurface: value => { options = value; return surface; }
  });
  return {
    session, view, surface, errors, options,
    ready: () => options.onReady?.(), fail: (error: unknown) => options.onError?.(error),
    resize: () => options.onResize?.(), settle: () => options.onSettle?.(),
    [Symbol.dispose]() { view[Symbol.dispose](); session[Symbol.dispose](); }
  };
}

describe('CesiumView 生命周期与统一接口', () => {
  it('等待加载后才开放接口，候选视图加载完成也保持暂停', async () => {
    using fixture = setup(false);
    const { view, surface } = fixture;
    expect(fixture.options.style).toBe(fixture.session.style);
    expect(() => view.flyTo({ zoom: 9 })).toThrow('尚未就绪');
    fixture.ready();
    await view.whenReady();
    expect(view.state).toBe('paused');
    view.resume();
    expect(surface.resume).toHaveBeenCalledOnce();
    expect(view.state).toBe('ready');
    view.flyTo({ zoom: 9 }, { duration: 500 });
    expect(surface.flyTo).toHaveBeenCalledWith({ zoom: 9 }, { duration: 500 });
    expect(view.queryRendered({ x: 10, y: 20 }, { sources: [] })).toEqual([]);
    expect(view.pick({ x: 10, y: 20 })).toEqual({ kind: 'miss' });
    view.pause();
    expect(() => view.project([119, 32])).toThrow('尚未就绪');
  });

  it('加载中暂停和恢复保留同一轮等待；尺寸与稳定事件只在 ready 时发出', async () => {
    using fixture = setup();
    const resize = vi.fn<() => void>();
    const settle = vi.fn<() => void>();
    const { view } = fixture;
    const waiting = view.whenReady();
    view.on('resize', resize);
    view.on('settle', settle);
    view.pause();
    fixture.resize(); fixture.settle();
    expect(resize).not.toHaveBeenCalled();
    view.resume();
    fixture.ready();
    await waiting;
    expect(view.whenReady()).toBe(waiting);
    fixture.resize(); fixture.settle();
    expect(resize).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
  });

  it('引擎失败释放一次并结束等待，晚到的 ready 和恢复不会复活', async () => {
    using fixture = setup();
    const error = new Error('资源失败');
    const rejected = fixture.view.whenReady().catch(reason => reason as unknown);
    fixture.fail(error);
    expect(await rejected).toBe(error);
    expect(fixture.surface[Symbol.dispose]).toHaveBeenCalledOnce();
    expect(fixture.view.failure).toEqual({ kind: 'engine', cause: 'unknown', error });
    fixture.ready(); fixture.view.resume();
    expect(fixture.view.state).toBe('failed');
    fixture.view[Symbol.dispose]();
    expect(fixture.surface[Symbol.dispose]).toHaveBeenCalledOnce();
  });

  it('提前释放结束等待，后续事件不再写状态', async () => {
    using fixture = setup();
    const rejected = fixture.view.whenReady().catch(reason => reason as unknown);
    fixture.view[Symbol.dispose]();
    expect(await rejected).toMatchObject({ name: 'AbortError' });
    fixture.ready(); fixture.fail(new Error('晚到'));
    expect(fixture.view.state).toBe('disposed');
    expect(fixture.view.failure).toBeNull();
    expect(fixture.errors).not.toHaveBeenCalled();
  });

  it('外部状态回调抛错不阻断就绪和失败释放', async () => {
    using fixture = setup();
    fixture.view.on('statechange', () => { throw new Error('订阅者失败'); });
    const notified = vi.fn<(state: string) => void>();
    fixture.view.on('statechange', notified);
    fixture.ready();
    await fixture.view.whenReady();
    expect(fixture.view.state).toBe('ready');
    fixture.fail(new Error('引擎失败'));
    expect(fixture.surface[Symbol.dispose]).toHaveBeenCalledOnce();
    expect(fixture.view.state).toBe('failed');
    expect(notified.mock.calls.map(([state]) => state)).toEqual(['ready', 'failed']);
  });

  it('图层诊断和来源错误不会让整个视图失败，清除错误也通知上下文', async () => {
    using fixture = setup();
    const { view, options, errors } = fixture;
    const changed = vi.fn<(value: SourceErrors) => void>();
    view.on('sourceerrorchange', changed);
    const error = new Error('某张影像瓦片失败');
    const sources: SourceErrors = new Map([['image', error]]);
    options.onSourceErrors?.(sources);
    options.onStyleError?.(error);
    fixture.ready();
    await expect(view.whenReady()).resolves.toBeUndefined();
    expect(view.state).toBe('ready');
    expect(view.failure).toBeNull();
    expect(view.sourceErrors).toBe(sources);
    expect(changed).toHaveBeenCalledWith(sources);
    expect(errors).toHaveBeenCalledWith(error);
    options.onSourceErrors?.(NO_SOURCE_ERRORS);
    expect(view.sourceErrors.size).toBe(0);
    expect(changed).toHaveBeenLastCalledWith(NO_SOURCE_ERRORS);
  });

  it('失败和释放清空来源错误，晚到的样式通知不复活状态', () => {
    using fixture = setup();
    const { view, options, errors } = fixture;
    const sources: SourceErrors = new Map([['old', new Error('旧瓦片')]]);
    options.onSourceErrors?.(sources);
    fixture.fail(new Error('引擎失败'));
    expect(view.sourceErrors.size).toBe(0);
    options.onSourceErrors?.(sources);
    options.onStyleError?.(new Error('晚到的诊断'));
    expect(view.sourceErrors.size).toBe(0);
    expect(errors).toHaveBeenCalledOnce();
    view[Symbol.dispose]();
    options.onSourceErrors?.(sources);
    expect(view.sourceErrors.size).toBe(0);
  });
});
