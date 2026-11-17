import { computed, defineComponent, type PropType } from 'vue';
import { CityFilter } from '@/shared/dashboard/filters/CityFilter';
import { FilterPanel } from '@/shared/dashboard/filters/FilterPanel';
import { FilterSection } from '@/shared/dashboard/filters/FilterSection';
import { IconOptionList, type IconOption } from '@/shared/dashboard/filters/IconOptionList';
import { OptionList } from '@/shared/dashboard/filters/OptionList';
import { YearFilter } from '@/shared/dashboard/filters/YearFilter';
import { withUnit } from '@/shared/dashboard/format';
import type { IconName } from '@/shared/icons/SvgIcon';
import { CATEGORIES, CITIES } from '../catalog';
import type { CategoryId } from '../model';
import type { DashboardModel } from '../composables/useDashboard';

const categoryIcons: Record<CategoryId, IconName> = {
  resilience: 'dashboard-resilience',
  innovation: 'dashboard-innovation',
  happiness: 'dashboard-happiness',
  coordination: 'dashboard-coordination'
};

const categoryOptions: readonly IconOption[] = CATEGORIES.map(category => ({
  id: category.id,
  name: category.name,
  icon: categoryIcons[category.id]
}));

/** 筛选组件只调用状态拥有者，不生成或计算数据 */
export const DashboardFilters = defineComponent({
  name: 'DashboardFilters',
  props: {
    model: { type: Object as PropType<DashboardModel>, required: true },
    active: { type: Boolean, default: true }
  },
  emits: { locate: (_id: string) => true },
  setup(props, { emit }) {
    const indicatorOptions = computed(() => props.model.category.value.indicators.map(indicator => ({
      id: indicator.id,
      label: withUnit(indicator.name, indicator.unit)
    })));

    function selectCategory(id: string): void {
      const category = CATEGORIES.find(item => item.id === id);
      if (category) {
        props.model.selectCategory(category.id);
      }
    }

    /** 切换地图指标，同时通知右侧图表列表定位 */
    function selectIndicator(id: string): void {
      props.model.selectIndicator(id);
      emit('locate', id);
    }

    return () => {
      const model = props.model;
      const state = model.state.value;
      return (
        <FilterPanel active={props.active}>
          <YearFilter options={model.availableYears} selected={state.years} onChange={model.setYears} />
          <CityFilter cities={CITIES} selected={state.cityCodes} onToggle={model.toggleCity} onSet={model.setCities} />
          <FilterSection title="指标类型">
            <IconOptionList options={categoryOptions} selected={state.categoryId} onSelect={selectCategory} />
          </FilterSection>
          <FilterSection title="具体指标" fill>
            <OptionList
              options={indicatorOptions.value}
              selected={state.indicatorId}
              label="具体指标列表"
              resetKey={state.categoryId}
              onSelect={selectIndicator}
            />
          </FilterSection>
        </FilterPanel>
      );
    };
  }
});
