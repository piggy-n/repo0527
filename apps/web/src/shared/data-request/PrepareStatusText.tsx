import { Loading } from '@element-plus/icons-vue';
import { ElIcon } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { type IconName, SvgIcon } from '../icons/SvgIcon';
import { PREPARE_STATUS_LABELS, PREPARE_WAITING_LABEL, type PrepareStatus } from './prepare-status';
import styles from './PrepareStatusText.module.scss';

// 正在处理用转圈的加载图标，其余用静态图标
const PREPARE_ICONS: Record<Exclude<PrepareStatus, 'processing'>, IconName> = {
  success: 'check',
  timeout: 'status-warning',
  failed: 'status-error'
};

function renderIcon(status: PrepareStatus) {
  if (status === 'processing') {
    return (
      <ElIcon class="is-loading">
        <Loading />
      </ElIcon>
    );
  }
  return <SvgIcon name={PREPARE_ICONS[status]} size={14} />;
}

/** 数据准备的状态：图标加文字；没有状态时是"未开始处理"。哪些记录有这一步由调用方判断 */
export const PrepareStatusText = defineComponent({
  name: 'PrepareStatusText',
  props: {
    status: { type: String as PropType<PrepareStatus> }
  },
  setup(props) {
    return () => {
      const status = props.status;
      if (!status) {
        return <span class={[styles.root, styles.waiting]}>{PREPARE_WAITING_LABEL}</span>;
      }
      return (
        <span class={[styles.root, styles[status]]}>
          {renderIcon(status)}
          {PREPARE_STATUS_LABELS[status]}
        </span>
      );
    };
  }
});
