import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { ElButton } from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import type { LegendValue } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import { SymbolEditor } from './SymbolEditor';
import styles from './ValueLegend.module.scss';

/** 按取值配色的分类样式（ADR 0044 第 6 节，联调用的界面，5D 再设计）：各取值和预览，展开一个取值编辑它的符号，同一时间只展开一个 */
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
          return (
            <li key={value.key} data-value={value.key}>
              <ElButton
                link
                class={styles.row}
                icon={open ? ArrowDown : ArrowRight}
                aria-label={`${open ? '收起' : '展开'}${value.label}`}
                onClick={() => (expanded.value = open ? null : value.key)}>
                <LegendSwatchIcon class={styles.swatch} swatch={value.swatch} />
                <span class={styles.label}>{value.label}</span>
              </ElButton>
              {open && (
                <div class={styles.editor}>
                  <SymbolEditor symbols={props.symbols} target={{ code: props.code, item: value.key }} name={value.label} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
});
