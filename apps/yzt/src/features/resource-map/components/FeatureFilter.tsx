import { Search } from '@element-plus/icons-vue';
import { ElButton, ElCheckbox, ElInput } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNode, watch } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import {
  type FeatureFilter as Filter,
  filterText,
  isFiltering,
  keptKeys,
  NO_FILTER,
  withFieldKept
} from '../feature-filter';
import { CLASS_FIELD, type FilterField, filterFieldsOf, type FilterGroup, type FilterValue } from '../filter-fields';
import { legendEntry, type LegendSwatch } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './FeatureFilter.module.scss';

// 取值多于这些时有搜索
const SEARCH_FROM = 10;

// 勾着几项决定"全选"、组的复选框：全勾、部分（半选）、都没勾
type CheckState = 'all' | 'some' | 'none';

const checkState = (keys: readonly string[], kept: ReadonlySet<string>): CheckState => {
  const on = keys.filter(key => kept.has(key)).length;
  if (on === 0) {
    return 'none';
  }
  return on === keys.length ? 'all' : 'some';
};

const matches = (value: FilterValue, keyword: string) =>
  value.label.toLowerCase().includes(keyword) || (value.code?.toLowerCase().includes(keyword) ?? false);

/**
 * 一个资源的要素过滤（ADR 0173），放在图层的过滤浮层里：选字段（只有一个时只写名称），取值是复选框，勾着的显示、默认全勾，
 * "全选"三态，悬停一项"仅此项"；地类按一级类分组，取值多时可以搜索；勾了立即交给拥有者，底部写条件和"清空过滤"。
 * 分类字段的取值前面是图例的符号（统一样式时不画）
 */
