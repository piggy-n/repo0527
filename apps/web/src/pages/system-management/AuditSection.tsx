import { MxPanel } from '@yzt/ui';
import { ElPagination } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useRouter } from 'vue-router';
import type { Application } from '@/features/data-application/api';
import { ApplicationDialog } from '@/features/data-application/components/ApplicationDialog';
import { ApplicationFilterBar } from '@/features/data-application/components/ApplicationFilterBar';
import { ApplicationTable } from '@/features/data-application/components/ApplicationTable';
import { useApplicationList } from '@/features/data-application/composables/useApplicationList';
import { useApplicationReview } from '@/features/data-application/composables/useApplicationReview';
import { useSeedApplication } from '@/features/data-application/queries';
import { navigate } from '@/shared/router/navigate';
import { RouteName } from '@/shared/router/route-names';
import styles from './SystemManagementPage.module.scss';

const PAGE_SIZES = [10, 20, 50, 100];

/**
 * 资源审核栏目：筛选、表格、分页与申请的详情和审核；只在这个栏目显示时存在，切到统计报表时不再请求申请列表。
 * 打开的申请是路由的查询参数 apply（ADR 0091）：打开时 push，浏览器的后退能关掉弹窗；关闭时 replace 去掉它
 */
export const AuditSection = defineComponent({
  name: 'AuditSection',
  props: {
    applyId: { type: String as PropType<string | null>, default: null }
  },
  setup(props) {
    const router = useRouter();
    const list = useApplicationList();
    const review = useApplicationReview(() => props.applyId);
    const seed = useSeedApplication();

    function open(application: Application) {
      seed(application);
      void navigate(router, { name: RouteName.systemManagement, query: { apply: application.id } });
    }

    function close() {
      void navigate(router, { name: RouteName.systemManagement, replace: true });
    }

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
              onOpen={open}
            />,
            <ApplicationDialog owner={review} onClose={close} />
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
