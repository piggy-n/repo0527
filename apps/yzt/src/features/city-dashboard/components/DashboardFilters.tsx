import { defineComponent, nextTick, ref, watch, type PropType } from 'vue';
import { ElOption, ElSelect } from 'element-plus';
import { SvgIcon, type IconName } from '@/shared/icons/SvgIcon';
import { CATEGORIES, CITIES } from '../catalog';
import type { CategoryId } from '../model';
import type { DashboardModel } from '../composables/useDashboard';
import fonts from './DashboardFonts.module.scss';
import styles from './DashboardFilters.module.scss';

const categoryIcons: Record<CategoryId, IconName> = {
  resilience: 'dashboard-resilience',
  innovation: 'dashboard-innovation',
  happiness: 'dashboard-happiness',
  coordination: 'dashboard-coordination'
};

/** 筛选区块沿用驾驶舱的彩色标题图标 */
const renderHeading = (title: string) => (
  <h2 class={styles.heading}>
    <SvgIcon name="dashboard-section-color" size={16} />
    <span>{title}</span>
  </h2>
);

/** 筛选组件只调用状态拥有者，不生成或计算数据 */
export const DashboardFilters = defineComponent({
  name: 'DashboardFilters',
  props: {
    model: { type: Object as PropType<DashboardModel>, required: true },
    active: { type: Boolean, default: true }
  },
  emits: { locate: (_id: string) => true },
  setup(props, { emit }) {
    const list = ref<HTMLElement>();

    function toggleAllCities(): void {
      const allSelected = props.model.state.value.cityCodes.length === CITIES.length;
      props.model.setCities(allSelected ? [] : CITIES.map(city => city.code));
    }

    /** 切换地图指标，同时通知右侧图表列表定位 */
    function selectIndicator(id: string): void {
      props.model.selectIndicator(id);
      emit('locate', id);
    }

    // 换了指标类型，具体指标列表回到顶部；等列表按新类型渲染后再滚
    watch(
      () => props.model.state.value.categoryId,
      async () => {
        await nextTick();
        list.value?.scrollTo({ top: 0 });
      }
    );

    return () => {
      const model = props.model;
      const state = model.state.value;
      return (
        <aside
          class={[fonts.scope, styles.filters]}
          aria-label="大屏筛选条件"
          data-enter="left"
          inert={!props.active}
        >
          <section class={styles.group} data-filter-group>
            {renderHeading('年份选择')}
            <ElSelect
              class={styles.years}
              popperClass={styles.yearPopper}
              modelValue={[...state.years]}
              multiple
              clearable
              placeholder="请选择比较年份"
              aria-label="选择比较年份"
              onUpdate:modelValue={(value: number[]) => model.setYears(value)}
            >
              {model.availableYears.map(year => <ElOption key={year} value={year} label={String(year)} />)}
            </ElSelect>
          </section>
          <section class={styles.group} data-filter-group>
            <div class={styles.headingRow}>
              {renderHeading('行政区划')}
              <button type="button" class={styles.textButton} onClick={toggleAllCities}>
                {state.cityCodes.length === CITIES.length ? '清空' : '全选'}
              </button>
            </div>
            <div class={styles.cities}>
              {CITIES.map(city => (
                <button
                  key={city.code}
                  type="button"
                  class={[styles.city, state.cityCodes.includes(city.code) && styles.selectedCity]}
                  aria-pressed={state.cityCodes.includes(city.code)}
                  onClick={() => model.toggleCity(city.code)}
                >
                  {city.name}
                  {state.cityCodes.includes(city.code) && (
                    <span class={styles.check}>
                      <SvgIcon name="check" size={12} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
          <section class={styles.group} data-filter-group>
            {renderHeading('指标类型')}
            <div class={styles.categories}>
              {CATEGORIES.map(category => (
                <button
                  key={category.id}
                  type="button"
                  class={[styles.option, styles.category, state.categoryId === category.id && styles.selected]}
                  aria-pressed={state.categoryId === category.id}
                  onClick={() => model.selectCategory(category.id)}
                >
                  <SvgIcon name={categoryIcons[category.id]} />
                  <span>{category.name}</span>
                  {state.categoryId === category.id && (
                    <span class={styles.arrow}>
                      <SvgIcon name="dashboard-chevron" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
          <section class={[styles.group, styles.indicatorGroup]} data-filter-group>
            {renderHeading('具体指标')}
            <div
              ref={list}
              class={styles.indicators}
              role="group"
              aria-label="具体指标列表"
              tabindex={0}
            >
              {model.category.value.indicators.map(indicator => (
                <button
                  key={indicator.id}
                  type="button"
                  class={[styles.option, state.indicatorId === indicator.id && styles.selected]}
                  aria-pressed={state.indicatorId === indicator.id}
                  onClick={() => selectIndicator(indicator.id)}
                >
                  {indicator.name}（{indicator.unit}）
                </button>
              ))}
            </div>
          </section>
        </aside>
      );
    };
  }
});
