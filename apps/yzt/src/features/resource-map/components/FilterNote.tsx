import { defineComponent } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import styles from './FilterNote.module.scss';

/** 图例里类别列表体现不了的过滤条件（ADR 0173）：漏斗加"只显示 类型：小学、……"，写在资源名称下面 */
export const FilterNote = defineComponent({
  name: 'FilterNote',
  props: {
    text: { type: String, required: true }
  },
  setup(props) {
    return () => (
      <div class={styles.note} data-filter-note>
        <SvgIcon class={styles.icon} name="layer-filter" size={14} />
        <span>只显示 {props.text}</span>
      </div>
    );
  }
});
