import { defineComponent } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { useExportPart } from './export-parts';
import { compassExportPart } from './overlay-export';
import styles from './overlay.module.scss';

/** 多色指北针：只转里面的 svg，外层的变换留给入场动画；放在地图角上时一起画进导出图片 */
export const DashboardCompass = defineComponent({
  name: 'DashboardCompass',
  props: {
    /** "北"相对屏幕上方的顺时针角度（度），即 MapView 的 northDegrees */
    rotation: { type: Number, default: 0 }
  },
  setup(props) {
    useExportPart(() => compassExportPart(props.rotation));
    return () => (
      <div class={styles.compass} role="img" aria-label="指北针">
        <SvgIcon name="dashboard-compass-color" rotate={props.rotation} />
      </div>
    );
  }
});
