import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElPagination } from 'element-plus';
import { computed, defineComponent } from 'vue';
import { findCategoryPath } from '@/features/file-management/categories';
import { FileCategoryTree } from '@/features/file-management/components/FileCategoryTree';
import { FileFilterBar } from '@/features/file-management/components/FileFilterBar';
import { FileTable } from '@/features/file-management/components/FileTable';
import { FileUploadButton } from '@/features/file-management/components/FileUploadButton';
import { FileDownloadPanel } from '@/features/file-management/components/FileDownloadPanel';
import { FilePreviewDialog } from '@/features/file-management/components/FilePreviewDialog';
import { useFileDownloads } from '@/features/file-management/composables/useFileDownloads';
import { useFilePreview } from '@/features/file-management/composables/useFilePreview';
import { useFileList } from '@/features/file-management/composables/useFileList';
import styles from './FileManagementPage.module.scss';

/** 文件管理：分类树、筛选、传输、预览、表格与分页 */
export const FileManagementPage = defineComponent({
  name: 'FileManagementPage',
  setup() {
    const list = useFileList();
    const downloads = useFileDownloads();
    const preview = useFilePreview();
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
            <MxPanel title={title.value} description={parents.value}>
              {{
                default: () => [
                  <FileFilterBar
                    class={styles.filters}
                    model={list.filterForm}
                    onSearch={list.search}
                    onReset={list.resetFilters}
                  >
                    {{
                      extra: () => <FileUploadButton categoryId={list.categoryId.value} />
                    }}
                  </FileFilterBar>,
                  <FileDownloadPanel model={downloads} />,
                  <FileTable
                    files={list.files.value}
                    initialLoading={list.initialLoading.value}
                    refreshing={list.refreshing.value}
                    error={list.isError.value}
                    onRetry={() => void list.refresh()}
                    isDownloading={downloads.isDownloading}
                    onDownload={file => void downloads.start(file)}
                    onPreview={file => void preview.open(file)}
                  />,
                  <FilePreviewDialog model={preview} downloads={downloads} />
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
