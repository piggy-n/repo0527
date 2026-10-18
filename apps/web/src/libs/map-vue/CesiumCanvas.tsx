import { defineComponent, ref, watch } from 'vue';
import styles from './CesiumCanvas.module.scss';
import { type CesiumCanvasState, useCesiumCanvas } from './use-cesium-canvas';
import { injectMapState } from './use-map';

/** 三维预览画布；相机来自同一个地图会话，完整视图接口尚未接入 */
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
      container, () => props.assetBaseUrl, () => props.active, undefined, map.session.camera
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
