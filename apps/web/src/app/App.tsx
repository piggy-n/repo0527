import { defineComponent } from 'vue';
import styles from './App.module.scss';

export const App = defineComponent({
  name: 'App',
  setup() {
    return () => <div class={styles.root}>江苏省统一调查监测现状图</div>;
  }
});
