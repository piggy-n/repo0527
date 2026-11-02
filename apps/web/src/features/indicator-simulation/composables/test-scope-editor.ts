// 只供测试：假的地图上下文和同一线程里的分析 Worker，建范围弹窗的拥有者
import type { CameraState, ScreenPoint } from '@yzt/map-core';
import type { MapViewport } from '@yzt/map-vue';
import { serveWorker } from '@yzt/utils';
import { type Ref, ref, shallowRef } from 'vue';
import { createAreaAnalyzer } from '@/shared/map/area/area-analyzer';
import { areaWorkerHandlers } from '@/shared/map/area/area-worker-handlers';
import type { AreaWorkerProtocol } from '@/shared/map/area/area-worker-protocol';
import type { ScopeArea } from '../model/scope';
import { type ScopeEditor, useScopeEditor } from './useScopeEditor';
import type { SimulationModel } from './useSimulationModel';

/** 假的地图上下文：工具切换、指针、视图都可以由测试改；定位只记下次数 */
export function fakeMap() {
  const activeTool = ref('browse');
  const cameraRuns = ref(0);
  return {
    useCamera: () => shallowRef<CameraState>({ center: [119, 33], zoom: 8, bearing: 0, pitch: 0 }),
    view: shallowRef<MapViewport | null>(null),
    pointer: shallowRef<ScreenPoint | null>(null),
    activeTool,
    activateTool: (id: string) => {
      activeTool.value = id;
    },
    releaseTool: (id: string) => {
      if (activeTool.value === id) {
        activeTool.value = 'browse';
      }
    },
    runCameraOperation: () => {
      cameraRuns.value += 1;
    },
    cameraRuns
  };
}

/** 同一线程里的分析：消息经过真实的结构化克隆 */
export function inThreadAnalyzer() {
  return createAreaAnalyzer(() => {
    const { port1, port2 } = new MessageChannel();
    serveWorker<AreaWorkerProtocol>(port2, areaWorkerHandlers);
    return port1;
  });
}

/** 在组件的 setup 或 effectScope 里调用：确定的范围记在 confirmed 里 */
export function createTestEditor(model: Readonly<Ref<SimulationModel>>): {
  readonly editor: ScopeEditor;
  readonly map: ReturnType<typeof fakeMap>;
  readonly confirmed: Ref<ScopeArea | null>;
  readonly defaultViews: Ref<number>;
} {
  const map = fakeMap();
  const confirmed = shallowRef<ScopeArea | null>(null);
  const defaultViews = ref(0);
  const editor = useScopeEditor(map, {
    model,
    analyzer: inThreadAnalyzer(),
    stepMs: 0,
    goToDefaultView: () => {
      defaultViews.value += 1;
    },
    onConfirm: area => {
      confirmed.value = area;
    }
  });
  return { editor, map, confirmed, defaultViews };
}
