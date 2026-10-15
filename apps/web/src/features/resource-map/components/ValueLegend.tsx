import { defineComponent, type PropType, ref } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import type { LegendValue } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import { SymbolEditor } from './SymbolEditor';
import styles from './ValueLegend.module.scss';

/**
 * 按取值配色的分类样式（ADR 0044 第 6 节，设计稿 5D.5）：各取值和预览，点一个展开它的编辑器，同一时间只展开一个；
 * 改过符号的取值名称后有一个小圆点
 */
export const ValueLegend = defineComponent({
  name: 'ValueLegend',
  props: {
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    code: { type: String, required: true },
    values: { type: Array as PropType<readonly LegendValue[]>, required: true }
  },
  setup(props) {
    // 展开着的取值是图例自己的界面状态
    const expanded = ref<string | null>(null);

    return () => (
      <ul class={styles.values}>
        {props.values.map(value => {
          const open = expanded.value === value.key;
          const target = { code: props.code, item: value.key };
          return (
            <li key={value.key} data-value={value.key}>
              <button
                type="button"
                class={[styles.row, open && styles.open]}
                aria-label={`${open ? '收起' : '展开'}${value.label}`}
                aria-expanded={open}
                onClick={() => (expanded.value = open ? null : value.key)}>
                <LegendSwatchIcon swatch={value.swatch} />
                <span class={styles.label}>{value.label}</span>
                {props.symbols.hasOverride(target) && <span class={styles.edited} title="改过符号" data-edited />}
              </button>
              {open && <SymbolEditor symbols={props.symbols} target={target} name={value.label} />}
            </li>
          );
        })}
      </ul>
    );
  }
});
