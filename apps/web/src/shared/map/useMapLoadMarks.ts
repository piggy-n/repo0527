import type { MapContext } from '@yzt/map-vue';
import { onScopeDispose } from 'vue';
import type { LoadTrace } from '../perf/load-trace';
import { type LoginToMapStep, loginToMap } from '../perf/login-to-map';

/**
 * 登录后第一次进入地图时，记下地图页开始创建、视图就绪和第一次画面稳定（docs/modules/perf.md）。
 * 在 provideMap 所在组件的 setup 里调用；不在一轮里（例如刷新了地图页）时什么也不做
 */
export function useMapLoadMarks(
  map: Pick<MapContext, 'whenReady' | 'whenSettled'>,
  trace: LoadTrace<LoginToMapStep> = loginToMap
): void {
  if (!trace.recording) {
    return;
  }
  trace.mark('page');
  const controller = new AbortController();
  onScopeDispose(() => controller.abort());
  const { signal } = controller;
  // 视图失败、页面卸载时等待以错误结束，这一轮就停在已经记下的步骤
  void (async () => {
    await map.whenReady(signal);
    trace.mark('view-ready');
    await map.whenSettled(signal);
    trace.mark('settled');
  })().catch(() => undefined);
}
