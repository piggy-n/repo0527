import type { ScreenPoint } from '@yzt/map-core';
import { useMap } from '@yzt/map-vue';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { useShownElementSize } from '../../composables/useShownElementSize';
import { SvgIcon } from '../../icons/SvgIcon';
import { PointerHint } from '../pointer-hint/PointerHint';
import { labelSide, measureHint, type MeasureLabel, measureLabels } from './measure-labels';
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
 * 测量的标签、删除按钮和鼠标旁的提示（ADR 0035 第 4 条，设计稿 5D.7）。
 * 和画布放在同一个定位参照里盖在上面；只负责显示和调用 remove，显示什么由纯函数推导
 */
export const MeasureOverlay = defineComponent({
  name: 'MeasureOverlay',
  props: {
    measure: { type: Object as PropType<Measure>, required: true }
  },
  setup(props) {
    const map = useMap();
    const root = ref<HTMLElement>();
    const canvas = useShownElementSize(root);
    // 标签只随测量结果变化，位置随相机和画布尺寸重新投影
    const labels = computed(() => measureLabels(props.measure.state.value));
    const placed = computed<PlacedLabel[]>(() => {
      void map.projectionRevision.value;
      const view = map.view.value;
      if (!view) {
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
      return { point: pointer, ...measureHint(kind, props.measure.state.value.draft) };
    });

    const sideOf = ({ label, point }: PlacedLabel) =>
      label.centered ? 'centered' : labelSide(point.x, canvas.width.value);

    const renderLabel = (placedLabel: PlacedLabel) => {
      const { key, caption, text, measurementId } = placedLabel.label;
      const side = sideOf(placedLabel);
      return (
        <div
          key={key}
          class={[styles.label, measurementId && styles.result, styles[side]]}
          style={position(placedLabel.point)}
          data-side={side}>
          {caption && [<span class={styles.caption}>{caption}</span>, ' ']}
          {text}
          {measurementId && (
            <button
              type="button"
              class={styles.remove}
              aria-label="删除这条测量"
              title="删除这条测量"
              onClick={() => props.measure.remove(measurementId)}>
              <SvgIcon name="close" size={12} />
            </button>
          )}
        </div>
      );
    };

    return () => (
      <div ref={root} class={styles.overlay} data-measure-overlay>
        {placed.value.map(renderLabel)}
        {hint.value && (
          <PointerHint
            point={hint.value.point}
            canvas={{ width: canvas.width.value, height: canvas.height.value }}
            value={hint.value.value}
            lines={[hint.value.text]}
          />
        )}
      </div>
    );
  }
});
