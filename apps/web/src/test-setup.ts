import { enableAutoUnmount } from '@vue/test-utils';
import { afterEach } from 'vitest';

// 每个用例结束后卸载 mount 挂载的组件：查询、定时器、ResizeObserver 随之停止，进行中的查询被取消，
// 晚到的请求不会落到下一个用例（见 docs/config/vite-config.md）
enableAutoUnmount(afterEach);
