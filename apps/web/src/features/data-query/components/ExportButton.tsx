import { Download } from '@element-plus/icons-vue';
import { ElButton, ElCheckbox, ElCheckboxGroup, ElMessage, ElPopover, ElTooltip } from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import type { ExportFormat } from '../api';
import type { QueryExport } from '../composables/useQueryExport';
import styles from './ExportButton.module.scss';

const FORMATS: readonly { readonly id: ExportFormat; readonly label: string }[] = [
  { id: 'excel', label: 'Excel' },
  { id: 'shp', label: 'SHP' },
  { id: 'gdb', label: 'GDB' }
];

/** 结果面板的导出：点按钮选格式（可多选），确定后下载；不能导出时按钮禁用，悬停看原因 */
export const ExportButton = defineComponent({
  name: 'ExportButton',
  props: {
    exporter: { type: Object as PropType<QueryExport>, required: true }
  },
  setup(props) {
    const open = ref(false);
    // 打开时从上一次确认的格式开始，取消不保存
    const pending = ref<ExportFormat[]>([]);

    const toggle = () => {
      if (!open.value) {
        pending.value = [...props.exporter.formats.value];
      }
      open.value = !open.value;
    };

    const confirm = () => {
      if (pending.value.length === 0) {
        ElMessage.warning({ message: '请至少选择一种导出格式', grouping: true });
        return;
      }
      open.value = false;
      void props.exporter.run(pending.value);
    };

    return () => {
      const blocked = props.exporter.blocked.value;
      const button = (
        <ElButton
          type="primary"
          size="small"
          icon={Download}
          loading={props.exporter.exporting.value}
          disabled={blocked !== null}
          onClick={toggle}
        >
          导出
        </ElButton>
      );
      if (blocked !== null) {
        // 禁用的按钮不触发提示，外面包一层接收悬停
        return (
          <ElTooltip content={blocked} placement="top">
            <span class={styles.trigger}>{button}</span>
          </ElTooltip>
        );
      }
      return (
        <ElPopover
          visible={open.value}
          placement="bottom-end"
          width={220}
          onUpdate:visible={(visible: boolean) => (open.value = visible)}
        >
          {{
            reference: () => <span class={styles.trigger}>{button}</span>,
            default: () => (
              <div class={styles.popover} data-export-popover>
                <strong class={styles.title}>导出格式</strong>
                <ElCheckboxGroup
                  class={styles.formats}
                  modelValue={pending.value}
                  onUpdate:modelValue={(value: (string | number | boolean)[]) =>
                    (pending.value = FORMATS.filter(format => value.includes(format.id)).map(({ id }) => id))
                  }
                >
                  {FORMATS.map(format => (
                    <ElCheckbox key={format.id} value={format.id}>
                      {format.label}
                    </ElCheckbox>
                  ))}
                </ElCheckboxGroup>
                <p class={styles.hint}>选多种格式时打包为一个 zip</p>
                <div class={styles.actions}>
                  <ElButton size="small" onClick={() => (open.value = false)}>
                    取消
                  </ElButton>
                  <ElButton size="small" type="primary" onClick={confirm}>
                    确定
                  </ElButton>
                </div>
              </div>
            )
          }}
        </ElPopover>
      );
    };
  }
});
