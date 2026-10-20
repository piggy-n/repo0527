import { ElButton, ElPopconfirm } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { ResourceSymbols } from '../composables/useResourceSymbols';

/** 图例固定底栏的恢复入口，可用时由页面提供给面板外壳 */
export const ResourceLegendReset = defineComponent({
  name: 'ResourceLegendReset',
  props: {
    symbols: { type: Object as PropType<ResourceSymbols>, required: true }
  },
  setup(props) {
    return () => (
      <ElPopconfirm title="恢复全部资源的默认符号？" onConfirm={() => props.symbols.resetAll()}>
        {{
          reference: () => (
            <ElButton link type="primary" size="small">
              全部恢复默认
            </ElButton>
          )
        }}
      </ElPopconfirm>
    );
  }
});
