import { ArrowDown, ArrowRight, Search } from '@element-plus/icons-vue';
import { ElIcon, ElInput, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, type PropType, type VNode } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LanduseLegendItem, type LanduseLegendView, type LegendSwatch, landuseLegend } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './LanduseLegend.module.scss';
import { SymbolEditor } from './SymbolEditor';

// 现状分类是土地利用现状分类（表 A.1），工作分类是第三次全国国土调查工作分类（表 A.2）
const VIEWS: readonly { readonly value: LanduseLegendView; readonly label: string }[] = [
  { value: 'status', label: '现状分类 A.1' },
  { value: 'work', label: '工作分类 A.2' },
  { value: 'all', label: '全部' }
];

/** 地类图例的浏览状态：由资源图例按资源保管，隐藏后再显示时照旧 */
export interface LanduseBrowse {
  readonly view: LanduseLegendView;
  readonly keyword: string;
  /** 展开的分组 */
  readonly expanded: ReadonlySet<string>;
  /** 展开编辑器的地类 */
  readonly editing: string | null;
}

export const INITIAL_LANDUSE_BROWSE: LanduseBrowse = Object.freeze({
  view: 'status',
  keyword: '',
  expanded: new Set<string>(),
  editing: null
});

/**
 * 地类图例（ADR 0043、0044，设计稿 5D.5）：三种展示、按编码或名称搜索、分组展开；预览由图例按符号推导后传入。
 * 点一个地类展开它在分类样式里的编辑器，同一时间只展开一个；改过符号的地类名称后有一个小圆点。
 * 浏览状态由上层通过 browse 给出，组件只显示和发出新的状态
 */
export const LanduseLegend = defineComponent({
  name: 'LanduseLegend',
  props: {
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    code: { type: String, required: true },
    /** 各地类的预览，按取值的键 */
    swatches: { type: Object as PropType<ReadonlyMap<string, LegendSwatch>>, required: true },
    browse: { type: Object as PropType<LanduseBrowse>, required: true }
  },
  emits: {
    'update:browse': (browse: LanduseBrowse) => typeof browse === 'object'
  },
  setup(props, { emit }) {
    const view = computed(() => props.browse.view);
    const keyword = computed(() => props.browse.keyword);
    const expanded = computed(() => props.browse.expanded);
    const editing = computed(() => props.browse.editing);
    const update = (patch: Partial<LanduseBrowse>) => emit('update:browse', { ...props.browse, ...patch });

    // 一个地类：含义说明放在 title 里；编辑器向左拉回地类的缩进，和面板一样宽
    const renderItem = (item: LanduseLegendItem): VNode => {
      const swatch = props.swatches.get(item.key);
      const open = editing.value === item.key;
      const target = { code: props.code, item: item.key };
      return (
        <li key={item.key} title={item.meaning} data-landuse={item.code ?? item.name}>
          <button
            type="button"
            class={[styles.item, open && styles.open]}
            aria-label={`${open ? '收起' : '展开'}${item.name}`}
            aria-expanded={open}
            onClick={() => update({ editing: open ? null : item.key })}>
            {swatch && <LegendSwatchIcon swatch={swatch} />}
            {item.code !== null && <span class={styles.code}>{item.code}</span>}
            <span class={styles.name}>{item.name}</span>
            {props.symbols.hasOverride(target) && <span class={styles.edited} title="改过符号" data-edited />}
            {item.adjustable && <span class={styles.tag}>可调整</span>}
          </button>
          {open && <SymbolEditor class={styles.editor} symbols={props.symbols} target={target} name={item.name} />}
        </li>
      );
    };
    const sections = computed(() => landuseLegend(view.value, keyword.value));
    const searching = computed(() => keyword.value.trim() !== '');

    const selectView = (value: unknown) => {
      const next = VIEWS.find(item => item.value === value);
      if (next) {
        update({ view: next.value });
      }
    };

    const toggle = (key: string) => {
      const next = new Set(expanded.value);
      if (!next.delete(key)) {
        next.add(key);
      }
      update({ expanded: next });
    };

    return () => (
      <div class={styles.legend}>
        <ElRadioGroup
          size="small"
          modelValue={view.value}
          onUpdate:modelValue={value => selectView(value)}>
          {VIEWS.map(item => (
            <ElRadioButton key={item.value} value={item.value}>
              {item.label}
            </ElRadioButton>
          ))}
        </ElRadioGroup>
        <ElInput
          size="small"
          modelValue={keyword.value}
          clearable
          prefixIcon={Search}
          placeholder="搜索编码或名称"
          onUpdate:modelValue={(value: string) => update({ keyword: value })}
        />
        {sections.value.length === 0 && <div class={styles.empty}>没有找到地类</div>}
        <ul class={styles.sections}>
          {sections.value.map(section => {
            // 平铺只有一组，直接显示；搜索时都展开
            const open = view.value === 'all' || searching.value || expanded.value.has(section.key);
            return (
              <li key={section.key} data-landuse-section={section.key}>
                <button
                  type="button"
                  class={styles.section}
                  aria-label={`${open ? '收起' : '展开'}${section.name}`}
                  aria-expanded={open}
                  onClick={() => toggle(section.key)}>
                  <ElIcon class={styles.arrow}>{open ? <ArrowDown /> : <ArrowRight />}</ElIcon>
                  {section.code !== null && <span class={styles.code}>{section.code}</span>}
                  <span class={styles.name}>{section.name}</span>
                  <span class={styles.count}>{section.items.length}</span>
                </button>
                {open && <ul class={styles.items}>{section.items.map(renderItem)}</ul>}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
});
