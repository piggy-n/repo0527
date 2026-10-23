import { computed, defineComponent, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MessageCenterView } from '@/features/message-center/components/MessageCenterView';
import { useMessageCenter } from '@/features/message-center/composables/useMessageCenter';
import type { MessageTarget } from '@/features/message-center/presentation';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { navigate } from '@/shared/router/navigate';
import { RouteName } from '@/shared/router/route-names';

/** 应用层衔接消息与业务路由，两个 feature 不互相依赖 */
const MessageSession = defineComponent({
  name: 'MessageSession',
  props: { headerBottom: { type: Number, required: true } },
  setup(props) {
    const model = useMessageCenter();
    const session = useSessionStore();
    const router = useRouter();
    const route = useRoute();
    const unavailable = computed(() => session.user?.role === Role.admin ? '' : '用户侧关联业务尚未迁移');
    watch(() => route.fullPath, () => {
      model.open.value = false;
    });

    function openRelated(target: MessageTarget) {
      if (unavailable.value) {
        return Promise.resolve(false);
      }
      const destination = {
        name: RouteName.systemManagement,
        params: { section: target.kind === 'reports' ? 'statistical-report' : '' },
        query: target.kind === 'application' && target.id ? { applicationId: target.id } : {}
      };
      return router.resolve(destination).fullPath === route.fullPath
        ? Promise.resolve(true)
        : navigate(router, destination);
    }

    return () => (
      <MessageCenterView
        model={model}
        headerBottom={props.headerBottom}
        navigate={openRelated}
        unavailable={unavailable.value}
      />
    );
  }
});

/** 会话变化时销毁弹框操作状态，旧账号的进行中标志不带给新账号 */
export const HeaderMessages = defineComponent({
  name: 'HeaderMessages',
  props: { headerBottom: { type: Number, required: true } },
  setup(props) {
    const session = useSessionStore();
    return () => <MessageSession key={session.token} headerBottom={props.headerBottom} />;
  }
});
