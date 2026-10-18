import { defineComponent, ref, watch } from 'vue';
import styles from './CesiumCanvas.module.scss';
import { type CesiumCanvasState, useCesiumCanvas } from './use-cesium-canvas';
import { injectMapState } from './use-map';

/** 三维画布挂到统一上下文，定位、拾取、工具与失败重试复用同一个会话 */
export const CesiumCanvas = defineComponent({
  name: 'CesiumCanvas',
  props: {
    assetBaseUrl: { type: String, required: true },
    active: { type: Boolean, default: true }
  },
  emits: {
    state: (_state: CesiumCanvasState) => true
  },
  setup(props, { emit, expose }) {
    const container = ref<HTMLElement>();
    const map = injectMapState('CesiumCanvas');
    const { state, retry } = useCesiumCanvas(
      container, () => props.assetBaseUrl, () => props.active, undefined, map
    );
    watch(state, value => emit('state', value), { immediate: true });
    expose({ retry });

    return () => (
      <div class={styles.root}>
        <div ref={container} class={styles.container} />
      </div>
    );
  }
});
