import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

let configured = false;

/** 地图运行时的全局设置；只能由路由在加载地图页之前动态导入后调用，maplibre-gl 才不会进入入口包（ADR 0019、0023） */
export function setupMapRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;
  setWorkerUrl(workerUrl);
}
