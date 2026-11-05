import {
  type MapLibreMapOptions,
  MapLibreView,
  type MapLibreViewOptions,
  type MapLike,
  type ScrollZoomRates
} from '@yzt/map-core';
import { defineComponent, onActivated, onDeactivated, onMounted, onUnmounted, type PropType, ref, watch } from 'vue';
import styles from './MapCanvas.module.scss';
import { injectMapState } from './use-map';

/** 创建地图时的选项；样式和相机来自会话，不在这里传 */
export type MapCanvasMapOptions = NonNullable<MapLibreViewOptions<string>['mapOptions']>;

/**
 * 二维地图画布（ADR 0028 第 4 条）：挂载后用会话的当前快照创建视图，卸载时先卸下再释放；引擎失败后可以通过上下文的 retry 重新创建。
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
    const container = ref<HTMLElement>();
    let view: MapLibreView<string> | undefined;

    const createView = () => {
      if (!container.value) {
        return;
      }
      const created = new MapLibreView({
        session: state.session,
        container: container.value,
        // 页面停用期间、当前显示的是三维时以暂停状态创建，由上下文在需要时恢复（ADR 0063、0079 第 8 节）
        active: state.shouldRun('2d'),
        mapOptions: props.mapOptions,
        scrollZoomRates: props.scrollZoomRates,
        createMap: props.createMap,
        onError: state.onError
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
    // 引擎失败后重试：在同一个容器里重新创建视图（ADR 0030）；当前显示的是三维时重试的是三维视图
    watch(state.retryRequests, () => {
      if (state.context.dimension.value !== '2d') {
        return;
      }
      disposeView();
      createView();
    });
    // 页面停用时上下文暂停当前视图：隐藏期间的定位等恢复后再执行，工具收不到输入；恢复时视图先按容器调整画布（ADR 0063）
    onDeactivated(() => state.setPageActive(false));
    onActivated(() => state.setPageActive(true));
    // 早于 provideMap 所在组件的 onUnmounted：先释放视图，后释放会话
    onUnmounted(disposeView);

    return () => {
      // 显示三维时隐藏但保留尺寸，切回时不用重新量画布
      const hidden = state.context.dimension.value !== '2d';
      return (
        <div
          class={styles.root}
          style={hidden ? { visibility: 'hidden' } : undefined}
          data-map-view-state={state.context.viewState.value}
        >
          <div ref={container} class={styles.container} />
        </div>
      );
    };
  }
});
