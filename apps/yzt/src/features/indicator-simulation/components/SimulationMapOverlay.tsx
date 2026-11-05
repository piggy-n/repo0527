import { useMap } from '@yzt/map-vue';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { PointerHint } from '@/shared/map/pointer-hint/PointerHint';
import type { SimulationMap } from '../composables/useSimulationMap';
import { type LabelLevel, labelLevels } from '../map/label-layout';
import { DISTRICTS_GROUP } from '../map/map-frame';
import styles from './SimulationMapOverlay.module.scss';

const LEVEL_CLASS: Readonly<Record<LabelLevel, string | undefined>> = {
  full: styles.full,
  name: styles.short,
  dot: styles.dot
};

/**
 * 叠在结果地图上的 DOM：各市的值（互相压住时省掉数值或只留圆点，点了放大到这个市），
 * 鼠标下区县的名称和值；位置随相机重新投影
 */
export const SimulationMapOverlay = defineComponent({
  name: 'SimulationMapOverlay',
  props: {
    simulationMap: { type: Object as PropType<SimulationMap>, required: true },
    /** 放大的市、悬停的市：标注先摆、高亮 */
    focusCity: { type: String as PropType<string | null>, default: null },
    hoverCity: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    focusCity: (cityCode: string) => typeof cityCode === 'string'
  },
  setup(props, { emit }) {
    const map = useMap();
    const root = ref<HTMLElement>();
    const size = useShownElementSize(root);

    const hint = computed(() => {
      const point = map.pointer.value;
      const view = map.view.value;
      if (!point || !view || !props.simulationMap.data.value) {
        return null;
      }
      const code = view.queryRendered(point, { sources: [DISTRICTS_GROUP] })[0]?.properties.code;
      const district = typeof code === 'string' ? props.simulationMap.describeDistrict(code) : null;
      return district && { point, district };
    });

    const renderLabels = () => {
      const view = map.view.value;
      if (!view) {
        return [];
      }
      const placed = props.simulationMap.labels.value.flatMap(label => {
        const point = view.project(label.lngLat);
        const first = label.cityCode === props.hoverCity || label.cityCode === props.focusCity;
        return point ? [{ label, point, first }] : [];
      });
      const levels = labelLevels(
        placed.map(({ label, point, first }) => ({ point, name: label.name, value: label.value, first }))
      );
      // 只有一个市时范围就是它，标注不能点
      const zoomable = props.simulationMap.labels.value.length > 1;
      return placed.map(({ label, point }, index) => {
        const attrs = {
          class: [
            styles.label,
            LEVEL_CLASS[levels[index] ?? 'dot'],
            !zoomable && styles.still,
            label.cityCode === props.hoverCity && styles.lit
          ],
          style: { left: `${point.x}px`, top: `${point.y}px` },
          title: `${label.name} ${label.value}`
        };
        const content = [
          <i key="dot" />,
          <span key="name" class={styles.name}>
            {label.name}
          </span>,
          <span key="value" class={styles.value}>
            {label.value}
          </span>
        ];
        return zoomable ? (
          <button
            key={label.cityCode}
            type="button"
            {...attrs}
            aria-label={`放大到${label.name}：${label.value}`}
            onClick={() => emit('focusCity', label.cityCode)}
          >
            {content}
          </button>
        ) : (
          <div key={label.cityCode} {...attrs}>
            {content}
          </div>
        );
      });
    };

    return () => {
      // 相机变化后重新投影
      const revision = map.projectionRevision.value;
      const current = hint.value;
      return (
        <div ref={root} class={styles.root} data-revision={revision}>
          {renderLabels()}
          {current && (
            <PointerHint
              point={current.point}
              canvas={{ width: size.width.value, height: size.height.value }}
              value={current.district.name}
              lines={[current.district.text]}
            />
          )}
        </div>
      );
    };
  }
});
