import { Close } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { DataQuery } from '../composables/useDataQuery';
import type { useQueryDetail } from '../composables/useQueryDetail';
import { recordText, resultColumns } from '../result-fields';
import styles from './query.module.scss';

// 空值和表格的全局样式一致，显示"-"
const EMPTY_VALUE = '-';

/** 选中记录的完整属性；定位失败不隐藏已取得的属性 */
export const QueryDetail = defineComponent({
  name: 'QueryDetail',
  props: {
    model: { type: Object as PropType<DataQuery>, required: true },
    detail: { type: Object as PropType<ReturnType<typeof useQueryDetail>>, required: true }
  },
  setup(props) {
    return () => {
      const record = props.model.selected.value;
      if (!record) {
        return null;
      }
      return (
        <MxPanel title="结果详情" class={styles.panel} headerTone="muted" floating>
          {{
            actions: () => (
              <ElButton link icon={Close} aria-label="关闭结果详情" onClick={() => (props.model.selected.value = null)} />
            ),
            default: () => (
              <>
                {props.detail.geometryQuery.isError.value && (
                  <p class={styles.hint} role="status">
                    {props.detail.geometryQuery.error.value?.message ?? '定位失败'}
                    <ElButton link onClick={props.detail.retry}>重试定位</ElButton>
                  </p>
                )}
                <dl class={styles.attributes}>
                  {resultColumns(props.model.submitted.value?.layer, [record]).map(column => (
                    <div key={column.code}>
                      <dt>{column.label}</dt>
                      <dd>{recordText(record[column.code]) || EMPTY_VALUE}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )
          }}
        </MxPanel>
      );
    };
  }
});
