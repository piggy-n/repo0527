import { Upload } from '@element-plus/icons-vue';
import { COMPACT_MEDIA_QUERY, MxPanel, MxSplitLayout } from '@yzt/ui';
import { useMediaQuery } from '@vueuse/core';
import { ElButton, ElMessage, ElOption, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus';
import { computed, defineComponent, reactive, ref } from 'vue';
import { DEFAULT_CATEGORY_ID, findCategoryPath } from '@/features/file-management/categories';
import { FileCategoryTree } from '@/features/file-management/components/FileCategoryTree';
import { FileFilterBar } from '@/features/file-management/components/FileFilterBar';
import { FileUploadDialog } from '@/features/file-management/components/FileUploadDialog';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import { useUploadPreview, type PreviewResult } from './useUploadPreview';
import { DocumentPreviewDialog, DownloadPreviewPanel } from './TransferPreview';
import {
  canPreviewSample, useDocumentPreview, useDownloadPreview,
  type DownloadScene, type PreviewSample, type ReadScene
} from './useTransferPreview';
import styles from './preview.module.scss';

// 固定数据保留长名称、不同年份和类型，不访问接口或读取用户偏好
const samples: PreviewSample[] = [
  { id: 'pdf', name: '自然资源调查技术规程（2026 年修订版）.pdf', year: '2026', type: 'pdf', tag: '综合' },
  { id: 'docx', name: '江苏省自然资源统一调查监测成果质量检查与汇交说明及附表（征求意见稿）.docx', year: '2026', type: 'docx', tag: '土地（耕地）' },
  { id: 'image', name: '调查区域示意图.png', year: '2026', type: 'png', tag: '综合' },
  { id: 'txt', name: '调查成果目录说明.txt', year: '2025', type: 'txt', tag: '综合' },
  { id: 'xlsx', name: '成果汇交清单.xlsx', year: '2026', type: 'xlsx', tag: '综合' },
  { id: 'zip', name: '成果附件.zip', year: '2025', type: 'zip', tag: '综合' }
];

/** 使用项目组件确认文件传输交互，固定数据不接业务接口 */
export const DevFileManagementPage = defineComponent({
  name: 'DevFileManagementPage',
  setup() {
    const category = ref(DEFAULT_CATEGORY_ID);
    const filters = reactive({ name: '', year: '', tag: '' });
    const applied = ref({ ...filters });
    const state = ref('normal');
    const records = ref([...samples]);
    const page = ref(1);
    const downloads = useDownloadPreview();
    const preview = useDocumentPreview();
    // 与正式页相同，窄屏操作列随表格滚动，不遮住文件名
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);
    const path = computed(() => findCategoryPath(category.value));
    const rows = computed(() => state.value !== 'normal' ? [] : records.value.filter(file =>
      file.name.includes(applied.value.name) && (!applied.value.year || file.year === applied.value.year)
      && (!applied.value.tag || file.tag === applied.value.tag)
    ));
    const upload = useUploadPreview((files, fields) => {
      records.value = [...files.map(file => ({
        id: crypto.randomUUID(),
        name: file.name, year: fields.year, type: file.name.split('.').at(-1) ?? '', tag: fields.tag
      })), ...records.value];
      state.value = 'normal';
      Object.assign(filters, { name: '', year: '', tag: '' });
      applied.value = { ...filters };
      page.value = 1;
    });
    const search = () => { applied.value = { ...filters, name: filters.name.trim() }; page.value = 1; };

    return () => <main class={styles.page}>
      <header class={styles.header}>
        <div>
          <h1>文件管理 · 交互调整稿</h1>
          <p class={styles.hint}>固定示例与模拟状态，不执行真实上传、下载或删除。DOCX/PDF 为排版示意，正式页使用实际文件。</p>
          <p class={styles.hint}>仅预览 DOCX、PDF 和 TXT；DOCX 的 100% 为原始尺寸，窄屏可横向滚动。图片与其他格式只下载。</p>
        </div>
        <div class={styles.demoActions}>
          <ElButton size="small" onClick={() => { if (samples[1]) { downloads.showStates(samples[1]); } }}>
            载入全部下载状态
          </ElButton>
          <ElButton size="small" onClick={downloads.clearAll}>清空演示任务</ElButton>
        </div>
        <details class={styles.options}>
          <summary>演示选项（切换正常、加载、失败等状态）</summary>
        <div class={styles.controls}>
          <label>下载结果</label>
          <ElSelect
            modelValue={downloads.scene.value}
            onUpdate:modelValue={(value: DownloadScene) => { downloads.scene.value = value; }}
            aria-label="下载结果"
          >
            {[
              ['success', '成功'], ['unknown', '总量未知'], ['error', '失败'], ['waiting', '持续接收'], ['checking', '检查内容']
            ].map(([value, label]) =>
              <ElOption key={value} value={value ?? ''} label={label} />
            )}
          </ElSelect>
          <label>预览结果</label>
          <ElSelect
            modelValue={preview.scene.value}
            onUpdate:modelValue={(value: ReadScene) => { preview.scene.value = value; }}
            aria-label="预览结果"
          >
            {[
              ['success', '成功'], ['error', '读取失败一次'], ['render-error', '显示失败一次'], ['waiting', '持续加载']
            ].map(([value, label]) => <ElOption key={value} value={value ?? ''} label={label} />)}
          </ElSelect>
          <label>列表状态</label>
          <ElSelect
            modelValue={state.value}
            onUpdate:modelValue={(value: string) => { state.value = value; }}
            aria-label="列表状态"
          >
            {[['normal', '正常'], ['loading', '加载中'], ['error', '失败'], ['empty', '空列表']].map(([value, label]) =>
              <ElOption key={value} value={value ?? ''} label={label} />
            )}
          </ElSelect>
          <label>上传结果</label>
          <ElSelect
            modelValue={upload.result.value}
            disabled={upload.busy.value}
            onUpdate:modelValue={(value: PreviewResult) => { upload.result.value = value; }}
            aria-label="上传结果"
          >
            {[['success', '成功'], ['error', '失败'], ['processing', '停在处理中'], ['unknown', '总量未知']].map(([value, label]) =>
              <ElOption key={value} value={value ?? ''} label={label} />
            )}
          </ElSelect>
          <ElButton
            disabled={upload.locked.value}
            onClick={() => {
              upload.open(category.value);
              upload.addFiles([new File(['演示文件'], '江苏省自然资源统一调查监测成果质量检查与汇交说明（超长名称演示）.docx')]);
              upload.fields.tag = '综合';
            }}
          >加入演示文件</ElButton>
          {upload.phase.value === 'processing' && <ElButton onClick={upload.finish}>模拟处理完成</ElButton>}
        </div>
        </details>
      </header>
      <div class={styles.workspace}>
        <MxSplitLayout asideLabel="文件目录">
          {{
            aside: () => <MxPanel headerTone="muted" title="文件目录">
              <FileCategoryTree
                modelValue={category.value}
                onUpdate:modelValue={value => { category.value = value; }}
              />
            </MxPanel>,
            default: () => <MxPanel
              headerTone="muted"
              title={path.value.at(-1)?.label}
              description={path.value.slice(0, -1).map(item => item.label).join(' / ')}
            >
              {{
                default: () => <>
                  <FileFilterBar
                    class={styles.filters}
                    model={filters}
                    onSearch={search}
                    onReset={() => { Object.assign(filters, { name: '', year: '', tag: '' }); search(); }}
                  >
                    {{ extra: () => <ElButton type="primary" icon={Upload} onClick={() => upload.open(category.value)}>
                      {upload.busy.value ? '查看上传进度' : '上传文件'}
                    </ElButton> }}
                  </FileFilterBar>
                  {upload.busy.value && <button class={styles.batch} onClick={() => upload.open(category.value)}>
                    {upload.phase.value === 'processing' ? '文件已发送，正在处理' : '正在上传文件'} · 点击查看
                  </button>}
                  <DownloadPreviewPanel model={downloads} />
                  <ElTable
                    class={styles.table}
                    data={rows.value.slice((page.value - 1) * 10, page.value * 10)}
                    height="100%"
                  >
                    {{
                      default: () => [
                        <ElTableColumn prop="year" label="年份" width="80" align="center" />,
                        <ElTableColumn prop="name" label="文件名称" minWidth="260" showOverflowTooltip />,
                        <ElTableColumn label="上传人" width="120">{{ default: () => '演示用户' }}</ElTableColumn>,
                        <ElTableColumn prop="type" label="文件类型" width="100" align="center" />,
                        <ElTableColumn label="业务类型标签" width="140">
                          {{ default: ({ row }: { row: PreviewSample }) => <ElTag>{row.tag}</ElTag> }}
                        </ElTableColumn>,
                        <ElTableColumn label="更新时间" width="180">
                          {{ default: () => '2026-10-21 10:30:00' }}
                        </ElTableColumn>,
                        <ElTableColumn label="备注" minWidth="120">{{ default: () => '演示数据' }}</ElTableColumn>,
                        <ElTableColumn label="操作" width="180" align="center" fixed={compact.value ? false : 'right'}>
                          {{ default: ({ row }: { row: PreviewSample }) => <div class={styles.actions}>
                            {canPreviewSample(row)
                              ? <ElButton link type="primary" onClick={() => preview.open(row)}>预览</ElButton>
                              : <span class={styles.hint}>仅下载</span>}
                            <ElButton
                              link
                              type="primary"
                              disabled={downloads.isReceiving(row.id)}
                              onClick={() => downloads.start(row)}
                            >
                              {downloads.isReceiving(row.id) ? '下载中' : '下载'}
                            </ElButton>
                            <ElButton link type="danger" onClick={() => ElMessage.info('设计稿仅展示删除入口，不删除文件')}>
                              删除
                            </ElButton>
                          </div> }}
                        </ElTableColumn>
                      ],
                      empty: () => state.value === 'loading' ? <TableSkeleton /> : state.value === 'error'
                        ? <div>加载失败
                          <ElButton link type="primary" onClick={() => { state.value = 'normal'; }}>重试</ElButton>
                        </div>
                        : '暂无数据'
                    }}
                  </ElTable>
                </>,
                footer: () => <ElPagination
                  total={rows.value.length}
                  pageSize={10}
                  currentPage={page.value}
                  onUpdate:current-page={(value: number) => { page.value = value; }}
                  layout="total, prev, pager, next"
                />
              }}
            </MxPanel>
          }}
        </MxSplitLayout>
      </div>
      <FileUploadDialog model={upload} onSubmit={upload.submit} />
      <DocumentPreviewDialog model={preview} downloads={downloads} />
    </main>;
  }
});
