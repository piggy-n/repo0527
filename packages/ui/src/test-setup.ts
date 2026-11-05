import { enableAutoUnmount } from '@vue/test-utils';
import { afterEach } from 'vitest';

// 每个用例结束后卸载 mount 挂载的组件（见 docs/config/vite-config.md）
enableAutoUnmount(afterEach);
