import { defineComponent, type PropType } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import type { City } from '../model';
import { FilterSection } from './FilterSection';
import styles from './filters.module.scss';

/** 行政区划：城市按钮逐个切换，标题右侧全选或清空 */
export const CityFilter = defineComponent({
  name: 'DashboardCityFilter',
  props: {
    title: { type: String, default: '行政区划' },
    cities: { type: Array as PropType<readonly City[]>, required: true },
    selected: { type: Array as PropType<readonly string[]>, required: true }
  },
  emits: {
    toggle: (_code: string) => true,
    set: (_codes: string[]) => true
  },
  setup(props, { emit }) {
    function toggleAll(): void {
      const allSelected = props.selected.length === props.cities.length;
      emit('set', allSelected ? [] : props.cities.map(city => city.code));
    }

    return () => (
      <FilterSection title={props.title}>
        {{
          extra: () => (
            <button type="button" class={styles.textButton} onClick={toggleAll}>
              {props.selected.length === props.cities.length ? '清空' : '全选'}
            </button>
          ),
          default: () => (
            <div class={styles.cities}>
              {props.cities.map(city => {
                const selected = props.selected.includes(city.code);
                return (
                  <button
                    key={city.code}
                    type="button"
                    class={[styles.city, selected && styles.selectedCity]}
                    aria-pressed={selected}
                    onClick={() => emit('toggle', city.code)}
                  >
                    {city.name}
                    {selected && (
                      <span class={styles.check}>
                        <SvgIcon name="check" size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )
        }}
      </FilterSection>
    );
  }
});
