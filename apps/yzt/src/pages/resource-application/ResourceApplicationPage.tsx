import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { defineComponent, type PropType } from 'vue';
import { useInvalidateApplications } from '@/features/data-application/queries';
import { useOnNewMessage } from '@/features/message-center/queries';
import { ReportListPanel } from '@/features/statistics-report/components/ReportListPanel';
import { useInvalidateReports } from '@/features/statistics-report/queries';
import { RouteName } from '@/shared/router/route-names';
import { SideNav, type SideNavItem } from '@/shared/side-nav/SideNav';
import { ApplicationsSection } from './ApplicationsSection';

/** 数据下载的栏目，由路由的 props 传入 */
export type ResourceApplicationSection = 'applications' | 'reports';

const NAV_ITEMS: SideNavItem[] = [
  { label: '数据列表', icon: 'menu-list', route: RouteName.resourceApplication },
  { label: '统计报表', icon: 'menu-report', route: RouteName.resourceApplicationReports }
];

/** 数据下载（普通用户，ADR 0127）：结构同系统管理，两个栏目是两个路由、同一个页面，切换时侧栏不重建 */
export const ResourceApplicationPage = defineComponent({
  name: 'ResourceApplicationPage',
  props: {
    section: { type: String as PropType<ResourceApplicationSection>, required: true },
    // 数据列表里打开的申请，来自查询参数 apply
    applyId: { type: String as PropType<string | null>, default: null }
  },
  setup(props) {
    // 审核结果、数据准备完成、报表完成都会发消息，用户在这页等着时跟着更新（同旧页面）
    const refreshApplications = useInvalidateApplications();
    const refreshReports = useInvalidateReports();
    useOnNewMessage(() => {
      void refreshApplications();
      void refreshReports();
    });

    return () => (
      <MxSplitLayout asideType="menu" asideLabel="数据下载">
        {{
          aside: () => (
            <MxPanel flush headerTone="muted" title="数据下载">
              <SideNav label="数据下载" items={NAV_ITEMS} />
            </MxPanel>
          ),
          default: () =>
            props.section === 'applications' ? <ApplicationsSection applyId={props.applyId} /> : <ReportListPanel />
        }}
      </MxSplitLayout>
    );
  }
});
