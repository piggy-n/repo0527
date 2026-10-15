import { ElCheckbox, ElCheckboxGroup } from 'element-plus';
import { type CSSProperties, defineComponent, type PropType } from 'vue';
import { OpacitySlider } from '../OpacitySlider';
import { type BoundarySwatch, boundarySwatch } from './boundary-style';
import type { Boundaries } from './useBoundaries';
import styles from './BoundaryPanel.module.scss';

// 一段线：颜色是地图样式的数据，用内联样式；虚线的线段和间隔按线宽换算（同 MapLibre 的 line-dasharray）
function swatchStyle({ color, width, opacity, dasharray }: BoundarySwatch): CSSProperties {
  if (!dasharray) {
    return { height: `${width}px`, opacity, backgroundColor: color };
  }
  const [dash, gap] = dasharray;
  return {
    height: `${width}px`,
    opacity,
    backgroundImage: `linear-gradient(90deg, ${color} ${dash * width}px, transparent 0)`,
    backgroundSize: `${(dash + gap) * width}px 100%`
  };
}

/**
 * 行政区边界（ADR 0033，设计稿 5D.4）：三级横排，勾选框后面是这一级在地图上的线型；勾选了才有透明度。
 * 只显示 useBoundaries 的状态并调用它的操作；放在显示面板的"底图"里，外观和登记由外壳负责（ADR 0053 第 4 节）
 */
export const BoundaryPanel = defineComponent({
  name: 'BoundaryPanel',
  props: {
    boundaries: { type: Object as PropType<Boundaries>, required: true }
  },
  setup(props) {
    // 复选框组给出勾选的全部值，按级别逐一设置；值没变的级别不会替换状态
    const changeVisible = (values: (string | number)[]) => {
      for (const option of props.boundaries.options) {
        props.boundaries.setVisible(option.id, values.includes(option.id));
      }
    };

    return () => {
      const { options, visible, opacity } = props.boundaries;
      const checked = options.filter(option => visible.value[option.id]).map(option => option.id);
      return (
        <div class={styles.panel}>
          <ElCheckboxGroup
            class={styles.levels}
            aria-label="行政区边界"
            modelValue={checked}
            onUpdate:modelValue={changeVisible}>
            {options.map(option => (
              <ElCheckbox key={option.id} value={option.id}>
                <span class={styles.option}>
                  <span class={styles.swatch} style={swatchStyle(boundarySwatch(option.id))} aria-hidden="true" />
                  {option.label}
                </span>
              </ElCheckbox>
            ))}
          </ElCheckboxGroup>
          {checked.length > 0 && (
            <OpacitySlider value={opacity.value} label="行政区边界的透明度" onChange={props.boundaries.setOpacity} />
          )}
        </div>
      );
    };
  }
});
