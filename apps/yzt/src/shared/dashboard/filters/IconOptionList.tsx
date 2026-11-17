import { defineComponent, type PropType } from 'vue';
import { SvgIcon, type IconName } from '../../icons/SvgIcon';
import styles from './filters.module.scss';

export interface IconOption {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
}

/** 带图标的单选列表（如指标类型、一级指标），选中项右侧显示箭头 */
export const IconOptionList = defineComponent({
  name: 'DashboardIconOptionList',
  props: {
    options: { type: Array as PropType<readonly IconOption[]>, required: true },
    selected: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    select: (_id: string) => true
  },
  setup(props, { emit }) {
    return () => (
      <div class={styles.iconList}>
        {props.options.map(option => {
          const selected = props.selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              class={[styles.option, styles.iconOption, selected && styles.selected]}
              aria-pressed={selected}
              onClick={() => emit('select', option.id)}
            >
              <SvgIcon name={option.icon} />
              <span>{option.name}</span>
              {selected && (
                <span class={styles.arrow}>
                  <SvgIcon name="dashboard-chevron" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }
});
