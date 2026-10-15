import { ElSlider } from 'element-plus';
import { defineComponent } from 'vue';
import styles from './OpacitySlider.module.scss';

/** 面板里的透明度一行（设计稿 5D.4）：名称、不带刻度的滑块、百分比；拖动过程中实时交出 0～1 的值 */
export const OpacitySlider = defineComponent({
  name: 'OpacitySlider',
  props: {
    /** 0～1 */
    value: { type: Number, required: true },
    /** 滑块的无障碍名称，如"底图的透明度" */
    label: { type: String, required: true }
  },
  emits: {
    change: (value: number) => value >= 0 && value <= 1
  },
  setup(props, { emit }) {
    // 滑块按百分比显示，交出去的是 0～1
    const change = (value: number | number[]) => {
      if (typeof value === 'number') {
        emit('change', value / 100);
      }
    };

    return () => {
      const percent = Math.round(props.value * 100);
      return (
        <div class={styles.row}>
          <span class={styles.name} aria-hidden="true">
            透明度
          </span>
          <ElSlider
            class={styles.slider}
            size="small"
            showTooltip={false}
            modelValue={percent}
            aria-label={props.label}
            onUpdate:modelValue={change}
          />
          <span class={styles.value}>{percent}%</span>
        </div>
      );
    };
  }
});
