import { computed, reactive, ref, shallowRef } from 'vue';
import type { Application, ApplicationFilters } from '@/features/data-application/api';
import type {
  ApplicationReviewOwner,
  AuditForm,
  AuditResult,
  ReviewState
} from '@/features/data-application/composables/useApplicationReview';
import type { Report, ReportFilters } from '@/features/statistics-report/api';
import type { RowDownloadState } from '@/shared/file-transfer/useRowDownloads';
import { APPLICATION_SAMPLES, REPORT_SAMPLES } from './samples';

export type SystemSection = 'audit' | 'reports';
export type ListScene = 'normal' | 'loading' | 'refreshing' | 'error' | 'empty';
export type SubmitScene = 'success' | 'error' | 'slow';

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

const emptyApplicationFilters = (): ApplicationFilters => ({ name: '', status: '', prepare: '' });

function matches(application: Application, filters: ApplicationFilters): boolean {
  const name = filters.name.trim();
  return (
    (name === '' || (application.name ?? '').includes(name)) &&
    (filters.status === '' || application.status === filters.status) &&
    (filters.prepare === '' || application.prepare === filters.prepare)
  );
}

// 分页：页码、每页条数、总数；换条件时回到第 1 页
function usePager() {
  const pageNum = ref(1);
  const pageSize = ref(20);
  return {
    pageNum,
    pageSize,
    firstSerial: computed(() => (pageNum.value - 1) * pageSize.value + 1),
    pageOf: <T>(rows: readonly T[]): T[] =>
      rows.slice((pageNum.value - 1) * pageSize.value, pageNum.value * pageSize.value),
    changePageSize: (size: number) => {
      pageSize.value = size;
      pageNum.value = 1;
    }
  };
}

// 下载：一行一份进度，在内存里每 300 毫秒涨 20%，表格和弹窗共用
function useDemoDownloads() {
  const progress = reactive(new Map<string, number>());
  const state: RowDownloadState = {
    isDownloading: id => progress.has(id),
    percentOf: id => progress.get(id) ?? null
  };

  /** 开始下载，返回是否完成；同一行下载中时直接返回 false */
  function start(id: string): Promise<boolean> {
    if (progress.has(id)) {
      return Promise.resolve(false);
    }
    progress.set(id, 0);
    return new Promise(resolve => {
      const timer = setInterval(() => {
        const next = (progress.get(id) ?? 0) + 20;
        if (next > 100) {
          clearInterval(timer);
          progress.delete(id);
          resolve(true);
          return;
        }
        progress.set(id, next);
      }, 300);
    });
  }

  return { state, start };
}

/**
 * 系统管理组件样例的数据与拥有者：申请、统计报表的列表和筛选，打开的申请与审核，下载进度；都是固定数据，
 * 审核和下载只在内存里改，列表状态、审核结果由演示选项决定，不请求接口
 */
export function useSystemManagementDemo() {
  const section = ref<SystemSection>('audit');
  const listScene = ref<ListScene>('normal');
  const submitScene = ref<SubmitScene>('success');
  const applications = shallowRef<Application[]>(structuredClone(APPLICATION_SAMPLES));
  const downloads = useDemoDownloads();

  // 列表：样例按演示的列表状态显示，筛选点"查询"才生效
  const rowsFor = <T>(rows: readonly T[]) => (listScene.value === 'normal' || listScene.value === 'refreshing' ? rows : []);
  const auditForm = reactive(emptyApplicationFilters());
  const auditApplied = ref(emptyApplicationFilters());
  const auditPager = usePager();
  const auditRows = computed(() =>
    rowsFor(applications.value.filter(application => matches(application, auditApplied.value)))
  );

  const reportForm = reactive<ReportFilters>({ name: '' });
  const reportApplied = ref('');
  const reportPager = usePager();
  const reportRows = computed(() =>
    rowsFor(REPORT_SAMPLES.filter(report => report.name.includes(reportApplied.value)))
  );

  const audit = {
    form: auditForm,
    pager: auditPager,
    rows: computed(() => auditPager.pageOf(auditRows.value)),
    total: computed(() => auditRows.value.length),
    search: () => {
      auditApplied.value = { ...auditForm };
      auditPager.pageNum.value = 1;
    },
    reset: () => {
      Object.assign(auditForm, emptyApplicationFilters());
      auditApplied.value = emptyApplicationFilters();
      auditPager.pageNum.value = 1;
    }
  };

  const reports = {
    form: reportForm,
    pager: reportPager,
    rows: computed<Report[]>(() => reportPager.pageOf(reportRows.value)),
    total: computed(() => reportRows.value.length),
    search: () => {
      reportApplied.value = reportForm.name.trim();
      reportPager.pageNum.value = 1;
    },
    reset: () => {
      reportForm.name = '';
      reportApplied.value = '';
      reportPager.pageNum.value = 1;
    }
  };

  // 打开的申请：正式页面里是路由的查询参数 apply；从消息打开时先读取一会儿，不先用列表的数据
  const openId = ref<string | null>(null);
  const detailLoading = ref(false);
  const form = reactive<AuditForm>({ approved: true, reason: '' });
  const pending = ref(false);
  const opened = computed(() => applications.value.find(application => application.id === openId.value) ?? null);

  const state = computed<ReviewState>(() => {
    if (openId.value === null) {
      return 'closed';
    }
    if (detailLoading.value) {
      return 'loading';
    }
    return opened.value ? 'ready' : 'missing';
  });

  async function open(id: string, loadMilliseconds = 0) {
    openId.value = id;
    Object.assign(form, { approved: true, reason: '' });
    if (loadMilliseconds > 0) {
      detailLoading.value = true;
      await wait(loadMilliseconds);
      detailLoading.value = false;
    }
  }

  function close() {
    openId.value = null;
  }

  function settle(id: string, approved: boolean, reason: string) {
    applications.value = applications.value.map(application =>
      application.id === id ? settled(application, approved, reason) : application
    );
  }

  async function submit(): Promise<AuditResult> {
    const current = opened.value;
    if (!current || current.status !== 'pending' || pending.value) {
      return null;
    }
    pending.value = true;
    try {
      await wait(submitScene.value === 'slow' ? 3000 : 400);
      if (submitScene.value === 'error') {
        return { kind: 'error', message: '审核提交失败，请重试' };
      }
      settle(current.id, form.approved, form.reason.trim());
      return { kind: 'success', id: current.id, approved: form.approved };
    } finally {
      pending.value = false;
    }
  }

  const review: ApplicationReviewOwner = {
    application: opened,
    state,
    mode: computed(() => (opened.value?.status === 'pending' ? 'audit' : 'view')),
    form,
    pending,
    submit,
    retry: () => undefined
  };

  return { section, listScene, submitScene, audit, reports, review, open, close, downloads };
}

// 审核以后的申请：通过的开始准备数据，不通过的记下原因
function settled(application: Application, approved: boolean, reason: string): Application {
  return approved
    ? { ...application, status: 'approved', reason: '', prepare: 'processing' }
    : { ...application, status: 'rejected', reason };
}

export type SystemManagementDemo = ReturnType<typeof useSystemManagementDemo>;
