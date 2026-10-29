import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { defineComponent, type PropType } from 'vue';
import { RouteName } from '@/shared/router/route-names';
import { SideNav, type SideNavItem } from '@/shared/side-nav/SideNav';
import { AuditSection } from './AuditSection';
import { ReportsSection } from './ReportsSection';

/** 系统管理的栏目，由路由的 props 传入（ADR 0092） */
export type SystemSection = 'audit' | 'reports';

const NAV_ITEMS: SideNavItem[] = [
  { label: '资源审核', icon: 'menu-audit', route: RouteName.systemManagement },
  { label: '统计报表', icon: 'menu-report', route: RouteName.systemManagementReports }
];

/** 系统管理：左侧页面内导航；右侧是资源审核或统计报表。两个栏目是两个路由、同一个页面，切换时侧栏不重建 */
export const SystemManagementPage = defineComponent({
  name: 'SystemManagementPage',
  props: {
    section: { type: String as PropType<SystemSection>, required: true },
    // 资源审核里打开的申请，来自查询参数 apply
    applyId: { type: String as PropType<string | null>, default: null }
  },
  setup(props) {
    return () => (
      <MxSplitLayout asideType="menu" asideLabel="系统管理">
        {{
          aside: () => (
            <MxPanel flush headerTone="muted" title="系统管理">
              <SideNav label="系统管理" items={NAV_ITEMS} />
            </MxPanel>
          ),
          default: () => (props.section === 'audit' ? <AuditSection applyId={props.applyId} /> : <ReportsSection />)
        }}
      </MxSplitLayout>
    );
  }
});
