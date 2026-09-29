import { defineComponent } from 'vue';
import { RouterView } from 'vue-router';

/** 业务页面共用的布局 */
export const AppLayout = defineComponent({
  name: 'AppLayout',
  setup() {
    return () => <RouterView />;
  }
});
