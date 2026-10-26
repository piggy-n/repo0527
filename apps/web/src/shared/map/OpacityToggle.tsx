import { ElTooltip } from 'element-plus';
import { defineComponent } from 'vue';
import { SvgIcon } from '../icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from './tooltip';
import styles from './OpacityToggle.module.scss';

/** 底图与行政区共用的透明度展开按钮，选中样式不受 Tooltip 状态影响 */
export const OpacityToggle = defineComponent({
  name: 'OpacityToggle',
  props: {
    label: { type: String, required: true },
    open: { type: Boolean, default: false }
  },
  emits: { 'update:open': (value: boolean) => typeof value === 'boolean' },
  setup(props, { emit }) {
    return () => (
      <ElTooltip {...MAP_TOOLTIP_PROPS} content="调整透明度" placement="top">
        <button
          type="button"
          class={[styles.button, props.open && styles.selected]}
          aria-label={`调整${props.label}透明度`}
          aria-pressed={props.open}
          onClick={() => emit('update:open', !props.open)}
        >
          <SvgIcon name="layer-opacity" size={16} />
        </button>
      </ElTooltip>
    );
  }
});
