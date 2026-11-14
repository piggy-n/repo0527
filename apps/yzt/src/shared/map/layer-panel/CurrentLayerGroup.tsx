import { ArrowRight } from '@element-plus/icons-vue';
import { ElCheckbox, ElIcon } from 'element-plus';
import { defineComponent, nextTick, type PropType, ref, type SlotsType, type VNode } from 'vue';
import { useSortableList } from '../../composables/useSortableList';
import { SvgIcon } from '../../icons/SvgIcon';
import type { MenuPoint } from './CatalogTree';
import styles from './CurrentLayerGroup.module.scss';

/** 行上正在播放的动效：新加入的滑入、定位到的闪两下 */
export type RowAnimation = 'entering' | 'flash' | null;

// 上下方向键：上 -1、下 1，其他 0
const arrowStep = (event: KeyboardEvent) => ({ ArrowUp: -1, ArrowDown: 1 })[event.key] ?? 0;

// 点在行里的按钮、输入框、选择框上时不改选中：它们自己处理
const isControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest('button, input, select, .el-select, .el-checkbox') !== null;

/**
 * 当前图层里的一组（二维图层、三维模型，ADR 0157）：可以收起；每行是手柄、复选框和各 feature 自己的内容（插槽 row）。
 * 只能单选；按住手柄拖动或在手柄上按上下方向键在本组里排序（ADR 0054），两组各一个拖动实例，不能跨组。
 * 选中、显隐、移动、定位、移除、右键都只报告给页面，由页面交给对应的拥有者
 */
export const CurrentLayerGroup = defineComponent({
  name: 'CurrentLayerGroup',
  props: {
    /** 组的标识，拖动手柄按它区分 */
    group: { type: String, required: true },
    title: { type: String, required: true },
    /** 标题旁的标签，如二维里模型组的"仅三维" */
    tag: { type: String, default: undefined },
    /** 整组变淡：二维里的模型 */
    dimmed: { type: Boolean, default: false },
    open: { type: Boolean, default: true },
    keys: { type: Array as PropType<readonly string[]>, required: true },
    selected: { type: String as PropType<string | null>, default: null },
    /** 能用 Tab 进入的行：选中的行，没有选中时由页面给出第一行 */
    tabbable: { type: String as PropType<string | null>, default: null },
    visibleOf: { type: Function as PropType<(key: string) => boolean>, required: true },
    nameOf: { type: Function as PropType<(key: string) => string>, required: true },
    animationOf: { type: Function as PropType<(key: string) => RowAnimation>, default: () => null },
    /** 手柄的提示 */
    dragTip: { type: String, required: true }
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    select: (key: string) => typeof key === 'string',
    /** 上下方向键换选中：跨组时由页面决定下一行 */
    step: (key: string, delta: number) => typeof key === 'string' && Number.isInteger(delta),
    visible: (key: string, visible: boolean) => typeof key === 'string' && typeof visible === 'boolean',
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
    const handle = `[data-drag-handle="${props.group}"]`;

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
            animation === 'entering' && styles.entering,
            animation === 'flash' && styles.flash
          ]}
          role="option"
          aria-selected={selected}
          tabindex={key === props.tabbable ? 0 : -1}
          data-current-row={key}
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
            data-drag-handle={props.group}
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
      <div class={[styles.group, props.dimmed && styles.dimmed]} data-current-group={props.group}>
        <button
          type="button"
          class={styles.head}
          aria-expanded={props.open}
          onClick={() => emit('update:open', !props.open)}
        >
          <ElIcon class={[styles.arrow, props.open && styles.open]}>
            <ArrowRight />
          </ElIcon>
          <span>{props.title}</span>
          <span class={styles.badge}>{props.keys.length}</span>
          {props.tag && <span class={styles.tag}>{props.tag}</span>}
        </button>
        {props.open && (
          <ul ref={list} class={styles.rows} role="listbox" aria-label={props.title}>
            {props.keys.map(renderRow)}
          </ul>
        )}
      </div>
    );
  }
});
