// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginToMap } from '@/shared/perf/login-to-map';
import { defaultMapFramework, loadMapRuntime, type MapRuntime, withMapRuntime } from './map-framework';

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
  it('同时开始加载运行时和页面；都到了以后先设置、再预热、再记下 runtime，最后给出页面', async () => {
    const calls: string[] = [];
    vi.spyOn(loginToMap, 'mark').mockImplementation(step => calls.push(`mark ${step}`));
    const runtime = pending<MapRuntime>();
    const page = pending<string>();
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
    page.resolve('页面');

    await expect(loading).resolves.toBe('页面');
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

  it('不需要预热的运行时也先设置再交出页面', async () => {
    const setup = vi.fn<() => void>();
    const load = withMapRuntime(() => Promise.resolve('三维页面'), () => Promise.resolve({ setup }));

    await expect(load()).resolves.toBe('三维页面');
    expect(setup).toHaveBeenCalledOnce();
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
});
