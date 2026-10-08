import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElPagination } from 'element-plus';
import { computed, defineComponent } from 'vue';
import { findCategoryPath } from '@/features/file-management/categories';
import { FileCategoryTree } from '@/features/file-management/components/FileCategoryTree';
import { FileFilterBar } from '@/features/file-management/components/FileFilterBar';
import { FileTable } from '@/features/file-management/components/FileTable';
import { useFileList } from '@/features/file-management/composables/useFileList';
import styles from './FileManagementPage.module.scss';

/** 文件管理：左侧分类树，右侧筛选、表格、分页；上传、下载、预览在阶段六迁移 */
export const FileManagementPage = defineComponent({
  name: 'FileManagementPage',
  setup() {
    const list = useFileList();
    const path = computed(() => findCategoryPath(list.categoryId.value));
    // 有重名的叶子（如两个"监测类"），所以标题后面显示上级路径
    const title = computed(() => path.value.at(-1)?.label);
    const parents = computed(() =>
      path.value
        .slice(0, -1)
        .map(node => node.label)
        .join(' / ')
    );

    return () => (
      <MxSplitLayout asideLabel="文件目录">
        {{
          aside: () => (
            <MxPanel title="文件目录">
              <FileCategoryTree modelValue={list.categoryId.value} onUpdate:modelValue={list.selectCategory} />
            </MxPanel>
          ),
          default: () => (
            <MxPanel title={title.value} description={parents.value} asideToggle>
              {{
                default: () => [
                  <FileFilterBar
                    class={styles.filters}
                    model={list.filterForm}
                    onSearch={list.search}
                    onReset={list.resetFilters}
                  />,
                  <FileTable
                    files={list.files.value}
                    initialLoading={list.initialLoading.value}
                    refreshing={list.refreshing.value}
                    error={list.isError.value}
                    onRetry={() => void list.refresh()}
                  />
                ],
                footer: () => (
                  <ElPagination
                    currentPage={list.pageNo.value}
                    pageSize={list.pageSize.value}
                    total={list.total.value}
                    pageSizes={[10, 20, 50, 100]}
                    layout="total, sizes, prev, pager, next, jumper"
                    onUpdate:current-page={(page: number) => {
                      list.pageNo.value = page;
                    }}
                    onUpdate:page-size={list.changePageSize}
                  />
                )
              }}
            </MxPanel>
          )
        }}
      </MxSplitLayout>
    );
  }
});
