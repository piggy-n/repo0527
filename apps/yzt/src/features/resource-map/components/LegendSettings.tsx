import { ArrowLeft } from '@element-plus/icons-vue';
import { MxTitle } from '@mx/ui';
import { ElButton, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { classItems } from '../classification';
import { type LegendEntry, landuseItemLabel, landuseLegendItems, swatchOf } from '../legend';
import type { SymbolMode, SymbolTarget } from '../resource-symbols';
import { resourceStyle } from '../style-registry';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './ResourceLegend.module.scss';
import { SymbolEditor } from './SymbolEditor';
import editorStyles from './SymbolEditor.module.scss';

const MODES: readonly { readonly value: SymbolMode; readonly label: string }[] = [
  { value: 'classified', label: '按类别配色' },
  { value: 'uniform', label: '统一配色' }
];

// 地类的平铺目录，按编码排好；下拉里只留资源实际有的
const LANDUSE_ITEMS = landuseLegendItems();

interface Choice {
  readonly key: string;
  readonly name: string;
  readonly label: string;
}

// 选类别的下拉：资源实际有的全部类别（地类按规则的 only），不跟着要素过滤（ADR 0173）：过滤掉的类别在图例里淡显，
// 也能从这里选来改。原来地类列全表，选到资源没有的一类时编辑器是空的（2026-11-24 审查）
function choicesOf(entry: LegendEntry): Choice[] {
  const rule = resourceStyle(entry.code).color;
  if (!rule || entry.kind === 'symbol') {
    return [];
  }
  const items = classItems(rule);
  if (entry.kind === 'landuse') {
    const keys = new Set(items.map(item => item.key));
    return LANDUSE_ITEMS.filter(item => keys.has(item.key)).map(item => ({
      key: item.key,
      name: item.name,
      label: landuseItemLabel(item)
    }));
  }
  return items.map(item => ({ key: item.key, name: item.label, label: item.label }));
}

/**
 * 一个资源的样式设置（ADR 0044、0175）：标题和"返回图例"、显示方式（单一符号没有）、符号编辑器（按类别配色时灰框的第一行
 * 选类别）、恢复整个图层默认。显示方式只在这里切换（用户 2026-11-24 去掉了图例上的快捷切换）。
 * 右侧的"图例"页和图层的图例浮层共用；要改的类别由上层保管，点了子图例的一类进来时就是它
 */
export const LegendSettings = defineComponent({
  name: 'LegendSettings',
  props: {
    layers: { type: Object as PropType<Pick<ResourceLayers, 'state'>>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    entry: { type: Object as PropType<LegendEntry>, required: true },
    /** 按类别配色时要改的类别；没有或已经不在类别里时是第一类 */
    selected: { type: String as PropType<string | undefined>, default: undefined },
    /** 标题：右侧"图例"页写资源名（默认）；图层浮层的标题栏已经写着名称，写"样式设置" */
    title: { type: String as PropType<string | undefined>, default: undefined }
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
    const swatchOfItem = (item: string) => {
      const symbol = props.symbols.symbolOf({ code: props.entry.code, item });
      return symbol && <LegendSwatchIcon swatch={swatchOf(symbol)} />;
    };

    // 灰框的第一行：选类别，可搜索，选项带符号
    const renderPicker = (choices: readonly Choice[], current: Choice) => (
      <div class={editorStyles.row}>
        <span class={editorStyles.label}>类别</span>
        <ElSelect
          class={editorStyles.select}
          size="small"
          filterable
          ariaLabel="选择要修改的类别"
          modelValue={current.key}
          onUpdate:modelValue={(value: unknown) => {
            if (typeof value === 'string' && choices.some(choice => choice.key === value)) {
              emit('update:selected', value);
            }
          }}
        >
          {{
            prefix: () => swatchOfItem(current.key),
            default: () =>
              choices.map(choice => (
                <ElOption key={choice.key} value={choice.key} label={choice.label}>
                  <span class={editorStyles.option} data-class-option={choice.key}>
                    {swatchOfItem(choice.key)}
                    {choice.label}
                  </span>
                </ElOption>
              ))
          }}
        </ElSelect>
      </div>
    );

    return () => {
      const { entry } = props;
      const classified = entry.kind !== 'symbol' && entry.mode === 'classified';
      const choices = classified ? choicesOf(entry) : [];
      const current = choices.find(choice => choice.key === props.selected) ?? choices[0];
      const target: SymbolTarget = current ? { code: entry.code, item: current.key } : { code: entry.code };
      return (
        <div
          class={styles.configuration}
          data-legend-settings={entry.code}
          style={{ '--legend-opacity': props.layers.state.value.displays.get(entry.code)?.opacity }}
        >
          {/* 右侧图例、图层浮层进来时焦点放在这一行（读屏报出换了视图），下一个 Tab 就是"返回图例" */}
          <div class={styles.settingsHeading} tabindex={-1} data-settings-heading>
            <MxTitle>{props.title ?? entry.name}</MxTitle>
            <ElButton class={styles.back} link size="small" icon={ArrowLeft} onClick={() => emit('back')}>
              返回图例
            </ElButton>
          </div>
          {entry.kind !== 'symbol' && (
            <div class={styles.modeRow}>
              <span class={styles.modeLabel}>显示方式</span>
              <ElRadioGroup size="small" aria-label="图层配色方式" modelValue={entry.mode} onUpdate:modelValue={selectMode}>
                {MODES.map(mode => (
                  <ElRadioButton key={mode.value} value={mode.value}>
                    {mode.label}
                  </ElRadioButton>
                ))}
              </ElRadioGroup>
            </div>
          )}
          <SymbolEditor
            symbols={props.symbols}
            target={target}
            name={current ? current.name : entry.name}
            resetLabel={current ? `恢复${current.name}的默认` : '恢复默认'}
          >
            {{ lead: () => current && renderPicker(choices, current) }}
          </SymbolEditor>
          {entry.kind !== 'symbol' && (
            <ElButton
              class={styles.resetLayer}
              link
              type="primary"
              size="small"
              disabled={!props.symbols.isCustomized(entry.code)}
              aria-label={`恢复${entry.name}整个图层的默认符号`}
              onClick={() => props.symbols.resetResource(entry.code)}
            >
              恢复整个图层默认
            </ElButton>
          )}
        </div>
      );
    };
  }
});
