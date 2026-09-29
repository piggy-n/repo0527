import { ElMessage } from 'element-plus';
import { configureHttp } from '@/shared/http/configure';
import { RouteName } from '@/shared/router/route-names';
import { router } from './router';

/** 向 shared/http 注入路由跳转和错误提示；登录 token 在鉴权实现后接入 getHeaders */
export function setupHttp(): void {
  configureHttp({
    onUnauthorized: error => {
      // 已经在登录页时不再重复提示和跳转
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
