import { useEventListener } from '@vueuse/core';
import { ElBadge, ElPopover } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { useRouter } from 'vue-router';
import { MessagePanel } from '@/features/message-center/components/MessagePanel';
import { useMessageCenter } from '@/features/message-center/composables/useMessageCenter';
import type { MessageTarget } from '@/features/message-center/display';
import { canAccess } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { navigate } from '@/shared/router/navigate';
import { MESSAGE_UNAVAILABLE, messageLocation } from '../message-routes';
import styles from './HeaderMessages.module.scss';

// 弹框顶边离顶栏下沿 8，左右、底边离窗口至少 16，最高 640（ADR 0093）
const GAP_BELOW_HEADER = 8;
const GAP_TO_WINDOW = 16;
const MAX_HEIGHT = 640;

// 窄屏时按钮右对齐放不下，Popper 把弹框推回窗口里，两边留 16
const POPPER_OPTIONS = {
  modifiers: [{ name: 'preventOverflow', options: { padding: GAP_TO_WINDOW } }]
};

/** 顶栏右侧的消息按钮：角标是未读数，点击在按钮下方打开非模态弹框；点外面、按 Esc、点业务按钮跳转时关闭 */
export const HeaderMessages = defineComponent({
  name: 'HeaderMessages',
  props: {
    // 顶栏元素，弹框贴着它的下沿；还没有挂载时按按钮的下沿
    header: { type: Object as PropType<HTMLElement> }
  },
  setup(props) {
    const router = useRouter();
    const session = useSessionStore();
    // ElPopover 不把 update:visible 传给内部的 tooltip，不能受控；开关由它自己管，这里跟着它的事件记下状态
    const popover = ref<InstanceType<typeof ElPopover>>();
    const button = ref<HTMLElement>();
    const open = ref(false);
    const center = useMessageCenter(open);

    // 打开时现量顶栏下沿和按钮下沿：弹框按按钮定位，偏移量让它贴着顶栏
    const headerBottom = ref(0);
    const buttonBottom = ref(0);
    const offset = computed(() => headerBottom.value - buttonBottom.value + GAP_BELOW_HEADER);
    const maxHeight = computed(
      () => `min(${MAX_HEIGHT}px, calc(100dvh - ${headerBottom.value + GAP_BELOW_HEADER + GAP_TO_WINDOW}px))`
    );

    function measure() {
      buttonBottom.value = button.value?.getBoundingClientRect().bottom ?? 0;
      headerBottom.value = props.header?.getBoundingClientRect().bottom ?? buttonBottom.value;
    }

    const label = computed(() => {
      const count = center.unreadCount.value;
      return count > 0 ? `消息，${count} 条未读` : '消息';
    });

    const close = () => popover.value?.hide();

    // 点击触发的弹框不响应 Esc，自己处理；关闭后焦点回到按钮
    useEventListener(document, 'keydown', (event: KeyboardEvent) => {
      if (open.value && event.key === 'Escape') {
        close();
        button.value?.focus();
      }
    });

    // 权限从路由的 meta.roles 读取，和顶部导航一致
    function unavailableReason(target: MessageTarget): string | null {
      const role = session.user?.role;
      const allowed = role !== undefined && canAccess(role, router.resolve(messageLocation(target)).meta.roles);
      return allowed ? null : MESSAGE_UNAVAILABLE;
    }

    // 跳转失败由 app 统一提示，这里不再处理
    async function openTarget(target: MessageTarget) {
      close();
      await navigate(router, messageLocation(target));
    }

    return () => (
      <ElPopover
        ref={popover}
        // 非模态的对话框：Element 按它给按钮加上 aria-haspopup、aria-expanded、aria-controls
        role="dialog"
        trigger="click"
        placement="bottom-end"
        width="min(400px, calc(100vw - 32px))"
        offset={offset.value}
        showArrow={false}
        popperOptions={POPPER_OPTIONS}
        popperClass={styles.popper}
        popperStyle={{ '--message-panel-max-height': maxHeight.value }}
        onBefore-enter={() => {
          measure();
          open.value = true;
        }}
        onBefore-leave={() => {
          open.value = false;
        }}
      >
        {{
          reference: () => (
            <button
              ref={button}
              type="button"
              class={[styles.bell, open.value && styles.open]}
              aria-label={label.value}
            >
              {/* 超过 99 显示 99+ 是 ElBadge 的默认 */}
              <ElBadge value={center.unreadCount.value} hidden={center.unreadCount.value === 0}>
                <SvgIcon name="header-bell" size={20} />
              </ElBadge>
            </button>
          ),
          default: () => (
            <MessagePanel
              center={center}
              unavailableReason={unavailableReason}
              onOpen={(target: MessageTarget) => void openTarget(target)}
            />
          )
        }}
      </ElPopover>
    );
  }
});
