import { MxPanel } from '@yzt/ui';
import { ElPagination } from 'element-plus';
import { defineComponent } from 'vue';
import { ApplicationFilterBar } from '@/features/data-application/components/ApplicationFilterBar';
import { ApplicationTable } from '@/features/data-application/components/ApplicationTable';
import { useApplicationList } from '@/features/data-application/composables/useApplicationList';
import styles from './SystemManagementPage.module.scss';

const PAGE_SIZES = [10, 20, 50, 100];

/** 资源审核栏目：筛选、表格、分页；只在这个栏目显示时存在，切到统计报表时不再请求申请列表 */
export const AuditSection = defineComponent({
  name: 'AuditSection',
  setup() {
    const list = useApplicationList();

    return () => (
      <MxPanel headerTone="muted" title="资源审核">
        {{
          default: () => [
            <ApplicationFilterBar
              class={styles.filters}
              model={list.filterForm}
              onSearch={list.search}
              onReset={list.resetFilters}
            />,
            <ApplicationTable
              applications={list.applications.value}
              firstSerial={(list.pageNum.value - 1) * list.pageSize.value + 1}
              initialLoading={list.initialLoading.value}
              refreshing={list.refreshing.value}
              error={list.isError.value}
              onRetry={() => void list.refresh()}
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
