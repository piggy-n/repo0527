import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Component, defineComponent } from 'vue';
import { loginToMap } from '@/shared/perf/login-to-map';
import {
  defaultMapFramework,
  loadMapRuntime,
  type MapRuntime,
  prepareMapRuntime,
  withMapRuntime
} from './map-framework';

// 由测试决定何时结束的加载
function pending<T>() {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>(resolve => (settle = resolve));
  return { promise, resolve: (value: T) => settle?.(value) };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withMapRuntime', () => {
  it('同时开始加载运行时和页面；都到了以后先设置、再预热、再记下 runtime，最后给出包了一层的页面', async () => {
    const calls: string[] = [];
    vi.spyOn(loginToMap, 'mark').mockImplementation(step => calls.push(`mark ${step}`));
    const runtime = pending<MapRuntime>();
    const page = pending<Component>();
    const Page = defineComponent({ name: 'Page', render: () => null });
    const load = withMapRuntime(
      () => {
        calls.push('load page');
        return page.promise;
      },
      () => {
        calls.push('load runtime');
        return runtime.promise;
      }
    );

    const loading = load();
    expect(calls).toStrictEqual(['load runtime', 'load page']);
    runtime.resolve({ setup: () => calls.push('setup'), prewarm: () => calls.push('prewarm') });
    await flush();
    // 页面还没到时不设置、不预热
    expect(calls).toStrictEqual(['load runtime', 'load page']);
    page.resolve(Page);

    // 外面包了一层提供运行时的组件（ADR 0079 第 2 节），包装的行为见 map-runtime-provider 的测试
    const component = await loading;
    expect(component).not.toBe(Page);
    expect(component).toHaveProperty('name', 'MapRuntimeProvider');
    expect(calls).toStrictEqual(['load runtime', 'load page', 'setup', 'prewarm', 'mark runtime']);
  });

  it('页面加载失败时不设置运行时，错误交给路由', async () => {
    const setup = vi.fn<() => void>();
    const load = withMapRuntime(
      () => Promise.reject(new Error('分块加载失败')),
      () => Promise.resolve({ setup, prewarm: vi.fn<() => void>() })
    );

    await expect(load()).rejects.toThrow('分块加载失败');
    expect(setup).not.toHaveBeenCalled();
  });
});

describe('prepareMapRuntime', () => {
  it('加载这个框架的运行时并设置，不预热', async () => {
    const setup = vi.fn<() => void>();
    const prewarm = vi.fn<() => void>();
    const load = vi.fn<(framework: '2d' | '3d') => Promise<MapRuntime>>(() => Promise.resolve({ setup, prewarm }));

    await prepareMapRuntime('3d', load);

    expect(load).toHaveBeenCalledWith('3d');
    expect(setup).toHaveBeenCalledOnce();
    expect(prewarm).not.toHaveBeenCalled();
  });
});

describe('框架', () => {
  it('默认框架是二维', () => {
    expect(defaultMapFramework()).toBe('2d');
  });

  it('二维的运行时是 map-runtime 的设置和预热', async () => {
    const runtime = await loadMapRuntime('2d');
    const { setupMapRuntime, prewarmMapRuntime } = await import('./map-runtime');

    expect(runtime).toStrictEqual({ setup: setupMapRuntime, prewarm: prewarmMapRuntime });
  });

  it('三维的运行时是 map-runtime-3d 的设置，没有要预热的', async () => {
    const runtime = await loadMapRuntime('3d');
    const { setupSceneRuntime } = await import('./map-runtime-3d');

    expect(runtime).toMatchObject({ setup: setupSceneRuntime });
    expect(runtime.prewarm()).toBeUndefined();
  });
});
