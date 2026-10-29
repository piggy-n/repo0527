import { Search } from '@element-plus/icons-vue';
import { MxPanel, MxSection } from '@yzt/ui';
import { ElCheckbox, ElInput } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type VNodeChild } from 'vue';
import type { CategoryId } from '@/shared/city-indicators/catalog';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import { searchIndicators, SIMULATION_YEARS } from '../compose/composition';
import type { CompositionOwner } from '../composables/useComposition';
import type { ConditionDrag, DragItem } from '../composables/useConditionDrag';
import { INDICATOR_GROUPS, reachText, type SimulationIndicator } from '../model/indicators';
import styles from './ConditionLibrary.module.scss';

const indicatorTitle = (item: SimulationIndicator) => `${item.name}（${item.unit}，${reachText(item)}）`;

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

/** 条件库：年度、城市、指标都可以点选，也可以拖到编排图上 */
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
      return (
        <div>
          <ElInput
            class={styles.search}
            modelValue={keyword.value}
            placeholder="搜索指标"
            aria-label="搜索指标"
            prefixIcon={Search}
            clearable
            onUpdate:modelValue={(value: string) => (keyword.value = value)}
          />
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
                        [
                          <SvgIcon
                            class={styles.type}
                            name={item.model === 'coverage' ? 'simulation-coverage' : 'simulation-per-capita'}
                          />,
                          <span class={styles.name}>{item.short}</span>
                        ],
                        indicatorTitle(item)
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div class={styles.legend}>
            <span>
              <SvgIcon name="simulation-coverage" />
              覆盖率类
            </span>
            <span>
              <SvgIcon name="simulation-per-capita" />
              人均类
            </span>
          </div>
        </div>
      );
    };

    return () => {
      const { composition } = props;
      const { cityCodes, indicatorIds } = composition.state.value.conditions;
      const all = cityCodes.length === JIANGSU_CITIES.length;
      return (
        <MxPanel class={styles.panel} title="条件库" description="点选或拖到右侧" headerTone="muted">
          {{
            icon: () => <SvgIcon name="simulation-ai" />,
            default: () => (
              <div class={styles.body}>
                <MxSection title="监测年份">
                  {{ extra: () => <span class={styles.extra}>可多选</span>, default: renderYears }}
                </MxSection>
                <MxSection title="监测范围">
                  {{
                    extra: () => (
                      <ElCheckbox
                        modelValue={all}
                        indeterminate={cityCodes.length > 0 && !all}
                        onChange={value => composition.setAllCities(value === true)}
                      >
                        全省
                      </ElCheckbox>
                    ),
                    default: renderCities
                  }}
                </MxSection>
                <MxSection title="监测指标">
                  {{
                    extra: () => <span class={styles.extra}>已选 {indicatorIds.length}</span>,
                    default: renderIndicators
                  }}
                </MxSection>
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
