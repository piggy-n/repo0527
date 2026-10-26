import { Search } from '@element-plus/icons-vue';
import { ElInput } from 'element-plus';
import { computed, defineComponent, type PropType, type VNode } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LanduseLegendItem, landuseItemLabel, landuseLegendItems, type LegendSwatch } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './LanduseLegend.module.scss';

/** 地类图例的浏览状态：由资源图例按资源保管，隐藏后再显示时照旧 */
export interface LanduseBrowse {
  readonly keyword: string;
}

export const INITIAL_LANDUSE_BROWSE: LanduseBrowse = Object.freeze({
  keyword: ''
});

/**
 * 地类图例平铺符号和名称，悬浮查看含义、点击交给上层打开单项编辑视图。
 * 搜索状态由上层保管，返回或切换标签时保留；预览仍由样式拥有者推导
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
    'update:browse': (browse: LanduseBrowse) => typeof browse === 'object',
    edit: (key: string) => typeof key === 'string'
  },
  setup(props, { emit }) {
    const keyword = computed(() => props.browse.keyword);
    const update = (patch: Partial<LanduseBrowse>) => emit('update:browse', { ...props.browse, ...patch });

    // 整个条目可点击，编码和完整含义由原生提示展示，不额外占用名称宽度
    const renderItem = (item: LanduseLegendItem): VNode => {
      const swatch = props.swatches.get(item.key);
      const target = { code: props.code, item: item.key };
      return (
        <li key={item.key} data-landuse={item.code ?? item.name}>
          <button
            type="button"
            class={styles.item}
            title={`${landuseItemLabel(item)}${item.adjustable ? '（可调整）' : ''}\n${item.meaning}`}
            aria-label={`编辑${item.name}样式`}
            onClick={() => emit('edit', item.key)}
          >
            {swatch && <LegendSwatchIcon class={styles.swatch} swatch={swatch} />}
            <span class={styles.name}>{item.name}</span>
            {props.symbols.hasOverride(target) && <span class={styles.edited} title="改过符号" data-edited />}
          </button>
        </li>
      );
    };
    const items = computed(() => landuseLegendItems(keyword.value));

    return () => (
      <div class={styles.legend}>
        <ElInput
          size="small"
          modelValue={keyword.value}
          clearable
          prefixIcon={Search}
          placeholder="搜索编码或名称"
          aria-label="搜索地类编码或名称"
          onUpdate:modelValue={(value: string) => update({ keyword: value })}
        />
        {items.value.length === 0 && <div class={styles.empty}>没有找到地类</div>}
        <ul class={styles.items} data-landuse-section="all">
          {items.value.map(renderItem)}
        </ul>
      </div>
    );
  }
});
