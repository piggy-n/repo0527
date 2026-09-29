// 自定义环境变量的类型；本文件按模块处理（moduleDetection: force），所以用 declare global 扩充全局接口
declare global {
  // 没有声明的变量名一律报错，防止拼写错误
  interface ViteTypeOptions {
    strictImportMetaEnv: unknown;
  }

  // 声明为可选：.env 文件里确实可能漏写，由 app-config.ts 在启动时校验
  interface ImportMetaEnv {
    readonly VITE_APP_TITLE?: string;
    readonly VITE_API_BASE_URL?: string;
  }
}
