import 'element-plus/dist/index.css';
import './styles/index.scss';
import { createApp } from 'vue';
import { App } from './App';
import { setupHttp } from './http';
import { pinia } from './pinia';
import { router } from './router';
import { setupSessionSync } from './session-sync';

setupHttp(router);

// pinia 要先于 router 安装：安装 router 时就开始首次导航，路由守卫里会用到 store
createApp(App).use(pinia).use(router).mount('#app');
// 在 pinia 安装之后：它会立即取用 session store
setupSessionSync(router);
