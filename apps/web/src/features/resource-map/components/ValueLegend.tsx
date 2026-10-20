import { defineComponent, type PropType } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import type { LegendValue } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './ValueLegend.module.scss';

/**
 * 按取值配色的图例：完整展示名称和符号，点击条目交给上层编辑，样式覆盖由拥有者保管
 */
export const ValueLegend = defineComponent({
  name: 'ValueLegend',
  props: {
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    code: { type: String, required: true },
    values: { type: Array as PropType<readonly LegendValue[]>, required: true }
  },
  emits: {
    edit: (key: string) => typeof key === 'string'
  },
  setup(props, { emit }) {
    return () => (
      <ul class={styles.values}>
        {props.values.map(value => {
          const target = { code: props.code, item: value.key };
          return (
            <li key={value.key} data-value={value.key}>
              <button
                type="button"
                class={styles.row}
                title={value.label}
                aria-label={`编辑${value.label}样式`}
                onClick={() => emit('edit', value.key)}>
                <LegendSwatchIcon class={styles.swatch} swatch={value.swatch} />
                <span class={styles.label}>{value.label}</span>
                {props.symbols.hasOverride(target) && <span class={styles.edited} title="改过符号" data-edited />}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
});
