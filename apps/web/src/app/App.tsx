import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { defineComponent } from 'vue';
import { RouterView } from 'vue-router';

export const App = defineComponent({
  name: 'App',
  setup() {
    // 第一次挂载的 ElConfigProvider 同时成为全局默认配置，ElMessageBox 等函数式调用也会用中文
    return () => (
      <ElConfigProvider locale={zhCn}>
        <RouterView />
      </ElConfigProvider>
    );
  }
});
