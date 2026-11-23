import { ArrowRight } from '@element-plus/icons-vue';
import { useKeyModifier } from '@vueuse/core';
import { ElIcon, ElTooltip } from 'element-plus';
import {
  computed,
  defineComponent,
  nextTick,
  onDeactivated,
  onScopeDispose,
  type PropType,
  ref,
  shallowRef,
  type VNode,
  watch
} from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '../tooltip';
import {
  actionTargets,
  type CatalogSelection,
  clearedAt,
  clearedSelection,
  focusKey,
  isBatch,
  movedTo,
  rovingKey,
  selectKey,
  type SelectMode
} from './catalog-selection';
import { type CatalogLeaf, type CatalogNode, catalogCover, findCatalogNode, leavesOf, visibleKeys } from './catalog-tree';
import styles from './CatalogTree.module.scss';
import { revealInScroll } from './scroll';

/** 打开右键菜单的位置（视口坐标） */
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

type NodeAction = 'add' | 'remove';

// 操作过的行闪一下的时长，和图层里新加入的行一样；触屏的停留也到这时为止
const ACTED_MS = 900;

// 修饰键的状态在这些事件里更新：加上 mousemove，切回窗口后不按键、只移动鼠标也能更正
const MODIFIER_EVENTS: ['mousedown', 'mouseup', 'mousemove', 'keydown', 'keyup'] = [
  'mousedown',
  'mouseup',
  'mousemove',
  'keydown',
  'keyup'
];

// 项的行尾（用户 2026-11-15：勾和项数在同一条竖线上）：平时是已添加的绿勾，悬停、键盘焦点时换成这一下会做的
// （加号或叉）；只是图形，单击的是整行。点完停留时只显示结果
const renderLeafEnd = (leaf: CatalogLeaf, isHeld: boolean) => (
  <span class={styles.end} aria-hidden="true">
    {leaf.added && (
      <span class={styles.mark} data-added-mark>
        <SvgIcon name="layer-added" size={14} />
      </span>
    )}
    {!isHeld && (
      <span class={[styles.hint, leaf.added && styles.remove]} data-node-hint={leaf.added ? 'remove' : 'add'}>
        <SvgIcon name={leaf.added ? 'layer-remove' : 'layer-add'} size={16} />
      </span>
    )}
  </span>
);

/**
 * 资源目录的树（ADR 0157，单击的含义用户 2026-11-22 改过）：单击项就是添加或移除，悬停时底色、行尾、光标一起
 * 预告这一下会做什么；点完停在结果上、闪一下、读屏播报，鼠标或焦点离开这一行才换成相反的操作。分类不能选中，
 * 单击是展开、收起，行尾悬停时是整类的添加或移除。Ctrl（Mac 上 ⌘）单击加选、Shift 单击连选，选中只用于批量
 * （右键菜单、Insert、Delete，页面在多选时显示标题的批量按钮）。定位是回车和右键菜单，不再用双击。
 * 节点由各 feature 推导、页面拼好交进来，选中和展开由页面持有，添加、移除、定位都只报告给页面
 */
