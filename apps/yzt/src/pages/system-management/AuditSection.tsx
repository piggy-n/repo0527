import { defineComponent, type PropType } from 'vue';
import { useRouter } from 'vue-router';
import { ApplicationListPanel } from '@/features/data-application/components/ApplicationListPanel';
import { useApplicationReview } from '@/features/data-application/composables/useApplicationReview';
import { auditOpenLabel } from '@/features/data-application/status';
import { navigate } from '@/shared/router/navigate';
import { RouteName } from '@/shared/router/route-names';

/**
 * 资源审核栏目：只在这个栏目显示时存在，切到统计报表时不再请求申请列表。
 * 打开的申请是路由的查询参数 apply（ADR 0092）：打开时 push，浏览器的后退能关掉弹窗；关闭时 replace 去掉它
 */
export const AuditSection = defineComponent({
  name: 'AuditSection',
  props: {
    applyId: { type: String as PropType<string | null>, default: null }
  },
  setup(props) {
    const router = useRouter();
    const review = useApplicationReview(() => props.applyId);

    return () => (
      <ApplicationListPanel
        title="资源审核"
        owner={review}
        openLabel={auditOpenLabel}
        onOpen={id => void navigate(router, { name: RouteName.systemManagement, query: { apply: id } })}
        onClose={() => void navigate(router, { name: RouteName.systemManagement, replace: true })}
      />
    );
  }
});
