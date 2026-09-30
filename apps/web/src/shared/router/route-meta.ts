import type { Role } from '../auth/roles';

// 扩充 vue-router 的 RouteMeta 类型，不需要被导入；tsconfig 的 moduleDetection: force 让本文件按模块处理，所以这里是扩充而不是覆盖
// 用 .ts 而不是 .d.ts，是因为 skipLibCheck 会跳过所有 .d.ts 的检查
declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题；meta 本身可以省略，所以设为可选，读取时处理缺失 */
    title?: string;
    /** 不登录也能访问，例如登录页、404 */
    public?: boolean;
    /** 只允许这些角色访问；不写时所有已登录用户都能访问 */
    roles?: readonly Role[];
  }
}
