import { useMap } from '@yzt/map-vue';
import { defineComponent, type PropType } from 'vue';
import type { SimulationMap } from '../composables/useSimulationMap';
import styles from './SimulationMapOverlay.module.scss';

/** 叠在结果地图上的 DOM：各市的值与达标；位置随相机重新投影 */
export const SimulationMapOverlay = defineComponent({
  name: 'SimulationMapOverlay',
  props: {
    simulationMap: { type: Object as PropType<SimulationMap>, required: true }
  },
  setup(props) {
    const map = useMap();

    return () => {
      // 相机变化后重新投影
      const revision = map.projectionRevision.value;
      const view = map.view.value;
      return (
        <div class={styles.root} data-revision={revision}>
          {view &&
            props.simulationMap.labels.value.map(label => {
              const point = view.project(label.lngLat);
              if (!point) {
                return null;
              }
              return (
                <div key={label.key} class={[styles.label, styles.city]} style={{ left: `${point.x}px`, top: `${point.y}px` }}>
                  <i class={styles[label.state]} />
                  {label.text}
                </div>
              );
            })}
        </div>
      );
    };
  }
});
