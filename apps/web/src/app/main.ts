// 目标浏览器还没有资源释放的标准接口（ADR 0023）；类定义 [Symbol.dispose] 时就要用到，必须最先执行
import 'core-js/es/symbol/dispose';
import 'core-js/es/disposable-stack';
import 'element-plus/dist/index.css';
import './styles/index.scss';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createApp } from 'vue';
import { App } from './App';
import { setupHttp } from './http';
import { pinia } from './pinia';
import { queryClient } from './query-client';
import { router } from './router';
import { setupSessionSync } from './session-sync';

setupHttp(router);

// pinia 要先于 router 安装：安装 router 时就开始首次导航，路由守卫里会用到 store
createApp(App).use(pinia).use(VueQueryPlugin, { queryClient }).use(router).mount('#app');
// 在 pinia 安装之后：它会立即取用 session store
setupSessionSync(router);
