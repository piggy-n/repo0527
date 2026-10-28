// 系统管理原型的固定数据：字段和取值按 2026-10-27 只读核对的真实接口整理（docs/migration.md），名称和人名是虚构的

export type AuditStatus = 'pending' | 'approved' | 'rejected';
// 后端把基本统计的任务也存在申请表里，status 是 table
export type ApplicationStatus = AuditStatus | 'table';
// storage_status 的取值沿用旧页面筛选项，没有这个字段时是"未开始处理"
export type PrepareStatus = 'processing' | 'success' | 'timeout' | 'failed';

export interface ApplicationSample {
  id: string;
  name?: string;
  applicant?: string;
  department: string;
  layerCode?: string;
  region?: string;
  appliedAt?: string;
  startTime: string;
  endTime: string;
  formats: string[];
  purpose?: string;
  status: ApplicationStatus;
  prepare?: PrepareStatus;
  reason?: string;
}

export interface ReportSample {
  id: string;
  year: number;
  name: string;
  startTime: string;
  finishTime?: string;
  status: PrepareStatus;
}

export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = {
  pending: '待审核',
  approved: '审核通过',
  rejected: '审核不通过'
};

export const PREPARE_STATUS_LABELS: Record<PrepareStatus, string> = {
  processing: '正在处理',
  success: '处理完成',
  timeout: '已过期',
  failed: '处理失败'
};

export const AUDIT_STATUS_OPTIONS = Object.entries(AUDIT_STATUS_LABELS) as [AuditStatus, string][];
export const PREPARE_STATUS_OPTIONS = Object.entries(PREPARE_STATUS_LABELS) as [PrepareStatus, string][];

const DEPARTMENT = '江苏省基础地理信息中心';

interface ApplicationSeed {
  name: string;
  applicant: string;
  layerCode: string;
  region: string;
  appliedAt: string;
  formats: string[];
  purpose: string;
  status: AuditStatus;
  prepare?: PrepareStatus;
  reason?: string;
}

const seeds: ApplicationSeed[] = [
  {
    name: '拆除未尽区',
    applicant: '王立',
    layerCode: 'bgdc_dltb_2022',
    region: '江苏省南京市',
    appliedAt: '2026-10-28 11:29:36',
    formats: ['GDB'],
    purpose: '用于城市更新专项核查',
    status: 'pending'
  },
  {
    name: '南京市主城区学校点位（含新建校区与九年一贯制学校的补充调查成果，长名称演示省略）',
    applicant: '刘敏',
    layerCode: 'csxhjctb_xxp_2022',
    region: '江苏省南京市玄武区',
    appliedAt: '2026-10-27 16:05:12',
    formats: ['Excel', 'Word', 'Echarts', 'SHP', 'GDB'],
    purpose: '用于教育设施服务半径分析，以及年度公共服务设施体检报告的数据底稿',
    status: 'pending'
  },
  {
    name: '城镇村等用地',
    applicant: '赵强',
    layerCode: 'bgdc_czcdyd_2022',
    region: '江苏省',
    appliedAt: '2026-10-26 09:47:07',
    formats: ['GDB'],
    purpose: '业务',
    status: 'approved',
    prepare: 'processing'
  },
  {
    name: '医疗机构面层',
    applicant: '王立',
    layerCode: 'csxhjctb_yljga_2022',
    region: '江苏省苏州市',
    appliedAt: '2026-10-25 14:20:31',
    formats: ['Excel', 'SHP'],
    purpose: '医疗资源布局评估',
    status: 'approved',
    prepare: 'success'
  },
  {
    name: '学校面层',
    applicant: '陈晓',
    layerCode: 'csxhjctb_xxa_2022',
    region: '江苏省无锡市',
    appliedAt: '2026-10-24 10:02:44',
    formats: ['Excel', 'GDB'],
    purpose: '学区划分',
    status: 'approved',
    prepare: 'failed'
  },
  {
    name: '地类图斑',
    applicant: '刘敏',
    layerCode: 'bgdc_dltb_2022',
    region: '江苏省南京市',
    appliedAt: '2026-10-22 08:56:10',
    formats: ['SHP'],
    purpose: '耕地保护考核台账',
    status: 'rejected',
    reason: '申请范围超出本处室职责，请由南京市局统一申请'
  },
  {
    name: '城镇村等用地',
    applicant: '赵强',
    layerCode: 'bgdc_czcdyd_2022',
    region: '江苏省常州市',
    appliedAt: '2026-10-21 15:33:02',
    formats: ['Excel'],
    purpose: '年度变更核查',
    status: 'approved'
  }
];

