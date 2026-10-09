import { type MapLibreMapOptions, MapLibreView, type MapLibreViewOptions, type MapLike } from '@yzt/map-core';
import { defineComponent, onMounted, onUnmounted, type PropType, ref } from 'vue';
import styles from './MapCanvas.module.scss';
import { injectMapState } from './use-map';

/** 创建地图时的选项；样式和相机来自会话，不在这里传 */
export type MapCanvasMapOptions = NonNullable<MapLibreViewOptions<string>['mapOptions']>;

/**
 * 二维地图画布（ADR 0028 第 4 条）：挂载后用会话的当前快照创建视图，卸载时先卸下再释放。
 * 外层元素接收页面的 class；交给 MapLibre 的内层容器只用静态 class，否则 Vue 会冲掉 MapLibre 加的 class
 */
export const MapCanvas = defineComponent({
  name: 'MapCanvas',
  props: {
    /** 只在创建地图时生效；要换选项时给组件换一个 key 重新创建 */
    mapOptions: { type: Object as PropType<MapCanvasMapOptions>, default: undefined },
    /** 测试时替换成假地图 */
    createMap: { type: Function as PropType<(options: MapLibreMapOptions) => MapLike>, default: undefined }
  },
  setup(props) {
    const state = injectMapState('MapCanvas');
    const container = ref<HTMLElement>();
    let view: MapLibreView<string> | undefined;

    onMounted(() => {
      if (!container.value) {
        return;
      }
      const created = new MapLibreView({
        session: state.session,
        container: container.value,
        mapOptions: props.mapOptions,
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
    });

    // 早于 provideMap 所在组件的 onUnmounted：先释放视图，后释放会话
    onUnmounted(() => {
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
    });

    return () => (
      <div class={styles.root}>
        <div ref={container} class={styles.container} />
      </div>
    );
  }
});
