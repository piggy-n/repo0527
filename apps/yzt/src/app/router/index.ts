import { createRouter, createWebHistory } from 'vue-router';
import { appConfig } from '@/shared/config/app-config';
import { createNavigationRecovery } from '../navigation-recovery';
import { pageSceneTierSetting } from '../scene-tier-setting';
import { installAuthGuard } from './auth-guard';
import { routes } from './routes';
import { installSceneTierQuery } from './scene-tier-query';

// history 模式：部署时服务端要把未知路径回退到 index.html（ADR 0007）
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

// 先登记失败恢复，再安装守卫，首次导航和守卫里的异常都能被接收
export const navigationRecovery = createNavigationRecovery(router);
installAuthGuard(router);
// 地址栏的 ?scene-tier= 在导入时就读了，早于 main.ts 安装 router（首次导航）：没登录时跳到登录页也记得住
installSceneTierQuery(router, pageSceneTierSetting);

router.afterEach(to => {
  document.title = to.meta.title ? `${to.meta.title} - ${appConfig.title}` : appConfig.title;
});
