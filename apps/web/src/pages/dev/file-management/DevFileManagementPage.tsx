import { Upload } from '@element-plus/icons-vue';
import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElButton, ElOption, ElPagination, ElSelect, ElTable, ElTableColumn, ElTag } from 'element-plus';
import { computed, defineComponent, reactive, ref } from 'vue';
import { DEFAULT_CATEGORY_ID, findCategoryPath } from '@/features/file-management/categories';
import { FileCategoryTree } from '@/features/file-management/components/FileCategoryTree';
import { FileFilterBar } from '@/features/file-management/components/FileFilterBar';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import { UploadPreviewDialog } from './UploadPreviewDialog';
import { useUploadPreview, type PreviewResult } from './useUploadPreview';
import styles from './preview.module.scss';

// 固定数据保留长名称、不同年份和类型，不访问接口或读取用户偏好
const samples = [
  { name: '自然资源调查技术规程（2026 年修订版）.pdf', year: '2026', type: 'pdf', tag: '综合' },
  { name: '江苏省自然资源统一调查监测成果质量检查与汇交说明及附表（征求意见稿）.docx', year: '2026', type: 'docx', tag: '土地（耕地）' },
  { name: '调查成果目录说明.txt', year: '2025', type: 'txt', tag: '综合' }
];
type Sample = typeof samples[number];

/** 第一轮原型只确认上传交互；下载和预览后续单独补充 */
export const DevFileManagementPage = defineComponent({
  name: 'DevFileManagementPage',
  setup() {
    const category = ref(DEFAULT_CATEGORY_ID);
    const filters = reactive({ name: '', year: '', tag: '' });
    const applied = ref({ ...filters });
    const state = ref('normal');
    const records = ref([...samples]);
    const page = ref(1);
    const path = computed(() => findCategoryPath(category.value));
    const rows = computed(() => state.value !== 'normal' ? [] : records.value.filter(file =>
      file.name.includes(applied.value.name) && (!applied.value.year || file.year === applied.value.year)
      && (!applied.value.tag || file.tag === applied.value.tag)
    ));
    const upload = useUploadPreview((files, fields) => {
      records.value = [...files.map(file => ({
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
          <h1>文件管理 · 上传交互原型</h1>
          <p class={styles.hint}>真实组件与项目主题；固定数据与模拟进度，不向服务器上传文件。本轮验收上传，下载与预览待下一步。</p>
        </div>
        <div class={styles.controls}>
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
              upload.addFiles([new File(['演示文件'], '江苏省自然资源统一调查监测成果质量检查与汇交说明（超长名称演示）.docx')]);
              upload.fields.tag = '综合';
              upload.open(category.value);
            }}
          >加入演示文件</ElButton>
          {upload.phase.value === 'processing' && <ElButton onClick={upload.finish}>模拟处理完成</ElButton>}
        </div>
      </header>
      <div class={styles.workspace}>
        <MxSplitLayout asideLabel="文件目录">
          {{
            aside: () => <MxPanel title="文件目录">
              <FileCategoryTree
                modelValue={category.value}
                onUpdate:modelValue={value => { category.value = value; }}
              />
            </MxPanel>,
            default: () => <MxPanel
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
                      {upload.busy.value ? '查看上传进度' : '上传文档'}
                    </ElButton> }}
                  </FileFilterBar>
                  {upload.busy.value && <button class={styles.batch} onClick={() => upload.open(category.value)}>
                    {upload.phase.value === 'processing' ? '文件已发送，正在处理' : '正在上传文件'} · 点击查看
                  </button>}
                  <ElTable
                    class={styles.table}
                    data={rows.value.slice((page.value - 1) * 10, page.value * 10)}
                    height="100%"
                  >
                    {{
                      default: () => [
                        <ElTableColumn prop="year" label="年份" width="80" align="center" />,
                        <ElTableColumn prop="name" label="文档名称" minWidth="260" showOverflowTooltip />,
                        <ElTableColumn label="上传人" width="120">{{ default: () => '演示用户' }}</ElTableColumn>,
                        <ElTableColumn prop="type" label="文档类型" width="100" align="center" />,
                        <ElTableColumn label="业务类型标签" width="140">
                          {{ default: ({ row }: { row: Sample }) => <ElTag>{row.tag}</ElTag> }}
                        </ElTableColumn>,
                        <ElTableColumn label="更新时间" width="180">
                          {{ default: () => '2026-10-21 10:30:00' }}
                        </ElTableColumn>,
                        <ElTableColumn label="备注" minWidth="120">{{ default: () => '演示数据' }}</ElTableColumn>
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
      <UploadPreviewDialog model={upload} />
    </main>;
  }
});
