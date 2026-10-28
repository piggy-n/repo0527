import { Loading } from '@element-plus/icons-vue';
import { ElIcon, ElTag } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import styles from './preview.module.scss';
import {
  type ApplicationSample,
  AUDIT_STATUS_LABELS,
  type AuditStatus,
  PREPARE_STATUS_LABELS,
  type PrepareStatus
} from './samples';
import type { TableRowMode } from './useSystemManagementDemo';

const AUDIT_TAG_TYPES: Record<AuditStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger'
};

const PREPARE_ICONS: Record<Exclude<PrepareStatus, 'processing'>, IconName> = {
  success: 'check',
  timeout: 'status-warning',
  failed: 'status-error'
};

/** 审核状态：统计任务按演示选项显示成"审核通过"（旧页面）或"统计任务" */
export const AuditStatusTag = defineComponent({
  name: 'AuditStatusTag',
  props: {
    row: { type: Object as PropType<ApplicationSample>, required: true },
    tableRowMode: { type: String as PropType<TableRowMode>, required: true }
  },
  setup(props) {
    return () => {
      const { status } = props.row;
      if (status === 'table') {
        return props.tableRowMode === 'legacy' ? (
          <ElTag type="success">{AUDIT_STATUS_LABELS.approved}</ElTag>
        ) : (
          <ElTag type="info">统计任务</ElTag>
        );
      }
      return <ElTag type={AUDIT_TAG_TYPES[status]}>{AUDIT_STATUS_LABELS[status]}</ElTag>;
    };
  }
});

/** 数据准备状态：只有审核通过的申请和统计任务才有；没有状态时是"未开始处理" */
export const PrepareStatusText = defineComponent({
  name: 'PrepareStatusText',
  props: {
    status: { type: String as PropType<PrepareStatus> }
  },
  setup(props) {
    return () => {
      const status = props.status;
      if (!status) {
        return <span class={styles.prepareWaiting}>未开始处理</span>;
      }
      return (
        <span class={[styles.prepare, styles[`prepare-${status}`]]}>
          {status === 'processing' ? (
            <ElIcon class="is-loading">
              <Loading />
            </ElIcon>
          ) : (
            <SvgIcon name={PREPARE_ICONS[status]} size={14} />
          )}
          {PREPARE_STATUS_LABELS[status]}
        </span>
      );
    };
  }
});

/** 申请是否有数据准备状态这一项 */
export const hasPrepareStep = (row: ApplicationSample) => row.status === 'approved' || row.status === 'table';
