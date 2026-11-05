import { MxPanel } from '@yzt/ui';
import { ElMessage, ElPagination } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { Application } from '../api';
import { useApplicationDownloads } from '../composables/useApplicationDownloads';
import { useApplicationList } from '../composables/useApplicationList';
import type { ApplicationReviewOwner } from '../composables/useApplicationReview';
import { useSeedApplication } from '../queries';
import { ApplicationDialog } from './ApplicationDialog';
import { ApplicationFilterBar } from './ApplicationFilterBar';
import styles from './ApplicationListPanel.module.scss';
import { ApplicationTable } from './ApplicationTable';

const PAGE_SIZES = [10, 20, 50, 100];

/**
 * 申请的列表面板：筛选、表格、分页，申请的详情与下载。审核和申请人的列表共用，叫法和操作由使用方按用途传入，这里不判断角色（ADR 0092）。
 * 打开的申请是路由的查询参数（ADR 0092），由页面负责：owner 跟着它变，这里只发出 open、close
 */
export const ApplicationListPanel = defineComponent({
  name: 'ApplicationListPanel',
  props: {
    title: { type: String, required: true },
    owner: { type: Object as PropType<ApplicationReviewOwner>, required: true },
    // 下面三项不传时用筛选栏、表格和弹窗的默认
    nameLabel: String,
    showApplicant: { type: Boolean, default: true },
    openLabel: Function as PropType<(application: Application) => string>
  },
  emits: {
    open: (_id: string) => true,
    close: () => true
  },
  setup(props, { emit }) {
    const list = useApplicationList();
    const seed = useSeedApplication();
    const downloads = useApplicationDownloads();

    function open(application: Application) {
      seed(application);
      emit('open', application.id);
    }

    async function download(application: Application) {
      const result = await downloads.start(application);
      if (result?.kind === 'done') {
        ElMessage.success('已交给浏览器下载');
      } else if (result?.kind === 'error') {
        ElMessage.error(result.message);
      }
    }

    return () => (
      <MxPanel headerTone="muted" title={props.title}>
        {{
          default: () => [
            <ApplicationFilterBar
              class={styles.filters}
              model={list.filterForm}
              nameLabel={props.nameLabel}
              onSearch={list.search}
              onReset={list.resetFilters}
            />,
            <ApplicationTable
              applications={list.applications.value}
              firstSerial={(list.pageNum.value - 1) * list.pageSize.value + 1}
              initialLoading={list.initialLoading.value}
              refreshing={list.refreshing.value}
              error={list.isError.value}
              nameLabel={props.nameLabel}
              showApplicant={props.showApplicant}
              openLabel={props.openLabel}
              onRetry={() => void list.refresh()}
              onOpen={open}
              downloads={downloads}
              onDownload={application => void download(application)}
            />,
            <ApplicationDialog
              owner={props.owner}
              downloads={downloads}
              showApplicant={props.showApplicant}
              onClose={() => emit('close')}
              onDownload={application => void download(application)}
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
