import { defineComponent, type PropType } from 'vue';
import type { LegendValue } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './ValueLegend.module.scss';

/**
 * 按取值配色的图例：完整展示名称和符号，点击条目交给上层打开这一类的样式设置（用户 2026-11-24）。按分类过滤掉的类别
 * 照样列出、淡显（ADR 0173，用户 2026-11-24）
 */
export const ValueLegend = defineComponent({
  name: 'ValueLegend',
  props: {
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
          return (
            <li key={value.key} data-value={value.key}>
              <button
                type="button"
                class={[styles.row, value.excluded && styles.excluded]}
                title={value.excluded ? `${value.label}（已过滤）` : value.label}
                aria-label={`编辑${value.label}样式${value.excluded ? '（已过滤）' : ''}`}
                data-excluded={value.excluded || undefined}
                onClick={() => emit('edit', value.key)}
              >
                <LegendSwatchIcon swatch={value.swatch} size="item" />
                <span class={styles.label}>{value.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
});
