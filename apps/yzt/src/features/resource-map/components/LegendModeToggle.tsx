import { defineComponent, type PropType } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import type { LegendEntry } from '../legend';
import type { SymbolMode } from '../resource-symbols';

const MODE_NAMES: Readonly<Record<SymbolMode, string>> = { classified: '按类别配色', uniform: '统一配色' };

/**
 * 图例的显示方式（按类别配色 / 统一配色）的快捷切换，放在样式设置按钮旁边（用户 2026-11-24）：
 * 图标是现在的方式，点一下换成另一种，同样式设置里的"显示方式"；单一符号没有显示方式，不画
 */
export const LegendModeToggle = defineComponent({
  name: 'LegendModeToggle',
  props: {
    symbols: { type: Object as PropType<Pick<ResourceSymbols, 'setMode'>>, required: true },
    entry: { type: Object as PropType<LegendEntry>, required: true }
  },
  setup(props) {
    return () => {
      const { entry } = props;
      if (entry.kind === 'symbol') {
        return null;
      }
      const next: SymbolMode = entry.mode === 'classified' ? 'uniform' : 'classified';
      const tip = `显示方式：${MODE_NAMES[entry.mode]}，点击换成${MODE_NAMES[next]}`;
      return (
        <button
          type="button"
          aria-label={tip}
          title={tip}
          data-legend-mode={entry.mode}
          onClick={() => props.symbols.setMode(entry.code, next)}
        >
          <SvgIcon name={entry.mode === 'classified' ? 'legend-classified' : 'legend-uniform'} size={16} />
        </button>
      );
    };
  }
});
