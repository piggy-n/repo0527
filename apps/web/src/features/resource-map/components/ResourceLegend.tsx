import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { ElButton, ElIcon, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendEntry, legendEntries } from '../legend';
import type { SymbolMode } from '../resource-symbols';
import { INITIAL_LANDUSE_BROWSE, type LanduseBrowse, LanduseLegend } from './LanduseLegend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './ResourceLegend.module.scss';
import { SymbolEditor } from './SymbolEditor';
import { ValueLegend } from './ValueLegend';

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
 * 不读地图、不等视图就绪；复杂图例默认显示多色块摘要，展开查看完整符号，配置由独立按钮打开（ADR 0066）。
 * 放在功能面板的 Tab 里，标题、开关和登记由外壳负责；隐藏时不渲染条目，编辑器、取色器和弹出层随之卸载，丢弃取色预览；
 * 浏览状态（条目的展开，条目里的分类方式、搜索词、分组展开和正在编辑的项）留在这里，再显示时照旧（ADR 0053 第 4 节）
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
    // 资源级配置与图例浏览分开；同时只配置一个资源
    const editing = ref<string | null>(null);
    // 条目里的浏览状态，按资源：隐藏时条目卸载，状态留在这里（2026-10-16 评审发现切走再切回时被重置）
    const landuseBrowse = ref<ReadonlyMap<string, LanduseBrowse>>(new Map());
    const openValues = ref<ReadonlyMap<string, string | null>>(new Map());
    const setLanduseBrowse = (code: string, browse: LanduseBrowse) => {
      landuseBrowse.value = new Map([...landuseBrowse.value, [code, browse]]);
    };
    const setOpenValue = (code: string, key: string | null) => {
      openValues.value = new Map([...openValues.value, [code, key]]);
    };
    const entries = computed(() =>
      legendEntries(props.layers.state.value, props.layers.configErrors.value, props.symbols.overrideOf)
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

    // 展开只显示图例，样式方式和恢复默认由资源级配置入口单独显示
    const renderClassified = (entry: Exclude<LegendEntry, { kind: 'symbol' }>): VNode => {
      if (entry.kind === 'landuse') {
        return (
          <LanduseLegend
            symbols={props.symbols}
            code={entry.code}
            swatches={entry.swatches}
            browse={landuseBrowse.value.get(entry.code) ?? INITIAL_LANDUSE_BROWSE}
            onUpdate:browse={(browse: LanduseBrowse) => setLanduseBrowse(entry.code, browse)}
          />
        );
      }
      return (
        <ValueLegend
          symbols={props.symbols}
          code={entry.code}
          values={entry.values}
          open={openValues.value.get(entry.code) ?? null}
          onUpdate:open={(key: string | null) => setOpenValue(entry.code, key)}
        />
      );
    };

    const renderConfiguration = (entry: LegendEntry) => {
      const uniform = entry.kind === 'symbol' || entry.mode === 'uniform';
      return (
        <div class={styles.configuration}>
          {entry.kind !== 'symbol' && (
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
          )}
          {uniform && <SymbolEditor symbols={props.symbols} target={{ code: entry.code }} name={entry.name} />}
        </div>
      );
    };

    // 复杂图例保留多色块摘要；单一符号直接展示，配置按钮不承担展开图例的动作
    const renderEntry = (entry: LegendEntry): VNode => {
      const isOpen = expanded.value.has(entry.code);
      const uniform = entry.kind === 'symbol' || entry.mode === 'uniform';
      const configuring = editing.value === entry.code;
      const summary = (
        <>
          <span class={styles.arrow} aria-hidden="true">
            {!uniform && <ElIcon>{isOpen ? <ArrowDown /> : <ArrowRight />}</ElIcon>}
          </span>
          <span class={styles.preview}>
            {uniform ? <LegendSwatchIcon swatch={entry.swatch} /> : renderColors(entry.colors)}
          </span>
          <span class={styles.name} title={entry.name}>{entry.name}</span>
          <span class={styles.year}>{entry.year}</span>
          <span class={styles.editedSlot}>
            {props.symbols.isCustomized(entry.code) && <span class={styles.edited} title="改过符号" data-edited />}
          </span>
        </>
      );
      return (
        <li
          key={entry.code}
          class={styles.entry}
          style={{ '--legend-opacity': props.layers.state.value.displays.get(entry.code)?.opacity }}
          data-legend={entry.code}>
          <div class={styles.row}>
            {uniform ? (
              <div class={styles.summary}>{summary}</div>
            ) : (
              <button
                type="button"
                class={styles.summary}
                aria-label={`${isOpen ? '收起' : '展开'}${entry.name}`}
                aria-expanded={isOpen}
                onClick={() => toggle(entry.code)}>
                {summary}
              </button>
            )}
            <button
              type="button"
              class={styles.configure}
              aria-label={`编辑${entry.name}样式`}
              aria-expanded={configuring}
              title="样式设置"
              onClick={() => (editing.value = configuring ? null : entry.code)}>
              <SvgIcon name="symbol-settings" size={16} />
            </button>
          </div>
          {configuring && renderConfiguration(entry)}
          {isOpen && !uniform && entry.kind !== 'symbol' && (
            <div class={styles.content}>{renderClassified(entry)}</div>
          )}
        </li>
      );
    };

    return () =>
      props.active ? (
        <div class={styles.legend} data-resource-legend>
          {entries.value.length > 0 ? (
            <ul class={styles.entries}>{entries.value.map(renderEntry)}</ul>
          ) : (
            <div class={styles.empty}>勾选资源后查看图例</div>
          )}
        </div>
      ) : null;
  }
});
