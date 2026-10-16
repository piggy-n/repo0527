import 'maplibre-gl/dist/maplibre-gl.css';
import { prewarm, setWorkerCount, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

let configured = false;

/** MapLibre 的 Worker 数量：核数的一半，至少 1 个、最多 4 个（ADR 0041 第 7 节，5C.1b 实测 4 个最好） */
export function workerCountFor(cores: number): number {
  return Math.min(4, Math.max(1, Math.floor(cores / 2)));
}

/** 地图运行时的全局设置；只能由 map-framework 在加载地图页时动态导入后调用，maplibre-gl 才不会进入入口包（ADR 0019、0023） */
export function setupMapRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;
  setWorkerUrl(workerUrl);
  // 要在第一张地图创建 Worker 池之前设置；Chrome 下 MapLibre 默认只有 1 个
  setWorkerCount(workerCountFor(navigator.hardwareConcurrency));
}

/**
 * 提前建好 Worker 池（随之下载 Worker 脚本，ADR 0061 第 2 节），整个会话保留：切到别的页面再回到地图时直接用。
 * 要在 setupMapRuntime 之后调用，Worker 的地址和数量才生效；重复调用时 MapLibre 不会再建一个池
 */
export function prewarmMapRuntime(): void {
  if (!configured) {
    throw new Error('prewarmMapRuntime 要在 setupMapRuntime 之后调用');
  }
  prewarm();
}
