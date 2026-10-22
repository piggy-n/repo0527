import { defineComponent } from 'vue';
import { DashboardView } from '@/features/city-dashboard/components/DashboardView';

/** 独立驾驶舱页面由路由懒加载，不使用普通业务布局 */
export const CityDashboardPage = defineComponent({
  name: 'CityDashboardPage',
  setup: () => () => <DashboardView />
});
