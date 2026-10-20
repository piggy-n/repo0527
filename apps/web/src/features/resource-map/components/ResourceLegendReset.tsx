import { ElButton, ElPopconfirm } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import styles from './ResourceLegendReset.module.scss';

/** 确认气泡提供的操作，继续复用组件自身的关闭行为 */
type ConfirmActions = {
  confirm: (event: MouseEvent) => void;
  cancel: (event: MouseEvent) => void;
};

/** 图例固定底栏的恢复入口，可用时由页面提供给面板外壳 */
export const ResourceLegendReset = defineComponent({
  name: 'ResourceLegendReset',
  props: {
    symbols: { type: Object as PropType<ResourceSymbols>, required: true }
  },
  setup(props) {
    return () => (
      <div class={styles.actions} data-legend-reset>
        <ElPopconfirm
          title="恢复所有图层的默认样式？此操作会清除已保存的样式修改，包括未勾选图层。"
          width={256}
          hideIcon
          onConfirm={() => props.symbols.resetAll()}>
          {{
            reference: () => (
              <ElButton link type="primary" size="small">
                全部恢复默认
              </ElButton>
            ),
            actions: ({ confirm, cancel }: ConfirmActions) => (
              <div class={styles.confirmActions}>
                <ElButton size="small" onClick={cancel}>取消</ElButton>
                <ElButton size="small" type="primary" onClick={confirm}>恢复默认</ElButton>
              </div>
            )
          }}
        </ElPopconfirm>
      </div>
    );
  }
});
