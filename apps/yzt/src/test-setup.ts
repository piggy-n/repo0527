import { enableAutoUnmount } from '@vue/test-utils';
import { afterEach, vi } from 'vitest';

// 每个用例结束后卸载 mount 挂载的组件：查询、定时器、ResizeObserver 随之停止，进行中的查询被取消，
// 晚到的请求不会落到下一个用例（见 docs/config/vite-config.md）
enableAutoUnmount(afterEach);

// 发布的默认符号是导入的数据，随时会换：测试一律按代码算出的默认符号，叠加的规则由 symbol-defaults.test.ts
// 用自己的数据测，仓库里的文件由 symbol-defaults/import.test.ts 检查（ADR 0154）
vi.mock('./features/resource-map/resource-symbol-defaults.json', () => ({ default: {} }));