// 旧数据里大量是已经过期的申请，补足两页
const expiredNames = ['学校点层', '医疗机构点层', '城镇开发边界', '地类图斑', '城镇村等用地'];
const expiredLayers = ['csxhjctb_xxp_2022', 'csxhjctb_yljgp_2022', 'bgdc_czcdyd_2022', 'bgdc_dltb_2022'];

function expired(index: number): ApplicationSeed {
  const day = String(20 - (index % 19)).padStart(2, '0');
  return {
    name: expiredNames[index % expiredNames.length],
    applicant: ['王立', '刘敏', '赵强', '陈晓'][index % 4],
    layerCode: expiredLayers[index % expiredLayers.length],
    region: index % 3 === 0 ? '江苏省' : '江苏省南京市',
    appliedAt: `2026-${index < 8 ? '10' : '09'}-${day} 1${index % 10}:2${index % 6}:00`,
    formats: index % 2 === 0 ? ['GDB'] : ['Excel', 'SHP'],
    purpose: '业务',
    status: 'approved',
    prepare: 'timeout'
  };
}

function application(seed: ApplicationSeed, index: number): ApplicationSample {
  const start = seed.appliedAt.slice(0, 10);
  return {
    id: `apply-${String(index + 1).padStart(3, '0')}`,
    department: DEPARTMENT,
    startTime: `${start} 08:00:00`,
    endTime: `${start.slice(0, 5)}12-31 23:59:59`,
    ...seed
  };
}

// 基本统计的任务：没有图层、区划和用途；其中一条连名称和时间都没有（真实数据里就有这样的一条）
const tableTasks: ApplicationSample[] = [
  {
    id: 'table-001',
    applicant: '赵强',
    department: DEPARTMENT,
    name: '城市国土空间监测基本统计',
    appliedAt: '2026-06-29 11:01:22',
    startTime: '2026-06-29 11:01:22',
    endTime: '2026-06-29 11:01:22',
    formats: ['ZIP'],
    status: 'table',
    prepare: 'timeout'
  },
  {
    id: 'table-002',
    department: DEPARTMENT,
    startTime: '2026-06-29 08:17:28',
    endTime: '2026-06-29 08:17:28',
    formats: ['ZIP'],
    status: 'table'
  }
];

export const APPLICATION_SAMPLES: ApplicationSample[] = [
  ...seeds.map(application),
  ...Array.from({ length: 16 }, (_, index) => application(expired(index), seeds.length + index)),
  ...tableTasks
];

const reportNames = [
  '基本统计报表_省级',
  '基本统计报表_市级',
  '基本统计报表_县级',
  '基本统计报表_区级',
  '汇总统计报表_省级',
  '汇总统计报表_市级',
  '基本变化统计报表_省级',
  '基本变化统计报表_市级',
  '基本变化统计报表_县级',
  '基本变化统计报表_区级'
];

const reportStatuses: PrepareStatus[] = ['success', 'success', 'processing', 'success', 'failed', 'success', 'timeout'];

export const REPORT_SAMPLES: ReportSample[] = reportNames.flatMap((name, index) =>
  [2024, 2023].map((year, yearIndex): ReportSample => {
    const status = reportStatuses[(index + yearIndex) % reportStatuses.length];
    const day = String(14 - index).padStart(2, '0');
    return {
      id: `report-${year}-${index + 1}`,
      year,
      name,
      startTime: `2026-10-${day} 14:2${yearIndex}:00`,
      finishTime: status === 'processing' ? undefined : `2026-10-${day} 14:2${yearIndex + 3}:45`,
      status
    };
  })
);
