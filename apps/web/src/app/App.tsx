import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { defineComponent, type PropType } from 'vue';
import { RouterView } from 'vue-router';
import type { NavigationRecovery } from './navigation-recovery';
import { NavigationFailureNotice } from './NavigationFailureNotice';

export const App = defineComponent({
  name: 'App',
  props: {
    recovery: { type: Object as PropType<NavigationRecovery>, required: true }
  },
  setup(props) {
    // 第一次挂载的 ElConfigProvider 同时成为全局默认配置，ElMessageBox 等函数式调用也会用中文
    return () => (
      <ElConfigProvider locale={zhCn}>
        <RouterView />
        <NavigationFailureNotice recovery={props.recovery} />
      </ElConfigProvider>
    );
  }
});
