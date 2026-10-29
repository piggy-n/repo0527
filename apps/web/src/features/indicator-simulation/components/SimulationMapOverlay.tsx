import { useMap } from '@yzt/map-vue';
import { defineComponent, type PropType } from 'vue';
import type { SimulationMap } from '../composables/useSimulationMap';
import styles from './SimulationMapOverlay.module.scss';

/** 叠在地图上的 DOM：计算时的扫描带、缺失区县与城市值的标注、停止跟随后的"恢复跟随"；位置随相机重新投影 */
export const SimulationMapOverlay = defineComponent({
  name: 'SimulationMapOverlay',
  props: {
    simulationMap: { type: Object as PropType<SimulationMap>, required: true },
    /** 推演在进行：只有这时显示"恢复跟随" */
    running: Boolean
  },
  setup(props) {
    const map = useMap();

    return () => {
      // 相机变化后重新投影
      const revision = map.projectionRevision.value;
      const view = map.view.value;
      const { simulationMap } = props;
      const data = simulationMap.data.value;
      const scanLng = simulationMap.scanLng.value;
      const middle = data ? (data.bounds[1] + data.bounds[3]) / 2 : 0;
      const scanX = view && scanLng !== null ? (view.project([scanLng, middle])?.x ?? null) : null;
      return (
        <div class={styles.root} data-revision={revision}>
          {scanX !== null && <div class={styles.scan} style={{ transform: `translateX(${scanX}px)` }} />}
          {view &&
            simulationMap.labels.value.map(label => {
              const point = view.project(label.lngLat);
              if (!point) {
                return null;
              }
              return (
                <div
                  key={`${label.kind}-${label.key}`}
                  class={[styles.label, styles[label.kind]]}
                  style={{ left: `${point.x}px`, top: `${point.y}px` }}
                >
                  {label.kind === 'city' && <i class={styles[label.state ?? 'fail']} />}
                  {label.text}
                </div>
              );
            })}
          {props.running && !simulationMap.following.value && (
            <button type="button" class={styles.follow} onClick={() => simulationMap.resumeFollowing()}>
              镜头已停止跟随推演 · 恢复跟随
            </button>
          )}
        </div>
      );
    };
  }
});
