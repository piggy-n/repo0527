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
    readonly VITE_LOGIN_PUBLIC_KEY?: string;
    readonly VITE_TIANDITU_ENABLED?: string;
    readonly VITE_TIANDITU_KEY?: string;
    readonly VITE_AI_API_BASE_URL?: string;
    readonly VITE_PAGE_STATE_RESET?: string;
    readonly VITE_PREFERENCES_ENABLED?: string;
    readonly VITE_PREFERENCE_BASEMAP?: string;
    readonly VITE_PREFERENCE_BASEMAP_LABELS?: string;
    readonly VITE_PREFERENCE_BOUNDARIES?: string;
    readonly VITE_PREFERENCE_RESOURCE_LAYERS?: string;
    readonly VITE_PREFERENCE_RESOURCE_SYMBOLS?: string;
    readonly VITE_PREFERENCE_RESOURCE_PANEL?: string;
    readonly VITE_RESOURCE_MIN_ZOOM_ENABLED?: string;
  }
}
