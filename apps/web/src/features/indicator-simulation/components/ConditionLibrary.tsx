import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElCheckbox, ElInput } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNodeChild } from 'vue';
import type { CategoryId } from '@/shared/city-indicators/catalog';
import { JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import { searchIndicators, SIMULATION_YEARS } from '../compose/composition';
import type { CompositionOwner } from '../composables/useComposition';
import type { ConditionDrag, DragItem } from '../composables/useConditionDrag';
import { INDICATOR_GROUPS, reachText, type SimulationIndicator } from '../model/indicators';
import styles from './ConditionLibrary.module.scss';

const indicatorTitle = (item: SimulationIndicator) => `${item.name}（${item.unit}）${item.id} · ${reachText(item)}`;

const chipKey = (item: DragItem): string => {
  switch (item.kind) {
    case 'years':
      return `years:${item.year}`;
    case 'region':
      return `region:${item.code}`;
    case 'indicators':
      break;
  }
  return `indicators:${item.id}`;
};

// 一个模块：区块标题、右侧的补充，下面是内容；间距比 MxSection 紧凑，指标模块撑满剩余高度
const section = (title: string, extra: VNodeChild, content: VNodeChild, fill = false) => (
  <section class={[styles.section, fill && styles.fill]}>
    <MxTitle>{{ default: () => title, extra: () => extra }}</MxTitle>
    {content}
  </section>
);

/** 指标智能推演条件：年度、城市、指标都可以点选，也可以拖到编排图上；年度和范围固定在上面，只有指标列表滚动 */
export const ConditionLibrary = defineComponent({
  name: 'ConditionLibrary',
  props: {
    composition: { type: Object as PropType<CompositionOwner>, required: true },
    drag: { type: Object as PropType<ConditionDrag>, required: true }
  },
  setup(props) {
    const keyword = ref('');
    const folded = ref<ReadonlySet<CategoryId>>(new Set());
    const toggleFold = (id: CategoryId) => {
      const next = new Set(folded.value);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      folded.value = next;
    };

    const groups = computed(() => {
      const matched = new Set(searchIndicators(keyword.value).map(item => item.id));
      return INDICATOR_GROUPS.map(({ id, name, indicators }) => ({
        id,
        name,
        items: indicators.filter(item => matched.has(item.id))
      })).filter(group => group.items.length > 0);
    });

    const chip = (item: DragItem, pressed: boolean, onClick: () => void, content: VNodeChild, title?: string) => (
      <button
        key={chipKey(item)}
        type="button"
        class={styles.chip}
        draggable="true"
        aria-pressed={pressed}
        title={title}
        onClick={onClick}
        onDragstart={event => props.drag.start(item, event)}
        onDragend={() => props.drag.end()}
      >
        {content}
      </button>
    );

    const renderYears = () => {
      const { composition } = props;
      const { years } = composition.state.value.conditions;
      return (
        <div class={[styles.grid, styles.years]}>
          {SIMULATION_YEARS.map(year =>
            chip({ kind: 'years', year }, years.includes(year), () => composition.toggleYear(year), year)
          )}
        </div>
      );
    };

    const renderCities = () => {
      const { composition } = props;
      const { cityCodes } = composition.state.value.conditions;
      return (
        <div class={[styles.grid, styles.cities]}>
          {JIANGSU_CITIES.map(city =>
            chip(
              { kind: 'region', code: city.code },
              cityCodes.includes(city.code),
              () => composition.toggleCity(city.code),
              shortRegionName(city.name),
              city.name
            )
          )}
        </div>
      );
    };

    const renderIndicators = () => {
      const { composition } = props;
      const { indicatorIds } = composition.state.value.conditions;
      const searching = keyword.value.trim() !== '';
      return [
        <ElInput
          key="search"
          class={styles.search}
          modelValue={keyword.value}
          placeholder="搜索指标名称或编码"
          aria-label="搜索指标"
          prefixIcon={Search}
          clearable
          onUpdate:modelValue={(value: string) => (keyword.value = value)}
        />,
        <div key="list" class={styles.list}>
          {groups.value.length === 0 && <p class={styles.empty}>没有匹配的指标</p>}
          {groups.value.map(group => {
            const open = searching || !folded.value.has(group.id);
            const picked = group.items.filter(item => indicatorIds.includes(item.id)).length;
            return (
              <div key={group.id} class={styles.group}>
                <button
                  type="button"
                  class={styles.groupHead}
                  aria-expanded={open}
                  disabled={searching}
                  onClick={() => toggleFold(group.id)}
                >
                  <span class={styles.caret} />
                  {group.name}
                  <span class={styles.count}>
                    {picked}/{group.items.length}
                  </span>
                </button>
                {open && (
                  <div class={[styles.grid, styles.indicators]}>
                    {group.items.map(item =>
                      chip(
                        { kind: 'indicators', id: item.id },
                        indicatorIds.includes(item.id),
                        () => composition.toggleIndicator(item.id),
                        <span class={styles.name}>{item.short}</span>,
                        indicatorTitle(item)
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ];
    };

    return () => {
      const { composition } = props;
      const { cityCodes, indicatorIds } = composition.state.value.conditions;
      const all = cityCodes.length === JIANGSU_CITIES.length;
      return (
        <MxPanel class={styles.panel} title="指标计算条件" headerTone="muted" flush>
          {{
            actions: () => (
              <ElButton link type="primary" icon={RefreshLeft} onClick={() => composition.reset()}>
                重置条件
              </ElButton>
            ),
            default: () => (
              <div class={styles.body}>
                {section('监测年份', <span class={styles.extra}>可多选</span>, renderYears())}
                {section(
                  '监测范围',
                  <ElCheckbox
                    modelValue={all}
                    indeterminate={cityCodes.length > 0 && !all}
                    onChange={value => composition.setAllCities(value === true)}
                  >
                    全省
                  </ElCheckbox>,
                  renderCities()
                )}
                {section('监测指标', <span class={styles.extra}>已选 {indicatorIds.length}</span>, renderIndicators(), true)}
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
