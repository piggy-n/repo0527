import { ElTag } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { ApplicationStatus, AuditStatus } from '../api';
import { AUDIT_STATUS_LABELS } from '../status';

const AUDIT_TAG_TYPES: Record<AuditStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger'
};

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
