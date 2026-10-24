import { ArrowDown, ArrowUp, Download, FullScreen, ScaleToOriginal } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import {
  ElButton, ElCheckbox, ElCheckboxGroup, ElDialog, ElEmpty, ElPagination, ElTable, ElTableColumn
} from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { DownloadPanel } from '@/shared/file-transfer/DownloadPanel';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import { PAGE_SIZE } from '../config';
import type { QueryRecord } from '../api';
import type { DataQuery } from '../composables/useDataQuery';
import { recordText, resultColumns } from '../result-fields';
import styles from './query.module.scss';

/** 结果区只读已提交条件，导出任务使用公共进度与取消入口 */
export const QueryResults = defineComponent({
  name: 'QueryResults',
  props: { model: { type: Object as PropType<DataQuery>, required: true } },
  setup(props) {
    const exportOpen = ref(false);
    const formats = ref<string[]>(['excel']);
    const columns = computed(() => resultColumns(
      props.model.submitted.value?.layer,
      props.model.result.value?.list ?? []
    ));
    watch(() => props.model.submitted.value, () => (exportOpen.value = false));

    function renderBody() {
      const model = props.model;
      if (!model.resultOpen.value) {
        return null;
      }
      if (model.pageQuery.isError.value) {
        return (
          <div class={styles.resultState} role="alert">
            <p>查询失败，请重试</p>
            <ElButton onClick={() => void model.pageQuery.refetch()}>重新查询</ElButton>
          </div>
        );
      }
      return (
        <ElTable
          data={model.result.value?.list ?? []}
          height="100%"
          highlightCurrentRow
          onRow-click={(row: QueryRecord) => (model.selected.value = row)}
        >
          {{
            default: () => [
              <ElTableColumn
                type="index"
                label="序号"
                width={64}
                index={(index: number) => (model.page.value - 1) * PAGE_SIZE + index + 1}
              />,
              ...columns.value.map(column => (
                <ElTableColumn key={column.code} label={column.label} minWidth={150} showOverflowTooltip>
                  {{ default: ({ row }: { row: QueryRecord }) => recordText(row[column.code]) }}
                </ElTableColumn>
              ))
            ],
            empty: () => model.busy.value
              ? <TableSkeleton />
              : <ElEmpty imageSize={48} description="没有符合条件的数据" />
          }}
        </ElTable>
      );
    }

    return () => {
      const model = props.model;
      const total = model.total.value;
      return (
        <>
          <MxPanel title="查询结果" class={styles.panel} headerTone="muted" floating flush>
            {{
              actions: () => [
                <ElButton
                  link
                  type="primary"
                  icon={Download}
                  disabled={!total || model.busy.value || model.pageQuery.isError.value}
                  onClick={() => (exportOpen.value = true)}
                >
                  导出
                </ElButton>,
                <ElButton
                  link
                  icon={model.resultOpen.value ? ArrowDown : ArrowUp}
                  aria-label={model.resultOpen.value ? '收起查询结果' : '展开查询结果'}
                  onClick={() => {
                    model.resultOpen.value = !model.resultOpen.value;
                    model.maximized.value = false;
                  }}
                />,
                model.resultOpen.value && (
                  <ElButton
                    link
                    icon={model.maximized.value ? ScaleToOriginal : FullScreen}
                    aria-label={model.maximized.value ? '恢复结果面板' : '最大化查询结果'}
                    onClick={() => (model.maximized.value = !model.maximized.value)}
                  />
                )
              ],
              subheader: model.resultOpen.value ? () => (
                <>
                  <div class={styles.resultSummary}>
                    <span>{model.summary.value || '尚未查询'}</span>
                    {model.changed.value && <span class={styles.changed}>条件已修改，请重新查询</span>}
                    {model.shapesQuery.isError.value && (
                      <span class={styles.error}>
                        地图范围结果加载失败
                        <ElButton link onClick={() => void model.shapesQuery.refetch()}>重试</ElButton>
                      </span>
                    )}
                  </div>
                  <DownloadPanel model={model.downloads} />
                </>
              ) : undefined,
              default: renderBody,
              footer: model.resultOpen.value && model.submitted.value ? () => (
                <div class={styles.pagination}>
                  <ElPagination
                    currentPage={model.page.value}
                    pageSize={PAGE_SIZE}
                    total={total}
                    layout="total, prev, pager, next"
                    pagerCount={5}
                    onUpdate:current-page={value => (model.page.value = value)}
                  />
                </div>
              ) : undefined
            }}
          </MxPanel>
          <ElDialog
            class="dialog-panel-header"
            title="导出查询结果"
            width="min(420px, calc(100vw - 32px))"
            modelValue={exportOpen.value}
            onUpdate:modelValue={value => (exportOpen.value = value)}
          >
            {{
              header: () => <MxTitle level="panel">导出查询结果</MxTitle>,
              default: () => (
                <>
                  <p>{model.summary.value}</p>
                  <ElCheckboxGroup
                    modelValue={formats.value}
                    onUpdate:modelValue={value => (formats.value = value as string[])}
                  >
                    <ElCheckbox value="excel">Excel</ElCheckbox>
                    <ElCheckbox value="shp">SHP</ElCheckbox>
                    <ElCheckbox value="gdb">GDB</ElCheckbox>
                  </ElCheckboxGroup>
                  <p class={styles.hint}>导出本次查询的全部 {total} 条结果，不采用尚未提交的新条件。</p>
                </>
              ),
              footer: () => [
                <ElButton onClick={() => (exportOpen.value = false)}>取消</ElButton>,
                <ElButton
                  type="primary"
                  icon={Download}
                  disabled={!formats.value.length || !total}
                  onClick={() => {
                    model.exportResults(formats.value);
                    exportOpen.value = false;
                  }}
                >导出</ElButton>
              ]
            }}
          </ElDialog>
        </>
      );
    };
  }
});
