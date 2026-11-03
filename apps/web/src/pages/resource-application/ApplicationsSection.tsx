import { defineComponent, type PropType } from 'vue';
import { useRouter } from 'vue-router';
import { ApplicationListPanel } from '@/features/data-application/components/ApplicationListPanel';
import { useApplicationView } from '@/features/data-application/composables/useApplicationReview';
import { navigate } from '@/shared/router/navigate';
import { RouteName } from '@/shared/router/route-names';

/**
 * 数据列表栏目：普通用户查看自己的申请、下载准备好的数据；只查看不审核，名称叫"资源名称"（同旧页面）。
 * 打开的申请是路由的查询参数 apply，写法同系统管理（ADR 0092）
 */
export const ApplicationsSection = defineComponent({
  name: 'ApplicationsSection',
  props: {
    applyId: { type: String as PropType<string | null>, default: null }
  },
  setup(props) {
    const router = useRouter();
    const view = useApplicationView(() => props.applyId);

    return () => (
      <ApplicationListPanel
        title="数据列表"
        owner={view}
        nameLabel="资源名称"
        showApplicant={false}
        onOpen={id => void navigate(router, { name: RouteName.resourceApplication, query: { apply: id } })}
        onClose={() => void navigate(router, { name: RouteName.resourceApplication, replace: true })}
      />
    );
  }
});
