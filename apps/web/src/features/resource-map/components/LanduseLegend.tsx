import { ArrowDown, ArrowRight, Search } from '@element-plus/icons-vue';
import { ElButton, ElInput, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { type LanduseLegendItem, type LanduseLegendView, type LegendSwatch, landuseLegend } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './LanduseLegend.module.scss';

// 现状分类是土地利用现状分类（表 A.1），工作分类是第三次全国国土调查工作分类（表 A.2）
const VIEWS: readonly { readonly value: LanduseLegendView; readonly label: string }[] = [
  { value: 'status', label: '现状分类 A.1' },
  { value: 'work', label: '工作分类 A.2' },
  { value: 'all', label: '全部' }
];

// 一个地类：含义说明放在 title 里
function renderItem(item: LanduseLegendItem, swatch: LegendSwatch | undefined) {
  return (
    <li key={item.key} class={styles.item} title={item.meaning} data-landuse={item.code ?? item.name}>
      {swatch && <LegendSwatchIcon swatch={swatch} />}
      {item.code !== null && <span class={styles.code}>{item.code}</span>}
      <span class={styles.name}>{item.name}</span>
      {item.adjustable && <span class={styles.tag}>可调整</span>}
    </li>
  );
}

/** 地类图例（ADR 0043）：三种展示、按编码或名称搜索、分组展开；预览由图例按符号推导后传入 */
export const LanduseLegend = defineComponent({
  name: 'LanduseLegend',
  props: {
    /** 各地类的预览，按取值的键 */
    swatches: { type: Object as PropType<ReadonlyMap<string, LegendSwatch>>, required: true }
  },
  setup(props) {
    // 都是图例自己的界面状态
    const view = ref<LanduseLegendView>('status');
    const keyword = ref('');
    const expanded = ref<ReadonlySet<string>>(new Set());
    const sections = computed(() => landuseLegend(view.value, keyword.value));
    const searching = computed(() => keyword.value.trim() !== '');

    const selectView = (value: unknown) => {
      const next = VIEWS.find(item => item.value === value);
      if (next) {
        view.value = next.value;
      }
    };

    const toggle = (key: string) => {
      const next = new Set(expanded.value);
      if (!next.delete(key)) {
        next.add(key);
      }
      expanded.value = next;
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
          onUpdate:modelValue={(value: string) => (keyword.value = value)}
        />
        {sections.value.length === 0 && <div class={styles.empty}>没有找到地类</div>}
        <ul class={styles.sections}>
          {sections.value.map(section => {
            // 平铺只有一组，直接显示；搜索时都展开
            const open = view.value === 'all' || searching.value || expanded.value.has(section.key);
            return (
              <li key={section.key} data-landuse-section={section.key}>
                <ElButton
                  link
                  icon={open ? ArrowDown : ArrowRight}
                  aria-label={`${open ? '收起' : '展开'}${section.name}`}
                  onClick={() => toggle(section.key)}>
                  {section.code !== null && <span class={styles.sectionCode}>{section.code}</span>}
                  {section.name}
                  <span class={styles.sectionCount}>{section.items.length}</span>
                </ElButton>
                {open && (
                  <ul class={styles.items}>{section.items.map(item => renderItem(item, props.swatches.get(item.key)))}</ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
});
