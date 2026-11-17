import { ElCheckbox } from 'element-plus';
import { defineComponent, nextTick, type PropType, ref, type SlotsType, type VNode } from 'vue';
import { useSortableList } from '../../composables/useSortableList';
import { SvgIcon } from '../../icons/SvgIcon';
import type { MenuPoint } from './CatalogTree';
import styles from './CurrentLayerList.module.scss';

/** 行上正在播放的动效：新加入的滑入、定位到的闪两下 */
export type RowAnimation = 'entering' | 'flash' | null;

// 上下方向键：上 -1、下 1，其他 0
const arrowStep = (event: KeyboardEvent) => ({ ArrowUp: -1, ArrowDown: 1 })[event.key] ?? 0;

// 点在行里的按钮、输入框、选择框上时不改选中：它们自己处理
const isControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest('button, input, select, .el-select, .el-checkbox') !== null;

// 鼠标按在行里能聚焦的图标上（状态、盖住模型、加载失败）时焦点交给行：停在图标上时行的键盘操作都不响应。
// 只管鼠标，Tab 进来时照样停在图标上、显示提示；控件自己处理
const onRowMousedown = (event: MouseEvent) => {
  const row = event.currentTarget;
  const { target } = event;
  if (event.button !== 0 || isControl(target) || !(row instanceof HTMLElement) || !(target instanceof Element)) {
    return;
  }
  if (target.closest('[tabindex]') !== row) {
    event.preventDefault();
    row.focus();
  }
};

/**
 * 图层的列表（ADR 0157、0161）：二维资源和三维模型平铺在一起，每行是手柄、复选框和各 feature 自己的内容（插槽 row）。
 * 只能单选；按住手柄拖动或在手柄上按上下方向键排序（ADR 0054），一个拖动实例；筛选时只给看得见的行，位置按它们算。
 * 选中、显隐、移动、定位、移除、右键都只报告给页面，由页面交给对应的拥有者
 */
