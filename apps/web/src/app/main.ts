import 'element-plus/dist/index.css';
import './styles/index.scss';
import { createApp } from 'vue';
import { App } from './App';
import { router } from './router';

createApp(App).use(router).mount('#app');
