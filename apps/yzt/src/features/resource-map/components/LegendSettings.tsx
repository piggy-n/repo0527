import { ArrowLeft } from '@element-plus/icons-vue';
import { MxTitle } from '@mx/ui';
import { ElButton, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendEntry, landuseItemLabel, landuseLegendItems } from '../legend';
import type { SymbolMode, SymbolTarget } from '../resource-symbols';
import styles from './ResourceLegend.module.scss';
import { SymbolEditor } from './SymbolEditor';

const MODES: readonly { readonly value: SymbolMode; readonly label: string }[] = [
  { value: 'classified', label: '按类别配色' },
  { value: 'uniform', label: '统一配色' }
];

// 平铺目录供图层设置选择地类，不改变地图按编码或名称匹配符号的规则
const LANDUSE_ITEMS = landuseLegendItems();

// 图层设置只保留可搜索的条目选择，分类分组不再占用浏览区
const choicesOf = (entry: LegendEntry) => {
  if (entry.kind === 'landuse') {
    return LANDUSE_ITEMS.map(item => ({
      key: item.key,
      name: item.name,
      label: landuseItemLabel(item)
    }));
  }
  if (entry.kind === 'values') {
    return entry.values.map(item => ({ key: item.key, name: item.label, label: item.label }));
  }
  return [];
};

/**
 * 一个资源的样式设置（ADR 0044、0066）：没有 item 时配置整个图层（显示方式、按类别配色时选择要改的类别、符号编辑器、
 * 恢复本图层默认），有 item 时直接编辑这一类。右侧的全部图层图例和当前图层的图例浮层共用（ADR 0157）
 */
export const LegendSettings = defineComponent({
  name: 'LegendSettings',
  props: {
    layers: { type: Object as PropType<Pick<ResourceLayers, 'state'>>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    entry: { type: Object as PropType<LegendEntry>, required: true },
    /** 直接编辑的一类；没有时配置整个图层 */
    item: { type: String as PropType<string | undefined>, default: undefined },
    /** 配置整个图层时下拉里选中的类别，由上层保管 */
    selected: { type: String as PropType<string | undefined>, default: undefined },
    /** 标题前"返回图例"；单一符号的浮层里没有可以返回的，不显示 */
    back: { type: Boolean, default: true }
  },
  emits: {
    back: () => true,
    'update:selected': (key: string) => typeof key === 'string'
  },
  setup(props, { emit }) {
    const selectMode = (value: unknown) => {
      const mode = MODES.find(item => item.value === value);
      if (mode) {
        props.symbols.setMode(props.entry.code, mode.value);
      }
    };

    return () => {
      const { entry } = props;
      const directItem = props.item;
      const classified = entry.kind !== 'symbol' && entry.mode === 'classified';
      const choices = choicesOf(entry);
      const selected = directItem ?? props.selected;
      const item = choices.find(choice => choice.key === selected) ?? choices[0];
      const target: SymbolTarget =
        item && (directItem !== undefined || classified) ? { code: entry.code, item: item.key } : { code: entry.code };
      const name = directItem !== undefined && item ? item.name : entry.name;
      return (
        <div
          class={styles.configuration}
          data-legend-settings={entry.code}
          style={{ '--legend-opacity': props.layers.state.value.displays.get(entry.code)?.opacity }}
        >
          {(props.back || directItem !== undefined) && (
            <div class={styles.settingsHeading}>
              {props.back && (
                <ElButton class={styles.back} link size="small" icon={ArrowLeft} onClick={() => emit('back')}>
                  返回图例
                </ElButton>
              )}
              <MxTitle>{name}</MxTitle>
            </div>
          )}
          {directItem === undefined && entry.kind !== 'symbol' && (
            <div class={styles.modes}>
              <span class={styles.label}>显示方式</span>
              <ElRadioGroup
                size="small"
                aria-label="图层配色方式"
                modelValue={entry.mode}
                onUpdate:modelValue={selectMode}
              >
                {MODES.map(mode => (
                  <ElRadioButton key={mode.value} value={mode.value}>
                    {mode.label}
                  </ElRadioButton>
                ))}
              </ElRadioGroup>
              <p class={styles.description}>
                {classified ? '各类别分别显示对应的颜色与样式' : '整个图层使用统一配色，不再按类别区分'}
              </p>
            </div>
          )}
          {directItem === undefined && classified && (
            <ElSelect
              size="small"
              filterable
              aria-label="选择要修改的图例"
              modelValue={item?.key}
              onUpdate:modelValue={(value: unknown) => {
                if (typeof value === 'string' && choices.some(choice => choice.key === value)) {
                  emit('update:selected', value);
                }
              }}
            >
              {choices.map(choice => (
                <ElOption key={choice.key} value={choice.key} label={choice.label} />
              ))}
            </ElSelect>
          )}
          <SymbolEditor
            symbols={props.symbols}
            target={target}
            name={target.item !== undefined && item ? item.name : entry.name}
            resetLabel={target.item !== undefined ? '恢复此图例默认' : '恢复当前样式'}
          />
          {directItem === undefined && entry.kind !== 'symbol' && (
            <ElButton
              class={styles.resetLayer}
              link
              type="primary"
              size="small"
              disabled={!props.symbols.isCustomized(entry.code)}
              aria-label={`恢复${entry.name}的默认符号`}
              onClick={() => props.symbols.resetResource(entry.code)}
            >
              恢复本图层默认
            </ElButton>
          )}
        </div>
      );
    };
  }
});
