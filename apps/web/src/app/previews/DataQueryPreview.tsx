import { defineComponent } from 'vue';
import { DevDataQueryPage } from '@/pages/dev/data-query/DevDataQueryPage';
import { AppHeader } from '../layout/components/AppHeader';

// 应用层组合 Header 与开发页面，生产路由不引用此预览
export const DataQueryPreview = defineComponent({
  name: 'DataQueryPreview',
  setup() {
    return () => <DevDataQueryPage>{{ header: () => <AppHeader /> }}</DevDataQueryPage>;
  }
});
