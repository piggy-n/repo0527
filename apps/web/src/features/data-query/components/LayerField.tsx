import { ElMessage, ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { QueryLayer, QueryTopic } from '../topics';
import styles from './QueryForm.module.scss';

/** 页签里选图层的一行；地图上还留着上一次的结果时提醒重新查询（同旧页面） */
export const LayerField = defineComponent({
  name: 'LayerField',
  props: {
    topic: { type: Object as PropType<QueryTopic>, required: true },
    layer: { type: Object as PropType<QueryLayer | null>, default: null },
    /** 地图上有上一次的结果 */
    hasResult: { type: Boolean, default: false }
  },
  emits: {
    change: (table: string) => typeof table === 'string'
  },
  setup(props, { emit }) {
    const change = (table: string) => {
      if (props.hasResult) {
        ElMessage.warning({ message: '已切换图层，当前地图结果仍为上一次查询结果，请重新查询', grouping: true });
      }
      emit('change', table);
    };

    return () => (
      <div class={styles.field}>
        <span class={styles.label}>图层</span>
        <ElSelect
          class={styles.control}
          modelValue={props.layer?.table ?? ''}
          placeholder="请选择图层"
          onUpdate:modelValue={(value: string) => change(value)}
        >
          {props.topic.layers.map(layer => (
            <ElOption key={layer.table} value={layer.table} label={layer.label} />
          ))}
        </ElSelect>
      </div>
    );
  }
});
