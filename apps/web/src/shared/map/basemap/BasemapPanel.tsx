import { ElRadioButton, ElRadioGroup, ElSlider } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { Basemap } from './useBasemap';
import styles from './BasemapPanel.module.scss';

/**
 * 底图的切换面板（联调用的界面，5D 再设计）：只显示 useBasemap 的状态并调用它的操作。
 * 位置由页面的 class 决定；角落里的小控件，不登记为悬浮元素（ADR 0029）
 */
export const BasemapPanel = defineComponent({
  name: 'BasemapPanel',
  props: {
    basemap: { type: Object as PropType<Basemap>, required: true }
  },
  setup(props) {
    // 单选按钮组给出的值类型很宽，按可选的底图查出 ID，不做类型断言
    const select = (value: string | number | boolean | undefined) => {
      const option = props.basemap.options.find(candidate => candidate.id === value);
      if (option) {
        props.basemap.select(option.id);
      }
    };

    // 拖动过程中实时生效；滑块按百分比显示，状态里是 0～1
    const changeOpacity = (value: number | number[]) => {
      if (typeof value === 'number') {
        props.basemap.setOpacity(value / 100);
      }
    };

    return () => {
      const { options, selected, opacity } = props.basemap;
      return (
        <div class={styles.panel}>
          <ElRadioGroup size="small" modelValue={selected.value} onUpdate:modelValue={select}>
            {options.map(option => (
              <ElRadioButton key={option.id} value={option.id}>
                {option.label}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          {opacity.value !== null && (
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
