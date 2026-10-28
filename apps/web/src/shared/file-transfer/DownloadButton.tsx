import { ElButton } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import styles from './DownloadButton.module.scss';

/** 表格行、弹窗里的"下载"：下载中换成进度（"下载 35%"，总量未知时"下载中"），不能下载时置灰（ADR 0091） */
export const DownloadButton = defineComponent({
  name: 'DownloadButton',
  props: {
    downloading: { type: Boolean, required: true },
    // 0～100；还没有进度或总量未知时是 null
    percent: { type: Number as PropType<number | null>, default: null },
    disabled: Boolean
  },
  emits: {
    click: () => true
  },
  setup(props, { emit }) {
    return () => {
      if (props.downloading) {
        return (
          <span class={styles.progress} role="status">
            {props.percent === null ? '下载中' : `下载 ${props.percent}%`}
          </span>
        );
      }
      return (
        <ElButton link type="primary" disabled={props.disabled} onClick={() => emit('click')}>
          下载
        </ElButton>
      );
    };
  }
});
