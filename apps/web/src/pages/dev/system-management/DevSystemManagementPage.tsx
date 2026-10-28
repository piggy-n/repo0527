import { Document, RefreshLeft, Search, Tickets } from '@element-plus/icons-vue';
import { useMediaQuery } from '@vueuse/core';
import { MxPanel, MxSplitLayout, MxTitle } from '@yzt/ui';
import {
  ElButton,
  ElDialog,
  ElFormItem,
  ElIcon,
  ElInput,
  ElMenu,
  ElMenuItem,
  ElMessage,
  ElOption,
  ElPagination,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag
} from 'element-plus';
import { computed, defineComponent, reactive, ref } from 'vue';
import { QueryForm } from '@/shared/query-form/QueryForm';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import { ComponentPreview } from './ComponentPreview';
import styles from './preview.module.scss';

type Section = 'audit' | 'reports';
type Scene = 'normal' | 'empty' | 'loading' | 'error';
type AuditStatus = 'pending' | 'approved' | 'rejected';

interface SampleRow {
  id: number;
  name: string;
  region: string;
  date: string;
  audit: AuditStatus;
  ready: boolean;
}

const auditLabels: Record<AuditStatus, string> = {
  pending: '待审核',
  approved: '审核通过',
  rejected: '审核不通过'
};
const auditTypes = { pending: 'warning', approved: 'success', rejected: 'danger' } as const;
const resourceNames = ['国土变更调查成果', '城市国土空间监测成果', '森林草原湿地荒漠调查成果'];
const regions = ['南京市', '无锡市', '徐州市'];

// 固定数据只驱动界面预览，不读取登录信息，不发送审核或下载请求
const createRows = (): SampleRow[] => Array.from({ length: 26 }, (_, index) => ({
  id: index + 1,
  name: `${regions[index % 3]} 2025 年度${resourceNames[index % 3]}`,
  region: regions[index % 3],
  date: `2026-10-${String(23 - index % 12).padStart(2, '0')} 09:30`,
  audit: index % 3 === 0 ? 'pending' : 'approved',
  ready: index % 3 === 1
}));

