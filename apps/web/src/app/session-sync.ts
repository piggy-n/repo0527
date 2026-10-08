import { ElMessage } from 'element-plus';
import type { Router } from 'vue-router';
import { type SessionUser, useSessionStore, watchSessionStorage } from '@/shared/auth/session-store';
import { RouteName } from '@/shared/router/route-names';
import { endSession } from './session-end';

// 同一账号重新登录只换了 token，页面上的身份和权限不变
function isSameAccount(a: SessionUser | undefined, b: SessionUser | undefined): boolean {
  return a?.loginName === b?.loginName && a?.role === b?.role;
}

/** 同步其他标签页的登录与退出；要在 pinia 安装之后调用，reloadPage 由参数传入，测试时替换 */
export function setupSessionSync(router: Router, reloadPage = () => location.reload()): () => void {
  // 现在就创建 store：如果等到事件发生时才创建，它读到的已是新会话，无法与之前的身份比较
  const session = useSessionStore();
  return watchSessionStorage(() => {
    const previous = session.user;
    session.syncFromStorage();
    const { user } = session;
    if (isSameAccount(previous, user)) {
      return;
    }
    if (user) {
      // 登录了另一个账号：权限、菜单和页面数据都要按新身份重建，重新加载最可靠
      reloadPage();
      return;
    }
    // 在公开页面上也要清掉查询缓存，之后在本标签页登录的账号不能看到上一个账号的数据
    endSession();
    if (!router.currentRoute.value.meta.public) {
      ElMessage.warning({ message: '已在其他标签页退出登录，请重新登录', grouping: true });
      void router.replace({ name: RouteName.login });
    }
  });
}
