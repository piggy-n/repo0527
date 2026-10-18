import { MapLibreView, type ScrollZoomRates, type ViewKind } from '@yzt/map-core';
import { defineComponent, onActivated, onDeactivated, onMounted, onUnmounted, type PropType, ref, watch } from 'vue';
import { injectMapState } from './use-map';
import type { MapCanvasMapOptions } from './MapCanvas';
import { MapViewSwitch, type MapViewSwitchState } from './view-switch';
import styles from './SwitchableMapCanvas.module.scss';

export interface SwitchableMapCanvasHandle {
  switchTo(kind: ViewKind): Promise<void>;
  retry(): Promise<void>;
}

/** 二三维画布；界面只请求目标，缓存、页面暂停与交接由拥有者处理 */
export const SwitchableMapCanvas = defineComponent({
  name: 'SwitchableMapCanvas',
  props: {
    assetBaseUrl: { type: String, required: true },
    prepareRuntime: { type: Function as PropType<(kind: ViewKind) => Promise<void>>, required: true },
    /** 二维初始选项与滚轮速率，和单视图画布保持一致 */
    mapOptions: { type: Object as PropType<MapCanvasMapOptions>, default: undefined },
    scrollZoomRates: { type: Object as PropType<ScrollZoomRates>, default: undefined },
    active: { type: Boolean, default: true }
  },
  emits: { state: (_value: MapViewSwitchState) => true },
  setup(props, { emit, expose }) {
    const map = injectMapState('SwitchableMapCanvas');
    const two = ref<HTMLElement>();
    const three = ref<HTMLElement>();
    const current = ref<ViewKind | null>(null);
    let owner: MapViewSwitch | undefined;
    let stopState: (() => void) | undefined;
    let deactivated = false;

    onMounted(() => {
      if (!two.value || !three.value) {
        return;
      }
      owner = new MapViewSwitch(map, { '2d': two.value, '3d': three.value }, async kind => {
        await props.prepareRuntime(kind);
        const options = { session: map.session, active: false, onError: map.onError };
        if (kind === '2d') {
          return container => new MapLibreView({
            ...options, container, mapOptions: props.mapOptions, scrollZoomRates: props.scrollZoomRates
          });
        }
        const { CesiumView } = await import('@yzt/map-cesium');
        return container => new CesiumView({ ...options, container, assetBaseUrl: props.assetBaseUrl });
      }, props.active && !deactivated);
      stopState = watch(owner.state, value => {
        current.value = value.current;
        emit('state', value);
      }, { immediate: true });
      void owner.switchTo('2d');
    });

    const updateActive = () => owner?.setActive(props.active && !deactivated);
    watch(() => props.active, updateActive);
    watch(map.retryRequests, () => { void owner?.retry(); });
    onDeactivated(() => { deactivated = true; updateActive(); });
    onActivated(() => { deactivated = false; updateActive(); });
    onUnmounted(() => {
      stopState?.();
      owner?.[Symbol.dispose]();
    });
    expose({
      switchTo: (kind: ViewKind) => owner?.switchTo(kind) ?? Promise.resolve(),
      retry: () => owner?.retry() ?? Promise.resolve()
    } satisfies SwitchableMapCanvasHandle);

    return () => (
      <div class={styles.root}>
        <div
          class={styles.layer}
          data-map-view="2d"
          inert={current.value !== '2d' || !props.active}
          style={{ visibility: current.value === '2d' ? 'visible' : 'hidden' }}
        >
          <div ref={two} class={styles.container} />
        </div>
        <div
          class={styles.layer}
          data-map-view="3d"
          inert={current.value !== '3d' || !props.active}
          style={{ visibility: current.value === '3d' ? 'visible' : 'hidden' }}
        >
          <div ref={three} class={styles.container} />
        </div>
      </div>
    );
  }
});
