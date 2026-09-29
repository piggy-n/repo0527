import 'element-plus/dist/index.css';
import './styles/index.scss';
import { createApp } from 'vue';
import { App } from './App';
import { pinia } from './pinia';
import { router } from './router';

// pinia 要先于 router 安装：安装 router 时就开始首次导航，路由守卫里会用到 store
createApp(App).use(pinia).use(router).mount('#app');
