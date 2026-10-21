import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElAlert, ElButton, ElDialog, ElMessage, ElOption, ElPagination, ElSelect } from 'element-plus';
import { computed, defineComponent } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useSessionStore } from '@/shared/auth/session-store';
import { ResourceDetailPanel } from '@/features/resource-management/components/ResourceDetailPanel';
import { ResourceDirectoryPanel } from '@/features/resource-management/components/ResourceDirectoryPanel';
import { ResourceFilterBar } from '@/features/resource-management/components/ResourceFilterBar';
import { ResourceTable } from '@/features/resource-management/components/ResourceTable';
import { useResourceList } from '@/features/resource-management/composables/useResourceList';
import { useResourceDetail } from '@/features/resource-management/composables/useResourceDetail';
import { useResourceStatus } from '@/features/resource-management/composables/useResourceStatus';
import type { ResourceRecord } from '@/features/resource-management/api';
import styles from './ResourceManagementPage.module.scss';

/** 管理员资源管理页：组合目录、筛选与列表，写入成功后由 Query 更新数据 */
export const ResourceManagementPage = defineComponent({
  name: 'ResourceManagementPage',
  setup() {
    const list = useResourceList();
    const { directoryQuery, yearsQuery } = list;
    const detail = useResourceDetail(() => directoryQuery.data.value ?? []);
    const status = useResourceStatus(list.resources, () => !list.isError.value && !list.refreshing.value);
    const session = useSessionStore();
    // 会话结束必须允许离开；正常导航先确认草稿，不能在保存中离开
    onBeforeRouteLeave(() => !session.isActive() || detail.allowLeave());
    const parent = computed(() => directoryQuery.data.value?.find(group =>
      group.children?.some(child => child.id === list.directoryId.value)));

    async function toggleStatus(row: ResourceRecord) {
      const result = await status.toggle(row.id);
      if (result?.kind === 'success') {
        ElMessage.success(`「${row.name}」已${result.enabled ? '启用' : '停用'}`);
      } else if (result?.kind === 'error') {
        ElMessage.error(result.message);
      }
    }

    return () => (
      <><MxSplitLayout asideLabel="资源目录">
        {{
          aside: () => (
            <MxPanel headerTone="muted" title="资源目录">
              <ResourceDirectoryPanel
                nodes={directoryQuery.data.value ?? []}
                selected={list.directoryId.value ?? undefined}
                loading={directoryQuery.isLoading.value}
                error={directoryQuery.isError.value}
                maintenanceDisabled={detail.editing.value || detail.pending.value}
                beforeSelect={async id => id === list.directoryId.value || await detail.close()}
                onSelect={list.selectDirectory}
                onRetry={() => void directoryQuery.refetch()}
              />
            </MxPanel>
          ),
          default: () => detail.target.value ? (
            <ResourceDetailPanel owner={detail} directories={directoryQuery.data.value ?? []} />
          ) : (
            <MxPanel
              headerTone="muted"
              title={list.selectedDirectory.value?.name ?? '资源列表'}
              description={parent.value?.name}
            >
              {{
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
                      <ElButton link type="primary" onClick={() => void yearsQuery.refetch()}>重试年份</ElButton>
                    </ElAlert>
                  ),
                  <ResourceTable
                    rows={list.resources.value}
                    selected={list.selectedDirectory.value !== null}
                    initialLoading={list.initialLoading.value}
                    refreshing={list.refreshing.value}
                    error={list.isError.value}
                    statusPending={id => status.pending.has(id)}
                    onToggle={row => void toggleStatus(row)}
                    onRetry={() => void list.refresh()}
                    onView={row => { if (list.directoryId.value) { detail.open(row, list.directoryId.value); } }}
                  />
                ],
                footer: () => (
                  <div class={styles.pagination}>
                    <span>共 {list.total.value} 条</span>
                    <ElSelect
                      class={styles.pageSize}
                      modelValue={list.pageSize.value}
                      onUpdate:modelValue={list.changePageSize}
                      aria-label="每页条数"
                    >
                      {[10, 20, 50, 100].map(size => <ElOption key={size} label={`${size} 条/页`} value={size} />)}
                    </ElSelect>
                    <ElPagination
                      currentPage={list.pageNum.value}
                      pageSize={list.pageSize.value}
                      total={list.total.value}
                      pagerCount={5}
                      layout="prev, pager, next"
                      onUpdate:current-page={(page: number) => { list.pageNum.value = page; }}
                    />
                  </div>
                )
              }}
            </MxPanel>
          )
        }}
      </MxSplitLayout>
        <ElDialog
          class={styles.confirmDialog}
          modelValue={detail.confirming.value}
          title="放弃未保存的修改？"
          appendToBody
          destroyOnClose
          closeOnClickModal={false}
          onUpdate:modelValue={open => { if (!open) { detail.answerDiscard(false); } }}
        >
          {{
            default: () => <p>离开后，本次对数据分类和字段名称的修改将不会保存。</p>,
            footer: () => <>
              <ElButton onClick={() => detail.answerDiscard(false)}>继续编辑</ElButton>
              <ElButton type="danger" onClick={() => detail.answerDiscard(true)}>放弃修改</ElButton>
            </>
          }}
        </ElDialog>
      </>
    );
  }
});
