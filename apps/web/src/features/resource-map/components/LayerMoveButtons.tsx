import { defineComponent, type PropType } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import styles from './LayerMoveButtons.module.scss';

export type MoveDirection = 'up' | 'down';

/** 调的是哪一种顺序：目录里的展示顺序，或地图的叠放顺序 */
export type MoveOrder = 'catalog' | 'stacking';

// 无障碍名称按顺序区分，两处的同一个资源不重名；悬停提示只写方向
const LABELS: Readonly<Record<MoveOrder, Readonly<Record<MoveDirection, string>>>> = {
  catalog: { up: '目录里上移', down: '目录里下移' },
  stacking: { up: '上移一层', down: '下移一层' }
};

// 操作按钮不触发资源行的选择或拖动
const stop = (event: Event) => event.stopPropagation();

/**
 * 移动后焦点回到这一行的同一个按钮：列表按数据重新排过，按钮所在的元素移动后失去了焦点；
 * 到头不可用时换到另一个方向的按钮
 */
export function focusMoveButton(row: Element | null | undefined, direction: MoveDirection): void {
  const of = (which: MoveDirection) => row?.querySelector<HTMLButtonElement>(`[data-move="${which}"]`);
  const same = of(direction);
  const target = same && !same.disabled ? same : of(direction === 'up' ? 'down' : 'up');
  target?.focus();
}

/**
 * 资源树和"已选择图层"行末的上移、下移（ADR 0096）：在透明度入口右边，跟着行悬停或键盘焦点显示；
 * 移动由列表交给顺序的拥有者，到头时不可用。行里只放一组，focusMoveButton 按 data-move 找
 */
export const LayerMoveButtons = defineComponent({
  name: 'LayerMoveButtons',
  props: {
    name: { type: String, required: true },
    order: { type: String as PropType<MoveOrder>, required: true },
    canUp: { type: Boolean, default: false },
    canDown: { type: Boolean, default: false }
  },
  emits: {
    move: (direction: MoveDirection) => direction === 'up' || direction === 'down'
  },
  setup(props, { emit }) {
    return () => (
      <span class={styles.root} onClick={stop} onPointerdown={stop}>
        <button
          type="button"
          class={styles.button}
          data-move="up"
          aria-label={`${LABELS[props.order].up}：${props.name}`}
          title="上移"
          disabled={!props.canUp}
          onClick={() => emit('move', 'up')}
        >
          <SvgIcon name="move-up" size={16} />
        </button>
        <button
          type="button"
          class={styles.button}
          data-move="down"
          aria-label={`${LABELS[props.order].down}：${props.name}`}
          title="下移"
          disabled={!props.canDown}
          onClick={() => emit('move', 'down')}
        >
          <SvgIcon name="move-down" size={16} />
        </button>
      </span>
    );
  }
});
