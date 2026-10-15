import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { ElButton, ElIcon, ElPopconfirm, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode, watch } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendEntry, legendEntries, legendEntrySet } from '../legend';
import type { SymbolMode } from '../resource-symbols';
import { LanduseLegend } from './LanduseLegend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './ResourceLegend.module.scss';
import { SymbolEditor } from './SymbolEditor';
import { ValueLegend } from './ValueLegend';

const BADGES: Readonly<Record<Exclude<LegendEntry['kind'], 'symbol'>, string>> = { values: '分类', landuse: '地类' };

const MODES: readonly { readonly value: SymbolMode; readonly label: string }[] = [
  { value: 'classified', label: '分类样式' },
  { value: 'uniform', label: '统一样式' }
];

// 按属性配色的条目在名称前显示前三个取值的颜色（设计稿 5D.5）
const renderColors = (colors: readonly string[]) => (
  <span class={styles.colors} aria-hidden="true" data-colors>
    {colors.map(color => (
      <i style={{ backgroundColor: color }} />
    ))}
  </span>
);

/**
 * 资源图层的图例（ADR 0043、0044，设计稿 5D.5）：勾选的资源按叠放顺序各一条，内容从样式登记表和符号覆盖推导，
 * 不读地图、不等视图就绪；统一符号的条目展开后可以编辑符号，按属性配色的条目可以切换样式方式、编辑各取值。
 * 按属性配色的条目在集合变化后只剩一条时自动展开，统一符号展开是编辑，不自动展开。
 * 放在显示面板的 Tab 里，标题、开关和登记由外壳负责；隐藏时不渲染条目，编辑器随之卸载、丢弃取色预览，展开状态保留（ADR 0053 第 4 节）
 */
export const ResourceLegend = defineComponent({
  name: 'ResourceLegend',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    /** 正在显示；切到别的 Tab、让给另一边时为 false */
    active: { type: Boolean, default: true }
  },
  setup(props) {
    // 条目的展开是图例自己的界面状态，不持久化
    const expanded = ref<ReadonlySet<string>>(new Set());
    const entries = computed(() =>
      legendEntries(props.layers.state.value, props.layers.configErrors.value, props.symbols.overrideOf)
    );

    // 只看条目的集合：透明度、顺序、年份的变化不改变集合，不会把手动收起的条目再展开
    watch(
      () => legendEntrySet(entries.value),
      () => {
        const [only] = entries.value;
        if (entries.value.length === 1 && only && only.kind !== 'symbol') {
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

    const selectMode = (code: string, value: unknown) => {
      const mode = MODES.find(item => item.value === value);
      if (mode) {
        props.symbols.setMode(code, mode.value);
      }
    };

    // 按属性配色的条目展开后：样式方式和恢复这个资源的默认；统一样式是编辑器，分类样式是各取值（地类是完整的地类图例）
    const renderClassified = (entry: Exclude<LegendEntry, { kind: 'symbol' }>): VNode => {
      const target = { code: entry.code };
      let body: VNode;
      if (entry.mode === 'uniform') {
        body = <SymbolEditor symbols={props.symbols} target={target} name={entry.name} />;
      } else if (entry.kind === 'landuse') {
        body = <LanduseLegend symbols={props.symbols} code={entry.code} swatches={entry.swatches} />;
      } else {
        body = <ValueLegend symbols={props.symbols} code={entry.code} values={entry.values} />;
      }
      return (
        <div class={styles.classified}>
          <div class={styles.modes}>
            <ElRadioGroup
              size="small"
              modelValue={entry.mode}
              onUpdate:modelValue={value => selectMode(entry.code, value)}>
              {MODES.map(mode => (
                <ElRadioButton key={mode.value} value={mode.value}>
                  {mode.label}
                </ElRadioButton>
              ))}
            </ElRadioGroup>
            <ElButton
              link
              type="primary"
              size="small"
              disabled={!props.symbols.isCustomized(entry.code)}
              aria-label={`恢复${entry.name}的默认符号`}
              onClick={() => props.symbols.resetResource(entry.code)}>
              恢复默认
            </ElButton>
          </div>
          {body}
        </div>
      );
    };

    // 统一符号（和选了统一样式的条目）在名称前显示预览，按属性配色显示前三个取值的颜色、名称后显示类别；
    // 改过符号的在名称后有一个小圆点
    const renderEntry = (entry: LegendEntry): VNode => {
      const isOpen = expanded.value.has(entry.code);
      const uniform = entry.kind === 'symbol' || entry.mode === 'uniform';
      return (
        <li key={entry.code} class={styles.entry} data-legend={entry.code}>
          <button
            type="button"
            class={styles.row}
            aria-label={`${isOpen ? '收起' : '展开'}${entry.name}`}
            aria-expanded={isOpen}
            onClick={() => toggle(entry.code)}>
            <ElIcon class={styles.arrow}>{isOpen ? <ArrowDown /> : <ArrowRight />}</ElIcon>
            {uniform ? <LegendSwatchIcon swatch={entry.swatch} /> : renderColors(entry.colors)}
            {/* 年份由条目单独给出，标题在这里组合（ADR 0052 第 3 节） */}
            <span class={styles.name}>
              {entry.name}
              <span class={styles.year}> · {entry.year}</span>
            </span>
            {props.symbols.isCustomized(entry.code) && <span class={styles.edited} title="改过符号" data-edited />}
            {entry.kind !== 'symbol' && <span class={styles.badge}>{BADGES[entry.kind]}</span>}
          </button>
          {isOpen && (
            <div class={styles.content}>
              {entry.kind === 'symbol' ? (
                <SymbolEditor symbols={props.symbols} target={{ code: entry.code }} name={entry.name} />
              ) : (
                renderClassified(entry)
              )}
            </div>
          )}
        </li>
      );
    };

    return () =>
      props.active ? (
        <div class={styles.legend} data-resource-legend>
          {props.symbols.overrides.value.size > 0 && (
            <div class={styles.toolbar}>
              <ElPopconfirm title="恢复全部资源的默认符号？" onConfirm={() => props.symbols.resetAll()}>
                {{
                  reference: () => (
                    <ElButton link type="primary" size="small">
                      全部恢复默认
                    </ElButton>
                  )
                }}
              </ElPopconfirm>
            </div>
          )}
          {entries.value.length > 0 ? (
            <ul class={styles.entries}>{entries.value.map(renderEntry)}</ul>
          ) : (
            <div class={styles.empty}>勾选资源后查看图例</div>
          )}
        </div>
      ) : null;
  }
});
