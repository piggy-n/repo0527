import type { Router } from 'vue-router';
import { RouteName } from '@/shared/router/route-names';

export interface MapPreloadOptions {
  /** 安排在浏览器空闲时执行 */
  readonly whenIdle?: (callback: () => void) => void;
  /** 用户是否开了省流量模式 */
  readonly saveData?: () => boolean;
}

// 空闲时执行，最多等 2 秒；Safari 没有 requestIdleCallback，1 秒后执行
function whenBrowserIdle(callback: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => callback(), { timeout: 2000 });
  } else {
    setTimeout(callback, 1000);
  }
}

// navigator.connection 只有 Chromium 内核支持，DOM 的类型里也没有；不支持时按没开处理
function browserSaveData(): boolean {
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } };
  return connection?.saveData === true;
}

/**
 * 登录页预加载地图页（ADR 0061 第 3 节）：第一次进入登录页后，浏览器空闲时调用 load（路由用的同一个加载函数）。
 * 省流量模式时跳过；失败时不提示、不重试，进入地图路由时照常加载
 */
export function setupMapPreload(router: Router, load: () => Promise<unknown>, options: MapPreloadOptions = {}): void {
  const { whenIdle = whenBrowserIdle, saveData = browserSaveData } = options;
  let scheduled = false;
  router.afterEach((to, _from, failure) => {
    if (scheduled || failure || to.name !== RouteName.login || saveData()) {
      return;
    }
    scheduled = true;
    whenIdle(() => {
      load().catch(() => undefined);
    });
  });
}
