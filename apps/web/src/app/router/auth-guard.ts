import { ElMessage } from 'element-plus';
import type { Router } from 'vue-router';
import { canAccess, roleHome } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { UNAUTHORIZED_MESSAGE } from '@/shared/http/messages';
import { RouteName } from '@/shared/router/route-names';
import { endSession } from '../session-end';

/** 登录与权限检查：规则写在路由 meta 上（public、roles），这里只读取 meta；重定向都用 replace，不在历史记录里多留一条 */
export function installAuthGuard(router: Router): void {
  router.beforeEach(to => {
    // pinia 先于 router 安装，所以这里能取到 store
    const session = useSessionStore();
    const user = session.isActive() ? session.user : undefined;

    // 已登录时访问登录页，直接进入首页
    if (to.name === RouteName.login) {
      return user ? { name: roleHome(user.role), replace: true } : true;
    }
    if (to.meta.public) {
      return true;
    }
    if (!user) {
      // 有会话但 token 已过期：结束会话并说明原因；从未登录时直接去登录页
      if (session.session) {
        endSession();
        ElMessage.warning({ message: UNAUTHORIZED_MESSAGE, grouping: true });
      }
      return { name: RouteName.login, replace: true };
    }
    if (!canAccess(user.role, to.meta.roles)) {
      return { name: roleHome(user.role), replace: true };
    }
    return true;
  });
}
