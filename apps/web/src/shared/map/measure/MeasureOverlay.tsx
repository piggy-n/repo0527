import { Close } from '@element-plus/icons-vue';
import { ElButton } from 'element-plus';
import type { ScreenPoint } from '@yzt/map-core';
import { useMap } from '@yzt/map-vue';
import { computed, defineComponent, type PropType } from 'vue';
import { measureHint, type MeasureLabel, measureLabels } from './measure-labels';
import { type Measure, measureKindOf } from './useMeasure';
import styles from './MeasureOverlay.module.scss';

interface PlacedLabel {
  readonly label: MeasureLabel;
  readonly point: ScreenPoint;
}

function position({ x, y }: ScreenPoint) {
  return { left: `${x}px`, top: `${y}px` };
}

/**
 * 测量的标签、删除按钮和鼠标旁的提示（联调用的界面，5D 再设计；ADR 0035 第 4 条）。
 * 和画布放在同一个定位参照里盖在上面；只负责显示和调用 remove，显示什么由纯函数推导
 */
export const MeasureOverlay = defineComponent({
  name: 'MeasureOverlay',
  props: {
    measure: { type: Object as PropType<Measure>, required: true }
  },
  setup(props) {
    const map = useMap();
    // 标签只随测量结果变化，位置随相机和画布尺寸重新投影
    const labels = computed(() => measureLabels(props.measure.state.value));
    const placed = computed<PlacedLabel[]>(() => {
      void map.projectionRevision.value;
      const view = map.view.value;
      if (map.viewState.value !== 'ready' || !view) {
        return [];
      }
      return labels.value.flatMap(label => {
        const point = view.project(label.lngLat);
        return point ? [{ label, point }] : [];
      });
    });
    const hint = computed(() => {
      const kind = measureKindOf(map.activeTool.value);
      const pointer = props.measure.pointer.value;
      if (!kind || !pointer) {
        return null;
      }
      return { point: pointer, text: measureHint(kind, props.measure.state.value.draft !== null) };
    });

    const renderLabel = ({ label: { key, text, measurementId }, point }: PlacedLabel) =>
      measurementId ? (
        <div key={key} class={styles.result} style={position(point)}>
          {text}
          <ElButton
            class={styles.remove}
            link
            icon={Close}
            aria-label="删除这条测量"
            onClick={() => props.measure.remove(measurementId)}
          />
        </div>
      ) : (
        <div key={key} class={styles.label} style={position(point)}>
          {text}
        </div>
      );

    return () => (
      <div class={styles.overlay} data-measure-overlay>
        {placed.value.map(renderLabel)}
        {hint.value && (
          <div class={styles.hint} style={position(hint.value.point)}>
            {hint.value.text}
          </div>
        )}
      </div>
    );
  }
});
