import type { MapContext } from '@yzt/map-vue';
import { onScopeDispose, watch } from 'vue';
import type { LoadTrace } from '../perf/load-trace';
import { type SwitchTo3dStep, switchTo3d } from '../perf/switch-to-3d';

/**
 * 每次切到三维时开始一轮，记下三维视图就绪和第一次画面稳定（docs/modules/perf.md）；运行时加载完由 app 记。
 * 在 provideMap 所在组件的 setup 里调用；切回二维、页面卸载时停止等待，这一轮停在已经记下的步骤
 */
export function useSwitchTo3dMarks(
  map: Pick<MapContext, 'dimension' | 'whenReady' | 'whenSettled'>,
  trace: LoadTrace<SwitchTo3dStep> = switchTo3d
): void {
  let controller: AbortController | null = null;
  const stop = () => {
    controller?.abort();
    controller = null;
  };
  // 同步侦听：开始的时刻就是点击切换的时刻
  watch(
    map.dimension,
    kind => {
      stop();
      if (kind !== '3d') {
        return;
      }
      trace.begin();
      controller = new AbortController();
      const { signal } = controller;
      void (async () => {
        await map.whenReady(signal);
        trace.mark('view-ready');
        await map.whenSettled(signal);
        trace.mark('settled');
      })().catch(() => undefined);
    },
    { flush: 'sync' }
  );
  onScopeDispose(stop);
}
