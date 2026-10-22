import { Upload } from '@element-plus/icons-vue';
import { useMediaQuery } from '@vueuse/core';
import { COMPACT_MEDIA_QUERY, MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElButton, ElMessage, ElOption, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus';
import { computed, defineComponent, reactive, type Ref, ref } from 'vue';
import { DEFAULT_CATEGORY_ID, findCategoryPath } from '@/features/file-management/categories';
import { FileCategoryTree } from '@/features/file-management/components/FileCategoryTree';
import { FileDownloadPanel } from '@/features/file-management/components/FileDownloadPanel';
import { FileFilterBar } from '@/features/file-management/components/FileFilterBar';
import { FilePreviewDialog } from '@/features/file-management/components/FilePreviewDialog';
import { FileUploadDialog } from '@/features/file-management/components/FileUploadDialog';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import {
  canPreviewSample,
  type DownloadScene,
  type PreviewSample,
  type ReadScene,
  useDownloadSample,
  usePreviewSample
} from './useTransferPreview';
import { type PreviewResult, useUploadPreview } from './useUploadPreview';
import styles from './preview.module.scss';

function sample(id: string, name: string, year: string, tag = '综合'): PreviewSample {
  return { id, objectKey: id, name, year, tag, type: name.split('.').at(-1) ?? '' };
}

// 固定数据：长名称、不同年份和类型；不访问接口、不读取用户偏好
const longNameSample = sample('docx', '江苏省自然资源统一调查监测成果质量检查与汇交说明及附表（征求意见稿）.docx', '2026', '土地（耕地）');
const samples: PreviewSample[] = [
  sample('pdf', '自然资源调查技术规程（2026 年修订版）.pdf', '2026'),
  longNameSample,
  sample('image', '调查区域示意图.png', '2026'),
  sample('txt', '调查成果目录说明.txt', '2025'),
  sample('xlsx', '成果汇交清单.xlsx', '2026'),
  sample('zip', '成果附件.zip', '2025')
];

type ListState = 'normal' | 'loading' | 'error' | 'empty';

const DOWNLOAD_SCENES: [DownloadScene, string][] = [
  ['success', '成功'],
  ['unknown', '总量未知'],
  ['error', '失败'],
  ['waiting', '持续接收'],
  ['checking', '检查内容']
];
const READ_SCENES: [ReadScene, string][] = [
  ['success', '成功'],
  ['error', '读取失败一次'],
  ['render-error', '显示失败一次'],
  ['waiting', '持续加载']
];
const LIST_STATES: [ListState, string][] = [
  ['normal', '正常'],
  ['loading', '加载中'],
  ['error', '失败'],
  ['empty', '空列表']
];
const UPLOAD_RESULTS: [PreviewResult, string][] = [
  ['success', '成功'],
  ['error', '失败'],
  ['processing', '停在处理中'],
  ['unknown', '总量未知']
];
const PAGE_SIZE = 10;
const emptyFilters = () => ({ name: '', year: '', tag: '' });

function renderSceneSelect<T extends string>(label: string, model: Ref<T>, options: [T, string][], disabled = false) {
  return [
    <label>{label}</label>,
    <ElSelect
      modelValue={model.value}
      onUpdate:modelValue={(value: T) => {
        model.value = value;
      }}
      disabled={disabled}
      aria-label={label}
    >
      {options.map(([value, text]) => <ElOption key={value} value={value} label={text} />)}
    </ElSelect>
  ];
}

/** 文件管理的组件样例：用正式的上传弹窗、下载进度区和预览窗口，请求结果用固定数据模拟，不上传、不下载、不删除 */
export const DevFileManagementPage = defineComponent({
  name: 'DevFileManagementPage',
  setup() {
    const category = ref(DEFAULT_CATEGORY_ID);
    const filters = reactive(emptyFilters());
    const applied = ref(emptyFilters());
    const listState = ref<ListState>('normal');
    const records = ref<PreviewSample[]>([...samples]);
    const page = ref(1);
    const downloads = useDownloadSample();
    const preview = usePreviewSample();
    // 和正式页一样：窄屏时操作列随表格滚动，不盖住文件名
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);
    const path = computed(() => findCategoryPath(category.value));
    const rows = computed(() => {
      if (listState.value !== 'normal') {
        return [];
      }
      const { name, year, tag } = applied.value;
      return records.value.filter(file => {
        return file.name.includes(name) && (!year || file.year === year) && (!tag || file.tag === tag);
      });
    });
    // 模拟上传成功后把这一批放到列表最前，回到第一页
    const upload = useUploadPreview((files, fields) => {
      const added = files.map(file => sample(crypto.randomUUID(), file.name, fields.year, fields.tag));
      records.value = [...added, ...records.value];
      listState.value = 'normal';
      resetFilters();
    });

    function search() {
      applied.value = { ...filters, name: filters.name.trim() };
      page.value = 1;
    }

    function resetFilters() {
      Object.assign(filters, emptyFilters());
      search();
    }

    function addDemoFile() {
      upload.open(category.value);
      upload.addFiles([new File(['演示文件'], '江苏省自然资源统一调查监测成果质量检查与汇交说明（超长名称演示）.docx')]);
      upload.fields.tag = '综合';
    }

    function renderOptions() {
      return (
        <details class={styles.options}>
          <summary>演示选项（切换正常、加载、失败等状态）</summary>
          <div class={styles.controls}>
            {renderSceneSelect('下载结果', downloads.scene, DOWNLOAD_SCENES)}
            {renderSceneSelect('预览结果', preview.scene, READ_SCENES)}
            {renderSceneSelect('列表状态', listState, LIST_STATES)}
            {renderSceneSelect('上传结果', upload.result, UPLOAD_RESULTS, upload.busy.value)}
            <ElButton disabled={upload.locked.value} onClick={addDemoFile}>
              加入演示文件
            </ElButton>
            {upload.phase.value === 'processing' && <ElButton onClick={upload.finish}>模拟处理完成</ElButton>}
          </div>
        </details>
      );
    }

    function renderHeader() {
      return (
        <header class={styles.header}>
          <div>
            <h1>文件管理 · 组件样例</h1>
            <p class={styles.hint}>
              正式的上传弹窗、下载进度区和预览窗口；请求结果用固定数据模拟，不执行真实上传、下载或删除。
            </p>
            <p class={styles.hint}>
              预览用仓库里自建的样例文件（DOCX 真实渲染），支持 DOCX、PDF、TXT 和图片；其他格式只下载。
            </p>
          </div>
          <div class={styles.demoActions}>
            <ElButton size="small" onClick={() => downloads.showStates(longNameSample)}>
              载入全部下载状态
            </ElButton>
            <ElButton size="small" onClick={downloads.clearAll}>
              清空演示任务
            </ElButton>
          </div>
          {renderOptions()}
        </header>
      );
    }

    function renderActions({ row }: { row: PreviewSample }) {
      return (
        <div class={styles.actions}>
          {canPreviewSample(row) ? (
            <ElButton link type="primary" onClick={() => void preview.open(row)}>
              预览
            </ElButton>
          ) : (
            <span class={styles.hint}>仅下载</span>
          )}
          <ElButton
            link
            type="primary"
            disabled={downloads.isDownloading(row.id)}
            onClick={() => void downloads.start(row)}
          >
            {downloads.isDownloading(row.id) ? '下载中' : '下载'}
          </ElButton>
          <ElButton link type="danger" onClick={() => ElMessage.info('样例只展示删除入口，不删除文件')}>
            删除
          </ElButton>
        </div>
      );
    }

    function renderEmpty() {
      if (listState.value === 'loading') {
        return <TableSkeleton />;
      }
      if (listState.value === 'error') {
        return (
          <div>
            加载失败
            <ElButton link type="primary" onClick={() => (listState.value = 'normal')}>
              重试
            </ElButton>
          </div>
        );
      }
      return '暂无数据';
    }

    function renderTable() {
      const pageRows = rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE);
      return (
        <ElTable class={styles.table} data={pageRows} height="100%">
          {{
            default: () => [
              <ElTableColumn prop="year" label="年份" width="80" align="center" />,
              <ElTableColumn prop="name" label="文件名称" minWidth="260" showOverflowTooltip />,
              <ElTableColumn label="上传人" width="120">
                {{ default: () => '演示用户' }}
              </ElTableColumn>,
              <ElTableColumn prop="type" label="文件类型" width="100" align="center" />,
              <ElTableColumn label="业务类型标签" width="140">
                {{ default: ({ row }: { row: PreviewSample }) => <ElTag>{row.tag}</ElTag> }}
              </ElTableColumn>,
              <ElTableColumn label="更新时间" width="180">
                {{ default: () => '2026-10-21 10:30:00' }}
              </ElTableColumn>,
              <ElTableColumn label="备注" minWidth="120">
                {{ default: () => '演示数据' }}
              </ElTableColumn>,
              <ElTableColumn label="操作" width="180" align="center" fixed={compact.value ? false : 'right'}>
                {{ default: renderActions }}
              </ElTableColumn>
            ],
            empty: renderEmpty
          }}
        </ElTable>
      );
    }

    function renderMain() {
      return (
        <MxPanel
          headerTone="muted"
          title={path.value.at(-1)?.label}
          description={path.value.slice(0, -1).map(item => item.label).join(' / ')}
        >
          {{
            default: () => (
              <>
                <FileFilterBar class={styles.filters} model={filters} onSearch={search} onReset={resetFilters}>
                  {{
                    extra: () => (
                      <ElButton type="primary" icon={Upload} onClick={() => upload.open(category.value)}>
                        {upload.busy.value ? '查看上传进度' : '上传文件'}
                      </ElButton>
                    )
                  }}
                </FileFilterBar>
                <FileDownloadPanel model={downloads} />
                {renderTable()}
              </>
            ),
            footer: () => (
              <ElPagination
                total={rows.value.length}
                pageSize={PAGE_SIZE}
                currentPage={page.value}
                onUpdate:current-page={(value: number) => (page.value = value)}
                layout="total, prev, pager, next"
              />
            )
          }}
        </MxPanel>
      );
    }

    return () => (
      <main class={styles.page}>
        {renderHeader()}
        <div class={styles.workspace}>
          <MxSplitLayout asideLabel="文件目录">
            {{
              aside: () => (
                <MxPanel headerTone="muted" title="文件目录">
                  <FileCategoryTree
                    modelValue={category.value}
                    onUpdate:modelValue={value => (category.value = value)}
                  />
                </MxPanel>
              ),
              default: renderMain
            }}
          </MxSplitLayout>
        </div>
        <FileUploadDialog model={upload} onSubmit={upload.submit} />
        <FilePreviewDialog model={preview} downloads={downloads} />
      </main>
    );
  }
});
