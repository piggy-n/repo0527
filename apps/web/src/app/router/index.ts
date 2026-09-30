import { createRouter, createWebHistory } from 'vue-router';
import { appConfig } from '@/shared/config/app-config';
import { installAuthGuard } from './auth-guard';
import { routes } from './routes';

// history 模式：部署时服务端要把未知路径回退到 index.html（ADR 0007）
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

installAuthGuard(router);

router.afterEach(to => {
  document.title = to.meta.title ? `${to.meta.title} - ${appConfig.title}` : appConfig.title;
});
