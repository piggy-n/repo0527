import { ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import styles from './BatchYearSelect.module.scss';

/**
 * 批量设置年份（ADR 0052 第 2 节）：选完就执行，选择框回显最后一次批量设置的年份（ADR 0116）；
 * 还没有数据的 2020、2021 选了图层不变，不提示。目录还没到、没有可选的年份时不显示
 */
export const BatchYearSelect = defineComponent({
  name: 'BatchYearSelect',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true }
  },
  setup(props) {
    return () =>
      props.layers.batchYears.value.length > 0 && (
        <ElSelect
          class={styles.batch}
          modelValue={props.layers.batchYear.value ?? undefined}
          placeholder="批量设置年份"
          aria-label="批量设置年份"
          onUpdate:modelValue={(year: number) => props.layers.setYearForAll(year)}
        >
          {props.layers.batchYears.value.map(year => (
            <ElOption key={year} label={`${year} 年`} value={year}>
              {/* 再点回显着的那一年也执行，把单独改过的资源切回来：ElSelect 选中的值没变时不发 update:modelValue */}
              <span
                class={styles.option}
                onClick={() => {
                  if (year === props.layers.batchYear.value) {
                    props.layers.setYearForAll(year);
                  }
                }}
              >
                {year} 年
              </span>
            </ElOption>
          ))}
        </ElSelect>
      );
  }
});
