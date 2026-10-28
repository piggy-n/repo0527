import { ElMessage } from 'element-plus';
import { computed, onScopeDispose, reactive, ref, shallowRef } from 'vue';
import {
  APPLICATION_SAMPLES,
  type ApplicationSample,
  type AuditStatus,
  type PrepareStatus,
  REPORT_SAMPLES
} from './samples';

export type SystemSection = 'audit' | 'reports';
export type MenuStyle = 'el-menu' | 'side-menu';
// 申请列表里的统计任务：照旧显示为审核通过、标成统计任务、由后端排除
export type TableRowMode = 'legacy' | 'labeled' | 'hidden';
export type DownloadFeedback = 'progress' | 'spinner';
export type ListScene = 'normal' | 'loading' | 'refreshing' | 'error' | 'empty';
export type SubmitScene = 'success' | 'error' | 'slow';
export type DialogMode = 'view' | 'audit';

export interface AuditFilters {
  name: string;
  status: AuditStatus | '';
  prepare: PrepareStatus | '';
}

export interface AuditForm {
  approved: boolean;
  reason: string;
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

const emptyFilters = (): AuditFilters => ({ name: '', status: '', prepare: '' });

/** 系统管理原型的演示数据：筛选、分页、审核和下载都在内存里，不请求接口 */
export function useSystemManagementDemo() {
  const menuStyle = ref<MenuStyle>('el-menu');
  const tableRowMode = ref<TableRowMode>('labeled');
  const downloadFeedback = ref<DownloadFeedback>('progress');
  const listScene = ref<ListScene>('normal');
  const submitScene = ref<SubmitScene>('success');
  const showApplicant = ref(true);
  const section = ref<SystemSection>('audit');

  // 审核会改变状态，所以复制一份
  const applications = ref<ApplicationSample[]>(structuredClone(APPLICATION_SAMPLES));

  const auditForm = reactive(emptyFilters());
  const auditApplied = shallowRef(emptyFilters());
  const auditPage = ref(1);
  const reportName = ref('');
  const reportApplied = ref('');
  const reportPage = ref(1);
  const pageSize = ref(20);

  const filteredApplications = computed(() => {
    const { name, status, prepare } = auditApplied.value;
    return applications.value.filter(row => {
      if (tableRowMode.value === 'hidden' && row.status === 'table') {
        return false;
      }
      if (name && !row.name?.includes(name)) {
        return false;
      }
      if (status && row.status !== status && !(status === 'approved' && row.status === 'table')) {
        return false;
      }
      return !prepare || row.prepare === prepare;
    });
  });

  const filteredReports = computed(() => REPORT_SAMPLES.filter(row => row.name.includes(reportApplied.value)));

  const hasRows = computed(() => listScene.value === 'normal' || listScene.value === 'refreshing');
  const initialLoading = computed(() => listScene.value === 'loading');
  const refreshing = computed(() => listScene.value === 'refreshing');
  const error = computed(() => listScene.value === 'error');

  function pageOf<T>(rows: T[], page: number): T[] {
    if (!hasRows.value) {
      return [];
    }
    const start = (page - 1) * pageSize.value;
    return rows.slice(start, start + pageSize.value);
  }

  const auditRows = computed(() => pageOf(filteredApplications.value, auditPage.value));
  const auditTotal = computed(() => (hasRows.value ? filteredApplications.value.length : 0));
  const reportRows = computed(() => pageOf(filteredReports.value, reportPage.value));
  const reportTotal = computed(() => (hasRows.value ? filteredReports.value.length : 0));

  function searchAudit() {
    auditApplied.value = { ...auditForm };
    auditPage.value = 1;
  }

  function resetAudit() {
    Object.assign(auditForm, emptyFilters());
    searchAudit();
  }

  function searchReports() {
    reportApplied.value = reportName.value.trim();
    reportPage.value = 1;
  }

  function resetReports() {
    reportName.value = '';
    searchReports();
  }

  function changePageSize(size: number) {
    pageSize.value = size;
    auditPage.value = 1;
    reportPage.value = 1;
  }

  // 正式页面里打开的申请是路由的查询参数 ?apply=<id>，这里用一个 ref 代替
  const openId = ref<string | null>(null);
  const detailLoading = ref(false);
  const submitting = ref(false);
  const form = reactive<AuditForm>({ approved: true, reason: '' });

  const current = computed(() => applications.value.find(row => row.id === openId.value));
  // 弹窗的模式由申请当前的状态决定，不由入口决定：已经审核过的申请从"去审核"进来也只能查看
  const mode = computed<DialogMode>(() => (current.value?.status === 'pending' ? 'audit' : 'view'));

  // 从消息进来时要先读详情，用定时器模拟读取的耗时；再次打开时作废上一次
  let loadTimer: number | undefined;

  function open(id: string, loadMilliseconds = 0) {
    openId.value = id;
    form.approved = true;
    form.reason = '';
    window.clearTimeout(loadTimer);
    detailLoading.value = loadMilliseconds > 0;
    if (loadMilliseconds > 0) {
      loadTimer = window.setTimeout(() => {
        detailLoading.value = false;
      }, loadMilliseconds);
    }
  }

  function close() {
    if (!submitting.value) {
      openId.value = null;
    }
  }

  async function submit() {
    const target = current.value;
    if (!target || submitting.value) {
      return;
    }
    submitting.value = true;
    try {
      await wait(submitScene.value === 'slow' ? 3000 : 600);
      if (submitScene.value === 'error') {
        ElMessage.error('演示：审核提交失败，请重试');
        return;
      }
      if (form.approved) {
        target.status = 'approved';
        target.prepare = 'processing';
      } else {
        target.status = 'rejected';
        target.reason = form.reason.trim();
      }
      ElMessage.success(form.approved ? '已审核通过，数据开始准备' : '已退回申请');
      openId.value = null;
    } finally {
      submitting.value = false;
    }
  }

  // 下载的进度按行记录；正式页面由 shared/file-transfer 报告真实进度
  const downloads = ref<Record<string, number>>({});
  const timers = new Map<string, number>();

  function download(id: string) {
    if (timers.has(id)) {
      return;
    }
    downloads.value = { ...downloads.value, [id]: 0 };
    const timer = window.setInterval(() => {
      const percent = Math.min(100, (downloads.value[id] ?? 0) + 6 + Math.floor(Math.random() * 6));
      if (percent < 100) {
        downloads.value = { ...downloads.value, [id]: percent };
        return;
      }
      window.clearInterval(timer);
      timers.delete(id);
      const { [id]: _done, ...rest } = downloads.value;
      downloads.value = rest;
      ElMessage.success('下载完成，已交给浏览器保存');
    }, 200);
    timers.set(id, timer);
  }

  const downloadPercent = (id: string): number | undefined => downloads.value[id];

  onScopeDispose(() => {
    for (const timer of timers.values()) {
      window.clearInterval(timer);
    }
    window.clearTimeout(loadTimer);
  });

  return {
    menuStyle,
    tableRowMode,
    downloadFeedback,
    listScene,
    submitScene,
    showApplicant,
    section,
    auditForm,
    auditPage,
    auditRows,
    auditTotal,
    reportName,
    reportPage,
    reportRows,
    reportTotal,
    pageSize,
    initialLoading,
    refreshing,
    error,
    searchAudit,
    resetAudit,
    searchReports,
    resetReports,
    changePageSize,
    openId,
    current,
    mode,
    detailLoading,
    submitting,
    form,
    open,
    close,
    submit,
    download,
    downloadPercent
  };
}

export type SystemManagementDemo = ReturnType<typeof useSystemManagementDemo>;
