import { Loading } from '@element-plus/icons-vue';
import { ElIcon, ElTag } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import type { ApplicationStatus, AuditStatus, PrepareStatus } from '../api';
import { AUDIT_STATUS_LABELS, PREPARE_STATUS_LABELS, PREPARE_WAITING_LABEL } from '../status';
import styles from './ApplicationStatus.module.scss';

const AUDIT_TAG_TYPES: Record<AuditStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger'
};

// 正在处理用转圈的加载图标，其余用静态图标
const PREPARE_ICONS: Record<Exclude<PrepareStatus, 'processing'>, IconName> = {
  success: 'check',
  timeout: 'status-warning',
  failed: 'status-error'
};

function renderPrepareIcon(status: PrepareStatus) {
  if (status === 'processing') {
    return (
      <ElIcon class="is-loading">
        <Loading />
      </ElIcon>
    );
  }
  return <SvgIcon name={PREPARE_ICONS[status]} size={14} />;
}

/** 审核状态的标签；混在申请表里的统计任务显示为"统计任务"（ADR 0091） */
export const AuditStatusTag = defineComponent({
  name: 'AuditStatusTag',
  props: {
    status: { type: String as PropType<ApplicationStatus>, required: true }
  },
  setup(props) {
    return () => {
      if (props.status === 'table') {
        return <ElTag type="info">统计任务</ElTag>;
      }
      return <ElTag type={AUDIT_TAG_TYPES[props.status]}>{AUDIT_STATUS_LABELS[props.status]}</ElTag>;
    };
  }
});

/** 数据准备的状态：图标加文字；没有状态时是"未开始处理"。哪些申请有这一步由调用方用 hasPrepareStep 判断 */
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
          {renderPrepareIcon(status)}
          {PREPARE_STATUS_LABELS[status]}
        </span>
      );
    };
  }
});
