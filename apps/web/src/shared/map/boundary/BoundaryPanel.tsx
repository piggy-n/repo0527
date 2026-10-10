import { ElCheckbox, ElCheckboxGroup, ElSlider } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { Boundaries } from './useBoundaries';
import styles from './BoundaryPanel.module.scss';

/**
 * 行政区边界的面板（联调用的界面，5D 再设计）：只显示 useBoundaries 的状态并调用它的操作。
 * 位置由页面的 class 决定；角落里的小控件，不登记为悬浮元素（ADR 0029）
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

    // 拖动过程中实时生效；滑块按百分比显示，状态里是 0～1
    const changeOpacity = (value: number | number[]) => {
      if (typeof value === 'number') {
        props.boundaries.setOpacity(value / 100);
      }
    };

    return () => {
      const { options, visible, opacity } = props.boundaries;
      const checked = options.filter(option => visible.value[option.id]).map(option => option.id);
      return (
        <div class={styles.panel}>
          <ElCheckboxGroup modelValue={checked} onUpdate:modelValue={changeVisible}>
            {options.map(option => (
              <ElCheckbox key={option.id} value={option.id}>
                {option.label}
              </ElCheckbox>
            ))}
          </ElCheckboxGroup>
          {checked.length > 0 && (
            <div class={styles.opacity}>
              <span class={styles.label}>透明度</span>
              <ElSlider
                class={styles.slider}
                size="small"
                modelValue={Math.round(opacity.value * 100)}
                formatTooltip={(value: number) => `${value}%`}
                onUpdate:modelValue={changeOpacity}
              />
            </div>
          )}
        </div>
      );
    };
  }
});
