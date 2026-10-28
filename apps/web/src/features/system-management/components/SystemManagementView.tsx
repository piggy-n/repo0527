import { Document, Tickets } from '@element-plus/icons-vue';
import { useMediaQuery } from '@vueuse/core';
import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElButton, ElIcon, ElMenu, ElMenuItem, ElPagination } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { DownloadPanel } from '@/shared/file-transfer/DownloadPanel';
import type { useDownloads } from '@/shared/file-transfer/useDownloads';
import type { SystemDownloadTarget, SystemRow, SystemSection } from '../api';
import type { useSystemList } from '../composables/useSystemList';
import { canDownload, downloadTarget } from '../presentation';
import { ApplicationAuditDialog, type ApplicationAuditModel } from './ApplicationAuditDialog';
import { SystemFilters } from './SystemFilters';
import { SystemTable } from './SystemTable';
import styles from './system-management.module.scss';

/** 正式页面与本地预览共用布局和控件，数据及操作由各自拥有者提供 */
export const SystemManagementView = defineComponent({
  name: 'SystemManagementView',
  props: {
    section: { type: String as PropType<SystemSection>, required: true },
    list: { type: Object as PropType<ReturnType<typeof useSystemList>>, required: true },
    audit: { type: Object as PropType<ApplicationAuditModel>, required: true },
    downloads: { type: Object as PropType<ReturnType<typeof useDownloads<SystemDownloadTarget>>>, required: true }
  },
  emits: { select: (_section: SystemSection) => true },
  setup(props, { emit }) {
    const narrow = useMediaQuery('(max-width: 767px)');

    function download(row: SystemRow) {
      if (canDownload(row)) {
        void props.downloads.start(downloadTarget(row));
      }
    }

    return () => {
      const { list, downloads, audit } = props;
      return (
        <>
          <MxSplitLayout asideType="menu" asideLabel="系统管理">
            {{
              aside: () => (
                <MxPanel flush>
                  <ElMenu
                    class="menu-panel"
                    defaultActive={props.section}
                    onSelect={value => emit('select', value === 'reports' ? 'reports' : 'audit')}
                  >
                    <ElMenuItem index="audit">
                      <ElIcon>
                        <Tickets />
                      </ElIcon>
                      资源审核
                    </ElMenuItem>
                    <ElMenuItem index="reports">
                      <ElIcon>
                        <Document />
                      </ElIcon>
                      统计报表
                    </ElMenuItem>
                  </ElMenu>
                </MxPanel>
              ),
              default: () => (
                <MxPanel title={props.section === 'audit' ? '资源审核' : '统计报表'} headerTone="muted">
                  {{
                    default: () => [
                      <div class={styles.filters}>
                        <SystemFilters
                          form={list.form}
                          audit={props.section === 'audit'}
                          onSearch={list.search}
                          onReset={list.reset}
                        />
                      </div>,
                      <DownloadPanel model={downloads} />,
                      list.isError.value && list.rows.value.length > 0 && (
                        <div class={styles.refreshError} role="alert">
                          刷新失败，当前显示上次的数据
                          <ElButton link type="primary" onClick={list.refresh}>
                            重试
                          </ElButton>
                        </div>
                      ),
                      <SystemTable
                        section={props.section}
                        rows={list.rows.value}
                        offset={(list.pageNum.value - 1) * list.pageSize.value}
                        initialLoading={list.initialLoading.value}
                        refreshing={list.refreshing.value}
                        failed={list.isError.value}
                        isDownloading={downloads.isDownloading}
                        onOpen={audit.open}
                        onDownload={download}
                        onRetry={list.refresh}
                      />
                    ],
                    footer: () => (
                      <ElPagination
                        currentPage={list.pageNum.value}
                        pageSize={list.pageSize.value}
                        pageSizes={[20, 50, 100]}
                        total={list.total.value}
                        layout={narrow.value ? 'total, prev, pager, next' : 'total, sizes, prev, pager, next, jumper'}
                        pagerCount={5}
                        onUpdate:current-page={(value: number) => (list.pageNum.value = value)}
                        onUpdate:page-size={list.changePageSize}
                      />
                    )
                  }}
                </MxPanel>
              )
            }}
          </MxSplitLayout>
          <ApplicationAuditDialog model={audit} />
        </>
      );
    };
  }
});
