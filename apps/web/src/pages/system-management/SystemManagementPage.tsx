import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElEmpty } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { RouteName } from '@/shared/router/route-names';
import { SideNav, type SideNavItem } from '@/shared/side-nav/SideNav';
import { AuditSection } from './AuditSection';

/** 系统管理的栏目，由路由的 props 传入（ADR 0091） */
export type SystemSection = 'audit' | 'reports';

const NAV_ITEMS: SideNavItem[] = [
  { label: '资源审核', icon: 'menu-audit', route: RouteName.systemManagement },
  { label: '统计报表', icon: 'menu-report', route: RouteName.systemManagementReports }
];

// 统计报表在下一步接入 features/statistics-report
function renderReports() {
  return (
    <MxPanel headerTone="muted" title="统计报表">
      <ElEmpty description="统计报表：迁移中" />
    </MxPanel>
  );
}

/** 系统管理：左侧页面内导航；右侧是资源审核或统计报表。两个栏目是两个路由、同一个页面，切换时侧栏不重建 */
export const SystemManagementPage = defineComponent({
  name: 'SystemManagementPage',
  props: {
    section: { type: String as PropType<SystemSection>, required: true }
  },
  setup(props) {
    return () => (
      <MxSplitLayout asideType="menu" asideLabel="系统管理">
        {{
          aside: () => (
            <MxPanel flush>
              <SideNav label="系统管理" items={NAV_ITEMS} />
            </MxPanel>
          ),
          default: () => (props.section === 'audit' ? <AuditSection /> : renderReports())
        }}
      </MxSplitLayout>
    );
  }
});
