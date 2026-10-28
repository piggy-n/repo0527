import type { Application } from '@/features/data-application/api';
import type { Report } from '@/features/statistics-report/api';
import type { PrepareStatus } from '@/shared/data-request/prepare-status';

// 系统管理组件样例的固定数据：字段和取值按 2026-10-27 只读核对的真实接口整理（docs/migration.md），名称和人名是虚构的；
// 时间是接口转换以后的北京时间，格式是小写

const DEPARTMENT = '江苏省基础地理信息中心';

type ApplicationSeed = Omit<Application, 'id' | 'department' | 'startTime' | 'endTime'> & { appliedAt: string };

const seeds: ApplicationSeed[] = [
  {
    name: '拆除未尽区',
    applicant: undefined,
    layerCode: 'bgdc_dltb_2022',
    region: '江苏省南京市',
    appliedAt: '2026-10-28 11:29:36',
    formats: ['gdb'],
    purpose: '用于城市更新专项核查',
    status: 'pending',
    reason: undefined,
    prepare: undefined
  },
  {
    name: '南京市主城区学校点位（含新建校区与九年一贯制学校的补充调查成果，长名称演示省略）',
    applicant: '刘敏',
    layerCode: 'csxhjctb_xxp_2022',
    region: '江苏省南京市玄武区',
    appliedAt: '2026-10-27 16:05:12',
    formats: ['excel', 'word', 'echarts', 'shp', 'gdb'],
    purpose: '用于教育设施服务半径分析，以及年度公共服务设施体检报告的数据底稿',
    status: 'pending',
    reason: undefined,
    prepare: undefined
  },
  {
    name: '城镇村等用地',
    applicant: '赵强',
    layerCode: 'bgdc_czcdyd_2022',
    region: '江苏省',
    appliedAt: '2026-10-26 09:47:07',
    formats: ['gdb'],
    purpose: '业务',
    status: 'approved',
    reason: '',
    prepare: 'processing'
  },
  {
    name: '医疗机构面层',
    applicant: '王立',
    layerCode: 'csxhjctb_yljga_2022',
    region: '江苏省苏州市',
    appliedAt: '2026-10-25 14:20:31',
    formats: ['excel', 'shp'],
    purpose: '医疗资源布局评估',
    status: 'approved',
    reason: '',
    prepare: 'success'
  },
  {
    name: '学校面层',
    applicant: '陈晓',
    layerCode: 'csxhjctb_xxa_2022',
    region: '江苏省无锡市',
    appliedAt: '2026-10-24 10:02:44',
    formats: ['excel', 'gdb'],
    purpose: '学区划分',
    status: 'approved',
    reason: '',
    prepare: 'failed'
  },
  {
    name: '地类图斑',
    applicant: '刘敏',
    layerCode: 'bgdc_dltb_2022',
    region: '江苏省南京市',
    appliedAt: '2026-10-22 08:56:10',
    formats: ['shp'],
    purpose: '耕地保护考核台账',
    status: 'rejected',
    reason: '申请范围超出本处室职责，请由南京市局统一申请',
    prepare: undefined
  },
  {
    name: '城镇村等用地',
    applicant: '赵强',
    layerCode: 'bgdc_czcdyd_2022',
    region: '江苏省常州市',
    appliedAt: '2026-10-21 15:33:02',
    formats: ['excel'],
    purpose: '年度变更核查',
    status: 'approved',
    reason: '',
    prepare: undefined
  }
];

// 旧数据里大量是已经过期的申请，补足两页
const expiredNames = ['学校点层', '医疗机构点层', '城镇开发边界', '地类图斑', '城镇村等用地'];
const expiredLayers = ['csxhjctb_xxp_2022', 'csxhjctb_yljgp_2022', 'bgdc_czcdyd_2022', 'bgdc_dltb_2022'];
const applicants = ['王立', '刘敏', '赵强', '陈晓'];

function expired(index: number): ApplicationSeed {
  const day = String(20 - (index % 19)).padStart(2, '0');
  return {
    name: expiredNames[index % expiredNames.length],
    applicant: applicants[index % applicants.length],
    layerCode: expiredLayers[index % expiredLayers.length],
    region: index % 3 === 0 ? '江苏省' : '江苏省南京市',
    appliedAt: `2026-${index < 8 ? '10' : '09'}-${day} 1${index % 10}:2${index % 6}:00`,
    formats: index % 2 === 0 ? ['gdb'] : ['excel', 'shp'],
    purpose: '业务',
    status: 'approved',
    reason: '',
    prepare: 'timeout'
  };
}

function application(seed: ApplicationSeed, index: number): Application {
  const start = seed.appliedAt.slice(0, 10);
  return {
    ...seed,
    id: `apply-${String(index + 1).padStart(3, '0')}`,
    department: DEPARTMENT,
    startTime: `${start} 08:00:00`,
    endTime: `${start.slice(0, 5)}12-31 23:59:59`
  };
}

// 基本统计的任务：没有图层、区划和用途；其中一条连名称和时间都没有（真实数据里就有这样的一条）
const tableTasks: Application[] = [
  {
    id: 'table-001',
    name: '城市国土空间监测基本统计',
    applicant: '赵强',
    department: DEPARTMENT,
    layerCode: undefined,
    region: undefined,
    appliedAt: '2026-06-29 11:01:22',
    startTime: '2026-06-29 11:01:22',
    endTime: '2026-06-29 11:01:22',
    formats: ['.zip'],
    purpose: undefined,
    status: 'table',
    reason: undefined,
    prepare: 'timeout'
  },
  {
    id: 'table-002',
    name: undefined,
    applicant: undefined,
    department: DEPARTMENT,
    layerCode: undefined,
    region: undefined,
    appliedAt: undefined,
    startTime: '2026-06-29 08:17:28',
    endTime: '2026-06-29 08:17:28',
    formats: ['.zip'],
    purpose: undefined,
    status: 'table',
    reason: undefined,
    prepare: undefined
  }
];

export const APPLICATION_SAMPLES: Application[] = [
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

export const REPORT_SAMPLES: Report[] = reportNames.flatMap((name, index) =>
  ['2024', '2023'].map((year, yearIndex): Report => {
    const status = reportStatuses[(index + yearIndex) % reportStatuses.length] ?? 'success';
    const day = String(14 - index).padStart(2, '0');
    return {
      id: `report-${year}-${index + 1}`,
      name,
      year,
      startTime: `2026-10-${day} 14:2${yearIndex}:00`,
      finishTime: status === 'processing' ? undefined : `2026-10-${day} 14:2${yearIndex + 3}:45`,
      status
    };
  })
);
