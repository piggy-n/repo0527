import { defineComponent, nextTick, ref, watch, type PropType } from 'vue';
import styles from './filters.module.scss';

export interface TextOption {
  readonly id: string;
  readonly label: string;
}

/** 文字的单选列表（如具体指标、二级指标），在区块里滚动；换了一组选项时回到顶部 */
export const OptionList = defineComponent({
  name: 'DashboardOptionList',
  props: {
    options: { type: Array as PropType<readonly TextOption[]>, required: true },
    selected: { type: String as PropType<string | null>, default: null },
    /** 列表的读屏名称 */
    label: { type: String, required: true },
    /** 选项属于哪一组（如上一级的 ID）；变化后滚回顶部 */
    resetKey: { type: String, default: '' }
  },
  emits: {
    select: (_id: string) => true
  },
  setup(props, { emit }) {
    const list = ref<HTMLElement>();

    // 等列表按新的一组渲染后再滚
    watch(
      () => props.resetKey,
      async () => {
        await nextTick();
        list.value?.scrollTo({ top: 0 });
      }
    );

    return () => (
      <div ref={list} class={styles.optionList} role="group" aria-label={props.label} tabindex={0}>
        {props.options.map(option => (
          <button
            key={option.id}
            type="button"
            class={[styles.option, props.selected === option.id && styles.selected]}
            aria-pressed={props.selected === option.id}
            onClick={() => emit('select', option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
});
