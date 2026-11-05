import 'cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css';
import { setCesiumBaseUrl } from '@yzt/map-cesium';

let configured = false;

/** 三维运行时的全局设置：Worker、资源和第三方文件从复制到产物的 cesium/ 加载（ADR 0079 第 1、2 节）；只能由 map-framework 动态导入后调用 */
export function setupSceneRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;
  setCesiumBaseUrl(`${import.meta.env.BASE_URL}cesium/`);
}
