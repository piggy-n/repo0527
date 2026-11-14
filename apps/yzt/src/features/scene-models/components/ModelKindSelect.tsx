import { ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { SceneModel } from '../catalog';
import { modelKindOptions } from '../layer-panel';
import styles from './ModelKindSelect.module.scss';

// "全部类型"的值：ElSelect 把 null、空串当作没选、显示成灰色的占位，这里要像选中的值一样显示
const ALL = 'all';

/**
 * 三维里资源目录"三维模型"页的类型筛选（ADR 0157，用户 2026-11-15 选的方案乙），放在二维资源页"筛选年份"的位置：
 * 全部类型或其中一种，只列清单里有的类型；选中的类型由页面持有，不持久化
 */
export const ModelKindSelect = defineComponent({
  name: 'ModelKindSelect',
  props: {
    models: { type: Array as PropType<readonly SceneModel[]>, required: true },
    /** 只看这一类；null 是全部类型 */
    kind: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    'update:kind': (kind: string | null) => kind === null || typeof kind === 'string'
  },
  setup(props, { emit }) {
    return () => (
      <ElSelect
        class={styles.kind}
        modelValue={props.kind ?? ALL}
        aria-label="按类型筛选模型"
        onUpdate:modelValue={(value: string) => emit('update:kind', value === ALL ? null : value)}
      >
        <ElOption label="全部类型" value={ALL} />
        {modelKindOptions(props.models).map(({ kind, label }) => (
          <ElOption key={kind} label={label} value={kind} />
        ))}
      </ElSelect>
    );
  }
});
