import type { MapSession, MapView } from '@yzt/map-core';
import {
  defineComponent,
  inject,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  type PropType,
  ref,
  watch
} from 'vue';
import styles from './CesiumCanvas.module.scss';
import { FailedView } from './failed-view';
import { MAP_RUNTIME, type MapRuntimeLoader } from './runtime';
import { injectMapState } from './use-map';

/** 三维不支持、跳过的图层；和 map-cesium 的同名类型结构相同（map-vue 只能动态引用 map-cesium，这里按结构声明） */
export interface UnsupportedLayer {
  readonly layerId: string;
  readonly reason: string;
}

/** 创建三维视图的参数：视图总是以暂停状态创建，挂上后由上下文决定要不要恢复 */
export interface SceneViewOptions {
  readonly session: MapSession<string>;
  readonly container: HTMLElement;
  readonly onError: (error: unknown) => void;
  readonly onUnsupported?: (layer: UnsupportedLayer) => void;
}

// 同时加载三维的运行时和 map-cesium（ADR 0079 第 2 节），都到了再创建视图：基础地址要在创建场景之前设好
async function createCesiumView(options: SceneViewOptions, loadRuntime: MapRuntimeLoader | null): Promise<MapView> {
  if (!loadRuntime) {
    throw new Error('没有地图运行时：app 要在地图页外面 provide MAP_RUNTIME');
  }
  const [{ CesiumView, createCesiumScene }] = await Promise.all([import('@yzt/map-cesium'), loadRuntime('3d')]);
  return new CesiumView({ ...options, active: false, createScene: createCesiumScene });
}

/**
 * 三维画布（ADR 0079 第 8 节）：和二维的 MapCanvas 并列放在页面里，叠在同一块区域上。
 * 第一次切到三维时才加载 Cesium 并创建视图；加载失败时挂上失败的视图，上下文的 retry 重新加载
 */
export const CesiumCanvas = defineComponent({
  name: 'CesiumCanvas',
  props: {
    /** 支持清单之外的图层，每个图层报告一次；页面在开发环境下打印 */
    onUnsupported: { type: Function as PropType<(layer: UnsupportedLayer) => void>, default: undefined },
    /** 测试时换成假视图；默认加载运行时和 map-cesium 后创建 Cesium 视图 */
    createView: { type: Function as PropType<(options: SceneViewOptions) => Promise<MapView>>, default: undefined }
  },
  setup(props) {
    const state = injectMapState('CesiumCanvas');
    const loadRuntime = inject(MAP_RUNTIME, null);
    const container = ref<HTMLElement>();
    const mounted = ref(false);
    let view: MapView | undefined;
    // 正在加载的这一次：卸载、重试时作废，加载到的视图直接释放
    let loading: AbortController | undefined;

    const attach = (created: MapView, element: HTMLElement) => {
      try {
        state.attachView(created, element);
      } catch (error) {
        created[Symbol.dispose]();
        state.onError(error);
        return;
      }
      view = created;
      // 加载期间用户可能已经切回二维、页面也可能被停用：只在现在应该运行时恢复
      if (state.shouldRun('3d')) {
        created.resume();
      }
    };

    const create = async () => {
      const element = container.value;
      if (!element) {
        return;
      }
      const attempt = new AbortController();
      loading = attempt;
      let created: MapView;
      try {
        const options: SceneViewOptions = {
          session: state.session,
          container: element,
          onError: state.onError,
          onUnsupported: props.onUnsupported
        };
        created = props.createView ? await props.createView(options) : await createCesiumView(options, loadRuntime);
      } catch (error) {
        if (attempt.signal.aborted) {
          return;
        }
        state.onError(error);
        created = new FailedView('3d', error);
      }
      if (attempt.signal.aborted) {
        created[Symbol.dispose]();
        return;
      }
      loading = undefined;
      attach(created, element);
    };

    const disposeView = () => {
      loading?.abort();
      loading = undefined;
      const current = view;
      view = undefined;
      if (!current) {
        return;
      }
      // 卸载路径上不抛错：卸下失败时照样释放视图
      for (const step of [() => state.detachView(current), () => current[Symbol.dispose]()]) {
        try {
          step();
        } catch (error) {
          state.onError(error);
        }
      }
    };

    onMounted(() => (mounted.value = true));
    // 第一次切到三维时创建，之后一直保留（ADR 0020 第 4 条）
    watch(
      () => mounted.value && state.context.dimension.value === '3d',
      wanted => {
        if (wanted && !view && !loading) {
          void create();
        }
      }
    );
    // 引擎失败、加载失败后重试；当前显示的是二维时重试的是二维视图
    watch(state.retryRequests, () => {
      if (state.context.dimension.value !== '3d') {
        return;
      }
      disposeView();
      void create();
    });
    onDeactivated(() => state.setPageActive(false));
    onActivated(() => state.setPageActive(true));
    // 早于 provideMap 所在组件的 onUnmounted：先释放视图，后释放会话
    onUnmounted(disposeView);

    return () => {
      // 显示二维时隐藏但保留尺寸，切回时不用重新量画布
      const hidden = state.context.dimension.value !== '3d';
      return (
        <div class={styles.root} style={hidden ? { visibility: 'hidden' } : undefined} data-scene-canvas>
          <div ref={container} class={styles.container} />
        </div>
      );
    };
  }
});
