import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Component, defineComponent, inject } from 'vue';
import { NO_SERVER_BASEMAPS, SERVER_BASEMAPS, type ServerBasemaps } from '@/shared/map/basemap/server-basemaps';
import { loginToMap } from '@/shared/perf/login-to-map';
import {
  loadMapRuntime,
  type MapRuntime,
  loadServerBasemaps,
  serverBasemapsOnce,
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

const SERVERS: ServerBasemaps = [
  { id: 'imagery', root: 'http://intranet.test/basemap/imagery/', thumbnail: 'data:image/png;base64,' }
];

describe('withMapRuntime', () => {
  it('同时开始加载运行时、页面和服务器底图的探测；都到了以后先设置、再预热、再记下 runtime，最后给出包了一层的页面', async () => {
    const calls: string[] = [];
    vi.spyOn(loginToMap, 'mark').mockImplementation(step => calls.push(`mark ${step}`));
    const runtime = pending<MapRuntime>();
    const page = pending<Component>();
    const servers = pending<ServerBasemaps>();
    const received: { servers?: ServerBasemaps } = {};
    const Page = defineComponent({
      name: 'Page',
      setup() {
        received.servers = inject(SERVER_BASEMAPS);
        return () => null;
      }
    });
    const load = withMapRuntime(
      () => {
        calls.push('load page');
        return page.promise;
      },
      () => {
        calls.push('load runtime');
        return runtime.promise;
      },
      () => {
        calls.push('load servers');
        return servers.promise;
      }
    );

    const loading = load();
    expect(calls).toStrictEqual(['load runtime', 'load page', 'load servers']);
    runtime.resolve({ setup: () => calls.push('setup'), prewarm: () => calls.push('prewarm') });
    await flush();
    // 页面还没到时不设置、不预热
    expect(calls).toStrictEqual(['load runtime', 'load page', 'load servers']);
    page.resolve(Page);
    await flush();
    // 探测还没结束时也不给出页面：底图的选项在拥有者创建时就确定（ADR 0165 第 4 节）
    expect(calls).toStrictEqual(['load runtime', 'load page', 'load servers']);
    servers.resolve(SERVERS);

    // 外面包了一层提供运行时的组件（ADR 0079 第 2 节），包装的行为见 map-runtime-provider 的测试
    const component = await loading;
    expect(component).not.toBe(Page);
    expect(component).toHaveProperty('name', 'MapRuntimeProvider');
    expect(calls).toStrictEqual(['load runtime', 'load page', 'load servers', 'setup', 'prewarm', 'mark runtime']);
    // 探测结果交给页面
    mount(component);
    expect(received.servers).toBe(SERVERS);
  });

  it('页面加载失败时不设置运行时，错误交给路由', async () => {
    const setup = vi.fn<() => void>();
    const load = withMapRuntime(
      () => Promise.reject(new Error('分块加载失败')),
      () => Promise.resolve({ setup, prewarm: vi.fn<() => void>() }),
      () => Promise.resolve(NO_SERVER_BASEMAPS)
    );

    await expect(load()).rejects.toThrow('分块加载失败');
    expect(setup).not.toHaveBeenCalled();
  });
});

describe('loadServerBasemaps（ADR 0165 第 4 节）', () => {
  it('公网构建不探测，也不加载探测的分块', async () => {
    const loadProbe = vi.fn<() => Promise<{ probeServerBasemaps: () => Promise<ServerBasemaps> }>>(() =>
      Promise.resolve({ probeServerBasemaps: () => Promise.resolve(SERVERS) })
    );

    await expect(loadServerBasemaps({ key: 'test-key' }, loadProbe)).resolves.toBe(NO_SERVER_BASEMAPS);
    expect(loadProbe).not.toHaveBeenCalled();
  });

  it('内网加载探测的分块，用默认的设置探测，结果原样交出', async () => {
    const probeServerBasemaps = vi.fn<() => Promise<ServerBasemaps>>(() => Promise.resolve(SERVERS));

    await expect(loadServerBasemaps(null, () => Promise.resolve({ probeServerBasemaps }))).resolves.toBe(SERVERS);
    expect(probeServerBasemaps).toHaveBeenCalledExactlyOnceWith();
  });

  it('探测的分块加载失败时不拒绝，记一条警告，按没有服务器底图', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(loadServerBasemaps(null, () => Promise.reject(new Error('分块加载失败')))).resolves.toBe(
      NO_SERVER_BASEMAPS
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it('整个文档探测一次：各地图页拿到同一个结果', () => {
    expect(serverBasemapsOnce()).toBe(serverBasemapsOnce());
  });
});

describe('loadMapRuntime', () => {
  it('运行时是 map-runtime 的设置和预热', async () => {
    const runtime = await loadMapRuntime();
    const { setupMapRuntime, prewarmMapRuntime } = await import('./map-runtime');

    expect(runtime).toStrictEqual({ setup: setupMapRuntime, prewarm: prewarmMapRuntime });
  });
});
