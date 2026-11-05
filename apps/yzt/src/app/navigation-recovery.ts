import { shallowReadonly, shallowRef } from 'vue';
import type { RouteLocationNormalized, Router } from 'vue-router';
import { navigate } from '@/shared/router/navigate';

/** 路由失败的恢复状态；在安装 router 前创建，覆盖首次进入页面 */
export function createNavigationRecovery(router: Router, reloadPage = (href: string) => location.assign(href)) {
  const failure = shallowRef<RouteLocationNormalized | null>(null);
  const retrying = shallowRef(false);
  // 旧导航晚到的错误不覆盖新导航，比较同一次导航的目标对象
  let pending: RouteLocationNormalized | null = null;
  const stopBefore = router.beforeEach(to => {
    pending = to;
  });
  const stopError = router.onError((error, to) => {
    console.error('[navigation]', error);
    if (pending === to) {
      failure.value = to;
    }
  });
  const stopAfter = router.afterEach((to, _from, rejected) => {
    if (!rejected && pending === to) {
      failure.value = null;
    }
  });

  /** 重试原目标，重新经过权限守卫；重复点击只发起一次 */
  async function retry(): Promise<void> {
    const target = failure.value;
    if (!target || retrying.value) {
      return;
    }
    retrying.value = true;
    try {
      await navigate(router, { path: target.path, query: target.query, hash: target.hash, replace: true });
    } finally {
      retrying.value = false;
    }
  }

  /** 重新加载失败目标，解决部署后旧页面引用的分块已失效等情况 */
  function reload(): void {
    if (failure.value) {
      reloadPage(router.resolve(failure.value.fullPath).href);
    }
  }

  /** 应用卸载时移除路由监听 */
  function dispose(): void {
    stopBefore();
    stopError();
    stopAfter();
  }

  return { failure: shallowReadonly(failure), retrying: shallowReadonly(retrying), retry, reload, dispose };
}

export type NavigationRecovery = ReturnType<typeof createNavigationRecovery>;
