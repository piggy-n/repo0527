import {
  type MapLibreMapOptions,
  MapLibreView,
  type MapLibreViewOptions,
  type MapLike,
  type ScrollZoomRates
} from '@mx/map-core';
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
import styles from './MapCanvas.module.scss';
import { MAP_RUNTIME_PRELOAD, MAP_SCENE_ENGINE, MAPLIBRE_ENGINE } from './runtime';
import { injectMapState } from './use-map';

/** 创建地图时的选项；样式和相机来自会话，不在这里传 */
export type MapCanvasMapOptions = NonNullable<MapLibreViewOptions<string>['mapOptions']>;

/**
 * 地图画布（ADR 0028 第 4 条）：挂载后用会话的当前快照创建视图，卸载时先卸下再释放；引擎失败后可以通过上下文的 retry 重新创建。
 * 同一个视图同时担任二维和三维（ADR 0147 第 2 节），切到三维时第一次加载三维模块。
 * 外层元素接收页面的 class；交给 MapLibre 的内层容器只用静态 class，否则 Vue 会冲掉 MapLibre 加的 class
 */
export const MapCanvas = defineComponent({
  name: 'MapCanvas',
  props: {
    /** 只在创建地图时生效；要换选项时给组件换一个 key 重新创建 */
    mapOptions: { type: Object as PropType<MapCanvasMapOptions>, default: undefined },
    /** 滚轮缩放的速率，只在创建地图时生效（ADR 0053 第 3 节）；不传时用 MapLibre 的默认值 */
    scrollZoomRates: { type: Object as PropType<ScrollZoomRates>, default: undefined },
    /** 测试时替换成假地图 */
    createMap: { type: Function as PropType<(options: MapLibreMapOptions) => MapLike>, default: undefined }
  },
  setup(props) {
    const state = injectMapState('MapCanvas');
    const engine = inject(MAP_SCENE_ENGINE, MAPLIBRE_ENGINE);
    const container = ref<HTMLElement>();
    let view: MapLibreView<string> | undefined;

    const createView = () => {
      if (!container.value) {
        return;
      }
      const created = new MapLibreView({
        session: state.session,
        container: container.value,
        // 页面停用期间以暂停状态创建，由上下文在激活时恢复（ADR 0063）
        active: state.shouldRun('2d', '3d'),
        mapOptions: props.mapOptions,
        scrollZoomRates: props.scrollZoomRates,
        createMap: props.createMap,
        onError: state.onError,
        loadSceneRenderer: engine.loadRenderer
      });
      // 挂不上（同一个上下文已经有画布）时先释放刚创建的视图，再把错误交给 Vue
      try {
        state.attachView(created, container.value);
      } catch (error) {
        created[Symbol.dispose]();
        throw error;
      }
      view = created;
    };

    const disposeView = () => {
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

    onMounted(createView);

    // 二维第一次画面稳定以后预加载三维模块（ADR 0091 的做法，ADR 0147 第 2 节）：等待期间切到三维（换了租约）、
    // 画布卸载时作废；切过三维就已经在加载了
    const preloadRuntime = inject(MAP_RUNTIME_PRELOAD, null);
    const preloading = new AbortController();
    const preloadAfterSettled = async () => {
      if (!preloadRuntime || state.context.dimension.value !== '2d') {
        return;
      }
      await state.context.whenSettled(preloading.signal);
      if (state.context.dimension.value === '2d') {
        preloadRuntime(engine.loadRenderer);
      }
    };
    onMounted(() => {
      preloadAfterSettled().catch(() => undefined);
    });
    onUnmounted(() => preloading.abort());

    // 引擎失败后重试：在同一个容器里重新创建视图（ADR 0030）。
    // 三维模块加载失败不走这里：上下文让视图自己重新加载，地图不重建（ADR 0147 第 2 节）
    watch(state.retryRequests, () => {
      disposeView();
      createView();
    });
    // 页面停用时上下文暂停当前视图：隐藏期间的定位等恢复后再执行，工具收不到输入；恢复时视图先按容器调整画布（ADR 0063）
    onDeactivated(() => state.setPageActive(false));
    onActivated(() => state.setPageActive(true));
    // 早于 provideMap 所在组件的 onUnmounted：先释放视图，后释放会话
    onUnmounted(disposeView);

    return () => (
      <div class={styles.root} data-map-view-state={state.context.viewState.value}>
        <div ref={container} class={styles.container} />
      </div>
    );
  }
});
