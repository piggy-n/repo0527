import { ArrowDown, ArrowRight, Close, Collection } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { ElButton } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode, watch } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendEntry, legendEntries, legendEntrySet } from '../legend';
import { LanduseLegend } from './LanduseLegend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './ResourceLegend.module.scss';

const BADGES: Readonly<Record<Exclude<LegendEntry['kind'], 'symbol'>, string>> = { values: '分类', landuse: '地类' };

// 条目展开后的内容：地类是完整的地类图例，按取值配色是取值和颜色
function renderContent(entry: LegendEntry): VNode | null {
  if (entry.kind === 'landuse') {
    return <LanduseLegend />;
  }
  if (entry.kind === 'values') {
    return (
      <ul class={styles.values}>
        {entry.values.map(value => (
          <li key={value.label} class={styles.value}>
            <LegendSwatchIcon swatch={value.swatch} />
            {value.label}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}

/**
 * 资源图层的只读图例（ADR 0043，联调用的界面，5D 再设计）：勾选的资源按叠放顺序各一条，内容从样式登记表推导，
 * 不读地图、不等视图就绪。面板进入页面时总是收起；条目在集合变化后只剩一条时自动展开。登记为贴右边的悬浮元素
 */
export const ResourceLegend = defineComponent({
  name: 'ResourceLegend',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true }
  },
  setup(props) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');

    // 面板的开关和条目的展开都是图例自己的界面状态，不持久化
    const open = ref(false);
    const expanded = ref<ReadonlySet<string>>(new Set());
    const entries = computed(() =>
      legendEntries(props.layers.state.value, props.layers.configErrors.value, props.symbols.overrideOf)
    );

    // 只看条目的集合：透明度、顺序、年份的变化不改变集合，不会把手动收起的条目再展开
    watch(
      () => legendEntrySet(entries.value),
      () => {
        const [only] = entries.value;
        if (entries.value.length === 1 && only) {
          expanded.value = new Set([only.code]);
        }
      },
      { immediate: true }
    );

    const toggle = (code: string) => {
      const next = new Set(expanded.value);
      if (!next.delete(code)) {
        next.add(code);
      }
      expanded.value = next;
    };

    // 统一符号的条目只有一行预览，没有可展开的内容
    const renderEntry = (entry: LegendEntry): VNode => {
      if (entry.kind === 'symbol') {
        return (
          <li key={entry.code} class={styles.entry} data-legend={entry.code}>
            <div class={styles.row}>
              <LegendSwatchIcon swatch={entry.swatch} />
              <span class={styles.name}>{entry.name}</span>
            </div>
          </li>
        );
      }
      const isOpen = expanded.value.has(entry.code);
      return (
        <li key={entry.code} class={styles.entry} data-legend={entry.code}>
          <ElButton
            link
            class={styles.row}
            icon={isOpen ? ArrowDown : ArrowRight}
            aria-label={`${isOpen ? '收起' : '展开'}${entry.name}`}
            onClick={() => toggle(entry.code)}>
            <span class={styles.name}>{entry.name}</span>
            <span class={styles.badge}>{BADGES[entry.kind]}</span>
          </ElButton>
          {isOpen && <div class={styles.content}>{renderContent(entry)}</div>}
        </li>
      );
    };

    return () => (
      <div ref={element} class={styles.legend} data-resource-legend>
        {open.value ? (
          <div class={styles.panel}>
            <div class={styles.header}>
              <span class={styles.title}>图例</span>
              {entries.value.length > 0 && <span class={styles.count}>{entries.value.length}</span>}
              <ElButton link icon={Close} aria-label="收起图例" onClick={() => (open.value = false)} />
            </div>
            <div class={styles.body}>
              {entries.value.length > 0 ? (
                <ul class={styles.entries}>{entries.value.map(renderEntry)}</ul>
              ) : (
                <div class={styles.empty}>勾选资源后查看图例</div>
              )}
            </div>
          </div>
        ) : (
          <ElButton icon={Collection} onClick={() => (open.value = true)}>
            图例
          </ElButton>
        )}
      </div>
    );
  }
});