export const FeatureFilter = defineComponent({
  name: 'FeatureFilter',
  props: {
    layers: { type: Object as PropType<Pick<ResourceLayers, 'state' | 'setFilter'>>, required: true },
    symbols: { type: Object as PropType<Pick<ResourceSymbols, 'overrideOf'>>, required: true },
    code: { type: String, required: true }
  },
  setup(props) {
    const fields = computed(() => filterFieldsOf(props.code));
    const resource = computed(() => props.layers.state.value.catalog?.resources.get(props.code));
    const display = computed(() => props.layers.state.value.displays.get(props.code));
    const filter = computed((): Filter => display.value?.filter ?? NO_FILTER);

    // 打开时先看有条件的字段；换资源时重新选；换字段、换资源时搜索清空
    const initialField = () => (fields.value.find(field => filter.value[field.id]) ?? fields.value[0])?.id ?? null;
    const fieldId = ref<string | null>(initialField());
    const keyword = ref('');
    watch(
      () => props.code,
      () => {
        fieldId.value = initialField();
        keyword.value = '';
      }
    );
    const field = computed(() => fields.value.find(item => item.id === fieldId.value) ?? fields.value[0]);

    // 分类字段的符号：取全部类别的图例（不按条件），统一样式时没有
    const swatches = computed((): ReadonlyMap<string, LegendSwatch> => {
      const item = resource.value;
      const shown = display.value;
      if (!item || !shown || field.value?.id !== CLASS_FIELD) {
        return new Map();
      }
      const entry = legendEntry(item, shown.year, props.symbols.overrideOf(props.code));
      if (entry.kind === 'symbol' || entry.mode === 'uniform') {
        return new Map();
      }
      return entry.kind === 'landuse' ? entry.swatches : new Map(entry.values.map(value => [value.key, value.swatch]));
    });

    const setKept = (current: FilterField, kept: Iterable<string>) =>
      props.layers.setFilter(props.code, withFieldKept(fields.value, filter.value, current.id, kept));
    const toggle = (current: FilterField, keys: readonly string[], on: boolean) => {
      const kept = new Set(keptKeys(current, filter.value));
      keys.forEach(key => (on ? kept.add(key) : kept.delete(key)));
      setKept(current, kept);
    };

    const renderTabs = (current: FilterField): VNode => {
      if (fields.value.length === 1) {
        return (
          <div class={styles.fields}>
            <span class={styles.lead}>按</span>
            <span class={[styles.field, styles.selected]}>{current.label}</span>
          </div>
        );
      }
      return (
        <div class={styles.fields} role="tablist" aria-label="过滤的字段">
          <span class={styles.lead}>按</span>
          {fields.value.map(item => {
            const kept = filter.value[item.id];
            const selected = item.id === current.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                class={[styles.field, selected && styles.selected]}
                aria-selected={selected}
                aria-label={kept ? `${item.label}，勾了 ${kept.length} 项` : item.label}
                data-filter-field={item.id}
                onClick={() => {
                  fieldId.value = item.id;
                  keyword.value = '';
                }}
              >
                {item.label}
                {kept && <span class={styles.badge}>{kept.length}</span>}
              </button>
            );
          })}
        </div>
      );
    };

    const renderValue = (current: FilterField, value: FilterValue, kept: ReadonlySet<string>, child = false) => {
      const swatch = swatches.value.get(value.key);
      const on = kept.has(value.key);
      return (
        <div key={value.key} class={[styles.value, child && styles.child]} data-filter-value={value.key}>
          <ElCheckbox
            class={styles.check}
            modelValue={on}
            onUpdate:modelValue={(checked: string | number | boolean) => toggle(current, [value.key], checked === true)}
          >
            {swatch && <LegendSwatchIcon swatch={swatch} size="small" />}
            <span class={styles.label} title={value.code ? `${value.code} ${value.label}` : value.label}>
              {value.code && <span class={styles.code}>{value.code}</span>}
              {value.label}
            </span>
          </ElCheckbox>
          <button
            type="button"
            class={styles.only}
            aria-label={`只显示${value.label}`}
            data-filter-only={value.key}
            onClick={() => setKept(current, [value.key])}
          >
            仅此项
          </button>
        </div>
      );
    };

    const renderGroup = (current: FilterField, group: FilterGroup, kept: ReadonlySet<string>): VNode[] => {
      const values = group.keys.flatMap(key => current.values.find(value => value.key === key) ?? []);
      const [single] = values;
      // 只有一项的组（未匹配的地类）直接列出
      if (values.length === 1 && single) {
        return [renderValue(current, single, kept)];
      }
      const state = checkState(group.keys, kept);
      const on = group.keys.filter(key => kept.has(key)).length;
      return [
        <div key={`group-${group.name}`} class={[styles.value, styles.group]} data-filter-group={group.name}>
          <ElCheckbox
            class={styles.check}
            modelValue={state === 'all'}
            indeterminate={state === 'some'}
            onUpdate:modelValue={() => toggle(current, group.keys, state !== 'all')}
          >
            <span class={styles.label}>{group.name}</span>
          </ElCheckbox>
          <span class={styles.count}>
            {on}/{group.keys.length}
          </span>
        </div>,
        ...values.map(value => renderValue(current, value, kept, true))
      ];
    };

    const renderValues = (current: FilterField, kept: ReadonlySet<string>): VNode[] => {
      const needle = keyword.value.trim().toLowerCase();
      if (current.groups && needle === '') {
        return current.groups.flatMap(group => renderGroup(current, group, kept));
      }
      const shown = current.values.filter(value => needle === '' || matches(value, needle));
      if (shown.length === 0) {
        return [<div class={styles.none}>没有匹配的取值</div>];
      }
      return shown.map(value => renderValue(current, value, kept));
    };

    const renderAll = (current: FilterField, kept: ReadonlySet<string>) => {
      const needle = keyword.value.trim().toLowerCase();
      // 搜索时"全选"只管搜到的
      const keys = current.values.filter(value => needle === '' || matches(value, needle)).map(value => value.key);
      const state = checkState(keys, kept);
      return (
        <div class={[styles.value, styles.all]} data-filter-all>
          <ElCheckbox
            class={styles.check}
            modelValue={state === 'all'}
            indeterminate={state === 'some'}
            disabled={keys.length === 0}
            onUpdate:modelValue={() => toggle(current, keys, state !== 'all')}
          >
            {needle === '' ? '全选' : '全选搜索结果'}
          </ElCheckbox>
          <span class={styles.count}>
            {kept.size}/{current.values.length}
          </span>
        </div>
      );
    };

    const renderFoot = () => {
      const active = isFiltering(filter.value);
      const empty = Object.values(filter.value).some(kept => kept.length === 0);
      return (
        <div class={styles.foot} data-filter-summary>
          <span class={styles.summary}>
            {empty && <span class={styles.warning}>有字段一项都没选，地图上不显示这一层。</span>}
            {active ? (
              <>
                已过滤：<span class={styles.conditions}>{filterText(props.code, filter.value)}</span>
              </>
            ) : (
              '没有过滤，显示全部要素'
            )}
          </span>
          <ElButton
            class="button-inline"
            link
            type="primary"
            size="small"
            disabled={!active}
            onClick={() => props.layers.setFilter(props.code, NO_FILTER)}
          >
            清空过滤
          </ElButton>
        </div>
      );
    };

    return () => {
      const current = field.value;
      if (!current || !display.value) {
        return null;
      }
      const kept = keptKeys(current, filter.value);
      const legendFollows = current.id === CLASS_FIELD && swatches.value.size > 0;
      return (
        <div class={styles.filter} data-feature-filter={props.code}>
          <div class={styles.head}>
            {renderTabs(current)}
            <div class={styles.hint}>
              {legendFollows ? '图例按它分类：没勾的类别图例里也不显示' : '图例里写明过滤条件'}
            </div>
            {current.values.length > SEARCH_FROM && (
              <ElInput
                class={styles.search}
                size="small"
                modelValue={keyword.value}
                clearable
                prefixIcon={Search}
                placeholder={`搜索${current.label}`}
                aria-label={`搜索${current.label}的取值`}
                onUpdate:modelValue={(value: string) => (keyword.value = value)}
              />
            )}
            {renderAll(current, kept)}
          </div>
          <div class={styles.values} role="group" aria-label={`${current.label}的取值`}>
            {renderValues(current, kept)}
          </div>
          {renderFoot()}
        </div>
      );
    };
  }
});
