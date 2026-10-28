import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElButton, ElFormItem, ElInput, ElOption, ElPagination, ElSelect, ElSwitch } from 'element-plus';
import { computed, defineComponent, type VNode } from 'vue';
import { QueryForm } from '@/shared/query-form/QueryForm';
import { ApplicationDialogPreview } from './ApplicationDialogPreview';
import { ApplicationTablePreview } from './ApplicationTablePreview';
import styles from './preview.module.scss';
import { ReportTablePreview } from './ReportTablePreview';
import { AUDIT_STATUS_OPTIONS, type AuditStatus, PREPARE_STATUS_OPTIONS, type PrepareStatus } from './samples';
import { SystemMenuPreview } from './SystemMenuPreview';
import {
  type DownloadFeedback,
  type ListScene,
  type SubmitScene,
  type TableRowMode,
  useSystemManagementDemo
} from './useSystemManagementDemo';

const TABLE_ROW_MODES: [TableRowMode, string][] = [
  ['labeled', '标成"统计任务"'],
  ['legacy', '照旧显示为审核通过'],
  ['hidden', '后端排除，不显示']
];
const DOWNLOAD_FEEDBACKS: [DownloadFeedback, string][] = [
  ['progress', '行内百分比'],
  ['spinner', '按钮转圈']
];
const LIST_SCENES: [ListScene, string][] = [
  ['normal', '正常'],
  ['loading', '首次加载'],
  ['refreshing', '刷新中（遮罩）'],
  ['error', '加载失败'],
  ['empty', '没有数据']
];
const SUBMIT_SCENES: [SubmitScene, string][] = [
  ['success', '成功'],
  ['error', '失败'],
  ['slow', '3 秒后成功']
];

const PAGE_SIZES = [10, 20, 50, 100];

// 输入法选字时按的回车只是确认候选词，不查询
const isSubmitKey = (event: Event | KeyboardEvent) =>
  event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing;

// 演示选项：一个标签加一个小号下拉
function renderOption<T extends string>(label: string, value: T, options: [T, string][], update: (value: T) => void) {
  return (
    <div class={styles.control}>
      <span>{label}</span>
      <ElSelect modelValue={value} onUpdate:modelValue={update} size="small" aria-label={label}>
        {options.map(([key, text]) => (
          <ElOption key={key} value={key} label={text} />
        ))}
      </ElSelect>
    </div>
  );
}

