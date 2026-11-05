import { Connection } from '@element-plus/icons-vue';
import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElAlert, ElButton, ElMessage, ElPagination } from 'element-plus';
import { computed, defineComponent } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import type { ResourceRecord } from '@/features/resource-management/api';
import { DataApplicationDialog } from '@/features/resource-management/components/DataApplicationDialog';
import { DataExtractionDialog } from '@/features/resource-management/components/DataExtractionDialog';
import { DiscardChangesDialog } from '@/features/resource-management/components/DiscardChangesDialog';
import { ResourceDetailPanel } from '@/features/resource-management/components/ResourceDetailPanel';
import { ResourceDirectoryPanel } from '@/features/resource-management/components/ResourceDirectoryPanel';
import { ResourceFilterBar } from '@/features/resource-management/components/ResourceFilterBar';
import { ResourceServiceDialogs } from '@/features/resource-management/components/ResourceServiceDialogs';
import { ResourceTable } from '@/features/resource-management/components/ResourceTable';
import { useDataApplication } from '@/features/resource-management/composables/useDataApplication';
import { useDataExtraction } from '@/features/resource-management/composables/useDataExtraction';
import { useLayerServices } from '@/features/resource-management/composables/useLayerServices';
import { useResourceDetail } from '@/features/resource-management/composables/useResourceDetail';
import { useResourceList } from '@/features/resource-management/composables/useResourceList';
import { useResourceStatus } from '@/features/resource-management/composables/useResourceStatus';
import { useSessionStore } from '@/shared/auth/session-store';
import styles from './ResourceManagementPage.module.scss';

/** 资源管理（管理员）：左侧资源目录；右侧是资源列表，查看时换成详情。写入成功后由查询缓存刷新数据 */
export const ResourceManagementPage = defineComponent({
  name: 'ResourceManagementPage',
  setup() {
    const list = useResourceList();
    const { directoryQuery, yearsQuery } = list;
    const detail = useResourceDetail(() => directoryQuery.data.value ?? []);
    // 列表出错或刷新中时显示的状态可能已过时，不能启停
    const status = useResourceStatus(list.resources, () => !list.isError.value && !list.refreshing.value);
    const services = useLayerServices();
    const extraction = useDataExtraction();
    const application = useDataApplication();
    const session = useSessionStore();
    // 离开页面前确认未保存的修改；会话已结束（退出、过期）时直接放行，回到登录页
    onBeforeRouteLeave(() => !session.isActive() || detail.allowLeave());
    // 当前目录所在的一级分组，作为标题的说明
    const parent = computed(() =>
      directoryQuery.data.value?.find(group => group.children?.some(child => child.id === list.directoryId.value))
    );
    // 编辑、保存、导入期间不能改目录
    const maintenanceDisabled = computed(
      () => detail.editing.value || detail.pending.value || detail.importer.pending.value
    );

    // 切换目录时先关闭详情；有未保存的修改时等用户确认
    async function beforeSelect(id: string): Promise<boolean> {
      return id === list.directoryId.value || detail.close();
    }

    function view(row: ResourceRecord) {
      if (list.directoryId.value) {
        detail.open(row, list.directoryId.value);
      }
    }

    async function toggleStatus(row: ResourceRecord) {
      const result = await status.toggle(row.id);
      if (result?.kind === 'success') {
        ElMessage.success(`「${row.name}」已${result.enabled ? '启用' : '停用'}`);
      } else if (result?.kind === 'error') {
        ElMessage.error(result.message);
      }
    }

    function renderList() {
      return (
        <MxPanel
          headerTone="muted"
          title={list.selectedDirectory.value?.name ?? '资源列表'}
          description={parent.value?.name}
        >
          {{
            actions: () => (
              <ElButton type="primary" icon={Connection} onClick={extraction.start}>
                自助取数
              </ElButton>
            ),
            default: () => [
              <ResourceFilterBar
                class={styles.filters}
                model={list.filterForm}
                years={yearsQuery.data.value ?? []}
                loadingYears={yearsQuery.isLoading.value}
                errorYears={yearsQuery.isError.value}
                disabled={!list.selectedDirectory.value}
                onSearch={list.search}
                onReset={list.resetFilters}
              />,
              yearsQuery.isError.value && (
                <ElAlert class={styles.notice} type="error" closable={false}>
                  年份加载失败
                  <ElButton link type="primary" onClick={() => void yearsQuery.refetch()}>
                    重试年份
                  </ElButton>
                </ElAlert>
              ),
              <ResourceTable
                rows={list.resources.value}
                selected={list.selectedDirectory.value !== null}
                initialLoading={list.initialLoading.value}
                refreshing={list.refreshing.value}
                error={list.isError.value}
                statusPending={id => status.pending.has(id)}
                serviceCount={services.count}
                onToggle={row => void toggleStatus(row)}
                onRetry={() => void list.refresh()}
                onView={view}
                onApply={application.start}
                onListServices={services.openList}
                onAddService={services.openForm}
              />
            ],
            footer: () => (
              <ElPagination
                class="pagination-wrap"
                currentPage={list.pageNum.value}
                pageSize={list.pageSize.value}
                total={list.total.value}
                pageSizes={[10, 20, 50, 100]}
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

    return () => (
      <>
        <MxSplitLayout asideLabel="资源目录">
          {{
            aside: () => (
              <MxPanel headerTone="muted" title="资源目录">
                <ResourceDirectoryPanel
                  nodes={directoryQuery.data.value ?? []}
                  selected={list.directoryId.value ?? undefined}
                  loading={directoryQuery.isLoading.value}
                  error={directoryQuery.isError.value}
                  maintenanceDisabled={maintenanceDisabled.value}
                  beforeSelect={beforeSelect}
                  onSelect={list.selectDirectory}
                  onRetry={() => void directoryQuery.refetch()}
                />
              </MxPanel>
            ),
            default: () =>
              detail.target.value ? (
                <ResourceDetailPanel owner={detail} directories={directoryQuery.data.value ?? []} />
              ) : (
                renderList()
              )
          }}
        </MxSplitLayout>
        <DiscardChangesDialog owner={detail} />
        <ResourceServiceDialogs owner={services} />
        <DataExtractionDialog owner={extraction} />
        <DataApplicationDialog owner={application} />
      </>
    );
  }
});
