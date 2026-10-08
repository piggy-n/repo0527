import { ElMessage } from 'element-plus';
import type { Router } from 'vue-router';
import { useSessionStore } from '@/shared/auth/session-store';
import { configureHttp } from '@/shared/http/configure';
import { RouteName } from '@/shared/router/route-names';
import { endSession } from './session-end';

/** 向 shared/http 注入登录 token、过期检查、路由跳转和错误提示；router 由参数传入，测试时可以换成内存路由 */
export function setupHttp(router: Router): void {
  configureHttp({
    // 每次请求时读取，登录、退出后立即生效；请求发生在 pinia 安装之后，所以能取到 store
    getHeaders: (): Record<string, string> => {
      const token = useSessionStore().token;
      return token ? { token } : {};
    },
    // 有的接口不校验 token（如 /file/page），过期后仍能请求成功，所以发请求前也要检查；未登录时不算，登录接口照常请求
    isCredentialExpired: () => {
      const session = useSessionStore();
      return session.session !== null && !session.isActive();
    },
    onUnauthorized: (error, { headers }) => {
      const session = useSessionStore();
      // 旧会话发出的请求晚到的 401 不影响之后建立的会话；同一批请求的多个 401 也只处理第一个
      if (headers.token !== session.token) {
        return;
      }
      endSession();
      // 已经在登录页时不再重复提示和跳转，登录失败的提示由登录表单负责
      if (router.currentRoute.value.name === RouteName.login) {
        return;
      }
      ElMessage.warning({ message: error.message, grouping: true });
      void router.replace({ name: RouteName.login });
    },
    onError: error => {
      ElMessage.error({ message: error.message, grouping: true });
    }
  });
}