export const CurrentLayerList = defineComponent({
  name: 'CurrentLayerList',
  props: {
    /** 列表的读屏名称 */
    label: { type: String, required: true },
    keys: { type: Array as PropType<readonly string[]>, required: true },
    selected: { type: String as PropType<string | null>, default: null },
    /** 能用 Tab 进入的行：选中的行，没有选中时由页面给出第一行 */
    tabbable: { type: String as PropType<string | null>, default: null },
    visibleOf: { type: Function as PropType<(key: string) => boolean>, required: true },
    nameOf: { type: Function as PropType<(key: string) => string>, required: true },
    animationOf: { type: Function as PropType<(key: string) => RowAnimation>, default: () => null },
    /** 变淡的行（二维里的模型）：行里标了 data-row-dim 的符号、名称变淡，说明由行的内容自己给 */
    dimmedOf: { type: Function as PropType<(key: string) => boolean>, default: () => false },
    /** 列表上面的一行说明，如二维里只有模型时；不给时没有 */
    note: { type: String, default: undefined },
    /** 手柄的提示 */
    dragTip: { type: String, required: true }
  },
  emits: {
    select: (key: string) => typeof key === 'string',
    /** 上下方向键换选中：下一行由页面决定 */
    step: (key: string, delta: number) => typeof key === 'string' && Number.isInteger(delta),
    visible: (key: string, visible: boolean) => typeof key === 'string' && typeof visible === 'boolean',
    /** 挪到 keys 里的第 to 位 */
    move: (key: string, to: number) => typeof key === 'string' && Number.isInteger(to),
    /** 双击、回车：定位 */
    activate: (key: string) => typeof key === 'string',
    remove: (key: string) => typeof key === 'string',
    menu: (key: string, point: MenuPoint) => typeof key === 'string' && typeof point === 'object'
  },
  slots: Object as SlotsType<{
    row: (props: { key: string }) => VNode[];
  }>,
  setup(props, { emit, slots }) {
    const list = ref<HTMLElement>();
    const handle = '[data-drag-handle]';

    useSortableList(list, {
      handle,
      draggable: '>[data-current-row]',
      onMove: (from, to) => {
        const key = props.keys[from];
        if (key !== undefined) {
          emit('select', key);
          emit('move', key, to);
        }
      }
    });

    const focusHandle = async (key: string) => {
      await nextTick();
      const handles = list.value?.querySelectorAll<HTMLElement>(handle) ?? [];
      [...handles].find(item => item.dataset.key === key)?.focus();
    };

    const onHandleKeydown = (event: KeyboardEvent, key: string) => {
      const index = props.keys.indexOf(key);
      const to = index + arrowStep(event);
      if (to === index || to < 0 || to >= props.keys.length) {
        return;
      }
      event.preventDefault();
      emit('select', key);
      emit('move', key, to);
      void focusHandle(key);
    };

    // 移动以后 Vue 挪动行的 DOM，挪走的行失去焦点：重新聚焦到它
    const focusRow = async (key: string) => {
      await nextTick();
      list.value?.querySelector<HTMLElement>(`[data-current-row="${CSS.escape(key)}"]`)?.focus();
    };

    const onRowKeydown = (event: KeyboardEvent, key: string) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      const step = arrowStep(event);
      const index = props.keys.indexOf(key);
      if (step !== 0 && event.altKey) {
        const to = index + step;
        if (to >= 0 && to < props.keys.length) {
          emit('move', key, to);
          void focusRow(key);
        }
      } else if (step !== 0) {
        emit('step', key, step);
      } else if (event.key === ' ') {
        emit('visible', key, !props.visibleOf(key));
      } else if (event.key === 'Enter' && !event.isComposing) {
        emit('activate', key);
      } else if (event.key === 'Delete') {
        emit('remove', key);
      } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        emit('menu', key, { x: rect.left + 40, y: rect.bottom });
      } else {
        return;
      }
      event.preventDefault();
    };

    const renderRow = (key: string): VNode => {
      const selected = props.selected === key;
      const animation = props.animationOf(key);
      const name = props.nameOf(key);
      const visible = props.visibleOf(key);

      return (
        <li
          key={key}
          class={[
            styles.row,
            selected && styles.selected,
            !visible && styles.off,
            props.dimmedOf(key) && styles.dimmed,
            animation === 'entering' && styles.entering,
            animation === 'flash' && styles.flash
          ]}
          role="option"
          aria-selected={selected}
          tabindex={key === props.tabbable ? 0 : -1}
          data-current-row={key}
          onMousedown={onRowMousedown}
          onClick={(event: MouseEvent) => {
            if (!isControl(event.target)) {
              emit('select', key);
            }
          }}
          onDblclick={(event: MouseEvent) => {
            if (!isControl(event.target)) {
              emit('activate', key);
            }
          }}
          onContextmenu={(event: MouseEvent) => {
            event.preventDefault();
            emit('select', key);
            emit('menu', key, { x: event.clientX, y: event.clientY });
          }}
          onKeydown={(event: KeyboardEvent) => onRowKeydown(event, key)}
        >
          <button
            type="button"
            class={styles.handle}
            data-drag-handle
            data-key={key}
            aria-label={`调整顺序：${name}`}
            title={props.dragTip}
            onKeydown={(event: KeyboardEvent) => onHandleKeydown(event, key)}
          >
            <SvgIcon name="drag-handle" size={16} />
          </button>
          <ElCheckbox
            class={styles.checkbox}
            modelValue={visible}
            aria-label={`显示${name}`}
            onUpdate:modelValue={value => emit('visible', key, value === true)}
          />
          {slots.row({ key })}
        </li>
      );
    };

    return () => (
      <div class={styles.list}>
        {props.note && (
          <div class={styles.note} data-list-note>
            {props.note}
          </div>
        )}
        <ul ref={list} class={styles.rows} role="listbox" aria-label={props.label}>
          {props.keys.map(renderRow)}
        </ul>
      </div>
    );
  }
});
