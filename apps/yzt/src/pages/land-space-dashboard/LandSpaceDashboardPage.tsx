import { defineComponent } from 'vue';
import { LandSpaceView } from '@/features/land-space-dashboard/components/LandSpaceView';

/** 综合分析驾驶舱由路由懒加载，和城市体检驾驶舱一样不使用普通业务布局 */
export const LandSpaceDashboardPage = defineComponent({
  name: 'LandSpaceDashboardPage',
  setup: () => () => <LandSpaceView />
});
