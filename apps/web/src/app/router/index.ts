import { createRouter, createWebHistory } from 'vue-router';
import { routes } from './routes';

// history 模式：部署时服务端要把未知路径回退到 index.html（ADR 0007）
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});
