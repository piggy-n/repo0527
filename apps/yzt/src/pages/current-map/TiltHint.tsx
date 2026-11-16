import { ElButton } from 'element-plus';
import { defineComponent } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import styles from './TiltHint.module.scss';

/**
 * 斜着看时的提示（ADR 0161，原型 height-H3）：画在模型上面的二维和模型会错开，"俯视"一键回到俯视。显示与否由页面判断
 * （tiltHintShown），位置由页面决定（地图下方居中）
 */
export const TiltHint = defineComponent({
  name: 'TiltHint',
  emits: {
    topDown: () => true
  },
  setup(_, { emit }) {
    return () => (
      <div class={styles.hint} role="status" data-tilt-hint>
        <SvgIcon class={styles.icon} name="info" size={14} />
        <span class={styles.text}>倾斜时二维图层和模型会错开</span>
        <ElButton class="button-inline" link type="primary" size="small" onClick={() => emit('topDown')}>
          俯视
        </ElButton>
      </div>
    );
  }
});
