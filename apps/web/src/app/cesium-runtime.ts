import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl } from 'cesium';

/** Cesium 1.145.0 导出函数带有此方法，但发布的类型声明遗漏了它 */
const moduleUrl = buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void };

/** 在创建画布之前设置静态资源地址，不在 window 上挂配置 */
export function setupCesiumRuntime(): void {
  moduleUrl.setBaseUrl(new URL(`${import.meta.env.BASE_URL}cesium/`, document.baseURI).href);
}
