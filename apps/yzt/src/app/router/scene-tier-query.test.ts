// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { applySceneTierQuery } from '@/shared/map/scene-tier/browser-setting';
import { RouteName } from '@/shared/router/route-names';
import { createDeviceStore, type DeviceStore } from '@/shared/storage/device-store';
import { MemoryStorage } from '@/shared/storage/testing';
import { installSceneTierQuery } from './scene-tier-query';

const Empty = { render: () => null };

// 只包含用例需要的路由
const routes = [
  { path: '/login', name: RouteName.login, component: Empty },
  { path: '/current-map', name: RouteName.currentMap, component: Empty },
  { path: '/city-dashboard', name: RouteName.cityDashboard, component: Empty },
  { path: '/ai-chat', name: RouteName.aiChat, component: Empty }
];

function setup(search = ''): { router: Router; store: DeviceStore } {
  const store = createDeviceStore(new MemoryStorage());
  const router = createRouter({ history: createMemoryHistory(), routes });
  // 同 app/scene-tier-setting.ts：首次导航之前读一次地址栏
  installSceneTierQuery(router, applySceneTierQuery(search, store));
  return { router, store };
}

// 后退一步，等这次导航结束
function back(router: Router): Promise<void> {
  return new Promise(resolve => {
    const stop = router.afterEach(() => {
      stop();
      resolve();
    });
    router.back();
  });
}

const path = (router: Router) => router.currentRoute.value.fullPath;

describe('installSceneTierQuery', () => {
  it('进入现状底图：没有本浏览器的设定时带上 ?scene-tier=default', async () => {
    const { router } = setup();
    await router.push('/current-map');
    expect(path(router)).toBe('/current-map?scene-tier=default');
  });

  it('有设定时显示设定：安装时读地址栏，先到登录页再进来也带着', async () => {
    const { router } = setup('?scene-tier=workstation');
    await router.push('/login');
    expect(path(router)).toBe('/login');
    await router.push({ name: RouteName.currentMap });
    expect(path(router)).toBe('/current-map?scene-tier=workstation');
  });

  it('参数和设定不一样时改成设定（只在启动时读地址栏）', async () => {
    const { router } = setup('?scene-tier=low');
    await router.push('/current-map?scene-tier=high');
    expect(path(router)).toBe('/current-map?scene-tier=low');
  });

  it('保留别的参数和 hash', async () => {
    const { router } = setup();
    await router.push('/current-map?year=2024#legend');
    expect(path(router)).toBe('/current-map?year=2024&scene-tier=default#legend');
  });

  it('已经带着时不改', async () => {
    const { router } = setup('?scene-tier=high');
    await router.push('/current-map?scene-tier=high');
    expect(path(router)).toBe('/current-map?scene-tier=high');
  });

  it('别的页面不带', async () => {
    const { router } = setup('?scene-tier=high');
    await router.push('/city-dashboard');
    expect(path(router)).toBe('/city-dashboard');
  });

  it('切走再回来（页面缓存时是重新激活）、在页面上再点一次导航：照样带着', async () => {
    const { router } = setup();
    await router.push('/current-map');
    await router.push('/city-dashboard');
    await router.push({ name: RouteName.currentMap });
    expect(path(router)).toBe('/current-map?scene-tier=default');
    await router.push({ name: RouteName.currentMap });
    expect(path(router)).toBe('/current-map?scene-tier=default');
  });

  it('push 进来不多一条历史记录：后退回到原来的页面', async () => {
    const { router } = setup();
    await router.push('/ai-chat');
    await router.push('/city-dashboard');
    await router.push('/current-map');
    await back(router);
    expect(path(router)).toBe('/city-dashboard');
    await back(router);
    expect(path(router)).toBe('/ai-chat');
  });

  it('别的标签页后来改了设定：这个页面照旧按启动时的设定，后退不被改写，也不多出记录', async () => {
    const { router, store } = setup();
    await router.push('/ai-chat');
    await router.push('/current-map');
    await router.push('/city-dashboard');
    // 另一个标签页用 ?scene-tier=workstation 打开过：localStorage 是共享的
    applySceneTierQuery('?scene-tier=workstation', store);
    await back(router);
    expect(path(router)).toBe('/current-map?scene-tier=default');
    await back(router);
    expect(path(router)).toBe('/ai-chat');
    await router.push({ name: RouteName.currentMap });
    expect(path(router)).toBe('/current-map?scene-tier=default');
  });

  it('replace 进来照样替换：后退跳过被替换的页面', async () => {
    const { router } = setup();
    await router.push('/ai-chat');
    await router.push('/city-dashboard');
    await router.replace('/current-map');
    await back(router);
    expect(path(router)).toBe('/ai-chat');
  });
});
