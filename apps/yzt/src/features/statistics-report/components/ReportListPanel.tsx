import { MxPanel } from '@mx/ui';
import { ElMessage, ElPagination } from 'element-plus';
import { defineComponent } from 'vue';
import type { Report } from '../api';
import { useReportDownloads } from '../composables/useReportDownloads';
import { useReportList } from '../composables/useReportList';
import { ReportFilterBar } from './ReportFilterBar';
import styles from './ReportListPanel.module.scss';
import { ReportTable } from './ReportTable';

const PAGE_SIZES = [10, 20, 50, 100];

/** 统计报表的列表面板：按名称筛选、表格、分页与下载；系统管理和数据下载共用，只在这个栏目显示时存在 */
export const ReportListPanel = defineComponent({
  name: 'ReportListPanel',
  setup() {
    const list = useReportList();
    const downloads = useReportDownloads();

    async function download(report: Report) {
      const result = await downloads.start(report);
      if (result?.kind === 'done') {
        ElMessage.success('已交给浏览器下载');
      } else if (result?.kind === 'error') {
        ElMessage.error(result.message);
      }
    }

    return () => (
      <MxPanel headerTone="muted" title="统计报表">
        {{
          default: () => [
            <ReportFilterBar
              class={styles.filters}
              model={list.filterForm}
              onSearch={list.search}
              onReset={list.resetFilters}
            />,
            <ReportTable
              reports={list.reports.value}
              firstSerial={(list.pageNum.value - 1) * list.pageSize.value + 1}
              initialLoading={list.initialLoading.value}
              refreshing={list.refreshing.value}
              error={list.isError.value}
              onRetry={() => void list.refresh()}
              downloads={downloads}
              onDownload={report => void download(report)}
            />
          ],
          footer: () => (
            <ElPagination
              class="pagination-wrap"
              currentPage={list.pageNum.value}
              pageSize={list.pageSize.value}
              total={list.total.value}
              pageSizes={PAGE_SIZES}
              pagerCount={5}
              layout="total, sizes, prev, pager, next, jumper"
              onUpdate:current-page={(page: number) => {
                list.pageNum.value = page;
              }}
              onUpdate:page-size={list.changePageSize}
            />
          )
        }}
      </MxPanel>
    );
  }
});
