import { ElTag } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { ApplicationStatus, AuditStatus } from '../api';
import { AUDIT_STATUS_LABELS } from '../status';

const AUDIT_TAG_TYPES: Record<AuditStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger'
};

/** 审核状态的标签；混在申请表里的统计任务按审核通过显示（同旧页面，ADR 0113），"统计任务"标在数据名称后面 */
export const AuditStatusTag = defineComponent({
  name: 'AuditStatusTag',
  props: {
    status: { type: String as PropType<ApplicationStatus>, required: true }
  },
  setup(props) {
    return () => {
      const status = props.status === 'table' ? 'approved' : props.status;
      return <ElTag type={AUDIT_TAG_TYPES[status]}>{AUDIT_STATUS_LABELS[status]}</ElTag>;
    };
  }
});
