import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElAlert, ElButton, ElOption, ElPagination, ElSelect } from 'element-plus';
import { computed, defineComponent } from 'vue';
import { ResourceDirectoryPanel } from '@/features/resource-management/components/ResourceDirectoryPanel';
import { ResourceFilterBar } from '@/features/resource-management/components/ResourceFilterBar';
import { ResourceTable } from '@/features/resource-management/components/ResourceTable';
import { useResourceList } from '@/features/resource-management/composables/useResourceList';
import styles from './ResourceManagementPage.module.scss';

/** 管理员资源管理页：组合目录、筛选与列表，写入成功后由 Query 更新数据 */
export const ResourceManagementPage = defineComponent({
  name: 'ResourceManagementPage',
  setup() {
    const list = useResourceList();
    const { directoryQuery, yearsQuery } = list;
    const parent = computed(() => directoryQuery.data.value?.find(group =>
      group.children?.some(child => child.id === list.directoryId.value)));

    return () => (
      <MxSplitLayout asideLabel="资源目录">
        {{
          aside: () => (
            <MxPanel class={styles.panel} title="资源目录">
              <ResourceDirectoryPanel
                nodes={directoryQuery.data.value ?? []}
                selected={list.directoryId.value ?? undefined}
                loading={directoryQuery.isLoading.value}
                error={directoryQuery.isError.value}
                onSelect={list.selectDirectory}
                onRetry={() => void directoryQuery.refetch()}
              />
            </MxPanel>
          ),
          default: () => (
            <MxPanel
              class={styles.panel}
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
                    onRetry={() => void list.refresh()}
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
    );
  }
});
