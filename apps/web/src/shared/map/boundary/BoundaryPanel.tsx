import { ElCheckbox, ElCheckboxGroup } from 'element-plus';
import { defineComponent, type PropType, type SlotsType, type VNode } from 'vue';
import { OpacitySlider } from '../OpacitySlider';
import { type BoundaryLevel, type BoundarySwatchLine, boundarySwatch } from './boundary-style';
import type { Boundaries } from './useBoundaries';
import styles from './BoundaryPanel.module.scss';

const SWATCH_WIDTH = 24;

// 面板只显示级别简称，无障碍名称仍使用完整边界名称
const LEVEL_LABELS: Readonly<Record<BoundaryLevel, string>> = { province: '省', city: '市', county: '县' };

// 一级边界的线型示意：照地图上的画法从下到上叠几条线，颜色是地图样式的数据；高度放得下最宽的一条。
// 虚线的线段和间隔按线宽换算，圆头画在线段外面，和 MapLibre 的圆头虚线一样
function renderSwatch(lines: readonly BoundarySwatchLine[]) {
  const height = Math.max(8, Math.ceil(Math.max(...lines.map(line => line.width))));
  const y = height / 2;
  return (
    <svg
      class={styles.swatch}
      width={SWATCH_WIDTH}
      height={height}
      viewBox={`0 0 ${SWATCH_WIDTH} ${height}`}
      aria-hidden="true">
      {lines.map(({ color, width, opacity, dasharray }, index) => (
        <line
          key={index}
          x1={width / 2}
          y1={y}
          x2={SWATCH_WIDTH - width / 2}
          y2={y}
          stroke={color}
          stroke-opacity={opacity}
          stroke-width={width}
          stroke-linecap="round"
          stroke-dasharray={dasharray?.map(value => value * width).join(' ')}
        />
      ))}
    </svg>
  );
}

/**
 * 行政区边界（ADR 0033，设计稿 5D.4）：三级横排，勾选框后面是这一级在地图上的线型；勾选了才有透明度。
 * 只显示 useBoundaries 的状态并调用它的操作；现状底图中放在行政区标签，外观和登记由外壳负责
 */
export const BoundaryPanel = defineComponent({
  name: 'BoundaryPanel',
  props: {
    boundaries: { type: Object as PropType<Boundaries>, required: true },
    /** 透明度行由同一行的操作入口控制 */
    showOpacity: { type: Boolean, default: true }
  },
  slots: Object as SlotsType<{ actions?: () => VNode[] }>,
  setup(props, { slots }) {
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
          <div class={styles.row}>
            <ElCheckboxGroup
              class={styles.levels}
              aria-label="行政区边界"
              modelValue={checked}
              onUpdate:modelValue={changeVisible}>
              {options.map(option => (
                <div key={option.id}>
                  <ElCheckbox value={option.id} aria-label={option.label}>
                    <span class={styles.option}>
                      {renderSwatch(boundarySwatch(option.id))}
                      {LEVEL_LABELS[option.id]}
                    </span>
                  </ElCheckbox>
                </div>
              ))}
            </ElCheckboxGroup>
            {slots.actions && <div class={styles.actions}>{slots.actions()}</div>}
          </div>
          {props.showOpacity && checked.length > 0 && (
            <OpacitySlider value={opacity.value} label="行政区边界的透明度" onChange={props.boundaries.setOpacity} />
          )}
        </div>
      );
    };
  }
});
