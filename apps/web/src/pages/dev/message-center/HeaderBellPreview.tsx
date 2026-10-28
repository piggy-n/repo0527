import { useEventListener } from '@vueuse/core';
import { ElBadge, ElPopover } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { MessagePanelPreview } from './MessagePanelPreview';
import styles from './preview.module.scss';
import type { MessageDemo } from './useMessageDemo';

// 弹框顶边离顶栏下沿 8，左右、底边离窗口至少 16，最高 640
const GAP_BELOW_HEADER = 8;
const GAP_TO_WINDOW = 16;
const MAX_HEIGHT = 640;

// 窄屏时按钮右对齐放不下，Popper 把弹框推回窗口里，两边留 16
const POPPER_OPTIONS = {
  modifiers: [{ name: 'preventOverflow', options: { padding: GAP_TO_WINDOW } }]
};

/** 顶栏右侧的消息按钮：未读数在角标上，点击在按钮下方打开非模态弹框，点外面、按 Esc 或跳转时关闭 */
export const HeaderBellPreview = defineComponent({
  name: 'HeaderBellPreview',
  props: {
    demo: { type: Object as PropType<MessageDemo>, required: true },
    // 顶栏元素，弹框贴着它的下沿；正式代码里由 AppHeader 提供
    header: { type: Object as PropType<HTMLElement> }
  },
  setup(props) {
    // ElPopover 不把 update:visible 传给内部的 tooltip，不能受控；开关由它自己管，这里只跟着它的事件记下状态
    const popover = ref<InstanceType<typeof ElPopover>>();
    const open = ref(false);
    const button = ref<HTMLElement>();
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
      const count = props.demo.unreadCount.value;
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

    return () => (
      <ElPopover
        ref={popover}
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
        onBefore-leave={() => (open.value = false)}
      >
        {{
          reference: () => (
            <button
              ref={button}
              type="button"
              class={[styles.bell, open.value && styles.bellOpen]}
              aria-label={label.value}
              aria-haspopup="dialog"
            >
              <ElBadge value={props.demo.unreadCount.value} max={99} hidden={props.demo.unreadCount.value === 0}>
                <SvgIcon name="header-bell" size={20} />
              </ElBadge>
            </button>
          ),
          default: () => <MessagePanelPreview demo={props.demo} onNavigate={close} />
        }}
      </ElPopover>
    );
  }
});
