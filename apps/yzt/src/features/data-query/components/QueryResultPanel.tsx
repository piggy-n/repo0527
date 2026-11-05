import { ArrowDown, ArrowUp, FullScreen, ScaleToOriginal } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElPagination, ElTable, ElTableColumn, vLoading } from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { TableLoadError } from '@/shared/table/TableLoadError';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import type { ResultRecord } from '../api';
import type { QueryExport } from '../composables/useQueryExport';
import { RESULT_PAGE_SIZE, type QueryResult } from '../composables/useQueryResult';
import type { ResultColumn } from '../topics';
import { ExportButton } from './ExportButton';
import styles from './QueryResultPanel.module.scss';

/** 结果面板的大小：收起只留标题栏，最大化占满所在的列（同旧页面的收起、展开、最大化） */
export type ResultView = 'collapsed' | 'expanded' | 'maximized';

// 面积这类数值保留几位小数；其余原样，空值交给表格的全局样式
function formatter({ prop, decimals }: ResultColumn) {
  if (decimals === undefined) {
    return undefined;
  }
  return (row: ResultRecord) => {
    const value = row[prop];
    if (typeof value === 'number') {
      return value.toFixed(decimals);
    }
    return typeof value === 'string' ? value : '';
  };
}

/** 查询结果（地图底部）：图层名、条数和导出，表格按图层的列显示，分页每页 100 条 */
export const QueryResultPanel = defineComponent({
  name: 'QueryResultPanel',
  directives: { loading: vLoading },
  props: {
    result: { type: Object as PropType<QueryResult>, required: true },
    exporter: { type: Object as PropType<QueryExport>, required: true },
    view: { type: String as PropType<ResultView>, required: true }
  },
  emits: {
    'update:view': (view: ResultView) => typeof view === 'string'
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'bottom');
    const showSkeleton = useDelayedFlag(() => props.result.initialLoading.value);
    const showMask = useDelayedFlag(() => props.result.refreshing.value);

    const renderEmpty = () => {
      if (showSkeleton.value) {
        return <TableSkeleton />;
      }
      if (props.result.initialLoading.value) {
        return '';
      }
      if (props.result.isError.value) {
        return <TableLoadError onRetry={() => void props.result.refresh()} />;
      }
      return '没有符合条件的数据';
    };

    const renderTable = () => {
      const columns = props.result.layer.value?.columns ?? [];
      return (
        <div class={styles.table}>
          <ElTable data={props.result.page.value?.list ?? []} height="100%" v-loading={showMask.value}>
            {{
              default: () =>
                columns.map(column => (
                  <ElTableColumn
                    key={column.prop}
                    prop={column.prop}
                    label={column.label}
                    minWidth={140}
                    sortable
                    showOverflowTooltip
                    formatter={formatter(column)}
                  />
                )),
              empty: renderEmpty
            }}
          </ElTable>
        </div>
      );
    };

    const renderPagination = () => (
      <ElPagination
        layout="total, prev, pager, next, jumper"
        total={props.result.total.value}
        pageSize={RESULT_PAGE_SIZE}
        currentPage={props.result.pageNum.value}
        onUpdate:current-page={(page: number) => props.result.setPage(page)}
      />
    );

    return () => {
      const { view } = props;
      const collapsed = view === 'collapsed';
      const loading = props.result.initialLoading.value;
      return (
        <div ref={element} class={[styles.root, styles[view]]} data-query-result>
          <MxPanel floating flush headerTone="muted" class={styles.panel}>
            {{
              header: () => (
                <div class={styles.header}>
                  <MxTitle level="panel">{`${props.result.layer.value?.label ?? ''}查询结果`}</MxTitle>
                  {!loading && !props.result.isError.value && (
                    <span class={styles.count}>{props.result.total.value} 条</span>
                  )}
                </div>
              ),
              actions: () => [
                <ExportButton key="export" exporter={props.exporter} />,
                <ElButton
                  key="collapse"
                  link
                  icon={collapsed ? ArrowUp : ArrowDown}
                  aria-label={collapsed ? '展开查询结果' : '收起查询结果'}
                  aria-expanded={!collapsed}
                  onClick={() => emit('update:view', collapsed ? 'expanded' : 'collapsed')}
                />,
                !collapsed && (
                  <ElButton
                    key="maximize"
                    link
                    icon={view === 'maximized' ? ScaleToOriginal : FullScreen}
                    aria-label={view === 'maximized' ? '还原查询结果' : '最大化查询结果'}
                    onClick={() => emit('update:view', view === 'maximized' ? 'expanded' : 'maximized')}
                  />
                )
              ],
              default: () => (collapsed ? null : renderTable()),
              footer: collapsed ? undefined : renderPagination
            }}
          </MxPanel>
        </div>
      );
    };
  }
});
