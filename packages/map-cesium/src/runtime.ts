import { buildModuleUrl } from 'cesium';

// Cesium 有文档的方法，类型声明里漏了（ADR 0079 第 2 节）；升级 Cesium 时核对它仍然存在
declare module 'cesium' {
  // oxlint-disable-next-line no-shadow -- 模块扩充：给 Cesium 已有的 buildModuleUrl 补类型，不是新的变量
  namespace buildModuleUrl {
    function setBaseUrl(value: string): void;
  }
}

/** Cesium 的 Worker、资源和第三方文件从这个地址加载；要在创建第一个场景之前设置，不往 window 上写 CESIUM_BASE_URL */
export function setCesiumBaseUrl(url: string): void {
  buildModuleUrl.setBaseUrl(url);
}
