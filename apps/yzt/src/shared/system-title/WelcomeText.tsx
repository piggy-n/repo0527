import { defineComponent } from 'vue';
import styles from './SystemTitle.module.scss';
import outline from './welcome-outline.json';

/** 登录页的装饰文字 WELCOME!：与系统名称相同的字体轮廓，大小跟随 font-size，颜色跟随 color；读屏软件忽略它 */
export const WelcomeText = defineComponent({
  name: 'WelcomeText',
  setup() {
    return () => (
      <svg class={styles.root} viewBox={outline.viewBox} aria-hidden="true">
        <path d={outline.path} fill="currentColor" />
      </svg>
    );
  }
});