export const CatalogTree = defineComponent({
  name: 'CatalogTree',
  props: {
    nodes: { type: Array as PropType<readonly CatalogNode[]>, required: true },
    expanded: { type: Object as PropType<ReadonlySet<string>>, required: true },
    selection: { type: Object as PropType<CatalogSelection>, required: true },
    /** 有搜索关键字：分类全部展开，不能收起 */
    searching: { type: Boolean, default: false },
    label: { type: String, required: true }
  },
  emits: {
    'update:selection': (selection: CatalogSelection) => typeof selection === 'object',
    'update:expanded': (expanded: ReadonlySet<string>) => expanded instanceof Set,
    /** 要加入、移出的项的键，按目录的先后 */
    add: (keys: readonly string[]) => Array.isArray(keys),
    remove: (keys: readonly string[]) => Array.isArray(keys),
    /** 定位到图层里的这一项：只对已添加的项发出 */
    locate: (key: string) => typeof key === 'string',
    menu: (key: string, point: MenuPoint) => typeof key === 'string' && typeof point === 'object'
  },
  setup(props, { emit }) {
    const root = ref<HTMLElement>();
    const visible = computed(() => visibleKeys(props.nodes, props.expanded, props.searching));
    const roving = computed(() => rovingKey(props.selection, visible.value));
    // 能选中的只有项：连选只连显示着的项
    const leafKeys = computed(() => new Set(props.nodes.flatMap(leavesOf).map(leaf => leaf.key)));
    const visibleLeaves = computed(() => visible.value.filter(key => leafKeys.value.has(key)));

    // 按住 Ctrl、⌘、Shift 时单击是选中，不预告添加或移除
    const control = useKeyModifier('Control', { events: MODIFIER_EVENTS, initial: false });
    const meta = useKeyModifier('Meta', { events: MODIFIER_EVENTS, initial: false });
    const shift = useKeyModifier('Shift', { events: MODIFIER_EVENTS, initial: false });
    const modifying = computed(() => control.value || meta.value || shift.value);
    // 最后一次是手指：触屏笔记本上点过的行不留着悬停的状态色
    const touched = ref(false);
    const notePointer = (event: PointerEvent) => (touched.value = event.pointerType === 'touch');

    const rowOf = (key: string) => root.value?.querySelector<HTMLElement>(`[data-catalog-node="${CSS.escape(key)}"]`);
    const focusRow = async (key: string) => {
      await nextTick();
      const row = rowOf(key);
      if (row) {
        row.focus({ preventScroll: true });
        revealInScroll(row);
      }
    };

    // ---------- 操作以后的反馈（用户 2026-11-22）
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let disposed = false;
    const later = (ms: number, action: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        action();
      }, ms);
      timers.add(timer);
    };
    onScopeDispose(() => {
      disposed = true;
      timers.forEach(timer => clearTimeout(timer));
    });

    // 点完停留：操作过的那一行显示结果，不预告相反的操作，鼠标单击无效（双击不会加了又删），鼠标或焦点离开这一行
    // 才放开；触屏没有离开，闪完为止。每次停留是一个新对象，旧的计时到了不放开新的
    const held = shallowRef<{ readonly key: string } | null>(null);
    const hold = (key: string, pointerType: string) => {
      const next = { key };
      held.value = next;
      if (pointerType === 'touch') {
        later(ACTED_MS, () => {
          if (held.value === next) {
            held.value = null;
          }
        });
      }
    };
    const release = (key: string) => {
      if (held.value?.key === key) {
        held.value = null;
      }
    };
    // 行不见了（搜索、收起）或页面被缓存时收不到离开，直接放开
    watch(visible, keys => {
      if (held.value && !keys.includes(held.value.key)) {
        held.value = null;
      }
    });
    onDeactivated(() => (held.value = null));
    // 行最后一次是用什么按下的：触屏的停留按时间放开
    let pressType = 'mouse';

    // 闪一下的行：每一行记最后一次操作，较早的计时到了不提前去掉
    const actedBy = new Map<string, object>();
    const acted = shallowRef<ReadonlySet<string>>(new Set());
    const flashRows = (keys: readonly string[]) => {
      const batch = {};
      keys.forEach(key => actedBy.set(key, batch));
      acted.value = new Set(actedBy.keys());
      later(ACTED_MS, () => {
        keys.forEach(key => {
          if (actedBy.get(key) === batch) {
            actedBy.delete(key);
          }
        });
        acted.value = new Set(actedBy.keys());
      });
    };

    // 读屏播报：先清空再写，同一句话也再读一遍
    const announcement = ref('');
    const announce = async (text: string) => {
      announcement.value = '';
      await nextTick();
      if (!disposed) {
        announcement.value = text;
      }
    };

    // 报告给页面，等页面改完再看哪些项真的变了：操作的那一行停在结果上，变了的行闪一下（操作的是分类时分类也闪）、
    // 读屏播报；页面没接受的不停留、不提示
    const act = async (action: NodeAction, keys: readonly string[], source: CatalogNode, pointerType: string) => {
      if (action === 'add') {
        emit('add', keys);
      } else {
        emit('remove', keys);
      }
      await nextTick();
      if (disposed) {
        return;
      }
      const done = keys.flatMap(key => {
        const node = findCatalogNode(props.nodes, key);
        return node?.kind === 'leaf' && node.added === (action === 'add') ? [node] : [];
      });
      const [first] = done;
      if (first === undefined) {
        return;
      }
      hold(source.key, pointerType);
      flashRows(source.kind === 'branch' ? [source.key, ...done.map(node => node.key)] : done.map(node => node.key));
      const what = done.length === 1 ? first.label : `${done.length} 项`;
      await announce(`${action === 'add' ? '已添加' : '已移除'} ${what}`);
    };

    // 单击、空格：切换这一项，多选随之清空（单击作用的永远是这一行）
    const toggleLeaf = (leaf: CatalogLeaf, pointerType: string) => {
      emit('update:selection', clearedAt(props.selection, leaf.key));
      void act(leaf.added ? 'remove' : 'add', [leaf.key], leaf, pointerType);
    };

    const select = (key: string, mode: SelectMode = {}) =>
      emit('update:selection', selectKey(props.selection, key, visibleLeaves.value, mode));
    // 分类只接键盘焦点，选中不变
    const focusOnly = (key: string) => emit('update:selection', focusKey(props.selection, key));

    const toggleExpanded = (key: string, open?: boolean) => {
      const next = new Set(props.expanded);
      const shouldOpen = open ?? !next.has(key);
      if (shouldOpen === next.has(key)) {
        return;
      }
      if (shouldOpen) {
        next.add(key);
      } else {
        next.delete(key);
      }
      emit('update:expanded', next);
    };

    const locate = (key: string) => {
      const node = findCatalogNode(props.nodes, key);
      if (node?.kind === 'leaf' && node.added) {
        emit('locate', key);
      }
    };

    // 行上的单击：项是添加或移除（Ctrl / ⌘ 加选、Shift 连选，只改选中），分类是展开、收起。
    // 双击、三击的后几下（detail 按系统的双击间隔）和停在结果上的行不再切换
    const onRowClick = (event: MouseEvent, node: CatalogNode) => {
      if (node.kind === 'branch') {
        focusOnly(node.key);
        if (!props.searching) {
          toggleExpanded(node.key);
        }
        return;
      }
      const toggle = event.ctrlKey || event.metaKey;
      if (toggle || event.shiftKey) {
        select(node.key, { toggle, range: event.shiftKey });
        return;
      }
      if (event.detail > 1 || held.value?.key === node.key) {
        return;
      }
      toggleLeaf(node, pressType);
    };

    // 右键：多选里的项保留多选，菜单作用于整个选中；别的项清空多选，菜单只作用于它；分类不改选中，菜单作用于它下面的项
    const openMenu = (node: CatalogNode, point: MenuPoint) => {
      if (node.kind === 'branch' || (isBatch(props.selection) && props.selection.keys.has(node.key))) {
        focusOnly(node.key);
      } else {
        emit('update:selection', clearedAt(props.selection, node.key));
      }
      emit('menu', node.key, point);
    };

    // Insert、Delete 作用的项：分类是它下面的，项在多选里时是整个选中，否则是这一项
    const keyboardCover = (node: CatalogNode) =>
      catalogCover(props.nodes, node.kind === 'branch' ? [node.key] : actionTargets(props.selection, node.key));

    const onRowKeydown = (event: KeyboardEvent, node: CatalogNode) => {
      if (event.target !== event.currentTarget || event.isComposing) {
        return;
      }
      const index = visible.value.indexOf(node.key);
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step !== undefined) {
        // 上下只移焦点（到项上时连选的起点也移过来），Shift 加上下连选
        const next = visible.value[Math.min(visible.value.length - 1, Math.max(0, index + step))];
        if (next !== undefined && event.shiftKey && leafKeys.value.has(next)) {
          select(next, { range: true });
        } else if (next !== undefined && leafKeys.value.has(next)) {
          emit('update:selection', movedTo(props.selection, next));
        } else if (next !== undefined) {
          focusOnly(next);
        }
        if (next !== undefined) {
          void focusRow(next);
        }
      } else if (event.key === 'ArrowRight' && node.kind === 'branch' && !props.searching) {
        toggleExpanded(node.key, true);
      } else if (event.key === 'ArrowLeft' && node.kind === 'branch' && !props.searching) {
        toggleExpanded(node.key, false);
      } else if (event.key === ' ' || event.key === 'Enter') {
        // 空格在项上同单击（Ctrl / ⌘ 加空格是加选），按住不放的重复不再切换；回车是定位
        if (node.kind === 'branch') {
          if (!props.searching) {
            toggleExpanded(node.key);
          }
        } else if (event.key === 'Enter') {
          locate(node.key);
        } else if (event.ctrlKey || event.metaKey) {
          select(node.key, { toggle: true });
        } else if (!event.repeat) {
          toggleLeaf(node, 'keyboard');
        }
      } else if (event.key === 'Insert' || event.key === 'Delete') {
        const cover = keyboardCover(node);
        const keys = event.key === 'Insert' ? cover.add : cover.remove;
        if (keys.length > 0) {
          void act(event.key === 'Insert' ? 'add' : 'remove', keys, node, 'keyboard');
        }
      } else if (event.key === 'Escape' && props.selection.keys.size > 0) {
        emit('update:selection', clearedSelection(props.selection));
      } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        openMenu(node, { x: rect.left + 40, y: rect.bottom });
      } else {
        return;
      }
      event.preventDefault();
    };

    // 分类的行尾：平时是项数，悬停、键盘焦点时换成整类的添加（还有没添加的）或移除；整类操作量大，只在这个按钮、
    // 右键菜单和 Insert、Delete 上，分类单击仍是展开、收起。点完停留时没有按钮，双击的第二下落在这一列上不展开
    const renderBranchEnd = (node: CatalogNode, isHeld: boolean) => {
      const leaves = leavesOf(node);
      const added = leaves.filter(leaf => leaf.added).length;
      const canAdd = added < leaves.length;
      const count = canAdd ? leaves.length - added : leaves.length;
      const tip = `${canAdd ? '添加' : '移除'} ${count} 项`;
      const keys = leaves.filter(leaf => leaf.added !== canAdd).map(leaf => leaf.key);
      return (
        <span
          class={styles.end}
          onClick={(event: MouseEvent) => {
            if (isHeld) {
              event.stopPropagation();
            }
          }}
        >
          <span class={styles.badge}>{leaves.length}</span>
          {leaves.length > 0 && !isHeld && (
            <ElTooltip {...MAP_TOOLTIP_PROPS} content={tip} placement="top">
              <button
                type="button"
                class={[styles.action, !canAdd && styles.remove]}
                tabindex={-1}
                aria-label={`${tip}：${node.label}`}
                data-node-action={canAdd ? 'add' : 'remove'}
                // 焦点不进按钮：按钮点完就不显示了，焦点跟着丢掉会放开停留
                onMousedown={(event: MouseEvent) => event.preventDefault()}
                onClick={(event: MouseEvent) => {
                  event.stopPropagation();
                  void act(canAdd ? 'add' : 'remove', keys, node, pressType);
                }}
              >
                <SvgIcon name={canAdd ? 'layer-add' : 'layer-remove'} size={16} />
              </button>
            </ElTooltip>
          )}
        </span>
      );
    };

    const renderNode = (node: CatalogNode, depth: number): VNode => {
      const selected = props.selection.keys.has(node.key);
      const open = node.kind === 'branch' && (props.searching || props.expanded.has(node.key));
      const isHeld = held.value?.key === node.key;
      const row = (
        <div
          class={[
            styles.row,
            node.kind === 'branch' ? styles.branch : styles.leaf,
            node.kind === 'leaf' && node.added && styles.added,
            selected && styles.selected,
            isHeld && styles.held,
            acted.value.has(node.key) && styles.acted
          ]}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={node.kind === 'leaf' ? selected : undefined}
          aria-expanded={node.kind === 'branch' ? open : undefined}
          tabindex={node.key === roving.value ? 0 : -1}
          data-catalog-node={node.key}
          style={{ paddingLeft: `${depth * 18}px` }}
          onPointerdown={(event: PointerEvent) => (pressType = event.pointerType)}
          onClick={(event: MouseEvent) => onRowClick(event, node)}
          onContextmenu={(event: MouseEvent) => {
            event.preventDefault();
            openMenu(node, { x: event.clientX, y: event.clientY });
          }}
          onKeydown={(event: KeyboardEvent) => onRowKeydown(event, node)}
          onPointerleave={(event: PointerEvent) => {
            if (event.pointerType !== 'touch') {
              release(node.key);
            }
          }}
          onFocusout={(event: FocusEvent) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node && (event.currentTarget as HTMLElement).contains(next))) {
              release(node.key);
            }
          }}
        >
          {node.kind === 'branch' ? (
            <button
              type="button"
              class={[styles.arrow, open && styles.open]}
              tabindex={-1}
              aria-label={`${open ? '收起' : '展开'}${node.label}`}
              disabled={props.searching}
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                toggleExpanded(node.key);
              }}
            >
              <ElIcon>
                <ArrowRight />
              </ElIcon>
            </button>
          ) : (
            <span class={styles.pad} />
          )}
          {node.kind === 'leaf' && <SvgIcon class={styles.icon} name={node.icon} size={16} />}
          {node.kind === 'branch' && node.icon && <SvgIcon class={styles.icon} name={node.icon} size={16} />}
          <span class={styles.name} title={node.label}>
            {node.label}
          </span>
          {node.kind === 'leaf' && node.note && <span class={styles.note}>{node.note}</span>}
          {/* 行尾的勾只是图形，"已添加"写成看不见的文字，悬停、焦点时勾换成加号或叉也读得到 */}
          {node.kind === 'leaf' && node.added && <span class={styles.hiddenText}>已添加</span>}
          {node.kind === 'leaf' ? renderLeafEnd(node, isHeld) : renderBranchEnd(node, isHeld)}
        </div>
      );
      return (
        <li key={node.key} role="none">
          {row}
          {open && node.kind === 'branch' && (
            <ul class={styles.children} role="group" style={{ '--guide-depth': depth }}>
              {node.children.map(child => renderNode(child, depth + 1))}
            </ul>
          )}
        </li>
      );
    };

    return () => (
      <div
        class={[
          styles.root,
          modifying.value && styles.modifying,
          touched.value && styles.touch,
          props.searching && styles.searching
        ]}
        onPointerover={notePointer}
        onPointerdown={notePointer}
      >
        <ul ref={root} class={styles.tree} role="tree" aria-label={props.label} aria-multiselectable="true">
          {props.nodes.map(node => renderNode(node, 0))}
        </ul>
        <span class={styles.live} aria-live="polite" data-catalog-announcement>
          {announcement.value}
        </span>
      </div>
    );
  }
});
