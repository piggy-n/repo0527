import type { RouteLocationRaw, Router } from 'vue-router';

/** 程序式导航：异常由 app 的 router.onError 提示，调用方只在成功后继续 */
export async function navigate(router: Router, to: RouteLocationRaw): Promise<boolean> {
  try {
    return !(await router.push(to));
  } catch {
    return false;
  }
}