/** 系统管理交互预览：资源审核、报表下载和边界状态使用本地演示数据 */
export const DevSystemManagementPage = defineComponent({
  name: 'DevSystemManagementPage',
  setup() {
    const showComponents = ref(true);
    const section = ref<Section>('audit');
    const scene = ref<Scene>('normal');
    const records = ref(createRows());
    const filters = reactive({ name: '', audit: 'all', ready: 'all' });
    const applied = ref({ ...filters });
    const page = ref(1);
    const size = ref(20);
    const selected = ref<SampleRow>();
    const decision = ref('');
    const reason = ref('');
    const validation = ref('');
    const narrow = useMediaQuery('(max-width: 767px)');
    const isAudit = computed(() => section.value === 'audit');
    const filtered = computed(() => records.value.filter(row => {
      const { name, audit, ready } = applied.value;
      const matchesAudit = !isAudit.value || audit === 'all' || row.audit === audit;
      const matchesReady = !isAudit.value || ready === 'all' || String(row.ready) === ready;
      return row.name.includes(name) && matchesAudit && matchesReady;
    }));
    const rows = computed(() => {
      if (scene.value !== 'normal') {
        return [];
      }
      return filtered.value.slice((page.value - 1) * size.value, page.value * size.value);
    });

    function search() {
      applied.value = { ...filters, name: filters.name.trim() };
      page.value = 1;
    }

    function reset() {
      Object.assign(filters, { name: '', audit: 'all', ready: 'all' });
      search();
    }

    function selectSection(value: string) {
      section.value = value === 'reports' ? 'reports' : 'audit';
      reset();
    }

    function openDetail(row: SampleRow) {
      selected.value = row;
      decision.value = '';
      reason.value = '';
      validation.value = '';
    }

    // 演示拒绝原因校验和成功后列表更新，不提交真实审核
    function submitAudit() {
      if (!decision.value) {
        validation.value = '请选择审核结果';
        return;
      }
      if (decision.value === 'rejected' && !reason.value.trim()) {
        validation.value = '请填写不通过原因';
        return;
      }
      if (!selected.value) {
        return;
      }
      selected.value.audit = decision.value === 'approved' ? 'approved' : 'rejected';
      selected.value.ready = false;
      selected.value = undefined;
      ElMessage.success('演示审核已更新，未向后端提交');
    }

    function renderFilters() {
      return (
        <QueryForm labelChars={6}>
          {{
            default: () => [
              <ElFormItem label="数据名称">
                <ElInput
                  modelValue={filters.name}
                  onUpdate:modelValue={(value: string) => (filters.name = value)}
                  placeholder="请输入数据名称"
                  clearable
                  onKeydown={event => {
                    if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                      search();
                    }
                  }}
                />
              </ElFormItem>,
              isAudit.value && (
                <ElFormItem label="审核状态">
                  <ElSelect modelValue={filters.audit} onUpdate:modelValue={(value: string) => (filters.audit = value)}>
                    <ElOption value="all" label="全部" />
                    {Object.entries(auditLabels).map(([value, label]) => <ElOption value={value} label={label} />)}
                  </ElSelect>
                </ElFormItem>
              ),
              isAudit.value && (
                <ElFormItem label="数据准备状态">
                  <ElSelect modelValue={filters.ready} onUpdate:modelValue={(value: string) => (filters.ready = value)}>
                    <ElOption value="all" label="全部" />
                    <ElOption value="false" label="尚未完成" />
                    <ElOption value="true" label="处理完成" />
                  </ElSelect>
                </ElFormItem>
              )
            ],
            actions: () => [
              <ElButton type="primary" icon={Search} onClick={search}>查询</ElButton>,
              <ElButton icon={RefreshLeft} onClick={reset}>重置</ElButton>
            ]
          }}
        </QueryForm>
      );
    }

    function renderEmpty() {
      if (scene.value === 'loading') {
        return <TableSkeleton />;
      }
      if (scene.value === 'error') {
        return (
          <div>
            加载失败
            <ElButton link type="primary" onClick={() => (scene.value = 'normal')}>重试</ElButton>
          </div>
        );
      }
      return '暂无符合条件的数据';
    }

    function renderTable() {
      return (
        <ElTable data={rows.value} height="100%" class={styles.table}>
          {{
            default: () => [
              <ElTableColumn prop="id" label="序号" width="64" align="center" />,
              !isAudit.value && <ElTableColumn label="年份" width="80">{{ default: () => '2025' }}</ElTableColumn>,
              <ElTableColumn prop="name" label="数据名称" minWidth="280" showOverflowTooltip />,
              isAudit.value && <ElTableColumn prop="region" label="行政区划" width="110" />,
              !isAudit.value && <ElTableColumn prop="date" label="开始时间" width="170" />,
              <ElTableColumn prop="date" label={isAudit.value ? '申请时间' : '完成时间'} width="170" />,
              isAudit.value && (
                <ElTableColumn label="审核状态" width="120">
                  {{ default: ({ row }: { row: SampleRow }) => (
                    <ElTag type={auditTypes[row.audit]}>{auditLabels[row.audit]}</ElTag>
                  ) }}
                </ElTableColumn>
              ),
              <ElTableColumn label="数据准备状态" width="120">
                {{ default: ({ row }: { row: SampleRow }) => row.ready ? '处理完成' : '尚未完成' }}
              </ElTableColumn>,
              <ElTableColumn label="操作" width="140" align="center" fixed="right">
                {{ default: ({ row }: { row: SampleRow }) => (
                  <div class={styles.actions}>
                    {isAudit.value && (
                      <ElButton link type="primary" onClick={() => openDetail(row)}>
                        {row.audit === 'pending' ? '审核' : '查看'}
                      </ElButton>
                    )}
                    <ElButton
                      link
                      type="primary"
                      disabled={!row.ready}
                      onClick={() => ElMessage.info('下载入口演示：正式实现复用公共下载能力')}
                    >
                      下载
                    </ElButton>
                  </div>
                ) }}
              </ElTableColumn>
            ],
            empty: renderEmpty
          }}
        </ElTable>
      );
    }

    function renderDialog() {
      const row = selected.value;
      const editable = row?.audit === 'pending';
      const title = editable ? '资源审核' : '申请详情';
      return (
        <ElDialog
          class="dialog-panel-header"
          modelValue={row !== undefined}
          onUpdate:modelValue={(open: boolean) => {
            if (!open) {
              selected.value = undefined;
            }
          }}
          title={title}
          width="min(560px, calc(100vw - 32px))"
          closeOnClickModal={false}
          destroyOnClose
        >
          {{
            header: () => <MxTitle level="panel">{title}</MxTitle>,
            default: () => row && (
              <div>
                <dl class={styles.details}>
                  <dt>申请处室</dt>
                  <dd>自然资源调查监测处（演示）</dd>
                  <dt>数据名称</dt>
                  <dd>{row.name}</dd>
                  <dt>行政区划</dt>
                  <dd>{row.region}</dd>
                  <dt>时间范围</dt>
                  <dd>2025-01-01 至 2025-12-31</dd>
                  <dt>导出格式</dt>
                  <dd>Shapefile、Excel</dd>
                  <dt>申请用途</dt>
                  <dd>用于年度自然资源调查监测成果核查与统计分析</dd>
                </dl>
                {editable && (
                  <div class={styles.decision}>
                    <MxTitle level="section">审核结果</MxTitle>
                    <ElRadioGroup
                      modelValue={decision.value}
                      onUpdate:modelValue={value => {
                        decision.value = value === 'approved' ? 'approved' : 'rejected';
                        validation.value = '';
                      }}
                    >
                      <ElRadio value="approved">通过</ElRadio>
                      <ElRadio value="rejected">不通过</ElRadio>
                    </ElRadioGroup>
                    {decision.value === 'rejected' && (
                      <ElInput
                        type="textarea"
                        rows={3}
                        maxlength={500}
                        showWordLimit
                        modelValue={reason.value}
                        onUpdate:modelValue={(value: string) => (reason.value = value)}
                        placeholder="请填写不通过原因"
                        aria-label="不通过原因"
                      />
                    )}
                    {validation.value && <p class={styles.error} role="alert">{validation.value}</p>}
                  </div>
                )}
              </div>
            ),
            footer: () => [
              <ElButton onClick={() => (selected.value = undefined)}>{editable ? '取消' : '关闭'}</ElButton>,
              editable && <ElButton type="primary" onClick={submitAudit}>提交审核</ElButton>
            ]
          }}
        </ElDialog>
      );
    }

    return () => showComponents.value ? <ComponentPreview onDesign={() => (showComponents.value = false)} /> : (
      <div class={styles.page}>
        <header class={styles.previewHeader}>
          <span>系统管理 · 交互预览（固定数据，不提交审核）</span>
          <ElButton link onClick={() => (showComponents.value = true)}>查看正式组件</ElButton>
          <ElSelect
            aria-label="演示状态"
            modelValue={scene.value}
            onUpdate:modelValue={(value: Scene) => (scene.value = value)}
          >
            <ElOption value="normal" label="正常列表" />
            <ElOption value="empty" label="空列表" />
            <ElOption value="loading" label="加载中" />
            <ElOption value="error" label="加载失败" />
          </ElSelect>
        </header>
        <div class={styles.workspace}>
          <MxSplitLayout asideType="menu" asideLabel="系统管理">
            {{
              aside: () => (
                <MxPanel flush>
                  <ElMenu class="menu-panel" defaultActive={section.value} onSelect={selectSection}>
                    <ElMenuItem index="audit"><ElIcon><Tickets /></ElIcon>资源审核</ElMenuItem>
                    <ElMenuItem index="reports"><ElIcon><Document /></ElIcon>统计报表</ElMenuItem>
                  </ElMenu>
                </MxPanel>
              ),
              default: () => (
                <MxPanel title={isAudit.value ? '资源审核' : '统计报表'} headerTone="muted">
                  {{
                    default: () => [<div class={styles.filters}>{renderFilters()}</div>, renderTable()],
                    footer: () => (
                      <ElPagination
                        currentPage={page.value}
                        pageSize={size.value}
                        pageSizes={[20, 50, 100]}
                        total={scene.value === 'normal' ? filtered.value.length : 0}
                        layout={narrow.value ? 'total, prev, pager, next' : 'total, sizes, prev, pager, next'}
                        pagerCount={5}
                        onUpdate:current-page={(value: number) => (page.value = value)}
                        onUpdate:page-size={(value: number) => {
                          size.value = value;
                          page.value = 1;
                        }}
                      />
                    )
                  }}
                </MxPanel>
              )
            }}
          </MxSplitLayout>
        </div>
        {renderDialog()}
      </div>
    );
  }
});
