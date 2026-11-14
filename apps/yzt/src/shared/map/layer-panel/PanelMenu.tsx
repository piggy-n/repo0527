import { defineComponent, nextTick, type PropType, ref, watch } from 'vue';
import { type IconName, SvgIcon } from '../../icons/SvgIcon';
import { useLightDismiss } from '../popover/useLightDismiss';
import type { MenuPoint } from './CatalogTree';
import styles from './PanelMenu.module.scss';

/** 菜单的一项 */
export interface PanelMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** 移除这类：悬停时红色 */
  readonly danger?: boolean;
  /** 右边灰色的快捷键说明 */
  readonly shortcut?: string;
}

export type PanelMenuEntry = PanelMenuItem | 'divider';

// 离视口边至少留的距离
const MARGIN = 8;

/**
 * 资源图层面板的右键菜单（ADR 0157）：补充入口，不是唯一入口。在指针处打开，放不下时往回挪；
 * 打开时焦点在第一个能用的项上，上下方向键移动，回车执行，Esc 和点外面关闭
 */
export const PanelMenu = defineComponent({
  name: 'PanelMenu',
  props: {
    open: { type: Boolean, default: false },
    point: { type: Object as PropType<MenuPoint>, required: true },
    items: { type: Array as PropType<readonly PanelMenuEntry[]>, required: true },
    label: { type: String, required: true }
  },
  emits: {
    select: (key: string) => typeof key === 'string',
    close: () => true
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    const position = ref<MenuPoint | null>(null);

    const enabledButtons = () => [
      ...(element.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    ];

    watch(
      () => [props.open, props.point] as const,
      async ([open]) => {
        position.value = null;
        if (!open) {
          return;
        }
        await nextTick();
        const menu = element.value;
        if (!menu) {
          return;
        }
        const { width, height } = menu.getBoundingClientRect();
        position.value = {
          x: Math.max(MARGIN, Math.min(props.point.x, window.innerWidth - width - MARGIN)),
          y: Math.max(MARGIN, Math.min(props.point.y, window.innerHeight - height - MARGIN))
        };
        enabledButtons()[0]?.focus({ preventScroll: true });
      },
      { immediate: true }
    );

    useLightDismiss({
      active: () => props.open,
      contains: target => element.value?.contains(target) === true,
      onOutside: () => emit('close'),
      onEscape: () => emit('close')
    });

    const onKeydown = (event: KeyboardEvent) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step === undefined) {
        return;
      }
      event.preventDefault();
      const buttons = enabledButtons();
      const index = buttons.findIndex(button => button === document.activeElement);
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    };

    return () => {
      if (!props.open) {
        return null;
      }
      const at = position.value ?? props.point;
      return (
        <div
          ref={element}
          class={styles.menu}
          style={{ left: `${at.x}px`, top: `${at.y}px`, visibility: position.value ? undefined : 'hidden' }}
          role="menu"
          aria-label={props.label}
          data-panel-menu
          onKeydown={onKeydown}
          onContextmenu={(event: MouseEvent) => event.preventDefault()}
        >
          {props.items.map((item, index) =>
            item === 'divider' ? (
              <div key={`divider-${index}`} class={styles.divider} role="separator" />
            ) : (
              <button
                key={item.key}
                type="button"
                class={[styles.item, item.danger && styles.danger]}
                role="menuitem"
                disabled={item.disabled}
                data-menu-item={item.key}
                onClick={() => emit('select', item.key)}
              >
                <span class={styles.icon}>{item.icon && <SvgIcon name={item.icon} size={16} />}</span>
                <span class={styles.label}>{item.label}</span>
                {item.shortcut && <span class={styles.shortcut}>{item.shortcut}</span>}
              </button>
            )
          )}
        </div>
      );
    };
  }
});
