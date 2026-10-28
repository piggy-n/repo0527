import { MxSplitLayout } from '@yzt/ui';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { type StatisticsApi, statisticsApi } from '@/features/monitoring-statistics/api';
import { ReportConditionsPanel } from '@/features/monitoring-statistics/components/ReportConditionsPanel';
import { ReportMonitorPanel } from '@/features/monitoring-statistics/components/ReportMonitorPanel';
import { ReportProgressPanel } from '@/features/monitoring-statistics/components/ReportProgressPanel';
import { StatisticsCalculationPanel } from '@/features/monitoring-statistics/components/StatisticsCalculationPanel';
import { StatisticsOverviewPanel } from '@/features/monitoring-statistics/components/StatisticsOverviewPanel';
import { useStatisticsCalculation } from '@/features/monitoring-statistics/composables/useStatisticsCalculation';
import { useStatisticsOverview } from '@/features/monitoring-statistics/composables/useStatisticsOverview';
import { useStatisticsReport } from '@/features/monitoring-statistics/composables/useStatisticsReport';
import { isReportSettled } from '@/features/monitoring-statistics/report';
import { Role } from '@/shared/auth/roles';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { navigate } from '@/shared/router/navigate';
import { RouteName } from '@/shared/router/route-names';
import styles from './SpaceMonitoringStatisticsPage.module.scss';

/** 普通用户的"数据下载"（资源申请）还没有迁移 */
const DOWNLOAD_UNAVAILABLE = '数据下载页面迁移后可用';

/**
 * 城市国土空间监测基本统计：左栏提交统计任务（默认收起），主区看一份报表的进度、全年的总览和统计表（ADR 0100）。
 * 不进页面缓存：离开就停止轮询，回来时重新查询
 */
export const SpaceMonitoringStatisticsPage = defineComponent({
  name: 'SpaceMonitoringStatisticsPage',
  props: {
    /** 默认是真实接口；组件样例传入固定数据的实现 */
    api: { type: Object as PropType<StatisticsApi>, default: () => statisticsApi },
    /** 默认按登录会话核对写操作；组件样例不登录，传入总是有效的核对 */
    sessionGuard: { type: Object as PropType<SessionGuard>, default: undefined },
    /** 默认是登录用户的角色；组件样例切换角色时传入 */
    role: { type: String as PropType<Role>, default: undefined }
  },
  setup(props) {
    const router = useRouter();
    const session = useSessionStore();
    const { api } = props;
    const report = useStatisticsReport({ api });
    const overview = useStatisticsOverview({
      api,
      year: () => report.criteria.value.year,
      following: () => report.hasActiveTracking(report.criteria.value.year)
    });
    const calculation = useStatisticsCalculation({ api, report, overview, sessionGuard: props.sessionGuard });

    // 左栏默认收起（同旧页面）；第一次展开时年度跟着正在查看的年份
    const collapsed = ref(true);
    let calculationYearSynced = false;
    const changeCollapsed = (value: boolean) => {
      collapsed.value = value;
      if (!value && !calculationYearSynced) {
        calculationYearSynced = true;
        calculation.setYear(report.criteria.value.year);
      }
    };
    // 提交后收起左栏，把地方让给结果
    watch(report.run, () => {
      collapsed.value = true;
    });

    // 初次进入：总览和当前报表都到了以后，当前组合没有结果就落到第一个有结果的
    watch([overview.ready, report.status], ([ready]) => {
      if (ready) {
        report.focusFirstResult(overview.rows.value);
      }
    });
    // 当前报表开始或结束处理时同步总览，数量变化不刷新
    watch(
      () => {
        const status = report.status.value;
        return status === null ? null : isReportSettled(status);
      },
      (settled, previous) => {
        if (settled !== null && previous !== null && settled !== previous) {
          overview.refresh();
        }
      }
    );

    const refresh = () => {
      report.retry();
      overview.refresh();
    };

    const role = computed(() => props.role ?? session.user?.role);
    const download = () => {
      if (role.value === Role.admin) {
        void navigate(router, { name: RouteName.systemManagementReports });
      }
    };

    return () => (
      <MxSplitLayout
        asideLabel="统计报表计算"
        collapsible
        collapsed={collapsed.value}
        onUpdate:collapsed={changeCollapsed}
      >
        {{
          aside: () => <StatisticsCalculationPanel calculation={calculation} />,
          default: () => (
            <div class={styles.content} data-statistics-page>
              <div class={styles.top}>
                <div class={styles.column}>
                  <ReportConditionsPanel report={report} />
                  <ReportProgressPanel report={report} onRefresh={refresh} />
                </div>
                <StatisticsOverviewPanel
                  overview={overview}
                  criteria={report.criteria.value}
                  onSelect={report.select}
                />
              </div>
              <ReportMonitorPanel
                class={styles.monitor}
                report={report}
                downloadBlocked={role.value === Role.admin ? null : DOWNLOAD_UNAVAILABLE}
                onDownload={download}
              />
            </div>
          )
        }}
      </MxSplitLayout>
    );
  }
});
