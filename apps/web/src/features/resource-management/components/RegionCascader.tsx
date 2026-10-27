import { ElCascader } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { REGION_OPTIONS } from '../data-request';
import styles from './RegionCascader.module.scss';

/** 全省、市、区县三级的区划选择，任一级都可以选；值是从全省开始的代码路径 */
export const RegionCascader = defineComponent({
  name: 'RegionCascader',
  props: {
    modelValue: { type: Array as PropType<string[]>, required: true },
    placeholder: String
  },
  emits: {
    'update:modelValue': (_value: string[]) => true
  },
  setup(props, { emit }) {
    return () => (
      <ElCascader
        class={styles.cascader}
        modelValue={props.modelValue}
        onUpdate:modelValue={value => emit('update:modelValue', Array.isArray(value) ? value.map(String) : [])}
        options={REGION_OPTIONS}
        props={{ checkStrictly: true }}
        popperClass={styles.popup}
        placeholder={props.placeholder}
        clearable
      />
    );
  }
});
