import { ElButton } from 'element-plus';
import { defineComponent } from 'vue';
import styles from './TableLoadError.module.scss';

/** 表格加载失败：放在 ElTable 的 empty 插槽里，说明和重试在空状态区域里居中（见 docs/modules/table.md） */
export const TableLoadError = defineComponent({
  name: 'TableLoadError',
  props: {
    message: { type: String, default: '加载失败' },
    retryLabel: { type: String, default: '重试' }
  },
  emits: {
    retry: () => true
  },
  setup(props, { emit }) {
    return () => (
      <div class={styles.root}>
        {props.message}
        <ElButton link type="primary" onClick={() => emit('retry')}>
          {props.retryLabel}
        </ElButton>
      </div>
    );
  }
});
