import { ElButton, ElOption, ElSelect } from 'element-plus';
import { computed, defineComponent, reactive, ref } from 'vue';
import type {
  Application,
  AuditDecision,
  SystemDownloadTarget,
  SystemFilters,
  SystemRow,
  SystemSection
} from '@/features/system-management/api';
import type { ApplicationAuditModel } from '@/features/system-management/components/ApplicationAuditDialog';
import { SystemManagementView } from '@/features/system-management/components/SystemManagementView';
import type { useSystemList } from '@/features/system-management/composables/useSystemList';
import { useDownloads } from '@/shared/file-transfer/useDownloads';
import styles from './preview.module.scss';

type Scene = 'normal' | 'empty' | 'loading' | 'error';

// 本地记录只用于检查正式组件的显示与交互，不调用审核或列表接口
const sampleApplications = (): Application[] => Array.from({ length: 26 }, (_, index) => ({
  apply_id: String(index + 1),
  apply_name: `${['南京市', '无锡市', '徐州市'][index % 3]} 2025 年度自然资源调查成果`,
  status: index % 3 === 0 ? 'pending' : 'approved',
  xzqmc: ['南京市', '无锡市', '徐州市'][index % 3],
  create_time: '2026-10-23 09:30:00',
  receiver_dept_name: '自然资源调查监测处（演示）',
  layer_code: 'bgdc_dltb_2025',
  start_date: '2025-01-01',
  end_date: '2025-12-31',
  data_formats: 'shp,excel',
  apply_purpose: '用于年度调查成果核查与统计分析（演示）',
  storage_status: index % 3 === 1 ? 'success' : 'waiting'
}));

/** 正式组件验收入口，原设计保留为布局对照 */
export const ComponentPreview = defineComponent({
  name: 'SystemManagementComponentPreview',
  emits: { design: () => true },
  setup(_props, { emit }) {
    const section = ref<SystemSection>('audit');
    const scene = ref<Scene>('normal');
    const records = ref(sampleApplications());
    const form = reactive<SystemFilters>({ name: '', status: 'all', taskStatus: 'all' });
    const applied = ref({ ...form });
    const pageNum = ref(1);
    const pageSize = ref(20);
    const selectedId = ref<string>();
    const decision = ref<AuditDecision | ''>('');
    const reason = ref('');
    const failure = ref('');
    const detail = computed(() => records.value.find(row => row.apply_id === selectedId.value));
    const filtered = computed(() => records.value.filter(row => {
      const matchesStatus = section.value === 'reports' || applied.value.status === 'all' ||
        row.status === applied.value.status;
      const matchesTask = section.value === 'reports' || applied.value.taskStatus === 'all' ||
        row.storage_status === applied.value.taskStatus;
      return row.apply_name.includes(applied.value.name) && matchesStatus && matchesTask;
    }));
    const rows = computed<SystemRow[]>(() => {
      if (scene.value !== 'normal') {
        return [];
      }
      return filtered.value.slice((pageNum.value - 1) * pageSize.value, pageNum.value * pageSize.value).map(row => {
        if (section.value === 'audit') {
          return Object.assign({ kind: 'audit' as const }, row);
        }
        return { kind: 'reports', id: row.apply_id, name: row.apply_name, year: '2025',
          startTime: row.create_time, finishTime: row.create_time, status: row.storage_status };
      });
    });

    function search() {
      applied.value = { ...form, name: form.name.trim() };
      pageNum.value = 1;
    }

    function reset() {
      Object.assign(form, { name: '', status: 'all', taskStatus: 'all' });
      search();
    }

    function open(id: string) {
      decision.value = '';
      reason.value = '';
      failure.value = '';
      selectedId.value = id;
    }

    async function submit(): Promise<boolean> {
      if (!decision.value || (decision.value === 'rejected' && !reason.value.trim())) {
        failure.value = decision.value ? '请填写不通过原因' : '请选择审核结果';
        return false;
      }
      if (!detail.value) {
        return false;
      }
      detail.value.status = decision.value;
      detail.value.remark = reason.value.trim();
      selectedId.value = undefined;
      return true;
    }

    const list: ReturnType<typeof useSystemList> = {
      form,
      rows,
      pageNum,
      pageSize,
      total: computed(() => (scene.value === 'normal' ? filtered.value.length : 0)),
      initialLoading: computed(() => scene.value === 'loading'),
      refreshing: computed(() => false),
      isError: computed(() => scene.value === 'error'),
      refresh: async () => {
        scene.value = 'normal';
      },
      search,
      reset,
      changePageSize: size => {
        pageSize.value = size;
        pageNum.value = 1;
      }
    };
    const audit: ApplicationAuditModel = {
      selectedId,
      detail,
      decision,
      reason,
      failure,
      submitting: ref(false),
      editable: computed(() => detail.value?.status === 'pending'),
      loading: ref(false),
      loadFailed: ref(false),
      retry: async () => undefined,
      open,
      close: () => {
        selectedId.value = undefined;
      },
      submit
    };
    // 下载演示只生成带说明的本地文本，不取业务文件
    const downloads = useDownloads<SystemDownloadTarget>(async target => ({
      blob: new Blob([`本地组件预览，不包含真实业务数据。\n演示目标：${target.name}`], { type: 'text/plain;charset=utf-8' }),
      fileName: '系统管理下载演示.txt'
    }));

    return () => (
      <div class={styles.page}>
        <header class={styles.previewHeader}>
          <span>系统管理 · 正式组件（固定数据，审核仅本地生效，下载为演示文本）</span>
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
          <ElButton link onClick={() => emit('design')}>查看已确认设计</ElButton>
        </header>
        <div class={styles.workspace}>
          <SystemManagementView
            section={section.value}
            list={list}
            audit={audit}
            downloads={downloads}
            onSelect={value => {
              section.value = value;
              audit.close();
              reset();
            }}
          />
        </div>
      </div>
    );
  }
});