/** 系统管理的交互原型：真实的分栏布局、面板、查询表单和 Element 组件，数据是固定的，不请求接口 */
export const DevSystemManagementPage = defineComponent({
  name: 'DevSystemManagementPage',
  setup() {
    const demo = useSystemManagementDemo();
    const address = computed(() => {
      const path = demo.section.value === 'audit' ? '/system-management' : '/system-management/statistical-report';
      return demo.openId.value ? `${path}?apply=${demo.openId.value}` : path;
    });

    function renderControls() {
      return (
        <div class={styles.controls}>
          {renderOption('统计任务', demo.tableRowMode.value, TABLE_ROW_MODES, value => {
            demo.tableRowMode.value = value;
          })}
          {renderOption('下载反馈', demo.downloadFeedback.value, DOWNLOAD_FEEDBACKS, value => {
            demo.downloadFeedback.value = value;
          })}
          {renderOption('列表状态', demo.listScene.value, LIST_SCENES, value => (demo.listScene.value = value))}
          {renderOption('审核提交', demo.submitScene.value, SUBMIT_SCENES, value => (demo.submitScene.value = value))}
          <div class={styles.control}>
            <span>申请人列</span>
            <ElSwitch
              modelValue={demo.showApplicant.value}
              onUpdate:modelValue={(value: string | number | boolean) => (demo.showApplicant.value = value === true)}
              size="small"
            />
          </div>
          <ElButton size="small" onClick={() => demo.open('apply-001', 1000)}>
            从消息打开待审核的申请
          </ElButton>
          <ElButton size="small" onClick={() => demo.open('apply-006', 1000)}>
            从消息打开已退回的申请
          </ElButton>
        </div>
      );
    }

    // 演示选项可以收起，窄屏时给页面留出高度
    function renderHeader() {
      return (
        <header class={styles.header}>
          <h1>系统管理 · 交互原型</h1>
          <p class={styles.hint}>
            布局、面板、查询表单、表格和弹窗都是真实组件；数据是按真实接口整理的固定数据，审核和下载只在内存里演示。
            正式页面里栏目是两个路由，打开的申请是查询参数，当前地址：<code>{address.value}</code>
          </p>
          <details class={styles.options} open>
            <summary>演示选项</summary>
            {renderControls()}
          </details>
        </header>
      );
    }

    function renderAuditFilters() {
      const form = demo.auditForm;
      return (
        <QueryForm class={styles.filters} labelChars={6}>
          {{
            default: () => [
              <ElFormItem label="数据名称">
                <ElInput
                  modelValue={form.name}
                  onUpdate:modelValue={(value: string) => (form.name = value)}
                  placeholder="请输入数据名称"
                  clearable
                  onKeydown={(event: Event | KeyboardEvent) => {
                    if (isSubmitKey(event)) {
                      demo.searchAudit();
                    }
                  }}
                />
              </ElFormItem>,
              <ElFormItem label="审核状态">
                <ElSelect
                  modelValue={form.status}
                  onUpdate:modelValue={(value: AuditStatus | undefined) => (form.status = value ?? '')}
                  placeholder="全部"
                  clearable
                >
                  {AUDIT_STATUS_OPTIONS.map(([value, label]) => (
                    <ElOption key={value} value={value} label={label} />
                  ))}
                </ElSelect>
              </ElFormItem>,
              <ElFormItem label="数据准备状态">
                <ElSelect
                  modelValue={form.prepare}
                  onUpdate:modelValue={(value: PrepareStatus | undefined) => (form.prepare = value ?? '')}
                  placeholder="全部"
                  clearable
                >
                  {PREPARE_STATUS_OPTIONS.map(([value, label]) => (
                    <ElOption key={value} value={value} label={label} />
                  ))}
                </ElSelect>
              </ElFormItem>
            ],
            actions: () => [
              <ElButton type="primary" icon={Search} onClick={demo.searchAudit}>
                查询
              </ElButton>,
              <ElButton icon={RefreshLeft} onClick={demo.resetAudit}>
                重置
              </ElButton>
            ]
          }}
        </QueryForm>
      );
    }

    function renderReportFilters() {
      return (
        <QueryForm class={styles.filters} labelChars={4}>
          {{
            default: () => [
              <ElFormItem label="报表名称">
                <ElInput
                  modelValue={demo.reportName.value}
                  onUpdate:modelValue={(value: string) => (demo.reportName.value = value)}
                  placeholder="请输入报表名称"
                  clearable
                  onKeydown={(event: Event | KeyboardEvent) => {
                    if (isSubmitKey(event)) {
                      demo.searchReports();
                    }
                  }}
                />
              </ElFormItem>
            ],
            actions: () => [
              <ElButton type="primary" icon={Search} onClick={demo.searchReports}>
                查询
              </ElButton>,
              <ElButton icon={RefreshLeft} onClick={demo.resetReports}>
                重置
              </ElButton>
            ]
          }}
        </QueryForm>
      );
    }

    function renderPagination(page: number, total: number, update: (page: number) => void): VNode {
      return (
        <ElPagination
          class={styles.pagination}
          currentPage={page}
          pageSize={demo.pageSize.value}
          total={total}
          pageSizes={PAGE_SIZES}
          pagerCount={5}
          layout="total, sizes, prev, pager, next, jumper"
          onUpdate:current-page={update}
          onUpdate:page-size={demo.changePageSize}
        />
      );
    }

    function renderAudit() {
      const firstSerial = (demo.auditPage.value - 1) * demo.pageSize.value + 1;
      return (
        <MxPanel headerTone="muted" title="资源审核">
          {{
            default: () => [
              renderAuditFilters(),
              <ApplicationTablePreview
                rows={demo.auditRows.value}
                firstSerial={firstSerial}
                showApplicant={demo.showApplicant.value}
                tableRowMode={demo.tableRowMode.value}
                downloadFeedback={demo.downloadFeedback.value}
                downloadPercent={demo.downloadPercent}
                initialLoading={demo.initialLoading.value}
                refreshing={demo.refreshing.value}
                error={demo.error.value}
                onOpen={row => demo.open(row.id)}
                onDownload={row => demo.download(row.id)}
                onRetry={() => (demo.listScene.value = 'normal')}
              />
            ],
            footer: () =>
              renderPagination(demo.auditPage.value, demo.auditTotal.value, page => (demo.auditPage.value = page))
          }}
        </MxPanel>
      );
    }

    function renderReports() {
      const firstSerial = (demo.reportPage.value - 1) * demo.pageSize.value + 1;
      return (
        <MxPanel headerTone="muted" title="统计报表">
          {{
            default: () => [
              renderReportFilters(),
              <ReportTablePreview
                rows={demo.reportRows.value}
                firstSerial={firstSerial}
                downloadFeedback={demo.downloadFeedback.value}
                downloadPercent={demo.downloadPercent}
                initialLoading={demo.initialLoading.value}
                refreshing={demo.refreshing.value}
                error={demo.error.value}
                onDownload={row => demo.download(row.id)}
                onRetry={() => (demo.listScene.value = 'normal')}
              />
            ],
            footer: () =>
              renderPagination(demo.reportPage.value, demo.reportTotal.value, page => (demo.reportPage.value = page))
          }}
        </MxPanel>
      );
    }

    return () => (
      <main class={styles.page}>
        {renderHeader()}
        <div class={styles.workspace}>
          <MxSplitLayout asideType="menu" asideLabel="系统管理">
            {{
              aside: () => (
                <MxPanel flush>
                  <SystemMenuPreview active={demo.section.value} onSelect={section => (demo.section.value = section)} />
                </MxPanel>
              ),
              default: () => (demo.section.value === 'audit' ? renderAudit() : renderReports())
            }}
          </MxSplitLayout>
        </div>
        <ApplicationDialogPreview demo={demo} />
      </main>
    );
  }
});
